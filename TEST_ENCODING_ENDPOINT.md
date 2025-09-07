# Test Encoding Endpoint

This document describes the test encoding endpoint that allows you to validate FFmpeg encoding functionality.

## Endpoint

**POST** `/tasks/test-encode`

## Purpose

This endpoint creates a test encoding task using a predefined audio file to validate that FFmpeg WASM encoding is working correctly in your environment.

## Authentication

**No authentication required** - This is a test endpoint designed for easy validation.

## Request Body

```json
{
  "audioUrl": "https://example.com/audio.mp3", // Optional: custom audio URL
  "outputFormat": "mp3", // Optional: "mp3" or "aac" (default: "mp3")
  "bitrate": 128 // Optional: 64-320 kbps (default: 128)
}
```

### Parameters

| Parameter      | Type   | Required | Default              | Description                       |
| -------------- | ------ | -------- | -------------------- | --------------------------------- |
| `audioUrl`     | string | No       | Predefined test file | URL of audio file to encode       |
| `outputFormat` | enum   | No       | `"mp3"`              | Output format: `"mp3"` or `"aac"` |
| `bitrate`      | number | No       | `128`                | Output bitrate (64-320 kbps)      |

## Response

### Success (201 Created)

```json
{
  "task": {
    "id": 123,
    "type": "encode",
    "status": "pending",
    "payload": {
      "episodeId": "test-encode-1694087400000",
      "audioUrl": "https://podcast-media.sesamy.dev/audio/...",
      "outputFormat": "mp3",
      "bitrate": 128
    },
    "result": null,
    "error": null,
    "attempts": 0,
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z"
  },
  "testInfo": {
    "audioUrl": "https://podcast-media.sesamy.dev/audio/...",
    "outputFormat": "mp3",
    "bitrate": 128,
    "estimatedSize": "960 KB"
  }
}
```

## Usage Examples

### Basic Test (Default Parameters)

```bash
curl -X POST https://podcast-service.sesamy-dev.workers.dev/tasks/test-encode \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Custom Format and Bitrate

```bash
curl -X POST https://podcast-service.sesamy-dev.workers.dev/tasks/test-encode \
  -H "Content-Type: application/json" \
  -d '{
    "outputFormat": "aac",
    "bitrate": 192
  }'
```

### Custom Audio File

```bash
curl -X POST https://podcast-service.sesamy-dev.workers.dev/tasks/test-encode \
  -H "Content-Type: application/json" \
  -d '{
    "audioUrl": "https://example.com/your-audio.wav",
    "outputFormat": "mp3",
    "bitrate": 128
  }'
```

## Monitoring Task Progress

After creating the test task, monitor its progress using the task status endpoint (note: task status endpoint still requires authentication):

```bash
# Get task status (requires authentication)
curl -X GET https://podcast-service.sesamy-dev.workers.dev/tasks/{task_id} \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Task Status Examples

**Pending:**

```json
{
  "id": 123,
  "type": "encode",
  "status": "pending",
  "payload": { ... },
  "result": null,
  "error": null
}
```

**Processing:**

```json
{
  "id": 123,
  "type": "encode",
  "status": "processing",
  "payload": { ... },
  "result": null,
  "error": null
}
```

**Completed:**

```json
{
  "id": 123,
  "type": "encode",
  "status": "done",
  "payload": { ... },
  "result": {
    "encodedUrl": "https://podcast-media.sesamy.dev/episodes/test-encode-123/encoded/uuid.mp3",
    "encodedKey": "episodes/test-encode-123/encoded/uuid.mp3",
    "format": "mp3",
    "bitrate": 128,
    "size": 983040,
    "completedAt": "2024-01-15T10:35:00.000Z"
  },
  "error": null
}
```

**Failed:**

```json
{
  "id": 123,
  "type": "encode",
  "status": "failed",
  "payload": { ... },
  "result": null,
  "error": "Failed to fetch audio file: 404 Not Found"
}
```

## Test Scripts

### Quick Test Script

```javascript
// Node.js test script
const API_BASE = "https://podcast-service.sesamy-dev.workers.dev";

async function quickTest() {
  // Create test task (no authentication needed)
  const response = await fetch(`${API_BASE}/tasks/test-encode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ outputFormat: "mp3", bitrate: 128 }),
  });

  const result = await response.json();
  console.log("Task created:", result.task.id);

  // Monitor progress (requires authentication)
  // ... (see full example in examples/test-encode-endpoint.js)
}
```

### Using the Provided Test Script

```bash
# No JWT token needed for creating test tasks
# But set it for monitoring task progress
export JWT_TOKEN="your-jwt-token-here"

# Run basic test
node examples/test-encode-endpoint.js

# Run multiple scenarios test
node examples/test-encode-endpoint.js --multiple
```

## Expected Results

When the encoding completes successfully, you should see:

1. **Task Status**: Changed to `"done"`
2. **Encoded File**: Uploaded to R2 storage at the `encodedUrl`
3. **File Info**: Size, format, and bitrate in the result
4. **Event**: `episode.encoding_completed` event published

## Troubleshooting

### Common Issues

1. **Task Stays Pending**

   - Check if task processor is running
   - Verify queue bindings are configured

2. **Encoding Fails**

   - Check if R2 bucket binding is available
   - Verify audio URL is accessible
   - Check worker memory limits

3. **FFmpeg Errors**

   - Verify FFmpeg WASM libraries are available
   - Check audio format is supported
   - Ensure sufficient execution time

4. **Cannot Monitor Task Progress**
   - Task status endpoint still requires authentication
   - Verify JWT token is valid for monitoring

### Debug Information

Enable debug logging by checking the worker logs:

```bash
wrangler tail --env production
```

## Default Test Audio

The endpoint uses this predefined test audio file when no `audioUrl` is provided:

- **URL**: `https://podcast-media.sesamy.dev/audio/b0253f27-f247-46be-a9df-df7fbc1bc437/0a215bd9-65a5-4e71-9566-860ea84da493/2b6418e9-ea7c-42b1-ab63-0ac70d662e71/8f7cd1ff-dfcd-4184-bff1-bcf776c80b92.mp3`
- **Format**: MP3
- **Purpose**: Validates end-to-end encoding functionality

## Performance Metrics

Typical encoding times (may vary based on worker location and load):

- **Small files (< 1MB)**: 10-30 seconds
- **Medium files (1-5MB)**: 30-90 seconds
- **Large files (5-20MB)**: 1-5 minutes

## Integration Testing

Use this endpoint as part of your CI/CD pipeline to validate encoding functionality:

```yaml
# GitHub Actions example
- name: Test Encoding
  run: |
    export JWT_TOKEN="${{ secrets.JWT_TOKEN }}"
    node examples/test-encode-endpoint.js
```
