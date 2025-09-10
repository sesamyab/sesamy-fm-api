import { Container } from "@cloudflare/containers";

export class EncodingContainer extends Container {
  // Port the container listens on (default: 8080)
  defaultPort = 8080;
  // Time before container sleeps due to inactivity (15 minutes - increased for long-running tasks)
  sleepAfter = "15m";
  // Environment variables passed to the container
  envVars = {
    NODE_ENV: "production",
    // Add timeout settings for better container management
    CONTAINER_TIMEOUT: "15m",
  };

  // Optional lifecycle hooks
  onStart() {
    console.log("Encoding container successfully started");
  }

  onStop() {
    console.log("Encoding container successfully shut down");
  }

  onError(error: unknown) {
    console.log("Encoding container error:", error);
  }

  // Add better health checking
  onHealthCheck() {
    console.log("Encoding container health check");
    return { status: "healthy", timestamp: new Date().toISOString() };
  }
}
