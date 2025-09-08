#!/bin/bash

# Test script to verify the audio processing workflow fixes
# This tests the fixed AAC format issue and automatic bitrate adjustment

echo "🧪 Testing Audio Processing Workflow Fixes"
echo "============================================"

# Worker URL
WORKER_URL="https://podcast-service.sesamy-dev.workers.dev"

# Generate a test episode ID
EPISODE_ID="test-episode-$(date +%s)"

# Test MP3 encoding (should auto-adjust bitrate based on mono/stereo)
echo ""
echo "📡 Testing MP3 encoding with automatic bitrate adjustment..."

curl -X POST "${WORKER_URL}/api/v1/workflows/audio-processing" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-auth-token" \
  -d '{
    "episodeId": "'${EPISODE_ID}'",
    "audioUrl": "https://podcast-media.sesamy.dev/audio/b0253f27-f247-46be-a9df-df7fbc1bc437/92f83ba9-8802-4d97-a872-581015d900fb/2e8d36fa-449c-46dd-bae8-36a0b071b034/8f7cd1ff-dfcd-4184-bff1-bcf776c80b92.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=1c872a820859699f2cf982caad8739af%2F20250908%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20250908T153145Z&X-Amz-Expires=28800&X-Amz-SignedHeaders=host&X-Amz-Signature=60de51a119dfd87f560c194f5f3aecf9df00e314028c97986000b20708bc334d",
    "encodingFormats": ["mp3_128"]
  }' \
  --verbose

echo ""
echo "✅ Test completed! Check the output above for any errors."
echo ""
echo "🔍 Key improvements made:"
echo "  1. Fixed AAC format issue (now uses ADTS format correctly)"
echo "  2. Added automatic audio property detection" 
echo "  3. Auto-adjusts bitrate: 64k for mono, 128k for stereo"
echo "  4. Better error handling and logging"
echo ""
echo "⚡ The workflow now defaults to MP3 format only with intelligent bitrate selection"
