import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { ShowService } from "../shows/service";
import { EpisodeRepository } from "../episodes/repository";
import { AudioService } from "../audio/service";

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

// Generate RSS feed for a show
function generateRSSFeed(
  show: any,
  episodes: any[],
  audioService?: AudioService
): string {
  const now = new Date().toUTCString();

  // Sign image URL if it's an R2 URL
  let imageUrl = show.imageUrl;
  if (audioService && show.imageUrl && show.imageUrl.startsWith("r2://")) {
    // For RSS feed, we'll use the R2 URL as is since we can't await here
    // In a real implementation, you might want to pre-sign these URLs
    imageUrl = show.imageUrl.replace(
      "r2://",
      "https://podcast-service-assets.sesamy.dev/"
    );
  }

  const episodeItems = episodes
    .filter((episode) => episode.published)
    .map((episode) => {
      let audioUrl = episode.audioUrl;
      if (
        audioService &&
        episode.audioUrl &&
        episode.audioUrl.startsWith("r2://")
      ) {
        audioUrl = episode.audioUrl.replace(
          "r2://",
          "https://podcast-service-assets.sesamy.dev/"
        );
      }

      return `
    <item>
      <title><![CDATA[${episode.title || "Untitled Episode"}]]></title>
      <description><![CDATA[${episode.description || ""}]]></description>
      <pubDate>${new Date(episode.createdAt).toUTCString()}</pubDate>
      <guid isPermaLink="false">${episode.id}</guid>
      ${
        audioUrl
          ? `<enclosure url="${audioUrl}" type="audio/mpeg" length="0"/>`
          : ""
      }
    </item>`;
    })
    .join("");

  const feedUrl = `https://podcast-service.sesamy-dev.workers.dev/feeds/${show.id}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title><![CDATA[${show.title || "Untitled Show"}]]></title>
    <description><![CDATA[${show.description || ""}]]></description>
    <link>https://podcast-service.sesamy.dev/shows/${show.id}</link>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>
    <language>en-us</language>
    <pubDate>${now}</pubDate>
    <lastBuildDate>${now}</lastBuildDate>
    <generator>Sesamy Podcast Service</generator>
    ${
      imageUrl
        ? `<image><url>${imageUrl}</url><title><![CDATA[${
            show.title || "Untitled Show"
          }]]></title><link>https://podcast-service.sesamy.dev/shows/${
            show.id
          }</link></image>`
        : ""
    }
    ${imageUrl ? `<itunes:image href="${imageUrl}"/>` : ""}
    <itunes:author>Sesamy Podcast Service</itunes:author>
    <itunes:email>podcast@sesamy.com</itunes:email>
    <itunes:category text="Technology"/>
    <itunes:explicit>no</itunes:explicit>
    ${episodeItems}
  </channel>
</rss>`;
}

export function registerFeedRoutes(
  app: OpenAPIHono,
  showService: ShowService,
  episodeRepository: EpisodeRepository,
  audioService?: AudioService
) {
  // --------------------------------
  // GET /feeds/{show_id}
  // --------------------------------
  app.openapi(getShowFeedRoute, async (c) => {
    const { show_id } = c.req.valid("param");
    const show = await showService.getShowByIdPublic(show_id);

    if (!show) {
      const problem = {
        type: "not_found",
        title: "Not Found",
        status: 404,
        detail: "Show not found",
        instance: c.req.path,
      };
      throw new HTTPException(404, { message: JSON.stringify(problem) });
    }

    // Get episodes for the show
    const episodes = await episodeRepository.findByShowId(show_id, {
      limit: 100,
      offset: 0,
    });

    // Generate RSS feed
    const rssFeed = generateRSSFeed(show, episodes, audioService);

    c.header("Content-Type", "application/rss+xml");
    return c.text(rssFeed);
  });
}
