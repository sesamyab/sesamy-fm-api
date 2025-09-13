import { z } from "zod";
import type { RSSShow, RSSEpisode } from "./types";

// Basic RSS parsing error types
export class RSSParseError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = "RSSParseError";
  }
}

export class RSSValidationError extends Error {
  constructor(message: string, public validationErrors: z.ZodIssue[]) {
    super(message);
    this.name = "RSSValidationError";
  }
}

// Helper functions for XML parsing using regex
function extractTextContent(xml: string, tagName: string, flags = "i"): string {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, flags);
  const match = xml.match(regex);
  return match ? match[1].trim().replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1") : "";
}

function extractAttribute(
  xml: string,
  tagName: string,
  attributeName: string
): string {
  const regex = new RegExp(
    `<${tagName}[^>]*${attributeName}=["']([^"']*?)["'][^>]*>`,
    "i"
  );
  const match = xml.match(regex);
  return match ? match[1] : "";
}

function extractMultipleTextContent(xml: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "gi");
  const matches = xml.match(regex) || [];
  return matches
    .map((match) => {
      const textMatch = match.match(
        new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i")
      );
      return textMatch
        ? textMatch[1].trim().replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
        : "";
    })
    .filter(Boolean);
}

function extractItems(xml: string): string[] {
  const regex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  const matches = xml.match(regex) || [];
  return matches;
}

// Parse duration from various formats (HH:MM:SS, MM:SS, seconds)
function parseDuration(durationStr: string): number | null {
  if (!durationStr) return null;

  // If it's just a number (seconds)
  const secondsOnly = parseInt(durationStr);
  if (!isNaN(secondsOnly) && secondsOnly.toString() === durationStr) {
    return secondsOnly;
  }

  // Parse HH:MM:SS or MM:SS format
  const parts = durationStr
    .split(":")
    .map((p) => parseInt(p))
    .reverse();
  if (parts.length === 0 || parts.some((p) => isNaN(p))) return null;

  let totalSeconds = 0;
  if (parts[0] !== undefined) totalSeconds += parts[0]; // seconds
  if (parts[1] !== undefined) totalSeconds += parts[1] * 60; // minutes
  if (parts[2] !== undefined) totalSeconds += parts[2] * 3600; // hours

  return totalSeconds;
}

// Parse RFC 2822 date format commonly used in RSS
function parseRSSDate(dateStr: string): string | null {
  if (!dateStr) return null;

  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}

// Extract episode number from title or other elements
function extractEpisodeNumber(title: string, guid: string): number | null {
  // Try to extract from title patterns like "Episode 123", "#123", "Ep. 123"
  const patterns = [
    /episode\s*(\d+)/i,
    /#(\d+)/,
    /ep\.?\s*(\d+)/i,
    /^(\d+)[\.\-\s]/,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1]) {
      const num = parseInt(match[1]);
      if (!isNaN(num) && num >= 0) return num;
    }
  }

  // Try to extract from GUID if it contains a number
  const guidMatch = guid.match(/(\d+)/);
  if (guidMatch && guidMatch[1]) {
    const num = parseInt(guidMatch[1]);
    if (!isNaN(num) && num >= 0) return num;
  }

  return null;
}

export async function fetchAndParseRSS(rssUrl: string): Promise<RSSShow> {
  try {
    // Fetch the RSS feed
    const response = await fetch(rssUrl, {
      headers: {
        "User-Agent": "Sesamy Podcast Importer/1.0",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      // Add timeout
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      throw new RSSParseError(
        `HTTP ${response.status}: ${response.statusText}`
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("xml") && !contentType.includes("rss")) {
      console.warn(
        `Unexpected content-type: ${contentType}, attempting to parse anyway`
      );
    }

    const xmlText = await response.text();

    // Extract channel content
    const channelMatch = xmlText.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
    if (!channelMatch) {
      throw new RSSParseError("No channel element found in RSS feed");
    }

    const channelContent = channelMatch[1];

    // Extract show information
    const title = extractTextContent(channelContent, "title");
    const description =
      extractTextContent(channelContent, "description") ||
      extractTextContent(channelContent, "itunes:summary") ||
      extractTextContent(channelContent, "summary");

    if (!title) {
      throw new RSSParseError("RSS feed missing required title");
    }

    if (!description) {
      throw new RSSParseError("RSS feed missing required description");
    }

    // Extract show image
    let imageUrl: string | null = null;

    // Try iTunes image first
    imageUrl = extractAttribute(channelContent, "itunes:image", "href");

    // Try standard image if iTunes not found
    if (!imageUrl) {
      const imageContent = extractTextContent(channelContent, "image");
      if (imageContent) {
        imageUrl = extractTextContent(imageContent, "url");
      }
    }

    // Extract additional metadata
    const language = extractTextContent(channelContent, "language");
    const author =
      extractTextContent(channelContent, "itunes:author") ||
      extractTextContent(channelContent, "managingEditor") ||
      extractTextContent(channelContent, "author");

    // Extract categories
    const categories = extractMultipleTextContent(channelContent, "category");
    const itunesCategories = extractMultipleTextContent(
      channelContent,
      "itunes:category"
    );
    const allCategories = [...categories, ...itunesCategories].filter(Boolean);

    // Extract episodes
    const episodes: RSSEpisode[] = [];
    const itemContents = extractItems(xmlText);

    for (const itemContent of itemContents) {
      const episodeTitle = extractTextContent(itemContent, "title");
      const episodeDescription =
        extractTextContent(itemContent, "description") ||
        extractTextContent(itemContent, "itunes:summary") ||
        extractTextContent(itemContent, "content:encoded") ||
        extractTextContent(itemContent, "summary");

      if (!episodeTitle || !episodeDescription) {
        console.warn("Skipping episode with missing title or description");
        continue;
      }

      // Find audio enclosure
      const enclosureMatch = itemContent.match(
        /<enclosure[^>]*type=["'][^"']*audio[^"']*["'][^>]*>/i
      );
      if (!enclosureMatch) {
        console.warn(
          `Skipping episode "${episodeTitle}" - no audio enclosure found`
        );
        continue;
      }

      const audioUrl = extractAttribute(enclosureMatch[0], "enclosure", "url");
      if (!audioUrl) {
        console.warn(`Skipping episode "${episodeTitle}" - no audio URL found`);
        continue;
      }

      // Extract episode metadata
      const episodeImageUrl =
        extractAttribute(itemContent, "itunes:image", "href") || null;

      // Parse published date
      const pubDate = extractTextContent(itemContent, "pubDate");
      const publishedAt = parseRSSDate(pubDate);

      // Parse duration
      const durationStr = extractTextContent(itemContent, "itunes:duration");
      let duration = parseDuration(durationStr);
      // Ensure duration is positive or null (0 duration would fail validation)
      if (duration !== null && duration <= 0) {
        duration = null;
      }

      // Extract episode number - try iTunes episode first, then fallback to extraction from title/guid
      const itunesEpisodeStr = extractTextContent(
        itemContent,
        "itunes:episode"
      );
      let episodeNumber: number | null = null;
      if (itunesEpisodeStr) {
        const parsed = parseInt(itunesEpisodeStr);
        episodeNumber = !isNaN(parsed) && parsed >= 0 ? parsed : null;
      } else {
        // Fallback to extracting from title/guid
        const guid = extractTextContent(itemContent, "guid");
        episodeNumber = extractEpisodeNumber(episodeTitle, guid);
      }

      // Extract season number (if available)
      const seasonStr = extractTextContent(itemContent, "itunes:season");
      let seasonNumber: number | null = null;
      if (seasonStr) {
        const parsed = parseInt(seasonStr);
        seasonNumber = !isNaN(parsed) && parsed >= 0 ? parsed : null;
      }

      // Extract additional metadata
      const episodeType =
        extractTextContent(itemContent, "itunes:episodeType") || null;
      const author = extractTextContent(itemContent, "itunes:author") || null;
      const subtitle =
        extractTextContent(itemContent, "itunes:subtitle") || null;

      // Extract explicit flag
      const explicitStr = extractTextContent(itemContent, "itunes:explicit");
      let explicit: boolean | null = null;
      if (explicitStr) {
        explicit =
          explicitStr.toLowerCase() === "true" ||
          explicitStr.toLowerCase() === "yes";
      }

      // Extract keywords from iTunes categories and keywords
      const itunesCategories = extractMultipleTextContent(
        itemContent,
        "itunes:category"
      );
      const itunesKeywords = extractTextContent(itemContent, "itunes:keywords");
      const keywords: string[] = [];

      // Add categories as keywords
      keywords.push(...itunesCategories);

      // Add comma-separated keywords
      if (itunesKeywords) {
        keywords.push(
          ...itunesKeywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
        );
      }

      episodes.push({
        title: episodeTitle,
        description: episodeDescription,
        audioUrl,
        imageUrl: episodeImageUrl,
        publishedAt,
        duration,
        episodeNumber,
        seasonNumber,
        episodeType,
        author,
        subtitle,
        explicit,
        keywords: keywords.length > 0 ? keywords : null,
      });
    }

    if (episodes.length === 0) {
      throw new RSSParseError("No valid episodes found in RSS feed");
    }

    // Create the show object
    const show: RSSShow = {
      title,
      description,
      imageUrl,
      language: language || undefined,
      categories: allCategories.length > 0 ? allCategories : undefined,
      author: author || undefined,
      episodes: episodes.reverse(), // Reverse to get chronological order (oldest first)
    };

    // Validate the parsed data
    try {
      const { RSSShowSchema } = await import("./types");
      return RSSShowSchema.parse(show);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new RSSValidationError(
          "RSS feed validation failed",
          error.issues
        );
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof RSSParseError || error instanceof RSSValidationError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new RSSParseError("RSS feed fetch timeout");
      }
      if (error.message.includes("fetch")) {
        throw new RSSParseError(`Failed to fetch RSS feed: ${error.message}`);
      }
    }

    throw new RSSParseError(
      `Unexpected error parsing RSS feed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
