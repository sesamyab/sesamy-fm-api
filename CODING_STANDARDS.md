# Coding Standards

## Route Definition Pattern

### Preferred: Inline Route Definitions

Route definitions should be defined inline within the `app.openapi()` call rather than as separate constants. This reduces code complexity and keeps route definitions close to their handlers.

**✅ Preferred Pattern:**

```typescript
app.openapi(
  {
    method: "get",
    path: "/campaigns/{campaign_id}/creatives",
    tags: ["creatives"],
    summary: "Get campaign creatives",
    description: "Get all creatives for a campaign",
    request: {
      params: CampaignParamsSchema,
    },
    responses: {
      200: {
        description: "Creatives retrieved successfully",
        content: {
          "application/json": {
            schema: z.array(CreativeSchema),
          },
        },
      },
      404: {
        description: "Campaign not found",
        content: {
          "application/json": {
            schema: z.object({ message: z.string() }),
          },
        },
      },
    },
  },
  async (c) => {
    const { campaign_id } = c.req.valid("param");

    try {
      const creatives = await campaignService.getCampaignCreatives(campaign_id);
      return c.json(creatives, 200);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      console.error("Error getting campaign creatives:", error);
      throw new HTTPException(500, { message: "Internal server error" });
    }
  }
);
```

**❌ Avoid:**

```typescript
// Don't define routes as separate constants
const getCampaignCreativesRoute = createRoute({
  method: "get",
  path: "/campaigns/{campaign_id}/creatives",
  // ... route definition
});

// Don't separate route definition from handler
app.openapi(getCampaignCreativesRoute, async (c) => {
  // ... handler implementation
});
```

### Benefits of Inline Route Definitions

1. **Reduced Code Complexity**: Eliminates the need for intermediate constants
2. **Better Locality**: Route definition and handler are co-located
3. **Fewer Lines of Code**: Reduces overall file length
4. **Easier Maintenance**: No need to track separate route constant names

### Migration Strategy

When refactoring existing route files:

1. Remove the `const routeName = createRoute({ ... });` declaration
2. Move the route configuration object directly into the `app.openapi()` call
3. Ensure proper TypeScript formatting and indentation
4. Verify that all imports are still needed after removing route constants

### Files to Update

This pattern should be applied to all route files in the project:

- `src/campaigns/routes.ts` ✅ (getCampaignCreativesRoute completed)
- `src/shows/routes.ts`
- `src/episodes/routes.ts`
- `src/organizations/routes.ts`
- `src/feed/routes.ts`
- `src/storage/routes.ts`
- `src/audio/routes.ts`
- `src/encoding/routes.ts`
- `src/transcription/routes.ts`
- `src/tasks/routes.ts`
- `src/workflows/routes.ts`
- `src/health/routes.ts`

### Copilot Instructions

When creating new routes or refactoring existing ones, always use the inline pattern. Do not create separate `createRoute()` constants unless there's a specific need to reuse the route definition across multiple handlers (which is rare).
