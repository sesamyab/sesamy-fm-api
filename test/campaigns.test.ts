import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../src/app";

describe("Campaign Creative Upload Routes", () => {
  let app: any;

  beforeAll(() => {
    // Mock database and services for testing
    const mockDatabase = {} as D1Database;
    const mockBucket = {} as R2Bucket;

    app = createApp(
      mockDatabase,
      mockBucket,
      "test-access-key",
      "test-secret-key",
      "https://test-endpoint.com"
    );
  });

  it("should have image upload route defined", () => {
    // Get the OpenAPI specification
    const openapi = app.getOpenAPIDocument();

    // Check if the image upload endpoint exists
    const imageUploadPath =
      "/campaigns/{campaign_id}/creatives/{creative_id}/image";
    expect(openapi.paths).toHaveProperty(imageUploadPath);
    expect(openapi.paths[imageUploadPath]).toHaveProperty("post");
    expect(openapi.paths[imageUploadPath].post.summary).toBe(
      "Upload image file for creative"
    );
  });

  it("should have audio upload route defined", () => {
    // Get the OpenAPI specification
    const openapi = app.getOpenAPIDocument();

    // Check if the audio upload endpoint exists
    const audioUploadPath =
      "/campaigns/{campaign_id}/creatives/{creative_id}/audio";
    expect(openapi.paths).toHaveProperty(audioUploadPath);
    expect(openapi.paths[audioUploadPath]).toHaveProperty("post");
    expect(openapi.paths[audioUploadPath].post.summary).toBe(
      "Upload audio file for creative"
    );
  });

  it("should have video upload route defined", () => {
    // Get the OpenAPI specification
    const openapi = app.getOpenAPIDocument();

    // Check if the video upload endpoint exists
    const videoUploadPath =
      "/campaigns/{campaign_id}/creatives/{creative_id}/video";
    expect(openapi.paths).toHaveProperty(videoUploadPath);
    expect(openapi.paths[videoUploadPath]).toHaveProperty("post");
    expect(openapi.paths[videoUploadPath].post.summary).toBe(
      "Upload video file for creative"
    );
  });

  it("should have correct request schema for image upload", () => {
    const openapi = app.getOpenAPIDocument();
    const imageUploadRoute =
      openapi.paths["/campaigns/{campaign_id}/creatives/{creative_id}/image"]
        .post;

    expect(imageUploadRoute.requestBody).toBeDefined();
    expect(imageUploadRoute.requestBody.content).toHaveProperty(
      "multipart/form-data"
    );

    const schema =
      imageUploadRoute.requestBody.content["multipart/form-data"].schema;
    expect(schema.properties).toHaveProperty("image");
    expect(schema.properties.image.type).toBe("string");
    expect(schema.properties.image.format).toBe("binary");
    expect(schema.required).toContain("image");
  });

  it("should return 201 on successful upload", () => {
    const openapi = app.getOpenAPIDocument();
    const imageUploadRoute =
      openapi.paths["/campaigns/{campaign_id}/creatives/{creative_id}/image"]
        .post;

    expect(imageUploadRoute.responses).toHaveProperty("201");
    expect(imageUploadRoute.responses["201"].description).toBe(
      "Image uploaded successfully"
    );
  });
});
