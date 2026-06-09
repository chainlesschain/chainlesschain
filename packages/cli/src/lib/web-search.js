/**
 * Web Search — agent-safe web search with pluggable backends.
 *
 * Mirror of web-fetch.js: a small, dependency-free HTTP client that fans a
 * query out to a search provider and returns normalized results
 * ({ title, url, snippet }) plus an optional synthesized `answer`.
 *
 * The provider is pluggable via .chainlesschain/config.json:webSearch (or env
 * keys). Default `provider: "auto"` picks whichever API key is configured —
 * tavily > brave > bocha — and falls back to keyless DuckDuckGo when none is.
 * This keeps the search source a config knob, not a one-way code decision.
 */

import http from "http";
import https from "https";
import { URL } from "url";

const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESULTS = 8;

const KEYED_PROVIDERS = ["tavily", "brave", "bocha"];
const KEYLESS_PROVIDERS = ["duckduckgo", "searxng"];
export const SUPPORTED_PROVIDERS = [...KEYED_PROVIDERS, ...KEYLESS_PROVIDERS];

/** Resolve the API key for a keyed provider from options → config → env. */
export function resolveApiKey(provider, options = {}, config = {}) {
  const env = process.env;
  switch (provider) {
    case "tavily":
      return (
        options.apiKey || config.tavilyApiKey || config.apiKey || env.TAVILY_API_KEY || ""
      );
    case "brave":
      return (
        options.apiKey ||
        config.braveApiKey ||
        config.apiKey ||
        env.BRAVE_API_KEY ||
        env.BRAVE_SEARCH_API_KEY ||
        ""
      );
    case "bocha":
      return (
        options.apiKey || config.bochaApiKey || config.apiKey || env.BOCHA_API_KEY || ""
      );
    default:
      return "";
  }
}

/**
 * Decide which provider to use. An explicit (non-auto) provider is honored
 * as-is; "auto"/empty picks the first keyed provider with a usable key, else
 * the keyless DuckDuckGo fallback.
 */
export function resolveProvider(options = {}, config = {}) {
  const requested = String(
    options.provider || config.provider || "auto",
  ).toLowerCase();
  if (requested && requested !== "auto") return requested;
  for (const p of KEYED_PROVIDERS) {
    if (resolveApiKey(p, options, config)) return p;
  }
  return "duckduckgo";
}

function _request(urlStr, { method = "GET", headers = {}, body = null, timeout, maxBytes }) {
  const parsed = new URL(urlStr);
  const lib = parsed.protocol === "https:" ? _deps.https : _deps.http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method,
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: {
          "User-Agent": "ChainlessChain-Agent/1.0",
          Accept: "*/*",
          ...headers,
        },
        timeout,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new Error(`response exceeds maxBytes (${maxBytes})`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    if (body != null) req.write(body);
    req.end();
  });
}

function _stripTags(html) {
  return String(html).replace(/<[^>]+>/g, "");
}

function _decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function _clean(s) {
  return _decodeEntities(_stripTags(s)).replace(/\s+/g, " ").trim();
}

// ---- Provider adapters: each returns { results: [{title,url,snippet}], answer } ----

async function _searchTavily(query, { apiKey, maxResults, timeout, maxBytes }) {
  if (!apiKey) return { error: "tavily: missing API key" };
  const res = await _request("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      include_answer: true,
      search_depth: "basic",
    }),
    timeout,
    maxBytes,
  });
  if (res.statusCode >= 400) {
    return { error: `tavily HTTP ${res.statusCode}: ${res.body.slice(0, 200)}` };
  }
  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    return { error: "tavily: invalid JSON response" };
  }
  const results = (json.results || []).slice(0, maxResults).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: _clean(r.content || ""),
  }));
  return { results, answer: json.answer || "" };
}

async function _searchBrave(query, { apiKey, maxResults, timeout, maxBytes }) {
  if (!apiKey) return { error: "brave: missing API key" };
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const res = await _request(url, {
    method: "GET",
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    timeout,
    maxBytes,
  });
  if (res.statusCode >= 400) {
    return { error: `brave HTTP ${res.statusCode}: ${res.body.slice(0, 200)}` };
  }
  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    return { error: "brave: invalid JSON response" };
  }
  const results = ((json.web && json.web.results) || [])
    .slice(0, maxResults)
    .map((r) => ({
      title: _clean(r.title || ""),
      url: r.url || "",
      snippet: _clean(r.description || ""),
    }));
  return { results, answer: "" };
}

async function _searchBocha(query, { apiKey, maxResults, timeout, maxBytes }) {
  if (!apiKey) return { error: "bocha: missing API key" };
  const res = await _request("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, count: maxResults, summary: true }),
    timeout,
    maxBytes,
  });
  if (res.statusCode >= 400) {
    return { error: `bocha HTTP ${res.statusCode}: ${res.body.slice(0, 200)}` };
  }
  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    return { error: "bocha: invalid JSON response" };
  }
  // Bing-style schema: data.webPages.value[]
  const pages =
    (json.data && json.data.webPages && json.data.webPages.value) || [];
  const results = pages.slice(0, maxResults).map((r) => ({
    title: _clean(r.name || ""),
    url: r.url || "",
    snippet: _clean(r.summary || r.snippet || ""),
  }));
  return { results, answer: "" };
}

async function _searchDuckDuckGo(query, { maxResults, timeout, maxBytes }) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await _request(url, {
    method: "GET",
    headers: { Accept: "text/html" },
    timeout,
    maxBytes,
  });
  if (res.statusCode >= 400) {
    return { error: `duckduckgo HTTP ${res.statusCode}` };
  }
  const html = res.body;
  const results = [];
  const anchorRe =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe =
    /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [];
  let sm;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(_clean(sm[1]));
  let m;
  let i = 0;
  while ((m = anchorRe.exec(html)) !== null && results.length < maxResults) {
    let href = m[1];
    // DDG wraps targets as //duckduckgo.com/l/?uddg=<encoded-url>
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]);
      } catch {
        /* keep raw href */
      }
    } else if (href.startsWith("//")) {
      href = "https:" + href;
    }
    results.push({
      title: _clean(m[2]),
      url: href,
      snippet: snippets[i] || "",
    });
    i++;
  }
  return { results, answer: "" };
}

async function _searchSearxng(query, { instanceUrl, maxResults, timeout, maxBytes }) {
  if (!instanceUrl) return { error: "searxng: missing instanceUrl" };
  const base = instanceUrl.replace(/\/+$/, "");
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
  const res = await _request(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    timeout,
    maxBytes,
  });
  if (res.statusCode >= 400) {
    return { error: `searxng HTTP ${res.statusCode}` };
  }
  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    return { error: "searxng: invalid JSON response (is json format enabled?)" };
  }
  const results = (json.results || []).slice(0, maxResults).map((r) => ({
    title: _clean(r.title || ""),
    url: r.url || "",
    snippet: _clean(r.content || ""),
  }));
  return { results, answer: json.answer || "" };
}

/**
 * Run a web search. Returns { query, provider, count, results, answer } or
 * { error }. Never throws for provider/HTTP failures — surfaces them as errors
 * so the agent can adapt.
 */
export async function webSearch(query, options = {}) {
  const q = String(query || "").trim();
  if (!q) return { error: "web_search: empty query" };

  const config = options.config || {};
  const provider = resolveProvider(options, config);
  const maxResults =
    Number(options.maxResults) ||
    Number(config.maxResults) ||
    DEFAULT_MAX_RESULTS;
  const timeout = Number(options.timeout) || DEFAULT_TIMEOUT_MS;
  const maxBytes = Number(options.maxBytes) || DEFAULT_MAX_BYTES;

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return {
      error: `web_search: unsupported provider "${provider}" (supported: ${SUPPORTED_PROVIDERS.join(", ")})`,
    };
  }

  const apiKey = resolveApiKey(provider, options, config);
  const common = { apiKey, maxResults, timeout, maxBytes };

  let out;
  try {
    switch (provider) {
      case "tavily":
        out = await _searchTavily(q, common);
        break;
      case "brave":
        out = await _searchBrave(q, common);
        break;
      case "bocha":
        out = await _searchBocha(q, common);
        break;
      case "searxng":
        out = await _searchSearxng(q, {
          instanceUrl: options.instanceUrl || config.instanceUrl,
          maxResults,
          timeout,
          maxBytes,
        });
        break;
      case "duckduckgo":
      default:
        out = await _searchDuckDuckGo(q, { maxResults, timeout, maxBytes });
        break;
    }
  } catch (err) {
    return { error: `web_search (${provider}) failed: ${err.message}`, provider };
  }

  if (out && out.error) return { ...out, provider };
  const results = (out && out.results) || [];
  return {
    query: q,
    provider,
    count: results.length,
    results,
    answer: (out && out.answer) || "",
  };
}

export const _deps = { http, https };
