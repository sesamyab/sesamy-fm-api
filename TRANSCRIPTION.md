# Audio Transcription with Cloudflare Workers AI

This document describes the audio transcription feature that uses Cloudflare Workers AI with the Whisper model to automatically generate transcripts for podcast episodes.

## Overview

The transcription system provides:

- **Automatic Speech Recognition**: Uses OpenAI's Whisper model via Cloudflare Workers AI
- **R2 Storage**: Stores transcript files in Cloudflare R2 for fast, global access
- **Background Processing**: Tasks are processed asynchronously to avoid blocking API requests
- **Event Publishing**: Publishes events when transcription is requested and completed

## Database Schema Changes

### Episode Table

A new `transcriptUrl` field has been added to the episodes table:

```sql
ALTER TABLE episodes ADD COLUMN transcript_url TEXT;
```

### Episode Schema Updates

The episode schemas now include the `transcriptUrl` field:

```typescript
// Response schema
{
  id: string,
  showId: string,
  title: string,
  description: string,
  imageUrl: string | null,
  audioUrl: string | null,
  transcriptUrl: string | null,  // 🆕 New field
  published: boolean | null,
  publishedAt: string | null,
  createdAt: string,
  updatedAt: string
}
```

## API Endpoints

### Request Transcription

`POST /shows/{show_id}/episodes/{episode_id}/transcribe`

Requests AI transcription for an episode's audio.

**Requirements:**

- Episode must have an `audioUrl`
- Requires `podcast:write` permission or `podcast.write` scope

**Response:**

```json
{
  "taskId": 123,
  "status": "pending",
  "message": "Transcription task created successfully"
}
```

**Error Responses:**

- `400`: Episode has no audio URL
- `404`: Episode not found
- `403`: Insufficient permissions

## Task Processing

### Task Type: `transcribe`

**Payload:**

```json
{
  "episodeId": "uuid",
  "audioUrl": "https://...",
  "showId": "uuid"
}
```

**Result:**

```json
{
  "transcriptUrl": "https://podcast-media.sesamy.dev/transcripts/episode-id/transcript-id.txt",
  "transcriptKey": "transcripts/episode-id/transcript-id.txt",
  "textLength": 1234,
  "completedAt": "2025-09-06T12:00:00.000Z"
}
```

### Processing Flow

1. **Fetch Audio**: Downloads the audio file from the provided URL
2. **AI Transcription**: Processes audio through Cloudflare Workers AI Whisper model
3. **Store Transcript**: Saves the text transcript to R2 storage
4. **Update Episode**: Sets the `transcriptUrl` field in the database
5. **Publish Event**: Emits `episode.transcription_completed` event

## Configuration

### Wrangler Configuration

Add the AI binding to `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

### Environment Variables

- `R2_ENDPOINT`: Base URL for accessing R2 files (e.g., `https://podcast-media.sesamy.dev`)

## Events

### episode.transcription_requested

Published when a transcription task is created.

**Payload:**

```json
{
  "episodeId": "uuid",
  "taskId": 123
}
```

### episode.transcription_completed

Published when transcription processing is complete.

**Payload:**

```json
{
  "episodeId": "uuid",
  "transcriptUrl": "https://...",
  "textLength": 1234
}
```

## Storage Structure

Transcripts are stored in R2 with the following key pattern:

```
transcripts/{episodeId}/{transcriptId}.txt
```

**Metadata:**

- `Content-Type`: `text/plain`
- `Content-Language`: `en`
- `episodeId`: Custom metadata
- `createdAt`: Custom metadata

## Error Handling

### Common Errors

- **No AI Binding**: `AI and R2 bucket bindings are required for transcription`
- **Missing Audio**: `Episode has no audio URL`
- **Network Errors**: `Failed to fetch audio file: {reason}`
- **AI Processing**: `Transcription failed - no text returned`

### Retry Logic

Tasks that fail will be retried according to the task processor configuration. Failed tasks include error details in the task record.

## Usage Examples

### Creating a Transcription Task

```javascript
// Create an episode with audio
const episode = await fetch("/shows/123/episodes", {
  method: "POST",
  headers: { Authorization: "Bearer token" },
  body: JSON.stringify({
    title: "My Podcast Episode",
    description: "An interesting discussion",
    audioUrl: "https://example.com/audio.mp3",
  }),
});

// Request transcription
const transcriptionTask = await fetch("/shows/123/episodes/456/transcribe", {
  method: "POST",
  headers: { Authorization: "Bearer token" },
});

console.log(await transcriptionTask.json());
// { taskId: 789, status: "pending", message: "..." }
```

### Checking Task Status

```javascript
const task = await fetch("/tasks/789", {
  headers: { Authorization: "Bearer token" },
});

const taskData = await task.json();
if (taskData.status === "done") {
  const result = JSON.parse(taskData.result);
  console.log("Transcript available at:", result.transcriptUrl);
}
```

### Accessing the Transcript

Once processing is complete, the transcript is accessible via the public URL stored in `episode.transcriptUrl`.

## Performance Considerations

- **Audio File Size**: Larger audio files take longer to process
- **Concurrent Processing**: Multiple transcription tasks can run simultaneously
- **R2 Storage**: Transcripts are stored with global CDN access for fast retrieval
- **Task Scheduling**: Tasks are processed every 5 minutes via cron triggers

## Security

- **Authentication Required**: All transcription endpoints require JWT authentication
- **Permission Checks**: Users need `podcast:write` permission or `podcast.write` scope
- **R2 Security**: Transcript files are publicly accessible via R2 CDN
- **Input Validation**: Audio URLs are validated before processing

## Monitoring

### Task Metrics

Monitor transcription tasks through:

- Task status API (`/tasks/{id}`)
- Task listing API (`/tasks`)
- Background task processing logs

### Events

Subscribe to transcription events for real-time updates:

- `episode.transcription_requested`
- `episode.transcription_completed`

## Limitations

- **Audio Format Support**: Limited to formats supported by Whisper model
- **File Size Limits**: Cloudflare Workers AI has size limitations for audio processing
- **Language Support**: Optimized for English, may work with other languages
- **Processing Time**: Depends on audio length and model availability
