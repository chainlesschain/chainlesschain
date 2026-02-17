/**
 * HTTP Client Skill Handler
 *
 * Sends HTTP requests (GET/POST/PUT/DELETE/PATCH/HEAD) with custom headers,
 * authentication (Bearer, Basic, API Key), request body, timeout control,
 * and formatted response output. Uses Node.js built-in http/https modules.
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");
const { logger } = require("../../../../../utils/logger.js");

const DEFAULT_TIMEOUT = 30000;
const MAX_BODY_DISPLAY = 3000;
const SUPPORTED_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"];
const IMPORTANT_HEADERS = [
  "content-type",
  "content-length",
  "server",
  "date",
  "cache-control",
  "location",
  "set-cookie",
  "x-request-id",
];

// ── Core HTTP request ─────────────────────────────────────────────

function httpRequest(urlStr, method, headers, body, timeout) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch {
      return reject(new Error(`Invalid URL: ${urlStr}`));
    }

    const protocol = parsedUrl.protocol === "https:" ? https : http;
    const options = {
      method: method.toUpperCase(),
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { "User-Agent": "ChainlessChain-HTTPClient/1.0", ...headers },
      timeout: timeout || DEFAULT_TIMEOUT,
    };

    const startTime = Date.now();
    const req = protocol.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          body: data,
          duration: Date.now() - startTime,
        });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(
        new Error(`Request timeout after ${timeout || DEFAULT_TIMEOUT}ms`),
      );
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// ── Input parsing ─────────────────────────────────────────────────

function parseInput(input) {
  const opts = {
    method: null,
    url: null,
    headers: {},
    body: null,
    auth: null,
    timeout: DEFAULT_TIMEOUT,
  };
  if (!input) {
    return opts;
  }

  // Extract method + URL from --get/--post/--put/--delete/--patch/--head
  const methodFlags = {
    "--get": "GET",
    "--post": "POST",
    "--put": "PUT",
    "--delete": "DELETE",
    "--patch": "PATCH",
    "--head": "HEAD",
  };
  for (const [flag, method] of Object.entries(methodFlags)) {
    const re = new RegExp(flag.replace(/-/g, "\\-") + "\\s+(\\S+)", "i");
    const m = input.match(re);
    if (m) {
      opts.method = method;
      opts.url = m[1];
      break;
    }
  }

  // Alternative: --method <METHOD> <URL>
  if (!opts.method) {
    const m = input.match(
      /--method\s+(GET|POST|PUT|DELETE|PATCH|HEAD)\s+(\S+)/i,
    );
    if (m) {
      opts.method = m[1].toUpperCase();
      opts.url = m[2];
    }
  }

  // Fallback: bare URL defaults to GET
  if (!opts.method && !opts.url) {
    const m = input.match(/(https?:\/\/\S+)/);
    if (m) {
      opts.method = "GET";
      opts.url = m[1];
    }
  }

  // Extract --header pairs (single or double quoted, repeatable)
  for (const q of ["'", '"']) {
    const re = new RegExp(`--header\\s+${q}([^${q}]+)${q}`, "g");
    let m;
    while ((m = re.exec(input)) !== null) {
      const ci = m[1].indexOf(":");
      if (ci > 0) {
        opts.headers[m[1].substring(0, ci).trim()] = m[1]
          .substring(ci + 1)
          .trim();
      }
    }
  }

  // Extract --body (single or double quoted)
  const bodyMatch =
    input.match(/--body\s+'([^']*)'/) || input.match(/--body\s+"([^"]*)"/);
  if (bodyMatch) {
    opts.body = bodyMatch[1];
  }

  // Auto-set Content-Type for JSON body
  if (
    opts.body &&
    !opts.headers["Content-Type"] &&
    !opts.headers["content-type"]
  ) {
    try {
      JSON.parse(opts.body);
      opts.headers["Content-Type"] = "application/json";
    } catch {
      /* not JSON */
    }
  }

  // Extract --auth and --timeout
  const authMatch = input.match(/--auth\s+(\S+)/);
  if (authMatch) {
    opts.auth = authMatch[1];
  }

  const timeoutMatch = input.match(/--timeout\s+(\d+)/);
  if (timeoutMatch) {
    opts.timeout = Math.min(parseInt(timeoutMatch[1], 10), 120000);
  }

  return opts;
}

// ── Auth handling ─────────────────────────────────────────────────

function applyAuth(headers, authStr) {
  if (!authStr) {
    return;
  }

  if (authStr.startsWith("bearer:")) {
    headers["Authorization"] = `Bearer ${authStr.substring(7)}`;
  } else if (authStr.startsWith("basic:")) {
    const creds = authStr.substring(6);
    const ci = creds.indexOf(":");
    const pair =
      ci > 0 ? `${creds.substring(0, ci)}:${creds.substring(ci + 1)}` : creds;
    headers["Authorization"] = "Basic " + Buffer.from(pair).toString("base64");
  } else if (authStr.startsWith("apikey:")) {
    headers["X-API-Key"] = authStr.substring(7);
  }
}

// ── Response formatting ───────────────────────────────────────────

function truncateBody(body, max) {
  if (!body) {
    return "";
  }
  return body.length <= max
    ? body
    : body.substring(0, max) + `\n... (truncated, ${body.length} chars total)`;
}

function filterHeaders(headers) {
  const out = {};
  for (const k of Object.keys(headers)) {
    if (IMPORTANT_HEADERS.includes(k.toLowerCase())) {
      out[k] = headers[k];
    }
  }
  return out;
}

function prettyPrintBody(body, contentType) {
  if (!body) {
    return "(empty body)";
  }
  if (contentType && contentType.includes("application/json")) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* fall through */
    }
  }
  return body;
}

function statusTag(s) {
  if (s >= 200 && s < 300) {
    return "[OK]";
  }
  if (s >= 300 && s < 400) {
    return "[REDIRECT]";
  }
  if (s >= 400 && s < 500) {
    return "[CLIENT ERROR]";
  }
  if (s >= 500) {
    return "[SERVER ERROR]";
  }
  return "[INFO]";
}

function fmtDuration(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

// ── Handler export ────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info("[HTTPClient] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    logger.info(`[HTTPClient] Input: ${input.substring(0, 120)}`);

    if (!input) {
      return {
        success: true,
        result: { message: "No input provided." },
        message: [
          "## HTTP Client",
          "",
          "Usage:",
          "  `/http-client --get <url>`                   Send GET request",
          "  `/http-client --post <url> --body '<json>'`  Send POST request",
          "  `/http-client --put <url> --body '<json>'`   Send PUT request",
          "  `/http-client --delete <url>`                Send DELETE request",
          "  `/http-client --patch <url> --body '<json>'` Send PATCH request",
          "  `/http-client --head <url>`                  Send HEAD request",
          "",
          "Options:",
          "  `--header 'Key: Value'`      Add custom header (repeatable)",
          "  `--body '<json>'`            Request body (JSON auto-detected)",
          "  `--auth bearer:<token>`      Bearer token authentication",
          "  `--auth basic:<user>:<pass>` Basic authentication",
          "  `--auth apikey:<key>`        API Key (X-API-Key header)",
          "  `--timeout <ms>`             Timeout in ms (default: 30000, max: 120000)",
        ].join("\n"),
      };
    }

    const options = parseInput(input);

    if (!options.url) {
      return {
        success: false,
        error: "No URL provided",
        message:
          "Please provide a URL. Example: `/http-client --get https://example.com`",
      };
    }
    if (!options.method) {
      options.method = "GET";
    }
    if (!SUPPORTED_METHODS.includes(options.method)) {
      return {
        success: false,
        error: `Unsupported method: ${options.method}`,
        message: `Supported methods: ${SUPPORTED_METHODS.join(", ")}`,
      };
    }

    applyAuth(options.headers, options.auth);
    if (options.body) {
      options.headers["Content-Length"] = Buffer.byteLength(options.body);
    }

    logger.info(
      `[HTTPClient] ${options.method} ${options.url} (timeout: ${options.timeout}ms)`,
    );

    try {
      const res = await httpRequest(
        options.url,
        options.method,
        options.headers,
        options.body,
        options.timeout,
      );

      const contentType = res.headers["content-type"] || "";
      const bodySize = res.body ? Buffer.byteLength(res.body) : 0;
      const pretty = prettyPrintBody(res.body, contentType);
      const displayBody = truncateBody(pretty, MAX_BODY_DISPLAY);
      const hdrs = filterHeaders(res.headers);
      const tag = statusTag(res.status);

      const lines = [
        "## HTTP Response",
        `**${options.method}** ${options.url}`,
        `**Status:** ${res.status} ${res.statusText} ${tag} | **Duration:** ${fmtDuration(res.duration)} | **Size:** ${bodySize} bytes`,
        "",
      ];

      const hdrEntries = Object.entries(hdrs);
      if (hdrEntries.length > 0) {
        lines.push("**Headers:**");
        for (const [k, v] of hdrEntries) {
          lines.push(`  ${k}: ${v}`);
        }
        lines.push("");
      }

      if (options.method === "HEAD") {
        lines.push("_(HEAD request - no body)_");
      } else if (displayBody && displayBody !== "(empty body)") {
        lines.push("**Body:**", "```", displayBody, "```");
      } else {
        lines.push("_(empty body)_");
      }

      return {
        success: res.status >= 200 && res.status < 400,
        result: {
          status: res.status,
          statusText: res.statusText,
          headers: hdrs,
          body: truncateBody(res.body, MAX_BODY_DISPLAY),
          duration: res.duration,
          contentType,
          bodySize,
          method: options.method,
          url: options.url,
        },
        message: lines.join("\n"),
      };
    } catch (error) {
      logger.error(`[HTTPClient] Request failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        result: {
          method: options.method,
          url: options.url,
          error: error.message,
        },
        message: `## HTTP Request Failed\n**${options.method}** ${options.url}\n**Error:** ${error.message}`,
      };
    }
  },
};
