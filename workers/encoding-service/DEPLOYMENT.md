# Encoding Service Deployment Guide

## Important: Why Not Cloudflare Workers?

This encoding service **cannot** be deployed to Cloudflare Workers because:

1. **FFmpeg Binary**: Cloudflare Workers don't support native binaries like FFmpeg
2. **File System**: Limited filesystem access in Workers
3. **Process Spawning**: Cannot spawn child processes (`child_process.spawn`)

## Recommended Deployment Platforms

### 1. Railway (Recommended - Easiest)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway up
```

### 2. Fly.io (Good Performance)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Deploy
fly launch
fly deploy
```

### 3. Google Cloud Run (Scalable)

```bash
# Deploy directly from source
gcloud run deploy encoding-service \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### 4. Local Docker (For Testing)

```bash
# Build and run locally
npm run docker:build
npm run docker:run

# Service will be available at http://localhost:3000
```

## After Deployment

1. **Get your service URL** from the deployment platform
2. **Update the main service** environment variable:
   ```bash
   # In your main Cloudflare Worker
   export ENCODING_SERVICE_URL=https://your-deployed-service.railway.app
   ```
3. **Test the integration** using the test script

## Environment Variables

Set these in your deployment platform:

- `NODE_ENV=production`
- `PORT=3000` (or platform default)

## Cost Estimation

- **Railway**: ~$5/month for basic usage
- **Fly.io**: ~$2-10/month depending on usage
- **Google Cloud Run**: Pay per request, very cost-effective for low usage

## Alternative: WebAssembly FFmpeg

If you absolutely need Cloudflare Workers deployment, you could:

1. Use FFmpeg.wasm (but it's slower and has limitations)
2. Use Cloudflare's Audio Processing APIs (if available)
3. Integrate with external services like AWS MediaConvert

But the current architecture with external service is recommended for better performance and full FFmpeg capabilities.
