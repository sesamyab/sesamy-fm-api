const { promises: fs } = require("fs");
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("fluent-ffmpeg");
const { Hono } = require("hono");
const { serve } = require("@hono/node-server");

// IMPORTANT: This container only uses signed URLs for R2 operations.
// It never directly accesses R2 using credentials - all R2 access is through
// pre-signed URLs provided by the calling workflow.
// R2 keys are passed through for the workflow to use later with the bucket API.

const PORT = process.env.PORT || 8080;

// Track active encoding jobs
let activeJobs = new Set();
let jobCounter = 0;

// Create Hono app
const app = new Hono();

// CORS middleware
app.use("*", async (c, next) => {
  await next();
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
});

// Handle OPTIONS requests
app.options("*", (c) => c.text("", 200));

// Health check endpoints
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "encoding-service-container",
    timestamp: new Date().toISOString(),
    instanceId: process.env.CLOUDFLARE_DEPLOYMENT_ID || "local",
    ffmpegVersion: "available",
  });
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "encoding-service-container",
    timestamp: new Date().toISOString(),
    instanceId: process.env.CLOUDFLARE_DEPLOYMENT_ID || "local",
    ffmpegVersion: "available",
    activeJobs: activeJobs.size,
    jobsInProgress: Array.from(activeJobs),
  });
});

// Warmup endpoint to keep container alive and ready
app.post("/warmup", (c) => {
  console.log(`[WARMUP] Container warmed up at ${new Date().toISOString()}`);
  return c.json({
    status: "warmed",
    service: "encoding-service-container",
    timestamp: new Date().toISOString(),
    message: "Container is ready for encoding tasks",
  });
});

// Audio metadata endpoint
app.post("/metadata", async (c) => {
  try {
    const { audioUrl } = await c.req.json();

    if (!audioUrl) {
      return c.json(
        {
          success: false,
          error: "audioUrl is required",
        },
        400
      );
    }

    console.log(`Getting metadata for: ${audioUrl}`);
    const audioProps = await getAudioProperties(audioUrl);

    return c.json({
      success: true,
      duration: audioProps.duration,
      channels: audioProps.channels,
      sampleRate: audioProps.sampleRate,
      inputBitrate: audioProps.inputBitrate,
    });
  } catch (error) {
    console.error("Metadata error:", error);
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500
    );
  }
});

// Track active connections for disconnection detection
const activeConnections = new Map();

// Encode endpoint
app.post("/encode", async (c) => {
  // Check if there's already an encoding job running
  if (activeJobs.size > 0) {
    console.log(
      `[RATE_LIMIT] Rejecting encode request - ${activeJobs.size} jobs already active`
    );
    c.header("Retry-After", "10");
    c.header("X-RateLimit-Limit", "1");
    c.header("X-RateLimit-Remaining", "0");
    return c.json(
      {
        success: false,
        error: "Encoding service is busy. Please retry in 10 seconds.",
        retryAfter: 10,
        activeJobs: activeJobs.size,
      },
      429
    );
  }

  const jobId = ++jobCounter;
  activeJobs.add(jobId);
  console.log(
    `[JOB_START] Started encoding job ${jobId}. Active jobs: ${activeJobs.size}`
  );

  // Track connection status for client disconnection detection
  const connectionInfo = {
    connected: true,
    aborted: false,
    controller: new AbortController(),
  };
  activeConnections.set(jobId, connectionInfo);

  try {
    const {
      audioUrl,
      uploadUrl,
      outputFormat = "mp3",
      bitrate = 128,
      channels,
      sampleRate,
      streaming = false,
    } = await c.req.json();

    if (!audioUrl) {
      return c.json(
        {
          success: false,
          error: "audioUrl is required",
        },
        400
      );
    }

    if (!uploadUrl) {
      return c.json(
        {
          success: false,
          error: "uploadUrl is required",
        },
        400
      );
    }

    console.log(
      `Encoding with direct upload: ${audioUrl} -> ${outputFormat} at ${bitrate}kbps`
    );

    if (streaming) {
      // Set headers for Server-Sent Events (SSE)
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      // For streaming, we need to return a Response with a ReadableStream
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();

      // Start encoding in the background
      encodeAndUpload(
        audioUrl,
        uploadUrl,
        outputFormat,
        bitrate,
        connectionInfo, // Pass connection info for disconnection detection
        channels,
        sampleRate
      )
        .then(async (result) => {
          if (connectionInfo.connected) {
            await writer.write(
              `data: ${JSON.stringify({ success: true, ...result })}\n\n`
            );
          }
          await writer.close();
        })
        .catch(async (error) => {
          if (connectionInfo.connected) {
            await writer.write(
              `data: ${JSON.stringify({
                success: false,
                error: error.message,
              })}\n\n`
            );
          }
          await writer.close();
        });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      const result = await encodeAndUpload(
        audioUrl,
        uploadUrl,
        outputFormat,
        bitrate,
        connectionInfo,
        channels,
        sampleRate
      );

      return c.json({
        success: true,
        ...result,
      });
    }
  } catch (error) {
    console.error("Encoding error:", error);

    // Check if this was due to client disconnection
    if (!connectionInfo.connected || connectionInfo.aborted) {
      console.log(
        `[JOB_${jobId}] Encoding aborted due to client disconnection`
      );
      return c.json(
        {
          success: false,
          error: "Client disconnected during encoding",
        },
        499 // Client Closed Request
      );
    }

    return c.json(
      {
        success: false,
        error: error.message,
      },
      500
    );
  } finally {
    // Clean up the job from active jobs tracking
    activeJobs.delete(jobId);
    activeConnections.delete(jobId);
    console.log(
      `[JOB_END] Completed encoding job ${jobId}. Active jobs: ${activeJobs.size}`
    );
  }
});

// Chunk endpoint
app.post("/chunk", async (c) => {
  // Check if there's already an encoding job running
  if (activeJobs.size > 0) {
    console.log(
      `[RATE_LIMIT] Rejecting chunk request - ${activeJobs.size} jobs already active`
    );
    c.header("Retry-After", "10");
    c.header("X-RateLimit-Limit", "1");
    c.header("X-RateLimit-Remaining", "0");
    return c.json(
      {
        success: false,
        error: "Encoding service is busy. Please retry in 10 seconds.",
        retryAfter: 10,
        activeJobs: activeJobs.size,
      },
      429
    );
  }

  const jobId = ++jobCounter;
  activeJobs.add(jobId);
  console.log(
    `[JOB_START] Started chunking job ${jobId}. Active jobs: ${activeJobs.size}`
  );

  // Track connection status for client disconnection detection
  const connectionInfo = {
    connected: true,
    aborted: false,
    controller: new AbortController(),
  };
  activeConnections.set(jobId, connectionInfo);

  try {
    const {
      audioUrl,
      chunkUploadUrls,
      chunkDuration = 60,
      overlapDuration = 2,
      streaming = false,
      duration, // Required: Pre-determined duration to avoid ffprobe call
    } = await c.req.json();

    if (!audioUrl) {
      return c.json(
        {
          success: false,
          error: "audioUrl is required",
        },
        400
      );
    }

    if (!duration || typeof duration !== "number" || duration <= 0) {
      return c.json(
        {
          success: false,
          error: "duration is required and must be a positive number",
        },
        400
      );
    }

    if (!chunkUploadUrls || !Array.isArray(chunkUploadUrls)) {
      return c.json(
        {
          success: false,
          error: "chunkUploadUrls array is required",
        },
        400
      );
    }

    console.log(
      `Chunking audio with pre-signed URLs: ${audioUrl} -> ${chunkUploadUrls.length} chunks`
    );

    if (streaming) {
      // Simplified for Hono - full SSE would need custom handling
      const result = await chunkAudioWithPresignedUrls(
        audioUrl,
        chunkUploadUrls,
        chunkDuration,
        overlapDuration,
        duration,
        connectionInfo
      );

      return c.json({
        success: true,
        ...result,
      });
    } else {
      const result = await chunkAudioWithPresignedUrls(
        audioUrl,
        chunkUploadUrls,
        chunkDuration,
        overlapDuration,
        duration,
        connectionInfo
      );

      return c.json({
        success: true,
        ...result,
      });
    }
  } catch (error) {
    console.error("Chunking error:", error);
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500
    );
  } finally {
    // Clean up the job from active jobs tracking
    activeJobs.delete(jobId);
    activeConnections.delete(jobId);
    console.log(
      `[JOB_END] Completed chunking job ${jobId}. Active jobs: ${activeJobs.size}`
    );
  }
});

// Cleanup endpoint
app.post("/cleanup", async (c) => {
  try {
    const { chunkIds } = await c.req.json();

    if (!chunkIds || !Array.isArray(chunkIds)) {
      return c.json(
        {
          success: false,
          error: "chunkIds array is required",
        },
        400
      );
    }

    const cleanupResults = [];

    for (const chunkId of chunkIds) {
      try {
        const extensions = ["mp3", "aac"];
        let cleaned = false;

        for (const ext of extensions) {
          const filePath = `/tmp/${chunkId}.${ext}`;
          try {
            await fs.unlink(filePath);
            cleaned = true;
            console.log(`Cleaned up chunk file: ${filePath}`);
          } catch (error) {
            // File doesn't exist or already cleaned up
          }
        }

        cleanupResults.push({
          chunkId,
          success: cleaned,
          message: cleaned ? "Cleaned up" : "File not found",
        });
      } catch (error) {
        cleanupResults.push({
          chunkId,
          success: false,
          error: error.message,
        });
      }
    }

    return c.json({
      success: true,
      results: cleanupResults,
    });
  } catch (error) {
    console.error("Cleanup error:", error);
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500
    );
  }
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: "Endpoint not found",
      availableEndpoints: [
        "GET / - Health check",
        "POST /metadata - Get audio metadata for chunk calculation",
        "POST /encode - Encode audio with signed URL upload",
        "POST /chunk - Chunk audio with pre-signed upload URLs",
        "POST /cleanup - Cleanup chunk files",
      ],
    },
    404
  );
});

// Helper function to get audio properties using fluent-ffmpeg
function getAudioProperties(inputUrl) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputUrl, (err, metadata) => {
      if (err) {
        console.error("FFprobe error:", err);
        reject(new Error(`Failed to get audio properties: ${err.message}`));
        return;
      }

      try {
        const audioStream = metadata.streams.find(
          (stream) => stream.codec_type === "audio"
        );

        if (!audioStream) {
          reject(new Error("No audio stream found"));
          return;
        }

        const channels = parseInt(audioStream.channels) || 2;
        const sampleRate = parseInt(audioStream.sample_rate) || 44100;
        const inputBitrate = parseInt(audioStream.bit_rate) || null;
        const duration = parseFloat(metadata.format.duration) || null;

        console.log(
          `Audio properties detected: ${channels} channels, ${sampleRate}Hz sample rate, duration: ${duration}s`
        );

        resolve({
          channels,
          sampleRate,
          inputBitrate,
          duration,
          isMono: channels === 1,
          isStereo: channels === 2,
        });
      } catch (parseError) {
        console.error("Failed to parse audio metadata:", parseError);
        reject(
          new Error(`Failed to parse audio properties: ${parseError.message}`)
        );
      }
    });
  });
}

// Helper function to encode and upload using signed URLs
function encodeAndUpload(
  inputUrl,
  uploadUrl,
  outputFormat = "mp3",
  bitrate = 128,
  connectionInfo = null,
  requestedChannels = null,
  requestedSampleRate = null
) {
  return new Promise(async (resolve, reject) => {
    try {
      // First, get audio properties to determine optimal bitrate and metadata
      const audioProps = await getAudioProperties(inputUrl);

      // Validate audio properties
      if (
        !audioProps.channels ||
        audioProps.channels < 1 ||
        audioProps.channels > 8
      ) {
        console.warn(
          `Invalid channel count detected: ${audioProps.channels}, defaulting to 2 (stereo)`
        );
        audioProps.channels = 2;
      }

      if (
        !audioProps.sampleRate ||
        audioProps.sampleRate < 8000 ||
        audioProps.sampleRate > 192000
      ) {
        console.warn(
          `Invalid sample rate detected: ${audioProps.sampleRate}, defaulting to 44100`
        );
        audioProps.sampleRate = 44100;
      }

      // Use requested parameters if provided, otherwise use calculated defaults
      const targetSampleRate =
        requestedSampleRate || (audioProps.sampleRate > 48000 ? 48000 : 44100);
      const targetChannels =
        requestedChannels || Math.min(Math.max(audioProps.channels, 1), 2); // Clamp to 1-2 channels

      // Adjust bitrate based on channel count if not explicitly overridden
      let adjustedBitrate = bitrate;
      if (outputFormat === "mp3") {
        // For MP3: 64k for mono, 128k for stereo (unless explicitly set)
        if (bitrate === 128) {
          // Only adjust if using default bitrate
          adjustedBitrate = audioProps.isMono ? 64 : 128;
        }
      } else if (outputFormat === "opus") {
        // Opus is efficient at low bitrates, especially for speech
        // For processing purposes, we can use very low bitrates
        if (targetChannels === 1) {
          // Mono: good quality for speech at 24-32k
          adjustedBitrate = Math.max(bitrate, 16); // Minimum 16k for Opus
        } else {
          // Stereo: 48-64k is usually sufficient
          adjustedBitrate = Math.max(bitrate, 32);
        }
      }

      const tempOutputFile = `/tmp/encode_${uuidv4()}.${outputFormat}`;

      console.log(
        `FFmpeg encoding: ${inputUrl} -> ${outputFormat} at ${adjustedBitrate}k`
      );
      console.log(
        `Target audio properties: ${targetChannels} channels @ ${targetSampleRate}Hz`
      );

      let command = ffmpeg(inputUrl).format(outputFormat);

      // Set audio codec and parameters based on output format
      if (outputFormat === "mp3") {
        command = command
          .audioCodec("libmp3lame")
          .audioChannels(targetChannels)
          .audioFrequency(targetSampleRate)
          .audioBitrate(adjustedBitrate)
          .outputOptions([
            `-ac ${targetChannels}`,
            `-ar ${targetSampleRate}`,
            `-b:a ${adjustedBitrate}k`,
          ]);
      } else if (outputFormat === "aac") {
        command = command
          .audioCodec("aac")
          .audioChannels(targetChannels)
          .audioFrequency(targetSampleRate)
          .audioBitrate(adjustedBitrate)
          .outputOptions([
            `-ac ${targetChannels}`,
            `-ar ${targetSampleRate}`,
            `-b:a ${adjustedBitrate}k`,
          ]);
      } else if (outputFormat === "opus") {
        command = command
          .audioCodec("libopus")
          .audioChannels(targetChannels)
          .audioFrequency(targetSampleRate)
          .audioBitrate(adjustedBitrate)
          .outputOptions([
            `-ac ${targetChannels}`,
            `-ar ${targetSampleRate}`,
            `-b:a ${adjustedBitrate}k`,
            "-vbr",
            "on", // Enable variable bitrate for better quality
            "-compression_level",
            "10", // Maximum compression efficiency
          ]);
      }

      // Progress tracking removed

      // Add debugging to see the actual FFmpeg command
      command.on("start", (commandLine) => {
        console.log("FFmpeg command:", commandLine);
      });

      // Set up keep-alive mechanism to prevent container timeout during long encoding
      const keepAliveInterval = setInterval(() => {
        console.log(
          `[KEEPALIVE] FFmpeg encoding in progress... (${new Date().toISOString()})`
        );
      }, 30000); // Send keep-alive every 30 seconds

      command
        .save(tempOutputFile)
        .on("end", async () => {
          clearInterval(keepAliveInterval); // Stop keep-alive when done

          // Check if encoding was aborted due to client disconnection
          if (connectionInfo && connectionInfo.aborted) {
            console.log(
              "Encoding completed but client already disconnected, skipping upload"
            );
            try {
              await fs.unlink(tempOutputFile);
            } catch (unlinkError) {
              // Ignore unlink errors
            }
            reject(new Error("Client disconnected during encoding"));
            return;
          }

          try {
            const stats = await fs.stat(tempOutputFile);
            const encodedData = await fs.readFile(tempOutputFile);

            // Upload to R2 using the pre-signed URL
            console.log(`Uploading to URL: ${uploadUrl.substring(0, 100)}...`);
            const contentType =
              outputFormat === "mp3"
                ? "audio/mpeg"
                : outputFormat === "aac"
                ? "audio/aac"
                : outputFormat === "opus"
                ? "audio/opus"
                : "audio/mpeg";
            console.log(`Content-Type: ${contentType}`);
            console.log(`Body size: ${encodedData.length} bytes`);

            const uploadResponse = await fetch(uploadUrl, {
              method: "PUT",
              body: encodedData,
              headers: {
                "Content-Type": contentType,
                // Don't set Content-Length - let fetch handle it automatically
              },
            });

            console.log(
              `Upload response status: ${uploadResponse.status} ${uploadResponse.statusText}`
            );

            // Clean up temp file
            await fs.unlink(tempOutputFile);

            if (!uploadResponse.ok) {
              const responseText = await uploadResponse.text();
              console.log(`Upload response body: ${responseText}`);
              throw new Error(
                `Failed to upload encoded file to R2: ${uploadResponse.status} ${uploadResponse.statusText} - ${responseText}`
              );
            }

            console.log(`Successfully uploaded encoded file to R2`);

            resolve({
              success: true,
              metadata: {
                format: outputFormat,
                bitrate: adjustedBitrate,
                size: stats.size,
                duration: audioProps.duration,
                channels: targetChannels,
                sampleRate: targetSampleRate,
                // Include original audio metadata
                originalChannels: audioProps.channels,
                originalSampleRate: audioProps.sampleRate,
                originalBitrate: audioProps.inputBitrate,
              },
            });
          } catch (error) {
            // Clean up temp file on error
            try {
              await fs.unlink(tempOutputFile);
            } catch (unlinkError) {
              // Ignore unlink errors
            }
            reject(new Error(`Failed to encode and upload: ${error.message}`));
          }
        })
        .on("error", (error) => {
          clearInterval(keepAliveInterval); // Stop keep-alive on error
          console.error("FFmpeg encoding error:", error);
          reject(new Error(`FFmpeg encoding failed: ${error.message}`));
        });
    } catch (error) {
      reject(new Error(`Failed to get audio properties: ${error.message}`));
    }
  });
}

// Helper function to chunk audio with pre-signed upload URLs
function chunkAudioWithPresignedUrls(
  inputUrl,
  chunkUploadUrls,
  chunkDuration = 60,
  overlapDuration = 2,
  duration,
  connectionInfo = null
) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`Using pre-determined audio duration: ${duration}s`);
      console.log(`Processing ${chunkUploadUrls.length} pre-defined chunks`);

      // Calculate chunks based on the provided upload URLs
      const chunks = [];
      let currentTime = 0;

      for (let i = 0; i < chunkUploadUrls.length; i++) {
        const uploadInfo = chunkUploadUrls[i];
        const endTime = Math.min(currentTime + chunkDuration, duration);

        chunks.push({
          index: uploadInfo.index,
          startTime: currentTime,
          endTime: endTime,
          duration: endTime - currentTime,
          r2Key: uploadInfo.r2Key, // Pass through for workflow to access later
          uploadUrl: uploadInfo.uploadUrl, // Container uses signed URL for upload
        });

        currentTime += chunkDuration - overlapDuration;

        // Stop if we've covered the entire duration
        if (currentTime >= duration) break;
      }

      console.log(`Processing ${chunks.length} chunks with signed URL upload`);

      // Process chunks in parallel (with reasonable concurrency limit)
      const concurrencyLimit = 3;
      const processedChunks = [];

      const processChunk = async (chunk) => {
        // Check if client is still connected before processing chunk
        if (
          connectionInfo &&
          (!connectionInfo.connected || connectionInfo.aborted)
        ) {
          throw new Error(
            `Client disconnected before processing chunk ${chunk.index}`
          );
        }

        console.log(
          `Processing chunk ${chunk.index}: ${chunk.startTime}s - ${chunk.endTime}s`
        );

        return new Promise((chunkResolve, chunkReject) => {
          // Use .ogg extension for Opus files (Opus is stored in OGG container)
          const tempOutputFile = `/tmp/chunk_${chunk.index}_${uuidv4()}.ogg`;

          const command = ffmpeg(inputUrl)
            .seekInput(chunk.startTime)
            .duration(chunk.duration)
            .outputOptions(["-c", "copy"]); // Use stream copy - no re-encoding

          command
            .save(tempOutputFile)
            .on("end", async () => {
              try {
                const stats = await fs.stat(tempOutputFile);
                const audioData = await fs.readFile(tempOutputFile);

                // Upload to R2 using the pre-signed URL
                const uploadResponse = await fetch(chunk.uploadUrl, {
                  method: "PUT",
                  body: audioData,
                  headers: {
                    "Content-Type": "audio/ogg", // Opus files are stored in OGG container
                    // Don't set Content-Length - let fetch handle it automatically
                  },
                });

                // Clean up temp file
                await fs.unlink(tempOutputFile);

                if (!uploadResponse.ok) {
                  throw new Error(
                    `Failed to upload chunk ${chunk.index} to R2: ${uploadResponse.status} ${uploadResponse.statusText}`
                  );
                }

                console.log(`Successfully uploaded chunk ${chunk.index} to R2`);

                chunkResolve({
                  ...chunk,
                  chunkId: `chunk_${chunk.index}`,
                  metadata: {
                    format: "opus", // Stream copied from input
                    size: stats.size,
                    // Note: bitrate, channels, sampleRate preserved from original
                  },
                });

                // Progress tracking removed
              } catch (error) {
                // Clean up temp file on error
                try {
                  await fs.unlink(tempOutputFile);
                } catch (unlinkError) {
                  // Ignore unlink errors
                }
                chunkReject(
                  new Error(
                    `Failed to process and upload chunk: ${error.message}`
                  )
                );
              }
            })
            .on("error", (error) => {
              console.error(`Chunk ${chunk.index} FFmpeg error:`, error);
              chunkReject(
                new Error(`Chunk processing failed: ${error.message}`)
              );
            });
        });
      };

      // Process chunks in batches
      for (let i = 0; i < chunks.length; i += concurrencyLimit) {
        const batch = chunks.slice(i, i + concurrencyLimit);
        const batchResults = await Promise.all(batch.map(processChunk));
        processedChunks.push(...batchResults);
      }

      // Sort by index to ensure correct order
      processedChunks.sort((a, b) => a.index - b.index);

      resolve({
        chunks: processedChunks,
        totalChunks: processedChunks.length,
        totalDuration: duration,
      });
    } catch (error) {
      console.error("Chunking with presigned URLs error:", error);
      reject(
        new Error(`Chunking with presigned URLs failed: ${error.message}`)
      );
    }
  });
}

// Start Hono server
console.log(`Encoding service container listening on port ${PORT}`);
console.log(`Instance ID: ${process.env.CLOUDFLARE_DEPLOYMENT_ID || "local"}`);

serve({
  fetch: app.fetch,
  port: PORT,
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});
