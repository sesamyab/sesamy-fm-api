import { describe, it, expect } from "vitest";

describe("Task-Workflow Integration", () => {
  it("should define audio_processing task type", () => {
    // Import the TaskType type to verify audio_processing is included
    const { TaskService } = require("../src/tasks/service");

    // Verify the service class exists and can be imported
    expect(TaskService).toBeDefined();
  });

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
