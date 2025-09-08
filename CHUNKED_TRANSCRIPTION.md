# Chunked Audio Preprocessing and Transcription

This document describes the chunked audio preprocessing and transcription functionality implemented in the Sesamy FM API.

## Overview

The chunked audio preprocessing feature allows large audio files to be split into smaller segments with overlapping sections for more efficient and accurate transcription. This approach provides several benefits:

1. **Better Transcription Accuracy**: Smaller chunks are processed more reliably by the AI transcription service
2. **Parallel Processing**: Multiple chunks can be transcribed simultaneously, reducing overall processing time
3. **Memory Efficiency**: Avoids loading large audio files entirely into memory
4. **Overlap Handling**: Automatic removal of duplicate words in overlapping segments

## Implementation Details

### Audio Chunking

- **Chunk Duration**: 30 seconds per segment (configurable)
- **Overlap Duration**: 2 seconds between adjacent chunks (configurable)
- **Output Format**: MP3 at 32kbps mono (optimized for transcription)
- **Sample Rate**: 16kHz (standard for speech recognition)

### Processing Flow

1. **Audio Preprocessing Task** (`audio_preprocess`)

   - Receives original audio URL
   - Calls the encoding container's `/chunk` endpoint
   - Splits audio into overlapping segments
   - Stores each chunk in R2 with signed URLs
   - Creates a transcription task with chunk information

2. **Chunked Transcription Task** (`transcribe` with chunked data)
   - Processes all chunks in parallel (with concurrency limits)
   - Uses Cloudflare Workers AI Whisper model for each chunk
   - Merges transcriptions with intelligent overlap removal
   - Stores the final merged transcript

### Container Endpoints

#### `/chunk` Endpoint

**POST** `/chunk`

Splits audio into overlapping chunks using FFmpeg.

**Request:**

```json
{
  "audioUrl": "https://example.com/audio.mp3",
  "chunkDuration": 30,
  "overlapDuration": 2,
  "outputFormat": "mp3",
  "bitrate": 32,
  "streaming": true
}
```

**Response:**

```json
{
  "success": true,
  "chunks": [
    {
      "index": 0,
      "startTime": 0,
      "endTime": 30,
      "duration": 30,
      "encodedData": "base64_encoded_audio_data",
      "metadata": {
        "format": "mp3",
        "bitrate": 32,
        "size": 48000,
        "channels": 1,
        "sampleRate": 16000
      }
    }
  ],
  "totalChunks": 5,
  "totalDuration": 142.5,
  "chunkDuration": 30,
  "overlapDuration": 2
}
```

### API Endpoints

#### Test Audio Preprocessing

**POST** `/api/tasks/test-audio-preprocess`

Test the chunked audio preprocessing without creating a persistent task.

**Request:**

```json
{
  "audioUrl": "https://example.com/audio.mp3",
  "episodeId": "test-episode-123"
}
```

**Response:**

```json
{
  "chunks": [
    {
      "index": 0,
      "url": "https://signed-url-for-chunk-0",
      "key": "preprocessed-chunks/episode-123/chunk-0.mp3",
      "startTime": 0,
      "endTime": 30,
      "duration": 30,
      "size": 48000
    }
  ],
  "totalChunks": 5,
  "totalDuration": 142.5,
  "processingMode": "chunked",
  "testMode": true
}
```

#### Test Chunked Transcription

**POST** `/api/tasks/test-transcribe`

Test transcription of chunked audio.

**Request:**

```json
{
  "episodeId": "test-episode-123",
  "chunked": true,
  "chunks": [...],
  "overlapDuration": 2
}
```

**Response:**

```json
{
  "transcriptUrl": "https://example.com/transcript.txt",
  "textLength": 1250,
  "processingMode": "chunked",
  "chunkDetails": {
    "totalChunks": 5,
    "overlapDuration": 2,
    "originalTextLength": 1425,
    "compressionRatio": "12.3%"
  },
  "chunks": [
    {
      "index": 0,
      "startTime": 0,
      "endTime": 30,
      "wordCount": 45,
      "textLength": 250
    }
  ]
}
```

### Overlap Removal Algorithm

The transcription merging process uses an intelligent overlap removal algorithm:

1. **Word Estimation**: Estimates overlap words based on speaking rate (~2.5 words/second)
2. **Pattern Matching**: Looks for common word sequences between chunk boundaries
3. **Score-based Selection**: Chooses the best overlap point based on word similarity
4. **Fallback**: Uses time-based estimation if no good patterns are found

Example:

```
Chunk 1 (0-30s): "...and that's why we need to focus on quality."
Chunk 2 (28-58s): "focus on quality and ensure that every..."
Merged: "...and that's why we need to focus on quality and ensure that every..."
```

### Configuration

Environment variables and configuration options:

- `CHUNK_DURATION`: Default chunk duration in seconds (default: 30)
- `OVERLAP_DURATION`: Default overlap duration in seconds (default: 2)
- `TRANSCRIPTION_BITRATE`: Audio bitrate for transcription (default: 32)
- `TRANSCRIPTION_CONCURRENCY`: Max parallel transcriptions (default: 3)

### Error Handling

- **Container Failures**: Falls back to single-file processing
- **Chunk Failures**: Individual chunk failures are logged but don't stop the entire process
- **Transcription Failures**: Retries with exponential backoff
- **Merge Failures**: Falls back to simple concatenation without overlap removal

### Performance Considerations

- **Memory Usage**: Reduced compared to processing entire files
- **Processing Time**: Parallel transcription can be faster for large files
- **Network Efficiency**: Chunks are processed as they're generated
- **Cost Optimization**: Better resource utilization for large audio files

### Testing

Use the provided test script to verify functionality:

```bash
./test-chunked-transcription.sh
```

This script tests:

- Audio preprocessing with chunking
- Chunked transcription with overlap removal
- End-to-end workflow
- Container chunk endpoint directly

### Monitoring

Key metrics to monitor:

- Chunk creation success rate
- Transcription accuracy per chunk
- Overlap removal effectiveness
- Overall processing time vs. file size
- Memory usage during processing

## Future Improvements

1. **Adaptive Chunking**: Adjust chunk sizes based on audio content
2. **Smart Overlap**: Use speech detection to optimize overlap boundaries
3. **Quality Metrics**: Add transcription confidence scores
4. **Streaming Transcription**: Real-time processing as chunks are created
5. **Language Detection**: Automatic language detection per chunk
