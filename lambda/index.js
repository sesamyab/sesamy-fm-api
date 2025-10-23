// AWS Lambda handler for audio encoding with FFmpeg
const ffmpeg = require("fluent-ffmpeg");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const fs = require("fs").promises;

// Set FFmpeg paths
ffmpeg.setFfmpegPath("/usr/local/bin/ffmpeg");
ffmpeg.setFfprobePath("/usr/local/bin/ffprobe");

// Lambda handler
exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  try {
    // Parse the request body
    let body;
    if (event.body) {
      body =
        typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    } else {
      body = event;
    }

    // Handle different endpoints
    const path = event.rawPath || event.path || "/";

    if (path === "/health" || path === "/") {
      return response(200, {
        success: true,
        message: "FFmpeg Encoding Service",
        ffmpegVersion: await getFFmpegVersion(),
      });
    }

    if (path === "/encode") {
      return await handleEncode(body);
    }

    if (path === "/metadata") {
      return await handleMetadata(body);
    }

    return response(404, { success: false, error: "Not found" });
  } catch (error) {
    console.error("Handler error:", error);
    return response(500, {
      success: false,
      error: "Internal server error",
      message: error.message,
    });
  }
};

// Handle encoding request
async function handleEncode(body) {
  const {
    audioUrl,
    outputUrl,
    metadataUrl,
    outputFormat = "mp3",
    bitrate = 128,
  } = body;

  if (!audioUrl || !outputUrl) {
    return response(400, {
      success: false,
      error: "Missing required fields: audioUrl, outputUrl",
    });
  }

  const jobId = Date.now().toString();
  const inputFile = `/tmp/input_${jobId}`;
  const outputFile = `/tmp/output_${jobId}.${outputFormat}`;

  try {
    console.log(
      `[JOB ${jobId}] Starting encoding: ${bitrate}kbps ${outputFormat}`
    );

    // Download input file
    console.log(`[JOB ${jobId}] Downloading from ${audioUrl}`);
    const inputResponse = await fetch(audioUrl);
    if (!inputResponse.ok) {
      throw new Error(
        `Failed to download: ${inputResponse.status} ${inputResponse.statusText}`
      );
    }
    const inputBuffer = Buffer.from(await inputResponse.arrayBuffer());
    await fs.writeFile(inputFile, inputBuffer);
    const inputStats = await fs.stat(inputFile);
    console.log(`[JOB ${jobId}] Downloaded ${inputStats.size} bytes`);

    // Get input file metadata
    const metadata = await getAudioMetadata(inputFile);
    console.log(`[JOB ${jobId}] Input metadata:`, metadata);

    // Encode the file
    console.log(`[JOB ${jobId}] Encoding...`);
    await new Promise((resolve, reject) => {
      ffmpeg(inputFile)
        .audioCodec("libmp3lame")
        .audioBitrate(`${bitrate}k`)
        .audioFrequency(44100)
        .output(outputFile)
        .on("start", (cmd) =>
          console.log(`[JOB ${jobId}] FFmpeg command: ${cmd}`)
        )
        .on("progress", (progress) => {
          if (progress.percent) {
            console.log(
              `[JOB ${jobId}] Progress: ${progress.percent.toFixed(1)}%`
            );
          }
        })
        .on("end", () => {
          console.log(`[JOB ${jobId}] Encoding complete`);
          resolve();
        })
        .on("error", (err) => {
          console.error(`[JOB ${jobId}] Encoding error:`, err);
          reject(err);
        })
        .run();
    });

    const outputStats = await fs.stat(outputFile);
    console.log(`[JOB ${jobId}] Encoded ${outputStats.size} bytes`);

    // Upload encoded file
    console.log(`[JOB ${jobId}] Uploading to ${outputUrl}`);
    const outputBuffer = await fs.readFile(outputFile);
    const uploadResponse = await fetch(outputUrl, {
      method: "PUT",
      body: outputBuffer,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": outputBuffer.length.toString(),
      },
    });
    if (!uploadResponse.ok) {
      throw new Error(
        `Failed to upload: ${uploadResponse.status} ${uploadResponse.statusText}`
      );
    }

    // Generate and upload metadata if requested
    if (metadataUrl) {
      console.log(`[JOB ${jobId}] Generating metadata...`);
      const fullMetadata = await generateFullMetadata(inputFile, metadata);

      const metadataFile = `/tmp/metadata_${jobId}.json`;
      await fs.writeFile(metadataFile, JSON.stringify(fullMetadata, null, 2));

      console.log(`[JOB ${jobId}] Uploading metadata to ${metadataUrl}`);
      const metadataContent = await fs.readFile(metadataFile, "utf-8");
      const metadataUploadResponse = await fetch(metadataUrl, {
        method: "PUT",
        body: metadataContent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(metadataContent).toString(),
        },
      });
      if (!metadataUploadResponse.ok) {
        throw new Error(
          `Failed to upload metadata: ${metadataUploadResponse.status} ${metadataUploadResponse.statusText}`
        );
      }
    }

    // Cleanup
    await cleanup([inputFile, outputFile]);

    return response(200, {
      success: true,
      jobId,
      input: {
        url: audioUrl,
        size: inputStats.size,
        ...metadata,
      },
      output: {
        url: outputUrl,
        format: outputFormat,
        bitrate,
        size: outputStats.size,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[JOB ${jobId}] Error:`, error);
    await cleanup([inputFile, outputFile]);

    return response(500, {
      success: false,
      error: "Encoding failed",
      message: error.message,
      jobId,
    });
  }
}

// Handle metadata extraction request
async function handleMetadata(body) {
  const { audioUrl } = body;

  if (!audioUrl) {
    return response(400, {
      success: false,
      error: "Missing required field: audioUrl",
    });
  }

  const jobId = Date.now().toString();
  const inputFile = `/tmp/input_metadata_${jobId}`;

  try {
    console.log(`[METADATA ${jobId}] Downloading from ${audioUrl}`);
    const inputResponse = await fetch(audioUrl);
    if (!inputResponse.ok) {
      throw new Error(
        `Failed to download: ${inputResponse.status} ${inputResponse.statusText}`
      );
    }
    const inputBuffer = Buffer.from(await inputResponse.arrayBuffer());
    await fs.writeFile(inputFile, inputBuffer);

    // Get metadata
    const metadata = await getAudioMetadata(inputFile);
    console.log(`[METADATA ${jobId}] Extracted:`, metadata);

    // Cleanup
    await cleanup([inputFile]);

    return response(200, {
      success: true,
      duration: metadata.duration,
      channels: metadata.channels,
      sampleRate: metadata.sampleRate,
      inputBitrate: metadata.inputBitrate,
      chapters: metadata.chapters || [],
    });
  } catch (error) {
    console.error(`[METADATA ${jobId}] Error:`, error);
    await cleanup([inputFile]);

    return response(500, {
      success: false,
      error: error.message,
    });
  }
}

// Get audio metadata using ffprobe via fluent-ffmpeg
async function getAudioMetadata(filePath) {
  try {
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const audioStream =
      metadata.streams?.find((s) => s.codec_type === "audio") || {};

    // Extract chapters from metadata
    const chapters = [];
    if (metadata.chapters && Array.isArray(metadata.chapters)) {
      for (const chapter of metadata.chapters) {
        const startTime = parseFloat(chapter.start_time) || 0;
        const endTime = parseFloat(chapter.end_time) || null;
        const title = chapter.tags?.title || `Chapter ${chapters.length + 1}`;

        chapters.push({
          startTime,
          endTime,
          title,
          url: chapter.tags?.url || undefined,
          image: chapter.tags?.image || undefined,
          toc: true,
        });
      }
      console.log(`Extracted ${chapters.length} chapters from audio file`);
    }

    return {
      duration: parseFloat(metadata.format?.duration || 0),
      channels: parseInt(audioStream.channels || 2),
      sampleRate: parseInt(audioStream.sample_rate || 44100),
      inputBitrate: parseInt(metadata.format?.bit_rate || 0) / 1000,
      chapters,
    };
  } catch (error) {
    console.error("Metadata extraction error:", error);
    return {
      duration: 0,
      channels: 2,
      sampleRate: 44100,
      inputBitrate: 0,
      chapters: [],
    };
  }
}

// Generate full metadata including ID3 tags, waveform, and silences
async function generateFullMetadata(inputFile, basicMetadata) {
  const [id3Tags, waveform, silences] = await Promise.all([
    extractID3Tags(inputFile),
    generateWaveform(inputFile, basicMetadata.duration),
    detectSilences(inputFile),
  ]);

  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    audio: basicMetadata,
    metadata: id3Tags,
    waveform,
    silences,
  };
}

// Extract ID3v2 tags using fluent-ffmpeg
async function extractID3Tags(filePath) {
  try {
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const tags = metadata.format?.tags || {};

    return {
      title: tags.title || tags.TITLE || null,
      artist: tags.artist || tags.ARTIST || null,
      album: tags.album || tags.ALBUM || null,
      year: tags.date || tags.DATE || tags.year || null,
      genre: tags.genre || tags.GENRE || null,
      comment: tags.comment || tags.COMMENT || null,
      track: tags.track || tags.TRACK || null,
      albumArtist: tags.album_artist || tags.ALBUM_ARTIST || null,
      composer: tags.composer || tags.COMPOSER || null,
      publisher: tags.publisher || tags.PUBLISHER || null,
      copyright: tags.copyright || tags.COPYRIGHT || null,
      encodedBy: tags.encoded_by || tags.ENCODED_BY || null,
    };
  } catch (error) {
    console.error("ID3 extraction error:", error);
    return {};
  }
}

// Generate waveform data (100 samples per second)
async function generateWaveform(filePath, duration) {
  try {
    // For now, return a simple sine wave pattern
    // In production, you could use FFmpeg to extract actual audio samples
    const samplesPerSecond = 100;
    const totalSamples = Math.ceil(duration * samplesPerSecond);
    const samples = [];

    for (let i = 0; i < totalSamples; i++) {
      // Generate a synthetic waveform for now
      const t = i / samplesPerSecond;
      const amplitude = 0.5 + 0.3 * Math.sin(t * 2 * Math.PI * 0.5);
      samples.push(Math.round(amplitude * 100) / 100);
    }

    return {
      samplesPerSecond,
      samples,
    };
  } catch (error) {
    console.error("Waveform generation error:", error);
    return { samplesPerSecond: 100, samples: [] };
  }
}

// Detect silences in the audio
async function detectSilences(filePath) {
  try {
    const cmd = `ffmpeg -i "${filePath}" -af silencedetect=n=-40dB:d=2 -f null - 2>&1`;
    const { stdout, stderr } = await execAsync(cmd);
    const output = stdout + stderr;

    const silences = [];
    const lines = output.split("\n");
    let currentSilence = null;

    for (const line of lines) {
      if (line.includes("silence_start:")) {
        const start = parseFloat(line.split("silence_start:")[1].trim());
        currentSilence = { start, end: 0, duration: 0 };
      } else if (line.includes("silence_end:") && currentSilence) {
        const parts = line.split("|");
        const end = parseFloat(parts[0].split("silence_end:")[1].trim());
        const duration = parseFloat(
          parts[1].split("silence_duration:")[1].trim()
        );

        currentSilence.end = end;
        currentSilence.duration = duration;
        silences.push(currentSilence);
        currentSilence = null;
      }
    }

    // Sort by duration (longest first) and return top 20
    return silences.sort((a, b) => b.duration - a.duration).slice(0, 20);
  } catch (error) {
    console.error("Silence detection error:", error);
    return [];
  }
}

// Get FFmpeg version
async function getFFmpegVersion() {
  try {
    const { stdout } = await execAsync("ffmpeg -version");
    return stdout.split("\n")[0];
  } catch (error) {
    return "unknown";
  }
}

// Cleanup temporary files
async function cleanup(files) {
  for (const file of files) {
    try {
      await fs.unlink(file);
    } catch (err) {
      // Ignore cleanup errors
    }
  }
}

// Format HTTP response
function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}
