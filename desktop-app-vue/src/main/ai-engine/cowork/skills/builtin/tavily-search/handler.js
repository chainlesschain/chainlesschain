/**
 * Tavily Search Skill Handler (v2.0)
 *
 * Real-time web search, content extraction, crawling, mapping, and research
 * via Tavily API. Enhanced with QNA, domain filtering, crawl, map, research.
 */

const { logger } = require("../../../../../utils/logger.js");

const TAVILY_BASE = "https://api.tavily.com";
const TAVILY_SEARCH_URL = `${TAVILY_BASE}/search`;
const TAVILY_EXTRACT_URL = `${TAVILY_BASE}/extract`;
const TAVILY_CRAWL_URL = `${TAVILY_BASE}/crawl`;
const TAVILY_MAP_URL = `${TAVILY_BASE}/map`;

const _deps = { fetchJSON: null, logger };

// ── Fetch Helper ──────────────────────────────────

function defaultFetchJSON(url, body) {
  return new Promise((resolve, reject) => {
    const https = require("https");
    const urlObj = new URL(url);

    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (_e) {
            reject(
              new Error(`Invalid JSON response: ${data.substring(0, 200)}`),
            );
          }
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function doFetch(url, body) {
  const fn = _deps.fetchJSON || defaultFetchJSON;
  return fn(url, body);
}

// ── Input Parser ──────────────────────────────────

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { mode: "search", query: "", options: {} };
  }

  const trimmed = input.trim();
  const options = {};

  // Detect mode prefix
  const modePatterns = [
    { prefix: "extract ", mode: "extract" },
    { prefix: "crawl ", mode: "crawl" },
    { prefix: "map ", mode: "map" },
    { prefix: "research ", mode: "research" },
    { prefix: "qna ", mode: "qna" },
  ];

  for (const mp of modePatterns) {
    if (trimmed.toLowerCase().startsWith(mp.prefix)) {
      const rest = trimmed.substring(mp.prefix.length).trim();
      parseFlags(rest, options);
      return {
        mode: mp.mode,
        query: stripFlags(rest),
        options,
      };
    }
  }

  // Default: search mode
  parseFlags(trimmed, options);
  const query = stripFlags(trimmed)
    .replace(/^search\s+/i, "")
    .trim();
  return { mode: "search", query, options };
}

function parseFlags(text, options) {
  const depthMatch = text.match(/--depth\s+(basic|advanced)/i);
  if (depthMatch) {
    options.search_depth = depthMatch[1].toLowerCase();
  }

  const maxMatch = text.match(/--max\s+(\d+)/);
  if (maxMatch) {
    options.max_results = parseInt(maxMatch[1], 10);
  }

  const includeMatch = text.match(/--include\s+(\S+)/);
  if (includeMatch) {
    options.include_domains = includeMatch[1].split(",");
  }

  const excludeMatch = text.match(/--exclude\s+(\S+)/);
  if (excludeMatch) {
    options.exclude_domains = excludeMatch[1].split(",");
  }

  const topicMatch = text.match(/--topic\s+(\S+)/);
  if (topicMatch) {
    options.topic = topicMatch[1].toLowerCase();
  }

  const limitMatch = text.match(/--limit\s+(\d+)/);
  if (limitMatch) {
    options.limit = parseInt(limitMatch[1], 10);
  }
}

function stripFlags(text) {
  return text
    .replace(/--depth\s+(basic|advanced)/gi, "")
    .replace(/--max\s+\d+/g, "")
    .replace(/--include\s+\S+/g, "")
    .replace(/--exclude\s+\S+/g, "")
    .replace(/--topic\s+\S+/g, "")
    .replace(/--limit\s+\d+/g, "")
    .trim();
}

// ── Handlers ──────────────────────────────────────

async function handleSearch(apiKey, query, options = {}) {
  const payload = {
    api_key: apiKey,
    query,
    search_depth: options.search_depth || "basic",
    max_results: options.max_results || 5,
    include_answer: true,
  };

  if (options.include_domains) {
    payload.include_domains = options.include_domains;
  }
  if (options.exclude_domains) {
    payload.exclude_domains = options.exclude_domains;
  }
  if (options.topic) {
    payload.topic = options.topic;
  }

  const response = await doFetch(TAVILY_SEARCH_URL, JSON.stringify(payload));

  const results = (response.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
  }));

  return {
    success: true,
    mode: "search",
    query,
    result: {
      answer: response.answer || null,
      results,
      resultCount: results.length,
    },
    answer: response.answer || null,
    results,
    resultCount: results.length,
  };
}

async function handleQNA(apiKey, query, options = {}) {
  const payload = {
    api_key: apiKey,
    query,
    search_depth: options.search_depth || "advanced",
    max_results: options.max_results || 5,
    include_answer: true,
  };

  if (options.include_domains) {
    payload.include_domains = options.include_domains;
  }
  if (options.exclude_domains) {
    payload.exclude_domains = options.exclude_domains;
  }

  const response = await doFetch(TAVILY_SEARCH_URL, JSON.stringify(payload));

  const sources = (response.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    relevance: r.score,
  }));

  return {
    success: true,
    mode: "qna",
    query,
    result: { answer: response.answer || "No direct answer found.", sources },
    answer: response.answer || "No direct answer found.",
    sources,
    message: `## Answer\n\n${response.answer || "No direct answer found."}\n\n### Sources\n${sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join("\n")}`,
  };
}

async function handleExtract(apiKey, url, options = {}) {
  const payload = {
    api_key: apiKey,
    urls: url.includes(",") ? url.split(",").map((u) => u.trim()) : [url],
  };

  const response = await doFetch(TAVILY_EXTRACT_URL, JSON.stringify(payload));

  const results = (response.results || []).map((r) => ({
    url: r.url,
    raw_content: r.raw_content,
  }));

  return {
    success: true,
    mode: "extract",
    query: url,
    result: { results, resultCount: results.length },
    results,
    resultCount: results.length,
  };
}

async function handleCrawl(apiKey, url, options = {}) {
  const payload = {
    api_key: apiKey,
    url,
    max_depth: options.limit || 2,
    limit: options.max_results || 10,
  };

  const response = await doFetch(TAVILY_CRAWL_URL, JSON.stringify(payload));

  const pages = (response.results || []).map((r) => ({
    url: r.url,
    title: r.title || "",
    content: r.raw_content || r.content || "",
    depth: r.depth || 0,
  }));

  return {
    success: true,
    mode: "crawl",
    query: url,
    result: { baseUrl: url, pages, pageCount: pages.length },
    pages,
    pageCount: pages.length,
    message: `Crawled ${pages.length} page(s) from ${url}`,
  };
}

async function handleMap(apiKey, url, options = {}) {
  const payload = {
    api_key: apiKey,
    url,
    limit: options.limit || 50,
  };

  const response = await doFetch(TAVILY_MAP_URL, JSON.stringify(payload));

  const urls = response.urls || response.results || [];

  return {
    success: true,
    mode: "map",
    query: url,
    result: { baseUrl: url, urls, urlCount: urls.length },
    urls,
    urlCount: urls.length,
    message: `Found ${urls.length} URL(s) on ${url}`,
  };
}

async function handleResearch(apiKey, query, options = {}) {
  // Phase 1: Broad search
  const broadPayload = {
    api_key: apiKey,
    query,
    search_depth: "advanced",
    max_results: options.max_results || 10,
    include_answer: true,
  };

  if (options.include_domains) {
    broadPayload.include_domains = options.include_domains;
  }

  const broadResults = await doFetch(
    TAVILY_SEARCH_URL,
    JSON.stringify(broadPayload),
  );

  // Phase 2: Extract top sources
  const topUrls = (broadResults.results || [])
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 3)
    .map((r) => r.url);

  let extractedContent = [];
  if (topUrls.length > 0) {
    try {
      const extractPayload = { api_key: apiKey, urls: topUrls };
      const extractResults = await doFetch(
        TAVILY_EXTRACT_URL,
        JSON.stringify(extractPayload),
      );
      extractedContent = (extractResults.results || []).map((r) => ({
        url: r.url,
        content: (r.raw_content || "").substring(0, 2000),
      }));
    } catch (_e) {
      // Extract may fail for some URLs — continue with search results
    }
  }

  // Phase 3: Compile research report
  const sources = (broadResults.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
  }));

  const citations = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`);

  return {
    success: true,
    mode: "research",
    query,
    result: {
      answer: broadResults.answer || null,
      sources,
      extractedContent,
      citations,
      sourceCount: sources.length,
    },
    message: `## Research: ${query}\n\n${broadResults.answer || "No summary available."}\n\n### Sources (${sources.length})\n${citations.join("\n")}\n\n### Deep Content Extracted\n${extractedContent.length} source(s) fully extracted for analysis.`,
  };
}

// ── Main Handler ──────────────────────────────────

module.exports = {
  _deps,

  async init(skill) {
    const hasKey = !!process.env.TAVILY_API_KEY;
    logger.info(
      `[TavilySearch] Initialized (v2.0), API key ${hasKey ? "configured" : "NOT configured"}`,
    );
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { mode, query, options } = parseInput(input);

    logger.info(`[TavilySearch] Mode: ${mode}, Query: "${query}"`);

    if (!query) {
      return {
        success: false,
        error:
          "No query provided.\n\nUsage:\n- `search <query>` — Web search\n- `qna <question>` — Direct Q&A\n- `extract <url>` — Extract page content\n- `crawl <url>` — Crawl site pages\n- `map <url>` — Map site URLs\n- `research <topic>` — Multi-phase research\n\nFlags: --depth basic|advanced, --max N, --include domain1,domain2, --exclude domain, --topic general|news|finance",
      };
    }

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error:
          "TAVILY_API_KEY not configured. Set it in environment variables.",
      };
    }

    try {
      switch (mode) {
        case "extract":
          return await handleExtract(apiKey, query, options);
        case "crawl":
          return await handleCrawl(apiKey, query, options);
        case "map":
          return await handleMap(apiKey, query, options);
        case "research":
          return await handleResearch(apiKey, query, options);
        case "qna":
          return await handleQNA(apiKey, query, options);
        case "search":
        default:
          return await handleSearch(apiKey, query, options);
      }
    } catch (error) {
      logger.error(`[TavilySearch] Error:`, error);
      return { success: false, error: error.message, mode, query };
    }
  },
};
