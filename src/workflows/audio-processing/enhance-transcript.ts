import { v4 as uuidv4 } from "uuid";
import { EpisodeRepository } from "../../episodes/repository";
import { mergeTranscriptions } from "./utils";
import type {
  Env,
  WorkflowState,
  TranscribedChunk,
  Chapter,
  EnhancedTranscriptResult,
  Word,
} from "./types";

// Helper function to extract nova-3 features from transcribed chunks
function extractNova3Features(transcribedChunks: TranscribedChunk[]) {
  const allSentiments: any[] = [];
  const allSpeakers: any[] = [];
  const allKeywords: any[] = [];
  const allParagraphs: any[] = [];
  const allChapters: any[] = [];
  let detectedLanguage: string | undefined;
  let summary: string | undefined;

  for (const chunk of transcribedChunks) {
    if (chunk.metadata) {
      if (chunk.metadata.sentiments)
        allSentiments.push(...chunk.metadata.sentiments);
      if (chunk.metadata.speakers) allSpeakers.push(...chunk.metadata.speakers);
      if (chunk.metadata.keywords) allKeywords.push(...chunk.metadata.keywords);
      if (chunk.metadata.paragraphs)
        allParagraphs.push(...chunk.metadata.paragraphs);
      if (chunk.metadata.chapters) allChapters.push(...chunk.metadata.chapters);
      if (chunk.metadata.language && !detectedLanguage)
        detectedLanguage = chunk.metadata.language;
      if (chunk.metadata.summary && !summary) summary = chunk.metadata.summary;
    }
  }

  return {
    hasExtractedFeatures:
      allSentiments.length > 0 ||
      allSpeakers.length > 0 ||
      allKeywords.length > 0 ||
      allChapters.length > 0,
    sentiments: allSentiments,
    speakers: allSpeakers,
    keywords: allKeywords,
    paragraphs: allParagraphs,
    chapters: allChapters,
    language: detectedLanguage,
    summary,
  };
}

// Helper function to generate chapters from speakers
function generateChaptersFromSpeakers(
  speakers: any[] | undefined,
  words: Word[]
): Chapter[] {
  if (!speakers || speakers.length === 0) return [];

  const chapters: Chapter[] = [];
  const speakerChanges = speakers.sort((a: any, b: any) => a.start - b.start);

  for (let i = 0; i < speakerChanges.length; i++) {
    const speaker = speakerChanges[i];
    const nextSpeaker = speakerChanges[i + 1];

    chapters.push({
      title: `Speaker: ${speaker.speaker}`,
      startTime: speaker.start,
      endTime: nextSpeaker
        ? nextSpeaker.start
        : words.length > 0
        ? words[words.length - 1].end
        : speaker.end,
      summary: `Segment with ${speaker.speaker}`,
    });
  }

  return chapters;
}

// Helper function to generate markdown from paragraphs
function generateMarkdownFromParagraphs(
  paragraphs: any[] | undefined,
  speakers: any[] | undefined
): string {
  if (!paragraphs || paragraphs.length === 0) {
    return "# Transcript\n\n*No structured paragraphs available*";
  }

  let markdown = "# Transcript\n\n";

  for (const paragraph of paragraphs) {
    const speaker = paragraph.speaker || "Unknown Speaker";
    markdown += `**${speaker}:** ${paragraph.text}\n\n`;
  }

  return markdown;
}

export async function enhanceTranscript(
  env: Env,
  workflowState: WorkflowState,
  transcribedChunks: TranscribedChunk[]
): Promise<EnhancedTranscriptResult> {
  // First merge the basic transcriptions
  const mergedTranscript = mergeTranscriptions(
    transcribedChunks,
    workflowState.overlapDuration
  );

  console.log(
    `Processing transcript enhancement for ${mergedTranscript.totalWords} words`
  );

  // Extract nova-3 features if available
  const nova3Features = extractNova3Features(transcribedChunks);

  let enhancedContent: any;

  if (workflowState.useNova3Features && nova3Features.hasExtractedFeatures) {
    console.log("Using nova-3 extracted features instead of AI enhancement");
    // Use nova-3 extracted features directly
    enhancedContent = {
      summary: nova3Features.summary || "Summary not available",
      keywords: nova3Features.keywords?.map((k) => k.keyword) || [],
      persons: nova3Features.speakers?.map((s) => s.speaker) || [],
      places: [], // Nova-3 doesn't extract places, we might need AI for this
      chapters: generateChaptersFromSpeakers(
        nova3Features.speakers,
        mergedTranscript.words
      ),
      markdown: generateMarkdownFromParagraphs(
        nova3Features.paragraphs,
        nova3Features.speakers
      ),
      sentiments: nova3Features.sentiments || [],
      detectedLanguage: nova3Features.language,
    };
  } else {
    // Use Cloudflare AI to enhance the transcript (fallback)
    enhancedContent = await enhanceWithCloudflareAI(
      env,
      mergedTranscript.text,
      mergedTranscript.words,
      workflowState.transcriptionLanguage || "en"
    );
  }

  // Store enhanced transcript as comprehensive JSON
  const transcriptId = uuidv4();
  const enhancedTranscriptKey = `transcripts/${workflowState.episodeId}/${transcriptId}-enhanced.json`;

  // Create comprehensive transcript data
  const comprehensiveTranscript = {
    episodeId: workflowState.episodeId,
    workflowId: workflowState.workflowId,
    createdAt: new Date().toISOString(),
    language: workflowState.transcriptionLanguage || "en",
    summary: enhancedContent.summary,
    keywords: enhancedContent.keywords,
    persons: enhancedContent.persons,
    places: enhancedContent.places,
    chapters: enhancedContent.chapters,
    markdown: enhancedContent.markdown,
    originalWords: mergedTranscript.words,
    totalWords: mergedTranscript.totalWords,
    totalParagraphs: enhancedContent.paragraphs,
    vtt: enhancedContent.vtt,
    words: enhancedContent.fixedWords,
    chunks: transcribedChunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      startTime: chunk.startTime,
      endTime: chunk.endTime,
      words: chunk.words,
      text: chunk.words.map((w) => w.word).join(" "),
    })),
  };

  await env.BUCKET.put(
    enhancedTranscriptKey,
    JSON.stringify(comprehensiveTranscript, null, 2),
    {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        contentLanguage: workflowState.transcriptionLanguage || "en",
      },
      customMetadata: {
        episodeId: workflowState.episodeId,
        workflowId: workflowState.workflowId,
        createdAt: new Date().toISOString(),
        processingMode: "ai-enhanced-comprehensive",
        totalChapters: enhancedContent.chapters.length.toString(),
        totalKeywords: enhancedContent.keywords.length.toString(),
        totalPersons: enhancedContent.persons.length.toString(),
        totalPlaces: enhancedContent.places.length.toString(),
        totalWords: mergedTranscript.totalWords.toString(),
        hasChapters: "true",
        hasKeywords: "true",
        hasPersons: "true",
        hasPlaces: "true",
        hasVtt: "true",
        hasMarkdown: "true",
        hasSummary: enhancedContent.summary ? "true" : "false",
      },
    }
  );

  const enhancedTranscriptUrl = `${env.R2_ENDPOINT}/${enhancedTranscriptKey}`;

  // Update episode with enhanced transcript reference
  const episodeRepository = new EpisodeRepository(env.DB);
  await episodeRepository.updateByIdOnly(workflowState.episodeId, {
    transcriptUrl: enhancedTranscriptUrl,
    keywords: JSON.stringify(enhancedContent.keywords),
  });

  return {
    enhancedTranscriptUrl,
    keywords: enhancedContent.keywords,
    chapters: enhancedContent.chapters,
    paragraphs: enhancedContent.paragraphs,
    summary: enhancedContent.summary,
  };
}

interface EnhancedContent {
  enhancedText: string;
  keywords: string[];
  chapters: Chapter[];
  paragraphs: number;
  summary?: string;
  persons: string[];
  places: string[];
  vtt: string;
  fixedWords: Array<{ word: string; start: number; end: number }>;
  markdown: string;
}

async function enhanceWithCloudflareAI(
  env: Env,
  rawText: string,
  words: Array<{ word: string; start: number; end: number }>,
  language: string
): Promise<EnhancedContent> {
  console.log(
    `Processing complete transcript for AI enhancement (${rawText.length} characters)`
  );

  // Process the entire text at once to handle overlaps properly
  let enhancedText: string;

  // If text is too long, we need to split it but handle overlaps intelligently
  const maxChunkLength = 4000; // Conservative limit for AI processing

  if (rawText.length <= maxChunkLength) {
    // Text is short enough to process in one go
    enhancedText = await enhanceFullText(env, rawText);
  } else {
    // Text is too long, need to split but handle overlaps
    enhancedText = await enhanceTextWithOverlapHandling(
      env,
      rawText,
      maxChunkLength
    );
  }

  const paragraphs = enhancedText
    .split("\n\n")
    .filter((p) => p.trim().length > 0).length;

  // Generate all content in parallel for efficiency
  const [keywords, chapters, summary, persons, places, fixedWords] =
    await Promise.all([
      generateKeywords(env, rawText),
      generateChapters(env, rawText, words),
      generateSummary(env, rawText),
      generatePersons(env, rawText),
      generatePlaces(env, rawText),
      fixWords(env, words, rawText),
    ]);

  // Generate VTT and Markdown based on fixed words
  const vtt = generateVTT(fixedWords);
  const markdown = generateMarkdown(fixedWords, enhancedText);

  return {
    enhancedText,
    keywords,
    chapters,
    paragraphs,
    summary,
    persons,
    places,
    vtt,
    fixedWords,
    markdown,
  };
}

async function enhanceFullText(env: Env, text: string): Promise<string> {
  const prompt = `Please improve the following podcast transcript by organizing it into proper paragraphs with natural breaks. Fix any obvious transcription errors and improve readability while maintaining the original meaning and tone. Handle any overlapping or repeated content appropriately. Don't add any content that wasn't in the original text.

Original transcript:
${text}

Enhanced transcript:`;

  try {
    const response = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that improves podcast transcript readability by organizing text into proper paragraphs, fixing transcription errors, and handling overlapping content from audio chunks. Always maintain the original meaning and don't add new content.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 2000,
      temperature: 0.3,
    })) as { response: string };

    return response.response || text;
  } catch (error) {
    console.warn(`Failed to enhance full text with AI: ${error}`);
    return text;
  }
}

async function enhanceTextWithOverlapHandling(
  env: Env,
  text: string,
  maxChunkLength: number
): Promise<string> {
  // Split text into overlapping chunks to maintain context
  const overlapLength = 200; // Characters to overlap between chunks
  const chunks = splitTextWithOverlap(text, maxChunkLength, overlapLength);

  console.log(
    `Processing ${chunks.length} overlapping chunks for AI enhancement`
  );

  const enhancedChunks: string[] = [];
  let previousChunkEnd = "";

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    try {
      // Include context about overlap handling in the prompt
      const isFirstChunk = i === 0;
      const isLastChunk = i === chunks.length - 1;

      const enhancedChunk = await enhanceTextChunkWithContext(
        env,
        chunk,
        isFirstChunk,
        isLastChunk,
        previousChunkEnd
      );

      // Remove overlap from non-first chunks to avoid duplication
      if (i > 0) {
        const deduplicatedChunk = removeOverlapFromChunk(
          enhancedChunk,
          previousChunkEnd
        );
        enhancedChunks.push(deduplicatedChunk);
      } else {
        enhancedChunks.push(enhancedChunk);
      }

      // Store the end of this chunk for next iteration
      const words = enhancedChunk.split(" ");
      previousChunkEnd = words.slice(-20).join(" "); // Last 20 words for overlap detection
    } catch (error) {
      console.warn(`Failed to enhance chunk ${i}, using original: ${error}`);
      // For failed chunks, still handle overlap if not first chunk
      if (i > 0) {
        const deduplicatedChunk = removeOverlapFromChunk(
          chunk,
          previousChunkEnd
        );
        enhancedChunks.push(deduplicatedChunk);
      } else {
        enhancedChunks.push(chunk);
      }
    }
  }

  return enhancedChunks.join("\n\n");
}

async function enhanceTextChunkWithContext(
  env: Env,
  chunk: string,
  isFirstChunk: boolean,
  isLastChunk: boolean,
  previousChunkEnd: string
): Promise<string> {
  let contextInfo = "";
  if (!isFirstChunk) {
    contextInfo += "This chunk continues from previous content. ";
  }
  if (!isLastChunk) {
    contextInfo += "This chunk continues in the next section. ";
  }
  if (previousChunkEnd) {
    contextInfo += `The previous section ended with: "${previousChunkEnd.slice(
      -100
    )}" `;
  }

  const prompt = `Please improve the following transcript chunk by organizing it into proper paragraphs with natural breaks. Fix any obvious transcription errors and improve readability while maintaining the original meaning and tone. ${contextInfo}Handle any overlapping or repeated content appropriately by removing duplicates. Don't add any content that wasn't in the original text.

Text chunk:
${chunk}

Enhanced text:`;

  try {
    const response = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that improves podcast transcript readability by organizing text into proper paragraphs, fixing transcription errors, and handling overlapping content. Always maintain the original meaning and don't add new content.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 1200,
      temperature: 0.3,
    })) as { response: string };

    return response.response || chunk;
  } catch (error) {
    console.warn(`Failed to enhance text chunk with AI: ${error}`);
    return chunk;
  }
}

async function generateKeywords(env: Env, text: string): Promise<string[]> {
  const prompt = `Extract 8-12 relevant keywords or key phrases from this podcast/audio transcript. Focus on main topics, important concepts, names, and themes discussed. Return only the keywords separated by commas.

Text:
${text.substring(0, 3000)}...

Keywords:`;

  try {
    const response = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that extracts relevant keywords from podcast transcripts. Return only keywords separated by commas, no explanations.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 200,
      temperature: 0.2,
    })) as { response: string };

    const keywords =
      response.response
        ?.split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0 && k.length < 50)
        .slice(0, 12) || [];

    return keywords.length > 0
      ? keywords
      : ["podcast", "discussion", "conversation"];
  } catch (error) {
    console.warn(`Failed to generate keywords: ${error}`);
    return ["podcast", "discussion", "conversation"];
  }
}

async function generateChapters(
  env: Env,
  text: string,
  words: Array<{ word: string; start: number; end: number }>
): Promise<Chapter[]> {
  // For shorter content, create fewer chapters
  const totalDuration =
    words.length > 0 ? Math.max(...words.map((w) => w.end)) : 0;
  const targetChapters = Math.min(
    Math.max(Math.floor(totalDuration / 300), 2),
    6
  ); // 1 chapter per 5 minutes, max 6

  const prompt = `Analyze this podcast transcript and divide it into ${targetChapters} logical chapters. Each chapter should represent a distinct topic or section of the discussion. 

For each chapter, provide:
1. A descriptive title (3-8 words)
2. A brief summary (1-2 sentences)

Format your response as JSON with this structure:
[
  {
    "title": "Chapter Title",
    "summary": "Brief description of what this chapter covers"
  }
]

Transcript:
${text.substring(0, 4000)}...`;

  try {
    const response = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that creates chapter divisions for podcast transcripts. Always respond with valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 500,
      temperature: 0.3,
    })) as { response: string };

    try {
      const chaptersData = JSON.parse(response.response);
      if (Array.isArray(chaptersData) && chaptersData.length > 0) {
        // Calculate time segments for each chapter
        const chapterDuration = totalDuration / chaptersData.length;

        return chaptersData.map((chapter, index) => ({
          title: chapter.title || `Chapter ${index + 1}`,
          startTime: Math.floor(index * chapterDuration),
          endTime: Math.floor((index + 1) * chapterDuration),
          summary: chapter.summary,
        }));
      }
    } catch (parseError) {
      console.warn(`Failed to parse chapter JSON: ${parseError}`);
    }
  } catch (error) {
    console.warn(`Failed to generate chapters: ${error}`);
  }

  // Fallback: create simple time-based chapters
  return createFallbackChapters(totalDuration, targetChapters);
}

async function generateSummary(
  env: Env,
  text: string
): Promise<string | undefined> {
  const prompt = `Create a concise description of this podcast episode in 2-3 sentences that can be published to Apple Podcasts. Focus on the main topics discussed and key takeaways. Do not include phrases like "Here is a summary" or "This podcast discusses" - write the description directly.

Transcript:
${text.substring(0, 3000)}...

Description:`;

  try {
    const response = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that creates publishable episode descriptions for podcasts. Write descriptions that can be published directly to Apple Podcasts without any meta-commentary or introductory phrases.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 200,
      temperature: 0.3,
    })) as { response: string };

    let summary = response.response?.trim();

    // Clean up any remaining descriptive prefixes
    if (summary) {
      summary = summary
        .replace(
          /^(Here is a|This is a|Here's a)\s+(concise\s+)?(summary|description)\s+(of\s+)?(this\s+)?(podcast|episode|transcript)[:\s]*/i,
          ""
        )
        .replace(
          /^(This\s+)?(podcast|episode|transcript)\s+(discusses|covers|explores)[:\s]*/i,
          ""
        )
        .replace(/^(In\s+this\s+)?(podcast|episode)[,\s]*/i, "")
        .trim();
    }

    return summary && summary.length > 20 ? summary : undefined;
  } catch (error) {
    console.warn(`Failed to generate summary: ${error}`);
    return undefined;
  }
}

function splitTextWithOverlap(
  text: string,
  maxLength: number,
  overlapLength: number
): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let currentPos = 0;

  while (currentPos < text.length) {
    let endPos = Math.min(currentPos + maxLength, text.length);

    // Try to break at a sentence boundary
    if (endPos < text.length) {
      const lastPeriod = text.lastIndexOf(".", endPos);
      const lastExclamation = text.lastIndexOf("!", endPos);
      const lastQuestion = text.lastIndexOf("?", endPos);
      const lastSentenceEnd = Math.max(
        lastPeriod,
        lastExclamation,
        lastQuestion
      );

      if (lastSentenceEnd > currentPos + maxLength * 0.5) {
        endPos = lastSentenceEnd + 1;
      }
    }

    chunks.push(text.substring(currentPos, endPos).trim());

    // Move position back by overlap amount for next chunk (except for last chunk)
    if (endPos < text.length) {
      currentPos = Math.max(currentPos + 1, endPos - overlapLength);
    } else {
      break;
    }
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function removeOverlapFromChunk(
  chunk: string,
  previousChunkEnd: string
): string {
  if (!previousChunkEnd || previousChunkEnd.length === 0) {
    return chunk;
  }

  // Find the longest common substring between the end of previous chunk and start of current chunk
  const chunkWords = chunk.split(" ");
  const previousWords = previousChunkEnd.split(" ");

  // Look for overlap by comparing word sequences
  let overlapFound = false;
  let overlapLength = 0;

  // Check for overlapping sequences (start with longer sequences and work down)
  for (
    let len = Math.min(previousWords.length, chunkWords.length, 15);
    len >= 3;
    len--
  ) {
    const previousEnd = previousWords.slice(-len).join(" ").toLowerCase();
    const chunkStart = chunkWords.slice(0, len).join(" ").toLowerCase();

    if (previousEnd === chunkStart) {
      overlapLength = len;
      overlapFound = true;
      break;
    }
  }

  if (overlapFound && overlapLength > 0) {
    // Remove the overlapping words from the beginning of the chunk
    const deduplicatedWords = chunkWords.slice(overlapLength);
    return deduplicatedWords.join(" ").trim();
  }

  return chunk;
}

// Keep the old function for backward compatibility if needed elsewhere
function splitTextIntoChunks(text: string, maxLength: number): string[] {
  return splitTextWithOverlap(text, maxLength, 0);
}

function createFallbackChapters(
  totalDuration: number,
  targetChapters: number
): Chapter[] {
  const chapterDuration = totalDuration / targetChapters;

  return Array.from({ length: targetChapters }, (_, index) => ({
    title: `Chapter ${index + 1}`,
    startTime: Math.floor(index * chapterDuration),
    endTime: Math.floor((index + 1) * chapterDuration),
  }));
}

async function generatePersons(env: Env, text: string): Promise<string[]> {
  const prompt = `Identify and extract the names of people mentioned in this podcast/audio transcript. Include speakers, guests, and any people referenced in the discussion. Return only the names separated by commas, no explanations.

Text:
${text.substring(0, 3000)}...

People mentioned:`;

  try {
    const response = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that extracts person names from podcast transcripts. Return only names separated by commas, no explanations or titles.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 200,
      temperature: 0.2,
    })) as { response: string };

    const persons =
      response.response
        ?.split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && p.length < 50)
        .slice(0, 10) || [];

    return persons;
  } catch (error) {
    console.warn(`Failed to generate persons: ${error}`);
    return [];
  }
}

async function generatePlaces(env: Env, text: string): Promise<string[]> {
  const prompt = `Identify and extract the names of places, locations, cities, countries, or venues mentioned in this podcast/audio transcript. Return only the place names separated by commas, no explanations.

Text:
${text.substring(0, 3000)}...

Places mentioned:`;

  try {
    const response = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that extracts place names from podcast transcripts. Return only place names separated by commas, no explanations.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 200,
      temperature: 0.2,
    })) as { response: string };

    const places =
      response.response
        ?.split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && p.length < 50)
        .slice(0, 10) || [];

    return places;
  } catch (error) {
    console.warn(`Failed to generate places: ${error}`);
    return [];
  }
}

async function fixWords(
  env: Env,
  words: Array<{ word: string; start: number; end: number }>,
  originalText: string
): Promise<Array<{ word: string; start: number; end: number }>> {
  // Create a fixed version of the words by correcting transcription errors
  const textSample = originalText.substring(0, 2000);

  const prompt = `Please fix obvious transcription errors in the following text while maintaining the exact word count and structure. Only fix clear mistakes like misspellings, wrong homophones, or garbled words. Don't add or remove words, just correct them.

Original text:
${textSample}

Corrected text:`;

  try {
    const response = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that fixes transcription errors. Only correct obvious mistakes without changing the word count or structure.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    })) as { response: string };

    const correctedText = response.response || originalText;
    const correctedWords = correctedText.split(/\s+/);

    // Map corrected words back to original timing data
    const fixedWords = words.map((originalWord, index) => ({
      word: correctedWords[index] || originalWord.word,
      start: originalWord.start,
      end: originalWord.end,
    }));

    return fixedWords;
  } catch (error) {
    console.warn(`Failed to fix words: ${error}`);
    return words; // Return original words if correction fails
  }
}

function generateVTT(
  words: Array<{ word: string; start: number; end: number }>
): string {
  let vtt = "WEBVTT\n\n";

  // Group words into subtitle chunks (aim for ~10-15 words per chunk)
  const chunkSize = 12;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;

    const startTime = formatVTTTime(chunk[0].start);
    const endTime = formatVTTTime(chunk[chunk.length - 1].end);
    const text = chunk.map((w) => w.word).join(" ");

    vtt += `${startTime} --> ${endTime}\n${text}\n\n`;
  }

  return vtt;
}

function formatVTTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms
    .toString()
    .padStart(3, "0")}`;
}

function generateMarkdown(
  words: Array<{ word: string; start: number; end: number }>,
  enhancedText: string
): string {
  // Split enhanced text into paragraphs
  const paragraphs = enhancedText
    .split("\n\n")
    .filter((p) => p.trim().length > 0);

  let markdown = "# Transcript\n\n";
  let wordIndex = 0;

  for (const paragraph of paragraphs) {
    const paragraphWords = paragraph.split(/\s+/).length;

    // Add timestamp at the beginning of each paragraph
    if (wordIndex < words.length) {
      const timestamp = formatMarkdownTime(words[wordIndex].start);
      markdown += `[${timestamp}] ${paragraph}\n\n`;
    } else {
      markdown += `${paragraph}\n\n`;
    }

    wordIndex += paragraphWords;
  }

  return markdown;
}

function formatMarkdownTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}
