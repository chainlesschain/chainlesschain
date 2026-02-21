/**
 * IPCApiDocGenerator - API Documentation Auto-Generation
 *
 * Scans IPC handler files to extract channel definitions, parameters,
 * and response schemas, then generates OpenAPI 3.0 specs and Markdown docs.
 *
 * Core capabilities:
 * 1. IPC Handler Scanner (recursive *-ipc.js file discovery)
 * 2. Parameter Extraction (JSDoc, destructuring patterns)
 * 3. Response Schema Inference ({ success, data, error } pattern)
 * 4. OpenAPI 3.0 Spec Generation
 * 5. Markdown Documentation Generation
 * 6. Incremental Update (SHA256 change detection)
 *
 * @module ai-engine/cowork/ipc-api-doc-generator
 */

const { logger } = require("../../utils/logger.js");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const EventEmitter = require("events");

/**
 * Default generator configuration
 */
const DEFAULT_CONFIG = {
  ipcFilePattern: "*-ipc.js",
  outputDir: "docs/api",
  openApiVersion: "3.0.3",
  apiTitle: "ChainlessChain IPC API",
  apiVersion: "1.0.0",
  apiDescription:
    "Auto-generated API documentation for ChainlessChain IPC handlers",
  basePathPrefix: "/ipc",
};

/**
 * Regex patterns for handler extraction
 */
const PATTERNS = {
  // ipcMain.handle("channel:name", async (event, arg1, arg2) => { ... })
  ipcHandle:
    /ipcMain\.handle\s*\(\s*['"]([^'"]+)['"]\s*,\s*async\s*\(\s*_?event\s*(?:,\s*([^)]*))?\)/g,

  // JSDoc @param tags
  jsdocParam:
    /@param\s+\{([^}]+)\}\s+(?:\[?(\w+?)(?:\s*=\s*([^\]]*))?\]?)\s*-?\s*(.*)/g,

  // JSDoc @returns tag
  jsdocReturns: /@returns?\s+\{([^}]+)\}\s*(.*)/,

  // JSDoc block comment
  jsdocBlock: /\/\*\*\s*([\s\S]*?)\s*\*\//g,

  // Destructuring in handler: async (_event, { prop1, prop2 })
  destructuring: /async\s*\(\s*_?event\s*,\s*\{([^}]+)\}\s*\)/,
};

class IPCApiDocGenerator extends EventEmitter {
  /**
   * @param {string} [srcDir] - Source directory to scan
   * @param {string} [outputDir] - Output directory for generated docs
   * @param {Object} [config] - Configuration overrides
   */
  constructor(srcDir = null, outputDir = null, config = {}) {
    super();

    this.srcDir = srcDir || path.join(process.cwd(), "src", "main");
    this.outputDir =
      outputDir ||
      path.join(process.cwd(), this.config?.outputDir || "docs/api");
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (outputDir) {
      this.outputDir = outputDir;
    }

    // Scanned handler registry: namespace -> HandlerInfo[]
    this._handlers = new Map();

    // File hashes for incremental updates
    this._fileHashes = new Map();

    // Generated spec cache
    this._cachedSpec = null;

    this.initialized = false;

    logger.info("[IPCApiDocGenerator] Created", {
      srcDir: this.srcDir,
      outputDir: this.outputDir,
    });
  }

  /**
   * Initialize by scanning the source tree
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    await this.scanAllHandlers();
    this.initialized = true;

    logger.info("[IPCApiDocGenerator] Initialized", {
      namespaces: this._handlers.size,
      totalHandlers: this._getTotalHandlerCount(),
    });
    this.emit("initialized");
  }

  /**
   * Scan all IPC handler files and extract handler info
   * @returns {Map<string, Object[]>} Namespace -> HandlerInfo[]
   */
  async scanAllHandlers() {
    this._handlers.clear();
    this._fileHashes.clear();

    const ipcFiles = this._findIPCFiles(this.srcDir);

    for (const filePath of ipcFiles) {
      try {
        const handlers = this._extractHandlerInfo(filePath);
        for (const handler of handlers) {
          const namespace = handler.channel.split(":")[0] || "unknown";
          if (!this._handlers.has(namespace)) {
            this._handlers.set(namespace, []);
          }
          this._handlers.get(namespace).push(handler);
        }

        // Store file hash
        const content = fs.readFileSync(filePath, "utf-8");
        const hash = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex")
          .substring(0, 16);
        this._fileHashes.set(filePath, hash);
      } catch (error) {
        logger.warn(
          `[IPCApiDocGenerator] Error scanning ${filePath}:`,
          error.message,
        );
      }
    }

    // Invalidate cached spec
    this._cachedSpec = null;

    return this._handlers;
  }

  /**
   * Find all *-ipc.js files recursively
   * @param {string} dir - Directory to scan
   * @returns {string[]} File paths
   */
  _findIPCFiles(dir) {
    const results = [];
    this._walkDir(dir, (filePath) => {
      const basename = path.basename(filePath);
      if (basename.endsWith("-ipc.js") || basename.endsWith("-ipc.ts")) {
        results.push(filePath);
      }
    });
    return results;
  }

  /**
   * Walk directory recursively
   * @param {string} dir - Directory
   * @param {Function} callback - Called with each file
   * @param {number} [depth=0] - Current depth
   */
  _walkDir(dir, callback, depth = 0) {
    if (depth > 10) {
      return;
    }
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name === "node_modules" ||
            entry.name === ".git" ||
            entry.name === "dist"
          ) {
            continue;
          }
          this._walkDir(fullPath, callback, depth + 1);
        } else if (entry.isFile()) {
          callback(fullPath);
        }
      }
    } catch (_error) {
      // Skip unreadable directories
    }
  }

  /**
   * Extract handler info from an IPC file
   * @param {string} filePath - File to parse
   * @returns {Object[]} Array of HandlerInfo objects
   */
  _extractHandlerInfo(filePath) {
    const content = fs.readFileSync(filePath, "utf-8");
    const relativePath = path
      .relative(this.srcDir, filePath)
      .replace(/\\/g, "/");
    const handlers = [];

    // Extract all JSDoc blocks with their positions
    const jsdocBlocks = this._extractJSDocBlocks(content);

    // Find all ipcMain.handle calls
    const handleRegex =
      /ipcMain\.handle\s*\(\s*['"]([^'"]+)['"]\s*,\s*async\s*\(\s*_?event\s*(?:,\s*([^)]*))?\)/g;
    let match;

    while ((match = handleRegex.exec(content)) !== null) {
      const channel = match[1];
      const rawParams = match[2] || "";
      const matchPos = match.index;

      // Find the nearest preceding JSDoc block
      const jsdoc = this._findNearestJSDoc(jsdocBlocks, matchPos);

      // Parse parameters
      const params = this._parseParams(rawParams, jsdoc);

      // Determine response schema
      const responseSchema = this._inferResponseSchema(jsdoc);

      // Calculate line number
      const lineNumber = content.substring(0, matchPos).split("\n").length;

      handlers.push({
        channel,
        namespace: channel.split(":")[0] || "unknown",
        operation: channel.split(":").slice(1).join(":") || channel,
        params,
        response: responseSchema,
        description: jsdoc?.description || "",
        file: relativePath,
        line: lineNumber,
        jsdoc: jsdoc
          ? {
              params: jsdoc.params || [],
              returns: jsdoc.returns || null,
              description: jsdoc.description || "",
            }
          : null,
      });
    }

    return handlers;
  }

  /**
   * Extract all JSDoc blocks from content
   * @param {string} content - File content
   * @returns {Array} JSDoc blocks with positions
   */
  _extractJSDocBlocks(content) {
    const blocks = [];
    const regex = /\/\*\*\s*([\s\S]*?)\s*\*\//g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const raw = match[1];
      const endPos = match.index + match[0].length;

      // Parse JSDoc
      const lines = raw
        .split("\n")
        .map((l) => l.replace(/^\s*\*\s?/, "").trim())
        .filter((l) => l.length > 0);

      const description = [];
      const params = [];
      let returns = null;

      for (const line of lines) {
        const paramMatch = line.match(
          /@param\s+\{([^}]+)\}\s+(?:\[?(\w+?)(?:\s*=\s*([^\]]*))?\]?)\s*-?\s*(.*)/,
        );
        if (paramMatch) {
          params.push({
            type: paramMatch[1],
            name: paramMatch[2],
            defaultValue: paramMatch[3] || null,
            description: paramMatch[4] || "",
            optional: line.includes("["),
          });
          continue;
        }

        const returnsMatch = line.match(/@returns?\s+\{([^}]+)\}\s*(.*)/);
        if (returnsMatch) {
          returns = { type: returnsMatch[1], description: returnsMatch[2] };
          continue;
        }

        if (!line.startsWith("@")) {
          description.push(line);
        }
      }

      blocks.push({
        endPos,
        description: description.join(" "),
        params,
        returns,
      });
    }

    return blocks;
  }

  /**
   * Find the nearest JSDoc block before a position
   * @param {Array} blocks - JSDoc blocks
   * @param {number} position - Target position
   * @returns {Object|null} Nearest JSDoc block
   */
  _findNearestJSDoc(blocks, position) {
    let nearest = null;
    let minDist = Infinity;

    for (const block of blocks) {
      const dist = position - block.endPos;
      if (dist > 0 && dist < minDist && dist < 500) {
        minDist = dist;
        nearest = block;
      }
    }

    return nearest;
  }

  /**
   * Parse handler parameters from raw string and JSDoc
   * @param {string} rawParams - Raw parameter string
   * @param {Object|null} jsdoc - JSDoc info
   * @returns {Array} Parameter definitions
   */
  _parseParams(rawParams, jsdoc) {
    const params = [];
    const trimmed = rawParams.trim();

    if (!trimmed) {
      return params;
    }

    // Check for destructuring pattern: { prop1, prop2 = defaultVal }
    const destructMatch = trimmed.match(/^\{([^}]+)\}$/);
    if (destructMatch) {
      const props = destructMatch[1].split(",").map((p) => p.trim());
      for (const prop of props) {
        const [name, defaultVal] = prop.split("=").map((s) => s.trim());
        const jsdocParam = jsdoc?.params?.find((p) => p.name === name);
        params.push({
          name,
          type: jsdocParam?.type || "any",
          description: jsdocParam?.description || "",
          required: !defaultVal && !jsdocParam?.optional,
          default: defaultVal || jsdocParam?.defaultValue || undefined,
        });
      }
    } else {
      // Positional params: arg1, arg2 = default
      const parts = trimmed.split(",").map((p) => p.trim());
      for (let i = 0; i < parts.length; i++) {
        const [name, defaultVal] = parts[i].split("=").map((s) => s.trim());
        const jsdocParam = jsdoc?.params?.[i];
        params.push({
          name: name || `arg${i}`,
          type: jsdocParam?.type || "any",
          description: jsdocParam?.description || "",
          required: !defaultVal && !jsdocParam?.optional,
          default: defaultVal || jsdocParam?.defaultValue || undefined,
        });
      }
    }

    return params;
  }

  /**
   * Infer response schema from JSDoc or defaults
   * @param {Object|null} jsdoc - JSDoc info
   * @returns {Object} Response schema
   */
  _inferResponseSchema(jsdoc) {
    // Standard IPC response pattern
    return {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "Whether the operation succeeded",
        },
        data: {
          type: jsdoc?.returns?.type || "any",
          description: jsdoc?.returns?.description || "Response data",
        },
        error: {
          type: "string",
          description: "Error message (only present when success=false)",
        },
      },
    };
  }

  /**
   * Generate OpenAPI 3.0 specification
   * @returns {Object} OpenAPI 3.0 JSON object
   */
  generateOpenAPISpec() {
    if (this._cachedSpec) {
      return this._cachedSpec;
    }

    const spec = {
      openapi: this.config.openApiVersion,
      info: {
        title: this.config.apiTitle,
        version: this.config.apiVersion,
        description: this.config.apiDescription,
        contact: { name: "ChainlessChain Team" },
      },
      servers: [
        {
          url: "ipc://",
          description: "Electron IPC (local)",
        },
      ],
      paths: {},
      tags: [],
    };

    // Generate tags from namespaces
    for (const namespace of this._handlers.keys()) {
      spec.tags.push({
        name: namespace,
        description: `${namespace} IPC handlers`,
      });
    }
    spec.tags.sort((a, b) => a.name.localeCompare(b.name));

    // Generate paths from handlers
    for (const [namespace, handlers] of this._handlers) {
      for (const handler of handlers) {
        const pathKey = `${this.config.basePathPrefix}/${handler.channel.replace(/:/g, "/")}`;

        const operation = {
          tags: [namespace],
          summary: handler.description || handler.channel,
          operationId: handler.channel.replace(/:/g, "_"),
          description: handler.description
            ? `${handler.description}\n\nSource: \`${handler.file}:${handler.line}\``
            : `IPC handler: ${handler.channel}\n\nSource: \`${handler.file}:${handler.line}\``,
        };

        // Request body from params
        if (handler.params.length > 0) {
          const properties = {};
          const required = [];

          for (const param of handler.params) {
            properties[param.name] = {
              type: this._mapType(param.type),
              description: param.description || undefined,
              default: param.default || undefined,
            };
            if (param.required) {
              required.push(param.name);
            }
          }

          operation.requestBody = {
            required: required.length > 0,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties,
                  required: required.length > 0 ? required : undefined,
                },
              },
            },
          };
        }

        // Response
        operation.responses = {
          200: {
            description: "Successful response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: { type: "object" },
                  },
                },
              },
            },
          },
          500: {
            description: "Error response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: false },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
        };

        spec.paths[pathKey] = { post: operation };
      }
    }

    this._cachedSpec = spec;
    return spec;
  }

  /**
   * Generate Markdown documentation
   * @returns {string} Markdown content
   */
  generateMarkdownDocs() {
    const lines = [];

    lines.push(`# ${this.config.apiTitle}`);
    lines.push("");
    lines.push(
      `> Auto-generated API documentation | Version: ${this.config.apiVersion}`,
    );
    lines.push(
      `> Total handlers: ${this._getTotalHandlerCount()} | Namespaces: ${this._handlers.size}`,
    );
    lines.push("");

    // Table of Contents
    lines.push("## Table of Contents");
    lines.push("");
    const sortedNamespaces = Array.from(this._handlers.keys()).sort();
    for (const ns of sortedNamespaces) {
      const count = this._handlers.get(ns).length;
      lines.push(
        `- [${ns}](#${ns.replace(/[^a-z0-9]/gi, "-").toLowerCase()}) (${count} handlers)`,
      );
    }
    lines.push("");

    // Each namespace
    for (const ns of sortedNamespaces) {
      const handlers = this._handlers.get(ns);

      lines.push(`## ${ns}`);
      lines.push("");
      lines.push(
        `**${handlers.length} handlers** | Files: ${[...new Set(handlers.map((h) => h.file))].join(", ")}`,
      );
      lines.push("");

      for (const handler of handlers) {
        lines.push(`### \`${handler.channel}\``);
        lines.push("");
        if (handler.description) {
          lines.push(handler.description);
          lines.push("");
        }
        lines.push(`**Source:** \`${handler.file}:${handler.line}\``);
        lines.push("");

        // Parameters
        if (handler.params.length > 0) {
          lines.push("**Parameters:**");
          lines.push("");
          lines.push("| Name | Type | Required | Default | Description |");
          lines.push("|------|------|----------|---------|-------------|");
          for (const param of handler.params) {
            lines.push(
              `| \`${param.name}\` | \`${param.type}\` | ${param.required ? "Yes" : "No"} | ${param.default || "-"} | ${param.description || "-"} |`,
            );
          }
          lines.push("");
        } else {
          lines.push("**Parameters:** None");
          lines.push("");
        }

        // Response
        lines.push(
          "**Response:** `{ success: boolean, data: any, error?: string }`",
        );
        lines.push("");
        lines.push("---");
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /**
   * Get info for a specific channel
   * @param {string} channel - Channel name
   * @returns {Object|null} Handler info
   */
  getChannelInfo(channel) {
    for (const handlers of this._handlers.values()) {
      for (const handler of handlers) {
        if (handler.channel === channel) {
          return handler;
        }
      }
    }
    return null;
  }

  /**
   * Get statistics
   * @returns {Object} Stats
   */
  getStats() {
    const byNamespace = {};
    for (const [ns, handlers] of this._handlers) {
      byNamespace[ns] = handlers.length;
    }

    return {
      totalHandlers: this._getTotalHandlerCount(),
      namespaces: this._handlers.size,
      byNamespace,
      filesScanned: this._fileHashes.size,
      srcDir: this.srcDir,
      outputDir: this.outputDir,
    };
  }

  /**
   * Get current configuration
   * @returns {Object} Config
   */
  getConfig() {
    return { ...this.config };
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Get total handler count across all namespaces
   * @returns {number} Total count
   */
  _getTotalHandlerCount() {
    let total = 0;
    for (const handlers of this._handlers.values()) {
      total += handlers.length;
    }
    return total;
  }

  /**
   * Map JSDoc type to OpenAPI type
   * @param {string} type - JSDoc type
   * @returns {string} OpenAPI type
   */
  _mapType(type) {
    const typeMap = {
      string: "string",
      number: "number",
      integer: "integer",
      boolean: "boolean",
      object: "object",
      array: "array",
      Object: "object",
      Array: "array",
      String: "string",
      Number: "number",
      Boolean: "boolean",
    };
    return typeMap[type] || "string";
  }

  /**
   * Shutdown generator
   */
  shutdown() {
    this._handlers.clear();
    this._fileHashes.clear();
    this._cachedSpec = null;
    this.removeAllListeners();
    logger.info("[IPCApiDocGenerator] Shutdown");
  }
}

module.exports = { IPCApiDocGenerator, DEFAULT_CONFIG };
