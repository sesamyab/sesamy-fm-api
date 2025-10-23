import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { Env } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { ShowService } from "../shows/service";
import { EpisodeRepository } from "../episodes/repository";
import { generateRSSFeed } from "./rss-generator";

// Show ID parameter schema
const FeedParamsSchema = z.object({
  show_id: z.string().uuid(),
});

// RSS feed route
const getShowFeedRoute = createRoute({
  method: "get",
  path: "/feeds/{show_id}",
  tags: ["feeds"],
  summary: "Get RSS feed for show",
  description:
    "Generate RSS feed for the podcast show (no authentication required)",
  request: {
    params: FeedParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/rss+xml": {
          schema: z.string(),
        },
      },
      description: "RSS feed",
    },
    404: {
      description: "Show not found",
    },
  },
});

export function createFeedRoutes(
  showService: ShowService,
  episodeRepository: EpisodeRepository
) {
  const app = new OpenAPIHono();

  // --------------------------------
  // GET /feeds/{show_id}
  // --------------------------------
  app.openapi(getShowFeedRoute, async (ctx) => {
    const { show_id } = ctx.req.valid("param");
    const show = await showService.getShowByIdPublic(show_id);

    if (!show) {
      const problem = {
        type: "not_found",
        title: "Not Found",
        status: 404,
        detail: "Show not found",
        instance: ctx.req.path,
      };
      throw new HTTPException(404, { message: JSON.stringify(problem) });
    }

    // Get episodes for the show
    const episodes = await episodeRepository.findByShowId(show_id, {
      limit: 100,
      offset: 0,
    });

    // Generate RSS feed
    const rssFeed = generateRSSFeed({
      show,
      episodes,
    });

    ctx.header("Content-Type", "application/rss+xml");
    return ctx.text(rssFeed);
  });

  return app;
}
