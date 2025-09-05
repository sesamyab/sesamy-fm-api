# Podcast Service - Cloudflare Workers Deployment

This service has been updated to deploy to Cloudflare Workers for edge computing performance.

## Prerequisites

- Node.js 20+
- npm or yarn
- Cloudflare account
- Wrangler CLI

## Setup

1. Install dependencies:

```bash
npm install
```

2. Install Wrangler CLI globally (if not already installed):

```bash
npm install -g wrangler
```

3. Login to Cloudflare:

```bash
wrangler login
```

## Environment Configuration

The service requires these environment variables to be configured in Cloudflare Workers:

### Required Secrets (set with `wrangler secret put <name>`)

```bash
wrangler secret put JWT_SECRET
wrangler secret put DATABASE_URL
```

- `JWT_SECRET`: Secret key for JWT token generation and verification
- `DATABASE_URL`: Connection string for your database (Turso/LibSQL compatible)

## Local Development

### Option 1: Cloudflare Workers Development (Recommended)

```bash
npm run dev
```

This runs the service in Cloudflare Workers local development environment.

### Option 2: Node.js Development (Fallback)

```bash
npm run dev:local
```

This runs the service using the traditional Node.js server.

## Database Setup

The service uses LibSQL/Turso which is compatible with both local SQLite and cloud databases.

For local development:

```bash
# Generate database schema
npm run db:generate

# Run migrations
npm run db:migrate

# Open database studio
npm run db:studio
```

## Deployment

1. Build the application:

```bash
npm run build
```

2. Deploy to Cloudflare Workers:

```bash
npm run deploy
```

## Features Optimized for Edge

- **Ultra-fast cold starts**: Optimized for Cloudflare Workers runtime
- **Edge-compatible logging**: Simplified telemetry for edge environments
- **SQLite/LibSQL database**: Works with Turso for global edge distribution
- **Minimal dependencies**: Removed Node.js specific packages

## Limitations

Some features have been simplified for edge compatibility:

1. **Audio file uploads**: Large file uploads may hit Cloudflare Workers limits (100MB)
2. **OpenTelemetry**: Simplified to basic logging for edge compatibility
3. **File system operations**: Limited to what's available in Workers runtime

## Architecture Changes

- **Entry Point**: `src/worker.ts` for Cloudflare Workers
- **Telemetry**: Edge-compatible logging in `src/telemetry-edge.ts`
- **Database**: Compatible with both local SQLite and Turso
- **Configuration**: `wrangler.toml` for deployment settings

## Configuration Files

- `wrangler.toml`: Cloudflare Workers configuration
- `package.json`: Updated with edge-compatible dependencies
- `tsconfig.json`: TypeScript configuration with Workers types

## Scaling and Performance

Cloudflare Workers provides:

- Global edge distribution
- Zero cold start in many regions
- Automatic scaling
- Built-in security features

## Troubleshooting

### Common Issues

1. **Database Connection**: Ensure DATABASE_URL is properly set in Cloudflare Workers environment
2. **JWT Tokens**: Verify JWT_SECRET is configured as a secret
3. **File Uploads**: Large audio files may need chunked upload implementation

### Development

For debugging, use:

```bash
wrangler tail
```

To check deployment status:

```bash
wrangler deployments list
```
