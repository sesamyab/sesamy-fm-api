// Simple test script to debug the RSS parsing issue
const rssContent = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:googleplay="http://www.google.com/schemas/play-podcasts/1.0" version="2.0">
<channel>
<title>Det svarta guldet</title>
<description>En podd i sex delar om oljans historia</description>
<item>
<title>Trailer</title>
<description>En trailer</description>
<enclosure url="https://media.pod.space/detsvartaguldet/det-svarta-guldet-trailer-60-s.mp3" length="1198208" type="audio/mpeg"/>
<itunes:duration>00:01:14</itunes:duration>
<itunes:season>1</itunes:season>
</item>
<item>
<title>Del 1: Den fossila energin</title>
<description>Det här avsnittet fokuserar på perioden år 1840–1900</description>
<enclosure url="https://media.pod.space/detsvartaguldet/det-svarta-guldet-ep-1.mp3" length="41422976" type="audio/mpeg"/>
<itunes:duration>00:43:08</itunes:duration>
<itunes:season>1</itunes:season>
<itunes:episode>1</itunes:episode>
</item>
</channel>
</rss>`;

// Test the parsing functions
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

function parseDuration(durationStr) {
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

// Extract episodes and debug
const itemContents = extractItems(rssContent);

console.log(`Found ${itemContents.length} items:`);

itemContents.forEach((itemContent, index) => {
  console.log(`\n=== Item ${index + 1} ===`);

  const title = extractTextContent(itemContent, "title");
  console.log(`Title: "${title}"`);

  // Extract season number
  const seasonStr = extractTextContent(itemContent, "itunes:season");
  const seasonNumber = seasonStr ? parseInt(seasonStr) : null;
  console.log(`Season string: "${seasonStr}"`);
  console.log(`Season number: ${seasonNumber}`);
  console.log(`Season isNaN: ${isNaN(seasonNumber)}`);

  // Extract episode number
  const episodeStr = extractTextContent(itemContent, "itunes:episode");
  const episodeNumber = episodeStr ? parseInt(episodeStr) : null;
  console.log(`Episode string: "${episodeStr}"`);
  console.log(`Episode number: ${episodeNumber}`);
  console.log(`Episode isNaN: ${isNaN(episodeNumber)}`);

  // Test current logic
  const currentSeasonLogic = !isNaN(seasonNumber) ? seasonNumber : null;
  const currentEpisodeLogic = !isNaN(episodeNumber) ? episodeNumber : null;

  console.log(`Current season logic result: ${currentSeasonLogic}`);
  console.log(`Current episode logic result: ${currentEpisodeLogic}`);

  // Duration test
  const durationStr = extractTextContent(itemContent, "itunes:duration");
  const duration = parseDuration(durationStr);
  console.log(`Duration string: "${durationStr}"`);
  console.log(`Duration parsed: ${duration}`);

  // Check validation issues
  if (currentSeasonLogic === 0) {
    console.log("❌ VALIDATION ERROR: Season number is 0 (not positive)");
  }
  if (currentEpisodeLogic === 0) {
    console.log("❌ VALIDATION ERROR: Episode number is 0 (not positive)");
  }
  if (duration === 0) {
    console.log("❌ VALIDATION ERROR: Duration is 0 (not positive)");
  }
});
