# TTS Generation Feature Implementation

## Overview

This implementation adds support for automatic Text-to-Speech (TTS) audio generation when creating episodes with a script URL. When an episode is created with a `scriptUrl`, a background workflow is automatically triggered to generate audio using Cloudflare's Deepgram Aura TTS model.

## What Was Changed

### 1. Schema Updates (`src/episodes/schemas.ts`)
- Added optional `scriptUrl` property to `CreateEpisodeSchema`
- Accepts a URL pointing to the script text file

### 2. TTS Generation Workflow (`src/workflows/tts-generation/`)

#### `types.ts`
- Defined workflow parameter schemas and types
- Added validation for episode ID, script URL, voice, and model parameters
- Default voice: "shimmer"
- Default model: "@cf/deepgram/aura-1"

#### `index.ts` - Main Workflow Implementation
The workflow consists of 5 steps:

1. **Initialize**: Set up workflow state and validate parameters
2. **Fetch Script**: Download script content from the provided URL
3. **Generate TTS**: Use Cloudflare AI with Deepgram Aura to generate MP3 audio
4. **Update Episode**: Store the generated audio in R2 and update the episode record
5. **Complete**: Update task status and record results

Key features:
- Automatic retry logic with configurable delays
- Progress tracking throughout the workflow
- Direct R2 upload with presigned URLs for access
- Graceful error handling and logging

### 3. Task Service Updates (`src/tasks/service.ts`)
- Added `tts_generation` as a new task type
- Implemented `handleTtsGeneration()` method
- Integrated TTS workflow binding into task processing
- Updated constructor to accept TTS workflow binding

### 4. Workflow Service Updates (`src/workflows/service.ts`)
- Added support for "tts-generation" workflow name
- Set estimated duration: "1-3 minutes"
- Integrated TTS workflow creation logic

### 5. Episode Routes Updates (`src/episodes/routes.ts`)
- Modified episode creation handler to detect `scriptUrl`
- Automatically creates TTS generation task when scriptUrl is provided
- Graceful error handling - episode creation succeeds even if TTS task creation fails
- Updated function signature to accept TTS workflow binding

### 6. Application Setup (`src/app.ts`, `src/worker.ts`)
- Added TTS workflow binding parameter throughout the application stack
- Updated `createApp()` to accept and pass TTS workflow binding
- Exported `TtsGenerationWorkflow` from worker
- Added `TTS_GENERATION_WORKFLOW` environment binding

### 7. Configuration (`wrangler.toml`)
- Added workflow binding configuration:
  ```toml
  [[workflows]]
  name = "tts-generation-workflow"
  binding = "TTS_GENERATION_WORKFLOW"
  class_name = "TtsGenerationWorkflow"
  ```

## How It Works

### Episode Creation Flow

```
1. User creates episode with scriptUrl
   POST /shows/{show_id}/episodes
   {
     "title": "My Episode",
     "description": "...",
     "scriptUrl": "https://example.com/script.txt"
   }

2. Episode record is created in database

3. If scriptUrl is present:
   a. Create TTS generation task
   b. Task immediately triggers workflow
   c. Episode creation response returned

4. Workflow executes in background:
   a. Fetch script from URL
   b. Generate audio with Deepgram Aura
   c. Upload MP3 to R2 bucket
   d. Update episode with audioUrl
   e. Mark task as completed
```

### Audio Storage

Generated audio is stored in R2 with the following structure:
```
r2://tts/{episodeId}/{uuid}.mp3
```

The episode's `audioUrl` field is updated with the R2 URL in the format:
```
r2://tts/abc-123/audio-uuid.mp3
```

## API Usage

### Create Episode with TTS Generation

```bash
curl -X POST https://your-worker.workers.dev/shows/{show_id}/episodes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Generated Episode",
    "description": "This episode uses TTS",
    "scriptUrl": "https://example.com/my-script.txt"
  }'
```

The script file should contain plain text that will be converted to speech.

### Check Task Status

After creating the episode, you can check the TTS generation task status:

```bash
curl -X GET https://your-worker.workers.dev/tasks/{task_id} \
  -H "Authorization: Bearer <token>"
```

Response includes:
- `status`: "pending", "processing", "completed", or "failed"
- `progress`: Percentage complete (0-100)
- `step`: Current workflow step description
- `result`: Final audio URL and metadata when completed

## Configuration Options

### Voice Selection
The default voice is "shimmer". To use a different voice, modify the payload in `src/episodes/routes.ts`:

```typescript
voice: "shimmer" // Options: shimmer, alloy, echo, fable, onyx, nova
```

### TTS Model
The default model is `@cf/deepgram/aura-1`. This can be configured in the task creation.

## Monitoring and Debugging

### Task Monitoring
- Tasks are tracked in the `tasks` table
- Monitor progress through the `/tasks/{id}` endpoint
- Check workflow status via `/workflows/instances/{workflowId}`

### Logs
The workflow logs detailed information at each step:
- Script fetching progress
- TTS generation status
- R2 upload confirmation
- Episode update results

### Error Handling
- Failed workflows automatically retry with exponential backoff
- Task errors are captured in the `error` field
- Episode creation succeeds even if TTS generation fails

## Database Schema

No new tables required. The existing schema supports TTS generation:
- `episodes` table already has `audioUrl` field
- `tasks` table tracks TTS generation progress
- `workflows` table monitors workflow execution

## Future Enhancements

Potential improvements:
1. Support for SSML (Speech Synthesis Markup Language) input
2. Voice cloning for custom voices
3. Multiple audio format outputs (WAV, OGG, etc.)
4. Batch script processing
5. Real-time streaming for long scripts
6. Cost tracking and analytics
7. Voice parameter customization (speed, pitch, volume)

## Testing

To test the TTS generation:

1. Create a simple text file and host it (or use a URL):
   ```
   https://example.com/test-script.txt
   ```

2. Create an episode with the scriptUrl:
   ```bash
   curl -X POST http://localhost:8787/shows/{show_id}/episodes \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{
       "title": "TTS Test Episode",
       "description": "Testing TTS generation",
       "scriptUrl": "https://example.com/test-script.txt"
     }'
   ```

3. Monitor the task:
   ```bash
   curl -X GET http://localhost:8787/tasks/{task_id} \
     -H "Authorization: Bearer <token>"
   ```

4. Once completed, the episode will have an audioUrl that can be accessed.

## Security Considerations

- Script URLs must be publicly accessible (workflow fetches them)
- Generated audio is stored in R2 with organization isolation
- Task creation requires appropriate permissions (podcast:write)
- Audio URLs are returned with R2 presigned URLs for secure access

## Performance

- TTS generation typically takes 1-3 minutes depending on script length
- Workflow runs asynchronously - doesn't block episode creation
- Uses Cloudflare's edge network for optimal performance
- Automatic retry logic ensures reliability
