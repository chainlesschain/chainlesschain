/**
 * YouTube Summarizer Skill Handler
 */

const { logger } = require("../../../../../utils/logger.js");
const https = require("https");

module.exports = {
  async init(skill) { logger.info("[YouTubeSummarizer] Initialized"); },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    if (!parsed.videoId) {
      return { success: false, error: "Please provide a valid YouTube URL or video ID." };
    }

    try {
      switch (parsed.action) {
        case "summarize": return await handleSummarize(parsed.videoId, parsed.options);
        case "transcript": return await handleTranscript(parsed.videoId, parsed.options);
        case "chapters": return await handleChapters(parsed.videoId, parsed.options);
        default: return await handleSummarize(parsed.videoId, parsed.options);
      }
    } catch (error) {
      logger.error("[YouTubeSummarizer] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") return { action: "summarize", videoId: null, options: {} };
  const parts = input.trim().split(/\s+/);
  const first = (parts[0] || "").toLowerCase();
  const actions = ["summarize", "transcript", "chapters"];
  const action = actions.includes(first) ? first : "summarize";
  const rest = actions.includes(first) ? parts.slice(1) : parts;

  let videoId = null;
  for (const part of rest) {
    const id = extractVideoId(part);
    if (id) { videoId = id; break; }
  }

  const langMatch = input.match(/--lang\s+(\S+)/);

  return { action, videoId, options: { lang: langMatch ? langMatch[1] : "en" } };
}

function extractVideoId(str) {
  // youtube.com/watch?v=ID
  const match1 = str.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (match1) return match1[1];
  // youtu.be/ID
  const match2 = str.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (match2) return match2[1];
  // youtube.com/embed/ID
  const match3 = str.match(/embed\/([a-zA-Z0-9_-]{11})/);
  if (match3) return match3[1];
  // bare 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  return null;
}

async function handleTranscript(videoId, options) {
  const transcript = await fetchTranscript(videoId, options.lang);
  if (!transcript.length) {
    return { success: false, error: `No transcript found for video ${videoId}. Captions may be disabled.` };
  }

  return {
    success: true,
    action: "transcript",
    videoId,
    transcript,
    duration: transcript.length > 0 ? transcript[transcript.length - 1].start + transcript[transcript.length - 1].duration : 0,
    segmentCount: transcript.length,
    message: `Transcript extracted: ${transcript.length} segment(s).`,
  };
}

async function handleSummarize(videoId, options) {
  const transcript = await fetchTranscript(videoId, options.lang);
  if (!transcript.length) {
    return { success: false, error: `No transcript found for video ${videoId}.` };
  }

  const fullText = transcript.map((s) => s.text).join(" ");
  const wordCount = fullText.split(/\s+/).length;

  // Extract key segments by position (intro, middle sections, conclusion)
  const segments = segmentByTime(transcript);
  const keyPoints = extractKeyPoints(fullText);

  const summary = {
    videoId,
    url: `https://youtube.com/watch?v=${videoId}`,
    wordCount,
    estimatedMinutes: Math.ceil(wordCount / 150),
    segments,
    keyPoints,
    fullText: fullText.slice(0, 2000) + (fullText.length > 2000 ? "..." : ""),
  };

  return {
    success: true,
    action: "summarize",
    videoId,
    summary,
    message: `Summary generated: ~${wordCount} words, ${segments.length} section(s), ${keyPoints.length} key point(s).`,
  };
}

async function handleChapters(videoId, options) {
  const transcript = await fetchTranscript(videoId, options.lang);
  if (!transcript.length) {
    return { success: false, error: `No transcript found for video ${videoId}.` };
  }

  const chapters = segmentByTime(transcript);

  return {
    success: true,
    action: "chapters",
    videoId,
    chapters,
    message: `Detected ${chapters.length} chapter(s) based on topic shifts.`,
  };
}

function segmentByTime(transcript) {
  if (!transcript.length) return [];

  const totalDuration = transcript[transcript.length - 1].start + transcript[transcript.length - 1].duration;
  const segmentDuration = Math.max(60, totalDuration / 6); // ~6 segments
  const segments = [];
  let current = { start: 0, text: "", startFormatted: "0:00" };

  for (const entry of transcript) {
    if (entry.start - current.start >= segmentDuration && current.text) {
      segments.push({ ...current, text: current.text.trim() });
      current = { start: entry.start, text: "", startFormatted: formatTime(entry.start) };
    }
    current.text += " " + entry.text;
  }
  if (current.text.trim()) segments.push({ ...current, text: current.text.trim() });

  return segments;
}

function extractKeyPoints(text) {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  // Heuristic: pick sentences with signal words
  const signals = ["important", "key", "main", "first", "second", "third", "finally", "conclusion", "summary", "result", "because", "therefore", "however", "essentially", "fundamental"];
  const scored = sentences.map((s) => {
    const lower = s.toLowerCase();
    const score = signals.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);
    return { text: s.trim(), score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 10).map((s) => s.text);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function fetchTranscript(videoId, lang) {
  try {
    // Fetch the video page to get caption track info
    const html = await fetchText(`https://www.youtube.com/watch?v=${videoId}`);
    const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
    if (!captionMatch) return [];

    const tracks = JSON.parse(captionMatch[1]);
    const track = tracks.find((t) => t.languageCode === lang) || tracks[0];
    if (!track || !track.baseUrl) return [];

    const xml = await fetchText(track.baseUrl);
    return parseTranscriptXML(xml);
  } catch (error) {
    logger.warn("[YouTubeSummarizer] Transcript fetch failed:", error.message);
    return [];
  }
}

function parseTranscriptXML(xml) {
  const entries = [];
  const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>(.*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    entries.push({
      start: parseFloat(match[1]),
      duration: parseFloat(match[2]),
      text: match[3].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, ""),
    });
  }
  return entries;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const handler = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return https.get(res.headers.location, { headers: { "User-Agent": "Mozilla/5.0" } }, handler).on("error", reject);
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    };
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, handler).on("error", reject);
  });
}
