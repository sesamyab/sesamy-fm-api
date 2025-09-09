# Audio Processing Workflow Debug Improvements

## Changes Made

### 1. Added Debug URLs for All Workflow Outputs

**Enhanced workflow with signed download URLs for easy debugging:**

- **Encoded Audio for Processing**: Added `encodedDebugUrl` to the encoding step output
- **Audio Chunks**: Added `chunkDebugUrls` array with signed URLs for each chunk
- **Transcript**: Added `transcriptDebugUrl` for the final transcript file
- **Encoded Audio Outputs**: Added `encodingDebugUrls` for all encoded formats

### 2. Enhanced Error Logging with Debug URLs

**Improved transcription error handling:**

- Each chunk now generates a debug URL when processing fails
- Error messages include the debug URL for immediate inspection
- Logs show which chunks are causing issues with direct download links

### 3. Added Language Parameter for Transcription

**Fixed mixed language issue:**

- Added `transcriptionLanguage` parameter (defaults to "en")
- Forces consistent language detection across all chunks
- Prevents "Unsupported audio input: mixed languages" errors

### 4. Added Helper Methods

**New private methods in AudioProcessingWorkflow:**

- `generateChunkDebugUrls()`: Creates debug URLs for all audio chunks
- `generateEncodingDebugUrls()`: Creates debug URLs for encoded audio files

### 5. Enhanced Logging Throughout

**Improved debugging information:**

- Logs debug URLs at each step for easy access
- Shows forced language parameter in transcription logs
- Provides chunk processing summaries with debug info

## How to Use Debug URLs

### When a Workflow Runs Successfully

The workflow return object now includes a `debugInfo` section:

```json
{
  "success": true,
  "episodeId": "...",
  "workflowId": "...",
  "debugInfo": {
    "encodedAudioDebugUrl": "https://...",
    "chunkDebugUrls": [
      { "index": 0, "debugUrl": "https://...", "r2Key": "..." },
      { "index": 1, "debugUrl": "https://...", "r2Key": "..." }
    ],
    "transcriptDebugUrl": "https://...",
    "encodingDebugUrls": [
      {
        "format": "mp3",
        "bitrate": 128,
        "debugUrl": "https://...",
        "r2Key": "..."
      }
    ]
  }
}
```

### When a Workflow Fails

Error messages now include debug URLs:

```
[Transcription Error] R2 fetch error for chunk 0. R2 key: chunks/episodeId/chunkId.mp3.
Debug info: {"chunkIndex":0,"debugUrl":"https://signed-url-here",...}.
R2 error: AiError: 3010: Invalid or incomplete input...

[Transcription Error] Download chunk for inspection: https://signed-url-here
```

### Debug URLs are Available For

1. **Original encoded audio** (32kbps mono version used for chunking)
2. **Individual audio chunks** (each 30-second segment)
3. **Final transcript file** (merged text output)
4. **Encoded audio outputs** (final MP3/other formats)

## Addressing the Specific Error

The error you encountered:

```
Unsupported audio input: It is currently not supported to transcribe to different languages in a single request. Please make sure to either force a single language by passing 'language='...' or make sure all input audio is of the same language.
```

**Is now fixed by:**

1. Adding `transcriptionLanguage: "en"` parameter (defaults to English)
2. Forcing consistent language detection across all chunks
3. Updated both the workflow schema and audio service to use this parameter

## Files Modified

1. `/src/workflows/audio-processing-workflow.ts` - Main workflow enhancements
2. `/src/workflows/routes.ts` - Added transcriptionLanguage to schema
3. `/src/audio/service.ts` - Added transcriptionLanguage parameter to workflow calls

## Next Steps

1. Deploy the updated workflow
2. Test with a problematic audio file
3. Use the debug URLs to inspect:
   - Individual chunk audio quality
   - Transcript content at each step
   - Encoding outputs

All debug URLs are valid for 1 hour and provide direct access to the files in R2 storage.
