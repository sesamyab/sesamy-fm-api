#!/usr/bin/env node

/**
 * Test script for the test-encode endpoint
 *
 * This script demonstrates how to use the test-encode endpoint to validate
 * FFmpeg encoding functionality.
 *
 * Usage: node examples/test-encode-endpoint.js
 */

const API_BASE = "http://localhost:8787";

// JWT token only needed for monitoring task progress (not for creating test tasks)
const JWT_TOKEN = process.env.JWT_TOKEN || "your-jwt-token-here";

const headers = {
  "Content-Type": "application/json",
};

const authHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${JWT_TOKEN}`,
};

async function testEncodeEndpoint() {
  try {
    console.log("🔧 Testing FFmpeg Encoding Endpoint\n");

    // Test with default audio file
    console.log("1. Testing with default audio file...");
    const defaultTestResponse = await fetch(`${API_BASE}/tasks/test-encode`, {
      method: "POST",
      headers, // No authentication needed
      body: JSON.stringify({}), // Use defaults
    });

    if (!defaultTestResponse.ok) {
      throw new Error(
        `Failed to create test task: ${defaultTestResponse.statusText}`
      );
    }

    const defaultTest = await defaultTestResponse.json();
    console.log(`✅ Default test task created: ${defaultTest.task.id}`);
    console.log(`📊 Test info:`, defaultTest.testInfo);
    console.log();

    // Test with custom parameters
    console.log("2. Testing with custom parameters...");
    const customTestResponse = await fetch(`${API_BASE}/tasks/test-encode`, {
      method: "POST",
      headers, // No authentication needed
      body: JSON.stringify({
        outputFormat: "aac",
        bitrate: 192,
      }),
    });

    if (!customTestResponse.ok) {
      throw new Error(
        `Failed to create custom test: ${customTestResponse.statusText}`
      );
    }

    const customTest = await customTestResponse.json();
    console.log(`✅ Custom test task created: ${customTest.task.id}`);
    console.log(`📊 Test info:`, customTest.testInfo);
    console.log();

    // Monitor the first task
    console.log("3. Monitoring default test task progress...");
    await monitorTask(defaultTest.task.id);

    // Monitor the second task
    console.log("\n4. Monitoring custom test task progress...");
    await monitorTask(customTest.task.id);

    console.log("\n🏁 All tests completed!");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    process.exit(1);
  }
}

async function monitorTask(taskId) {
  let attempts = 0;
  const maxAttempts = 30; // 5 minutes max

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds

    try {
      const statusResponse = await fetch(`${API_BASE}/tasks/${taskId}`, {
        headers: authHeaders, // Authentication required for monitoring
      });

      if (!statusResponse.ok) {
        throw new Error(
          `Failed to check task status: ${statusResponse.statusText}`
        );
      }

      const taskStatus = await statusResponse.json();
      console.log(
        `📊 Task ${taskId} status: ${taskStatus.status} (attempt ${
          attempts + 1
        }/${maxAttempts})`
      );

      if (taskStatus.status === "done") {
        console.log("🎉 Encoding completed successfully!");
        console.log("📁 Result:", JSON.stringify(taskStatus.result, null, 2));

        if (taskStatus.result && taskStatus.result.encodedUrl) {
          console.log(`🎵 Encoded audio URL: ${taskStatus.result.encodedUrl}`);
          console.log(`📦 File size: ${formatBytes(taskStatus.result.size)}`);
          console.log(`🎛️ Format: ${taskStatus.result.format}`);
          console.log(`🔊 Bitrate: ${taskStatus.result.bitrate}kbps`);
        }

        return taskStatus;
      } else if (taskStatus.status === "failed") {
        console.error("❌ Encoding failed!");
        console.error("💥 Error:", taskStatus.error);
        throw new Error(`Task ${taskId} failed: ${taskStatus.error}`);
      }

      attempts++;
    } catch (error) {
      console.error(`⚠️ Error checking task ${taskId}:`, error.message);
      attempts++;
    }
  }

  if (attempts >= maxAttempts) {
    throw new Error(
      `⏰ Timeout: Task ${taskId} is taking longer than expected`
    );
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Test different encoding scenarios
async function testMultipleScenarios() {
  console.log("🎵 Testing multiple encoding scenarios...\n");

  const scenarios = [
    { name: "High Quality MP3", outputFormat: "mp3", bitrate: 192 },
    { name: "Standard MP3", outputFormat: "mp3", bitrate: 128 },
    { name: "Efficient AAC", outputFormat: "aac", bitrate: 128 },
    { name: "Low Bitrate MP3", outputFormat: "mp3", bitrate: 96 },
  ];

  const tasks = [];

  // Create all tasks
  for (const scenario of scenarios) {
    console.log(`Creating task for: ${scenario.name}...`);

    try {
      const response = await fetch(`${API_BASE}/tasks/test-encode`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          outputFormat: scenario.outputFormat,
          bitrate: scenario.bitrate,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        tasks.push({ ...scenario, taskId: result.task.id });
        console.log(`✅ ${scenario.name} task created: ${result.task.id}`);
      } else {
        console.error(`❌ Failed to create ${scenario.name} task`);
      }
    } catch (error) {
      console.error(`❌ Error creating ${scenario.name} task:`, error.message);
    }
  }

  // Monitor all tasks
  console.log(`\n📊 Monitoring ${tasks.length} tasks...\n`);

  const results = await Promise.allSettled(
    tasks.map((task) =>
      monitorTask(task.taskId).then((result) => ({ ...task, result }))
    )
  );

  // Display summary
  console.log("\n📈 Encoding Summary:");
  console.log("=".repeat(50));

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const task = result.value;
      console.log(`${task.name}:`);
      console.log(`  ✅ Status: Success`);
      console.log(`  📦 Size: ${formatBytes(task.result.result.size)}`);
      console.log(`  🎛️ Format: ${task.result.result.format}`);
      console.log(`  🔊 Bitrate: ${task.result.result.bitrate}kbps`);
    } else {
      console.log(`${tasks[index].name}:`);
      console.log(`  ❌ Status: Failed`);
      console.log(`  💥 Error: ${result.reason.message}`);
    }
    console.log();
  });
}

// Check if script is run directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--multiple")) {
    testMultipleScenarios();
  } else {
    testEncodeEndpoint();
  }
}

module.exports = { testEncodeEndpoint, testMultipleScenarios };
