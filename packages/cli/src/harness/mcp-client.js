/**
 * Lightweight MCP (Model Context Protocol) client.
 * Implements JSON-RPC 2.0 over stdio transport plus a minimal HTTP transport
 * (Streamable HTTP / SSE — one-shot request/response) without the official SDK.
 *
 * Canonical location (moved from src/lib/mcp-client.js as part of the
 * CLI Runtime Convergence roadmap, Phase 3). src/lib/mcp-client.js is now a
 * thin re-export shim for backwards compatibility.
 */

import { spawn } from "child_process";
import { EventEmitter } from "events";

/**
 * Injectable dependencies — overridable from tests.
 * `fetch` defaults to the global fetch (Node 18+).
 */
export const _deps = {
  spawn,
  fetch: (...args) => globalThis.fetch(...args),
};

/**
 * MCP Server connection states.
 */
export const ServerState = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
};

/** Transport kinds that carry a URL (no stdio process). */
const URL_TRANSPORTS = new Set(["http", "https", "sse", "ws", "wss"]);

/**
 * Infer the transport kind for a server config. Falls back to "stdio".
 * Prefers an explicit `transport` field; otherwise derives from URL scheme
 * (http → http, https → https, ws/wss preserved); otherwise stdio.
 */
export function inferTransport(config) {
  if (!config || typeof config !== "object") return "stdio";
  if (typeof config.transport === "string" && config.transport.length > 0) {
    return config.transport.toLowerCase();
  }
  if (typeof config.url === "string" && config.url.length > 0) {
    try {
      const proto = new URL(config.url).protocol.replace(":", "").toLowerCase();
      if (
        proto === "http" ||
        proto === "https" ||
        proto === "ws" ||
        proto === "wss"
      ) {
        return proto;
      }
    } catch (_e) {
      // fall through to stdio
    }
  }
  return "stdio";
}

/** True for transports that talk over HTTP(S) — i.e. use fetch. */
export function isHttpTransport(transportKind) {
  return (
    transportKind === "http" ||
    transportKind === "https" ||
    transportKind === "sse"
  );
}

/**
 * MCP Client — manages connections to MCP servers.
 */
export class MCPClient extends EventEmitter {
  constructor() {
    super();
    this.servers = new Map(); // name → { process, state, tools, resources, config }
    this._nextId = 1;
  }

  /**
   * Connect to an MCP server. Routes to stdio or HTTP transport based on
   * `config.transport` / `config.url` (see `inferTransport`).
   *
   * @param {string} name - Server name
   * @param {object} config - { command?, args?, env?, url?, transport? }
   */
  async connect(name, config) {
    if (this.servers.has(name)) {
      throw new Error(`Server "${name}" already connected`);
    }

    const transportKind = inferTransport(config);
    const entry = {
      config,
      transportKind,
      state: ServerState.CONNECTING,
      process: null,
      httpUrl: null,
      httpHeaders: {},
      httpSessionId: null,
      tools: [],
      resources: [],
      prompts: [],
      _pending: new Map(),
      _buffer: "",
    };

    this.servers.set(name, entry);

    try {
      if (isHttpTransport(transportKind)) {
        if (!config.url) {
          throw new Error(`HTTP transport requires a url (server "${name}")`);
        }
        entry.httpUrl = config.url;
        entry.httpHeaders = { ...(config.headers || {}) };
      } else if (transportKind === "stdio") {
        if (!config.command) {
          throw new Error(
            `stdio transport requires a command (server "${name}")`,
          );
        }
        const proc = _deps.spawn(config.command, config.args || [], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...(config.env || {}) },
        });

        entry.process = proc;

        proc.stdout.on("data", (data) => {
          this._handleData(name, data.toString("utf8"));
        });

        proc.stderr.on("data", (data) => {
          this.emit("server-error", { name, error: data.toString("utf8") });
        });

        proc.on("close", (code) => {
          entry.state = ServerState.DISCONNECTED;
          this.emit("server-disconnected", { name, code });
        });

        proc.on("error", (err) => {
          entry.state = ServerState.ERROR;
          this.emit("server-error", { name, error: err.message });
        });
      } else {
        throw new Error(
          `transport "${transportKind}" is not supported by this client`,
        );
      }

      // Initialize MCP protocol
      const initResult = await this._sendRequest(name, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: {} },
        clientInfo: { name: "chainlesschain-cli", version: "0.37.9" },
      });

      // Send initialized notification
      this._sendNotification(name, "notifications/initialized", {});

      entry.state = ServerState.CONNECTED;
      entry.serverInfo = initResult?.serverInfo || {};
      entry.capabilities = initResult?.capabilities || {};

      // Fetch available tools
      try {
        const toolsResult = await this._sendRequest(name, "tools/list", {});
        entry.tools = toolsResult?.tools || [];
      } catch {
        // Server may not support tools
      }

      // Fetch available resources
      try {
        const resourcesResult = await this._sendRequest(
          name,
          "resources/list",
          {},
        );
        entry.resources = resourcesResult?.resources || [];
      } catch {
        // Server may not support resources
      }

      this.emit("server-connected", { name, tools: entry.tools.length });
      return {
        name,
        state: entry.state,
        tools: entry.tools,
        resources: entry.resources,
        serverInfo: entry.serverInfo,
      };
    } catch (err) {
      entry.state = ServerState.ERROR;
      this.servers.delete(name);
      throw err;
    }
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(name) {
    const entry = this.servers.get(name);
    if (!entry) return false;

    if (entry.process) {
      entry.process.kill();
    }
    // HTTP sessions: best-effort DELETE to free server-side state.
    if (entry.httpUrl && entry.httpSessionId) {
      try {
        await _deps.fetch(entry.httpUrl, {
          method: "DELETE",
          headers: { "Mcp-Session-Id": entry.httpSessionId },
        });
      } catch (_e) {
        // ignore — disconnect is best-effort
      }
    }

    entry.state = ServerState.DISCONNECTED;
    this.servers.delete(name);
    return true;
  }

  /**
   * Disconnect from all servers.
   */
  async disconnectAll() {
    const names = [...this.servers.keys()];
    for (const name of names) {
      await this.disconnect(name);
    }
  }

  /**
   * List all connected servers.
   */
  listServers() {
    const result = [];
    for (const [name, entry] of this.servers) {
      result.push({
        name,
        state: entry.state,
        tools: entry.tools.length,
        resources: entry.resources.length,
        serverInfo: entry.serverInfo || {},
      });
    }
    return result;
  }

  /**
   * List tools from a specific server or all servers.
   */
  listTools(serverName) {
    if (serverName) {
      const entry = this.servers.get(serverName);
      if (!entry) throw new Error(`Server "${serverName}" not found`);
      return entry.tools.map((t) => ({ ...t, server: serverName }));
    }

    const allTools = [];
    for (const [name, entry] of this.servers) {
      for (const tool of entry.tools) {
        allTools.push({ ...tool, server: name });
      }
    }
    return allTools;
  }

  /**
   * Call a tool on a specific server.
   * @param {string} serverName - Server name
   * @param {string} toolName - Tool name
   * @param {object} args - Tool arguments
   */
  async callTool(serverName, toolName, args = {}) {
    const entry = this.servers.get(serverName);
    if (!entry) throw new Error(`Server "${serverName}" not found`);
    if (entry.state !== ServerState.CONNECTED) {
      throw new Error(`Server "${serverName}" is not connected`);
    }

    const result = await this._sendRequest(serverName, "tools/call", {
      name: toolName,
      arguments: args,
    });

    return result;
  }

  /**
   * Read a resource from a server.
   */
  async readResource(serverName, uri) {
    const entry = this.servers.get(serverName);
    if (!entry) throw new Error(`Server "${serverName}" not found`);

    const result = await this._sendRequest(serverName, "resources/read", {
      uri,
    });
    return result;
  }

  // ─── Internal JSON-RPC transport ──────────────────────────────

  _sendRequest(serverName, method, params) {
    const entry = this.servers.get(serverName);
    if (!entry) return Promise.reject(new Error("Server not available"));

    if (entry.httpUrl) {
      return this._sendHttpRequest(serverName, method, params);
    }

    return new Promise((resolve, reject) => {
      if (!entry.process) {
        return reject(new Error("Server not available"));
      }

      const id = this._nextId++;
      const message = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      entry._pending.set(id, { resolve, reject });

      // Set timeout
      const timeout = setTimeout(() => {
        entry._pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      entry._pending.get(id).timeout = timeout;

      try {
        entry.process.stdin.write(message + "\n");
      } catch (err) {
        clearTimeout(timeout);
        entry._pending.delete(id);
        reject(err);
      }
    });
  }

  _sendNotification(serverName, method, params) {
    const entry = this.servers.get(serverName);
    if (!entry) return;

    if (entry.httpUrl) {
      // Fire-and-forget HTTP notification (no id, no response expected).
      this._sendHttpNotification(serverName, method, params);
      return;
    }

    if (!entry.process) return;

    const message = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });

    try {
      entry.process.stdin.write(message + "\n");
    } catch {
      // Ignore notification errors
    }
  }

  /**
   * Send a JSON-RPC request over HTTP (Streamable HTTP per MCP spec).
   * Accepts responses as either `application/json` or `text/event-stream`.
   * Captures `Mcp-Session-Id` header from the first response for reuse.
   */
  async _sendHttpRequest(serverName, method, params) {
    const entry = this.servers.get(serverName);
    if (!entry || !entry.httpUrl) {
      throw new Error("Server not available");
    }

    const id = this._nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(entry.httpHeaders || {}),
    };
    if (entry.httpSessionId) {
      headers["Mcp-Session-Id"] = entry.httpSessionId;
    }

    const response = await _deps.fetch(entry.httpUrl, {
      method: "POST",
      headers,
      body,
    });

    // Capture session id (server may emit on initialize response only)
    const sessionId =
      (response.headers && typeof response.headers.get === "function"
        ? response.headers.get("mcp-session-id") ||
          response.headers.get("Mcp-Session-Id")
        : null) || null;
    if (sessionId && !entry.httpSessionId) {
      entry.httpSessionId = sessionId;
    }

    if (!response.ok) {
      const text =
        typeof response.text === "function" ? await response.text() : "";
      throw new Error(
        `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      );
    }

    const contentType = response.headers?.get
      ? String(response.headers.get("content-type") || "").toLowerCase()
      : "";

    let envelope;
    if (contentType.includes("text/event-stream")) {
      envelope = await _extractSseResponse(response, id);
    } else {
      envelope =
        typeof response.json === "function"
          ? await response.json()
          : JSON.parse(
              typeof response.text === "function" ? await response.text() : "",
            );
    }

    if (!envelope || typeof envelope !== "object") {
      throw new Error("Empty or invalid JSON-RPC response");
    }
    if (envelope.error) {
      throw new Error(envelope.error.message || "Unknown error");
    }
    return envelope.result;
  }

  /** Fire-and-forget JSON-RPC notification over HTTP. Errors swallowed. */
  _sendHttpNotification(serverName, method, params) {
    const entry = this.servers.get(serverName);
    if (!entry || !entry.httpUrl) return;
    const body = JSON.stringify({ jsonrpc: "2.0", method, params });
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(entry.httpHeaders || {}),
    };
    if (entry.httpSessionId) {
      headers["Mcp-Session-Id"] = entry.httpSessionId;
    }
    try {
      const p = _deps.fetch(entry.httpUrl, {
        method: "POST",
        headers,
        body,
      });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_e) {
      // ignore
    }
  }

  _handleData(serverName, data) {
    const entry = this.servers.get(serverName);
    if (!entry) return;

    entry._buffer += data;

    // Process complete JSON lines
    const lines = entry._buffer.split("\n");
    entry._buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);
        this._handleMessage(serverName, msg);
      } catch {
        // Skip malformed lines
      }
    }
  }

  _handleMessage(serverName, msg) {
    const entry = this.servers.get(serverName);
    if (!entry) return;

    // Response to a request
    if (msg.id !== undefined && entry._pending.has(msg.id)) {
      const { resolve, reject, timeout } = entry._pending.get(msg.id);
      clearTimeout(timeout);
      entry._pending.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error.message || "Unknown error"));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Server notification
    if (msg.method) {
      this.emit("notification", {
        server: serverName,
        method: msg.method,
        params: msg.params,
      });
    }
  }
}

/**
 * Parse a `text/event-stream` HTTP response body and return the first
 * JSON-RPC envelope whose id matches `requestId`. Tolerates multiple
 * `data:` chunks, comments, and non-JSON-RPC events.
 */
async function _extractSseResponse(response, requestId) {
  let text;
  if (typeof response.text === "function") {
    text = await response.text();
  } else if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    text = chunks.join("");
  } else {
    throw new Error("SSE response is not readable");
  }

  // Split into events on blank line, parse each event's concatenated `data:` lines.
  const events = text.split(/\r?\n\r?\n/);
  for (const event of events) {
    const dataLines = [];
    for (const line of event.split(/\r?\n/)) {
      if (line.startsWith(":")) continue; // comment
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (dataLines.length === 0) continue;
    try {
      const payload = JSON.parse(dataLines.join("\n"));
      if (payload && payload.jsonrpc === "2.0" && payload.id === requestId) {
        return payload;
      }
    } catch (_e) {
      // skip non-JSON data events
    }
  }
  throw new Error(`SSE stream ended without a response for id ${requestId}`);
}

/**
 * MCP server configuration storage.
 * Persists server configs in the database. Supports both stdio (command+args)
 * and url-based transports (http/sse/ws). URL-based rows may have a null
 * command.
 */
export class MCPServerConfig {
  constructor(db) {
    this.db = db;
    this._ensureTable();
    this._migrateSchema();
  }

  _ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        name TEXT PRIMARY KEY,
        command TEXT,
        args TEXT DEFAULT '[]',
        env TEXT DEFAULT '{}',
        auto_connect INTEGER DEFAULT 0,
        url TEXT,
        transport TEXT DEFAULT 'stdio',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Idempotent schema migration for databases that predate url/transport
   * columns. Silently skipped on mocks or anything that doesn't expose
   * `pragma()`.
   */
  _migrateSchema() {
    try {
      const info =
        typeof this.db.pragma === "function"
          ? this.db.pragma("table_info(mcp_servers)")
          : null;
      if (!Array.isArray(info) || info.length === 0) return;
      const cols = new Set(info.map((c) => c.name));
      if (!cols.has("url")) {
        this.db.exec("ALTER TABLE mcp_servers ADD COLUMN url TEXT");
      }
      if (!cols.has("transport")) {
        this.db.exec(
          "ALTER TABLE mcp_servers ADD COLUMN transport TEXT DEFAULT 'stdio'",
        );
      }
    } catch (_e) {
      // Best-effort; non-SQLite mocks silently skip.
    }
  }

  add(name, config) {
    const url = config.url || null;
    const transport =
      config.transport || (url ? inferTransport({ url }) : "stdio");
    if (!url && !config.command) {
      throw new Error("MCP server config requires either command or url");
    }
    this.db
      .prepare(
        "INSERT OR REPLACE INTO mcp_servers (name, command, args, env, auto_connect, url, transport, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
      )
      .run(
        name,
        config.command || null,
        JSON.stringify(config.args || []),
        JSON.stringify(config.env || {}),
        config.autoConnect ? 1 : 0,
        url,
        transport,
      );
  }

  remove(name) {
    const result = this.db
      .prepare("DELETE FROM mcp_servers WHERE name = ?")
      .run(name);
    return result.changes > 0;
  }

  _rowToConfig(row) {
    return {
      name: row.name,
      command: row.command || null,
      args: JSON.parse(row.args || "[]"),
      env: JSON.parse(row.env || "{}"),
      autoConnect: row.auto_connect === 1,
      url: row.url || null,
      transport:
        row.transport || (row.url ? inferTransport({ url: row.url }) : "stdio"),
    };
  }

  get(name) {
    const row = this.db
      .prepare("SELECT * FROM mcp_servers WHERE name = ?")
      .get(name);
    if (!row) return null;
    return this._rowToConfig(row);
  }

  list() {
    const rows = this.db
      .prepare("SELECT * FROM mcp_servers ORDER BY name")
      .all();
    return rows.map((row) => this._rowToConfig(row));
  }

  getAutoConnect() {
    const rows = this.db
      .prepare("SELECT * FROM mcp_servers WHERE auto_connect = ? ORDER BY name")
      .all(1);
    return rows.map((row) => this._rowToConfig(row));
  }
}
