# Audio Processing Workflow - New Strategy Implementation

This document explains the implementation of the new workflow strategy for the audio processing workflow.

## Implementation Status

### ✅ Completed Steps

- **Initialize Workflow** - Converted to class-based step with Zod validation
- **Encode for Processing** - Converted to class-based step with Zod validation
- **Prepare Chunk Storage** - Converted to class-based step with Zod validation

### 🔄 In Progress Steps

The following steps still use the legacy function approach but have placeholder classes for debug endpoints:

- Audio Chunking
- Transcribe Chunks
- Audio Encoding
- Update Episode Encodings
- Cleanup Resources
- Finalize Processing

## New Strategy Features Implemented

### 1. ✅ Single File Management

- The main workflow (`index.ts`) orchestrates all steps
- Each step receives minimal input and returns structured output with signed URLs

### 2. ✅ Minimal Input/Output with Zod Validation

- All implemented steps use Zod schemas for input/output validation
- Type safety is enforced at runtime
- Clear error messages for validation failures

### 3. ✅ Raw Data Handling via Signed URLs

- Audio files are stored in R2 and passed as signed URLs
- No raw audio data is passed between steps
- Each step outputs `signedUrls` array for created files

### 4. ✅ Debug REST Endpoints

- Debug routes available at `/wf-debug/audio-processing/{step-name}`
- Implemented endpoints:
  - `POST /wf-debug/audio-processing/initialize`
  - `POST /wf-debug/audio-processing/encode`
  - `POST /wf-debug/audio-processing/prepare-chunks`
- Placeholder endpoints for remaining steps

### 5. ✅ Signed Link Outputs

- Each step returns `signedUrls` array containing URLs to created files
- Enables easy debugging and manual invocation

## Usage Examples

### Debug Endpoint Usage

#### Initialize Workflow Step

```bash
curl -X POST http://localhost:8787/wf-debug/audio-processing/initialize \\
  -H "Content-Type: application/json" \\
  -d '{
    "episodeId": "episode-123",
    "audioR2Key": "uploads/audio-file.mp3",
    "chunkDuration": 60,
    "transcriptionLanguage": "en"
  }'
```

#### Encode for Processing Step

```bash
curl -X POST http://localhost:8787/wf-debug/audio-processing/encode \\
  -H "Content-Type: application/json" \\
  -d '{
    "workflowId": "workflow-uuid",
    "episodeId": "episode-123",
    "audioR2Key": "uploads/audio-file.mp3",
    "chunkDuration": 60,
    "overlapDuration": 2,
    "encodingFormats": ["mp3_128"],
    "startedAt": "2025-09-09T10:00:00.000Z",
    "transcriptionLanguage": "en",
    "previewDownloadUrl": "https://signed-url"
  }'
```

### Programmatic Usage

```typescript
import { InitializeWorkflowStep } from "./workflows/audio-processing";

// Create step instance
const initStep = new InitializeWorkflowStep(env);

// Execute with validation
const result = await initStep.execute({
  episodeId: "episode-123",
  audioR2Key: "uploads/audio.mp3",
});

// Result includes signedUrls for debugging
console.log("Created URLs:", result.signedUrls);
```

## File Structure

```
src/workflows/audio-processing/
├── index.ts                    # Main workflow orchestrator
├── routes.ts                   # Debug REST endpoints
├── types.ts                    # Zod schemas and TypeScript types
├── step-classes.ts             # Placeholder step classes
├── initialize-workflow.ts      # ✅ Implemented step class
├── encode-for-processing.ts    # ✅ Implemented step class
├── prepare-chunk-storage.ts    # ✅ Implemented step class
├── audio-chunking.ts           # 🔄 Legacy function
├── transcribe-chunks.ts        # 🔄 Legacy function
├── audio-encoding.ts           # 🔄 Legacy function
├── update-episode-encodings.ts # 🔄 Legacy function
├── cleanup-resources.ts        # 🔄 Legacy function
├── finalize-processing.ts      # 🔄 Legacy function
└── utils.ts                    # Utility functions
```

## Next Steps

1. **Convert remaining steps** to class-based approach with Zod validation
2. **Implement proper debug endpoints** for all steps
3. **Add comprehensive error handling** and retry logic to step classes
4. **Document input/output schemas** for each step
5. **Add integration tests** for the new step-based approach

## Backward Compatibility

- Legacy function exports are maintained for existing code
- Main workflow continues to work with existing callers
- New step classes can be adopted incrementally
- Debug endpoints are optional and can be disabled in production

## Production Deployment

Before production deployment:

1. Comment out debug routes in `routes.ts`
2. Ensure all steps are converted to class-based approach
3. Validate error handling and retry logic
4. Test end-to-end workflow execution
