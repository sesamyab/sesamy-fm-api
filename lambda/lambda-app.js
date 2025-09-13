// Extracted Hono app logic for use in both container and Lambda
const { promises: fs } = require("fs");
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("fluent-ffmpeg");
const { Hono } = require("hono");

// Set FFmpeg path for Lambda environment
if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  ffmpeg.setFfmpegPath("/usr/local/bin/ffmpeg");
  ffmpeg.setFfprobePath("/usr/local/bin/ffprobe");
}

const PORT = process.env.PORT || 8080;

// Track active encoding jobs
let activeJobs = new Set();
let jobCounter = 0;

function createEncodingApp() {
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
      service: "encoding-service-lambda",
      timestamp: new Date().toISOString(),
      instanceId:
        process.env.AWS_LAMBDA_FUNCTION_NAME ||
        process.env.CLOUDFLARE_DEPLOYMENT_ID ||
        "local",
      ffmpegVersion: "available",
      environment: process.env.AWS_LAMBDA_FUNCTION_NAME
        ? "lambda"
        : "container",
    });
  });

  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      service: "encoding-service-lambda",
      timestamp: new Date().toISOString(),
      instanceId:
        process.env.AWS_LAMBDA_FUNCTION_NAME ||
        process.env.CLOUDFLARE_DEPLOYMENT_ID ||
        "local",
      ffmpegVersion: "available",
      activeJobs: activeJobs.size,
      jobsInProgress: Array.from(activeJobs),
      environment: process.env.AWS_LAMBDA_FUNCTION_NAME
        ? "lambda"
        : "container",
    });
  });

  // Warmup endpoint to keep Lambda warm
  app.post("/warmup", (c) => {
    console.log(`[WARMUP] Lambda warmed up at ${new Date().toISOString()}`);
    return c.json({
      status: "warmed",
      service: "encoding-service-lambda",
      timestamp: new Date().toISOString(),
      message: "Lambda is ready for encoding tasks",
      environment: process.env.AWS_LAMBDA_FUNCTION_NAME
        ? "lambda"
        : "container",
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

  // Test encoding endpoint
  app.post("/test", async (c) => {
    const jobId = `test-${uuidv4()}`;
    console.log(`[JOB ${jobId}] Starting test encoding job`);
    activeJobs.add(jobId);
    jobCounter++;

    try {
      const { outputFormat = "mp3", bitrate = 128 } = await c.req.json();

      console.log(
        `[JOB ${jobId}] Test encoding with format: ${outputFormat}, bitrate: ${bitrate}`
      );

      // Generate a 1-second sine wave test audio
      const inputPath = `/tmp/test-input-${jobId}.wav`;
      const outputPath = `/tmp/test-output-${jobId}.${outputFormat}`;

      // Create test input
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input("anullsrc=channel_layout=stereo:sample_rate=48000")
          .inputFormat("lavfi")
          .audioCodec("pcm_s16le")
          .duration(1)
          .output(inputPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      // Encode the test file
      await new Promise((resolve, reject) => {
        const command = ffmpeg(inputPath);

        if (outputFormat === "mp3") {
          command.audioCodec("libmp3lame").audioBitrate(bitrate);
        } else if (outputFormat === "aac") {
          command.audioCodec("aac").audioBitrate(bitrate);
        }

        command.output(outputPath).on("end", resolve).on("error", reject).run();
      });

      // Get output file stats
      const stats = await fs.stat(outputPath);

      // Clean up
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});

      return c.json({
        success: true,
        message: "Test encoding completed successfully",
        jobId,
        outputFormat,
        bitrate,
        outputSize: stats.size,
        duration: "1 second",
        timestamp: new Date().toISOString(),
        environment: process.env.AWS_LAMBDA_FUNCTION_NAME
          ? "lambda"
          : "container",
      });
    } catch (error) {
      console.error(`[JOB ${jobId}] Test encoding failed:`, error);
      return c.json(
        {
          success: false,
          error: error.message,
          jobId,
          timestamp: new Date().toISOString(),
        },
        500
      );
    } finally {
      activeJobs.delete(jobId);
    }
  });

  // Main encoding endpoint
  app.post("/encode", async (c) => {
    const jobId = `encode-${uuidv4()}`;
    console.log(`[JOB ${jobId}] Starting encoding job`);
    activeJobs.add(jobId);
    jobCounter++;

    try {
      const {
        audioUrl,
        outputUrl,
        outputFormat = "mp3",
        bitrate = 128,
        r2AccessKeyId,
        r2SecretAccessKey,
        storageEndpoint,
      } = await c.req.json();

      if (!audioUrl || !outputUrl) {
        return c.json(
          {
            success: false,
            error: "audioUrl and outputUrl are required",
            jobId,
          },
          400
        );
      }

      console.log(
        `[JOB ${jobId}] Encoding: ${audioUrl} -> ${outputUrl} (${outputFormat}@${bitrate}kbps)`
      );

      const inputPath = `/tmp/input-${jobId}`;
      const outputPath = `/tmp/output-${jobId}.${outputFormat}`;

      // Download input file
      console.log(`[JOB ${jobId}] Downloading input file...`);
      const inputResponse = await fetch(audioUrl);
      if (!inputResponse.ok) {
        throw new Error(
          `Failed to download input: ${inputResponse.statusText}`
        );
      }
      const inputBuffer = Buffer.from(await inputResponse.arrayBuffer());
      await fs.writeFile(inputPath, inputBuffer);

      // Get input properties
      const audioProps = await getAudioProperties(inputPath);
      console.log(`[JOB ${jobId}] Input properties:`, audioProps);

      // Encode the file
      console.log(`[JOB ${jobId}] Starting FFmpeg encoding...`);
      await new Promise((resolve, reject) => {
        const command = ffmpeg(inputPath);

        if (outputFormat === "mp3") {
          command.audioCodec("libmp3lame").audioBitrate(bitrate);
        } else if (outputFormat === "aac") {
          command.audioCodec("aac").audioBitrate(bitrate);
        }

        command
          .output(outputPath)
          .on("progress", (progress) => {
            console.log(
              `[JOB ${jobId}] Progress: ${Math.round(progress.percent || 0)}%`
            );
          })
          .on("end", () => {
            console.log(`[JOB ${jobId}] FFmpeg encoding completed`);
            resolve();
          })
          .on("error", (err) => {
            console.error(`[JOB ${jobId}] FFmpeg error:`, err);
            reject(err);
          })
          .run();
      });

      // Upload output file
      console.log(`[JOB ${jobId}] Uploading output file...`);
      const outputBuffer = await fs.readFile(outputPath);

      const uploadResponse = await fetch(outputUrl, {
        method: "PUT",
        body: outputBuffer,
        headers: {
          "Content-Type": getContentType(outputFormat),
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(
          `Failed to upload output: ${uploadResponse.statusText}`
        );
      }

      // Get output properties
      const outputStats = await fs.stat(outputPath);

      // Clean up
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});

      console.log(`[JOB ${jobId}] Encoding completed successfully`);

      return c.json({
        success: true,
        message: "Encoding completed successfully",
        jobId,
        input: {
          url: audioUrl,
          duration: audioProps.duration,
          channels: audioProps.channels,
          sampleRate: audioProps.sampleRate,
          inputBitrate: audioProps.inputBitrate,
        },
        output: {
          url: outputUrl,
          format: outputFormat,
          bitrate,
          size: outputStats.size,
        },
        timestamp: new Date().toISOString(),
        environment: process.env.AWS_LAMBDA_FUNCTION_NAME
          ? "lambda"
          : "container",
      });
    } catch (error) {
      console.error(`[JOB ${jobId}] Encoding failed:`, error);
      return c.json(
        {
          success: false,
          error: error.message,
          jobId,
          timestamp: new Date().toISOString(),
        },
        500
      );
    } finally {
      activeJobs.delete(jobId);
    }
  });

  return app;
}

// Helper functions (same as in original container)
function getAudioProperties(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to get audio properties: ${err.message}`));
        return;
      }

      const audioStream = metadata.streams?.find(
        (stream) => stream.codec_type === "audio"
      );

      if (!audioStream) {
        reject(new Error("No audio stream found"));
        return;
      }

      const duration = parseFloat(metadata.format?.duration || "0");
      const channels = audioStream.channels || 0;
      const sampleRate = audioStream.sample_rate || 0;
      const inputBitrate = parseInt(audioStream.bit_rate || "0", 10);

      resolve({
        duration,
        channels,
        sampleRate,
        inputBitrate,
      });
    });
  });
}

function getContentType(format) {
  const contentTypes = {
    mp3: "audio/mpeg",
    aac: "audio/aac",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
  };
  return contentTypes[format] || "audio/mpeg";
}

module.exports = { createEncodingApp };
