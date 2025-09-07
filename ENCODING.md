# Audio Encoding with FFmpeg WASM

This document describes the audio encoding functionality implemented using FFmpeg WASM in the podcast service.

## Overview

The `handleEncode` function in the `TaskService` class provides audio encoding capabilities using FFmpeg WASM. It can convert audio files to different formats and bitrates, optimized for podcast distribution.

## Features

- **Format Support**: MP3 and AAC encoding
- **Bitrate Control**: Configurable bitrate (default: 128kbps)
- **Sample Rate**: Fixed at 44.1kHz for compatibility
- **Stereo Output**: 2-channel audio output
- **Cloud Storage**: Automatic upload to R2 storage
- **Event Publishing**: Publishes completion events

## Usage

### Creating an Encoding Task

```javascript
// Create an encoding task
const task = await taskService.createTask("encode", {
  episodeId: "episode-123",
  audioUrl: "https://example.com/raw-audio.wav",
  outputFormat: "mp3", // 'mp3' or 'aac'
  bitrate: 128, // bitrate in kbps
});
```

### Payload Parameters

| Parameter      | Type   | Required | Default | Description                    |
| -------------- | ------ | -------- | ------- | ------------------------------ |
| `episodeId`    | string | Yes      | -       | ID of the episode to encode    |
| `audioUrl`     | string | Yes      | -       | URL of the source audio file   |
| `outputFormat` | string | No       | 'mp3'   | Output format ('mp3' or 'aac') |
| `bitrate`      | number | No       | 128     | Output bitrate in kbps         |

### Response

The encoding task returns the following result:

```javascript
{
  encodedUrl: "https://podcast-media.sesamy.dev/episodes/123/encoded/uuid.mp3",
  encodedKey: "episodes/123/encoded/uuid.mp3",
  format: "mp3",
  bitrate: 128,
  size: 5242880,
  completedAt: "2024-01-15T10:30:00.000Z"
}
```

## Technical Details

### FFmpeg Configuration

The implementation uses FFmpeg WASM with the following configuration:

- **Core**: Loaded from unpkg.com CDN
- **Encoding**: libmp3lame for MP3, AAC for AAC
- **Sample Rate**: 44100 Hz
- **Channels**: 2 (stereo)

### Storage

Encoded files are stored in R2 with the following structure:

```
episodes/{episodeId}/encoded/{uuid}.{format}
```

### Events

Upon successful encoding, the following event is published:

- **Type**: `episode.encoding_completed`
- **Data**: Contains encoding details and file information

## Error Handling

The encoding process handles the following error scenarios:

1. **Missing Dependencies**: R2 bucket binding required
2. **Invalid Payload**: Missing episodeId or audioUrl
3. **Fetch Errors**: Source audio file unavailable
4. **FFmpeg Errors**: Encoding failures
5. **Storage Errors**: R2 upload failures

## Performance Considerations

- **Memory Usage**: FFmpeg WASM requires sufficient memory for processing
- **Processing Time**: Depends on audio file size and complexity
- **CDN Loading**: Initial FFmpeg core loading adds startup time
- **Worker Limits**: Cloudflare Workers have execution time limits

## Example Integration

```javascript
// In your episode upload handler
const episode = await episodeService.create(showId, episodeData);

// Create encoding task for the uploaded episode
const encodingTask = await taskService.createTask("encode", {
  episodeId: episode.id,
  audioUrl: episode.audioUrl,
  outputFormat: "mp3",
  bitrate: 128,
});

console.log(`Encoding task created: ${encodingTask.id}`);
```

## Testing

Use the provided test script to verify encoding functionality:

```bash
# Set your JWT token
export JWT_TOKEN="your-jwt-token"

# Run the encoding test
node examples/test-encoding.js
```

The test script will:

1. Create a test show and episode
2. Submit an encoding task
3. Monitor the task progress
4. Display the results

## Supported Audio Formats

### Input Formats

- WAV
- MP3
- AAC
- OGG
- FLAC
- Any format supported by FFmpeg

### Output Formats

- **MP3**: Using libmp3lame encoder
- **AAC**: Using native AAC encoder

### Recommended Settings

| Use Case          | Format | Bitrate  | Notes                   |
| ----------------- | ------ | -------- | ----------------------- |
| High Quality      | MP3    | 192 kbps | Best for music podcasts |
| Standard Quality  | MP3    | 128 kbps | Good for voice content  |
| Mobile Optimized  | AAC    | 128 kbps | Smaller file sizes      |
| Bandwidth Limited | MP3    | 64 kbps  | Voice-only content      |
