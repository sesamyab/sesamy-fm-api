# Sesamy FM API - Podcast Management Service

A comprehensive podcast management API built with **Cloudflare Workers**, featuring audio encoding, transcription, multi-tenant organizations, and RSS feed support.

## 🎯 Features

- **Multi-Tenant Organizations**: Full organization management with user roles and permissions
- **Audio Encoding**: AWS Lambda-based FFmpeg encoding with metadata generation
- **Transcription**: Cloudflare AI-powered audio transcription (Whisper)
- **RSS Feeds**: Import podcasts from RSS feeds, generate RSS feeds for publishing
- **File Storage**: Cloudflare R2 for scalable media storage
- **Task System**: Background job processing for encoding, transcription, and publishing
- **Authentication**: Auth0 integration with JWT tokens and scoped permissions
- **API Documentation**: Automatic Swagger UI generation

## 📚 Table of Contents

- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Authentication & Authorization](#authentication--authorization)
- [Organizations](#organizations)
- [Core Workflows](#core-workflows)
- [API Endpoints](#api-endpoints)
- [Audio Encoding Service](#audio-encoding-service)
- [Transcription Service](#transcription-service)
- [RSS Feed Support](#rss-feed-support)
- [Task Processing](#task-processing)
- [Deployment](#deployment)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

## 🏗️ Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Workers                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   API Layer  │  │   Auth0      │  │  Task Queue  │      │
│  │   (Hono)     │  │  Middleware  │  │   System     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│          │                  │                  │             │
│          └──────────────────┴──────────────────┘             │
│                            │                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  D1 Database │  │   R2 Storage │  │  Cloudflare  │      │
│  │   (SQLite)   │  │   (Objects)  │  │  AI (Whisper)│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTPS Requests
                            ▼
          ┌─────────────────────────────────────┐
          │      AWS Lambda Encoding Service     │
          │  ┌────────────────────────────────┐  │
          │  │  FFmpeg 7.0.2 (Static Binary)  │  │
          │  │  • Audio Encoding               │  │
          │  │  • Metadata Generation          │  │
          │  │  • Waveform Analysis            │  │
          │  │  • Silence Detection            │  │
          │  └────────────────────────────────┘  │
          │  Memory: 10GB  |  Timeout: 15min    │
          └─────────────────────────────────────┘
```

### Technology Stack

- **Runtime**: Cloudflare Workers (Edge)
- **Framework**: Hono + Zod OpenAPI
- **Database**: Cloudflare D1 (SQLite) + Drizzle ORM
- **Storage**: Cloudflare R2 (S3-compatible)
- **AI**: Cloudflare Workers AI (Whisper)
- **Authentication**: Auth0
- **Encoding**: AWS Lambda + FFmpeg
- **Language**: TypeScript

### Data Flow

1. **Client Request** → Cloudflare Workers (Edge Network)
2. **Authentication** → Auth0 JWT validation + scope verification
3. **Business Logic** → Hono handlers + Service layer
4. **Data Persistence** → D1 database (via Drizzle ORM)
5. **File Operations** → R2 storage (media files)
6. **Background Jobs** → Task Queue System
7. **Audio Encoding** → AWS Lambda (FFmpeg)
8. **Transcription** → Cloudflare AI (Whisper)

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- npm or yarn
- Wrangler CLI: `npm install -g wrangler`
- AWS CLI (for Lambda deployment)
- Auth0 account (for authentication)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/sesamy-fm-api.git
cd sesamy-fm-api

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Local Development

```bash
# Start development server
npm run dev

# The API will be available at:
# http://localhost:8787

# Swagger UI documentation:
# http://localhost:8787/swagger
```

### Database Setup

```bash
# Generate migrations from schema
npm run db:generate

# Apply migrations
npm run db:migrate

# Open Drizzle Studio (database GUI)
npm run db:studio
```

## 🔐 Authentication & Authorization

### Auth0 Integration

The API uses Auth0 for authentication with JWT tokens and OAuth2 scopes.

#### Configuration

Set these environment variables in `wrangler.toml`:

```toml
[vars]
AUTH0_DOMAIN = "your-tenant.auth0.com"
AUTH0_AUDIENCE = "https://api.sesamy.fm"
```

#### Getting an Access Token

**1. Client Credentials Flow** (machine-to-machine):

```bash
curl --request POST \
  --url https://your-tenant.auth0.com/oauth/token \
  --header 'content-type: application/json' \
  --data '{
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "audience": "https://api.sesamy.fm",
    "grant_type": "client_credentials"
  }'
```

**2. Authorization Code Flow** (user login):

See [Auth0 documentation](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow) for implementation details.

#### Using the Token

Include the JWT token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  https://api.sesamy.fm/shows
```

### Permission Scopes

The API uses these OAuth2 scopes for authorization:

| Scope             | Description                              |
| ----------------- | ---------------------------------------- |
| `podcast:read`    | Read shows, episodes, and audio metadata |
| `podcast:write`   | Create and update shows and episodes     |
| `podcast:delete`  | Delete shows and episodes                |
| `podcast:publish` | Publish episodes to RSS feeds            |
| `admin:manage`    | Manage organizations and users           |

#### Scope Requirements by Endpoint

- **Shows**: `podcast:read` (GET), `podcast:write` (POST/PATCH), `podcast:delete` (DELETE)
- **Episodes**: `podcast:read` (GET), `podcast:write` (POST/PATCH), `podcast:delete` (DELETE)
- **Publishing**: `podcast:publish` (POST publish)
- **Organizations**: `admin:manage` (all operations)
- **Tasks**: `podcast:write` (create), `podcast:read` (view)

### Organization-Level Access Control

Users are associated with organizations through the `user_organizations` table:

```typescript
{
  userId: "auth0|123456",
  organizationId: "org-uuid",
  role: "admin" | "member" | "viewer"
}
```

**Role Permissions:**

- `admin`: Full access to organization's resources
- `member`: Create/edit own content, view all content
- `viewer`: Read-only access

The API automatically filters resources based on the authenticated user's organization membership.

## 🏢 Organizations

### Multi-Tenant Architecture

Sesamy FM supports multiple organizations with isolated data and user management.

#### Organization Structure

```typescript
{
  id: "uuid",
  name: "Acme Podcasts",
  slug: "acme-podcasts",
  createdAt: "2024-01-15T10:00:00Z",
  updatedAt: "2024-01-15T10:00:00Z"
}
```

#### Creating an Organization

```bash
POST /organizations
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Acme Podcasts",
  "slug": "acme-podcasts"
}
```

#### Adding Users to Organizations

```bash
POST /organizations/{org_id}/members
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": "auth0|123456",
  "role": "member"
}
```

#### Organization-Scoped Resources

All shows, episodes, and media files are scoped to an organization:

```typescript
{
  show: {
    id: "uuid",
    organizationId: "org-uuid",  // Scoped to organization
    title: "My Podcast",
    // ...
  }
}
```

## 🎵 Core Workflows

### 1. Creating and Publishing a Podcast Episode

Complete workflow from upload to publication:

```bash
# Step 1: Create a show
curl -X POST https://api.sesamy.fm/shows \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Awesome Podcast",
    "description": "A podcast about awesome things",
    "organizationId": "org-uuid"
  }'

# Response: { "id": "show-uuid", ... }

# Step 2: Create an episode
curl -X POST https://api.sesamy.fm/shows/show-uuid/episodes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Episode 1: Getting Started",
    "description": "In this episode we talk about getting started",
    "episodeNumber": 1
  }'

# Response: { "id": "episode-uuid", ... }

# Step 3: Upload audio file
curl -X POST https://api.sesamy.fm/shows/show-uuid/episodes/episode-uuid/audio \
  -H "Authorization: Bearer <token>" \
  -F "audio=@episode1.mp3"

# Response: { "taskId": "task-uuid", "status": "pending" }

# Step 4: Check encoding task status
curl -X GET https://api.sesamy.fm/tasks/task-uuid \
  -H "Authorization: Bearer <token>"

# Response: { "status": "completed", "result": { "r2Key": "...", "metadata": { ... } } }

# Step 5: Publish the episode
curl -X POST https://api.sesamy.fm/shows/show-uuid/episodes/episode-uuid/publish \
  -H "Authorization: Bearer <token>"

# Response: { "publishedAt": "2024-01-15T12:00:00Z", "rssUrl": "https://..." }
```

### 2. Transcribing Audio

Automatic transcription using Cloudflare AI:

```bash
# Create a transcription task
curl -X POST https://api.sesamy.fm/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "transcribe",
    "payload": {
      "episodeId": "episode-uuid",
      "audioUrl": "https://r2.storage/audio.mp3"
    }
  }'

# Check transcription status
curl -X GET https://api.sesamy.fm/tasks/task-uuid \
  -H "Authorization: Bearer <token>"

# Response includes transcript:
{
  "status": "completed",
  "result": {
    "transcript": "Welcome to episode one...",
    "vtt": "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nWelcome to episode one...",
    "language": "en"
  }
}
```

### 3. Importing from RSS Feed

Import existing podcasts from RSS feeds:

```bash
# Step 1: Preview RSS feed (validation + parsing)
curl -X POST https://api.sesamy.fm/shows/preview-rss \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "rssUrl": "https://feeds.example.com/podcast.xml"
  }'

# Response: Complete show + episode data for review

# Step 2: Import the podcast
curl -X POST https://api.sesamy.fm/shows/import \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "rssUrl": "https://feeds.example.com/podcast.xml",
    "organizationId": "org-uuid",
    "maxEpisodes": 50
  }'

# Response: { "showId": "uuid", "workflowId": "uuid", "status": "processing" }

# Step 3: Monitor import progress
curl -X GET https://api.sesamy.fm/workflows/workflow-uuid/status \
  -H "Authorization: Bearer <token>"
```

### 4. Generating RSS Feeds

Automatically generate podcast RSS feeds:

```bash
# Get RSS feed for a show (no authentication required)
curl https://api.sesamy.fm/feeds/show-uuid

# RSS feed is automatically updated when:
# - Episode is published
# - Episode metadata is updated
# - Show details are changed
```

The generated RSS feed is compliant with:

- iTunes Podcast RSS spec
- Spotify Podcast RSS requirements
- Google Podcasts RSS requirements

## 📡 API Endpoints

### Health & Documentation

- `GET /` - Service information
- `GET /healthz` - Liveness probe
- `GET /readyz` - Readiness probe
- `GET /swagger` - Swagger UI documentation
- `GET /openapi.json` - OpenAPI specification

### Organizations

- `GET /organizations` - List organizations
- `POST /organizations` - Create organization
- `GET /organizations/{org_id}` - Get organization
- `PATCH /organizations/{org_id}` - Update organization
- `DELETE /organizations/{org_id}` - Delete organization
- `POST /organizations/{org_id}/members` - Add member
- `DELETE /organizations/{org_id}/members/{user_id}` - Remove member

### Shows

- `GET /shows` - List shows (filtered by organization)
- `POST /shows` - Create show
- `GET /shows/{show_id}` - Get show details
- `PATCH /shows/{show_id}` - Update show
- `DELETE /shows/{show_id}` - Delete show
- `POST /shows/preview-rss` - Preview RSS feed before import
- `POST /shows/import` - Import show from RSS feed

### Episodes

- `GET /shows/{show_id}/episodes` - List episodes
- `POST /shows/{show_id}/episodes` - Create episode
- `GET /shows/{show_id}/episodes/{episode_id}` - Get episode
- `PATCH /shows/{show_id}/episodes/{episode_id}` - Update episode
- `DELETE /shows/{show_id}/episodes/{episode_id}` - Delete episode
- `POST /shows/{show_id}/episodes/{episode_id}/publish` - Publish episode
- `POST /shows/{show_id}/episodes/{episode_id}/audio` - Upload audio file

### Tasks

- `GET /tasks` - List tasks (with filtering)
- `POST /tasks` - Create task
- `GET /tasks/{task_id}` - Get task status
- `POST /tasks/test-encode` - Test encoding (no auth)

### RSS Feeds

- `GET /feeds/{show_id}` - Get RSS feed (public, no auth)

### Workflows

- `GET /workflows/{workflow_id}/status` - Get workflow status
- `GET /workflows/{workflow_id}/history` - Get workflow execution history

## 🎧 Audio Encoding Service

### AWS Lambda Architecture

The encoding service runs on AWS Lambda for optimal performance and cost-efficiency:

- **Memory**: 10GB
- **Timeout**: 15 minutes
- **Architecture**: x86_64 (amd64)
- **Runtime**: Node.js 18
- **FFmpeg**: 7.0.2 (static binary)

### Encoding Features

#### Audio Format Conversion

Supports multiple output formats:

- MP3 (128kbps, 192kbps, 320kbps)
- AAC (128kbps, 256kbps)
- Optimized for podcast distribution

#### Metadata Generation

Automatically generates comprehensive metadata:

1. **Waveform Data**: Visual representation for audio players

   ```json
   {
     "waveform": [0.2, 0.5, 0.8, 0.6, ...],  // 1000 points
     "sampleRate": 44100,
     "channels": 2
   }
   ```

2. **Silence Detection**: Identifies silent sections

   ```json
   {
     "silences": [
       { "start": 0.0, "end": 0.5, "duration": 0.5 },
       { "start": 120.3, "end": 121.1, "duration": 0.8 }
     ]
   }
   ```

3. **ID3 Tags**: Embedded metadata
   ```json
   {
     "title": "Episode 1",
     "artist": "My Podcast",
     "album": "Season 1",
     "year": "2024",
     "comment": "Episode description"
   }
   ```

#### Lambda Function URL

Direct access to encoding service:

```bash
# Health check
curl https://c6bf5it5y3cxvjdjret4wroeli0neapt.lambda-url.us-east-1.on.aws/health

# Response: { "status": "healthy", "ffmpegVersion": "7.0.2" }

# Encode audio
curl -X POST https://c6bf5it5y3cxvjdjret4wroeli0neapt.lambda-url.us-east-1.on.aws/encode \
  -H "Content-Type: application/json" \
  -d '{
    "audioUrl": "https://example.com/audio.wav",
    "outputFormat": "mp3",
    "bitrate": 128
  }'
```

### Encoding Workflow

```
1. Client uploads audio → R2 storage
2. API creates encoding task → Task queue
3. Task triggers Lambda → Download from R2
4. Lambda encodes audio → FFmpeg processing
5. Lambda generates metadata → Waveform, silences, ID3
6. Lambda uploads results → R2 storage
7. Lambda updates task → Status: completed
8. API returns results → Client receives R2 URLs
```

### Configuration

Set Lambda URL in `wrangler.toml`:

```toml
[vars]
AWS_LAMBDA_ENCODING_URL = "https://your-lambda-url.lambda-url.us-east-1.on.aws"
```

## 🎤 Transcription Service

### Cloudflare AI Integration

Uses Cloudflare Workers AI with the Whisper model for accurate transcription.

### Features

- **Automatic Speech Recognition**: Convert audio to text
- **Multiple Languages**: Supports 50+ languages
- **VTT Output**: WebVTT format for subtitles
- **Timestamp Accuracy**: Word-level timestamps

### Usage

```bash
# Create transcription task
curl -X POST https://api.sesamy.fm/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "transcribe",
    "payload": {
      "episodeId": "episode-uuid",
      "audioUrl": "https://r2.storage/audio.mp3",
      "language": "en"
    }
  }'
```

### Output Format

```json
{
  "transcript": "Welcome to my podcast. Today we're discussing...",
  "vtt": "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nWelcome to my podcast.\n\n00:00:05.000 --> 00:00:10.000\nToday we're discussing...",
  "language": "en",
  "confidence": 0.95,
  "duration": 3600
}
```

### Supported Languages

English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Russian, Japanese, Korean, Chinese, and 40+ more languages.

## 📻 RSS Feed Support

### Import Workflow

The RSS import workflow is powered by Cloudflare Workflows for reliable, long-running operations:

```typescript
// Workflow steps:
1. Validate RSS feed
2. Parse show metadata
3. Create show in database
4. Process episodes (in chunks)
5. Download audio files
6. Create encoding tasks
7. Update episode metadata
8. Return import results
```

### RSS Feed Generation

Automatically generates podcast-compliant RSS feeds:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>My Podcast</title>
    <description>A great podcast</description>
    <itunes:author>Host Name</itunes:author>
    <itunes:image href="https://r2.storage/cover.jpg"/>
    <item>
      <title>Episode 1</title>
      <description>First episode</description>
      <enclosure url="https://r2.storage/episode1.mp3" type="audio/mpeg"/>
      <itunes:duration>3600</itunes:duration>
      <pubDate>Mon, 15 Jan 2024 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
```

### Feed URL

```bash
# Public feed URL (no authentication)
https://api.sesamy.fm/feeds/{show_id}
```

## ⚙️ Task Processing

### Task System Architecture

Background job processing with these task types:

| Task Type        | Description                  | Duration |
| ---------------- | ---------------------------- | -------- |
| `encode`         | Audio encoding with metadata | 2-10 min |
| `transcribe`     | Speech-to-text transcription | 1-5 min  |
| `publish`        | Episode publishing           | < 1 min  |
| `import_episode` | RSS episode import           | 2-5 min  |

### Task States

```
pending → processing → completed
                    → failed
```

### Creating Tasks

```bash
curl -X POST https://api.sesamy.fm/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "encode",
    "payload": {
      "episodeId": "uuid",
      "audioUrl": "https://example.com/audio.wav"
    }
  }'
```

### Monitoring Tasks

```bash
# Get task status
curl -X GET https://api.sesamy.fm/tasks/{task_id} \
  -H "Authorization: Bearer <token>"

# List all tasks
curl -X GET https://api.sesamy.fm/tasks?status=completed&limit=20 \
  -H "Authorization: Bearer <token>"
```

### Task Queue Implementation

Uses Cloudflare Queues for reliable task processing:

```typescript
// Producer (API)
await env.TASK_QUEUE.send({
  taskId: "uuid",
  type: "encode",
  payload: { ... }
});

// Consumer (Worker)
async queue(batch, env) {
  for (const message of batch.messages) {
    await processTask(message.body);
    message.ack();
  }
}
```

## 🚢 Deployment

### Cloudflare Workers Deployment

#### Prerequisites

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login
```

#### Configuration

Edit `wrangler.toml`:

```toml
name = "sesamy-fm-api"
main = "src/worker.ts"
compatibility_date = "2024-01-15"

[vars]
AUTH0_DOMAIN = "your-tenant.auth0.com"
AUTH0_AUDIENCE = "https://api.sesamy.fm"
AWS_LAMBDA_ENCODING_URL = "https://your-lambda-url.lambda-url.us-east-1.on.aws"

[[d1_databases]]
binding = "DB"
database_name = "sesamy-fm"
database_id = "your-d1-database-id"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "sesamy-fm-media"

[[queues.producers]]
binding = "TASK_QUEUE"
queue = "sesamy-fm-tasks"

[[queues.consumers]]
queue = "sesamy-fm-tasks"
max_batch_size = 10
max_batch_timeout = 30
```

#### Set Secrets

```bash
# JWT secret for local development
wrangler secret put JWT_SECRET

# Auth0 credentials (if needed)
wrangler secret put AUTH0_CLIENT_SECRET
```

#### Deploy

```bash
# Deploy to production
npm run deploy

# Deploy to staging
wrangler deploy --env staging
```

### AWS Lambda Deployment

#### Build Docker Image

**⚠️ CRITICAL**: Lambda requires x86_64 (amd64) architecture!

```bash
# Login to AWS ECR
AWS_PROFILE=dev aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  610396205502.dkr.ecr.us-east-1.amazonaws.com

# Build for x86_64 architecture (required for Lambda)
# Use buildx with --platform to cross-compile on ARM Mac
docker buildx build --platform linux/amd64 \
  -f Dockerfile.lambda \
  -t 610396205502.dkr.ecr.us-east-1.amazonaws.com/sesamy-encoding-dev:v1 \
  --load .

# Push to ECR
docker push 610396205502.dkr.ecr.us-east-1.amazonaws.com/sesamy-encoding-dev:v1
```

#### Update Lambda Function

```bash
# Update function code
AWS_PROFILE=dev aws lambda update-function-code \
  --function-name sesamy-encoding-dev \
  --image-uri 610396205502.dkr.ecr.us-east-1.amazonaws.com/sesamy-encoding-dev:v1 \
  --region us-east-1

# Verify deployment
AWS_PROFILE=dev aws lambda get-function-configuration \
  --function-name sesamy-encoding-dev \
  --region us-east-1 | grep -i "state\|update"
```

Expected output:

```
"State": "Active",
"LastUpdateStatus": "Successful",
```

#### Lambda Configuration

```bash
# Update environment variables
AWS_PROFILE=dev aws lambda update-function-configuration \
  --function-name sesamy-encoding-dev \
  --environment Variables={NODE_ENV=production} \
  --region us-east-1

# Update memory/timeout
AWS_PROFILE=dev aws lambda update-function-configuration \
  --function-name sesamy-encoding-dev \
  --memory-size 10240 \
  --timeout 900 \
  --region us-east-1
```

### Database Migrations

```bash
# Generate migrations
npm run db:generate

# Apply migrations (local)
npm run db:migrate

# Apply migrations (production D1)
wrangler d1 migrations apply sesamy-fm --remote
```

## 💻 Development

### Project Structure

```
src/
├── app.ts                 # Hono app setup + route registration
├── worker.ts              # Cloudflare Workers entry point
├── main.ts                # Node.js entry point (local dev)
│
├── auth/                  # Authentication middleware
│   ├── middleware.ts      # JWT validation + scope checking
│   └── context.ts         # Auth context types
│
├── database/              # Database layer
│   ├── schema.ts          # Drizzle ORM schema
│   └── client.ts          # Database client
│
├── organizations/         # Organization management
│   ├── routes.ts          # API routes
│   ├── service.ts         # Business logic
│   └── repository.ts      # Data access
│
├── shows/                 # Podcast show management
│   ├── routes.ts
│   ├── service.ts
│   └── repository.ts
│
├── episodes/              # Episode management
│   ├── routes.ts
│   ├── service.ts
│   └── repository.ts
│
├── tasks/                 # Background task system
│   ├── routes.ts
│   ├── service.ts
│   ├── queue.ts           # Queue consumer
│   └── handlers/          # Task type handlers
│       ├── encode.ts
│       ├── transcribe.ts
│       └── publish.ts
│
├── audio/                 # Audio file management
│   ├── routes.ts
│   ├── service.ts
│   └── storage.ts         # R2 operations
│
├── feed/                  # RSS feed generation
│   ├── routes.ts
│   └── generator.ts       # RSS XML generation
│
├── transcription/         # AI transcription
│   ├── service.ts
│   └── whisper.ts         # Cloudflare AI integration
│
├── encoding/              # AWS Lambda integration
│   └── client.ts          # Lambda HTTP client
│
├── workflows/             # Cloudflare Workflows
│   └── import-show.ts     # RSS import workflow
│
└── utils/                 # Shared utilities
    ├── errors.ts          # Error handling
    ├── validation.ts      # Zod schemas
    └── logger.ts          # Logging

lambda/                    # AWS Lambda encoding service
├── index.js               # Lambda handler
└── package.json

drizzle/                   # Database migrations
├── 0000_initial.sql
└── meta/
```

### Development Commands

```bash
# Development
npm run dev                # Start dev server
npm run dev:local          # Start local Node.js server

# Building
npm run build              # Build for production
npm run type-check         # TypeScript type checking

# Database
npm run db:generate        # Generate migrations
npm run db:migrate         # Run migrations
npm run db:studio          # Open Drizzle Studio

# Testing
npm run test               # Run all tests
npm run test:watch         # Run tests in watch mode

# Deployment
npm run deploy             # Deploy to Cloudflare
npm run deploy:lambda      # Deploy Lambda (custom script)

# Utilities
npm run lint               # Lint code
npm run format             # Format code with Prettier
```

### Environment Variables

Create `.env` for local development:

```bash
# Auth0
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.sesamy.fm
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret

# AWS
AWS_PROFILE=dev
AWS_REGION=us-east-1
AWS_LAMBDA_ENCODING_URL=https://your-lambda-url.lambda-url.us-east-1.on.aws

# Database (local SQLite)
DATABASE_URL=file:./data/app.db

# Storage (Cloudflare R2)
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=sesamy-fm-media
```

### Testing

```bash
# Run all tests
npm run test

# Run specific test file
npm run test -- campaigns.test.ts

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Code Style

The project uses:

- **ESLint** for linting
- **Prettier** for code formatting
- **TypeScript strict mode** for type safety

```bash
# Lint and fix
npm run lint

# Format code
npm run format
```

## 🔧 Troubleshooting

### Common Issues

#### 1. Lambda "Runtime.InvalidEntrypoint" Error

**Problem**: Lambda fails with architecture mismatch error.

**Solution**: Build Docker image for x86_64 (amd64):

```bash
# CORRECT: Build for x86_64
docker buildx build --platform linux/amd64 \
  -f Dockerfile.lambda \
  -t your-ecr-repo:tag \
  --load .

# WRONG: Building for ARM64 will fail on Lambda
docker build -f Dockerfile.lambda -t your-ecr-repo:tag .
```

#### 2. Auth0 "Invalid Token" Error

**Problem**: JWT validation fails with 401 Unauthorized.

**Solution**: Check token configuration:

```bash
# Verify token is not expired
# Verify audience matches AUTH0_AUDIENCE in wrangler.toml
# Verify token has required scopes
```

#### 3. D1 Database "No Such Table" Error

**Problem**: Database queries fail with missing table error.

**Solution**: Run migrations:

```bash
# Local
npm run db:migrate

# Production
wrangler d1 migrations apply sesamy-fm --remote
```

#### 4. R2 Storage "Access Denied" Error

**Problem**: Cannot upload/download files from R2.

**Solution**: Check R2 bucket permissions:

```bash
# Verify bucket exists
wrangler r2 bucket list

# Verify binding in wrangler.toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "sesamy-fm-media"
```

#### 5. Task Queue Not Processing

**Problem**: Tasks stuck in "pending" state.

**Solution**: Check queue consumer configuration:

```bash
# Verify queue consumer in wrangler.toml
[[queues.consumers]]
queue = "sesamy-fm-tasks"
max_batch_size = 10

# Check queue status
wrangler queues consumer list sesamy-fm-tasks
```

#### 6. FFmpeg Encoding Fails

**Problem**: Lambda encoding tasks fail with FFmpeg errors.

**Solution**: Check FFmpeg installation in Lambda:

```bash
# Test Lambda health endpoint
curl https://your-lambda-url.lambda-url.us-east-1.on.aws/health

# Should return: { "status": "healthy", "ffmpegVersion": "7.0.2" }

# If fails, rebuild Lambda image
docker buildx build --platform linux/amd64 -f Dockerfile.lambda -t tag --load .
```

#### 7. Transcription Timeout

**Problem**: Transcription tasks timeout for large audio files.

**Solution**: Split audio into chunks:

```typescript
// Split large files before transcription
const chunkDuration = 300; // 5 minutes
const chunks = await splitAudio(audioUrl, chunkDuration);
```

### Debugging Tips

#### Enable Debug Logging

```bash
# Set log level in wrangler.toml
[vars]
LOG_LEVEL = "debug"
```

#### View Cloudflare Logs

```bash
# Tail logs in real-time
wrangler tail

# Filter by specific requests
wrangler tail --format pretty | grep "ERROR"
```

#### Test Lambda Locally

```bash
# Run Lambda container locally
docker run -p 9000:8080 \
  610396205502.dkr.ecr.us-east-1.amazonaws.com/sesamy-encoding-dev:latest

# Invoke Lambda
curl -X POST http://localhost:9000/2015-03-31/functions/function/invocations \
  -d '{"audioUrl": "https://example.com/test.mp3"}'
```

#### Inspect D1 Database

```bash
# Open Drizzle Studio
npm run db:studio

# Or use SQL directly
wrangler d1 execute sesamy-fm --command "SELECT * FROM shows LIMIT 10"
```

### Performance Optimization

#### 1. Reduce Task Queue Latency

```toml
[[queues.consumers]]
queue = "sesamy-fm-tasks"
max_batch_size = 10          # Process more tasks per batch
max_batch_timeout = 10       # Reduce wait time
max_retries = 3              # Retry failed tasks
```

#### 2. Optimize Database Queries

```typescript
// Use indexes for frequently queried columns
await db
  .select()
  .from(episodes)
  .where(eq(episodes.showId, showId))
  .orderBy(desc(episodes.publishedAt))
  .limit(20);
```

#### 3. Cache RSS Feeds

```typescript
// Cache generated RSS feeds in R2
const cacheKey = `feeds/${showId}.xml`;
const cachedFeed = await env.R2_BUCKET.get(cacheKey);

if (cachedFeed) {
  return new Response(await cachedFeed.text(), {
    headers: { "Content-Type": "application/xml" },
  });
}
```

## 📝 Additional Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Hono Framework](https://hono.dev/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Auth0 Documentation](https://auth0.com/docs)
- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)

## 📄 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please read CONTRIBUTING.md for guidelines.

## 💬 Support

For issues and questions:

- GitHub Issues: [github.com/your-org/sesamy-fm-api/issues](https://github.com/your-org/sesamy-fm-api/issues)
- Email: support@sesamy.fm
