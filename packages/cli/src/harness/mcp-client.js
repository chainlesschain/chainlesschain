/**
 * Lightweight MCP (Model Context Protocol) client.
 * Implements JSON-RPC 2.0 over stdio transport without external SDK dependency.
 *
 * Canonical location (moved from src/lib/mcp-client.js as part of the
 * CLI Runtime Convergence roadmap, Phase 3). src/lib/mcp-client.js is now a
 * thin re-export shim for backwards compatibility.
 */

import { spawn } from "child_process";
import { EventEmitter } from "events";

/**
 * MCP Server connection states.
 */
export const ServerState = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
};

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
   * Connect to an MCP server via stdio transport.
   * @param {string} name - Server name
   * @param {object} config - { command, args?, env? }
   */
  async connect(name, config) {
    if (this.servers.has(name)) {
      throw new Error(`Server "${name}" already connected`);
    }

    const entry = {
      config,
      state: ServerState.CONNECTING,
      process: null,
      tools: [],
      resources: [],
      prompts: [],
      _pending: new Map(),
      _buffer: "",
    };

    this.servers.set(name, entry);

    try {
      const proc = spawn(config.command, config.args || [], {
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
    return new Promise((resolve, reject) => {
      const entry = this.servers.get(serverName);
      if (!entry || !entry.process) {
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
    if (!entry || !entry.process) return;

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
 * MCP server configuration storage.
 * Persists server configs in the database.
 */
export class MCPServerConfig {
  constructor(db) {
    this.db = db;
    this._ensureTable();
  }

  _ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        name TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        args TEXT DEFAULT '[]',
        env TEXT DEFAULT '{}',
        auto_connect INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  add(name, config) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO mcp_servers (name, command, args, env, auto_connect, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
      )
      .run(
        name,
        config.command,
        JSON.stringify(config.args || []),
        JSON.stringify(config.env || {}),
        config.autoConnect ? 1 : 0,
      );
  }

  remove(name) {
    const result = this.db
      .prepare("DELETE FROM mcp_servers WHERE name = ?")
      .run(name);
    return result.changes > 0;
  }

  get(name) {
    const row = this.db
      .prepare("SELECT * FROM mcp_servers WHERE name = ?")
      .get(name);
    if (!row) return null;
    return {
      name: row.name,
      command: row.command,
      args: JSON.parse(row.args || "[]"),
      env: JSON.parse(row.env || "{}"),
      autoConnect: row.auto_connect === 1,
    };
  }

  list() {
    const rows = this.db
      .prepare("SELECT * FROM mcp_servers ORDER BY name")
      .all();
    return rows.map((row) => ({
      name: row.name,
      command: row.command,
      args: JSON.parse(row.args || "[]"),
      env: JSON.parse(row.env || "{}"),
      autoConnect: row.auto_connect === 1,
    }));
  }

  getAutoConnect() {
    const rows = this.db
      .prepare("SELECT * FROM mcp_servers WHERE auto_connect = ? ORDER BY name")
      .all(1);
    return rows.map((row) => ({
      name: row.name,
      command: row.command,
      args: JSON.parse(row.args || "[]"),
      env: JSON.parse(row.env || "{}"),
      autoConnect: true,
    }));
  }
}
