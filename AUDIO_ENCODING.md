# Audio Encoding Implementation

This document describes the implementation of the audio encoding task using FFmpeg and WebAssembly.

## Overview

The audio encoding task has been implemented to encode podcast episodes to MP3 format with constant bitrate:

- **128 kbps** for stereo audio
- **64 kbps** for mono audio

## Architecture

### Components

1. **AudioEncoder** (`src/audio/encoder.ts`)

   - Handles FFmpeg WASM initialization and audio processing
   - Determines optimal bitrate based on audio channel configuration
   - Encodes audio to MP3 with constant bitrate

2. **TaskService.handleEncode** (`src/tasks/service.ts`)
   - Fetches source audio from URL
   - Uses AudioEncoder to process the audio
   - Stores encoded result in R2 bucket
   - Updates episode record with new audio URL
   - Publishes completion event

### Dependencies

- `@ffmpeg/ffmpeg`: FFmpeg WebAssembly build
- `@ffmpeg/util`: Utilities for FFmpeg WASM

## Usage

The encoding task is triggered by creating a task with type `"encode"` and payload:

```typescript
{
  episodeId: string,
  audioUrl: string
}
```

Example:

```typescript
const task = await taskService.createTask("encode", {
  episodeId: "episode-123",
  audioUrl: "https://example.com/original-audio.wav",
});
```

## Process Flow

1. **Task Creation**: Encoding task is created with episode ID and source audio URL
2. **Audio Fetch**: Source audio is downloaded from the provided URL
3. **Format Detection**: FFmpeg analyzes the audio to determine channel configuration
4. **Bitrate Selection**:
   - Mono audio → 64 kbps
   - Stereo audio → 128 kbps
5. **Encoding**: Audio is encoded to MP3 with constant bitrate
6. **Storage**: Encoded audio is stored in R2 bucket under `encoded/{episodeId}/{uuid}.mp3`
7. **Database Update**: Episode record is updated with new encoded audio URL
8. **Event Publishing**: `episode.encoding_completed` event is published

## Output

The encoding task returns:

```typescript
{
  encodedUrl: string,           // URL of encoded audio file
  encodedKey: string,           // R2 storage key
  originalSize: number,         // Original file size in bytes
  encodedSize: number,          // Encoded file size in bytes
  format: string,               // Output format (mp3)
  bitrate: number,              // Used bitrate (64 or 128)
  compressionRatio: number,     // originalSize / encodedSize
  completedAt: string           // ISO timestamp
}
```

## Error Handling

- **Missing Dependencies**: Throws error if R2 bucket is not available
- **Invalid Payload**: Throws error if episodeId or audioUrl is missing
- **Fetch Failure**: Throws error if source audio cannot be downloaded
- **Encoding Failure**: Throws error if FFmpeg processing fails
- **Storage Failure**: Throws error if R2 upload fails

## Performance Considerations

- FFmpeg WASM is loaded on-demand and terminated after use
- Large audio files may require significant memory and processing time
- The encoder instance is created per task to avoid state conflicts

## Configuration

Environment variables:

- `R2_ENDPOINT`: Base URL for R2 storage (defaults to `https://podcast-media.sesamy.dev`)

## Events

The implementation publishes the following event:

- **Type**: `episode.encoding_completed`
- **Subject**: Episode ID
- **Data**: Encoding results including URLs, sizes, and compression ratio

## Testing

Run the test script:

```bash
npx tsx test-encoding.ts
```

Note: Full integration testing requires a Cloudflare Worker environment with R2 bucket access.

## Future Enhancements

- Support for additional audio formats (AAC, OGG)
- Variable bitrate encoding options
- Audio normalization and enhancement
- Progress reporting for long encoding tasks
- Parallel processing for large files
