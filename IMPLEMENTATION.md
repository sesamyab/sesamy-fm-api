# Implementation Notes

## Technology Choices

### Hono + Zod OpenAPI

- **Ultra-fast**: Optimized for edge computing and Node.js
- **Type-safe**: Automatic TypeScript types from schemas
- **Auto-documentation**: OpenAPI spec generated from routes
- **Validation**: Built-in request/response validation

### SQLite + Drizzle

- **Simple deployment**: Single file database
- **Type-safe**: Generated TypeScript types
- **Migration support**: Versioned schema changes
- **Performance**: Excellent for read-heavy workloads

### CloudEvents

- **Standardized**: Industry standard event format
- **Interoperable**: Works with any event broker
- **Versioned**: Backwards compatible event evolution

## Architecture Decisions

### Repository Pattern

Each domain (shows, episodes, audio) has its own repository for data access, keeping business logic separate from data persistence.

### Service Layer

Services coordinate between repositories and handle business rules, event publishing, and cross-cutting concerns.

### Schema-First Development

Zod schemas define the API contract and generate TypeScript types, ensuring consistency between runtime validation and compile-time types.

### Event Sourcing Ready

All domain events are published through CloudEvents, making it easy to implement event sourcing patterns later.

## Service Standard v1 Compliance

### Authentication

- JWT-based authentication with configurable secret
- Scope-based authorization (read, write, publish)
- OIDC-compatible token validation

### Error Handling

- RFC 7807 Problem+JSON for all errors
- Detailed validation messages
- Consistent error structure across all endpoints

### Observability

- OpenTelemetry for distributed tracing
- Structured JSON logging with trace correlation
- Health endpoints for monitoring

### API Design

- Resource-oriented URLs
- Consistent HTTP status codes
- Pagination with limit/offset
- Content negotiation (JSON only)

## Development Experience

### Hot Reloading

Uses `tsx` for fast TypeScript execution with watch mode.

### Type Safety

Full end-to-end type safety from request validation to database queries.

### API Testing

Swagger UI provides interactive API documentation and testing interface.

### Database Management

Drizzle Studio provides a web interface for database inspection and management.

## Production Considerations

### Database

SQLite is suitable for small to medium workloads. For high-scale deployments, consider:

- Turso (distributed SQLite)
- PostgreSQL with Drizzle
- MySQL with Drizzle

### File Storage

Audio uploads currently return mock URLs. In production, integrate with:

- AWS S3
- Google Cloud Storage
- Azure Blob Storage

### Event Publishing

Events are currently logged. In production, integrate with:

- Apache Kafka
- RabbitMQ
- AWS EventBridge
- Google Cloud Pub/Sub

### Monitoring

- Configure OpenTelemetry to send traces to Jaeger/Zipkin
- Use Winston transports for centralized logging
- Set up health check monitoring

### Security

- Use strong JWT secrets
- Implement rate limiting
- Add CORS configuration for web clients
- Use HTTPS in production
