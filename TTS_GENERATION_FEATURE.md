# TTS Generation Feature Implementation

## Overview

This implementation adds support for automatic Text-to-Speech (TTS) audio generation from script files. TTS can be triggered in two ways:

1. **Creating an episode with a `scriptUrl`** - Provide a URL to a script file when creating an episode
2. **Uploading a markdown file** - Drop a markdown (.md) file into the audio upload endpoint

When a script is provided, a background workflow is automatically triggered to generate audio using Cloudflare's Deepgram Aura TTS model.

## What Was Changed

### 1. Schema Updates (`src/episodes/schemas.ts` & `src/database/schema.ts`)

- Added optional `scriptUrl` property to `CreateEpisodeSchema` and `UpdateEpisodeSchema`
- Added `scriptUrl` column to the `episodes` table in the database
- Accepts a URL pointing to the script text file (stored in database for reference)

### 2. Audio Upload Endpoint Enhancement (`src/audio/routes.ts`)

- Modified `POST /shows/{show_id}/episodes/{episode_id}/audio` to accept both audio and markdown files
- Detects markdown files by MIME type (`text/markdown`) or file extension (`.md`, `.markdown`)
- When a markdown file is uploaded:
  - Stores the file in R2 under `scripts/{show_id}/{episode_id}/{script_id}/{filename}`
  - Updates episode's `scriptUrl` field
  - Generates a presigned URL for the TTS workflow to access
  - Automatically creates a TTS generation task
  - Returns success response with message indicating TTS generation has started

### 3. TTS Generation Workflow (`src/workflows/tts-generation/`)

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

### 4. Task Service Updates (`src/tasks/service.ts`)

- Added `tts_generation` as a new task type
- Implemented `handleTtsGeneration()` method
- Integrated TTS workflow binding into task processing
- Updated constructor to accept TTS workflow binding

### 5. Workflow Service Updates (`src/workflows/service.ts`)

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

### Method 1: Create Episode with TTS Generation

Create an episode with a `scriptUrl` pointing to a hosted script file:

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

### Method 2: Upload Markdown File (Recommended)

Upload a markdown file directly to the audio upload endpoint. The system will automatically:

- Store the markdown file in R2
- Update the episode's `scriptUrl`
- Trigger TTS generation

```bash
curl -X POST https://your-worker.workers.dev/shows/{show_id}/episodes/{episode_id}/audio \
  -H "Authorization: Bearer <token>" \
  -F "audio=@my-script.md"
```

**Response:**

```json
{
  "id": "script-uuid",
  "episodeId": "episode-uuid",
  "fileName": "my-script.md",
  "fileSize": 1234,
  "mimeType": "text/markdown",
  "url": "r2://scripts/show-id/episode-id/script-uuid/my-script.md",
  "uploadedAt": "2025-10-14T12:00:00Z",
  "message": "Script uploaded successfully. TTS generation started."
}
```

**Supported File Types:**

- Markdown files: `.md`, `.markdown`
- MIME type: `text/markdown`
- Audio files: `.mp3`, `.wav`, `.ogg`, etc. (uploaded normally without TTS)

**File Detection:**
The endpoint automatically detects markdown files by:

1. MIME type: `text/markdown`
2. File extension: `.md` or `.markdown`

If a markdown file is detected, it triggers TTS. Otherwise, it's treated as a regular audio upload.

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
voice: "shimmer"; // Options: shimmer, alloy, echo, fable, onyx, nova
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

### Method 1: Upload a Markdown File (Easiest)

1. Create a markdown file with your script:

   ```markdown
   # Episode Title

   Welcome to this episode. This is a test of the TTS generation system.
   We're using Deepgram's Aura model to convert this text into speech.
   ```

2. Create an episode first:

   ```bash
   curl -X POST http://localhost:8787/shows/{show_id}/episodes \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{
       "title": "TTS Test Episode",
       "description": "Testing TTS generation from markdown"
     }'
   ```

3. Upload the markdown file:

   ```bash
   curl -X POST http://localhost:8787/shows/{show_id}/episodes/{episode_id}/audio \
     -H "Authorization: Bearer <token>" \
     -F "audio=@script.md"
   ```

4. Check the response - it should indicate TTS generation has started

5. Monitor the task:

   ```bash
   curl -X GET http://localhost:8787/tasks/{task_id} \
     -H "Authorization: Bearer <token>"
   ```

6. Once completed, the episode will have an audioUrl that can be accessed

### Method 2: Using scriptUrl

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
