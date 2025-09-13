#!/usr/bin/env node

/**
 * Simple test script to verify RSS preview endpoint functionality
 * Run with: node test-rss-preview.js
 */

const API_BASE_URL = "http://localhost:8787"; // Adjust for your local setup
const JWT_TOKEN = "your-jwt-token-here"; // Add your JWT token

// Common podcast RSS feeds for testing
const TEST_RSS_FEEDS = [
  "https://feeds.npr.org/510289/podcast.xml", // NPR Politics Podcast
  "https://feeds.simplecast.com/54nAGcIl", // The Tim Ferriss Show
  "https://rss.art19.com/joe-rogan-experience", // Joe Rogan Experience
  // Add more test feeds as needed
];

async function testRSSPreview(rssUrl) {
  console.log(`\n📡 Testing RSS feed: ${rssUrl}`);

  try {
    const response = await fetch(`${API_BASE_URL}/shows/preview-rss`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JWT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rssUrl }),
    });

    const data = await response.json();

    if (data.success) {
      console.log("✅ RSS parsing successful!");
      console.log(`   Title: ${data.data.title}`);
      console.log(
        `   Description: ${data.data.description.substring(0, 100)}...`
      );
      console.log(`   Episodes: ${data.data.totalEpisodes}`);
      console.log(`   Language: ${data.data.language || "Not specified"}`);
      console.log(`   Author: ${data.data.author || "Not specified"}`);

      if (data.data.episodes.length > 0) {
        const firstEpisode = data.data.episodes[0];
        console.log(`   First Episode: ${firstEpisode.title}`);
        console.log(`   Audio URL: ${firstEpisode.audioUrl}`);
      }
    } else {
      console.log("❌ RSS parsing failed:");
      data.errors?.forEach((error) => {
        console.log(`   ${error.type}: ${error.message}`);
      });
    }
  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
  }
}

async function runTests() {
  console.log("🎙️  RSS Preview Endpoint Test");
  console.log("============================");

  if (JWT_TOKEN === "your-jwt-token-here") {
    console.log("❌ Please set your JWT_TOKEN in the script first!");
    console.log(
      "   You can get a JWT token by calling the auth endpoint or using an existing one."
    );
    return;
  }

  for (const feed of TEST_RSS_FEEDS) {
    await testRSSPreview(feed);

    // Add a small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\n🏁 Tests completed!");
}

// Check if this is being run directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testRSSPreview };
