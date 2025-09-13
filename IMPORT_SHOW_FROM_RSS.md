# Import Show from RSS

This document describes the new import show functionality that allows importing podcast shows and episodes from RSS feeds.

## Overview

The import show feature consists of:

1. **RSS Parser**: Validates and parses RSS feeds to extract show and episode information
2. **Import Show Workflow**: A Cloudflare Workflow that handles the import process
3. **REST API Endpoint**: `/shows/import` endpoint to trigger RSS imports

## API Usage

### Import Show from RSS

**Endpoint:** `POST /shows/import`

**Authentication:** Required (Bearer token with `podcast:write` permission or scope)

**Request Body:**

```json
{
  "rssUrl": "https://example.com/podcast/rss.xml",
  "maxEpisodes": 100,
  "skipExistingEpisodes": false
}
```

**Parameters:**

- `rssUrl` (required): The URL of the RSS feed to import
- `maxEpisodes` (optional, default: 100): Maximum number of episodes to import
- `skipExistingEpisodes` (optional, default: false): Whether to skip episodes that already exist

**Response (202 Accepted):**

```json
{
  "taskId": "12345",
  "workflowId": "uuid-workflow-id",
  "message": "RSS import task created successfully. Task ID: 12345"
}
```

**Error Responses:**

- `400 Bad Request`: Invalid RSS URL or RSS parsing/validation errors
- `403 Forbidden`: Missing required permissions
- `500 Internal Server Error`: Server configuration issues

### Preview RSS Feed

**Endpoint:** `POST /shows/preview-rss`

**Authentication:** Required (Bearer token with `podcast:read` permission or scope)

**Request Body:**

```json
{
  "rssUrl": "https://example.com/podcast/rss.xml"
}
```

**Parameters:**

- `rssUrl` (required): The URL of the RSS feed to preview

**Response (200 OK - Success):**

```json
{
  "success": true,
  "data": {
    "title": "My Awesome Podcast",
    "description": "A great podcast about technology",
    "imageUrl": "https://example.com/artwork.jpg",
    "language": "en",
    "categories": ["Technology", "Education"],
    "author": "John Doe",
    "totalEpisodes": 25,
    "episodes": [
      {
        "title": "Episode 1: Getting Started",
        "description": "In this episode we talk about...",
        "audioUrl": "https://example.com/episode1.mp3",
        "imageUrl": "https://example.com/ep1.jpg",
        "publishedAt": "2024-01-01T10:00:00.000Z",
        "duration": 3600,
        "episodeNumber": 1,
        "seasonNumber": 1
      }
    ]
  }
}
```

**Response (200 OK - With Errors):**

```json
{
  "success": false,
  "errors": [
    {
      "type": "rss_parse_error",
      "message": "RSS parsing failed: No channel element found in RSS feed"
    }
  ]
}
```

**Error Response Types:**

- `rss_parse_error`: Issues with fetching or parsing the RSS XML
- `rss_validation_error`: RSS structure validation failures
- `unknown_error`: Unexpected server errors

**Error Responses:**

- `400 Bad Request`: Invalid RSS URL format
- `403 Forbidden`: Missing required permissions
- `500 Internal Server Error`: Server configuration issues

## RSS Feed Requirements

The RSS parser supports standard podcast RSS feeds with the following requirements:

### Required Elements

- `<channel><title>`: Show title
- `<channel><description>`: Show description
- `<item><title>`: Episode titles
- `<item><description>`: Episode descriptions
- `<item><enclosure type="audio/*">`: Audio files for episodes

### Optional Elements

- `<channel><image><url>` or `<itunes:image href="">`: Show artwork
- `<channel><language>`: Show language
- `<channel><category>`: Show categories
- `<itunes:author>`: Show author
- `<item><itunes:image href="">`: Episode artwork
- `<item><pubDate>`: Episode publication date
- `<item><itunes:duration>`: Episode duration
- `<item><itunes:season>`: Season number
- Episode numbers (extracted from title patterns)

### Supported RSS Features

- Standard RSS 2.0 format
- iTunes podcast extensions
- CDATA sections
- Multiple episode formats
- Custom domains and CDNs

## Workflow Process

The enhanced import process follows these steps:

1. **RSS Validation**: Fetch and validate the RSS feed structure
2. **Show Creation**: Create the podcast show record with complete metadata:
   - Downloads and uploads show artwork to R2 storage
   - Preserves language, categories, and author information
3. **Episode Processing**: Process each episode sequentially:
   - Create episode record with full metadata (season/episode numbers, duration, etc.)
   - Download and upload episode images to R2 storage
   - Download and upload audio files to R2 storage
   - Trigger audio processing workflow for transcription and encoding
   - Update progress status with detailed information

## Error Handling

The system provides detailed error messages for common issues:

- **Invalid RSS URL**: HTTP errors, timeouts, unreachable hosts
- **Malformed XML**: XML parsing errors, missing required elements
- **Validation Errors**: Missing titles, descriptions, or audio files
- **Network Issues**: Connection timeouts, SSL errors

## Monitoring

Use the following endpoints to monitor import progress:

- `GET /tasks/{taskId}`: Check task status and progress
- `GET /workflows/{workflowId}`: Check workflow execution details

## Example Usage

```bash
# Preview RSS feed before importing
curl -X POST https://your-api.com/shows/preview-rss \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json" \
  -d '{
    "rssUrl": "https://feeds.example.com/podcast.xml"
  }'

# Import a podcast from RSS
curl -X POST https://your-api.com/shows/import \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json" \
  -d '{
    "rssUrl": "https://feeds.example.com/podcast.xml",
    "maxEpisodes": 50
  }'

# Check import status
curl https://your-api.com/tasks/12345 \
  -H "Authorization: Bearer your-jwt-token"
```

## Configuration

### Cloudflare Worker Bindings

Add to `wrangler.toml`:

```toml
[[workflows]]
name = "import-show-workflow"
binding = "IMPORT_SHOW_WORKFLOW"
class_name = "ImportShowWorkflow"
```

### Environment Variables

No additional environment variables are required. The workflow uses existing database and storage bindings.

## Enhanced Features

✅ **Complete Field Mapping**: All RSS metadata is now preserved including:

- Show language, categories, and author information
- Episode metadata like season/episode numbers, duration, explicit flags
- Keywords and iTunes-specific metadata

✅ **Automatic Asset Download**: The workflow now:

- Downloads show artwork and episode images
- Downloads audio files from RSS feeds
- Uploads all assets to R2 storage with proper content types
- Updates episodes with local R2 URLs

✅ **Audio Processing Integration**: After importing episodes:

- Automatically triggers the audio processing workflow
- Transcribes audio content using AI
- Generates multiple encoding formats
- Extracts audio metadata and duration

## Limitations

- Maximum 100 episodes per import (configurable via `maxEpisodes`)
- 30-second timeout for RSS feed fetching and audio downloads
- 15-second timeout for image downloads
- No duplicate show detection (creates new show each time)
- Audio processing runs asynchronously (check workflow status for progress)

## Future Enhancements

- Duplicate show/episode detection and merging
- Resume interrupted imports from failure points
- RSS feed monitoring and auto-updates for new episodes
- Batch optimization for large podcast archives
- Advanced audio quality analysis and optimization
- Automatic episode release scheduling based on RSS publication dates
