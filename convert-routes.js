#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function convertRouteFile(filePath) {
  console.log(`Converting ${filePath}...`);

  let content = fs.readFileSync(filePath, "utf8");

  // Pattern to match: const routeName = createRoute({ ... });
  const routeRegex = /const\s+(\w+)\s+=\s+createRoute\(\{([\s\S]*?)\}\);\s*$/gm;
  const routes = [];
  let match;

  // Find all route definitions
  while ((match = routeRegex.exec(content)) !== null) {
    routes.push({
      name: match[1],
      definition: match[2].trim(),
      fullMatch: match[0],
    });
  }

  // Remove all route definitions
  routes.forEach((route) => {
    content = content.replace(route.fullMatch, "");
  });

  // Find and replace app.openapi calls
  routes.forEach((route) => {
    const openApiRegex = new RegExp(
      `app\\.openapi\\(${route.name},\\s*(async\\s*\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?\\}\\s*\\))\\s*;`,
      "g"
    );

    content = content.replace(openApiRegex, (match, handlerFunction) => {
      return `app.openapi({\n${route.definition}\n}, ${handlerFunction});`;
    });
  });

  // Clean up extra blank lines
  content = content.replace(/\n\n\n+/g, "\n\n");

  fs.writeFileSync(filePath, content);
  console.log(`Converted ${routes.length} routes in ${filePath}`);
}

// Get all route files
const routeFiles = [
  "src/campaigns/routes.ts",
  "src/shows/routes.ts",
  "src/episodes/routes.ts",
  "src/organizations/routes.ts",
  "src/feed/routes.ts",
  "src/storage/routes.ts",
  "src/audio/routes.ts",
  "src/encoding/routes.ts",
  "src/transcription/routes.ts",
  "src/tasks/routes.ts",
  "src/workflows/routes.ts",
  "src/health/routes.ts",
];

const baseDir = "/Users/markus/Projects/sesamy/sesamy-fm-api";

routeFiles.forEach((file) => {
  const fullPath = path.join(baseDir, file);
  if (fs.existsSync(fullPath)) {
    try {
      convertRouteFile(fullPath);
    } catch (error) {
      console.error(`Error converting ${file}:`, error.message);
    }
  } else {
    console.log(`File not found: ${fullPath}`);
  }
});

console.log("Route conversion complete!");
