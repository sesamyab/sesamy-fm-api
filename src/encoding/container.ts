import { Container } from "@cloudflare/containers";

export class EncodingContainer extends Container {
  // Port the container listens on (default: 8080)
  defaultPort = 8080;
  // Time before container sleeps due to inactivity (default: 30s)
  sleepAfter = "10m";
  // Environment variables passed to the container
  envVars = {
    NODE_ENV: "production",
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
}
