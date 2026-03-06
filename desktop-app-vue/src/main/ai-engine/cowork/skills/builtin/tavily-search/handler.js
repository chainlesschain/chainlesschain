/**
 * Tavily Search Skill Handler
 *
 * Real-time web search and content extraction via Tavily API.
 */

const { logger } = require("../../../../../utils/logger.js");

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

module.exports = {
  async init(skill) {
    const hasKey = !!process.env.TAVILY_API_KEY;
    logger.info(
      `[TavilySearch] Initialized, API key ${hasKey ? "configured" : "NOT configured"}`,
    );
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { mode, query, options } = parseInput(input);

    logger.info(`[TavilySearch] Mode: ${mode}, Query: "${query}"`);

    if (!query) {
      return {
        success: false,
        error: "No query provided. Usage: /tavily-search <query>",
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

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { mode: "search", query: "", options: {} };
  }

  const trimmed = input.trim();
  const options = {};

  // Check for extract mode
  if (trimmed.toLowerCase().startsWith("extract ")) {
    return {
      mode: "extract",
      query: trimmed.substring(8).trim(),
      options,
    };
  }

  // Check for --depth flag
  const depthMatch = trimmed.match(/--depth\s+(basic|advanced)/i);
  if (depthMatch) {
    options.search_depth = depthMatch[1].toLowerCase();
  }

  // Check for --max flag
  const maxMatch = trimmed.match(/--max\s+(\d+)/);
  if (maxMatch) {
    options.max_results = parseInt(maxMatch[1], 10);
  }

  // Remove flags from query
  const query = trimmed
    .replace(/--depth\s+(basic|advanced)/gi, "")
    .replace(/--max\s+\d+/g, "")
    .replace(/^search\s+/i, "")
    .trim();

  return { mode: "search", query, options };
}

async function handleSearch(apiKey, query, options = {}) {
  const body = JSON.stringify({
    api_key: apiKey,
    query,
    search_depth: options.search_depth || "basic",
    max_results: options.max_results || 5,
    include_answer: true,
  });

  const response = await fetchJSON(TAVILY_SEARCH_URL, body);

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
    answer: response.answer || null,
    results,
    resultCount: results.length,
  };
}

async function handleExtract(apiKey, url, options = {}) {
  const body = JSON.stringify({
    api_key: apiKey,
    urls: [url],
  });

  const response = await fetchJSON(TAVILY_EXTRACT_URL, body);

  const results = (response.results || []).map((r) => ({
    url: r.url,
    raw_content: r.raw_content,
  }));

  return {
    success: true,
    mode: "extract",
    query: url,
    results,
    resultCount: results.length,
  };
}

function fetchJSON(url, body) {
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
          } catch {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
          }
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
