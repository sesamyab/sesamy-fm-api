# Audio Upload with Automatic Workflow Transcription

This document describes the enhanced audio upload functionality that automatically triggers transcription workflows.

## Overview

When you upload an audio file via the `/shows/{show_id}/episodes/{episode_id}/audio` endpoint, the system now automatically:

1. **Uploads to R2** - Stores the audio file in R2 bucket
2. **Starts Transcription Workflow** - Automatically triggers the durable workflow for chunked transcription
3. **Publishes Events** - Emits events for workflow started and audio uploaded
4. **Falls Back to Tasks** - Uses traditional task-based approach if workflow fails

## Upload Flow

### 1. Audio Upload Request

```http
POST /shows/{show_id}/episodes/{episode_id}/audio
Authorization: Bearer {jwt_token}
Content-Type: multipart/form-data

{
  "audio": [audio-file]
}
```

### 2. Automatic Workflow Trigger

The system automatically creates a transcription workflow with these parameters:

- `episodeId`: The episode being processed
- `audioUrl`: Signed URL for the uploaded audio
- `chunkDuration`: 30 seconds (default)
- `overlapDuration`: 2 seconds (default)

### 3. Event Publishing

Two events are published:

- `audio.uploaded` - Traditional audio upload event
- `episode.transcription_workflow_started` - New workflow started event

## Response Format

The upload endpoint returns the same response as before, but now includes workflow information in the events:

```json
{
  "id": "audio-uuid",
  "episodeId": "episode-123",
  "fileName": "podcast-episode.mp3",
  "fileSize": 15728640,
  "mimeType": "audio/mpeg",
  "url": "https://podcast-media.sesamy.dev/audio/show/episode/audio.mp3?X-Amz-..."
}
```

## Monitoring Workflow Progress

After upload, you can monitor the transcription progress:

### Check Workflow Status

```http
GET /workflows/transcription/{workflowId}
Authorization: Bearer {jwt_token}
```

### Listen for Events

Monitor these events to track progress:

- `episode.transcription_workflow_started` - Workflow began
- `episode.transcription_completed` - Transcript ready

## Configuration

### Enabling/Disabling Workflows

The AudioService can be configured to use workflows or fall back to tasks:

```typescript
// Enable workflows (default)
audioService.setUseWorkflows(true);

// Disable workflows (use tasks)
audioService.setUseWorkflows(false);

// Check if workflows are enabled
const isEnabled = audioService.isWorkflowEnabled();
```

### Fallback Behavior

If workflows are disabled or fail to start, the system automatically falls back to the traditional task-based approach:

1. Creates `encode` task for audio encoding
2. Creates `audio_preprocess` task for chunked transcription

## Error Handling

### Workflow Startup Failures

- If workflow creation fails, automatically falls back to tasks
- Error is logged but doesn't affect upload success
- User gets consistent upload response regardless of processing method

### Processing Failures

- Workflow includes automatic retry logic for each step
- Failed workflows can be manually restarted
- Task fallback provides additional reliability

## Example Usage

### Standard Upload (Automatic Workflow)

```bash
curl -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -F "audio=@podcast-episode.mp3" \
  "https://your-api.workers.dev/shows/show-123/episodes/episode-456/audio"
```

### Monitor Progress

```bash
# Extract workflowId from event logs or episode metadata
curl -H "Authorization: Bearer $JWT_TOKEN" \
  "https://your-api.workers.dev/workflows/transcription/$WORKFLOW_ID"
```

### Check Episode Status

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  "https://your-api.workers.dev/shows/show-123/episodes/episode-456"
```

The episode response will include `transcriptUrl` once the workflow completes.

## Benefits Over Task-Based Approach

1. **Better Reliability** - Durable execution with automatic retries
2. **Progress Tracking** - Real-time status monitoring via API
3. **Observability** - Detailed step-by-step execution logs
4. **Scalability** - Cloudflare handles workflow orchestration
5. **Consistency** - Single upload triggers complete transcription pipeline

## Migration Notes

- **Existing API Compatibility** - Upload endpoint behavior unchanged
- **Response Format** - Same response structure as before
- **Event Compatibility** - `audio.uploaded` event still published
- **Fallback Support** - Tasks still available if workflows fail

## Environment Variables

No new environment variables required. Uses existing bindings:

- `TRANSCRIPTION_WORKFLOW` - Workflow binding (configured in wrangler.toml)
- `DB`, `BUCKET`, `AI` - Existing service bindings
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` - R2 credentials

## Testing

Use the provided test script to verify workflow functionality:

```bash
# Upload an audio file and monitor workflow
./test-transcription-workflow.sh https://example.com/audio.mp3

# Or test via API directly
curl -X POST /shows/test/episodes/test/audio \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -F "audio=@test-audio.mp3"
```

The workflow will automatically begin processing the uploaded audio file.
