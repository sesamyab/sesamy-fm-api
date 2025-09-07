const http = require("http");
const { spawn } = require("child_process");
const { promises: fs } = require("fs");
const { join } = require("path");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 8080;

// Helper function to run FFmpeg commands
function runFFmpeg(inputUrl, outputFormat = "mp3", bitrate = 128) {
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
      outputFile,
    ];

    console.log("Running FFmpeg with args:", ffmpegArgs);

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", async (code) => {
      if (code === 0) {
        try {
          const stats = await fs.stat(outputFile);

          // Read the encoded file
          const encodedData = await fs.readFile(outputFile);

          // Clean up the output file
          await fs.unlink(outputFile);

          resolve({
            success: true,
            encodedData: encodedData.toString("base64"), // Return as base64
            metadata: {
              format: outputFormat,
              bitrate: bitrate,
              size: stats.size,
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

    // Encode endpoint
    if (path === "/encode" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const requestData = JSON.parse(body);
          const { audioUrl, outputFormat = "mp3", bitrate = 128 } = requestData;

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
            `Encoding: ${audioUrl} -> ${outputFormat} at ${bitrate}kbps`
          );

          const result = await runFFmpeg(audioUrl, outputFormat, bitrate);

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: true,
              ...result,
            })
          );
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
