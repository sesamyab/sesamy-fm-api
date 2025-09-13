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

Configure the encoding service endpoint in your environment:

#### **Service Provider Selection**

```bash
# Choose encoding service provider (defaults to 'aws' if not set)
export ENCODING_SERVICE_PROVIDER=aws      # Use AWS Lambda (default)
# or
export ENCODING_SERVICE_PROVIDER=cloudflare  # Use Cloudflare Container
```

#### **For AWS Lambda Deployment**

```bash
# Set the Lambda Function URL from CDK deployment
export AWS_LAMBDA_ENCODING_URL=https://your-lambda-url.lambda-url.us-east-1.on.aws
export AWS_LAMBDA_API_KEY=optional-api-key  # if using secured access
```

#### **For Container Deployment**

```bash
# For local development
export ENCODING_SERVICE_URL=http://localhost:3000

# For production (update with your deployed service URL)
export ENCODING_SERVICE_URL=https://your-encoding-service.example.com
```

**Service Selection Logic:**

- If `ENCODING_SERVICE_PROVIDER=aws` and AWS Lambda URL is configured → Uses AWS Lambda
- If `ENCODING_SERVICE_PROVIDER=cloudflare` and Cloudflare container is available → Uses Cloudflare Container
- Fallback: Uses any available service (AWS Lambda preferred)

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

The encoding service supports multiple deployment options:

#### **AWS Lambda (Recommended)**

- **Maximum Performance**: 10,240 MB memory, 15-minute timeout
- **Auto-scaling**: Handles concurrent requests automatically
- **Cost Effective**: Pay only for actual usage
- **Deployment**: Use AWS CDK (see `cdk/` directory)

```bash
cd cdk
./deploy.sh
```

#### **Other Container Platforms**

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
