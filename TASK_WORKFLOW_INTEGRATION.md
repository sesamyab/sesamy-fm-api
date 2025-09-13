# Task-Workflow Integration Summary

## Changes Made

### 1. **Database Schema Updates**

- Added `workflowId` and `workflowInstanceId` fields to the `tasks` table
- Created new `workflows` table to track workflow instances
- Added foreign key relationship between tasks and workflows
- Generated migration `0006_far_firebrand.sql`

### 2. **New Services and Repositories**

- **WorkflowRepository**: CRUD operations for workflow entities
- **WorkflowService**: High-level workflow management, progress tracking
- **WorkflowProgressReporter**: Helper class for workflows to report progress back to tasks

### 3. **Task Service Integration**

- Added `audio_processing` task type that creates workflows instead of processing directly
- Modified TaskService constructor to accept audioProcessingWorkflow parameter
- Tasks now create and monitor workflows rather than doing work directly

### 4. **Audio Processing Workflow Enhancements**

- Added progress reporting throughout all workflow steps
- Workflows now accept `taskId` and `workflowId` parameters
- Progress updates are sent via HTTP to `/internal/workflow-progress` endpoint

### 5. **New Internal API**

- `/internal/workflow-progress` endpoint for workflows to report progress
- Updates both task and workflow progress in the database

### 6. **Removed Transcription Tasks**

- Removed standalone `transcribe` task type (now handled within workflows)
- Removed `src/transcription/` directory and all transcription routes
- Removed transcription-related methods from TaskService
- Transcription is now handled as part of the audio processing workflow

## Architecture Overview

```
Task Creation → Workflow Creation → Progress Updates → Completion
     ↓              ↓                    ↓              ↓
 [Task Entity] → [Workflow Entity] → [Progress API] → [Task Done]
```

### Flow:

1. **Client creates an `audio_processing` task**
2. **TaskService creates a Cloudflare Workflow instance**
3. **Workflow processes audio and reports progress via HTTP API**
4. **Progress updates both task and workflow entities in database**
5. **Workflow completion marks task as done**

## Benefits

1. **Better Progress Tracking**: Real-time progress updates from workflow steps
2. **Unified Processing**: All audio processing (including transcription) happens in one workflow
3. **Scalability**: Workflows can run independently and report back asynchronously
4. **Monitoring**: Both tasks and workflows are tracked in the database
5. **Flexibility**: Easy to extend with new workflow types

## Usage Example

```typescript
// Create an audio processing task
const task = await taskService.createTask("audio_processing", {
  episodeId: "episode-123",
  audioR2Key: "audio/episode-123/audio.mp3",
  encodingFormats: ["mp3_128", "mp3_320"],
});

// Task automatically creates and monitors workflow
// Progress can be tracked via task.progress and workflow progress API
```
