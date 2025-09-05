# R2 Integration for Podcast Service

This service now includes full Cloudflare R2 integration for storing podcast audio files and images.

## 🗂️ Storage Structure

Files are stored in R2 with the following key structure:

```
audio/{show_id}/{episode_id}/{audio_id}/{filename}
```

Example:

```
audio/show-123/episode-456/audio-789/my-podcast-episode.mp3
```

## 🔧 Configuration

### R2 Bucket

- **Name**: `podcast-service-assets`
- **Binding**: `BUCKET` (in wrangler.toml)
- **Location**: Configured via Cloudflare Workers binding

### Wrangler Configuration

```toml
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "podcast-service-assets"
```

## 📡 API Usage

### Upload Audio File

```bash
curl -X POST https://podcast-service.sesamy-dev.workers.dev/shows/{show_id}/episodes/{episode_id}/audio \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "audio=@/path/to/your/audio.mp3"
```

### Response

```json
{
  "id": "uuid-audio-id",
  "episodeId": "episode-id",
  "fileName": "audio.mp3",
  "fileSize": 5242880,
  "mimeType": "audio/mpeg",
  "url": "https://podcast-service-assets.r2.dev/audio/show-id/episode-id/audio-id/audio.mp3",
  "uploadedAt": "2025-09-01T14:30:00.000Z"
}
```

## 🌐 Public Access

### R2 Public URLs

Files are accessible via R2's public domain:

```
https://podcast-service-assets.r2.dev/{key}
```

### Custom Domain (Recommended for Production)

You can configure a custom domain in Cloudflare to serve R2 files:

1. Go to Cloudflare Dashboard → R2 → Settings
2. Add a custom domain (e.g., `cdn.yourpodcast.com`)
3. Update the URL generation in `src/audio/service.ts`

## 🔒 Security Considerations

### File Upload Validation

- File type validation (audio/\* MIME types)
- File size limits (configurable)
- Authenticated uploads only

### Access Control

- Audio files are publicly accessible once uploaded
- Consider implementing signed URLs for private content
- Use Cloudflare Access for additional security layers

## 📊 File Management

### Supported Audio Formats

- MP3 (`audio/mpeg`)
- AAC (`audio/aac`)
- OGG (`audio/ogg`)
- WAV (`audio/wav`)
- M4A (`audio/m4a`)

### Metadata Storage

Audio metadata is stored in D1 database:

- File name and size
- MIME type
- R2 URL
- Upload timestamp
- Associated episode/show IDs

## 🚀 Benefits of R2 Integration

1. **Cost-Effective**: R2 has no egress fees
2. **Fast**: Global CDN distribution
3. **Scalable**: Handles large files efficiently
4. **Integrated**: Seamless with Cloudflare Workers
5. **Reliable**: Enterprise-grade storage

## 🛠️ Development

### Local Testing

During local development, if R2 bucket is not available, the service falls back to placeholder URLs for testing.

### Production Deployment

Ensure the R2 bucket exists and is properly bound in wrangler.toml before deployment.
