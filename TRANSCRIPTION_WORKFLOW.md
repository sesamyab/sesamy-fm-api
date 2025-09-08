# Transcription Workflow

This document describes the Cloudflare Workflows implementation for transcribing audio files using a multi-step process that includes encoding, chunking, transcribing, and merging.

## Overview

The transcription workflow implements a durable, multi-step process that:

1. **Validates inputs** - Ensures episode ID and audio URL are provided
2. **Chunks audio** - Uses the encoding container to split audio into overlapping segments
3. **Stores chunks** - Saves audio chunks to R2 storage with generated URLs
4. **Transcribes chunks** - Processes chunks in parallel using Cloudflare Workers AI (Whisper)
5. **Merges transcriptions** - Combines chunk transcriptions with intelligent overlap removal
6. **Stores final transcript** - Saves the merged transcript to R2 and updates the episode
7. **Cleanup** - Removes temporary chunk files

## Benefits

- **Durability**: Each step is independently retriable with automatic retry logic
- **Parallel Processing**: Multiple chunks transcribed simultaneously for faster processing
- **State Persistence**: Workflow continues from failed step without restarting entire process
- **Memory Efficiency**: Processes large audio files in manageable chunks
- **Intelligent Merging**: Removes duplicate words in overlapping segments

## API Endpoints

### Start Transcription Workflow

**POST** `/workflows/transcription`

Starts a new transcription workflow for an audio file.

**Request:**

```json
{
  "episodeId": "episode-123",
  "audioUrl": "https://example.com/audio.mp3",
  "chunkDuration": 30,
  "overlapDuration": 2,
  "taskId": "task-456"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Transcription workflow started successfully",
  "workflowId": "workflow-789",
  "instanceId": "workflow-789",
  "status": "queued",
  "episodeId": "episode-123",
  "estimatedDuration": "5-15 minutes (depending on audio length)"
}
```

### Get Workflow Status

**GET** `/workflows/transcription/{workflowId}`

Retrieves the current status and progress of a transcription workflow.

**Response:**

```json
{
  "success": true,
  "workflowId": "workflow-789",
  "status": "running",
  "output": null,
  "error": null
}
```

### Cancel Workflow

**DELETE** `/workflows/transcription/{workflowId}`

Cancels a running transcription workflow.

**Response:**

```json
{
  "success": true,
  "message": "Workflow cancelled successfully",
  "workflowId": "workflow-789"
}
```

## Workflow Steps

### 1. Initialize Workflow

- Validates input parameters
- Generates unique workflow ID
- Sets up initial state

**Retry Strategy:** No retries (validation step)

### 2. Chunk Audio

- Calls encoding container's `/chunk` endpoint
- Splits audio into 30-second segments with 2-second overlap
- Returns chunk data with base64-encoded audio

**Retry Strategy:** 3 retries with exponential backoff (5s, 25s, 125s)
**Timeout:** 10 minutes

### 3. Store Chunks

- Saves each chunk to R2 storage
- Generates public URLs for chunks
- Creates chunk metadata

**Retry Strategy:** 2 retries with linear backoff (3s, 6s)
**Timeout:** 5 minutes

### 4. Transcribe Chunks

- Processes chunks in parallel (3 at a time)
- Uses Cloudflare Workers AI Whisper model
- Transcribes audio to text with word counts

**Retry Strategy:** 2 retries with exponential backoff (10s, 100s)
**Timeout:** 15 minutes

### 5. Merge Transcriptions

- Combines chunk transcriptions in order
- Removes duplicate words in overlap regions
- Calculates compression statistics

**Retry Strategy:** No retries (deterministic text processing)

### 6. Store Final Transcript

- Saves merged transcript to R2
- Updates episode record in database
- Generates final transcript URL

**Retry Strategy:** 2 retries with linear backoff (2s, 4s)
**Timeout:** 2 minutes

### 7. Cleanup Chunks

- Waits 30 seconds for any final operations
- Deletes temporary chunk files from R2
- Non-critical step (failures don't affect workflow)

**Retry Strategy:** 1 retry with 5s delay
**Timeout:** 5 minutes

## Configuration

### Wrangler Configuration

Add to your `wrangler.toml`:

```toml
# Workflow configuration
[[workflows]]
name = "transcription-workflow"
binding = "TRANSCRIPTION_WORKFLOW"
class_name = "TranscriptionWorkflow"
```

### Environment Variables

The workflow uses the same environment bindings as the main application:

- `DB` - D1 Database for episode updates
- `BUCKET` - R2 Storage for chunks and transcripts
- `AI` - Workers AI for transcription
- `ENCODING_CONTAINER` - Durable Object for audio processing
- `R2_ACCESS_KEY_ID` - R2 credentials (secret)
- `R2_SECRET_ACCESS_KEY` - R2 credentials (secret)
- `R2_ENDPOINT` - R2 custom domain endpoint

## Example Usage

### Starting a Workflow

```javascript
const response = await fetch("/workflows/transcription", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer YOUR_JWT_TOKEN",
  },
  body: JSON.stringify({
    episodeId: "episode-123",
    audioUrl: "https://example.com/audio.mp3",
    chunkDuration: 30,
    overlapDuration: 2,
  }),
});

const result = await response.json();
console.log("Workflow started:", result.workflowId);
```

### Monitoring Progress

```javascript
const workflowId = "workflow-789";
const statusResponse = await fetch(`/workflows/transcription/${workflowId}`, {
  headers: {
    Authorization: "Bearer YOUR_JWT_TOKEN",
  },
});

const status = await statusResponse.json();
console.log("Workflow status:", status.status);

if (status.output) {
  console.log("Transcript URL:", status.output.transcriptUrl);
  console.log("Text length:", status.output.textLength);
}
```

### Using Wrangler CLI

```bash
# Start workflow via CLI
npx wrangler workflows trigger transcription-workflow '{
  "episodeId": "episode-123",
  "audioUrl": "https://example.com/audio.mp3"
}'

# Check workflow status
npx wrangler workflows instances describe transcription-workflow latest

# List all workflows
npx wrangler workflows list
```

## Error Handling

The workflow includes comprehensive error handling:

- **Step Failures**: Automatic retries with exponential backoff
- **Timeout Protection**: Each step has appropriate timeout limits
- **State Persistence**: Failed workflows can resume from last successful step
- **Graceful Degradation**: Non-critical steps (like cleanup) don't fail the workflow

## Monitoring

Monitor workflow execution through:

- **API Status Endpoints**: Real-time status via REST API
- **Wrangler CLI**: Detailed step-by-step execution logs
- **Cloudflare Dashboard**: Workflow metrics and analytics
- **Application Logs**: Detailed console output for debugging

## Performance Characteristics

- **Typical Duration**: 5-15 minutes depending on audio length
- **Concurrency**: 3 chunks transcribed simultaneously
- **Memory Usage**: Efficient chunk-based processing
- **Throughput**: ~2 minutes of audio processed per minute
- **Reliability**: Automatic retry on transient failures

## Migration from Task-Based Processing

The workflow system provides several advantages over the existing task-based approach:

1. **Better Observability**: Clear step-by-step progress tracking
2. **Improved Reliability**: Automatic retry and state persistence
3. **Easier Debugging**: Detailed execution logs and status information
4. **Scalability**: Cloudflare handles workflow orchestration and scaling

To migrate existing functionality:

1. Use `/workflows/transcription` instead of `/transcription/transcribe`
2. Monitor progress via `/workflows/transcription/{workflowId}`
3. The final result format remains compatible with existing integrations
