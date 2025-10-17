import { XMLBuilder } from "fast-xml-parser";

interface RSSEpisode {
  id: string;
  title: string;
  description?: string | null;
  audioUrl?: string | null;
  audioFileSize?: number | null;
  createdAt: Date | string;
  published: boolean | null;
}

interface RSSShow {
  id: string;
  title: string;
  description?: string | null;
  imageUrl?: string | null;
}

interface RSSFeedOptions {
  show: RSSShow;
  episodes: RSSEpisode[];
  feedBaseUrl?: string;
  showBaseUrl?: string;
}

/**
 * Generate an RSS 2.0 podcast feed with iTunes tags
 * Follows RSS 2.0 and iTunes podcast specifications
 */
export function generateRSSFeed(options: RSSFeedOptions): string {
  const {
    show,
    episodes,
    feedBaseUrl = "https://podcast-service.sesamy-dev.workers.dev/feeds",
    showBaseUrl = "https://podcast-service.sesamy.dev/shows",
  } = options;

  const now = new Date().toUTCString();
  const feedUrl = `${feedBaseUrl}/${show.id}`;

  // Process image URL (convert R2 URLs to public URLs)
  const imageUrl = show.imageUrl?.startsWith("r2://")
    ? show.imageUrl.replace(
        "r2://",
        "https://podcast-service-assets.sesamy.dev/"
      )
    : show.imageUrl;

  // Build episode items
  const items = episodes
    .filter((episode) => episode.published)
    .map((episode) => {
      // Process audio URL (convert R2 URLs to public URLs)
      const audioUrl = episode.audioUrl?.startsWith("r2://")
        ? episode.audioUrl.replace(
            "r2://",
            "https://podcast-service-assets.sesamy.dev/"
          )
        : episode.audioUrl;

      const item: any = {
        title: episode.title || "Untitled Episode",
        description: episode.description || "",
        pubDate: new Date(episode.createdAt).toUTCString(),
        guid: {
          "#text": episode.id,
          "@_isPermaLink": "false",
        },
      };

      if (audioUrl) {
        item.enclosure = {
          "@_url": audioUrl,
          "@_type": "audio/mpeg",
          "@_length": episode.audioFileSize || 1, // Use actual file size or fallback to 1 (not 0)
        };
      }

      return item;
    });

  // Build the RSS feed structure
  const feedObject = {
    "?xml": {
      "@_version": "1.0",
      "@_encoding": "UTF-8",
    },
    rss: {
      "@_version": "2.0",
      "@_xmlns:itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
      "@_xmlns:atom": "http://www.w3.org/2005/Atom",
      channel: {
        title: show.title || "Untitled Show",
        description: show.description || "",
        link: `${showBaseUrl}/${show.id}`,
        "atom:link": {
          "@_href": feedUrl,
          "@_rel": "self",
          "@_type": "application/rss+xml",
        },
        language: "en", // ISO-639-1 format (lowercase)
        pubDate: now,
        lastBuildDate: now,
        generator: "Sesamy Podcast Service",
        ...(imageUrl && {
          image: {
            url: imageUrl,
            title: show.title || "Untitled Show",
            link: `${showBaseUrl}/${show.id}`,
          },
        }),
        ...(imageUrl && {
          "itunes:image": {
            "@_href": imageUrl,
          },
        }),
        "itunes:author": "Sesamy Podcast Service",
        "itunes:summary": show.description || "",
        "itunes:owner": {
          "itunes:name": "Sesamy Podcast Service",
          "itunes:email": "podcast@sesamy.com",
        },
        "itunes:type": "episodic",
        "itunes:category": {
          "@_text": "Technology",
        },
        "itunes:explicit": "no",
        item: items,
      },
    },
  };

  // Build XML
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    indentBy: "  ",
    suppressEmptyNode: true,
    cdataPropName: "#text",
  });

  return builder.build(feedObject);
}
