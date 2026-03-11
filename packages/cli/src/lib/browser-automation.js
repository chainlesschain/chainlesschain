/**
 * Headless browser automation — fetch, scrape, and extract content from web pages.
 * Uses built-in fetch for basic operations, optional playwright for screenshots.
 */

/**
 * Fetch a URL and return the raw HTML.
 */
export async function fetchPage(url, options = {}) {
  const timeout = options.timeout || 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = {
      "User-Agent": "ChainlessChain-CLI/0.37.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(options.headers || {}),
    };

    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const html = await response.text();

    return {
      url: response.url,
      status: response.status,
      contentType,
      html,
      size: html.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract text content from HTML, stripping tags.
 */
export function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/**
 * Extract page title from HTML.
 */
export function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim().replace(/\s+/g, " ") : "";
}

/**
 * Extract meta description from HTML.
 */
export function extractMeta(html) {
  const descMatch =
    html.match(
      /<meta\s+name=["']description["']\s+content=["']([^"']*?)["']/i,
    ) ||
    html.match(/<meta\s+content=["']([^"']*?)["']\s+name=["']description["']/i);
  return descMatch ? descMatch[1] : "";
}

/**
 * Extract elements matching a simple CSS selector.
 * Supports: tag, .class, #id, tag.class, tag#id
 */
export function querySelectorAll(html, selector) {
  const results = [];

  // Parse selector
  const tagMatch = selector.match(/^(\w+)/);
  const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/);
  const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);

  const tag = tagMatch ? tagMatch[1] : null;
  const className = classMatch ? classMatch[1] : null;
  const id = idMatch ? idMatch[1] : null;

  // Build regex pattern
  let pattern;
  if (tag) {
    pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  } else if (className || id) {
    pattern = new RegExp(`<\\w+[^>]*>([\\s\\S]*?)<\\/\\w+>`, "gi");
  } else {
    return results;
  }

  let match;
  while ((match = pattern.exec(html)) !== null) {
    const fullTag = match[0];

    // Check class filter
    if (className) {
      const classAttr = fullTag.match(/class=["']([^"']*?)["']/i);
      if (!classAttr || !classAttr[1].split(/\s+/).includes(className))
        continue;
    }

    // Check id filter
    if (id) {
      const idAttr = fullTag.match(/id=["']([^"']*?)["']/i);
      if (!idAttr || idAttr[1] !== id) continue;
    }

    results.push({
      html: fullTag,
      text: extractText(fullTag),
    });
  }

  return results;
}

/**
 * Extract all links from HTML.
 */
export function extractLinks(html, baseUrl) {
  const links = [];
  const linkRegex = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1];
    const text = extractText(match[2]).trim();

    // Resolve relative URLs
    if (baseUrl && !href.startsWith("http")) {
      try {
        href = new URL(href, baseUrl).href;
      } catch {
        continue;
      }
    }

    if (text && href.startsWith("http")) {
      links.push({ href, text });
    }
  }

  return links;
}

/**
 * Take a screenshot using playwright (optional dependency).
 * Returns null if playwright is not installed.
 */
export async function takeScreenshot(url, outputPath, options = {}) {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: {
        width: options.width || 1280,
        height: options.height || 720,
      },
    });

    await page.goto(url, {
      waitUntil: options.waitUntil || "networkidle",
      timeout: options.timeout || 30000,
    });

    await page.screenshot({
      path: outputPath,
      fullPage: options.fullPage || false,
    });

    await browser.close();
    return { success: true, path: outputPath };
  } catch (err) {
    if (
      err.code === "ERR_MODULE_NOT_FOUND" ||
      err.message?.includes("Cannot find")
    ) {
      return {
        success: false,
        error: "playwright not installed. Run: npm install -g playwright",
      };
    }
    throw err;
  }
}
