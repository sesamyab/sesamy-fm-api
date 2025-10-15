# Markdown Upload for TTS Generation - Enhancement

## Summary

Enhanced the audio upload endpoint to accept markdown files and automatically trigger TTS generation. This provides a more intuitive way to generate audio episodes from scripts.

## What Changed

### Audio Upload Endpoint (`src/audio/routes.ts`)

**Before:** Only accepted audio files (mp3, wav, etc.)

**After:** Accepts both audio files AND markdown files

- Detects markdown by MIME type (`text/markdown`) or extension (`.md`, `.markdown`)
- When markdown is uploaded:
  1. Stores file in R2 under `scripts/{show_id}/{episode_id}/{script_id}/{filename}`
  2. Updates episode's `scriptUrl` field
  3. Generates presigned URL for TTS workflow access
  4. Creates TTS generation task automatically
  5. Returns success response with message

### Route Changes

**Endpoint:** `POST /shows/{show_id}/episodes/{episode_id}/audio`

**Updated Description:**

- Old: "Upload an audio file for an episode"
- New: "Upload an audio file or markdown script file for an episode. If a markdown file is uploaded, it will trigger TTS generation."

**Behavior:**

```
IF file is markdown:
    → Store as script
    → Trigger TTS generation
    → Return task info
ELSE:
    → Store as audio (normal behavior)
    → Return upload info
```

## Usage

### Example: Upload Markdown File

```bash
curl -X POST https://api.example.com/shows/{show_id}/episodes/{episode_id}/audio \
  -H "Authorization: Bearer <token>" \
  -F "audio=@my-script.md"
```

### Example Response (Markdown Upload)

```json
{
  "id": "abc-123",
  "episodeId": "episode-uuid",
  "fileName": "my-script.md",
  "fileSize": 1234,
  "mimeType": "text/markdown",
  "url": "r2://scripts/show-id/episode-id/abc-123/my-script.md",
  "uploadedAt": "2025-10-14T12:00:00Z",
  "message": "Script uploaded successfully. TTS generation started."
}
```

### Example Response (Audio Upload - unchanged)

```json
{
  "id": "xyz-789",
  "episodeId": "episode-uuid",
  "fileName": "audio.mp3",
  "fileSize": 5678,
  "mimeType": "audio/mpeg",
  "url": "r2://audio/show-id/episode-id/xyz-789/audio.mp3",
  "uploadedAt": "2025-10-14T12:00:00Z"
}
```

## Implementation Details

### File Detection Logic

```typescript
const isMarkdown =
  audioFile.type === "text/markdown" ||
  audioFile.name.endsWith(".md") ||
  audioFile.name.endsWith(".markdown");
```

### Storage Structure

**Scripts:** `scripts/{show_id}/{episode_id}/{script_id}/{filename}.md`
**Generated Audio:** `tts/{episode_id}/{audio_id}.mp3`
**Regular Audio:** `audio/{show_id}/{episode_id}/{audio_id}/{filename}`

### Database Updates

- Episode's `scriptUrl` is updated with the R2 key (`r2://scripts/...`)
- TTS task is created with status "pending"
- Once TTS completes, episode's `audioUrl` is updated with generated audio

## User Experience

### Drag & Drop Workflow

1. User creates an episode
2. User drags and drops a markdown file into the audio upload area
3. System detects it's markdown and stores as script
4. TTS generation starts automatically
5. User can monitor progress via tasks API
6. Once complete, episode has both scriptUrl and audioUrl

### Benefits

- **Intuitive:** Drop markdown file just like you would drop an audio file
- **Automatic:** No need to manually trigger TTS or provide external URLs
- **Stored:** Script is preserved in R2 for future reference
- **Flexible:** Can still upload regular audio files the same way

## Backward Compatibility

✅ **Fully backward compatible**

- Existing audio upload behavior unchanged
- Only adds new functionality for markdown files
- No breaking changes to API

## Testing

### Test with Markdown

```bash
# Create test markdown file
echo "# Test Script

This is a test of the TTS system." > test-script.md

# Upload it
curl -X POST http://localhost:8787/shows/{show_id}/episodes/{episode_id}/audio \
  -H "Authorization: Bearer <token>" \
  -F "audio=@test-script.md"
```

### Test with Audio (ensure normal behavior)

```bash
curl -X POST http://localhost:8787/shows/{show_id}/episodes/{episode_id}/audio \
  -H "Authorization: Bearer <token>" \
  -F "audio=@test-audio.mp3"
```

## Next Steps

After deployment:

1. Test markdown upload with various file sizes
2. Monitor TTS task completion rates
3. Consider adding progress webhook for long scripts
4. Add UI indication in dashboard for TTS generation status
