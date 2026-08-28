/**
 * API Gateway Skill Handler
 */
const { logger } = require("../../../../../utils/logger.js");
const path = require("path");
const {
  requireBundledSkillRuntimeNetworkBroker,
} = require("../../bundled-skill-egress-broker.js");
const {
  requireBundledSkillEnvironmentBroker,
} = require("../../bundled-skill-environment-broker.js");
const {
  bundledSkillFs: fs,
  withBundledSkillFilesystem,
} = require("../../bundled-skill-filesystem-broker.js");

const _deps = { path };

const registryCache = new Map();

function resolveRegistryLocation(context) {
  const environment = requireBundledSkillEnvironmentBroker(
    context,
    "api-gateway",
  );
  const configDir = environment.get("config-directory");
  if (!configDir) {
    throw new Error(
      "API Gateway config directory is unavailable from trusted host configuration",
    );
  }
  return {
    configDir,
    registryFile: _deps.path.join(configDir, "api-gateway-registry.json"),
  };
}

function loadRegistry(location) {
  let registry = {};
  try {
    if (fs.existsSync(location.registryFile)) {
      registry = JSON.parse(fs.readFileSync(location.registryFile, "utf-8"));
    }
  } catch (_err) {
    logger.warn("[APIGateway] Could not load registry, starting fresh");
  }
  registryCache.set(location.registryFile, registry);
  return registry;
}

function ensureRegistry(context) {
  const location = resolveRegistryLocation(context);
  const registry = registryCache.has(location.registryFile)
    ? registryCache.get(location.registryFile)
    : loadRegistry(location);
  return { location, registry };
}

function saveRegistry(state) {
  const { location, registry } = state;
  try {
    if (!fs.existsSync(location.configDir)) {
      fs.mkdirSync(location.configDir, { recursive: true });
    }
    fs.writeFileSync(
      location.registryFile,
      JSON.stringify(registry, null, 2),
      "utf-8",
    );
  } catch (err) {
    logger.error("[APIGateway] Failed to save registry:", err.message);
  }
}

function _resetState() {
  registryCache.clear();
}

module.exports = {
  _deps,
  _resetState,
  async init(skill) {
    logger.info("[APIGateway] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "call": {
          const { registry } = ensureRegistry(context);
          return await handleCall(
            parsed.method,
            parsed.url,
            parsed.options,
            context,
            registry,
          );
        }
        case "register":
          return handleRegister(
            parsed.name,
            parsed.method,
            parsed.url,
            parsed.options,
            context,
          );
        case "list":
          return handleList(parsed.options, context);
        case "chain": {
          const { registry } = ensureRegistry(context);
          return await handleChain(parsed.chainSteps, context, registry);
        }
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

async function handleCall(method, url, options, context, registry) {
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

  if (!url.startsWith("https://")) {
    return {
      success: false,
      error: `Invalid URL: ${url}. Must start with https://`,
    };
  }

  const startTime = Date.now();
  const response = await makeRequest(
    method,
    url,
    options.headers,
    options.body,
    context,
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

function handleRegister(name, method, url, options, context) {
  if (!name || name === "GET" || name === "POST") {
    return {
      success: false,
      error: "Provide a name. Usage: register <name> <METHOD> <URL>",
    };
  }
  if (!url || !url.startsWith("https://")) {
    return {
      success: false,
      error: "Provide a valid URL starting with https://",
    };
  }

  const state = ensureRegistry(context);
  const { registry } = state;
  registry[name] = {
    method: method || "GET",
    url,
    headers: options.headers || {},
    description: options.description || "",
    registered: new Date().toISOString(),
  };
  saveRegistry(state);

  return {
    success: true,
    action: "register",
    result: { name, ...registry[name] },
    message: `Registered API "${name}" -> ${method} ${url}`,
  };
}

function handleList(options, context) {
  const { registry } = ensureRegistry(context);
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

async function handleChain(chainSteps, context, registry) {
  if (!chainSteps.length) {
    return {
      success: false,
      error:
        "Provide chain steps. Usage: chain step1:param=val -> step2:param={field}",
    };
  }

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

    const response = await makeRequest(
      reg.method,
      url,
      reg.headers,
      null,
      context,
    );
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

async function makeRequest(method, url, headers = {}, body = null, context) {
  const networkBroker = requireBundledSkillRuntimeNetworkBroker(
    context,
    "api-gateway",
  );
  const response = await networkBroker.request({
    url,
    method,
    headers: {
      "User-Agent": "ChainlessChain-APIGateway/1.2.0",
      Accept: "application/json",
      ...headers,
    },
    body,
    timeout: 30_000,
    maxResponseBytes: 1024 * 1024,
  });
  return {
    statusCode: response.status,
    headers: response.headers,
    body: response.body,
  };
}

module.exports = withBundledSkillFilesystem("api-gateway", module.exports);
