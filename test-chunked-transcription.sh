#!/bin/bash

# Test script for chunked audio preprocessing and transcription
# This script tests the new chunked audio preprocessing functionality

echo "Testing Chunked Audio Preprocessing and Transcription"
echo "===================================================="

# Configuration
API_BASE_URL="http://localhost:8787"
TEST_AUDIO_URL="https://www.soundjay.com/misc/sounds/bell-ringing-05.wav"

echo "1. Testing audio preprocessing (chunking)..."
echo "POST ${API_BASE_URL}/api/tasks/test-audio-preprocess"

PREPROCESS_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/api/tasks/test-audio-preprocess" \
  -H "Content-Type: application/json" \
  -d "{
    \"audioUrl\": \"${TEST_AUDIO_URL}\",
    \"episodeId\": \"test-chunk-$(date +%s)\"
  }")

echo "Preprocessing Response:"
echo "${PREPROCESS_RESPONSE}" | jq '.'

# Extract chunk information
CHUNKS_COUNT=$(echo "${PREPROCESS_RESPONSE}" | jq -r '.chunks | length // 0')
PROCESSING_MODE=$(echo "${PREPROCESS_RESPONSE}" | jq -r '.processingMode // "unknown"')

echo ""
echo "Preprocessing Results:"
echo "- Processing Mode: ${PROCESSING_MODE}"
echo "- Total Chunks: ${CHUNKS_COUNT}"

if [ "${CHUNKS_COUNT}" -gt 0 ]; then
    echo "- Chunk Details:"
    echo "${PREPROCESS_RESPONSE}" | jq -r '.chunks[] | "  Chunk \(.index): \(.startTime)s - \(.endTime)s (\(.duration)s, \(.size) bytes)"'
fi

echo ""
echo "2. Testing direct chunked transcription..."

# Test chunked transcription if we have chunks
if [ "${CHUNKS_COUNT}" -gt 0 ]; then
    # Extract chunks for transcription test
    CHUNKS_JSON=$(echo "${PREPROCESS_RESPONSE}" | jq '.chunks')
    TOTAL_DURATION=$(echo "${PREPROCESS_RESPONSE}" | jq -r '.totalDuration // 30')
    
    echo "POST ${API_BASE_URL}/api/tasks/test-transcribe"
    
    TRANSCRIBE_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/api/tasks/test-transcribe" \
      -H "Content-Type: application/json" \
      -d "{
        \"episodeId\": \"test-transcribe-chunk-$(date +%s)\",
        \"chunked\": true,
        \"chunks\": ${CHUNKS_JSON},
        \"overlapDuration\": 2
      }")

    echo "Transcription Response:"
    echo "${TRANSCRIBE_RESPONSE}" | jq '.'
    
    # Extract transcription results
    TEXT_LENGTH=$(echo "${TRANSCRIBE_RESPONSE}" | jq -r '.textLength // 0')
    PROCESSING_MODE_TRANSCRIBE=$(echo "${TRANSCRIBE_RESPONSE}" | jq -r '.processingMode // "unknown"')
    COMPRESSION_RATIO=$(echo "${TRANSCRIBE_RESPONSE}" | jq -r '.chunkDetails.compressionRatio // "unknown"')
    
    echo ""
    echo "Transcription Results:"
    echo "- Processing Mode: ${PROCESSING_MODE_TRANSCRIBE}"
    echo "- Final Text Length: ${TEXT_LENGTH}"
    echo "- Overlap Compression: ${COMPRESSION_RATIO}"
    
    if [ "${TEXT_LENGTH}" -gt 0 ]; then
        echo "- Chunk Transcription Details:"
        echo "${TRANSCRIBE_RESPONSE}" | jq -r '.chunks[]? | "  Chunk \(.index): \(.wordCount) words (\(.textLength) chars)"'
    fi
else
    echo "No chunks found from preprocessing, skipping chunked transcription test"
fi

echo ""
echo "3. Testing end-to-end workflow with audio_preprocess task..."

# Create an audio_preprocess task which should automatically create a transcribe task
echo "POST ${API_BASE_URL}/api/tasks"

TASK_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/api/tasks" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"audio_preprocess\",
    \"payload\": {
      \"audioUrl\": \"${TEST_AUDIO_URL}\",
      \"episodeId\": \"test-workflow-$(date +%s)\",
      \"showId\": \"test-show\"
    }
  }")

echo "Task Creation Response:"
echo "${TASK_RESPONSE}" | jq '.'

TASK_ID=$(echo "${TASK_RESPONSE}" | jq -r '.id // empty')

if [ ! -z "${TASK_ID}" ]; then
    echo ""
    echo "Created task ID: ${TASK_ID}"
    echo "Monitor the task status manually with:"
    echo "curl ${API_BASE_URL}/api/tasks/${TASK_ID}"
    
    # Wait a moment and check task status
    echo ""
    echo "Waiting 5 seconds before checking task status..."
    sleep 5
    
    TASK_STATUS_RESPONSE=$(curl -s "${API_BASE_URL}/api/tasks/${TASK_ID}")
    echo "Task Status:"
    echo "${TASK_STATUS_RESPONSE}" | jq '.'
else
    echo "Failed to create task"
fi

echo ""
echo "4. Testing container chunk endpoint directly..."

# Test the container chunk endpoint directly if the container is available
CONTAINER_URL="http://localhost:8080"  # Assuming container is running locally for testing

echo "Testing container chunk endpoint: POST ${CONTAINER_URL}/chunk"

CONTAINER_RESPONSE=$(curl -s -w "%{http_code}" -X POST "${CONTAINER_URL}/chunk" \
  -H "Content-Type: application/json" \
  -d "{
    \"audioUrl\": \"${TEST_AUDIO_URL}\",
    \"chunkDuration\": 30,
    \"overlapDuration\": 2,
    \"bitrate\": 32,
    \"outputFormat\": \"mp3\"
  }" 2>/dev/null || echo "000")

HTTP_CODE="${CONTAINER_RESPONSE: -3}"
RESPONSE_BODY="${CONTAINER_RESPONSE%???}"

echo "Container Response (HTTP ${HTTP_CODE}):"
if [ "${HTTP_CODE}" = "200" ]; then
    echo "${RESPONSE_BODY}" | jq '.'
else
    echo "Container not available or error occurred"
    echo "${RESPONSE_BODY}"
fi

echo ""
echo "Test completed!"
echo "==============="
echo ""
echo "Summary:"
echo "- Audio preprocessing with chunking: $([ "${CHUNKS_COUNT}" -gt 0 ] && echo "✓ Success (${CHUNKS_COUNT} chunks)" || echo "✗ Failed")"
echo "- Chunked transcription: $([ "${TEXT_LENGTH}" -gt 0 ] && echo "✓ Success (${TEXT_LENGTH} chars)" || echo "✗ Not tested")"
echo "- End-to-end workflow: $([ ! -z "${TASK_ID}" ] && echo "✓ Task created (${TASK_ID})" || echo "✗ Failed")"
echo "- Container chunk endpoint: $([ "${HTTP_CODE}" = "200" ] && echo "✓ Available" || echo "✗ Not available")"
