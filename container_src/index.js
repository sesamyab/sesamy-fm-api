const http = require("http");
const { spawn } = require("child_process");
const { promises: fs } = require("fs");
const { join } = require("path");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 8080;

// Helper function to get audio properties (channels, sample rate, etc.)
function getAudioProperties(inputUrl) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "quiet",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=channels,sample_rate,bit_rate,duration",
      "-of",
      "csv=p=0:s=,",
      inputUrl,
    ]);

    let output = "";
    ffprobe.stdout.on("data", (data) => {
      output += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        const parts = output.trim().split(",");
        if (parts.length >= 2) {
          const channels = parseInt(parts[0]) || 2;
          const sampleRate = parseInt(parts[1]) || 44100;
          const inputBitrate = parseInt(parts[2]) || null;
          const duration = parseFloat(parts[3]) || null;

          resolve({
            channels,
            sampleRate,
            inputBitrate,
            duration,
            isMono: channels === 1,
            isStereo: channels === 2,
          });
        } else {
          reject(new Error("Could not parse audio properties"));
        }
      } else {
        reject(new Error("Failed to get audio properties"));
      }
    });

    ffprobe.on("error", (error) => {
      reject(new Error(`FFprobe spawn error: ${error.message}`));
    });
  });
}

// Helper function to run FFmpeg commands with progress streaming
function runFFmpegWithProgress(
  inputUrl,
  outputFormat = "mp3",
  bitrate = 128,
  progressCallback
) {
  return new Promise(async (resolve, reject) => {
    try {
      // First, get audio properties to determine optimal bitrate
      const audioProps = await getAudioProperties(inputUrl);

      // Adjust bitrate based on channel count if not explicitly overridden
      let adjustedBitrate = bitrate;
      if (outputFormat === "mp3") {
        // For MP3: 64k for mono, 128k for stereo (unless explicitly set)
        if (bitrate === 128) {
          // Only adjust if using default bitrate
          adjustedBitrate = audioProps.isMono ? 64 : 128;
        }
      }

      const outputFile = `/tmp/output_${uuidv4()}.${outputFormat}`;

      // Determine FFmpeg parameters based on output format
      let codecArg, formatArg;
      if (outputFormat === "mp3") {
        codecArg = "libmp3lame";
        formatArg = "mp3";
      } else if (outputFormat === "aac") {
        codecArg = "aac";
        formatArg = "adts"; // Use ADTS format for AAC
      } else {
        codecArg = "libmp3lame"; // Default fallback
        formatArg = outputFormat;
      }

      const ffmpegArgs = [
        "-i",
        inputUrl,
        "-acodec",
        codecArg,
        "-b:a",
        `${adjustedBitrate}k`,
        "-ar",
        "44100", // Force 44.1kHz sample rate
        "-ac",
        audioProps.channels.toString(), // Preserve original channel count
        "-f",
        formatArg,
        "-progress",
        "pipe:1", // Enable progress output to stdout
        outputFile,
      ];

      console.log("Running FFmpeg with args:", ffmpegArgs);
      console.log(
        `Audio properties: ${audioProps.channels} channels, adjusting bitrate from ${bitrate}k to ${adjustedBitrate}k`
      );

      const ffmpeg = spawn("ffmpeg", ffmpegArgs);

      let stderr = "";
      let duration = audioProps.duration; // Use duration from audio properties

      // Parse FFmpeg progress output
      ffmpeg.stdout.on("data", (data) => {
        const progressData = data.toString();

        // Parse duration from the beginning if not already available
        if (!duration && progressData.includes("Duration:")) {
          const durationMatch = progressData.match(
            /Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/
          );
          if (durationMatch) {
            const hours = parseInt(durationMatch[1]);
            const minutes = parseInt(durationMatch[2]);
            const seconds = parseFloat(durationMatch[3]);
            duration = hours * 3600 + minutes * 60 + seconds;
            console.log(`Detected duration: ${duration}s`);
          }
        }

        // Parse current time and calculate progress
        if (duration && progressData.includes("out_time_ms=")) {
          const timeMatch = progressData.match(/out_time_ms=(\d+)/);
          if (timeMatch) {
            const currentTimeMs = parseInt(timeMatch[1]);
            const currentTimeS = currentTimeMs / 1000000; // Convert microseconds to seconds
            const progress = Math.min(
              Math.round((currentTimeS / duration) * 100),
              99
            );

            if (progressCallback && progress > 0) {
              progressCallback(progress);
            }
          }
        }
      });

      ffmpeg.stderr.on("data", (data) => {
        stderr += data.toString();
        const stderrStr = data.toString();

        // Parse duration from stderr if not found in stdout
        if (!duration && stderrStr.includes("Duration:")) {
          const durationMatch = stderrStr.match(
            /Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/
          );
          if (durationMatch) {
            const hours = parseInt(durationMatch[1]);
            const minutes = parseInt(durationMatch[2]);
            const seconds = parseFloat(durationMatch[3]);
            duration = hours * 3600 + minutes * 60 + seconds;
            console.log(`Detected duration from stderr: ${duration}s`);
            if (progressCallback) {
              progressCallback(5); // Initial progress
            }
          }
        }

        // Parse time progress from stderr
        if (duration && stderrStr.includes("time=")) {
          const timeMatch = stderrStr.match(
            /time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/
          );
          if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;
            const progress = Math.min(
              Math.round((currentTime / duration) * 100),
              99
            );

            if (progressCallback && progress > 0) {
              progressCallback(progress);
            }
          }
        }
      });

      ffmpeg.on("close", async (code) => {
        if (code === 0) {
          try {
            const stats = await fs.stat(outputFile);

            // Read the encoded file
            const encodedData = await fs.readFile(outputFile);

            // Clean up the output file
            await fs.unlink(outputFile);

            if (progressCallback) {
              progressCallback(100); // Final progress
            }

            resolve({
              success: true,
              encodedData: encodedData.toString("base64"), // Return as base64
              metadata: {
                format: outputFormat,
                bitrate: adjustedBitrate,
                size: stats.size,
                duration: duration,
                channels: audioProps.channels,
                sampleRate: audioProps.sampleRate,
                outputFile: outputFile,
              },
            });
          } catch (error) {
            reject(new Error(`Failed to read encoded file: ${error.message}`));
          }
        } else {
          reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on("error", (error) => {
        reject(new Error(`FFmpeg spawn error: ${error.message}`));
      });
    } catch (error) {
      reject(new Error(`Failed to get audio properties: ${error.message}`));
    }
  });
}

// Helper function to run FFmpeg commands (legacy, non-streaming)
function runFFmpeg(inputUrl, outputFormat = "mp3", bitrate = 128) {
  return runFFmpegWithProgress(inputUrl, outputFormat, bitrate, null);
}

// Helper function to chunk audio into segments with overlap
function chunkAudioWithOverlap(
  inputUrl,
  outputFormat = "mp3",
  bitrate = 32,
  chunkDuration = 30,
  overlapDuration = 2,
  progressCallback
) {
  return new Promise((resolve, reject) => {
    // First, get the duration of the input audio
    const ffprobe = spawn("ffprobe", [
      "-v",
      "quiet",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      inputUrl,
    ]);

    let duration = null;
    let ffprobeOutput = "";

    ffprobe.stdout.on("data", (data) => {
      ffprobeOutput += data.toString();
    });

    ffprobe.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error("Failed to get audio duration"));
        return;
      }

      duration = parseFloat(ffprobeOutput.trim());
      console.log(`Audio duration: ${duration}s`);

      if (duration <= chunkDuration) {
        // Audio is shorter than chunk size, process as single chunk
        try {
          // Process single chunk with URL-based approach
          const chunkId = `chunk_0_${uuidv4()}`;
          const outputFile = `/tmp/${chunkId}.${outputFormat}`;

          // Determine FFmpeg parameters based on output format
          let codecArg, formatArg;
          if (outputFormat === "mp3") {
            codecArg = "libmp3lame";
            formatArg = "mp3";
          } else if (outputFormat === "aac") {
            codecArg = "aac";
            formatArg = "adts"; // Use ADTS format for AAC
          } else {
            codecArg = "libmp3lame"; // Default fallback
            formatArg = outputFormat;
          }

          const ffmpegArgs = [
            "-i",
            inputUrl,
            "-acodec",
            codecArg,
            "-b:a",
            `${bitrate}k`,
            "-ac",
            "1", // Force mono for transcription
            "-ar",
            "16000", // Sample rate suitable for transcription
            "-f",
            formatArg,
            outputFile,
          ];

          await new Promise((singleResolve, singleReject) => {
            const ffmpeg = spawn("ffmpeg", ffmpegArgs);

            let stderr = "";

            // Track progress for single file
            ffmpeg.stderr.on("data", (data) => {
              stderr += data.toString();
              if (progressCallback && duration) {
                const stderrStr = data.toString();
                if (stderrStr.includes("time=")) {
                  const timeMatch = stderrStr.match(
                    /time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/
                  );
                  if (timeMatch) {
                    const hours = parseInt(timeMatch[1]);
                    const minutes = parseInt(timeMatch[2]);
                    const seconds = parseFloat(timeMatch[3]);
                    const currentTime = hours * 3600 + minutes * 60 + seconds;
                    const progress = Math.min(
                      Math.round((currentTime / duration) * 100),
                      99
                    );
                    if (progress > 0) {
                      progressCallback(progress);
                    }
                  }
                }
              }
            });

            ffmpeg.on("close", (code) => {
              if (code === 0) {
                if (progressCallback) progressCallback(100);
                singleResolve();
              } else {
                singleReject(
                  new Error(`FFmpeg failed with code ${code}: ${stderr}`)
                );
              }
            });

            ffmpeg.on("error", (error) => {
              singleReject(new Error(`FFmpeg spawn error: ${error.message}`));
            });
          });

          const stats = await fs.stat(outputFile);

          resolve({
            success: true,
            chunks: [
              {
                index: 0,
                startTime: 0,
                endTime: duration,
                duration: duration,
                chunkId: chunkId,
                url: `http://localhost:8080/chunks/${chunkId}.${outputFormat}`,
                metadata: {
                  format: outputFormat,
                  bitrate: bitrate,
                  size: stats.size,
                  channels: 1,
                  sampleRate: 16000,
                },
              },
            ],
            totalChunks: 1,
            totalDuration: duration,
          });
        } catch (error) {
          reject(error);
        }
        return;
      }

      // Calculate chunks
      const chunks = [];
      let startTime = 0;
      let chunkIndex = 0;

      while (startTime < duration) {
        const endTime = Math.min(startTime + chunkDuration, duration);
        chunks.push({
          index: chunkIndex,
          startTime: startTime,
          endTime: endTime,
          duration: endTime - startTime,
        });

        // Next chunk starts at current end minus overlap
        startTime = endTime - overlapDuration;

        // If the remaining time is less than overlap, include it in the last chunk
        if (startTime >= duration - overlapDuration) {
          break;
        }

        chunkIndex++;
      }

      console.log(
        `Creating ${chunks.length} chunks with ${chunkDuration}s duration and ${overlapDuration}s overlap`
      );

      // Process chunks in parallel (but limit concurrency to avoid overwhelming the system)
      const processChunk = async (chunk) => {
        const outputFile = `/tmp/chunk_${
          chunk.index
        }_${uuidv4()}.${outputFormat}`;

        // Determine FFmpeg parameters based on output format
        let codecArg, formatArg;
        if (outputFormat === "mp3") {
          codecArg = "libmp3lame";
          formatArg = "mp3";
        } else if (outputFormat === "aac") {
          codecArg = "aac";
          formatArg = "adts"; // Use ADTS format for AAC
        } else {
          codecArg = "libmp3lame"; // Default fallback
          formatArg = outputFormat;
        }

        const ffmpegArgs = [
          "-i",
          inputUrl,
          "-ss",
          chunk.startTime.toString(),
          "-t",
          chunk.duration.toString(),
          "-acodec",
          codecArg,
          "-b:a",
          `${bitrate}k`,
          "-ac",
          "1", // Force mono for transcription
          "-ar",
          "16000", // Sample rate suitable for transcription
          "-f",
          formatArg,
          outputFile,
        ];

        console.log(
          `Processing chunk ${chunk.index}: ${chunk.startTime}s - ${chunk.endTime}s`
        );

        return new Promise((chunkResolve, chunkReject) => {
          const ffmpeg = spawn("ffmpeg", ffmpegArgs);

          ffmpeg.on("close", async (code) => {
            if (code === 0) {
              try {
                const stats = await fs.stat(outputFile);

                // Generate unique chunk ID and keep file for serving
                const chunkId = `chunk_${chunk.index}_${uuidv4()}`;
                const serveableFile = `/tmp/${chunkId}.${outputFormat}`;

                // Move file to a serveable location with predictable name
                await fs.rename(outputFile, serveableFile);

                chunkResolve({
                  ...chunk,
                  chunkId: chunkId,
                  url: `http://localhost:8080/chunks/${chunkId}.${outputFormat}`,
                  metadata: {
                    format: outputFormat,
                    bitrate: bitrate,
                    size: stats.size,
                    channels: 1,
                    sampleRate: 16000,
                  },
                });

                // Update overall progress
                if (progressCallback) {
                  const overallProgress = Math.round(
                    ((chunk.index + 1) / chunks.length) * 100
                  );
                  progressCallback(overallProgress);
                }
              } catch (error) {
                chunkReject(
                  new Error(`Failed to process chunk file: ${error.message}`)
                );
              }
            } else {
              chunkReject(
                new Error(
                  `FFmpeg failed for chunk ${chunk.index} with code ${code}`
                )
              );
            }
          });

          ffmpeg.on("error", (error) => {
            chunkReject(
              new Error(
                `FFmpeg spawn error for chunk ${chunk.index}: ${error.message}`
              )
            );
          });
        });
      };

      try {
        // Process chunks with limited concurrency (3 at a time)
        const processedChunks = [];
        const concurrencyLimit = 3;

        for (let i = 0; i < chunks.length; i += concurrencyLimit) {
          const batch = chunks.slice(i, i + concurrencyLimit);
          const batchResults = await Promise.all(batch.map(processChunk));
          processedChunks.push(...batchResults);
        }

        // Sort by index to ensure correct order
        processedChunks.sort((a, b) => a.index - b.index);

        resolve({
          success: true,
          chunks: processedChunks,
          totalChunks: processedChunks.length,
          totalDuration: duration,
          chunkDuration: chunkDuration,
          overlapDuration: overlapDuration,
        });
      } catch (error) {
        reject(error);
      }
    });

    ffprobe.on("error", (error) => {
      reject(new Error(`FFprobe spawn error: ${error.message}`));
    });
  });
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  try {
    // Health check endpoint
    if (path === "/" || path === "/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status: "ok",
          service: "encoding-service-container",
          timestamp: new Date().toISOString(),
          instanceId: process.env.CLOUDFLARE_DEPLOYMENT_ID || "local",
          ffmpegVersion: "available",
        })
      );
      return;
    }

    // Test encoding endpoint
    if (path === "/test" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const requestData = body ? JSON.parse(body) : {};
          const outputFormat = requestData.outputFormat || "mp3";
          const bitrate = requestData.bitrate || 128;

          // Use a sample audio URL for testing
          const testAudioUrl =
            "https://www.soundjay.com/misc/sounds/bell-ringing-05.wav";

          console.log(`Test encoding: ${outputFormat} at ${bitrate}kbps`);

          const result = await runFFmpeg(testAudioUrl, outputFormat, bitrate);

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: true,
              ...result,
              testInfo: {
                inputUrl: testAudioUrl,
                outputFormat,
                bitrate,
                timestamp: new Date().toISOString(),
              },
            })
          );
        } catch (error) {
          console.error("Test encoding error:", error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              error: error.message,
            })
          );
        }
      });
      return;
    }

    // Encode endpoint with streaming progress
    if (path === "/encode" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const requestData = JSON.parse(body);
          const {
            audioUrl,
            outputFormat = "mp3",
            bitrate = 128,
            streaming = false,
          } = requestData;

          if (!audioUrl) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.end(
              JSON.stringify({
                success: false,
                error: "audioUrl is required",
              })
            );
            return;
          }

          console.log(
            `Encoding: ${audioUrl} -> ${outputFormat} at ${bitrate}kbps (streaming: ${streaming})`
          );

          if (streaming) {
            // Set headers for Server-Sent Events (SSE)
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Headers", "Cache-Control");

            // Send initial progress
            res.write(
              `data: ${JSON.stringify({
                type: "progress",
                progress: 0,
                message: "Starting encoding...",
              })}\n\n`
            );

            try {
              const result = await runFFmpegWithProgress(
                audioUrl,
                outputFormat,
                bitrate,
                (progress) => {
                  // Send progress updates via SSE
                  const progressData = {
                    type: "progress",
                    progress: progress,
                    message: `Encoding... ${progress}%`,
                  };
                  res.write(`data: ${JSON.stringify(progressData)}\n\n`);
                }
              );

              // Send final result
              const finalData = {
                type: "complete",
                progress: 100,
                success: true,
                ...result,
              };
              res.write(`data: ${JSON.stringify(finalData)}\n\n`);
              res.end();
            } catch (error) {
              console.error("Streaming encoding error:", error);
              const errorData = {
                type: "error",
                success: false,
                error: error.message,
              };
              res.write(`data: ${JSON.stringify(errorData)}\n\n`);
              res.end();
            }
          } else {
            // Non-streaming mode - ensure proper JSON response
            try {
              const result = await runFFmpeg(audioUrl, outputFormat, bitrate);

              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Access-Control-Allow-Origin", "*");
              const response = JSON.stringify({
                success: true,
                ...result,
              });
              res.end(response);
            } catch (error) {
              console.error("Non-streaming encoding error:", error);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Access-Control-Allow-Origin", "*");
              res.end(
                JSON.stringify({
                  success: false,
                  error: error.message,
                })
              );
            }
          }
        } catch (error) {
          console.error("Encoding error:", error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              error: error.message,
            })
          );
        }
      });
      return;
    }

    // Batch encode endpoint
    if (path === "/batch" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const requestData = JSON.parse(body);
          const { files, outputFormat = "mp3", bitrate = 128 } = requestData;

          if (!files || !Array.isArray(files)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                error: "files array is required",
              })
            );
            return;
          }

          console.log(`Batch encoding: ${files.length} files`);

          const results = await Promise.allSettled(
            files.map((audioUrl) => runFFmpeg(audioUrl, outputFormat, bitrate))
          );

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(
            JSON.stringify({
              success: true,
              results: results.map((result, index) => ({
                audioUrl: files[index],
                success: result.status === "fulfilled",
                ...(result.value || { error: result.reason?.message }),
              })),
            })
          );
        } catch (error) {
          console.error("Batch encoding error:", error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(
            JSON.stringify({
              success: false,
              error: error.message,
            })
          );
        }
      });
      return;
    }

    // Chunk audio endpoint for transcription preprocessing
    if (path === "/chunk" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const requestData = JSON.parse(body);
          const {
            audioUrl,
            outputFormat = "mp3",
            bitrate = 32,
            chunkDuration = 30,
            overlapDuration = 2,
            streaming = false,
          } = requestData;

          if (!audioUrl) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                error: "audioUrl is required",
              })
            );
            return;
          }

          console.log(
            `Chunking audio: ${audioUrl} -> ${chunkDuration}s chunks with ${overlapDuration}s overlap`
          );

          if (streaming) {
            // Set headers for Server-Sent Events (SSE)
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Headers", "Cache-Control");

            // Send initial progress
            res.write(
              `data: ${JSON.stringify({
                type: "progress",
                progress: 0,
                message: "Starting audio chunking...",
              })}\n\n`
            );

            try {
              const result = await chunkAudioWithOverlap(
                audioUrl,
                outputFormat,
                bitrate,
                chunkDuration,
                overlapDuration,
                (progress) => {
                  // Send progress updates via SSE
                  const progressData = {
                    type: "progress",
                    progress: progress,
                    message: `Processing chunks... ${progress}%`,
                  };
                  res.write(`data: ${JSON.stringify(progressData)}\n\n`);
                }
              );

              // Send final result
              const finalData = {
                type: "complete",
                progress: 100,
                success: true,
                ...result,
              };
              res.write(`data: ${JSON.stringify(finalData)}\n\n`);
              res.end();
            } catch (error) {
              console.error("Streaming chunking error:", error);
              const errorData = {
                type: "error",
                success: false,
                error: error.message,
              };
              res.write(`data: ${JSON.stringify(errorData)}\n\n`);
              res.end();
            }
          } else {
            // Non-streaming mode - ensure proper JSON response
            try {
              const result = await chunkAudioWithOverlap(
                audioUrl,
                outputFormat,
                bitrate,
                chunkDuration,
                overlapDuration,
                null // No progress callback for non-streaming
              );

              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Access-Control-Allow-Origin", "*");
              const response = JSON.stringify({
                success: true,
                ...result,
              });
              res.end(response);
            } catch (error) {
              console.error("Non-streaming chunking error:", error);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Access-Control-Allow-Origin", "*");
              res.end(
                JSON.stringify({
                  success: false,
                  error: error.message,
                })
              );
            }
          }
        } catch (error) {
          console.error("Chunking error:", error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              error: error.message,
            })
          );
        }
      });
      return;
    }

    // Serve individual chunk files
    if (path.startsWith("/chunks/") && req.method === "GET") {
      const fileName = path.substring("/chunks/".length);
      const filePath = `/tmp/${fileName}`;

      try {
        // Check if file exists
        await fs.access(filePath);

        // Determine content type
        const contentType = fileName.endsWith(".mp3")
          ? "audio/mpeg"
          : "audio/aac";

        // Stream the file
        const fileStream = require("fs").createReadStream(filePath);

        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=3600"); // Cache for 1 hour

        fileStream.pipe(res);

        fileStream.on("error", (error) => {
          console.error(`Error streaming chunk file ${fileName}:`, error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                error: "Failed to stream chunk file",
              })
            );
          }
        });
      } catch (error) {
        console.error(`Chunk file not found: ${fileName}`);
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(
          JSON.stringify({
            success: false,
            error: "Chunk file not found",
          })
        );
      }
      return;
    }

    // Cleanup chunk files endpoint
    if (path === "/cleanup" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const requestData = JSON.parse(body);
          const { chunkIds } = requestData;

          if (!chunkIds || !Array.isArray(chunkIds)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.end(
              JSON.stringify({
                success: false,
                error: "chunkIds array is required",
              })
            );
            return;
          }

          const cleanupResults = [];

          for (const chunkId of chunkIds) {
            try {
              // Try to clean up both mp3 and aac versions
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

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(
            JSON.stringify({
              success: true,
              results: cleanupResults,
            })
          );
        } catch (error) {
          console.error("Cleanup error:", error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(
            JSON.stringify({
              success: false,
              error: error.message,
            })
          );
        }
      });
      return;
    }

    // 404 for unknown endpoints
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: "Endpoint not found",
        availableEndpoints: [
          "GET / - Health check",
          "POST /test - Test encoding",
          "POST /encode - Encode audio",
          "POST /batch - Batch encode",
          "POST /chunk - Chunk audio for transcription",
          "GET /chunks/{filename} - Serve individual chunk files",
          "POST /cleanup - Cleanup chunk files",
        ],
      })
    );
  } catch (error) {
    console.error("Server error:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: "Internal server error",
      })
    );
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Encoding service container listening on port ${PORT}`);
  console.log(
    `Instance ID: ${process.env.CLOUDFLARE_DEPLOYMENT_ID || "local"}`
  );
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
