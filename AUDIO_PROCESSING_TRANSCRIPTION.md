# Audio Processing and Transcription Workflows

This document explains the separation of audio processing and transcription workflows, and how to use them.

## Overview

As of October 2025, the audio processing and transcription functionalities have been separated into two independent workflows:

1. **Audio Processing Workflow** - Handles audio encoding only
2. **Transcription Workflow** - Handles audio transcription independently

## Audio Processing Workflow

### Purpose

The audio processing workflow handles:

- Audio encoding for TTS
- Audio chunking for distribution
- Temporary file cleanup

### Triggering the Workflow

**Via Task Service:**

```typescript
const taskService = new TaskService(database, audioProcessingWorkflow);

const task = await taskService.createTask(
  "audio_processing",
  {
    episodeId: "episode-uuid",
    audioR2Key: "audio/episode/file.mp3",
    chunkDuration: 60,
    encodingFormats: ["mp3_128"],
  },
  organizationId
);
```

**Direct Workflow Trigger:**

```typescript
await env.AUDIO_PROCESSING_WORKFLOW.create({
  params: {
    episodeId: "episode-uuid",
    audioUrl: "https://example.com/audio.mp3",
    organizationId: "org-uuid",
    taskId: "123",
    workflowId: "workflow-uuid",
  },
});
```

### Workflow Steps

1. Initialize workflow
2. Encode audio for TTS (mono 16kHz)
3. Create audio chunks
4. Cleanup temporary files

## Transcription Workflow

### Purpose

The transcription workflow handles:

- Fetching audio from R2 or HTTP URLs
- Transcribing audio using Cloudflare AI (Whisper)
- Storing transcripts in R2
- Updating episodes with transcript URLs

### Triggering the Workflow

**Direct Workflow Trigger:**

```typescript
await env.TRANSCRIPTION_WORKFLOW.create({
  params: {
    episodeId: "episode-uuid",
    audioUrl: "https://example.com/audio.mp3",
    // OR use R2 key:
    audioR2Key: "r2://audio/episode/file.mp3",
    taskId: "456",
    organizationId: "org-uuid",
    language: "en",
    model: "whisper-large-v3",
  },
});
```

**Via Task Service (if integrated):**

```typescript
const taskService = new TaskService(database);

const task = await taskService.createTask(
  "transcription",
  {
    episodeId: "episode-uuid",
    audioR2Key: "audio/episode/file.mp3",
    language: "en",
    model: "whisper-large-v3",
  },
  organizationId
);
```

### Parameters

| Parameter        | Type   | Required | Default              | Description                             |
| ---------------- | ------ | -------- | -------------------- | --------------------------------------- |
| `episodeId`      | UUID   | Yes      | -                    | Episode identifier                      |
| `audioUrl`       | URL    | Yes\*    | -                    | HTTP/HTTPS URL to audio file            |
| `audioR2Key`     | string | Yes\*    | -                    | R2 key (with or without `r2://` prefix) |
| `taskId`         | string | No       | -                    | Task ID for progress tracking           |
| `organizationId` | UUID   | Yes      | -                    | Organization identifier                 |
| `language`       | string | No       | `"en"`               | Source language code                    |
| `model`          | string | No       | `"whisper-large-v3"` | Whisper model to use                    |

\*Either `audioUrl` or `audioR2Key` must be provided

### Workflow Steps

1. Initialize workflow
2. Fetch audio file (from R2 or HTTP)
3. Transcribe using Cloudflare AI Whisper
4. Store transcript in R2
5. Update episode with transcript URL

## Common Use Cases

### 1. Process New Episode (Encoding + Transcription)

```typescript
// Step 1: Upload audio and trigger encoding
const encodingTask = await taskService.createTask(
  "audio_processing",
  {
    episodeId,
    audioR2Key,
    chunkDuration: 60,
    encodingFormats: ["mp3_128"],
  },
  organizationId
);

// Step 2: After encoding completes, trigger transcription
// (Can be done in a completion handler or separately)
await env.TRANSCRIPTION_WORKFLOW.create({
  params: {
    episodeId,
    audioR2Key, // Use the same audio file
    organizationId,
    language: "en",
    model: "whisper-large-v3",
  },
});
```

### 2. Re-transcribe Existing Episode

```typescript
// Transcribe an episode that already has encoded audio
await env.TRANSCRIPTION_WORKFLOW.create({
  params: {
    episodeId: "existing-episode-uuid",
    audioR2Key: "r2://audio/episode/existing.mp3",
    organizationId: "org-uuid",
    language: "es", // Change language
    model: "whisper-large-v3",
  },
});
```

### 3. Transcribe External Audio

```typescript
// Transcribe audio from an external URL (no encoding needed)
await env.TRANSCRIPTION_WORKFLOW.create({
  params: {
    episodeId: "episode-uuid",
    audioUrl: "https://external-cdn.com/podcast.mp3",
    organizationId: "org-uuid",
    language: "en",
  },
});
```

## Migration Guide

### For Existing Code

If you were previously relying on the audio processing workflow to also handle transcription, you now need to:

1. **Continue using audio processing workflow** for encoding
2. **Add transcription workflow trigger** after encoding completes

Example migration:

**Before (old behavior):**

```typescript
// Audio processing did both encoding and transcription
const task = await taskService.createTask("audio_processing", params, orgId);
```

**After (new behavior):**

```typescript
// Step 1: Encoding only
const encodingTask = await taskService.createTask(
  "audio_processing",
  params,
  orgId
);

// Step 2: Transcription (trigger after encoding or separately)
const transcriptionTask = await taskService.createTask(
  "transcription",
  {
    episodeId: params.episodeId,
    audioR2Key: params.audioR2Key,
    language: params.transcriptionLanguage || "en",
  },
  orgId
);
```

## Configuration

### Environment Variables

No new environment variables are required. The transcription workflow uses the existing:

- `DB` - D1 Database binding
- `BUCKET` - R2 bucket binding
- `AI` - Cloudflare AI binding
- `R2_ACCESS_KEY_ID` - For presigned URLs
- `R2_SECRET_ACCESS_KEY` - For presigned URLs
- `R2_ENDPOINT` - R2 endpoint URL

### Workflow Bindings (wrangler.toml)

```toml
[[workflows]]
name = "audio-processing-workflow"
binding = "AUDIO_PROCESSING_WORKFLOW"
class_name = "AudioProcessingWorkflow"

[[workflows]]
name = "transcription-workflow"
binding = "TRANSCRIPTION_WORKFLOW"
class_name = "TranscriptionWorkflow"
```

## Benefits of Separation

1. **Independent Scaling** - Transcription can be triggered independently without re-encoding
2. **Language Changes** - Re-transcribe in different languages without re-processing audio
3. **Model Updates** - Try different Whisper models without affecting encoding
4. **Failure Isolation** - Transcription failures don't affect encoded audio
5. **Cost Optimization** - Only run transcription when needed
6. **Better Error Handling** - Each workflow has focused error handling

## Monitoring

Both workflows update task progress and status. Monitor them via:

```sql
-- Check encoding tasks
SELECT * FROM tasks WHERE type = 'audio_processing' ORDER BY created_at DESC;

-- Check transcription tasks
SELECT * FROM tasks WHERE type = 'transcription' ORDER BY created_at DESC;
```

## Troubleshooting

### Audio Processing Issues

- Check encoding container is running
- Verify R2 bucket access
- Check task logs for encoding errors

### Transcription Issues

- Verify audio file is accessible (R2 or HTTP)
- Check Cloudflare AI quota
- Ensure language code is valid
- Verify Whisper model name is correct

## Future Enhancements

Planned improvements:

- Automatic transcription triggering after encoding
- Enhanced transcript with chapters and keywords (currently commented out)
- Support for multiple transcription providers
- Batch transcription for multiple episodes
