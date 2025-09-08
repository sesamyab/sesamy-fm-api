const http = require("http");
const { spawn } = require("child_process");
const { promises: fs } = require("fs");
const { join } = require("path");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 8080;

// Helper function to run FFmpeg commands with progress streaming
function runFFmpegWithProgress(
  inputUrl,
  outputFormat = "mp3",
  bitrate = 128,
  progressCallback
) {
  return new Promise((resolve, reject) => {
    const outputFile = `/tmp/output_${uuidv4()}.${outputFormat}`;

    const ffmpegArgs = [
      "-i",
      inputUrl,
      "-acodec",
      outputFormat === "mp3" ? "libmp3lame" : "aac",
      "-b:a",
      `${bitrate}k`,
      "-f",
      outputFormat,
      "-progress",
      "pipe:1", // Enable progress output to stdout
      outputFile,
    ];

    console.log("Running FFmpeg with args:", ffmpegArgs);

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    let stderr = "";
    let duration = null;

    // Parse FFmpeg progress output
    ffmpeg.stdout.on("data", (data) => {
      const progressData = data.toString();

      // Parse duration from the beginning
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
              bitrate: bitrate,
              size: stats.size,
              duration: duration,
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
  });
}

// Helper function to run FFmpeg commands (legacy, non-streaming)
function runFFmpeg(inputUrl, outputFormat = "mp3", bitrate = 128) {
  return runFFmpegWithProgress(inputUrl, outputFormat, bitrate, null);
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
            res.setHeader("Content-Type", "text/plain");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");

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
            // Non-streaming mode (legacy)
            const result = await runFFmpeg(audioUrl, outputFormat, bitrate);

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: true,
                ...result,
              })
            );
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
