/**
 * Web Fetch — agent-safe HTTP(S) GET with allowlist + size/timeout limits.
 *
 * Inspired by open-agents web_fetch tool. Guards against SSRF by rejecting
 * private/loopback hosts unless explicitly allowlisted.
 */

import http from "http";
import https from "https";
import { URL } from "url";

const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;

// RFC 1918 + loopback + link-local. Blocked by default unless config.allowPrivateHosts.
const PRIVATE_HOST_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^localhost$/i,
];

export function isPrivateHost(host) {
  if (!host) return true;
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
}

export function checkAllowed(urlStr, config = {}) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { allowed: false, reason: "invalid URL" };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return {
      allowed: false,
      reason: `unsupported protocol: ${parsed.protocol}`,
    };
  }
  if (isPrivateHost(parsed.hostname) && !config.allowPrivateHosts) {
    return {
      allowed: false,
      reason: `private/loopback host blocked: ${parsed.hostname}`,
    };
  }
  const allowed = Array.isArray(config.allowedDomains)
    ? config.allowedDomains
    : ["*"];
  if (!allowed.includes("*")) {
    const match = allowed.some((pattern) => {
      if (pattern.startsWith("*.")) {
        return parsed.hostname.endsWith(pattern.slice(1));
      }
      return parsed.hostname === pattern;
    });
    if (!match) {
      return {
        allowed: false,
        reason: `host not in allowedDomains: ${parsed.hostname}`,
      };
    }
  }
  return { allowed: true, url: parsed };
}

export function htmlToMarkdown(html) {
  if (!html) return "";
  let text = String(html);
  // Strip scripts/styles entirely
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  // Convert headings
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, inner) => {
    return `\n\n${"#".repeat(Number(n))} ${inner.trim()}\n\n`;
  });
  // Paragraphs / breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  // Links: [text](href)
  text = text.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, inner) => `[${stripTags(inner).trim()}](${href})`,
  );
  // List items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => {
    return `- ${stripTags(inner).trim()}\n`;
  });
  // Strip remaining tags
  text = stripTags(text);
  // Decode minimal HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse whitespace
  text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ");
  return text.trim();
}

function stripTags(html) {
  return String(html).replace(/<[^>]+>/g, "");
}

async function _doRequest(parsed, { maxBytes, timeout, headers }) {
  const lib = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method: "GET",
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
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          return resolve({ redirect: res.headers.location });
        }
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
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.end();
  });
}

export async function webFetch(url, options = {}) {
  const {
    format = "markdown",
    maxBytes = DEFAULT_MAX_BYTES,
    timeout = DEFAULT_TIMEOUT_MS,
    config = {},
    headers = {},
    maxRedirects = 3,
  } = options;

  const check = checkAllowed(url, config);
  if (!check.allowed) {
    return { error: `web_fetch blocked: ${check.reason}` };
  }

  let parsed = check.url;
  let redirects = 0;
  let response;
  while (true) {
    response = await _doRequest(parsed, { maxBytes, timeout, headers });
    if (!response.redirect) break;
    if (++redirects > maxRedirects) {
      return { error: "too many redirects" };
    }
    const next = new URL(response.redirect, parsed);
    const nextCheck = checkAllowed(next.toString(), config);
    if (!nextCheck.allowed) {
      return { error: `redirect blocked: ${nextCheck.reason}` };
    }
    parsed = nextCheck.url;
  }

  const { statusCode, headers: respHeaders, body } = response;
  const contentType = String(respHeaders["content-type"] || "");

  let output = body;
  let outputFormat = format;
  if (format === "markdown") {
    output = /html/i.test(contentType) ? htmlToMarkdown(body) : body;
  } else if (format === "text") {
    output = /html/i.test(contentType) ? stripTags(body) : body;
  } else if (format === "json") {
    try {
      output = JSON.parse(body);
    } catch {
      return { error: "response is not valid JSON", statusCode, body };
    }
  }

  return {
    url: parsed.toString(),
    statusCode,
    contentType,
    format: outputFormat,
    bytes: Buffer.byteLength(body, "utf8"),
    content: output,
  };
}

export const _deps = { http, https };
