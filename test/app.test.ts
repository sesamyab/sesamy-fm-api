import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";

describe("Podcast Service", () => {
  const app = createApp();

  it("should return service info", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toEqual({
      name: "podcast-service",
      version: "1.0.0",
    });
  });

  it("should return health status", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe("healthy");
    expect(data.service).toBe("podcast-service");
    expect(data.version).toBe("1.0.0");
  });

  it("should return openapi spec", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.openapi).toBe("3.0.0");
    expect(data.info.title).toBe("Podcast Service API");
  });
});
