/**
 * Edge-compatible telemetry for Cloudflare Workers
 * Simplified logging without Node.js specific APIs
 */

// Simple structured logger for edge environments
export const logger = {
  info: (message: string, meta?: Record<string, any>) => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        service: "podcast-service",
        message,
        ...meta,
      })
    );
  },

  warn: (message: string, meta?: Record<string, any>) => {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "WARN",
        service: "podcast-service",
        message,
        ...meta,
      })
    );
  },

  error: (message: string, error?: Error | any) => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        service: "podcast-service",
        message,
        error: error?.message || error,
        stack: error?.stack,
      })
    );
  },

  debug: (message: string, meta?: Record<string, any>) => {
    if (process.env.NODE_ENV === "development") {
      console.debug(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "DEBUG",
          service: "podcast-service",
          message,
          ...meta,
        })
      );
    }
  },
};

// Export for backward compatibility
export default logger;
