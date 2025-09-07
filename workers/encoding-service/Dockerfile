# syntax=docker/dockerfile:1

FROM node:18-alpine

# Install FFmpeg and other dependencies
RUN apk add --no-cache \
    ffmpeg \
    curl \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package files from container source
COPY container_src/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY container_src/ ./

# Expose port (container listens on 8080, worker expects this)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/ || exit 1

# Start the application
CMD ["node", "index.js"]
