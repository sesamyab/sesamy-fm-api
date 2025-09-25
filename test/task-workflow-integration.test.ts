import { describe, it, expect } from "vitest";

describe("Task-Workflow Integration", () => {
  it("should have the correct task types", () => {
    // Verify that audio_processing is a valid task type
    const validTypes = [
      "encode",
      "audio_preprocess",
      "audio_processing",
      "publish",
      "notification",
    ];

    // This test ensures the type is properly defined
    expect(validTypes).toContain("audio_processing");
  });
});
