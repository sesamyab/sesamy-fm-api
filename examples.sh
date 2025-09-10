#!/bin/bash

# Podcast Service API Examples
# Make sure the service is running and you have a valid JWT token

BASE_URL="http://localhost:3000"
TOKEN="your-jwt-token-here"

echo "🎙️ Podcast Service API Examples"
echo "=================================="

# Generate a test token first
echo "📝 Generating test token..."
npm run generate-token

echo ""
echo "⚡ Replace 'your-jwt-token-here' with the generated token in this script"
echo ""

# Health checks
echo "🏥 Health Checks"
echo "----------------"
echo "Liveness check:"
curl -s "$BASE_URL/healthz" | jq .

echo ""
echo "Readiness check:"
curl -s "$BASE_URL/readyz" | jq .

# Service info
echo ""
echo "ℹ️  Service Info"
echo "---------------"
curl -s "$BASE_URL/" | jq .

# Create a show
echo ""
echo "📺 Creating a show..."
SHOW_RESPONSE=$(curl -s -X POST "$BASE_URL/shows" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Tech Talk Podcast",
    "description": "A podcast about the latest in technology and software development",
    "imageUrl": "https://example.com/tech-talk.jpg"
  }')

echo "Show created:"
echo "$SHOW_RESPONSE" | jq .

# Extract show ID
SHOW_ID=$(echo "$SHOW_RESPONSE" | jq -r '.id')
echo "Show ID: $SHOW_ID"

# List shows
echo ""
echo "📋 Listing shows..."
curl -s "$BASE_URL/shows?limit=5&offset=0" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Get specific show
echo ""
echo "📺 Getting show details..."
curl -s "$BASE_URL/shows/$SHOW_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Create an episode
echo ""
echo "🎬 Creating an episode..."
EPISODE_RESPONSE=$(curl -s -X POST "$BASE_URL/shows/$SHOW_ID/episodes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Episode 1: Introduction to Service Standards",
    "description": "In this first episode, we discuss the importance of service standards in modern software architecture."
  }')

echo "Episode created:"
echo "$EPISODE_RESPONSE" | jq .

# Extract episode ID
EPISODE_ID=$(echo "$EPISODE_RESPONSE" | jq -r '.id')
echo "Episode ID: $EPISODE_ID"

# List episodes
echo ""
echo "📋 Listing episodes for show..."
curl -s "$BASE_URL/shows/$SHOW_ID/episodes" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Update episode
echo ""
echo "✏️  Updating episode..."
curl -s -X PATCH "$BASE_URL/shows/$SHOW_ID/episodes/$EPISODE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Updated description: In this first episode, we dive deep into service standards and their practical applications."
  }' | jq .

# Simulate audio upload (this would normally be a real file)
echo ""
echo "🎵 Simulating audio upload..."
echo "Note: This would normally upload a real audio file"
echo "curl -X POST \"$BASE_URL/shows/$SHOW_ID/episodes/$EPISODE_ID/audio\" \\"
echo "  -H \"Authorization: Bearer $TOKEN\" \\"
echo "  -F \"audio=@episode1.mp3\""

# Publish episode
echo ""
echo "📢 Publishing episode..."
curl -s -X POST "$BASE_URL/shows/$SHOW_ID/episodes/$EPISODE_ID/publish" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Get published episode
echo ""
echo "📺 Getting published episode..."
curl -s "$BASE_URL/shows/$SHOW_ID/episodes/$EPISODE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Test transcript endpoint (if transcript is available)
echo ""
echo "📝 Testing transcript endpoint..."
echo "Getting transcript in markdown format:"
curl -s "$BASE_URL/shows/$SHOW_ID/episodes/$EPISODE_ID/transcript" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/markdown"

echo ""
echo "Getting transcript in JSON format:"
curl -s "$BASE_URL/shows/$SHOW_ID/episodes/$EPISODE_ID/transcript" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" | jq .

# Update show
echo ""
echo "✏️  Updating show..."
curl -s -X PATCH "$BASE_URL/shows/$SHOW_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Updated: A comprehensive podcast covering technology, software development, and industry best practices."
  }' | jq .

echo ""
echo "✅ Examples completed!"
echo "🌐 Check out the API documentation at: $BASE_URL/swagger"
