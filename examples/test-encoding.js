#!/usr/bin/env node

/**
 * Test script for audio encoding functionality
 *
 * This script demonstrates how to:
 * 1. Create a show
 * 2. Create an episode with an audio URL
 * 3. Request audio encoding
 * 4. Check the task status
 *
 * Usage: node examples/test-encoding.js
 */

const API_BASE = "http://localhost:8787";

// You'll need to set this JWT token with proper permissions
const JWT_TOKEN = process.env.JWT_TOKEN || "your-jwt-token-here";

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${JWT_TOKEN}`,
};

async function testEncoding() {
  try {
    console.log("🎵 Testing Podcast Audio Encoding API\n");

    // 1. Create a show
    console.log("1. Creating a test show...");
    const showResponse = await fetch(`${API_BASE}/shows`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Test Podcast for Encoding",
        description: "A test podcast for audio encoding testing",
      }),
    });

    if (!showResponse.ok) {
      throw new Error(`Failed to create show: ${showResponse.statusText}`);
    }

    const show = await showResponse.json();
    console.log(`✅ Show created: ${show.id}\n`);

    // 2. Create an episode with audio URL
    console.log("2. Creating an episode with audio...");
    const episodeResponse = await fetch(
      `${API_BASE}/shows/${show.id}/episodes`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: "Test Episode for Encoding",
          description: "An episode to test audio encoding",
          audioUrl: "https://www.soundjay.com/misc/sounds/bell-ringing-05.wav", // Sample audio file
        }),
      }
    );

    if (!episodeResponse.ok) {
      throw new Error(
        `Failed to create episode: ${episodeResponse.statusText}`
      );
    }

    const episode = await episodeResponse.json();
    console.log(`✅ Episode created: ${episode.id}\n`);

    // 3. Request audio encoding
    console.log("3. Creating encoding task...");
    const taskResponse = await fetch(`${API_BASE}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "encode",
        payload: {
          episodeId: episode.id,
          audioUrl: episode.audioUrl,
          outputFormat: "mp3",
          bitrate: 128,
        },
      }),
    });

    if (!taskResponse.ok) {
      throw new Error(`Failed to create task: ${taskResponse.statusText}`);
    }

    const task = await taskResponse.json();
    console.log(`✅ Encoding task created: ${task.id}\n`);

    // 4. Check task status periodically
    console.log("4. Monitoring encoding progress...");
    let attempts = 0;
    const maxAttempts = 30; // 5 minutes max

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds

      const statusResponse = await fetch(`${API_BASE}/tasks/${task.id}`, {
        headers,
      });

      if (!statusResponse.ok) {
        throw new Error(
          `Failed to check task status: ${statusResponse.statusText}`
        );
      }

      const taskStatus = await statusResponse.json();
      console.log(
        `📊 Task status: ${taskStatus.status} (attempt ${
          attempts + 1
        }/${maxAttempts})`
      );

      if (taskStatus.status === "done") {
        console.log("🎉 Encoding completed successfully!");
        console.log("📁 Result:", JSON.stringify(taskStatus.result, null, 2));

        // Fetch the updated episode
        const updatedEpisodeResponse = await fetch(
          `${API_BASE}/shows/${show.id}/episodes/${episode.id}`,
          { headers }
        );

        if (updatedEpisodeResponse.ok) {
          const updatedEpisode = await updatedEpisodeResponse.json();
          console.log("🎵 Updated episode audio URL:", updatedEpisode.audioUrl);
        }

        break;
      } else if (taskStatus.status === "failed") {
        console.error("❌ Encoding failed!");
        console.error("💥 Error:", taskStatus.error);
        break;
      }

      attempts++;
    }

    if (attempts >= maxAttempts) {
      console.warn("⏰ Timeout: Encoding is taking longer than expected");
    }

    console.log("\n🏁 Test completed");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    process.exit(1);
  }
}

// Additional helper function to test different encoding formats
async function testMultipleFormats() {
  console.log("🎵 Testing multiple encoding formats...\n");

  const formats = [
    { format: "mp3", bitrate: 128 },
    { format: "mp3", bitrate: 192 },
    { format: "aac", bitrate: 128 },
  ];

  for (const config of formats) {
    console.log(`Testing ${config.format} at ${config.bitrate}kbps...`);

    // Create task for each format
    const taskResponse = await fetch(`${API_BASE}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "encode",
        payload: {
          episodeId: "test-episode-id", // You'd need to replace with actual episode ID
          audioUrl: "https://www.soundjay.com/misc/sounds/bell-ringing-05.wav",
          outputFormat: config.format,
          bitrate: config.bitrate,
        },
      }),
    });

    if (taskResponse.ok) {
      const task = await taskResponse.json();
      console.log(
        `✅ ${config.format}/${config.bitrate}k task created: ${task.id}`
      );
    } else {
      console.error(
        `❌ Failed to create ${config.format}/${config.bitrate}k task`
      );
    }
  }
}

// Check if script is run directly
if (require.main === module) {
  testEncoding();
}

module.exports = { testEncoding, testMultipleFormats };
