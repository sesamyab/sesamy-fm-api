# Storage Service Usage Examples

## Setting up the secret

First, add the signature secret to your Cloudflare Worker:

```bash
npx wrangler secret put STORAGE_SIGNATURE_SECRET
# Enter a secure random string when prompted (e.g., a UUID or long random string)
# Keep this secret secure and don't commit it to version control!
```

## Generating signed URLs in your worker code

```typescript
import {
  generateSignedUploadUrl,
  generateSignedDownloadUrl,
} from "./utils/storage";

// In your route handler or workflow
const uploadUrl = await generateSignedUploadUrl(
  c.env, // or this.env in workflows
  "podcasts/episode-123/audio.mp3",
  "audio/mpeg",
  3600 // 1 hour expiration
);

console.log("Upload URL:", uploadUrl.url);
// Result: /api/storage/file?path=podcasts%2Fepisode-123%2Faudio.mp3&expire=1699123456&signature=abc123&contentType=audio%2Fmpeg

const downloadUrl = await generateSignedDownloadUrl(
  c.env,
  "podcasts/episode-123/audio.mp3",
  7200 // 2 hours expiration
);

console.log("Download URL:", downloadUrl.url);
// Result: /api/storage/file?path=podcasts%2Fepisode-123%2Faudio.mp3&expire=1699130656&signature=def456
```

## Using the signed URLs

### Upload a file (PUT request):

```bash
curl -X PUT "https://your-domain.com/api/storage/file?path=podcasts%2Fepisode-123%2Faudio.mp3&expire=1699123456&signature=abc123&contentType=audio%2Fmpeg" \
  --data-binary @audio-file.mp3 \
  -H "Content-Type: audio/mpeg"
```

### Download a file (GET request):

```bash
curl "https://your-domain.com/api/storage/file?path=podcasts%2Fepisode-123%2Faudio.mp3&expire=1699130656&signature=def456"
```

## Security Features

1. **Signature verification**: Each URL is signed with HMAC-SHA256
2. **Expiration**: URLs automatically expire after the specified time
3. **Method binding**: Signatures are tied to specific HTTP methods (GET/PUT)
4. **Path binding**: Signatures are tied to specific file paths

## Integration with external services

You can now safely pass these signed URLs to external services (like encoding containers) that need to upload or download files from your R2 bucket without exposing your R2 credentials.

Example in your audio processing workflow:

```typescript
// Generate signed upload URL for encoded output
const uploadUrl = await generateSignedUploadUrl(
  this.env,
  `encoded/${episodeId}/output.mp3`,
  "audio/mpeg",
  1800 // 30 minutes for encoding to complete
);

// Pass to encoding service
const response = await encodingService.encode({
  inputUrl: "https://example.com/input.mp3",
  outputUrl: uploadUrl.url, // Our signed URL
  format: "mp3",
});
```
