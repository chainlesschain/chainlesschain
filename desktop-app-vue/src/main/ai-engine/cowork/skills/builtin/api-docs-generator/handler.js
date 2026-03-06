/**
 * API Docs Generator Skill Handler
 */

const { logger } = require("../../../../../utils/logger.js");
const fs = require("fs");
const path = require("path");

module.exports = {
  async init(skill) { logger.info("[ApiDocs] Initialized"); },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "scan": return handleScan(parsed.target, context);
        case "openapi": return handleOpenAPI(parsed.target, parsed.options, context);
        case "endpoint": return handleEndpoint(parsed.description);
        case "validate": return handleValidate(parsed.target, context);
        default: return { success: false, error: `Unknown action: ${parsed.action}` };
      }
    } catch (error) {
      logger.error("[ApiDocs] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") return { action: "scan", target: "." };
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "scan").toLowerCase();
  const target = parts[1] || ".";
  const titleMatch = input.match(/--title\s+"([^"]+)"/);
  return { action, target, description: parts.slice(1).join(" "), options: { title: titleMatch ? titleMatch[1] : "API" } };
}

function handleScan(dir, context) {
  const cwd = context.cwd || process.cwd();
  const scanPath = path.resolve(cwd, dir);
  const endpoints = [];

  if (fs.existsSync(scanPath)) {
    const files = scanFiles(scanPath, [".js", ".ts", ".py", ".java"]);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      const found = extractEndpoints(content, file);
      endpoints.push(...found);
    }
  }

  return {
    success: true,
    action: "scan",
    path: scanPath,
    endpoints,
    endpointCount: endpoints.length,
    message: `Found ${endpoints.length} endpoint(s) in ${dir}.`,
  };
}

function handleOpenAPI(dir, options, context) {
  const scan = handleScan(dir, context);
  const spec = {
    openapi: "3.0.3",
    info: { title: options.title || "API", version: "1.0.0" },
    paths: {},
  };

  for (const ep of scan.endpoints) {
    const pathKey = ep.path || "/unknown";
    if (!spec.paths[pathKey]) spec.paths[pathKey] = {};
    spec.paths[pathKey][ep.method.toLowerCase()] = {
      summary: ep.description || ep.handler || "",
      responses: { "200": { description: "Success" } },
    };
  }

  return {
    success: true,
    action: "openapi",
    spec,
    endpointCount: scan.endpointCount,
    message: `OpenAPI spec generated with ${scan.endpointCount} endpoint(s).`,
  };
}

function handleEndpoint(description) {
  const parts = (description || "").trim().split(/\s+/);
  const method = (parts[0] || "GET").toUpperCase();
  const epPath = parts[1] || "/example";
  const desc = parts.slice(2).join(" ") || "Endpoint description";

  const doc = {
    method,
    path: epPath,
    description: desc,
    request: { headers: { "Content-Type": "application/json" }, body: method !== "GET" ? { example: {} } : null },
    response: { status: 200, body: { success: true, data: {} } },
  };

  return { success: true, action: "endpoint", endpoint: doc };
}

function handleValidate(target, context) {
  const cwd = context.cwd || process.cwd();
  const filePath = path.resolve(cwd, target);
  if (!fs.existsSync(filePath)) return { success: false, error: `File not found: ${target}` };

  const content = fs.readFileSync(filePath, "utf8");
  const issues = [];
  if (!content.includes("openapi")) issues.push("Missing 'openapi' version field");
  if (!content.includes("info")) issues.push("Missing 'info' section");
  if (!content.includes("paths")) issues.push("Missing 'paths' section");

  return { success: true, action: "validate", valid: issues.length === 0, issues };
}

function scanFiles(dir, extensions) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        results.push(...scanFiles(full, extensions));
      } else if (entry.isFile() && extensions.some((e) => entry.name.endsWith(e))) {
        results.push(full);
      }
    }
  } catch { /* skip unreadable dirs */ }
  return results.slice(0, 100);
}

function extractEndpoints(content, file) {
  const endpoints = [];

  // Express: app.get/post/put/delete/patch
  const expressRegex = /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  let match;
  while ((match = expressRegex.exec(content)) !== null) {
    endpoints.push({ method: match[1].toUpperCase(), path: match[2], file, framework: "express" });
  }

  // FastAPI: @app.get/post
  const fastapiRegex = /@(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/gi;
  while ((match = fastapiRegex.exec(content)) !== null) {
    endpoints.push({ method: match[1].toUpperCase(), path: match[2], file, framework: "fastapi" });
  }

  // Spring Boot: @GetMapping/@PostMapping
  const springRegex = /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/gi;
  while ((match = springRegex.exec(content)) !== null) {
    endpoints.push({ method: match[1].toUpperCase(), path: match[2], file, framework: "spring" });
  }

  return endpoints;
}
