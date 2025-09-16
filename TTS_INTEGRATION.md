# Text-to-Speech (TTS) Integration

This document describes the Text-to-Speech functionality added to the Sesamy FM API.

## Overview

The TTS service allows you to convert text to speech using various AI models, with configurable voice selection and audio quality options. The service supports multiple TTS providers through Cloudflare AI Workers.

## Features

- ✅ **Multiple TTS Models**: OpenAI TTS-1 HD, OpenAI TTS-1, ElevenLabs models
- ✅ **Voice Selection**: nova, shimmer, alloy, echo, fable, onyx (OpenAI) + ElevenLabs voices
- ✅ **Configurable Defaults**: Set default model and voice via environment variables
- ✅ **Storage Integration**: Generated audio stored in R2 with signed URLs
- ✅ **Testing Endpoints**: Direct audio download for testing
- ✅ **Quality Options**: Speed control (0.25x to 4.0x) and multiple output formats

## Configuration

### Environment Variables (wrangler.toml)

```toml
[vars]
# TTS configuration - nova voice is configured as default
TTS_DEFAULT_MODEL = "@cf/openai/tts-1-hd"
TTS_DEFAULT_VOICE = "nova"
```

### Available Models

| Model                                   | Provider   | Description         | Voices                                      |
| --------------------------------------- | ---------- | ------------------- | ------------------------------------------- |
| `@cf/openai/tts-1-hd`                   | OpenAI     | High-definition TTS | alloy, echo, fable, onyx, **nova**, shimmer |
| `@cf/openai/tts-1`                      | OpenAI     | Standard TTS        | alloy, echo, fable, onyx, **nova**, shimmer |
| `@cf/elevenlabs/eleven-multilingual-v2` | ElevenLabs | Multilingual TTS    | rachel, clyde, domi, and more               |
| `@cf/elevenlabs/eleven-turbo-v2`        | ElevenLabs | Fast TTS            | rachel, clyde, domi, and more               |

**Note**: The **nova** voice is equivalent to the nova-3 model and is set as the default.

## API Endpoints

### 1. Generate TTS Audio (with Storage)

**POST** `/tts/generate`

Generate TTS audio and store it in R2 storage.

```bash
curl -X POST https://your-service.workers.dev/tts/generate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello! This is a test of the nova voice.",
    "model": "@cf/openai/tts-1-hd",
    "voice": "nova",
    "speed": 1.0,
    "format": "mp3"
  }'
```

**Response:**

```json
{
  "success": true,
  "audioUrl": "r2://tts/tts-uuid.mp3",
  "model": "@cf/openai/tts-1-hd",
  "voice": "nova",
  "speed": 1.0,
  "format": "mp3",
  "size": 15234
}
```

### 2. Test TTS (Direct Audio Response)

**POST** `/test/tts`

Test TTS functionality with direct audio download (no authentication required).

```bash
curl -X POST https://your-service.workers.dev/test/tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "This is a test using the nova voice.",
    "model": "@cf/openai/tts-1-hd",
    "voice": "nova"
  }' \
  --output test-audio.mp3
```

### 3. Get Available Models

**GET** `/tts/models`

List all available TTS models and their voices.

```bash
curl -X GET https://your-service.workers.dev/tts/models \
  -H "Authorization: Bearer <token>"
```

**Response:**

```json
{
  "models": [
    {
      "id": "@cf/openai/tts-1-hd",
      "name": "OpenAI TTS-1 HD",
      "description": "High-definition text-to-speech from OpenAI",
      "voices": ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
    }
  ]
}
```

## Usage Examples

### Basic TTS with Default Settings

Uses the configured default model (`@cf/openai/tts-1-hd`) and voice (`nova`):

```javascript
const response = await fetch("/tts/generate", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    text: "Hello, world! This uses the default nova voice.",
  }),
});
```

### Voice Comparison

```bash
# Nova voice (default)
curl -X POST /test/tts -d '{"text": "Hello, I am Nova.", "voice": "nova"}' -o nova.mp3

# Shimmer voice
curl -X POST /test/tts -d '{"text": "Hello, I am Shimmer.", "voice": "shimmer"}' -o shimmer.mp3

# Alloy voice
curl -X POST /test/tts -d '{"text": "Hello, I am Alloy.", "voice": "alloy"}' -o alloy.mp3
```

### Speed Control

```javascript
// Slow speech (0.75x speed)
{
  "text": "This is spoken slowly for emphasis.",
  "voice": "nova",
  "speed": 0.75
}

// Fast speech (1.5x speed)
{
  "text": "This is spoken quickly to save time.",
  "voice": "nova",
  "speed": 1.5
}
```

## Testing

Use the provided test script to verify TTS functionality:

```bash
./test-tts.sh
```

This script will:

1. List available models
2. Generate test audio with the nova voice
3. Test different voices (shimmer, rachel)
4. Save audio files for manual verification

## Authentication & Permissions

### Required Permissions

- **Generate TTS**: `tts:write` or `content:write`
- **List Models**: `tts:read` or `content:read`
- **Test Endpoint**: No authentication required

### Scopes

- **Generate TTS**: `tts.write` or `content.write`
- **List Models**: `tts.read` or `content.read`

## Storage & URLs

- Generated audio files are stored in R2 under the `tts/` prefix
- Files are named with UUID: `tts-{uuid}.{format}`
- URLs returned use the `r2://` scheme for internal reference
- Use existing R2 signed URL generation for public access

## Error Handling

Common errors and solutions:

| Error                   | Cause                   | Solution                                  |
| ----------------------- | ----------------------- | ----------------------------------------- |
| `Unsupported TTS model` | Invalid model ID        | Use `/tts/models` to see available models |
| `Unsupported voice`     | Invalid voice for model | Check model's supported voices            |
| `Text too long`         | Text exceeds limits     | Split text or use shorter content         |
| `TTS generation failed` | AI service error        | Retry or try different model              |

## Limits

- **Text Length**: 4000 characters for generation, 500 for testing
- **Speed Range**: 0.25x to 4.0x
- **Output Formats**: MP3, WAV, Opus
- **File Storage**: R2 bucket configured in wrangler.toml

## Integration with Existing Services

The TTS service integrates with existing Sesamy FM API components:

- **Storage**: Uses the same R2 bucket as audio files
- **Authentication**: Uses existing JWT middleware
- **Error Handling**: Follows RFC 7807 Problem+JSON format
- **API Documentation**: Auto-generated OpenAPI docs at `/swagger`

## Future Enhancements

1. **Podcast Integration**: Generate intro/outro from episode metadata
2. **Batch Processing**: Convert multiple texts in parallel
3. **Voice Cloning**: Custom voice training for podcast hosts
4. **SSML Support**: Advanced speech markup for better control
5. **Real-time Streaming**: Stream audio generation for long texts
