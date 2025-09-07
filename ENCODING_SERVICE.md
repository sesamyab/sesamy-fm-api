# FFmpeg Encoding Service Integration

## Overview

This project now uses a separate containerized encoding service for audio processing because FFmpeg WASM is not compatible with Cloudflare Workers runtime.

## Architecture

```
Main Service (Cloudflare Worker) → Encoding Service (Docker Container) → FFmpeg Processing
```

## Setup

### 1. Encoding Service

The encoding service is in `/workers/encoding-service/` and runs as a Node.js service with FFmpeg.

To run locally:

```bash
cd workers/encoding-service
npm install
npm run dev
```

To build and run with Docker:

```bash
cd workers/encoding-service
docker build -t encoding-service .
docker run -p 3000:3000 encoding-service
```

### 2. Main Service Configuration

Set the encoding service URL in your environment:

```bash
# For local development
export ENCODING_SERVICE_URL=http://localhost:3000

# For production (update with your deployed service URL)
export ENCODING_SERVICE_URL=https://your-encoding-service.example.com
```

### 3. Testing

Use the test script to validate the integration:

```bash
./test-encoding-service.sh
```

Or test individual endpoints:

**Test encoding via main service:**

```bash
curl -X POST http://localhost:8787/tasks/test-encode \
  -H "Content-Type: application/json" \
  -d '{"outputFormat": "mp3", "bitrate": 128}'
```

**Test encoding service directly:**

```bash
curl -X POST http://localhost:3000/test \
  -H "Content-Type: application/json" \
  -d '{"outputFormat": "mp3", "bitrate": 128}'
```

## Deployment

### Encoding Service Deployment

The encoding service needs to be deployed to a platform that supports Docker containers with FFmpeg:

1. **Railway**: Easy Docker deployment
2. **Fly.io**: Supports Docker with good performance
3. **AWS Fargate**: Scalable container service
4. **Google Cloud Run**: Serverless containers
5. **DigitalOcean App Platform**: Simple container deployment

### Example Fly.io Deployment

1. Install flyctl
2. In `/workers/encoding-service/`:

```bash
fly launch
fly deploy
```

3. Update your main service environment variable with the deployed URL.

## Endpoints

### Main Service Test Endpoint

- **POST** `/tasks/test-encode`
- **Auth**: None (testing only)
- **Body**:
  ```json
  {
    "audioUrl": "https://example.com/audio.mp3", // optional
    "outputFormat": "mp3", // optional, default: mp3
    "bitrate": 128 // optional, default: 128
  }
  ```

### Encoding Service Endpoints

- **GET** `/` - Health check
- **POST** `/test` - Test encoding with sample audio
- **POST** `/encode` - Encode provided audio URL
- **POST** `/batch` - Batch encode multiple files

## Error Handling

The integration includes proper error handling:

- Network failures to encoding service
- FFmpeg processing errors
- Invalid audio formats
- Missing dependencies

## Performance Notes

- The encoding service runs FFmpeg natively for best performance
- Docker container includes all necessary codecs
- Supports common audio formats: MP3, WAV, AAC, OGG
- Configurable bitrates and quality settings

## Security

- The encoding service should be deployed with proper network security
- Consider API keys or JWT tokens for production
- Validate input URLs to prevent SSRF attacks
- Limit file sizes and processing time
