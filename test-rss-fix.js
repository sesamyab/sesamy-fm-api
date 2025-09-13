// Test script to verify the RSS parsing fix
const rssContent = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:googleplay="http://www.google.com/schemas/play-podcasts/1.0" version="2.0">
<channel>
<title>Test Podcast</title>
<description>A test podcast with various episode numbering scenarios</description>
<item>
<title>Episode 0: Intro</title>
<description>Introduction episode numbered as 0</description>
<enclosure url="https://example.com/episode-0.mp3" length="1000000" type="audio/mpeg"/>
<itunes:duration>00:10:00</itunes:duration>
<itunes:season>1</itunes:season>
<itunes:episode>0</itunes:episode>
<itunes:episodeType>trailer</itunes:episodeType>
</item>
<item>
<title>Episode 1: First Episode</title>
<description>Regular first episode</description>
<enclosure url="https://example.com/episode-1.mp3" length="2000000" type="audio/mpeg"/>
<itunes:duration>00:25:30</itunes:duration>
<itunes:season>1</itunes:season>
<itunes:episode>1</itunes:episode>
<itunes:episodeType>full</itunes:episodeType>
</item>
<item>
<title>Bonus Episode</title>
<description>Bonus episode without episode number</description>
<enclosure url="https://example.com/bonus.mp3" length="1500000" type="audio/mpeg"/>
<itunes:duration>00:15:00</itunes:duration>
<itunes:season>1</itunes:season>
<itunes:episodeType>bonus</itunes:episodeType>
</item>
</channel>
</rss>`;

// Test the updated parsing functions (simulated fix)
function extractTextContent(xml, tagName, flags = "i") {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, flags);
  const match = xml.match(regex);
  return match ? match[1].trim().replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1") : "";
}

function extractItems(xml) {
  const regex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  const matches = xml.match(regex) || [];
  return matches;
}

// Updated parsing logic (simulated fix)
function parseEpisodeNumberFixed(itunesEpisodeStr) {
  if (!itunesEpisodeStr) return null;
  const parsed = parseInt(itunesEpisodeStr);
  return !isNaN(parsed) && parsed >= 0 ? parsed : null; // Changed from > 0 to >= 0
}

function parseSeasonNumberFixed(seasonStr) {
  if (!seasonStr) return null;
  const parsed = parseInt(seasonStr);
  return !isNaN(parsed) && parsed >= 0 ? parsed : null; // Changed from > 0 to >= 0
}

// Extract episodes and test the fix
const itemContents = extractItems(rssContent);

console.log(`Found ${itemContents.length} items:`);

itemContents.forEach((itemContent, index) => {
  console.log(`\n=== Item ${index + 1} ===`);

  const title = extractTextContent(itemContent, "title");
  console.log(`Title: "${title}"`);

  // Test season number parsing
  const seasonStr = extractTextContent(itemContent, "itunes:season");
  const seasonNumber = parseSeasonNumberFixed(seasonStr);
  console.log(`Season string: "${seasonStr}"`);
  console.log(`Season number (fixed): ${seasonNumber}`);

  // Test episode number parsing
  const episodeStr = extractTextContent(itemContent, "itunes:episode");
  const episodeNumber = parseEpisodeNumberFixed(episodeStr);
  console.log(`Episode string: "${episodeStr}"`);
  console.log(`Episode number (fixed): ${episodeNumber}`);

  // Test episode type
  const episodeType =
    extractTextContent(itemContent, "itunes:episodeType") || null;
  console.log(`Episode type: "${episodeType}"`);

  // Test validation with nonnegative
  const validSeason = seasonNumber !== null && seasonNumber >= 0;
  const validEpisode = episodeNumber !== null && episodeNumber >= 0;

  console.log(`✅ Season validation (nonnegative): ${validSeason}`);
  console.log(`✅ Episode validation (nonnegative): ${validEpisode}`);

  if (episodeNumber === 0) {
    console.log(`🎯 Episode 0 now properly handled!`);
  }
});
