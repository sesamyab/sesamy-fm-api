#!/bin/bash

# Test script to reproduce image upload 500 error

set -e

# Configuration
# HOST="http://localhost:8787"
HOST="https://podcast-service.sesamy-dev.workers.dev"  # Production URL

echo "🧪 Testing image upload issue..."
echo "🌐 Using host: $HOST"

# Generate token
echo "📋 Generating authentication token..."
TOKEN=$(npm run generate-token --silent 2>/dev/null | grep -E '^eyJ' | head -1)
if [ -z "$TOKEN" ]; then
  echo "❌ Failed to generate token"
  exit 1
fi

echo "✅ Token generated: ${TOKEN:0:50}..."

# Create a test show first
echo "📝 Creating test show..."
SHOW_RESPONSE=$(curl -s -X POST "$HOST/shows" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "Test Show for Image Upload",
    "description": "A test show to test image uploads",
    "category": "Technology"
  }')

# Extract ID using grep and sed (no jq needed)
SHOW_ID=$(echo "$SHOW_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SHOW_ID" ]; then
  echo "❌ Failed to create test show"
  echo "Response: $SHOW_RESPONSE"
  exit 1
fi

echo "✅ Test show created with ID: $SHOW_ID"

# Create a simple test image
echo "🖼️ Creating test image file..."
cat > test-image.txt << 'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==
EOF

# Decode base64 to create actual PNG (macOS syntax)
base64 -D -i test-image.txt -o test-image.png

echo "✅ Test PNG image created (1x1 pixel)"

# Try uploading the image
echo "🚀 Attempting image upload..."
echo "URL: $HOST/shows/$SHOW_ID/image"

RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}\n" \
  -X POST "$HOST/shows/$SHOW_ID/image" \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@test-image.png;type=image/png")

echo "📥 Response:"
echo "$RESPONSE"

# Extract HTTP code
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
echo "📊 HTTP Status Code: $HTTP_CODE"

# Clean up
echo "🧹 Cleaning up..."
rm -f test-image.txt test-image.png

if [ "$HTTP_CODE" = "500" ]; then
  echo "❌ Confirmed: Image upload is returning 500 error"
  exit 1
else
  echo "✅ Image upload succeeded or returned different error"
fi
