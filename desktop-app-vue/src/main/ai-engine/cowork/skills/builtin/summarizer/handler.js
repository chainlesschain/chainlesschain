/**
 * Summarizer Skill Handler
 *
 * Summarizes URLs, text content, and local files. Extracts key points,
 * calculates word counts, and estimates reading time.
 */

const { logger } = require("../../../../../utils/logger.js");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const _deps = { https, http, fs, path };

const SENTENCES_FOR_SUMMARY = 5;
const YOUTUBE_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/;

module.exports = {
  _deps,
  async init(skill) {
    logger.info("[Summarizer] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "summarize-url": return await handleSummarizeUrl(parsed.target);
        case "summarize-text": return handleSummarizeText(parsed.target);
        case "summarize-file": return handleSummarizeFile(parsed.target);
        default: return { success: false, error: `Unknown action: ${parsed.action}. Use: summarize-url, summarize-text, summarize-file` };
      }
    } catch (error) {
      logger.error("[Summarizer] Error:", error);
      return { success: false, action: parsed.action, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") return { action: "summarize-text", target: "" };
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const firstWord = parts[0].toLowerCase();

  if (["summarize-url", "summarize-text", "summarize-file"].includes(firstWord)) {
    return { action: firstWord, target: parts.slice(1).join(" ") };
  }

  // Auto-detect action from content
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return { action: "summarize-url", target: trimmed };
  }

  if (_deps.fs.existsSync(trimmed) || trimmed.match(/^[./\\]/)) {
    return { action: "summarize-file", target: trimmed };
  }

  return { action: "summarize-text", target: trimmed };
}

async function handleSummarizeUrl(url) {
  if (!url) return { success: false, action: "summarize-url", error: "URL required. Usage: summarize-url <url>" };

  // Check if it's a YouTube URL
  const ytMatch = url.match(YOUTUBE_REGEX);
  if (ytMatch) {
    return await handleYouTube(ytMatch[1], url);
  }

  const content = await fetchUrl(url);
  if (!content) {
    return { success: false, action: "summarize-url", error: `Failed to fetch content from: ${url}` };
  }

  // Strip HTML tags and extract text
  const text = stripHtml(content);
  if (!text || text.length < 20) {
    return { success: false, action: "summarize-url", error: "Could not extract meaningful text from the URL." };
  }

  const result = buildSummary(text, url);

  return {
    success: true,
    action: "summarize-url",
    source: url,
    ...result,
    message: `Summarized content from ${url} (${result.word_count} words, ~${result.reading_time_min} min read).`,
  };
}

function handleSummarizeText(text) {
  if (!text || text.length < 10) {
    return { success: false, action: "summarize-text", error: "Please provide text content to summarize (at least 10 characters)." };
  }

  const result = buildSummary(text);

  return {
    success: true,
    action: "summarize-text",
    ...result,
    message: `Summarized ${result.word_count} words into ${result.key_points.length} key points.`,
  };
}

function handleSummarizeFile(filePath) {
  if (!filePath) return { success: false, action: "summarize-file", error: "File path required. Usage: summarize-file <path>" };

  const resolved = _deps.path.resolve(filePath);
  if (!_deps.fs.existsSync(resolved)) {
    return { success: false, action: "summarize-file", error: `File not found: ${resolved}` };
  }

  const stat = _deps.fs.statSync(resolved);
  if (stat.size > 10 * 1024 * 1024) {
    return { success: false, action: "summarize-file", error: "File too large (>10MB). Please provide a smaller file." };
  }

  let content = _deps.fs.readFileSync(resolved, "utf-8");
  const ext = _deps.path.extname(resolved).toLowerCase();

  // Strip HTML/Markdown formatting if needed
  if (ext === ".html" || ext === ".htm") {
    content = stripHtml(content);
  } else if (ext === ".md") {
    content = stripMarkdown(content);
  }

  const result = buildSummary(content, resolved);

  return {
    success: true,
    action: "summarize-file",
    source: resolved,
    fileName: _deps.path.basename(resolved),
    fileSize: stat.size,
    ...result,
    message: `Summarized "${_deps.path.basename(resolved)}" (${result.word_count} words) into ${result.key_points.length} key points.`,
  };
}

async function handleYouTube(videoId, originalUrl) {
  // Try to fetch video info page for title and description
  const infoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetchUrl(infoUrl);

  let title = "Unknown Video";
  let description = "";

  if (html) {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) title = titleMatch[1].replace(" - YouTube", "").trim();

    const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (descMatch) {
      description = descMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }

  const textForSummary = description || title;
  const result = buildSummary(textForSummary, originalUrl);

  return {
    success: true,
    action: "summarize-url",
    source: originalUrl,
    videoId,
    title,
    ...result,
    message: `Summarized YouTube video "${title}" (${result.word_count} words from description).`,
  };
}

function buildSummary(text, source = null) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  const words = cleanText.split(/\s+/);
  const wordCount = words.length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  // Extract sentences
  const sentences = extractSentences(cleanText);

  // Score sentences by importance
  const scored = scoreSentences(sentences, words);

  // Top N sentences for summary
  const topSentences = scored.slice(0, SENTENCES_FOR_SUMMARY).sort((a, b) => a.index - b.index);
  const summary = topSentences.map((s) => s.text).join(" ");

  // Extract key points (top sentences reworded as bullet points)
  const keyPoints = scored.slice(0, Math.min(7, scored.length)).map((s) => {
    let point = s.text.trim();
    // Ensure it doesn't start with lowercase
    if (point.length > 0) {
      point = point.charAt(0).toUpperCase() + point.slice(1);
    }
    // Remove trailing period for consistency, then re-add
    point = point.replace(/\.$/, "");
    return point;
  });

  // Extract most frequent meaningful words as topics
  const topics = extractTopics(words);

  const result = {
    summary,
    key_points: keyPoints,
    topics,
    word_count: wordCount,
    sentence_count: sentences.length,
    reading_time_min: readingTime,
    result: { summary, key_points: keyPoints, topics },
  };

  if (source) result.source = source;
  return result;
}

function extractSentences(text) {
  // Split on sentence boundaries
  const raw = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return raw.filter((s) => s.trim().length > 15 && s.split(/\s+/).length >= 3);
}

function scoreSentences(sentences, allWords) {
  // Build word frequency map (excluding stop words)
  const freq = {};
  for (const w of allWords) {
    const lower = w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (lower.length > 3 && !STOP_WORDS.has(lower)) {
      freq[lower] = (freq[lower] || 0) + 1;
    }
  }

  // Score each sentence
  const scored = sentences.map((text, index) => {
    const sentenceWords = text.toLowerCase().split(/\s+/);
    let score = 0;

    for (const w of sentenceWords) {
      const clean = w.replace(/[^a-z0-9]/g, "");
      if (freq[clean]) score += freq[clean];
    }

    // Position bonus: first and last sentences get higher scores
    if (index === 0) score *= 1.5;
    if (index === sentences.length - 1) score *= 1.2;

    // Length normalization
    score = score / Math.max(sentenceWords.length, 1);

    return { text, index, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}

function extractTopics(words) {
  const freq = {};
  for (const w of words) {
    const lower = w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (lower.length > 3 && !STOP_WORDS.has(lower)) {
      freq[lower] = (freq[lower] || 0) + 1;
    }
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, frequency: count }));
}

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdown(md) {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fetchUrl(url) {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? _deps.https : _deps.http;

    const request = client.get(url, { headers: { "User-Agent": "ChainlessChain/1.2.0", Accept: "text/html,application/xhtml+xml,text/plain,*/*" }, timeout: 15000 }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(() => resolve(null));
        return;
      }

      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }

      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });

    request.on("error", () => resolve(null));
    request.on("timeout", () => { request.destroy(); resolve(null); });
  });
}

const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "your", "have", "are",
  "was", "were", "been", "will", "would", "could", "should", "about", "into",
  "more", "than", "just", "also", "what", "when", "where", "which", "their",
  "there", "them", "they", "these", "those", "some", "most", "only", "over",
  "such", "after", "before", "between", "each", "every", "other", "being",
  "does", "doing", "done", "here", "very", "show", "like", "make", "made",
  "many", "much", "well", "back", "even", "still", "while", "then", "know",
  "take", "come", "came", "said", "says", "tell", "told", "think", "thought",
]);
