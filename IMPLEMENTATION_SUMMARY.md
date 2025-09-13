# Rate Limiting Implementation Summary

## Changes Made

### 1. Container Rate Limiting (`container_src/index.js`)

**Added job tracking:**

- `activeJobs` Set to track running jobs
- `jobCounter` for unique job IDs
- Enhanced health endpoint to show active job count

**Rate limiting logic:**

- Returns 429 status when `activeJobs.size > 0`
- Includes standard `Retry-After` header (10 seconds)
- Added `X-RateLimit-*` headers for API compliance
- Automatic cleanup in `finally` blocks

**Endpoints affected:**

- `/encode` - Single encoding jobs
- `/chunk` - Audio chunking jobs

### 2. Workflow Retry Logic

**Enhanced retry parameters:**

- Maximum retry time: 1 hour (3600 seconds)
- Base delay: 10 seconds
- Maximum delay: 5 minutes
- Respects 429 `retryAfter` values

**Updated files:**

- `src/workflows/audio-processing/utils.ts` - Main encoding retry logic
- `src/workflows/audio-processing/audio-chunking.ts` - Chunking retry logic
- `src/workflows/audio-processing/encode-for-processing.ts` - Processing retry logic

**Retry behavior:**

- Handles 429 responses with exact `retryAfter` delays
- Uses exponential backoff for connection errors
- Stops after 1 hour maximum retry time
- Requires 30-second buffer for each attempt
- Enhanced logging for observability

### 3. Testing and Documentation

**Test file:** `test/rate-limiting.test.ts`

- Verifies rate limiting responses
- Tests exponential backoff calculations
- Validates job tracking behavior
- Confirms 1-hour maximum retry enforcement

**Documentation:** `RATE_LIMITING.md`

- Complete feature overview
- Configuration options
- Monitoring recommendations
- Usage examples

## Key Benefits

1. **Prevents Resource Overload**: Only one FFmpeg job runs at a time
2. **Graceful Error Handling**: 429 responses with retry guidance
3. **Automatic Recovery**: Retries transient failures up to 1 hour
4. **Observability**: Comprehensive logging for debugging
5. **Time Bounds**: Prevents infinite retry loops

## Usage

The implementation is transparent to existing workflows. When the container is busy:

1. Container returns 429 with `retryAfter: 10`
2. Workflow waits exactly 10 seconds
3. Workflow retries the request
4. Process continues for up to 1 hour maximum

For connection errors, exponential backoff applies:

- Attempt 1: Immediate
- Attempt 2: +10 seconds
- Attempt 3: +20 seconds
- Attempt 4: +40 seconds
- ...up to 5 minutes maximum delay

## Deployment

No configuration changes required. The rate limiting is automatically active once deployed.

Monitor logs for:

- `[RATE_LIMIT]` - Rate limiting in action
- `[JOB_START]`/`[JOB_END]` - Job lifecycle
- Retry attempt logs with timing information
