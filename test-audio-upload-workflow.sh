#!/bin/bash

# Test script for audio upload with automatic workflow triggering
# Usage: ./test-audio-upload-workflow.sh [audio-file-path]

set -e

# Configuration
API_BASE="https://podcast-service.sesamy-dev.workers.dev"
SHOW_ID="test-show-$(date +%s)"
EPISODE_ID="test-episode-$(date +%s)"
AUDIO_FILE="${1:-test-audio.mp3}"

echo "🎵 Testing Audio Upload with Automatic Workflow"
echo "=============================================="
echo "Show ID: $SHOW_ID"
echo "Episode ID: $EPISODE_ID"
echo "Audio File: $AUDIO_FILE"
echo ""

# Function to make authenticated API calls
make_request() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local content_type="${4:-application/json}"
    
    if [ -n "$JWT_TOKEN" ]; then
        auth_header="-H \"Authorization: Bearer $JWT_TOKEN\""
    else
        auth_header=""
        echo "⚠️  Warning: No JWT_TOKEN environment variable set"
    fi
    
    if [ "$method" = "POST" ] && [ -n "$data" ]; then
        if [ "$content_type" = "multipart/form-data" ]; then
            eval curl -s -X "$method" \
                $auth_header \
                "$data" \
                "\"$API_BASE$endpoint\""
        else
            eval curl -s -X "$method" \
                -H "\"Content-Type: $content_type\"" \
                $auth_header \
                -d "'$data'" \
                "\"$API_BASE$endpoint\""
        fi
    else
        eval curl -s -X "$method" \
            $auth_header \
            "\"$API_BASE$endpoint\""
    fi
}

# Check if audio file exists
if [ ! -f "$AUDIO_FILE" ]; then
    echo "❌ Audio file not found: $AUDIO_FILE"
    echo "💡 You can download a test file with:"
    echo "   wget https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav -O test-audio.wav"
    exit 1
fi

echo "1️⃣  Creating test show..."
show_data="{
    \"title\": \"Test Show $(date +%s)\",
    \"description\": \"Test show for workflow testing\",
    \"language\": \"en\"
}"

show_response=$(make_request "POST" "/shows" "$show_data")
echo "Show created: $show_response"

# Extract show ID from response if needed
actual_show_id=$(echo "$show_response" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
if [ -n "$actual_show_id" ]; then
    SHOW_ID="$actual_show_id"
    echo "✅ Using show ID: $SHOW_ID"
fi
echo ""

echo "2️⃣  Creating test episode..."
episode_data="{
    \"title\": \"Test Episode $(date +%s)\",
    \"description\": \"Test episode for workflow testing\",
    \"status\": \"draft\"
}"

episode_response=$(make_request "POST" "/shows/$SHOW_ID/episodes" "$episode_data")
echo "Episode created: $episode_response"

# Extract episode ID from response if needed
actual_episode_id=$(echo "$episode_response" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
if [ -n "$actual_episode_id" ]; then
    EPISODE_ID="$actual_episode_id"
    echo "✅ Using episode ID: $EPISODE_ID"
fi
echo ""

echo "3️⃣  Uploading audio file (this should trigger workflow)..."
upload_data="-F \"audio=@$AUDIO_FILE\""

upload_response=$(make_request "POST" "/shows/$SHOW_ID/episodes/$EPISODE_ID/audio" "$upload_data" "multipart/form-data")
echo "Upload response: $upload_response"

if echo "$upload_response" | grep -q '"id"'; then
    echo "✅ Audio uploaded successfully!"
    
    # Extract audio metadata
    audio_id=$(echo "$upload_response" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    echo "🎵 Audio ID: $audio_id"
else
    echo "❌ Audio upload failed"
    echo "Response: $upload_response"
    exit 1
fi
echo ""

echo "4️⃣  Checking episode for workflow trigger..."
sleep 3  # Give the system time to process

episode_status=$(make_request "GET" "/shows/$SHOW_ID/episodes/$EPISODE_ID")
echo "Episode status: $episode_status"

# Look for transcriptUrl or workflow indicators
if echo "$episode_status" | grep -q '"audioUrl"'; then
    echo "✅ Episode has audio URL - workflow should be triggered"
else
    echo "⚠️  Episode doesn't have audio URL yet"
fi
echo ""

echo "5️⃣  Checking workflow service health..."
workflow_health=$(make_request "GET" "/workflows")
echo "Workflow health: $workflow_health"

if echo "$workflow_health" | grep -q '"status":"ok"'; then
    echo "✅ Workflow service is healthy"
else
    echo "❌ Workflow service is not available"
fi
echo ""

echo "6️⃣  Looking for active workflows..."
echo "💡 To check for active workflows, use:"
echo "   npx wrangler workflows list"
echo "   npx wrangler workflows instances describe transcription-workflow latest"
echo ""

echo "7️⃣  Monitoring for transcript completion..."
echo "The workflow should automatically:"
echo "   1. Chunk the audio into 30-second segments"
echo "   2. Transcribe each chunk using Whisper AI"
echo "   3. Merge transcriptions with overlap removal"
echo "   4. Update the episode with transcriptUrl"
echo ""

echo "To monitor progress:"
echo "   curl -H \"Authorization: Bearer \$JWT_TOKEN\" \"$API_BASE/shows/$SHOW_ID/episodes/$EPISODE_ID\""
echo ""

echo "🏁 Audio upload with automatic workflow test completed!"
echo "Show ID: $SHOW_ID"
echo "Episode ID: $EPISODE_ID"
echo "Audio ID: $audio_id"

# Optional: Wait and check for completion
read -p "Wait for workflow completion? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "⏳ Waiting for workflow completion (checking every 30 seconds)..."
    
    for i in {1..20}; do  # Check for up to 10 minutes
        sleep 30
        current_status=$(make_request "GET" "/shows/$SHOW_ID/episodes/$EPISODE_ID")
        
        if echo "$current_status" | grep -q '"transcriptUrl"'; then
            echo "🎉 Workflow completed! Episode has transcript URL"
            transcript_url=$(echo "$current_status" | grep -o '"transcriptUrl":"[^"]*"' | cut -d'"' -f4)
            echo "📄 Transcript URL: $transcript_url"
            break
        else
            echo "⏳ Attempt $i/20: Workflow still processing..."
        fi
    done
fi
