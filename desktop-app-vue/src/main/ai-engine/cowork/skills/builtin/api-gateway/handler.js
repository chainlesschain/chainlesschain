/**
 * API Gateway Skill Handler
 */
const { logger } = require("../../../../../utils/logger.js");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const _deps = { https, http, fs, path };

const CONFIG_DIR = path.join(
  process.env.APPDATA || process.env.HOME || ".",
  ".chainlesschain",
);
const REGISTRY_FILE = path.join(CONFIG_DIR, "api-gateway-registry.json");

let registry = {};

function loadRegistry() {
  try {
    if (_deps.fs.existsSync(REGISTRY_FILE)) {
      registry = JSON.parse(_deps.fs.readFileSync(REGISTRY_FILE, "utf-8"));
    }
  } catch (_err) {
    logger.warn("[APIGateway] Could not load registry, starting fresh");
    registry = {};
  }
}

function saveRegistry() {
  try {
    if (!_deps.fs.existsSync(CONFIG_DIR)) {
      _deps.fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    _deps.fs.writeFileSync(
      REGISTRY_FILE,
      JSON.stringify(registry, null, 2),
      "utf-8",
    );
  } catch (err) {
    logger.error("[APIGateway] Failed to save registry:", err.message);
  }
}

function _resetState() {
  registry = {};
}

module.exports = {
  _deps,
  _resetState,
  async init(skill) {
    loadRegistry();
    logger.info("[APIGateway] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "call":
          return await handleCall(parsed.method, parsed.url, parsed.options);
        case "register":
          return handleRegister(
            parsed.name,
            parsed.method,
            parsed.url,
            parsed.options,
          );
        case "list":
          return handleList(parsed.options);
        case "chain":
          return await handleChain(parsed.chainSteps);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Available: call, register, list, chain`,
          };
      }
    } catch (error) {
      logger.error("[APIGateway] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return {
      action: "list",
      method: "GET",
      url: "",
      name: "",
      options: {},
      chainSteps: [],
    };
  }
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "list").toLowerCase();

  const headersMatch = input.match(/--headers\s+(\S+=\S+)/g);
  const bodyMatch =
    input.match(/--body\s+'([^']+)'/) ||
    input.match(/--body\s+"([^"]+)"/) ||
    input.match(/--body\s+(\S+)/);
  const descMatch =
    input.match(/--description\s+["']([^"']+)["']/) ||
    input.match(/--description\s+(\S+)/);
  const filterMatch = input.match(/--filter\s+(\S+)/);

  const headers = {};
  if (headersMatch) {
    for (const h of headersMatch) {
      const kv = h.replace("--headers ", "").split("=");
      headers[kv[0]] = kv.slice(1).join("=");
    }
  }

  let body = null;
  if (bodyMatch) {
    try {
      body = JSON.parse(bodyMatch[1]);
    } catch {
      body = bodyMatch[1];
    }
  }

  // Parse chain steps: step1:param=val -> step2:param=val
  const chainSteps = [];
  if (action === "chain") {
    const chainStr = parts.slice(1).join(" ");
    const steps = chainStr.split(/\s*->\s*/);
    for (const step of steps) {
      const [nameAndParams] = step.split(/\s+/);
      const [stepName, ...paramParts] = (nameAndParams || "").split(":");
      const params = {};
      for (const pp of paramParts) {
        const [k, v] = pp.split("=");
        if (k) {
          params[k] = v || "";
        }
      }
      if (stepName) {
        chainSteps.push({ name: stepName, params });
      }
    }
  }

  return {
    action,
    method: (parts[1] || "GET").toUpperCase(),
    url: parts[2] || "",
    name: parts[1] || "",
    options: {
      headers,
      body,
      description: descMatch ? descMatch[1] : null,
      filter: filterMatch ? filterMatch[1] : null,
    },
    chainSteps,
  };
}

async function handleCall(method, url, options) {
  if (!url) {
    return {
      success: false,
      error: "Provide a URL. Usage: call <METHOD> <URL>",
    };
  }

  // Check if url is a registered API name
  if (!url.startsWith("http") && registry[url]) {
    const reg = registry[url];
    method = reg.method || method;
    url = reg.url;
    options.headers = { ...reg.headers, ...options.headers };
  }

  if (!url.startsWith("http")) {
    return {
      success: false,
      error: `Invalid URL: ${url}. Must start with http:// or https://`,
    };
  }

  const startTime = Date.now();
  const response = await makeRequest(
    method,
    url,
    options.headers,
    options.body,
  );
  const duration = Date.now() - startTime;

  let responseBody = response.body;
  try {
    responseBody = JSON.parse(response.body);
  } catch {
    /* keep as string */
  }

  const truncated =
    typeof responseBody === "string" && responseBody.length > 5000;
  if (truncated) {
    responseBody = responseBody.substring(0, 5000) + "... [truncated]";
  }

  return {
    success: response.statusCode >= 200 && response.statusCode < 400,
    action: "call",
    result: {
      method,
      url,
      statusCode: response.statusCode,
      headers: response.headers,
      body: responseBody,
      duration: `${duration}ms`,
      truncated,
    },
    message: `${method} ${url} -> ${response.statusCode} (${duration}ms)`,
  };
}

function handleRegister(name, method, url, options) {
  if (!name || name === "GET" || name === "POST") {
    return {
      success: false,
      error: "Provide a name. Usage: register <name> <METHOD> <URL>",
    };
  }
  if (!url || !url.startsWith("http")) {
    return {
      success: false,
      error: "Provide a valid URL starting with http:// or https://",
    };
  }

  loadRegistry();
  registry[name] = {
    method: method || "GET",
    url,
    headers: options.headers || {},
    description: options.description || "",
    registered: new Date().toISOString(),
  };
  saveRegistry();

  return {
    success: true,
    action: "register",
    result: { name, ...registry[name] },
    message: `Registered API "${name}" -> ${method} ${url}`,
  };
}

function handleList(options) {
  loadRegistry();
  let entries = Object.entries(registry).map(([name, config]) => ({
    name,
    method: config.method,
    url: config.url,
    description: config.description || "",
    registered: config.registered,
  }));

  if (options.filter) {
    const filter = options.filter.toLowerCase();
    entries = entries.filter(
      (e) =>
        e.name.toLowerCase().includes(filter) ||
        (e.description || "").toLowerCase().includes(filter),
    );
  }

  return {
    success: true,
    action: "list",
    result: { apis: entries, total: entries.length },
    message: `${entries.length} registered API(s).`,
  };
}

async function handleChain(chainSteps) {
  if (!chainSteps.length) {
    return {
      success: false,
      error:
        "Provide chain steps. Usage: chain step1:param=val -> step2:param={field}",
    };
  }

  loadRegistry();
  const results = [];
  let previousData = {};

  for (let i = 0; i < chainSteps.length; i++) {
    const step = chainSteps[i];
    const reg = registry[step.name];
    if (!reg) {
      return {
        success: false,
        error: `Step "${step.name}" is not a registered API. Register it first with: register <name> <METHOD> <URL>`,
      };
    }

    // Substitute params with previous results
    let url = reg.url;
    for (const [k, v] of Object.entries(step.params)) {
      const resolvedValue =
        v.startsWith("{") && v.endsWith("}")
          ? getNestedValue(previousData, v.slice(1, -1)) || v
          : v;
      url = url.replace(`{${k}}`, encodeURIComponent(resolvedValue));
    }

    const response = await makeRequest(reg.method, url, reg.headers, null);
    let body = response.body;
    try {
      body = JSON.parse(body);
    } catch {
      /* keep as string */
    }

    results.push({
      step: i + 1,
      name: step.name,
      method: reg.method,
      url,
      statusCode: response.statusCode,
      data: typeof body === "object" ? body : { raw: body },
    });

    previousData = typeof body === "object" ? body : { raw: body };
  }

  return {
    success: true,
    action: "chain",
    result: { steps: results, totalSteps: results.length },
    message: `Chain completed: ${results.length} step(s) executed.`,
  };
}

function getNestedValue(obj, path) {
  return path
    .split(".")
    .reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
}

function makeRequest(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? _deps.https : _deps.http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        "User-Agent": "ChainlessChain-APIGateway/1.2.0",
        Accept: "application/json",
        ...headers,
      },
    };

    if (body) {
      const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
      options.headers["Content-Type"] =
        options.headers["Content-Type"] || "application/json";
      options.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }

    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        }),
      );
    });

    req.on("error", (err) =>
      reject(new Error(`Request failed: ${err.message}`)),
    );
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timed out after 30s"));
    });

    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}
