#!/usr/bin/env node

/**
 * Test script for transcription functionality
 *
 * This script demonstrates how to:
 * 1. Create a show
 * 2. Create an episode with an audio URL
 * 3. Request transcription
 * 4. Check the task status
 *
 * Usage: node examples/test-transcription.js
 */

const API_BASE = "http://localhost:8787";

// You'll need to set this JWT token with proper permissions
const JWT_TOKEN = process.env.JWT_TOKEN || "your-jwt-token-here";

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${JWT_TOKEN}`,
};

async function testTranscription() {
  try {
    console.log("🎙️ Testing Podcast Transcription API\n");

    // 1. Create a show
    console.log("1. Creating a test show...");
    const showResponse = await fetch(`${API_BASE}/shows`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Test Podcast",
        description: "A test podcast for transcription testing",
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
          title: "Test Episode",
          description: "A test episode for transcription",
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

    // 3. Request transcription
    console.log("3. Requesting transcription...");
    const transcribeResponse = await fetch(
      `${API_BASE}/shows/${show.id}/episodes/${episode.id}/transcribe`,
      {
        method: "POST",
        headers,
      }
    );

    if (!transcribeResponse.ok) {
      const errorText = await transcribeResponse.text();
      throw new Error(
        `Failed to request transcription: ${transcribeResponse.statusText} - ${errorText}`
      );
    }

    const transcriptionTask = await transcribeResponse.json();
    console.log(`✅ Transcription task created: ${transcriptionTask.taskId}`);
    console.log(`   Status: ${transcriptionTask.status}`);
    console.log(`   Message: ${transcriptionTask.message}\n`);

    // 4. Check task status
    console.log("4. Checking task status...");
    const taskResponse = await fetch(
      `${API_BASE}/tasks/${transcriptionTask.taskId}`,
      {
        headers,
      }
    );

    if (taskResponse.ok) {
      const task = await taskResponse.json();
      console.log(`📋 Task Status: ${task.status}`);
      console.log(`   Type: ${task.type}`);
      console.log(`   Attempts: ${task.attempts}`);

      if (task.result) {
        const result = JSON.parse(task.result);
        console.log(`   Transcript URL: ${result.transcriptUrl}`);
      }

      if (task.error) {
        console.log(`   Error: ${task.error}`);
      }
    }

    // 5. Check if episode was updated with transcript URL
    console.log("\n5. Checking episode for transcript URL...");
    const updatedEpisodeResponse = await fetch(
      `${API_BASE}/shows/${show.id}/episodes/${episode.id}`,
      {
        headers,
      }
    );

    if (updatedEpisodeResponse.ok) {
      const updatedEpisode = await updatedEpisodeResponse.json();
      if (updatedEpisode.transcriptUrl) {
        console.log(
          `✅ Episode updated with transcript URL: ${updatedEpisode.transcriptUrl}`
        );
      } else {
        console.log(
          "⏳ Transcript URL not yet available (task may still be processing)"
        );
      }
    }

    console.log("\n🎉 Transcription test completed!");
    console.log(
      "\nNote: The actual transcription may take a few moments to complete."
    );
    console.log(
      "You can check the task status endpoint or the episode endpoint periodically to see when it's done."
    );
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    process.exit(1);
  }
}

// Helper function to set up environment
function checkEnvironment() {
  if (!process.env.JWT_TOKEN) {
    console.log("⚠️  JWT_TOKEN environment variable not set.");
    console.log('   Set it with: export JWT_TOKEN="your-token-here"');
    console.log("   Or generate one with: npm run generate-token");
    console.log("");
  }
}

if (require.main === module) {
  checkEnvironment();
  testTranscription();
}

module.exports = { testTranscription };
