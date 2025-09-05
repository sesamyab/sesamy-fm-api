# R2 Pre-Signed URLs Implementation

This service now implements AWS S3-compatible pre-signed URLs for secure, time-limited access to audio files stored in Cloudflare R2.

## How It Works

1. **AWS Signature Version 4**: Uses the standard AWS signing algorithm that R2 understands natively
2. **8-Hour Expiration**: Pre-signed URLs are valid for 28,800 seconds (8 hours)
3. **Secure Access**: URLs contain cryptographic signatures that prevent unauthorized access or tampering
4. **Direct R2 Access**: URLs work directly with R2 - no proxy needed

## Implementation Details

### Pre-Signed URL Generation

The `R2PreSignedUrlGenerator` class implements AWS Signature Version 4 signing:

```typescript
const generator = new R2PreSignedUrlGenerator(accessKeyId, secretAccessKey);
const signedUrl = await generator.generatePresignedUrl(
  "podcast-service-assets",
  "audio/show/episode/audio-id/file.mp3",
  28800 // 8 hours
);
```

### URL Format

Pre-signed URLs with custom domain look like:

```
https://podcast-media.sesamy.dev/audio/show/episode/audio-id/file.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ACCESS_KEY%2F20250901%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20250901T120000Z&X-Amz-Expires=28800&X-Amz-SignedHeaders=host&X-Amz-Signature=...
```

Or with default R2 endpoint:

```
https://podcast-service-assets.r2.cloudflarestorage.com/audio/show/episode/audio-id/file.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=...
```

### Database Storage

- **R2 keys** are stored with `r2://` prefix for regeneration
- **Signed URLs** are generated on-demand for episodes and audio metadata
- **Fresh URLs** are created for each API request to ensure validity

## Required Environment Variables

Set these secrets in Cloudflare Workers:

```bash
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

To obtain these credentials:

1. Go to Cloudflare Dashboard > R2 > Manage R2 API tokens
2. Create new R2 token with "Read" permissions for your bucket
3. Copy the Access Key ID and Secret Access Key

### Custom Domain Setup

For branded URLs, configure a custom domain:

1. **Set up custom domain** in Cloudflare Dashboard > R2 > Settings > Custom domains
2. **Configure R2_ENDPOINT** in wrangler.toml:
   ```toml
   R2_ENDPOINT = "https://podcast-media.sesamy.dev"
   ```
3. **Benefits**: Branded URLs, better caching, improved performance

## API Behavior

### Audio Upload

- Uploads file to R2 with structured key
- Generates pre-signed URL for immediate access
- Stores `r2://` prefixed key in database
- Updates episode with signed URL

### Audio Retrieval

- Generates fresh pre-signed URL on each request
- Ensures URL is always valid (not expired)
- Falls back to `r2://` format if signing fails

### Example API Response

```json
{
  "id": "audio-uuid",
  "episodeId": "episode-uuid",
  "filename": "episode-01.mp3",
  "fileSize": 15728640,
  "mimeType": "audio/mpeg",
  "url": "https://podcast-service-assets.r2.cloudflarestorage.com/audio/show/episode/audio-id/episode-01.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=..."
}
```

## Security Features

- **Cryptographic Signing**: URLs are signed with HMAC-SHA256
- **Time-Limited**: URLs expire after 8 hours
- **Tamper-Proof**: Any modification invalidates the signature
- **Host Verification**: Signature includes the host header
- **Direct R2 Validation**: R2 validates signatures natively

## Error Handling

- **Missing Credentials**: Falls back to `r2://` format
- **Signing Errors**: Logged as warnings, service continues
- **Expired URLs**: R2 returns 403 Forbidden
- **Invalid Signatures**: R2 returns 403 Forbidden

## Monitoring

Key metrics to monitor:

- Pre-signed URL generation success rate
- R2 authentication errors (403s)
- URL expiration rates
- Fallback to `r2://` frequency

## Migration Notes

- **Old JWT URLs**: Will stop working immediately
- **New Pre-Signed URLs**: Work directly with R2
- **Database**: Still stores `r2://` keys for regeneration
- **Backward Compatibility**: Service handles both formats gracefully

## 🔒 Security Features

### JWT Token Validation

- **Expiration**: Tokens expire after exactly 8 hours
- **Purpose Check**: Token must have `purpose: "audio_access"`
- **Secret Signing**: Uses same JWT secret as API authentication
- **URL Encoding**: Tokens are properly URL-encoded

### Access Control

- **Time-Limited**: URLs automatically expire after 8 hours
- **Non-Transferable**: Each URL is tied to specific R2 key
- **Revocable**: Changing JWT secret invalidates all tokens
- **Auditable**: Token generation is logged

## 📡 API Usage

### Get Audio Metadata (Returns Signed URL)

```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  https://podcast-service.sesamy-dev.workers.dev/shows/{show_id}/episodes/{episode_id}/audio

# Response includes fresh signed URL:
{
  "id": "audio-uuid",
  "episodeId": "episode-uuid",
  "fileName": "episode.mp3",
  "fileSize": 5242880,
  "mimeType": "audio/mpeg",
  "url": "https://podcast-service-assets.r2.dev/audio/.../episode.mp3?token=eyJ...",
  "uploadedAt": "2025-09-01T15:30:00.000Z"
}
```

### Episode with Audio URL

```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  https://podcast-service.sesamy-dev.workers.dev/shows/{show_id}/episodes/{episode_id}

# Response includes signed audioUrl:
{
  "id": "episode-uuid",
  "showId": "show-uuid",
  "title": "Episode Title",
  "audioUrl": "https://podcast-service-assets.r2.dev/audio/.../episode.mp3?token=eyJ...",
  // ... other episode fields
}
```

## 🔄 URL Refresh Strategy

### Current Implementation

- **Upload**: Fresh signed URL generated and stored in episode record
- **Retrieval**: Audio metadata endpoint generates fresh signed URL on-demand
- **Storage**: R2 keys stored in database to enable regeneration

### Future Enhancements

Consider implementing automatic URL refresh for episodes:

```typescript
// Potential enhancement: Refresh expired URLs in episodes
async refreshAudioUrlIfNeeded(episode) {
  if (episode.audioUrl && this.isUrlExpired(episode.audioUrl)) {
    const newSignedUrl = await this.generateSignedUrlFromEpisodeUrl(episode.audioUrl);
    await this.episodeRepository.update(episode.showId, episode.id, {
      audioUrl: newSignedUrl
    });
  }
}
```

## 🛡️ Security Considerations

### Production Recommendations

1. **JWT Secret Rotation**: Regularly rotate JWT secrets to invalidate old tokens
2. **Scope Validation**: Consider adding user/scope restrictions to tokens
3. **Rate Limiting**: Implement rate limits on signed URL generation
4. **Access Logging**: Log signed URL generation and access patterns
5. **Custom Domain**: Use branded domain instead of `r2.dev` for production

### Token Security

- Tokens include R2 bucket name to prevent cross-bucket access
- Purpose field prevents token reuse for other functions
- Expiration prevents indefinite access to old URLs
- URL encoding prevents injection attacks

## 📊 Monitoring

### Key Metrics to Track

- Signed URL generation rate
- Token validation success/failure rate
- URL expiration rates
- R2 access patterns
- Failed audio access attempts

### Debugging

- Token generation logged with key and expiration
- Invalid token access attempts logged
- R2 access errors logged with context

This implementation provides secure, time-limited access to audio files while maintaining performance and scalability on Cloudflare's edge network.
