// AWS Lambda handler that wraps the Hono app
const { promises: fs } = require("fs");
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("fluent-ffmpeg");
const { Hono } = require("hono");

// Import the main encoding logic from the container
const { createEncodingApp } = require("./lambda-app");

// Create the Hono app
const app = createEncodingApp();

// Lambda handler function
exports.handler = async (event, context) => {
  try {
    console.log("Lambda event:", JSON.stringify(event, null, 2));

    // Convert Lambda event to Request object
    const url = `https://${event.headers.host}${
      event.rawPath || event.path || "/"
    }`;
    const queryString =
      event.rawQueryString || event.queryStringParameters
        ? new URLSearchParams(event.queryStringParameters || {}).toString()
        : "";
    const fullUrl = queryString ? `${url}?${queryString}` : url;

    const request = new Request(fullUrl, {
      method: event.httpMethod || event.requestContext?.http?.method || "GET",
      headers: event.headers,
      body: event.isBase64Encoded
        ? Buffer.from(event.body || "", "base64").toString()
        : event.body || undefined,
    });

    // Process with Hono app
    const response = await app.fetch(request);

    // Convert Response to Lambda format
    const responseBody = await response.text();

    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
      isBase64Encoded: false,
    };
  } catch (error) {
    console.error("Lambda handler error:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: false,
        error: "Internal server error",
        message: error.message,
      }),
      isBase64Encoded: false,
    };
  }
};
