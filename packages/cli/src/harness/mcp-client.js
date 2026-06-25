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
  // Backoff sleep seam (tests override with a no-op so retries don't wait).
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
 * Default per-call timeout for HTTP MCP requests, mirroring the 30s stdio
 * timeout so a hung/dead HTTP server can't block a request forever. Servers
 * flagged `longRunning` (e.g. the IDE bridge, whose openDiff blocks on human
 * review) are exempt; override per server with `config.requestTimeoutMs`.
 */
const HTTP_REQUEST_TIMEOUT_MS = 30000;

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
 * Heuristic: does this error look like the server went away (vs. the tool
 * itself failing)? Used to gate reconnect-and-retry for servers that have a
 * registered reconnector (e.g. the IDE bridge after a window reload, which
 * comes back on a NEW port with a NEW token).
 *
 * Covers: fetch-level network failures, auth rejection after a token
 * rotation (401/403), an unknown session on a restarted server (404), and
 * this client's own "server gone" states.
 */
export function isLikelyConnectionError(err) {
  const msg = String((err && err.message) || err || "");
  return /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|network error|HTTP 40[134]\b|not connected|not found|not available/i.test(
    msg,
  );
}

/** Capability-discovery retry tuning (Claude-Code 2.1.191 "short backoff"). */
const MCP_DISCOVERY_RETRIES = 2; // up to 3 attempts total
const MCP_DISCOVERY_BACKOFF_MS = 250; // 250ms, 500ms

/**
 * Hard cap on the unterminated stdout tail buffered per stdio server. JSON-RPC
 * frames are newline-delimited; a runaway or non-MCP process that streams
 * without ever emitting a newline would otherwise grow `entry._buffer` without
 * bound and exhaust memory. 16M chars is far above any legitimate single MCP
 * message (even a tool result with embedded base64), so crossing it signals a
 * misbehaving server. Override per server with `config.maxBufferChars` (0
 * disables the cap).
 */
const MCP_MAX_BUFFER_CHARS = 16 * 1024 * 1024;

/**
 * Is this a TRANSIENT error worth a short retry during capability discovery?
 * Narrower than isLikelyConnectionError: connection-level failures and 5xx
 * server errors retry, but 4xx (auth 401/403, not-found 404 = permanent for the
 * same request), already-waited timeouts, and a dead stdio process do not —
 * retrying those just wastes attempts.
 */
export function isTransientMcpError(err) {
  const msg = String((err && err.message) || err || "");
  if (/HTTP 4\d\d\b/i.test(msg)) return false; // any 4xx is permanent here
  if (/Request timeout/i.test(msg)) return false; // already spent the full budget
  return /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EPIPE|socket hang up|network error|HTTP 5\d\d\b/i.test(
    msg,
  );
}

/**
 * MCP Client — manages connections to MCP servers.
 */
export class MCPClient extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string|null} [options.sessionId] agent session id advertised to
   *   spawned stdio MCP servers (CC_SESSION_ID / CLAUDE_CODE_SESSION_ID env).
   */
  constructor(options = {}) {
    super();
    this.servers = new Map(); // name → { process, state, tools, resources, config }
    this._nextId = 1;
    this._reconnectors = new Map(); // name → async () => config|null
    this._reconnecting = new Map(); // name → in-flight reconnect promise
    this._sessionId =
      options && options.sessionId != null ? String(options.sessionId) : null;
  }

  /**
   * Set (or clear) the agent session id advertised to stdio MCP servers. Only
   * servers connected *after* this call see the new value; already-spawned
   * processes keep the env they were launched with.
   * @param {string|null|undefined} id
   */
  setSessionId(id) {
    this._sessionId = id != null && id !== "" ? String(id) : null;
  }

  /**
   * Environment a spawned stdio MCP server inherits to identify the agent it
   * runs under (Claude-Code 2.1.154 / 2.1.163 parity). `CLAUDECODE` (parity)
   * and `CHAINLESSCHAIN` (native) mark "launched by the agent"; the session id —
   * from the configured value or an ambient `CC_SESSION_ID` — lets a server
   * correlate its work to the run. `CLAUDE_CODE_SESSION_ID` mirrors
   * `CC_SESSION_ID` so servers written for Claude Code work unchanged.
   * @returns {Record<string,string>}
   */
  _agentIdentityEnv() {
    const env = { CLAUDECODE: "1", CHAINLESSCHAIN: "1" };
    const sid =
      this._sessionId ||
      process.env.CC_SESSION_ID ||
      process.env.CLAUDE_CODE_SESSION_ID ||
      null;
    if (sid) {
      env.CC_SESSION_ID = String(sid);
      env.CLAUDE_CODE_SESSION_ID = String(sid);
    }
    return env;
  }

  /**
   * Register a reconnector for a server: an async function that returns a
   * FRESH connection config (or null when the server can't be found anymore).
   * When a `callTool` on that server fails with a connection-shaped error,
   * the client re-resolves the config, reconnects, and retries the call once.
   *
   * Used by the IDE bridge: a window reload / extension update restarts the
   * editor's MCP server on a new port with a new token, so the original
   * config is permanently dead but a lockfile re-scan finds the new one.
   */
  setReconnector(name, fn) {
    if (typeof fn === "function") this._reconnectors.set(name, fn);
    else this._reconnectors.delete(name);
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
      // Per-connection streaming decoders so a multi-byte UTF-8 character (e.g.
      // a 3-byte Chinese char) split across two stdout/stderr chunks is
      // reassembled instead of corrupted into U+FFFD. Decoding each chunk
      // independently (data.toString("utf8")) would mangle a split character.
      _decoder: new TextDecoder("utf-8"),
      _stderrDecoder: new TextDecoder("utf-8"),
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
          // process.env < agent identity (CLAUDECODE / session id) < the
          // server's own config.env, so an explicit per-server override wins.
          env: {
            ...process.env,
            ...this._agentIdentityEnv(),
            ...(config.env || {}),
          },
        });

        entry.process = proc;

        proc.stdout.on("data", (data) => {
          this._handleData(
            name,
            typeof data === "string"
              ? data
              : entry._decoder.decode(data, { stream: true }),
          );
        });

        proc.stderr.on("data", (data) => {
          this.emit("server-error", {
            name,
            error:
              typeof data === "string"
                ? data
                : entry._stderrDecoder.decode(data, { stream: true }),
          });
        });

        // If the server process dies with requests in flight, reject them
        // immediately with a clear error instead of letting each hang until its
        // 30s timeout (fail-fast on a crashed/exited MCP server).
        const failPending = (errMsg) => {
          for (const [, pending] of entry._pending) {
            if (pending.timeout) clearTimeout(pending.timeout);
            try {
              pending.reject(new Error(errMsg));
            } catch {
              // already settled — ignore
            }
          }
          entry._pending.clear();
        };

        proc.on("close", (code) => {
          entry.state = ServerState.DISCONNECTED;
          failPending(
            `MCP server "${name}" process exited (code ${code}) before responding`,
          );
          this.emit("server-disconnected", { name, code });
        });

        proc.on("error", (err) => {
          entry.state = ServerState.ERROR;
          failPending(`MCP server "${name}" process error: ${err.message}`);
          this.emit("server-error", { name, error: err.message });
        });

        // Writing to a stdio server that closed its stdin read end (or died
        // mid-write) makes the stdin pipe emit an asynchronous 'error' (EPIPE).
        // An 'error' event with no listener is an uncaught exception in Node and
        // would CRASH the whole CLI — and the try/catch around stdin.write only
        // catches synchronous throws, not this async event. Handle it: drain
        // in-flight requests and surface it, mirroring the process 'error' path.
        if (proc.stdin && typeof proc.stdin.on === "function") {
          proc.stdin.on("error", (err) => {
            entry.state = ServerState.ERROR;
            failPending(`MCP server "${name}" stdin error: ${err.message}`);
            this.emit("server-error", { name, error: err.message });
          });
        }
      } else {
        throw new Error(
          `transport "${transportKind}" is not supported by this client`,
        );
      }

      // Initialize MCP protocol (retried on transient network errors).
      const initResult = await this._requestWithRetry(name, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: {}, prompts: {} },
        clientInfo: { name: "chainlesschain-cli", version: "0.37.9" },
      });

      // Send initialized notification
      this._sendNotification(name, "notifications/initialized", {});

      entry.state = ServerState.CONNECTED;
      entry.serverInfo = initResult?.serverInfo || {};
      entry.capabilities = initResult?.capabilities || {};

      // Fetch available tools. Per MCP a server advertises a `tools` capability
      // in its initialize response; if it does and tools/list then fails, that
      // is a genuine fetch failure we must surface (Claude-Code 2.1.181 — show
      // "Connected · tools fetch failed" rather than a misleading "Tools: 0").
      // A server that did not advertise tools simply has none, so a failure
      // there is expected and stays quiet.
      entry.tools = [];
      entry.toolsError = null;
      const advertisesTools =
        entry.capabilities && entry.capabilities.tools !== undefined;
      try {
        const toolsResult = await this._requestWithRetry(
          name,
          "tools/list",
          {},
        );
        entry.tools = toolsResult?.tools || [];
      } catch (err) {
        if (advertisesTools) {
          entry.toolsError = err?.message || String(err);
        }
        // else: server did not advertise tools — legitimately none.
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

      // Fetch available prompts (server-provided slash commands)
      try {
        const promptsResult = await this._sendRequest(name, "prompts/list", {});
        entry.prompts = promptsResult?.prompts || [];
      } catch {
        // Server may not support prompts
      }

      this.emit("server-connected", {
        name,
        tools: entry.tools.length,
        toolsError: entry.toolsError,
      });
      return {
        name,
        state: entry.state,
        tools: entry.tools,
        toolsError: entry.toolsError,
        resources: entry.resources,
        prompts: entry.prompts,
        serverInfo: entry.serverInfo,
      };
    } catch (err) {
      entry.state = ServerState.ERROR;
      // A stdio child spawned above but failed to initialize (handshake
      // timeout / broken pipe / non-MCP command) would otherwise leak: we
      // delete the entry from `this.servers` below, so disconnect() can never
      // reach it, and an alive-but-unresponsive process fires neither `close`
      // nor `error` — it would run orphaned with its stdio listeners bound for
      // the lifetime of the CLI. Tear it down on the way out (best-effort;
      // never mask the original connect error).
      if (entry.process) {
        try {
          entry.process.stdout?.removeAllListeners();
          entry.process.stderr?.removeAllListeners();
          entry.process.stdin?.removeAllListeners?.();
          entry.process.removeAllListeners();
          entry.process.kill();
        } catch {
          // teardown is best-effort — the connect error is what matters
        }
      }
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
        toolsError: entry.toolsError || null,
        resources: entry.resources.length,
        prompts: (entry.prompts || []).length,
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
   * Call a tool on a specific server. If the server has a registered
   * reconnector and the call fails with a connection-shaped error (server
   * restarted / token rotated / entry dropped), re-resolve the config,
   * reconnect, and retry the call exactly once.
   * @param {string} serverName - Server name
   * @param {string} toolName - Tool name
   * @param {object} args - Tool arguments
   */
  async callTool(serverName, toolName, args = {}) {
    try {
      return await this._callToolOnce(serverName, toolName, args);
    } catch (err) {
      if (
        !this._reconnectors.has(serverName) ||
        !isLikelyConnectionError(err)
      ) {
        throw err;
      }
      const reconnected = await this._tryReconnect(serverName);
      if (!reconnected) throw err;
      return await this._callToolOnce(serverName, toolName, args);
    }
  }

  async _callToolOnce(serverName, toolName, args) {
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
   * Re-resolve a server's config via its reconnector and reconnect.
   * Single-flight per server: concurrent failing calls share one attempt
   * (the IDE context injector fires getSelection + getOpenEditors in
   * parallel — a double connect would throw "already connected").
   * Resolves true on success, false on any failure (original error wins).
   */
  _tryReconnect(name) {
    const inFlight = this._reconnecting.get(name);
    if (inFlight) return inFlight;
    const p = (async () => {
      try {
        const fresh = await this._reconnectors.get(name)();
        if (!fresh) return false;
        try {
          await this.disconnect(name);
        } catch {
          // entry may already be gone — connect() below is what matters
        }
        await this.connect(name, fresh);
        this.emit("server-reconnected", { name, url: fresh.url || null });
        return true;
      } catch {
        return false;
      } finally {
        this._reconnecting.delete(name);
      }
    })();
    this._reconnecting.set(name, p);
    return p;
  }

  /**
   * List resources from a specific server or all servers. Each resource is
   * annotated with its owning `server` (mirrors `listTools`).
   */
  listResources(serverName) {
    if (serverName) {
      const entry = this.servers.get(serverName);
      if (!entry) throw new Error(`Server "${serverName}" not found`);
      return (entry.resources || []).map((r) => ({ ...r, server: serverName }));
    }

    const all = [];
    for (const [name, entry] of this.servers) {
      for (const r of entry.resources || []) {
        all.push({ ...r, server: name });
      }
    }
    return all;
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

  /**
   * List prompts from a specific server or all servers. Each prompt is
   * annotated with its owning `server` (mirrors `listTools`).
   */
  listPrompts(serverName) {
    if (serverName) {
      const entry = this.servers.get(serverName);
      if (!entry) throw new Error(`Server "${serverName}" not found`);
      return (entry.prompts || []).map((p) => ({ ...p, server: serverName }));
    }

    const all = [];
    for (const [name, entry] of this.servers) {
      for (const p of entry.prompts || []) {
        all.push({ ...p, server: name });
      }
    }
    return all;
  }

  /**
   * Fetch a rendered prompt (`prompts/get`) from a server. `args` is a map of
   * the prompt's named arguments to string values. Returns the server's result
   * `{ description?, messages: [...] }`.
   */
  async getPrompt(serverName, promptName, args = {}) {
    const entry = this.servers.get(serverName);
    if (!entry) throw new Error(`Server "${serverName}" not found`);
    if (entry.state !== ServerState.CONNECTED) {
      throw new Error(`Server "${serverName}" is not connected`);
    }

    const result = await this._sendRequest(serverName, "prompts/get", {
      name: promptName,
      arguments: args || {},
    });
    return result;
  }

  // ─── Internal JSON-RPC transport ──────────────────────────────

  /**
   * Capability-discovery request with a short backoff retry on TRANSIENT
   * network errors (Claude-Code 2.1.191: "capability discovery now retries
   * transient network errors with short backoff"). Permanent errors (4xx,
   * JSON-RPC errors, timeouts, dead stdio process) throw on the first failure.
   */
  async _requestWithRetry(
    serverName,
    method,
    params,
    attempts = MCP_DISCOVERY_RETRIES,
  ) {
    for (let i = 0; ; i++) {
      try {
        return await this._sendRequest(serverName, method, params);
      } catch (err) {
        if (i >= attempts || !isTransientMcpError(err)) throw err;
        this.emit("server-retry", {
          name: serverName,
          method,
          attempt: i + 1,
          error: err?.message || String(err),
        });
        await _deps.sleep(MCP_DISCOVERY_BACKOFF_MS * (i + 1));
      }
    }
  }

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

    // Per-call timeout (parity with the 30s stdio timeout) so a hung or dead
    // HTTP MCP server can't block the request forever. Servers flagged
    // longRunning — e.g. the IDE bridge, whose openDiff blocks on human review
    // (see ideServerToMcpConfig) — are exempt. Override per server with
    // config.requestTimeoutMs (0 disables).
    const longRunning = Boolean(entry.config && entry.config.longRunning);
    const timeoutMs = Number.isFinite(entry.config?.requestTimeoutMs)
      ? entry.config.requestTimeoutMs
      : HTTP_REQUEST_TIMEOUT_MS;
    let controller = null;
    let timer = null;
    if (
      !longRunning &&
      timeoutMs > 0 &&
      typeof AbortController === "function"
    ) {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const response = await _deps.fetch(entry.httpUrl, {
        method: "POST",
        headers,
        body,
        ...(controller ? { signal: controller.signal } : {}),
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
        const detail = text ? `: ${text.slice(0, 200)}` : "";
        // 404 usually means a wrong/stale server URL — name it and point at the
        // MCP config (Claude-Code 2.1.191: "HTTP 404 errors now show the URL and
        // point to your MCP config") instead of a bare "HTTP 404".
        if (response.status === 404) {
          throw new Error(
            `HTTP 404${detail} — ${entry.httpUrl} returned Not Found; check this server's "url" in your MCP config`,
          );
        }
        throw new Error(`HTTP ${response.status}${detail}`);
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
                typeof response.text === "function"
                  ? await response.text()
                  : "",
              );
      }

      if (!envelope || typeof envelope !== "object") {
        throw new Error("Empty or invalid JSON-RPC response");
      }
      if (envelope.error) {
        throw new Error(envelope.error.message || "Unknown error");
      }
      return envelope.result;
    } catch (err) {
      if (controller && controller.signal.aborted) {
        throw new Error(
          `Request timeout: ${method} (HTTP, no response in ${timeoutMs}ms)`,
        );
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
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

    // Guard against unbounded buffer growth: a runaway / non-MCP server that
    // streams without ever sending a newline would grow the unterminated tail
    // forever and exhaust memory. If the leftover partial line exceeds the cap,
    // treat it as a fatal transport error (drop the buffer, drain in-flight
    // requests, kill the process) rather than letting it grow without limit.
    const cap = Number.isFinite(entry.config?.maxBufferChars)
      ? entry.config.maxBufferChars
      : MCP_MAX_BUFFER_CHARS;
    if (cap > 0 && entry._buffer.length > cap) {
      entry._buffer = "";
      entry.state = ServerState.ERROR;
      const errMsg = `MCP server "${serverName}" exceeded the ${cap}-char line buffer with no newline (runaway or non-MCP output)`;
      for (const [, pending] of entry._pending) {
        if (pending.timeout) clearTimeout(pending.timeout);
        try {
          pending.reject(new Error(errMsg));
        } catch {
          // already settled — ignore
        }
      }
      entry._pending.clear();
      if (entry.process) {
        try {
          entry.process.kill();
        } catch {
          // best-effort — surfacing the error is what matters
        }
      }
      this.emit("server-error", { name: serverName, error: errMsg });
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
