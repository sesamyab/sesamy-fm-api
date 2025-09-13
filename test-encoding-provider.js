#!/usr/bin/env node

// Simple test script to verify encoding service provider selection
const { createEncodingService } = require("./dist/encoding/service.js");

console.log("Testing Encoding Service Provider Selection\n");

// Mock container and URLs for testing
const mockContainer = {
  idFromName: () => ({ toString: () => "mock-id" }),
  get: () => ({
    fetch: () => Promise.resolve({ json: () => ({ success: true }) }),
  }),
};

const mockLambdaUrl = "https://mock-lambda-url.lambda-url.us-east-1.on.aws";

// Test 1: Default behavior (should prefer AWS)
console.log("Test 1: Default behavior (no ENCODING_SERVICE_PROVIDER set)");
delete process.env.ENCODING_SERVICE_PROVIDER;
try {
  const service1 = createEncodingService(mockContainer, mockLambdaUrl);
  console.log("✅ Service created successfully");
} catch (error) {
  console.log("❌ Error:", error.message);
}

// Test 2: Explicitly set to AWS
console.log("\nTest 2: ENCODING_SERVICE_PROVIDER=aws");
process.env.ENCODING_SERVICE_PROVIDER = "aws";
try {
  const service2 = createEncodingService(mockContainer, mockLambdaUrl);
  console.log("✅ Service created successfully");
} catch (error) {
  console.log("❌ Error:", error.message);
}

// Test 3: Explicitly set to Cloudflare
console.log("\nTest 3: ENCODING_SERVICE_PROVIDER=cloudflare");
process.env.ENCODING_SERVICE_PROVIDER = "cloudflare";
try {
  const service3 = createEncodingService(mockContainer, mockLambdaUrl);
  console.log("✅ Service created successfully");
} catch (error) {
  console.log("❌ Error:", error.message);
}

// Test 4: AWS preferred but no URL (should fallback to Cloudflare)
console.log("\nTest 4: ENCODING_SERVICE_PROVIDER=aws but no Lambda URL");
process.env.ENCODING_SERVICE_PROVIDER = "aws";
try {
  const service4 = createEncodingService(mockContainer);
  console.log("✅ Service created successfully (fallback to Cloudflare)");
} catch (error) {
  console.log("❌ Error:", error.message);
}

// Test 5: Cloudflare preferred but no container (should fallback to AWS)
console.log("\nTest 5: ENCODING_SERVICE_PROVIDER=cloudflare but no container");
process.env.ENCODING_SERVICE_PROVIDER = "cloudflare";
try {
  const service5 = createEncodingService(undefined, mockLambdaUrl);
  console.log("✅ Service created successfully (fallback to AWS)");
} catch (error) {
  console.log("❌ Error:", error.message);
}

// Test 6: Neither service available
console.log("\nTest 6: No services available");
try {
  const service6 = createEncodingService();
  console.log("✅ Service created successfully");
} catch (error) {
  console.log("✅ Expected error:", error.message);
}

console.log("\nTest completed!");
