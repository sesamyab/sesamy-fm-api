# Copilot Instructions for Sesamy FM API

## Project Overview

This is a Cloudflare Workers project that provides a podcast management API with audio encoding, transcription, and media processing capabilities.

## Documentation Guidelines

**⚠️ IMPORTANT: Do NOT create new markdown documentation files without explicit user approval.**

When a user asks for documentation:

1. **First**, propose what documentation you plan to create and where
2. **Wait** for the user to approve or modify the plan
3. **Only then** create the documentation

This prevents documentation sprawl and keeps the codebase clean. The main documentation should be in `README.md`.

## Important Project Structure Notes

### Container Setup

- **USE `container_src/` folder** - This is the correct directory for the encoding container
- **DO NOT create a `workers/` folder** - This is incorrect for this project
- The encoding container is in `container_src/` with its own `package.json` and `index.js`
- The main worker code is in `src/` directory

### Key Directories

```
src/                    # Main Cloudflare Worker source code
container_src/          # Encoding container (Durable Object) - USE THIS
data/                   # SQLite database files
drizzle/               # Database migrations
test/                  # Test files
examples/              # Example scripts
```

### Architecture Components

#### Cloudflare Worker (src/)

- Main API endpoints in `src/app.ts`
- Worker entry point in `src/worker.ts`
- Task processing system in `src/tasks/`
- Audio processing in `src/audio/`
- Database schema in `src/database/schema.ts`

#### Encoding Container (container_src/)

- Durable Object for FFmpeg audio encoding
- Runs in a separate container with FFmpeg installed
- Handles streaming progress updates
- **This is NOT a separate worker - it's a Durable Object container**

#### Key Services

- **TaskService** (`src/tasks/service.ts`) - Core task processing system
- **AudioService** (`src/audio/service.ts`) - Audio handling and R2 integration
- **EpisodeService** (`src/episodes/service.ts`) - Episode management
- **ShowService** (`src/shows/service.ts`) - Podcast show management

### Task Types

The system supports these task types:

- `transcribe` - Audio transcription using Cloudflare AI (Whisper)
- `encode` - Audio encoding using FFmpeg in the container
- `audio_preprocess` - Audio preprocessing (32kbps mono conversion)
- `publish` - Episode publishing (stub)
- `notification` - Notification handling (stub)

### Database

- Uses D1 (SQLite) for data storage
- Drizzle ORM for database operations
- R2 for media file storage

### Deployment

#### Cloudflare Worker Deployment

- Deploy with `npx wrangler deploy`
- Environment variables configured in `wrangler.toml`
- Secrets managed with `npx wrangler secret put <NAME>`

#### AWS Lambda Encoding Service Deployment

The project uses AWS Lambda for audio encoding (instead of Cloudflare Durable Object containers). To deploy the Lambda:

1. **Build and push Docker image** (**CRITICAL: Must build for x86_64/amd64 architecture**):

   ```bash
   # Login to ECR
   AWS_PROFILE=dev aws ecr get-login-password --region us-east-1 | \
     docker login --username AWS --password-stdin \
     610396205502.dkr.ecr.us-east-1.amazonaws.com

   # Build for x86_64 (amd64) - Lambda requires this architecture
   # Use buildx with --platform flag to cross-compile on ARM Mac
   docker buildx build --platform linux/amd64 \
     -f Dockerfile.lambda \
     -t 610396205502.dkr.ecr.us-east-1.amazonaws.com/sesamy-encoding-dev:v1 \
     --load .

   # Push to ECR
   docker push 610396205502.dkr.ecr.us-east-1.amazonaws.com/sesamy-encoding-dev:v1
   ```

2. **Update Lambda function**:

   ```bash
   AWS_PROFILE=dev aws lambda update-function-code \
     --function-name sesamy-encoding-dev \
     --image-uri 610396205502.dkr.ecr.us-east-1.amazonaws.com/sesamy-encoding-dev:v1 \
     --region us-east-1
   ```

3. **Verify deployment**:
   ```bash
   AWS_PROFILE=dev aws lambda get-function-configuration \
     --function-name sesamy-encoding-dev \
     --region us-east-1 | grep -i "state\|update"
   ```

**Important Notes:**

- Use `DOCKER_BUILDKIT=0` to build with legacy Docker format (Lambda requires Docker v2 schema 2 manifest)
- Change tag version (e.g., `v1`, `v2`) for each deployment to avoid caching issues
- Lambda function URL: https://c6bf5it5y3cxvjdjret4wroeli0neapt.lambda-url.us-east-1.on.aws/
- The Lambda generates audio encodings and metadata (waveform, silences, ID3 tags)

## Common Patterns

### Creating Tasks

```typescript
await taskService.createTask("encode", {
  episodeId: "episode-123",
  audioUrl: "https://example.com/audio.mp3",
  outputFormat: "mp3",
  bitrate: 128,
});
```

### File Storage

- Original files stored in R2 under `episodes/{episodeId}/original/`
- Encoded files stored under `episodes/{episodeId}/encoded/`
- Transcripts stored under `transcripts/{episodeId}/`
- Uses signed URLs for secure access

### Testing Endpoints

- `/test/encode` - Test encoding without creating episodes
- `/test/transcribe` - Test transcription
- `/test/audio-preprocess` - Test audio preprocessing

## Development Guidelines

1. **Container Code**: Always modify `container_src/` for encoding-related changes
2. **Worker Code**: Main API logic goes in `src/`
3. **Database Changes**: Use Drizzle migrations in `drizzle/`
4. **New Features**: Follow the existing service/repository pattern
5. **Task Processing**: Extend TaskService for new task types
6. **Route Documentation**: Always add comment blocks above routes in route files

### Route Comment Block Format

When adding or modifying routes in any `routes.ts` file, always include a comment block above each `app.openapi()` call with the HTTP method and path:

```typescript
// --------------------------------
// HTTP_METHOD /path/to/endpoint
// --------------------------------
app.openapi(
  createRoute({
    method: "get",
    path: "/shows/{show_id}",
    // ... route configuration
  }),
  async (c) => {
    // ... handler implementation
  }
);
```

**Examples:**

```typescript
// --------------------------------
// GET /campaigns
// --------------------------------
app.openapi(/* ... */);

// --------------------------------
// POST /shows/{show_id}/episodes
// --------------------------------
app.openapi(/* ... */);

// --------------------------------
// DELETE /campaigns/{campaign_id}/creatives/{creative_id}
// --------------------------------
app.openapi(/* ... */);
```

This format makes it easy to:

- Navigate routes visually in the codebase
- Quickly understand API structure
- Maintain consistent documentation
- Support IDE search and navigation

## Important Notes

- The encoding container uses FFmpeg and requires specific dependencies
- Transcription uses Cloudflare AI Workers (Whisper model)
- All media files use R2 with signed URLs for security
- Task system supports both immediate queue processing and batch processing
- Progress tracking is built into the task system

## Cloudflare Workflows Development Guidelines

### ❌ CRITICAL: NEVER Use Console Logs Inside Workflow Steps

**NEVER use `console.log()` statements inside Cloudflare Workflow step functions (`step.do()` callbacks).**

Console logs inside workflow steps will:

- Interfere with JSON serialization
- Cause truncated or corrupted step outputs
- Break workflow data flow
- Not be visible in production anyway

```typescript
// ❌ WRONG - Console logs inside step functions break JSON output
const result = await step.do("step-name", async () => {
  console.log("This will break JSON output!"); // DON'T DO THIS
  return { data: "value" };
});

// ✅ CORRECT - Log after step completion
const result = await step.do("step-name", async () => {
  return { data: "value" };
});
console.log("Step completed:", result); // Log here instead
```

### 🐛 Workflow Debugging Best Practices

#### 1. Include Debug Info in Return Objects

```typescript
return {
  success: true,
  data: processedData,
  debugInfo: {
    processingTime: Date.now() - startTime,
    itemsProcessed: items.length,
    debugUrls: signedUrls, // Always include signed URLs for R2 files
  },
};
```

#### 2. Include Debug Context in Error Messages

```typescript
try {
  // Processing logic
} catch (error) {
  const debugContext = {
    chunkIndex: chunk.index,
    r2Key: chunk.r2Key,
    debugUrl: signedUrl,
    timestamp: new Date().toISOString(),
  };

  throw new Error(
    `Processing failed for chunk ${chunk.index}. ` +
      `Debug info: ${JSON.stringify(debugContext)}. ` +
      `Original error: ${error}`
  );
}
```

#### 3. Generate Signed URLs for All R2 Files

Always include signed download URLs in workflow outputs for R2 objects:

```typescript
// Generate debug URLs for files
const debugUrl = await generateSignedDownloadUrl(env, r2Key, 3600);
return {
  r2Key,
  size,
  debugUrl: debugUrl.url, // Include for easy debugging access
};
```

#### 4. Helper Methods Should Return Data, Not Log

```typescript
// ❌ WRONG - Helper method with console.log
private async generateDebugUrls(items: Item[]): Promise<DebugUrl[]> {
  const urls = await Promise.all(/* ... */);
  console.log(`Generated ${urls.length} debug URLs`); // BREAKS WORKFLOW
  return urls;
}

// ✅ CORRECT - Pure data return
private async generateDebugUrls(items: Item[]): Promise<DebugUrl[]> {
  const urls = await Promise.all(/* ... */);
  return urls; // Return structured data only
}
```

### 🚀 Why These Rules Matter

1. **Console logs inside workflow steps** interfere with JSON serialization
2. **Workflows are serverless** - console output may not be accessible
3. **Error messages are the primary debugging tool** in production
4. **Signed URLs provide immediate file access** for debugging
5. **Structured returns enable programmatic debugging**

Remember: **Workflow debugging relies on structured data returns and error context, not console output!**

```

```
