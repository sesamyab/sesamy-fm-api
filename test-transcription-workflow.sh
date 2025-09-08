#!/bin/bash

# Test script for the transcription workflow
# Usage: ./test-transcription-workflow.sh [audio-url]

set -e

# Configuration
API_BASE="https://podcast-service.YOUR_WORKERS_SUBDOMAIN.workers.dev"
EPISODE_ID="test-episode-$(date +%s)"
AUDIO_URL="${1:-https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav}"

echo "🎵 Testing Transcription Workflow"
echo "================================="
echo "Episode ID: $EPISODE_ID"
echo "Audio URL: $AUDIO_URL"
echo ""

# Function to make authenticated API calls
make_request() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    
    if [ -n "$JWT_TOKEN" ]; then
        auth_header="-H \"Authorization: Bearer $JWT_TOKEN\""
    else
        auth_header=""
        echo "⚠️  Warning: No JWT_TOKEN environment variable set"
    fi
    
    if [ "$method" = "POST" ] && [ -n "$data" ]; then
        eval curl -s -X "$method" \
            -H "\"Content-Type: application/json\"" \
            $auth_header \
            -d "'$data'" \
            "\"$API_BASE$endpoint\""
    else
        eval curl -s -X "$method" \
            $auth_header \
            "\"$API_BASE$endpoint\""
    fi
}

# Test 1: Check workflow service health
echo "1️⃣  Checking workflow service health..."
health_response=$(make_request "GET" "/workflows")
echo "Response: $health_response"

if echo "$health_response" | grep -q "\"status\":\"ok\""; then
    echo "✅ Workflow service is healthy"
else
    echo "❌ Workflow service is not available"
    echo "Response: $health_response"
    exit 1
fi
echo ""

# Test 2: Start transcription workflow
echo "2️⃣  Starting transcription workflow..."
workflow_data="{
    \"episodeId\": \"$EPISODE_ID\",
    \"audioUrl\": \"$AUDIO_URL\",
    \"chunkDuration\": 30,
    \"overlapDuration\": 2
}"

start_response=$(make_request "POST" "/workflows/transcription" "$workflow_data")
echo "Response: $start_response"

# Extract workflow ID
workflow_id=$(echo "$start_response" | grep -o '"workflowId":"[^"]*"' | cut -d'"' -f4)

if [ -n "$workflow_id" ]; then
    echo "✅ Workflow started successfully"
    echo "🆔 Workflow ID: $workflow_id"
else
    echo "❌ Failed to start workflow"
    echo "Response: $start_response"
    exit 1
fi
echo ""

# Test 3: Monitor workflow progress
echo "3️⃣  Monitoring workflow progress..."
echo "This may take 5-15 minutes depending on audio length..."

max_attempts=60  # 10 minutes with 10-second intervals
attempt=0

while [ $attempt -lt $max_attempts ]; do
    status_response=$(make_request "GET" "/workflows/transcription/$workflow_id")
    status=$(echo "$status_response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    
    echo "📊 Attempt $((attempt + 1))/$max_attempts - Status: $status"
    
    case "$status" in
        "completed")
            echo "✅ Workflow completed successfully!"
            echo "Final response: $status_response"
            
            # Extract transcript URL if available
            transcript_url=$(echo "$status_response" | grep -o '"transcriptUrl":"[^"]*"' | cut -d'"' -f4)
            if [ -n "$transcript_url" ]; then
                echo "📄 Transcript URL: $transcript_url"
            fi
            break
            ;;
        "failed")
            echo "❌ Workflow failed"
            echo "Error response: $status_response"
            exit 1
            ;;
        "cancelled")
            echo "🚫 Workflow was cancelled"
            exit 1
            ;;
        "running"|"queued")
            echo "⏳ Workflow is still processing..."
            ;;
        *)
            echo "❓ Unknown status: $status"
            echo "Response: $status_response"
            ;;
    esac
    
    attempt=$((attempt + 1))
    sleep 10
done

if [ $attempt -eq $max_attempts ]; then
    echo "⏰ Workflow monitoring timed out after 10 minutes"
    echo "💡 You can check status manually with:"
    echo "   curl -H \"Authorization: Bearer \$JWT_TOKEN\" \"$API_BASE/workflows/transcription/$workflow_id\""
fi

echo ""
echo "🏁 Test completed!"
echo "Workflow ID: $workflow_id"

# Optional: Test cancellation (uncomment to test)
# echo ""
# echo "4️⃣  Testing workflow cancellation..."
# cancel_response=$(make_request "DELETE" "/workflows/transcription/$workflow_id")
# echo "Cancel response: $cancel_response"
