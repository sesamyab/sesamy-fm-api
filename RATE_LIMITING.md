# Rate Limiting and Retry Logic

This document describes the rate limiting implementation for the FFmpeg container and the enhanced retry logic in workflows.

## Container Rate Limiting

The FFmpeg container now implements rate limiting to prevent multiple encoding jobs from running concurrently, which could overwhelm system resources.

### Key Features

1. **Single Job Limitation**: Only one encoding or chunking job can run at a time
2. **429 Response**: Returns HTTP 429 (Too Many Requests) when busy
3. **Job Tracking**: Tracks active jobs with unique IDs
4. **Cleanup**: Automatically cleans up job tracking when operations complete

### Rate Limit Response Format

```json
{
  "success": false,
  "error": "Encoding service is busy. Please retry in 10 seconds.",
  "retryAfter": 10,
  "activeJobs": 1
}
```

### Headers

- `Retry-After: 10` - Standard retry header
- `X-RateLimit-Limit: 1` - Maximum concurrent jobs
- `X-RateLimit-Remaining: 0` - Remaining capacity

## Workflow Retry Logic

Workflows now implement sophisticated retry logic with exponential backoff and rate limit awareness.

### Retry Parameters

- **Maximum Retry Time**: 1 hour (3600 seconds)
- **Base Delay**: 10 seconds
- **Maximum Delay**: 5 minutes (300 seconds)
- **Rate Limit Delay**: Respects `retryAfter` from 429 responses

### Retry Strategy

1. **Rate Limited (429)**:

   - Waits for the exact `retryAfter` duration
   - No additional exponential backoff delay
   - Continues retrying if time permits

2. **Connection Errors**:

   - Uses exponential backoff: `baseDelay * 2^(attempt-1)`
   - Caps at maximum delay of 5 minutes
   - Retries container disconnections, 503 errors, network errors

3. **Time Management**:
   - Stops retrying after 1 hour total
   - Ensures sufficient time remains for retry delays
   - Requires 30-second buffer for each retry attempt

### Example Retry Sequence

```
Attempt 1: Immediate
Attempt 2: +10 seconds (rate limited: wait 10s)
Attempt 3: +10 seconds (rate limited: wait 10s)
Attempt 4: +10 seconds (connection error: wait 10s exponential)
Attempt 5: +20 seconds (connection error: wait 20s exponential)
Attempt 6: +40 seconds (connection error: wait 40s exponential)
...continues with exponential backoff up to 5 minutes maximum delay
```

### Affected Workflows

The retry logic has been implemented in:

1. **Audio Encoding** (`utils.ts`): Main encoding workflow
2. **Audio Chunking** (`audio-chunking.ts`): Chunking workflow
3. **Encode for Processing** (`encode-for-processing.ts`): Processing workflow

### Logging

Enhanced logging provides visibility into retry behavior:

```
[RATE_LIMIT] Rejecting encode request - 1 jobs already active
[JOB_START] Started encoding job 123. Active jobs: 1
[JOB_END] Completed encoding job 123. Active jobs: 0
Encoding attempt 3 for format mp3_128 (45s elapsed)
Rate limited on attempt 3. Retrying after 10s...
Retryable error on attempt 4: Container disconnected. Retrying in 20s... (2847s left)
```

## Benefits

1. **Resource Protection**: Prevents container overload
2. **Graceful Degradation**: Handles busy periods elegantly
3. **Automatic Recovery**: Retries transient failures
4. **Time Bounds**: Prevents infinite retry loops
5. **Observability**: Comprehensive logging for debugging

## Configuration

The retry parameters can be adjusted by modifying constants in the workflow files:

```typescript
const maxRetryTime = 60 * 60 * 1000; // 1 hour
const baseDelay = 10 * 1000; // 10 seconds
const maxDelay = 5 * 60 * 1000; // 5 minutes
```

## Monitoring

Monitor the following metrics:

- Rate limit rejections (429 responses)
- Retry attempts and success rates
- Time to completion for workflows
- Active job counts over time
- Container resource utilization

## Testing

Run the rate limiting tests:

```bash
npm test rate-limiting.test.ts
```

The tests verify:

- Rate limiting behavior
- Retry timing calculations
- Job tracking accuracy
- Maximum time enforcement
