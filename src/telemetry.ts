import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import winston from "winston";

// Initialize OpenTelemetry
const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "podcast-service",
    [SemanticResourceAttributes.SERVICE_VERSION]: "1.0.0",
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

// Start telemetry
try {
  sdk.start();
  console.log("OpenTelemetry started successfully");
} catch (error) {
  console.log("Error initializing OpenTelemetry", error);
}

// Configure structured logging
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.printf(
      ({ timestamp, level, message, service, trace_id, span_id, ...meta }) => {
        return JSON.stringify({
          timestamp,
          level: level.toUpperCase(),
          service: service || "podcast-service",
          trace_id: trace_id || "",
          span_id: span_id || "",
          message,
          ...meta,
        });
      }
    )
  ),
  transports: [new winston.transports.Console()],
});

// Graceful shutdown
process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .then(() => logger.info("OpenTelemetry terminated"))
    .catch((error) => logger.error("Error terminating OpenTelemetry", error))
    .finally(() => process.exit(0));
});
