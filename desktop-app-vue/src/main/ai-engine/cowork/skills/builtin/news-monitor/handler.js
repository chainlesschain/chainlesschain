/**
 * News Monitor Skill Handler
 */

const { logger } = require("../../../../../utils/logger.js");
const https = require("https");

const BUILTIN_SOURCES = {
  hackernews: { name: "Hacker News", url: "https://hacker-news.firebaseio.com/v0", type: "api" },
  reddit: { name: "Reddit", baseUrl: "https://www.reddit.com/r/{sub}/hot.json?limit=25", type: "api" },
  github: { name: "GitHub Trending", url: "https://api.github.com/search/repositories?q=created:>{date}&sort=stars&per_page=20", type: "api" },
};

const state = { watches: [], sources: [], articles: [] };

module.exports = {
  async init(skill) { logger.info("[NewsMonitor] Initialized"); },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "watch": return handleWatch(parsed.keywords, parsed.options);
        case "digest": return handleDigest(parsed.options);
        case "trends": return handleTrends(parsed.options);
        case "source": return handleSource(parsed.subAction, parsed.target);
        case "fetch": return await handleFetch(parsed.keywords);
        default: return { success: false, error: `Unknown action: ${parsed.action}` };
      }
    } catch (error) {
      logger.error("[NewsMonitor] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") return { action: "digest", keywords: [], options: {} };
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "digest").toLowerCase();
  const sourcesMatch = input.match(/--sources\s+(\S+)/);
  const periodMatch = input.match(/--period\s+(\S+)/);
  const topicMatch = input.match(/--topic\s+(\S+)/);
  const categoryMatch = input.match(/--category\s+(\S+)/);

  const keywords = parts.slice(1).filter((p) => !p.startsWith("--"));
  const subAction = parts[1] || "";
  const target = parts[2] || "";

  return {
    action,
    keywords,
    subAction,
    target,
    options: {
      sources: sourcesMatch ? sourcesMatch[1].split(",") : ["hackernews"],
      period: periodMatch ? periodMatch[1] : "daily",
      topic: topicMatch ? topicMatch[1] : null,
      category: categoryMatch ? categoryMatch[1] : "tech",
    },
  };
}

function handleWatch(keywords, options) {
  if (!keywords.length) {
    return { success: true, action: "watch", watches: state.watches, message: `Active watches: ${state.watches.length}` };
  }

  const watch = {
    id: `watch_${Date.now()}`,
    keywords,
    sources: options.sources,
    created: new Date().toISOString(),
  };
  state.watches.push(watch);

  return {
    success: true,
    action: "watch",
    watch,
    message: `Watching for "${keywords.join(", ")}" on ${options.sources.join(", ")}.`,
  };
}

function handleDigest(options) {
  const period = options.period || "daily";
  const topic = options.topic;

  let filtered = [...state.articles];
  if (topic) {
    const lower = topic.toLowerCase();
    filtered = filtered.filter((a) => (a.title || "").toLowerCase().includes(lower) || (a.tags || []).some((t) => t.toLowerCase().includes(lower)));
  }

  // Sort by score/relevance
  filtered.sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = filtered.slice(0, 20);

  const digest = {
    period,
    topic: topic || "all",
    generated: new Date().toISOString(),
    articleCount: top.length,
    articles: top.map((a) => ({ title: a.title, url: a.url, source: a.source, score: a.score })),
  };

  return {
    success: true,
    action: "digest",
    digest,
    message: `${period} digest: ${top.length} article(s)${topic ? ` on "${topic}"` : ""}.`,
  };
}

function handleTrends(options) {
  const category = options.category || "tech";

  // Extract keyword frequency from cached articles
  const wordFreq = {};
  for (const article of state.articles) {
    const words = (article.title || "").toLowerCase().split(/\s+/);
    for (const w of words) {
      if (w.length > 3 && !STOP_WORDS.has(w)) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    }
  }

  const trends = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ keyword: word, mentions: count }));

  return {
    success: true,
    action: "trends",
    category,
    trends,
    articlePool: state.articles.length,
    message: `Top ${trends.length} trending keywords from ${state.articles.length} articles.`,
  };
}

function handleSource(subAction, target) {
  switch (subAction) {
    case "add":
      if (!target) return { success: false, error: "Provide a URL to add." };
      state.sources.push({ url: target, added: new Date().toISOString() });
      return { success: true, action: "source", subAction: "add", url: target, message: `Added source: ${target}` };

    case "remove":
      state.sources = state.sources.filter((s) => s.url !== target);
      return { success: true, action: "source", subAction: "remove", url: target, message: `Removed source: ${target}` };

    case "list":
    default: {
      const all = [...Object.entries(BUILTIN_SOURCES).map(([k, v]) => ({ name: v.name, key: k, builtin: true })), ...state.sources.map((s) => ({ url: s.url, builtin: false }))];
      return { success: true, action: "source", subAction: "list", sources: all, message: `${all.length} source(s) available.` };
    }
  }
}

async function handleFetch(keywords) {
  // Fetch top HN stories as demo
  const stories = await fetchJSON("https://hacker-news.firebaseio.com/v0/topstories.json");
  if (!Array.isArray(stories)) return { success: true, action: "fetch", articles: [], message: "Could not fetch stories." };

  const top = stories.slice(0, 30);
  const articles = [];

  for (const id of top.slice(0, 10)) {
    try {
      const story = await fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (story && story.title) {
        const article = { id: story.id, title: story.title, url: story.url || "", source: "hackernews", score: story.score || 0, tags: [] };
        if (!keywords.length || keywords.some((k) => story.title.toLowerCase().includes(k.toLowerCase()))) {
          articles.push(article);
        }
      }
    } catch { /* skip */ }
  }

  state.articles.push(...articles);

  return {
    success: true,
    action: "fetch",
    articles,
    message: `Fetched ${articles.length} article(s) from Hacker News.`,
  };
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "ChainlessChain/1.0" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on("error", reject);
  });
}

const STOP_WORDS = new Set(["the", "and", "for", "that", "this", "with", "from", "your", "have", "are", "was", "were", "been", "will", "would", "could", "should", "about", "into", "more", "than", "just", "also", "what", "when", "where", "which", "their", "there", "them", "they", "these", "those", "some", "most", "only", "over", "such", "after", "before", "between", "each", "every", "other", "being", "does", "doing", "done", "here", "very", "show"]);
