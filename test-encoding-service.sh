#!/bin/bash

# Test script for the encoding service integration

echo "Testing the encoding service integration..."

# Set the base URL - update this when your service is deployed
BASE_URL="http://localhost:8787"
ENCODING_SERVICE_URL="http://localhost:3000"  # Local encoding service

echo "1. Testing health endpoint..."
curl -s "$BASE_URL/health" | jq .

echo -e "\n2. Testing direct encoding service test endpoint..."
curl -s -X POST "$ENCODING_SERVICE_URL/test" \
  -H "Content-Type: application/json" \
  -d '{"outputFormat": "mp3", "bitrate": 128}' | jq .

echo -e "\n3. Testing main service test-encode endpoint..."
curl -s -X POST "$BASE_URL/tasks/test-encode" \
  -H "Content-Type: application/json" \
  -d '{
    "outputFormat": "mp3",
    "bitrate": 128
  }' | jq .

echo -e "\n4. Testing with custom audio URL..."
curl -s -X POST "$BASE_URL/tasks/test-encode" \
  -H "Content-Type: application/json" \
  -d '{
    "audioUrl": "https://example.com/test.mp3",
    "outputFormat": "mp3",
    "bitrate": 96
  }' | jq .

echo -e "\nTest completed!"
