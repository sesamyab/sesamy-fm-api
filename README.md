# Podcast Service - Cloudflare Workers Edition

# Storage of Images and Audio Files

Uploaded images and audio files are stored in Cloudflare R2, a highly durable and scalable object storage service. This allows for efficient storage and retrieval of large media files, making the service suitable for podcast hosting and distribution. When you upload an image or audio file via the API, it is automatically saved to R2 and referenced in the database.

# Task Processing and Queue System

The service uses a task queue system for background processing. When a new task is created (for example, encoding an uploaded image or audio file), a queue message is generated. This message triggers a worker process that picks up the task and performs the required operation asynchronously. This architecture enables efficient handling of resource-intensive operations, such as media encoding, without blocking API requests.

Typical workflow:

1. A client creates a task via the `POST /tasks` endpoint (e.g., to encode an uploaded file).
2. The service creates a queue message for the new task.
3. A worker is triggered by the queue and processes the task (e.g., encoding, publishing, notifications).
4. The task status is updated and results are stored in the database.

This system is used for encoding uploaded images and audio files, as well as other background operations.

A **Service Standard v1** compliant podcast service built with **Hono**, **Zod OpenAPI**, **SQLite**, and **Drizzle ORM**, optimized for **Cloudflare Workers** edge deployment.

## Features

- ✅ **Service Standard v1** compliant
- ✅ **Hono + Zod OpenAPI** for type-safe API development
- ✅ **SQLite with Drizzle ORM** for data persistence
- ✅ **JWT authentication** with scope-based authorization
- ✅ **CloudEvents** for event publishing
- ✅ **Edge-optimized** for Cloudflare Workers
- ✅ **RFC 7807 Problem+JSON** error handling
- ✅ **Automatic API documentation** via Swagger UI
- ✅ **Docker** support for local development

## Quick Start

### Prerequisites

- Node.js 20+
- npm or yarn
- Wrangler CLI (for Cloudflare Workers deployment)

### Local Development (Node.js)

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Set up environment:**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Run database migrations:**

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

4. **Start local development server:**
   ```bash
   npm run dev:local
   ```

### Cloudflare Workers Development

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Start Cloudflare Workers dev server:**

   ```bash
   npm run dev
   ```

   The service will be available at `http://localhost:8787`

## 🚀 Deployment

### Deploy to Cloudflare Workers

1. **Install Wrangler CLI globally:**

   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare:**

   ```bash
   wrangler login
   ```

3. **Set up production secrets:**

   ```bash
   # Set JWT secret for production
   wrangler secret put JWT_SECRET

   # Set database URL (for production Turso database)
   wrangler secret put DATABASE_URL
   ```

4. **Deploy to Cloudflare Workers:**

   ```bash
   npm run deploy
   ```

5. **Your service will be available at:**
   ```
   https://podcast-service.<your-subdomain>.workers.dev
   ```

### Production Database

For production, consider using **Turso** (libSQL) for a distributed SQLite database:

1. Sign up at [turso.tech](https://turso.tech)
2. Create a database: `turso db create podcast-service`
3. Get connection URL: `turso db show podcast-service --url`
4. Set as secret: `wrangler secret put DATABASE_URL`

### API Documentation

- **Swagger UI:** http://localhost:8787/swagger (dev) or https://your-worker.workers.dev/swagger (prod)
- **OpenAPI JSON:** http://localhost:8787/openapi.json
- **Service Info:** http://localhost:8787/

### Authentication

Generate a test JWT token:

```bash
npm run generate-token
```

Use the token in the Authorization header:

```
Authorization: Bearer <token>
```

## API Endpoints

### Service Info

- `GET /` — Service info
- `GET /openapi.json` — OpenAPI specification

### Health

- `GET /healthz` — Liveness probe
- `GET /readyz` — Readiness probe

### RSS Feeds

- `GET /feeds/{show_id}` — Generate RSS feed for the show (no auth required)

### Shows

- `GET /shows` — List shows
- `POST /shows` — Create show
- `GET /shows/{show_id}` — Get show
- `PATCH /shows/{show_id}` — Update show
- `DELETE /shows/{show_id}` — Delete show

### Episodes

- `GET /shows/{show_id}/episodes` — List episodes
- `POST /shows/{show_id}/episodes` — Create episode
- `GET /shows/{show_id}/episodes/{episode_id}` — Get episode
- `PATCH /shows/{show_id}/episodes/{episode_id}` — Update episode
- `DELETE /shows/{show_id}/episodes/{episode_id}` — Delete episode

### Tasks

- `POST /tasks` — Create a new background processing task
- `GET /tasks` — List tasks (supports filtering by status, limit, offset)
- `GET /tasks/{task_id}` — Get details of a specific task by ID

### Publishing

- `POST /shows/{show_id}/episodes/{episode_id}/publish` — Publish episode

### Audio

- `POST /shows/{show_id}/episodes/{episode_id}/audio` — Upload audio (multipart/form-data)
- `GET /shows/{show_id}/episodes/{episode_id}/audio` — Get audio metadata

## Required Scopes

- `podcast.read` — Read access to shows and episodes
- `podcast.write` — Create/update shows and episodes
- `podcast.publish` — Publish episodes

## Events

The service publishes CloudEvents for:

- `show.created`
- `show.updated`
- `show.deleted`
- `episode.created`
- `episode.updated`
- `episode.deleted`
- `episode.published`
- `audio.uploaded`

See `asyncapi.yaml` for event schemas.

## Development

### Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run test         # Run tests
npm run lint         # Lint code
npm run type-check   # Type checking
```

### Database

```bash
npm run db:generate  # Generate migrations
npm run db:migrate   # Run migrations
npm run db:studio    # Open Drizzle Studio
```

## Docker

### Build and run:

```bash
docker-compose up --build
```

### Development with Docker:

```bash
docker-compose -f docker-compose.yml up
```

## Project Structure

```
src/
├── database/           # Database client and schema
├── auth/              # Authentication middleware
├── common/            # Shared utilities and error handling
├── events/            # CloudEvents publishing
├── health/            # Health check endpoints
├── shows/             # Shows module (routes, service, repository, schemas)
├── episodes/          # Episodes module
├── audio/             # Audio upload module
├── scripts/           # Utility scripts
├── app.ts             # Hono app setup
├── main.ts            # Entry point
└── telemetry.ts       # OpenTelemetry setup
```

## Example Usage

### Create a Show

```bash
curl -X POST http://localhost:3000/shows \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Podcast",
    "description": "A great podcast about technology"
  }'
```

### Create an Episode

```bash
curl -X POST http://localhost:3000/shows/{show_id}/episodes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Episode 1",
    "description": "Our first episode"
  }'
```

### Upload Audio

```bash
curl -X POST http://localhost:3000/shows/{show_id}/episodes/{episode_id}/audio \
  -H "Authorization: Bearer <token>" \
  -F "audio=@podcast-episode.mp3"
```

### Publish Episode

```bash
curl -X POST http://localhost:3000/shows/{show_id}/episodes/{episode_id}/publish \
  -H "Authorization: Bearer <token>"
```

## Service Standard v1 Compliance

This service implements all Service Standard v1 requirements:

- ✅ **OpenAPI 3.0+** specification
- ✅ **OAuth2/OIDC** authentication with scopes
- ✅ **CloudEvents** for event publishing
- ✅ **AsyncAPI 2.0+** event specification
- ✅ **RFC 7807 Problem+JSON** error format
- ✅ **Structured JSON logging** with OpenTelemetry
- ✅ **Health endpoints** (`/healthz`, `/readyz`)
- ✅ **Service manifest** (`service.yaml`)
- ✅ **Environment-based configuration**

## Technology Stack

- **[Hono](https://hono.dev/)** - Ultra-fast web framework
- **[@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)** - Type-safe OpenAPI with Zod
- **[Drizzle ORM](https://orm.drizzle.team/)** - Type-safe SQL toolkit
- **[SQLite](https://www.sqlite.org/)** - Embedded database
- **[Zod](https://zod.dev/)** - Schema validation
- **[OpenTelemetry](https://opentelemetry.io/)** - Observability
- **[Winston](https://github.com/winstonjs/winston)** - Logging
- **[CloudEvents](https://cloudevents.io/)** - Event specification
