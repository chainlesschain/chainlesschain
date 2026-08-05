/**
 * Lightweight MCP (Model Context Protocol) client.
 * Implements JSON-RPC 2.0 over stdio transport plus a minimal HTTP transport
 * (Streamable HTTP / SSE — one-shot request/response) without the official SDK.
 *
 * Canonical location (moved from src/lib/mcp-client.js as part of the
 * CLI Runtime Convergence roadmap, Phase 3). src/lib/mcp-client.js is now a
 * thin re-export shim for backwards compatibility.
 */

import { executionBroker } from "../lib/process-execution-broker/index.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "events";
import { pathToFileURL } from "url";
import WebSocket from "ws";
import { safeJsonParse } from "../lib/safe-json.js";
import { EventRuntimeProducer } from "../lib/event-runtime-producer.js";
import { currentHostHooksV2WorkspaceBinding } from "../lib/hooks-v2-workspace-context.js";
import { resolvePluginWorkspaceAuthority } from "../lib/plugin-runtime/sandbox-policy.js";
import {
  mergeMcpHeaders,
  resolveMcpHeadersHelperContext,
  runMcpHeadersHelper,
} from "../lib/mcp-headers-helper.js";

/**
 * Injectable dependencies — overridable from tests.
 * `fetch` defaults to the global fetch (Node 18+).
 */
export const _deps = {
  spawn: executionBroker.spawn.bind(executionBroker),
  fetch: (...args) => globalThis.fetch(...args),
  WebSocket,
  runMcpHeadersHelper,
  resolveMcpHeadersHelperContext,
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

export const MCP_CONFIG_SCOPES = Object.freeze([
  "local",
  "project",
  "user",
  "managed",
]);

export function normalizeMcpConfigScope(scope = "user") {
  const normalized = String(scope || "user")
    .trim()
    .toLowerCase();
  if (!MCP_CONFIG_SCOPES.includes(normalized)) {
    throw new Error(
      `Invalid MCP scope "${scope}"; expected ${MCP_CONFIG_SCOPES.join(" | ")}`,
    );
  }
  return normalized;
}

/**
 * Default per-call timeout for HTTP MCP requests, mirroring the 30s stdio
 * timeout so a hung/dead HTTP server can't block a request forever. Servers
 * flagged `longRunning` (e.g. the IDE bridge, whose openDiff blocks on human
 * review) are exempt; override per server with `config.requestTimeoutMs`.
 */
const HTTP_REQUEST_TIMEOUT_MS = 30000;
const WEBSOCKET_CONNECT_TIMEOUT_MS = 10000;
const WEBSOCKET_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
// Host-owned ceiling for every finite HTTP MCP response body. Server config
// may tighten this through maxBufferChars for backwards compatibility, but it
// cannot raise or disable this byte limit.
const MCP_HTTP_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;
// Error diagnostics only surface 200 characters. Bound the transport-owned
// preview well below the full response ceiling and cancel the remaining body.
const MCP_HTTP_ERROR_PREVIEW_MAX_BYTES = 4 * 1024;

/**
 * Default per-call timeout for stdio MCP requests — the same 30s default as the
 * HTTP path. The stdio request path now honours the SAME `config.longRunning`
 * exemption and `config.requestTimeoutMs` override (0 disables) the HTTP path
 * already respected; previously stdio hardcoded 30s, so a long-running stdio
 * tool (one that blocks on human input or a long computation) was killed at a
 * hard 30s regardless of its config — an inconsistency with HTTP servers.
 */
const STDIO_REQUEST_TIMEOUT_MS = 30000;
const MCP_PROTOCOL_VERSION = "2025-11-25";
const URL_ELICITATION_REQUIRED = -32042;

function supportsUrlElicitationVersion(version) {
  const normalized = String(version || "");
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(normalized) && normalized >= MCP_PROTOCOL_VERSION
  );
}

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
    } catch {
      // fall through to stdio
    }
  }
  return "stdio";
}

function mcpRpcError(payload = {}) {
  const error = new Error(payload.message || "Unknown MCP error");
  if (payload.code !== undefined) error.code = payload.code;
  if (payload.data !== undefined) error.data = payload.data;
  return error;
}

export function normalizeMcpElicitationRequest(
  serverName,
  requestId,
  params = {},
) {
  const mode = params.mode == null ? "form" : String(params.mode);
  const message = String(params.message || "").trim();
  if (!message) {
    const error = new Error("MCP elicitation requires a non-empty message");
    error.code = "CC_MCP_ELICITATION_INVALID";
    throw error;
  }
  const base = {
    ...params,
    mode,
    message,
    server: String(serverName),
    requestId,
  };
  if (mode === "form") return base;
  if (mode !== "url") {
    const error = new Error(`Unsupported MCP elicitation mode: ${mode}`);
    error.code = "CC_MCP_ELICITATION_INVALID";
    throw error;
  }

  const elicitationId = String(params.elicitationId || "").trim();
  if (!elicitationId) {
    const error = new Error("URL mode MCP elicitation requires elicitationId");
    error.code = "CC_MCP_ELICITATION_INVALID";
    throw error;
  }
  let target;
  try {
    target = new URL(String(params.url || ""));
  } catch {
    const error = new Error("URL mode MCP elicitation requires a valid URL");
    error.code = "CC_MCP_ELICITATION_INVALID";
    throw error;
  }
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    !target.hostname
  ) {
    const error = new Error(
      "URL mode MCP elicitation requires credential-free HTTPS",
    );
    error.code = "CC_MCP_ELICITATION_INVALID";
    throw error;
  }
  return {
    ...base,
    elicitationId,
    url: target.href,
    urlHost: target.host,
  };
}

/** True for transports that talk over HTTP(S) — i.e. use fetch. */
export function isHttpTransport(transportKind) {
  return (
    transportKind === "http" ||
    transportKind === "https" ||
    transportKind === "sse"
  );
}

/** True for MCP's bidirectional JSON-RPC-over-WebSocket transports. */
export function isWebSocketTransport(transportKind) {
  return transportKind === "ws" || transportKind === "wss";
}

export function redactMcpUrl(value) {
  try {
    const parsed = new URL(String(value));
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}

function mcpTransportError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.transport = details.transport || null;
  error.url = details.url ? redactMcpUrl(details.url) : null;
  if (details.status != null) error.status = details.status;
  if (details.closeCode != null) error.closeCode = details.closeCode;
  return error;
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
  return /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|network error|WebSocket|HTTP 40[134]\b|not connected|not found|not available/i.test(
    msg,
  );
}

export function isMcpAuthenticationError(err) {
  return (
    err?.status === 401 ||
    err?.status === 403 ||
    /\bHTTP\s*40[13]\b/i.test(String(err?.message || err || ""))
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
   * @param {string[]} [options.roots] workspace root directories exposed to
   *   servers via the MCP roots capability. Defaults to the process cwd.
   */
  constructor(options = {}) {
    super();
    this.servers = new Map(); // name → { process, state, tools, resources, config }
    this._nextId = 1;
    this._reconnectors = new Map(); // name → async () => config|null
    this._reconnecting = new Map(); // name → in-flight reconnect promise
    this._sessionId =
      options && options.sessionId != null ? String(options.sessionId) : null;
    this._workspaceBinding =
      options?.workspaceBinding || currentHostHooksV2WorkspaceBinding();
    // MCP roots capability (Claude-Code 2.1.203 parity): servers may ask the
    // client for its workspace roots (`roots/list`, a server→client request).
    // null = derive from process.cwd() at answer time.
    this._roots =
      options && Array.isArray(options.roots) && options.roots.length > 0
        ? options.roots.map(String)
        : null;
    // MCP elicitation (server -> client `elicitation/create`).  The handler is
    // intentionally injected by the host (REPL, headless, or Desktop bridge)
    // so the transport layer never reads stdin or invents an approval policy.
    this._elicitationHandler =
      typeof options.elicitationHandler === "function"
        ? options.elicitationHandler
        : null;
    this._elicitationHandlers = new Map();
    this._elicitationContext = new AsyncLocalStorage();
    this._elicitationTimeoutMs =
      Number(options.elicitationTimeoutMs) > 0
        ? Number(options.elicitationTimeoutMs)
        : 180000;
    this._pendingElicitations = new Map();
    this._urlElicitations = new Map();
    this._activeElicitations = 0;
    this._maxConcurrentElicitations =
      Number(options.maxConcurrentElicitations) > 0
        ? Math.min(128, Number(options.maxConcurrentElicitations))
        : 32;
    this._protocolVersion = String(
      options.protocolVersion || MCP_PROTOCOL_VERSION,
    );
    this._runtimeProducer = options.eventRuntimeStore
      ? new EventRuntimeProducer({
          store: options.eventRuntimeStore,
          emitter: this,
        })
      : null;
  }

  /** Install or clear the host-side MCP elicitation resolver. */
  setElicitationHandler(handler, options = {}) {
    const sessionId = options.sessionId;
    if (sessionId != null && sessionId !== "") {
      const key = String(sessionId);
      if (typeof handler === "function")
        this._elicitationHandlers.set(key, handler);
      else this._elicitationHandlers.delete(key);
    } else {
      this._elicitationHandler = typeof handler === "function" ? handler : null;
    }
    if (Number(options.timeoutMs) > 0) {
      this._elicitationTimeoutMs = Number(options.timeoutMs);
    }
    if (typeof handler === "function") {
      for (const name of this.servers.keys()) {
        this._ensureHttpMessageStream(name);
      }
    }
  }

  /** Run an async agent turn with a session-scoped elicitation route. */
  withElicitationContext(sessionId, fn) {
    if (typeof fn !== "function") return Promise.resolve(undefined);
    return this._elicitationContext.run(
      sessionId == null ? null : String(sessionId),
      fn,
    );
  }

  /** Remove a session route when a WS session is closed. */
  clearElicitationHandler(sessionId) {
    if (sessionId == null || sessionId === "") return false;
    return this._elicitationHandlers.delete(String(sessionId));
  }

  /** Resolve a pending server elicitation by its server/request id pair. */
  respondElicitation(serverName, requestId, response) {
    const key = this._elicitationKey(serverName, requestId);
    const pending = this._pendingElicitations.get(key);
    if (!pending) return false;
    const normalized = this._normalizeElicitationResponse(
      response,
      pending.request,
    );
    pending.resolve(normalized);
    try {
      this._runtimeProducer?.store.acknowledgeInbox(
        `mcp-elicitation:${this._elicitationKey(serverName, requestId)}`,
        { response: normalized },
      );
    } catch {
      // Runtime inbox acknowledgement is advisory.
    }
    return true;
  }

  /** Cancel a pending server elicitation. */
  cancelElicitation(serverName, requestId) {
    return this.respondElicitation(serverName, requestId, {
      action: "cancel",
    });
  }

  _elicitationKey(serverName, requestId) {
    return `${String(serverName)}:${String(requestId)}`;
  }

  _normalizeElicitationResponse(response, request = null) {
    const action = String(response?.action || "decline").toLowerCase();
    const safeAction = new Set(["accept", "decline", "cancel"]).has(action)
      ? action
      : "decline";
    const normalized = { action: safeAction };
    if (
      safeAction === "accept" &&
      request?.mode !== "url" &&
      response?.content !== undefined
    ) {
      normalized.content = response.content;
    }
    return normalized;
  }

  async _resolveElicitation(serverName, requestId, params = {}) {
    if (this._activeElicitations >= this._maxConcurrentElicitations) {
      const request = normalizeMcpElicitationRequest(
        serverName,
        requestId,
        params,
      );
      this.emit("elicitation-deferred", {
        ...request,
        reason: "capacity_exceeded",
        wireAction: "decline",
      });
      return { action: "decline" };
    }
    this._activeElicitations += 1;
    try {
      return await this._resolveElicitationWithin(
        serverName,
        requestId,
        params,
      );
    } finally {
      this._activeElicitations -= 1;
    }
  }

  async _resolveElicitationWithin(serverName, requestId, params = {}) {
    const key = this._elicitationKey(serverName, requestId);
    const request = normalizeMcpElicitationRequest(
      serverName,
      requestId,
      params,
    );
    const negotiatedVersion = this.servers.get(
      String(serverName),
    )?.protocolVersion;
    if (
      request.mode === "url" &&
      negotiatedVersion &&
      !supportsUrlElicitationVersion(negotiatedVersion)
    ) {
      const error = new Error(
        `URL elicitation is unavailable under MCP ${negotiatedVersion}`,
      );
      error.code = "CC_MCP_ELICITATION_INVALID";
      throw error;
    }
    if (request.mode === "url") this._rememberUrlElicitation(request);
    try {
      this._runtimeProducer?.publish(
        {
          type: "mcp_elicitation",
          server: serverName,
          requestId,
          params: request,
        },
        { origin: "mcp", id: `mcp-elicitation:${key}` },
      );
    } catch (error) {
      this.emit("elicitation-error", { server: serverName, requestId, error });
      this._settleUrlElicitation(request, { action: "cancel" });
      return { action: "cancel" };
    }
    const contextSessionId = this._elicitationContext.getStore();
    const handler =
      (contextSessionId && this._elicitationHandlers.get(contextSessionId)) ||
      this._elicitationHandler;
    if (handler) {
      try {
        const direct = await handler({
          ...request,
        });
        if (
          direct !== undefined &&
          String(direct?.action || "").toLowerCase() !== "defer"
        ) {
          const response = this._normalizeElicitationResponse(direct, request);
          this._settleUrlElicitation(request, response);
          try {
            this._runtimeProducer?.store.acknowledgeInbox(
              `mcp-elicitation:${key}`,
              { response },
            );
          } catch {
            // Runtime inbox acknowledgement is advisory.
          }
          return response;
        }
      } catch (error) {
        this.emit("elicitation-error", {
          server: serverName,
          requestId,
          error,
        });
        this._settleUrlElicitation(request, { action: "cancel" });
        return { action: "cancel" };
      }
    }

    // An event-driven host may answer later through respondElicitation().
    // No handler/listener means fail closed with decline rather than leaving a
    // server request hanging indefinitely.
    if (this.listenerCount("elicitation-request") === 0) {
      try {
        this._runtimeProducer?.store.acknowledgeInbox(
          `mcp-elicitation:${key}`,
          { response: { action: "decline" } },
        );
      } catch {
        // Runtime inbox acknowledgement is advisory.
      }
      this._settleUrlElicitation(request, { action: "decline" });
      this.emit("elicitation-deferred", {
        ...request,
        reason: "no_interactive_host",
        wireAction: "decline",
      });
      return { action: "decline" };
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this._pendingElicitations.delete(key);
        this.emit("elicitation-timeout", { server: serverName, requestId });
        this._settleUrlElicitation(request, { action: "cancel" });
        try {
          this._runtimeProducer?.store.fail(
            "inbox",
            `mcp-elicitation:${key}`,
            "elicitation timeout",
            { retryDelayMs: 0, maxAttempts: 1 },
          );
        } catch {
          // Runtime inbox timeout reporting is advisory.
        }
        resolve({ action: "cancel" });
      }, this._elicitationTimeoutMs);
      timeout.unref?.();
      this._pendingElicitations.set(key, {
        request,
        resolve: (response) => {
          clearTimeout(timeout);
          this._pendingElicitations.delete(key);
          const normalized = this._normalizeElicitationResponse(
            response,
            request,
          );
          this._settleUrlElicitation(request, normalized);
          resolve(normalized);
        },
      });
      this.emit("elicitation-request", {
        ...request,
        respond: (response) =>
          this.respondElicitation(serverName, requestId, response),
        cancel: () => this.cancelElicitation(serverName, requestId),
      });
    });
  }

  _rememberUrlElicitation(request) {
    const id = request?.elicitationId;
    if (!id) return;
    const existing = this._urlElicitations.get(id);
    if (existing && existing.server !== request.server) {
      throw new Error(`MCP URL elicitation id collision across servers: ${id}`);
    }
    if (existing && existing.request?.url !== request.url) {
      throw new Error(
        `MCP URL elicitation id reused with a different URL: ${id}`,
      );
    }
    if (!existing) {
      this._urlElicitations.set(id, {
        id,
        server: request.server,
        request,
        status: "pending",
        completionNotified: false,
        waiters: new Set(),
      });
      while (this._urlElicitations.size > 1000) {
        this._urlElicitations.delete(this._urlElicitations.keys().next().value);
      }
    }
  }

  _settleUrlElicitation(request, response) {
    if (request?.mode !== "url" || !request.elicitationId) return;
    const entry = this._urlElicitations.get(request.elicitationId);
    if (!entry || entry.status === "completed") return;
    entry.status =
      response?.action === "accept"
        ? "accepted"
        : response?.action || "decline";
    if (entry.status === "accepted" && entry.completionNotified) {
      this._completeUrlElicitation(entry);
    }
    if (entry.status !== "accepted") {
      for (const waiter of entry.waiters) waiter(false);
      entry.waiters.clear();
    }
    this.emit("elicitation-url-response", {
      server: request.server,
      elicitationId: request.elicitationId,
      action: response?.action || "decline",
      url: request.url,
      urlHost: request.urlHost,
    });
  }

  _handleElicitationComplete(serverName, params = {}) {
    const elicitationId = String(params.elicitationId || "");
    const entry = this._urlElicitations.get(elicitationId);
    if (!entry || entry.server !== String(serverName)) {
      return false;
    }
    if (entry.status === "completed") return false;
    if (entry.status === "pending") {
      // A fast out-of-band flow can finish while the host is still returning
      // its explicit consent result. Remember the notification, but do not
      // mark it complete until that consent has resolved to `accept`.
      entry.completionNotified = true;
      return true;
    }
    if (entry.status !== "accepted") return false;
    this._completeUrlElicitation(entry);
    return true;
  }

  _completeUrlElicitation(entry) {
    if (!entry || entry.status === "completed") return;
    entry.status = "completed";
    for (const waiter of entry.waiters) waiter(true);
    entry.waiters.clear();
    this.emit("elicitation-complete", {
      server: entry.server,
      elicitationId: entry.id,
    });
  }

  waitForElicitationCompletion(elicitationId, timeoutMs) {
    const entry = this._urlElicitations.get(String(elicitationId));
    if (!entry) return Promise.resolve(false);
    if (entry.status === "completed") return Promise.resolve(true);
    if (entry.status !== "accepted") return Promise.resolve(false);
    const waitMs =
      Number(timeoutMs) > 0 ? Number(timeoutMs) : this._elicitationTimeoutMs;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        entry.waiters.delete(finish);
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), waitMs);
      entry.waiters.add(finish);
    });
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
   * Current workspace roots in MCP wire shape (`file://` URIs). Falls back to
   * the process cwd when no explicit roots were configured, so every session
   * always advertises its working directory.
   * @returns {Array<{uri: string, name: string}>}
   */
  listRoots() {
    const dirs = this._roots || [process.cwd()];
    const roots = [];
    for (const dir of dirs) {
      try {
        roots.push({ uri: pathToFileURL(dir).href, name: dir });
      } catch {
        // An unconvertible path (bad injected value) is skipped, not fatal.
      }
    }
    return roots;
  }

  /**
   * Replace the advertised workspace roots and notify every connected server
   * (`notifications/roots/list_changed`) so it can re-query `roots/list`.
   * Call on working-directory changes (e.g. the REPL's /cd).
   * @param {string[]|null} dirs - absolute directories; null/[] = cwd default
   */
  setRoots(dirs) {
    const next =
      Array.isArray(dirs) && dirs.length > 0 ? dirs.map(String) : null;
    const changed = JSON.stringify(next) !== JSON.stringify(this._roots);
    this._roots = next;
    if (changed) this.notifyRootsListChanged();
  }

  /**
   * Broadcast `notifications/roots/list_changed` to every connected server.
   * Also for callers whose roots derive from process.cwd() (the default):
   * after a chdir the root LIST is different even though `_roots` (null =
   * "derive from cwd") did not change, so setRoots can't detect it.
   */
  notifyRootsListChanged() {
    for (const [name, entry] of this.servers) {
      if (entry.state !== ServerState.CONNECTED) continue;
      this._sendNotification(name, "notifications/roots/list_changed", {});
    }
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

  async _connectionHeaders(name, config, transportKind) {
    const staticHeaders = { ...(config?.headers || {}) };
    if (!config?.headersHelper) return staticHeaders;
    if (
      !isHttpTransport(transportKind) &&
      !isWebSocketTransport(transportKind)
    ) {
      const error = new Error(
        `MCP headersHelper is only supported by HTTP, SSE, and WebSocket servers (server "${name}")`,
      );
      error.code = "CC_MCP_HEADERS_HELPER_TRANSPORT_INVALID";
      throw error;
    }
    const context = _deps.resolveMcpHeadersHelperContext(
      {
        ...config,
        serverName: name,
      },
      this._workspaceBinding
        ? { currentWorkspaceBinding: () => this._workspaceBinding }
        : undefined,
    );
    const dynamicHeaders = await _deps.runMcpHeadersHelper({
      command: config.headersHelper,
      cwd: context.cwd,
      pluginRoot: context.pluginRoot,
      execution: context.execution,
      serverName: name,
      serverUrl: config.url,
    });
    return mergeMcpHeaders(staticHeaders, dynamicHeaders);
  }

  async _refreshConnectionHeaders(name, entry) {
    if (!entry?.config?.headersHelper) return entry?.httpHeaders || {};
    const headers = await this._connectionHeaders(
      name,
      entry.config,
      entry.transportKind,
    );
    entry.httpHeaders = headers;
    return headers;
  }

  /**
   * Connect to an MCP server. Routes to stdio or HTTP transport based on
   * `config.transport` / `config.url` (see `inferTransport`).
   *
   * @param {string} name - Server name
   * @param {object} config - { command?, args?, env?, url?, transport? }
   */
  async connect(name, config, _authRetryUsed = false) {
    if (this.servers.has(name)) {
      throw new Error(`Server "${name}" already connected`);
    }

    const transportKind = inferTransport(config);
    const sourceConfig = config;
    const connectionHeaders = await this._connectionHeaders(
      name,
      sourceConfig,
      transportKind,
    );
    config = { ...sourceConfig, headers: connectionHeaders };
    const entry = {
      // Keep the source config (static headers + helper command) so every
      // reconnect can execute the helper afresh instead of reusing credentials.
      config: sourceConfig,
      transportKind,
      state: ServerState.CONNECTING,
      process: null,
      socket: null,
      httpUrl: null,
      httpHeaders: connectionHeaders,
      httpSessionId: null,
      protocolVersion: null,
      _httpMessageStream: null,
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
      resourceSubscriptions: new Set(),
      _pending: new Map(),
      _buffer: "",
      // Per-connection streaming decoders so a multi-byte UTF-8 character (e.g.
      // a 3-byte Chinese char) split across two stdout/stderr chunks is
      // reassembled instead of corrupted into U+FFFD. Decoding each chunk
      // independently (data.toString("utf8")) would mangle a split character.
      _decoder: new TextDecoder("utf-8"),
      _stderrDecoder: new TextDecoder("utf-8"),
    };

    const rejectPending = (error) => {
      const cause =
        error instanceof Error
          ? error
          : new Error(String(error || "MCP transport closed"));
      for (const [, pending] of entry._pending) {
        if (pending.timeout) clearTimeout(pending.timeout);
        try {
          pending.reject(cause);
        } catch {
          // already settled
        }
      }
      entry._pending.clear();
    };
    entry._rejectPending = rejectPending;

    this.servers.set(name, entry);

    try {
      if (isHttpTransport(transportKind)) {
        if (!config.url) {
          throw new Error(`HTTP transport requires a url (server "${name}")`);
        }
        entry.httpUrl = config.url;
        entry.httpHeaders = connectionHeaders;
      } else if (isWebSocketTransport(transportKind)) {
        if (!config.url) {
          throw mcpTransportError(
            "CC_MCP_WS_URL_REQUIRED",
            `WebSocket transport requires a url (server "${name}")`,
            { transport: transportKind },
          );
        }
        let endpoint;
        try {
          endpoint = new URL(config.url);
        } catch {
          throw mcpTransportError(
            "CC_MCP_WS_INVALID_URL",
            `Invalid WebSocket URL for server "${name}": ${redactMcpUrl(config.url)}`,
            { transport: transportKind, url: config.url },
          );
        }
        if (endpoint.protocol !== `${transportKind}:`) {
          throw mcpTransportError(
            "CC_MCP_WS_SCHEME_MISMATCH",
            `MCP transport "${transportKind}" requires a ${transportKind}:// URL (server "${name}")`,
            { transport: transportKind, url: config.url },
          );
        }
        if (endpoint.username || endpoint.password) {
          throw mcpTransportError(
            "CC_MCP_WS_URL_CREDENTIALS_FORBIDDEN",
            `WebSocket credentials must use headers or OAuth (server "${name}")`,
            { transport: transportKind, url: config.url },
          );
        }

        const connectTimeoutMs = Number.isFinite(config.connectTimeoutMs)
          ? Math.max(1, config.connectTimeoutMs)
          : WEBSOCKET_CONNECT_TIMEOUT_MS;
        const maxPayload = Number.isFinite(config.maxPayloadBytes)
          ? Math.max(1024, config.maxPayloadBytes)
          : WEBSOCKET_MAX_PAYLOAD_BYTES;
        const Socket = _deps.WebSocket;
        const socket = new Socket(config.url, {
          headers: { ...(config.headers || {}) },
          handshakeTimeout: connectTimeoutMs,
          maxPayload,
          followRedirects: config.followRedirects === true,
          ...(transportKind === "wss" && config.rejectUnauthorized === false
            ? { rejectUnauthorized: false }
            : {}),
        });
        entry.socket = socket;

        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            socket.off("open", onOpen);
            socket.off("error", onError);
            socket.off("unexpected-response", onUnexpectedResponse);
            fn(value);
          };
          const onOpen = () => finish(resolve);
          const onError = (cause) =>
            finish(
              reject,
              mcpTransportError(
                "CC_MCP_WS_CONNECT_FAILED",
                `WebSocket connection failed for server "${name}": ${cause?.message || cause}`,
                { transport: transportKind, url: config.url },
              ),
            );
          const onUnexpectedResponse = (_request, response) =>
            finish(
              reject,
              mcpTransportError(
                "CC_MCP_WS_HANDSHAKE_REJECTED",
                `WebSocket handshake failed for server "${name}": HTTP ${response?.statusCode || "unknown"}`,
                {
                  transport: transportKind,
                  url: config.url,
                  status: response?.statusCode,
                },
              ),
            );
          socket.once("open", onOpen);
          socket.once("error", onError);
          socket.once("unexpected-response", onUnexpectedResponse);
        });

        socket.on("message", (data, isBinary) => {
          if (isBinary) {
            const error = mcpTransportError(
              "CC_MCP_WS_BINARY_MESSAGE",
              `MCP server "${name}" sent a binary WebSocket message; JSON text is required`,
              { transport: transportKind, url: config.url },
            );
            entry.state = ServerState.ERROR;
            rejectPending(error);
            this.emit("server-error", {
              name,
              error: error.message,
              code: error.code,
            });
            socket.close(1003, "JSON text required");
            return;
          }
          try {
            const message = JSON.parse(String(data));
            if (
              !message ||
              Array.isArray(message) ||
              typeof message !== "object"
            ) {
              throw new Error("expected one JSON-RPC object");
            }
            this._handleMessage(name, message);
          } catch (cause) {
            const error = mcpTransportError(
              "CC_MCP_WS_INVALID_MESSAGE",
              `Invalid WebSocket JSON-RPC message: ${cause?.message || cause}`,
              { transport: transportKind, url: config.url },
            );
            entry.state = ServerState.ERROR;
            rejectPending(error);
            this.emit("server-error", {
              name,
              code: error.code,
              error: error.message,
            });
            socket.close(1007, "Invalid JSON-RPC message");
          }
        });
        socket.on("close", (code, reason) => {
          entry.state = ServerState.DISCONNECTED;
          const suffix = reason?.length ? `: ${String(reason)}` : "";
          const error = mcpTransportError(
            "CC_MCP_WS_CLOSED",
            `MCP WebSocket server "${name}" disconnected (code ${code})${suffix}`,
            { transport: transportKind, url: config.url, closeCode: code },
          );
          rejectPending(error);
          this.emit("server-disconnected", {
            name,
            code,
            reason: String(reason || ""),
          });
        });
        socket.on("error", (cause) => {
          entry.state = ServerState.ERROR;
          const error = mcpTransportError(
            "CC_MCP_WS_ERROR",
            `MCP WebSocket server "${name}" error: ${cause?.message || cause}`,
            { transport: transportKind, url: config.url },
          );
          rejectPending(error);
          this.emit("server-error", {
            name,
            error: error.message,
            code: error.code,
          });
        });
      } else if (transportKind === "stdio") {
        if (!config.command) {
          throw new Error(
            `stdio transport requires a command (server "${name}")`,
          );
        }
        const isPlugin = config.origin === "plugin:mcp";
        const pluginWorkspaceRoot = isPlugin
          ? resolvePluginWorkspaceAuthority(config.pluginWorkspaceAuthority, {
              origin: config.origin,
              pluginId: config.pluginId,
              pluginVersion: config.pluginVersion,
              pluginSource: config.pluginSource,
            })
          : null;
        if (
          isPlugin &&
          config.sandboxPolicy?.requiredBoundaries?.length > 0 &&
          !pluginWorkspaceRoot
        ) {
          throw new Error(
            `plugin MCP server "${name}" is missing its trusted workspace authority`,
          );
        }
        const spawnOptions = {
          cwd: pluginWorkspaceRoot || process.cwd(),
          stdio: ["pipe", "pipe", "pipe"],
          // process.env < agent identity (CLAUDECODE / session id) < the
          // server's own config.env, so an explicit per-server override wins.
          env: {
            ...process.env,
            ...this._agentIdentityEnv(),
            ...(config.env || {}),
          },
          origin: config.origin || `mcp:server:${name}`,
          policy: config.policy || "allow",
          scope: config.scope || "mcp",
          shell: false,
          pluginId: config.pluginId,
          pluginVersion: config.pluginVersion,
          pluginSource: config.pluginSource,
          ...(config.sandboxPolicy
            ? { sandboxPolicy: config.sandboxPolicy }
            : {}),
        };
        const sandboxExecutionContract =
          !isPlugin || pluginWorkspaceRoot
            ? executionBroker.issueLinuxWorkspaceSandboxExecutionContract(
                config.command,
                config.args || [],
                spawnOptions,
                pluginWorkspaceRoot || process.cwd(),
              )
            : null;
        const proc = _deps.spawn(config.command, config.args || [], {
          ...spawnOptions,
          ...(sandboxExecutionContract ? { sandboxExecutionContract } : {}),
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
        protocolVersion: this._protocolVersion,
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          elicitation: supportsUrlElicitationVersion(this._protocolVersion)
            ? { form: {}, url: {} }
            : { form: {} },
          // Client-side roots capability: servers may request roots/list and
          // subscribe to list_changed notifications (Claude-Code 2.1.203).
          roots: { listChanged: true },
        },
        clientInfo: { name: "chainlesschain-cli", version: "0.37.9" },
      });

      entry.protocolVersion = String(
        initResult?.protocolVersion || this._protocolVersion,
      );
      // Send initialized notification
      this._sendNotification(name, "notifications/initialized", {});

      entry.state = ServerState.CONNECTED;
      entry.serverInfo = initResult?.serverInfo || {};
      entry.capabilities = initResult?.capabilities || {};
      // Optional top-level usage instructions from the server's initialize
      // response (previously discarded). Surfaced by tool search so a deferred
      // server's guidance still reaches the model on demand.
      entry.instructions =
        typeof initResult?.instructions === "string"
          ? initResult.instructions
          : null;

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

      // Resource templates are optional even when resources are supported.
      try {
        const templatesResult = await this._sendRequest(
          name,
          "resources/templates/list",
          {},
        );
        entry.resourceTemplates = templatesResult?.resourceTemplates || [];
      } catch {
        // Server may not support resource templates.
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
      if (
        entry.httpUrl &&
        (this._elicitationHandler || this._elicitationHandlers.size > 0)
      ) {
        this._ensureHttpMessageStream(name);
      }
      return {
        name,
        state: entry.state,
        tools: entry.tools,
        toolsError: entry.toolsError,
        resources: entry.resources,
        resourceTemplates: entry.resourceTemplates,
        prompts: entry.prompts,
        serverInfo: entry.serverInfo,
        instructions: entry.instructions,
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
      if (entry.socket) {
        try {
          entry.socket.removeAllListeners();
          // ws emits an asynchronous error when terminate() races a rejected
          // opening handshake. Keep a sink installed after removing the
          // connection listeners so teardown cannot become an uncaught error.
          entry.socket.on?.("error", () => {});
          entry.socket.terminate?.();
        } catch {
          // teardown is best-effort
        }
      }
      this.servers.delete(name);
      if (
        !_authRetryUsed &&
        sourceConfig.headersHelper &&
        isMcpAuthenticationError(err)
      ) {
        // A helper is intentionally uncached. One authentication rejection may
        // mean its short-lived token expired between generation and initialize;
        // execute it once more and retry the connection exactly once.
        return this.connect(name, sourceConfig, true);
      }
      throw err;
    }
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(name) {
    const entry = this.servers.get(name);
    if (!entry) return false;

    for (const [key, pending] of this._pendingElicitations) {
      if (key.startsWith(`${String(name)}:`)) {
        pending.resolve({ action: "cancel" });
      }
    }

    if (entry.process) {
      entry.process.kill();
    }
    if (entry.socket) {
      entry._rejectPending?.(
        mcpTransportError(
          "CC_MCP_WS_CLIENT_DISCONNECT",
          `MCP WebSocket server "${name}" disconnected by client`,
          { transport: entry.transportKind, url: entry.config?.url },
        ),
      );
      try {
        entry.socket.close(1000, "client disconnect");
      } catch {
        entry.socket.terminate?.();
      }
    }
    if (entry._httpMessageStream) {
      entry._httpMessageStream.stopped = true;
      entry._httpMessageStream.controller?.abort();
      entry._httpMessageStream.wake?.();
      entry._httpMessageStream = null;
    }
    // HTTP sessions: best-effort DELETE to free server-side state.
    if (entry.httpUrl && entry.httpSessionId) {
      try {
        await _deps.fetch(entry.httpUrl, {
          method: "DELETE",
          headers: {
            ...(entry.httpHeaders || {}),
            "Mcp-Session-Id": entry.httpSessionId,
            "MCP-Protocol-Version":
              entry.protocolVersion || this._protocolVersion,
          },
        });
      } catch {
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
        resourceTemplates: (entry.resourceTemplates || []).length,
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
        err?.code === URL_ELICITATION_REQUIRED &&
        (await this._resolveRequiredUrlElicitations(serverName, err))
      ) {
        // Retry exactly once after every out-of-band flow reports completion.
        return this._callToolOnce(serverName, toolName, args);
      }
      if (
        !this._reconnectors.has(serverName) &&
        !this.servers.get(serverName)?.config?.headersHelper
      ) {
        throw err;
      }
      if (!isLikelyConnectionError(err)) {
        throw err;
      }
      const reconnected = await this._tryReconnect(serverName, {
        // The high-level tool operation owns the one reconnect/retry budget.
        // Its reconnect initialize must not recursively mint another auth
        // retry when the refreshed credential is also rejected.
        connectAuthRetryUsed: true,
      });
      if (!reconnected) throw err;
      return await this._callToolOnce(serverName, toolName, args);
    }
  }

  async _resolveRequiredUrlElicitations(serverName, error) {
    const requested = Array.isArray(error?.data?.elicitations)
      ? error.data.elicitations
      : [];
    if (requested.length === 0 || requested.length > 16) return false;
    const normalized = [];
    const ids = new Set();
    for (const params of requested) {
      let request;
      try {
        request = normalizeMcpElicitationRequest(
          serverName,
          `url-required:${params?.elicitationId || normalized.length}`,
          params,
        );
      } catch {
        return false;
      }
      if (request.mode !== "url" || ids.has(request.elicitationId))
        return false;
      ids.add(request.elicitationId);
      normalized.push(request);
    }
    const accepted = [];
    for (const request of normalized) {
      const response = await this._resolveElicitation(
        serverName,
        request.requestId,
        request,
      );
      if (response.action !== "accept") return false;
      accepted.push(request);
    }
    const completed = await Promise.all(
      accepted.map((request) =>
        this.waitForElicitationCompletion(
          request.elicitationId,
          this._elicitationTimeoutMs,
        ),
      ),
    );
    return completed.every(Boolean);
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
  _tryReconnect(name, options = {}) {
    const inFlight = this._reconnecting.get(name);
    if (inFlight) return inFlight;
    const p = (async () => {
      try {
        const currentConfig = this.servers.get(name)?.config || null;
        const resolver = this._reconnectors.get(name);
        const fresh = resolver ? await resolver() : currentConfig;
        if (!fresh) return false;
        try {
          await this.disconnect(name);
        } catch {
          // entry may already be gone — connect() below is what matters
        }
        await this.connect(name, fresh, options.connectAuthRetryUsed === true);
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

  /** List optional URI templates advertised by one server or all servers. */
  listResourceTemplates(serverName) {
    if (serverName) {
      const entry = this.servers.get(serverName);
      if (!entry) throw new Error(`Server "${serverName}" not found`);
      return (entry.resourceTemplates || []).map((template) => ({
        ...template,
        server: serverName,
      }));
    }
    const all = [];
    for (const [name, entry] of this.servers) {
      for (const template of entry.resourceTemplates || []) {
        all.push({ ...template, server: name });
      }
    }
    return all;
  }

  /** Subscribe to change notifications for a concrete resource URI. */
  async subscribeResource(serverName, uri) {
    const entry = this.servers.get(serverName);
    if (!entry) throw new Error(`Server "${serverName}" not found`);
    await this._sendRequest(serverName, "resources/subscribe", { uri });
    entry.resourceSubscriptions ||= new Set();
    entry.resourceSubscriptions.add(String(uri));
    return true;
  }

  /** Remove a previously established resource subscription. */
  async unsubscribeResource(serverName, uri) {
    const entry = this.servers.get(serverName);
    if (!entry) throw new Error(`Server "${serverName}" not found`);
    await this._sendRequest(serverName, "resources/unsubscribe", { uri });
    entry.resourceSubscriptions?.delete(String(uri));
    return true;
  }

  /** Set the optional server-to-client logging verbosity. */
  async setLoggingLevel(serverName, level) {
    const normalized = String(level || "").toLowerCase();
    const levels = new Set([
      "debug",
      "info",
      "notice",
      "warning",
      "error",
      "critical",
      "alert",
      "emergency",
    ]);
    if (!levels.has(normalized)) {
      throw new Error(`Invalid MCP logging level: ${level}`);
    }
    await this._sendRequest(serverName, "logging/setLevel", {
      level: normalized,
    });
    return normalized;
  }

  /** Ask a server for optional argument/ref completion candidates. */
  async complete(serverName, ref, argument, context = undefined) {
    const params = { ref, argument };
    if (context !== undefined) params.context = context;
    return this._sendRequest(serverName, "completion/complete", params);
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

    if (entry.socket) {
      return this._sendWebSocketRequest(serverName, method, params);
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

      // Per-call timeout — honour the same config knobs as the HTTP path so the
      // two transports behave consistently: `longRunning` servers (a tool that
      // blocks on human input / a long computation) are exempt, and
      // `requestTimeoutMs` overrides the 30s default (0 disables). Previously
      // this was a hard 30s that silently killed a long-running stdio request
      // even when the server was configured otherwise. When no timer is armed
      // the pending entry simply has no `.timeout`; every consumer
      // (_handleMessage / failPending / buffer-overflow drain) already tolerates
      // an absent timeout.
      const longRunning = Boolean(entry.config && entry.config.longRunning);
      const timeoutMs = Number.isFinite(entry.config?.requestTimeoutMs)
        ? entry.config.requestTimeoutMs
        : STDIO_REQUEST_TIMEOUT_MS;
      let timeout = null;
      if (!longRunning && timeoutMs > 0) {
        timeout = setTimeout(() => {
          if (!entry._pending.delete(id)) return;
          const timeoutError = new Error(`Request timeout: ${method}`);
          this._sendTimeoutCancellation(
            serverName,
            method,
            id,
            timeoutError.message,
          );
          reject(timeoutError);
        }, timeoutMs);
        entry._pending.get(id).timeout = timeout;
      }

      try {
        entry.process.stdin.write(message + "\n");
      } catch (err) {
        clearTimeout(timeout); // clearTimeout(null) is a safe no-op
        entry._pending.delete(id);
        reject(err);
      }
    });
  }

  _sendWebSocketRequest(serverName, method, params) {
    const entry = this.servers.get(serverName);
    if (!entry?.socket || entry.socket.readyState !== 1) {
      return Promise.reject(
        mcpTransportError(
          "CC_MCP_WS_NOT_CONNECTED",
          `MCP WebSocket server "${serverName}" is not connected`,
          { transport: entry?.transportKind, url: entry?.config?.url },
        ),
      );
    }

    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      const longRunning = Boolean(entry.config?.longRunning);
      const timeoutMs = Number.isFinite(entry.config?.requestTimeoutMs)
        ? entry.config.requestTimeoutMs
        : STDIO_REQUEST_TIMEOUT_MS;
      let timeout = null;
      if (!longRunning && timeoutMs > 0) {
        timeout = setTimeout(() => {
          if (!entry._pending.delete(id)) return;
          const timeoutError = mcpTransportError(
            "CC_MCP_WS_REQUEST_TIMEOUT",
            `Request timeout: ${method} (WebSocket, no response in ${timeoutMs}ms)`,
            { transport: entry.transportKind, url: entry.config?.url },
          );
          this._sendTimeoutCancellation(
            serverName,
            method,
            id,
            timeoutError.message,
          );
          reject(timeoutError);
        }, timeoutMs);
      }
      entry._pending.set(id, { resolve, reject, timeout });
      entry.socket.send(message, (cause) => {
        if (!cause) return;
        if (timeout) clearTimeout(timeout);
        entry._pending.delete(id);
        reject(
          mcpTransportError(
            "CC_MCP_WS_SEND_FAILED",
            `WebSocket send failed for ${method}: ${cause.message}`,
            { transport: entry.transportKind, url: entry.config?.url },
          ),
        );
      });
    });
  }

  _sendTimeoutCancellation(serverName, method, requestId, reason) {
    // The initialize handshake establishes the protocol/session needed for
    // later notifications, so it cannot itself be cancelled safely.
    if (method === "initialize") return;
    try {
      this._sendNotification(serverName, "notifications/cancelled", {
        requestId,
        reason,
      });
    } catch {
      // Cancellation is best-effort and must never replace the timeout error.
    }
  }

  _sendNotification(serverName, method, params) {
    const entry = this.servers.get(serverName);
    if (!entry) return;

    if (entry.httpUrl) {
      // Fire-and-forget HTTP notification (no id, no response expected).
      this._sendHttpNotification(serverName, method, params);
      return;
    }

    if (entry.socket) {
      if (entry.socket.readyState === 1) {
        entry.socket.send(
          JSON.stringify({ jsonrpc: "2.0", method, params }),
          () => {},
        );
      }
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
   * Open the optional Streamable HTTP GET/SSE channel used for asynchronous
   * server requests and notifications. Interactive hosts enable it when they
   * install an elicitation handler; stdio already has a bidirectional stream.
   */
  _ensureHttpMessageStream(serverName) {
    const entry = this.servers.get(serverName);
    if (
      !entry?.httpUrl ||
      entry.state !== ServerState.CONNECTED ||
      entry._httpMessageStream
    ) {
      return false;
    }
    const stream = {
      stopped: false,
      controller: null,
      lastEventId: null,
      retryMs: 1000,
      authFailures: 0,
      wake: null,
      promise: null,
    };
    entry._httpMessageStream = stream;
    stream.promise = (async () => {
      try {
        while (!stream.stopped && this.servers.get(serverName) === entry) {
          stream.controller =
            typeof AbortController === "function"
              ? new AbortController()
              : null;
          try {
            const resolvedHeaders = entry.config?.headersHelper
              ? await this._refreshConnectionHeaders(serverName, entry)
              : entry.httpHeaders || {};
            const headers = {
              Accept: "text/event-stream",
              ...resolvedHeaders,
              ...(entry.httpSessionId
                ? { "Mcp-Session-Id": entry.httpSessionId }
                : {}),
              "MCP-Protocol-Version":
                entry.protocolVersion || this._protocolVersion,
              ...(stream.lastEventId
                ? { "Last-Event-ID": stream.lastEventId }
                : {}),
            };
            const response = await _deps.fetch(entry.httpUrl, {
              method: "GET",
              headers,
              ...(stream.controller
                ? { signal: stream.controller.signal }
                : {}),
            });
            if (response.status === 405) {
              _cancelHttpResponseBody(response);
              return;
            }
            if (response.status === 401 || response.status === 403) {
              _cancelHttpResponseBody(response);
              if (entry.config?.headersHelper && stream.authFailures === 0) {
                stream.authFailures = 1;
                continue;
              }
              this.emit("server-stream-error", {
                name: serverName,
                code: "CC_MCP_AUTH_RETRY_EXHAUSTED",
                error: `MCP HTTP message stream authentication failed (HTTP ${response.status})`,
              });
              return;
            }
            if (!response.ok) {
              _cancelHttpResponseBody(response);
              throw new Error(
                `MCP HTTP message stream returned ${response.status}`,
              );
            }
            stream.authFailures = 0;
            const contentType = response.headers?.get
              ? String(response.headers.get("content-type") || "").toLowerCase()
              : "";
            if (!contentType.includes("text/event-stream")) {
              _cancelHttpResponseBody(response);
              return;
            }
            const cap = _httpResponseByteLimit(entry.config?.maxBufferChars);
            await _consumeSseMessageStream(response, {
              cap,
              stream,
              onMessage: (message) => this._handleMessage(serverName, message),
            });
          } catch (error) {
            if (stream.stopped || stream.controller?.signal.aborted) return;
            this.emit("server-stream-error", {
              name: serverName,
              error: error?.message || String(error),
              ...(error?.code ? { code: error.code } : {}),
              ...(error?.limitBytes != null
                ? { limitBytes: error.limitBytes }
                : {}),
            });
            if (error?.code === "CC_MCP_HTTP_RESPONSE_TOO_LARGE") return;
            if (String(error?.code || "").startsWith("CC_MCP_HEADERS_HELPER")) {
              return;
            }
          } finally {
            stream.controller = null;
          }
          if (stream.stopped) return;
          await new Promise((resolve) => {
            const delay = Math.max(
              50,
              Math.min(30000, Number(stream.retryMs) || 1000),
            );
            const timer = setTimeout(resolve, delay);
            stream.wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          stream.wake = null;
        }
      } finally {
        if (entry._httpMessageStream === stream) {
          entry._httpMessageStream = null;
        }
      }
    })();
    stream.promise.catch(() => {});
    return true;
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
    if (method !== "initialize") {
      headers["MCP-Protocol-Version"] =
        entry.protocolVersion || this._protocolVersion;
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
    const timeoutMessage = `Request timeout: ${method} (HTTP, no response in ${timeoutMs}ms)`;
    if (
      !longRunning &&
      timeoutMs > 0 &&
      typeof AbortController === "function"
    ) {
      controller = new AbortController();
      timer = setTimeout(() => {
        controller.abort();
        this._sendTimeoutCancellation(serverName, method, id, timeoutMessage);
      }, timeoutMs);
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

      // This is a host-owned absolute byte limit. maxBufferChars remains a
      // backwards-compatible way to request a smaller HTTP body limit, but 0
      // no longer disables the HTTP ceiling (stdio retains its old semantics).
      const cap = _httpResponseByteLimit(entry.config?.maxBufferChars);

      if (!response.ok) {
        // Authentication bodies frequently echo token/debug material. When a
        // dynamic helper is configured, any error body may reflect its opaque
        // header values; structured HTTP status is sufficient and cannot leak
        // freshly generated credentials into logs or exceptions.
        const suppressBody =
          Boolean(entry.config?.headersHelper) ||
          response.status === 401 ||
          response.status === 403;
        if (suppressBody) _cancelHttpResponseBody(response);
        const text = suppressBody
          ? ""
          : await _readHttpErrorBodyPreview(response, cap);
        const detail = text ? `: ${text.slice(0, 200)}` : "";
        // 404 usually means a wrong/stale server URL — name it and point at the
        // MCP config (Claude-Code 2.1.191: "HTTP 404 errors now show the URL and
        // point to your MCP config") instead of a bare "HTTP 404".
        if (response.status === 404) {
          throw mcpTransportError(
            "CC_MCP_HTTP_STATUS",
            `HTTP 404${detail} — ${redactMcpUrl(entry.httpUrl)} returned Not Found; check this server's "url" in your MCP config`,
            {
              transport: entry.transportKind,
              url: entry.config?.url,
              status: response.status,
            },
          );
        }
        throw mcpTransportError(
          "CC_MCP_HTTP_STATUS",
          `HTTP ${response.status}${detail}`,
          {
            transport: entry.transportKind,
            url: entry.config?.url,
            status: response.status,
          },
        );
      }

      const contentType = response.headers?.get
        ? String(response.headers.get("content-type") || "").toLowerCase()
        : "";
      let envelope;
      if (contentType.includes("text/event-stream")) {
        envelope = await _extractSseResponse(response, id, cap, (message) =>
          this._handleMessage(serverName, message),
        );
      } else {
        const text = await _readBodyCapped(response, cap);
        envelope = text ? JSON.parse(text) : null;
      }

      if (!envelope || typeof envelope !== "object") {
        throw new Error("Empty or invalid JSON-RPC response");
      }
      if (envelope.error) {
        throw mcpRpcError(envelope.error);
      }
      return envelope.result;
    } catch (err) {
      if (controller && controller.signal.aborted) {
        throw new Error(timeoutMessage);
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
    headers["MCP-Protocol-Version"] =
      entry.protocolVersion || this._protocolVersion;
    try {
      const p = _deps.fetch(entry.httpUrl, {
        method: "POST",
        headers,
        body,
      });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
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
        reject(mcpRpcError(msg.error));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Server → client REQUEST (has both an id and a method, and the id is not
    // one of ours). Previously these fell into the notification branch and
    // never got a response, so a server calling e.g. roots/list hung until its
    // own timeout. Answer the ones our advertised capabilities invite.
    if (msg.id !== undefined && msg.method) {
      this._handleServerRequest(serverName, msg);
      return;
    }

    // Server notification
    if (msg.method) {
      // tools/resources list_changed (gap 2026-07-11 MCP 生命周期): refetch
      // the changed list so entry.tools/entry.resources stay live —
      // `listTools()`, `/mcp` status and callTool routing all see the update.
      // (The LLM tool array of an in-flight turn is deliberately NOT mutated:
      // tool-search's prompt-cache stability depends on an append-only,
      // stable-prefix tool list.)
      if (msg.method === "notifications/tools/list_changed") {
        this._refreshServerList(serverName, "tools");
      } else if (msg.method === "notifications/resources/list_changed") {
        this._refreshServerList(serverName, "resources");
        this._refreshServerList(serverName, "resourceTemplates");
      } else if (msg.method === "notifications/resources/updated") {
        this.emit("resource-updated", {
          server: serverName,
          uri: msg.params?.uri || null,
          params: msg.params || {},
        });
      } else if (msg.method === "notifications/message") {
        this.emit("log-message", {
          server: serverName,
          level: msg.params?.level || "info",
          logger: msg.params?.logger || null,
          data: msg.params?.data,
        });
      } else if (msg.method === "notifications/elicitation/complete") {
        this._handleElicitationComplete(serverName, msg.params || {});
      }
      this.emit("notification", {
        server: serverName,
        method: msg.method,
        params: msg.params,
      });
    }
  }

  /**
   * Re-fetch a server's tools / resources list after a `*_list_changed`
   * notification. Coalesced per server+kind: a burst of notifications folds
   * into the in-flight refetch plus at most one trailing pass. Best-effort —
   * a failed refetch keeps the previous list and waits for the next
   * notification. Emits "tools-changed" / "resources-changed" on update.
   */
  async _refreshServerList(serverName, kind) {
    const entry = this.servers.get(serverName);
    if (!entry) return;
    const flags = (entry._listRefresh = entry._listRefresh || {});
    if (flags[`${kind}Running`]) {
      flags[`${kind}Dirty`] = true;
      return;
    }
    flags[`${kind}Running`] = true;
    try {
      do {
        flags[`${kind}Dirty`] = false;
        try {
          const method =
            kind === "tools"
              ? "tools/list"
              : kind === "resourceTemplates"
                ? "resources/templates/list"
                : "resources/list";
          const result = await this._sendRequest(serverName, method, {});
          const list =
            (kind === "tools"
              ? result?.tools
              : kind === "resourceTemplates"
                ? result?.resourceTemplates
                : result?.resources) || [];
          entry[kind] = list;
          if (kind === "tools") entry.toolsError = null;
          this.emit(`${kind}-changed`, {
            server: serverName,
            count: list.length,
          });
        } catch {
          break; // keep the previous list; the next notification retries
        }
      } while (flags[`${kind}Dirty`]);
    } finally {
      flags[`${kind}Running`] = false;
    }
  }

  /**
   * Answer a server-initiated JSON-RPC request. `roots/list` returns the
   * session's workspace roots (we advertise the roots capability); `ping`
   * gets an empty ack per spec. Anything else is answered with a JSON-RPC
   * method-not-found error instead of silence, so the server fails fast.
   */
  _handleServerRequest(serverName, msg) {
    const { id, method } = msg;
    if (method === "roots/list") {
      this._sendResponse(serverName, id, { roots: this.listRoots() });
      return;
    }
    if (method === "ping") {
      this._sendResponse(serverName, id, {});
      return;
    }
    if (method === "elicitation/create") {
      this._resolveElicitation(serverName, id, msg.params || {})
        .then((response) => this._sendResponse(serverName, id, response))
        .catch((error) =>
          this._sendResponse(serverName, id, undefined, {
            code: -32602,
            message: error?.message || "invalid elicitation request",
          }),
        );
      return;
    }
    this._sendResponse(serverName, id, undefined, {
      code: -32601,
      message: `method not found: ${method}`,
    });
  }

  /** Write a JSON-RPC response back over stdio or Streamable HTTP POST. */
  _sendResponse(serverName, id, result, error) {
    const entry = this.servers.get(serverName);
    if (!entry) return;
    const envelope =
      error !== undefined
        ? { jsonrpc: "2.0", id, error }
        : { jsonrpc: "2.0", id, result };
    if (entry.httpUrl) {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(entry.httpHeaders || {}),
        ...(entry.httpSessionId
          ? { "Mcp-Session-Id": entry.httpSessionId }
          : {}),
        "MCP-Protocol-Version": entry.protocolVersion || this._protocolVersion,
      };
      try {
        const pending = _deps.fetch(entry.httpUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(envelope),
        });
        pending?.catch?.((cause) =>
          this.emit("server-stream-error", {
            name: serverName,
            error: cause?.message || String(cause),
          }),
        );
      } catch (cause) {
        this.emit("server-stream-error", {
          name: serverName,
          error: cause?.message || String(cause),
        });
      }
      return;
    }
    if (entry.socket) {
      if (entry.socket.readyState === 1) {
        entry.socket.send(JSON.stringify(envelope), () => {});
      }
      return;
    }
    if (!entry.process) return;
    const message = JSON.stringify(envelope);
    try {
      entry.process.stdin.write(message + "\n");
    } catch {
      // Ignore response write errors (server may have just exited)
    }
  }
}

function _httpResponseByteLimit(configuredLimit) {
  if (Number.isFinite(configuredLimit) && configuredLimit > 0) {
    return Math.min(
      MCP_HTTP_RESPONSE_MAX_BYTES,
      Math.max(1, Math.floor(configuredLimit)),
    );
  }
  return MCP_HTTP_RESPONSE_MAX_BYTES;
}

function _cancelHttpResponseBody(response) {
  try {
    const pending = response?.body?.cancel?.();
    pending?.catch?.(() => {});
  } catch {
    // Best-effort cleanup; callers still surface the bounded status/size error.
  }
}

function _httpResponseTooLarge(cap, detail) {
  const error = new Error(
    `MCP HTTP response exceeded the ${cap}-byte cap${detail ? ` (${detail})` : ""}`,
  );
  error.code = "CC_MCP_HTTP_RESPONSE_TOO_LARGE";
  error.limitBytes = cap;
  return error;
}

/**
 * Read a finite HTTP response body to text under a host-owned absolute byte
 * ceiling. The per-call timeout bounds TIME but not MEMORY: a malicious or
 * buggy MCP server could otherwise stream a multi-GB success or error body
 * within the timeout and OOM the client. Real fetch responses are accumulated
 * only after a running byte check and their reader is cancelled on overflow.
 * Response-like test doubles without a readable body retain a text() fallback,
 * which is checked by UTF-8 byte length immediately after that mock resolves.
 * A declared Content-Length over the effective cap is rejected before any read.
 */
async function _readBodyCapped(response, cap) {
  cap = _httpResponseByteLimit(cap);
  if (response.headers && typeof response.headers.get === "function") {
    const declaredHeader = response.headers.get("content-length");
    if (/^\d+$/.test(String(declaredHeader || "").trim())) {
      const declared = BigInt(String(declaredHeader).trim());
      if (declared > BigInt(cap)) {
        _cancelHttpResponseBody(response);
        throw _httpResponseTooLarge(
          cap,
          `content-length ${String(declaredHeader).trim()}`,
        );
      }
    }
  }
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value?.byteLength || 0;
        if (total > cap) {
          try {
            await reader.cancel();
          } catch {
            /* best-effort — the throw below is what matters */
          }
          throw _httpResponseTooLarge(cap, "runaway server");
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // Best-effort cleanup; preserve the original read/limit error.
      }
      throw error;
    } finally {
      try {
        reader.releaseLock?.();
      } catch {
        // The reader may already be detached after cancellation.
      }
    }
  }
  if (typeof response.text !== "function") {
    throw new Error("HTTP response is not readable");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > cap) {
    throw _httpResponseTooLarge(cap, "response-like fallback");
  }
  return text;
}

/** Read only the bounded diagnostic prefix of an HTTP error response. */
async function _readHttpErrorBodyPreview(response, responseCap) {
  const cap = Math.min(
    _httpResponseByteLimit(responseCap),
    MCP_HTTP_ERROR_PREVIEW_MAX_BYTES,
  );
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const bytes = value?.byteLength || 0;
        const remaining = cap - total;
        if (bytes >= remaining) {
          if (remaining > 0) {
            chunks.push(
              decoder.decode(value.subarray(0, remaining), { stream: true }),
            );
          }
          try {
            await reader.cancel();
          } catch {
            // Best-effort cancellation; the preview is already bounded.
          }
          break;
        }
        total += bytes;
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // Best-effort cleanup; preserve the original preview read error.
      }
      throw error;
    } finally {
      try {
        reader.releaseLock?.();
      } catch {
        // The reader may already be detached after cancellation.
      }
    }
  }
  if (typeof response.text !== "function") return "";
  // This compatibility branch exists for Response-like test doubles only.
  // Unlike a real fetch ReadableStream, text() cannot be stopped mid-read, so
  // its UTF-8 byte bound is necessarily enforced immediately after resolution.
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") <= cap) return text;
  return Buffer.from(text, "utf8").subarray(0, cap).toString("utf8");
}

/**
 * Parse a `text/event-stream` HTTP response body and return the first
 * JSON-RPC envelope whose id matches `requestId`. Tolerates multiple
 * `data:` chunks, comments, and non-JSON-RPC events. `cap` bounds the body
 * size (see _readBodyCapped).
 */
async function _extractSseResponse(
  response,
  requestId,
  cap = 0,
  onMessage = null,
) {
  const text = await _readBodyCapped(response, cap);

  // Split into events on blank line, parse each event's concatenated `data:` lines.
  const events = text.split(/\r?\n\r?\n/);
  for (const event of events) {
    const parsed = _parseSseEvent(event);
    if (!parsed?.message) continue;
    const payload = parsed.message;
    if (payload.jsonrpc === "2.0" && payload.id === requestId) {
      return payload;
    }
    onMessage?.(payload);
  }
  throw new Error(`SSE stream ended without a response for id ${requestId}`);
}

function _parseSseEvent(event) {
  const dataLines = [];
  let id = null;
  let retry = null;
  for (const line of String(event || "").split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    } else if (line.startsWith("id:")) {
      id = line.slice(3).replace(/^ /, "");
    } else if (line.startsWith("retry:")) {
      const value = Number(line.slice(6).trim());
      if (Number.isFinite(value) && value >= 0) retry = value;
    }
  }
  let message = null;
  if (dataLines.some((line) => line.length > 0)) {
    try {
      const candidate = JSON.parse(dataLines.join("\n"));
      if (candidate && typeof candidate === "object") message = candidate;
    } catch {
      // Non-JSON SSE events are transport metadata, not MCP messages.
    }
  }
  return { id, retry, message };
}

async function _consumeSseMessageStream(
  response,
  { cap = 0, stream, onMessage },
) {
  cap = _httpResponseByteLimit(cap);
  const dispatch = (rawEvent) => {
    if (Buffer.byteLength(String(rawEvent || ""), "utf8") > cap) {
      throw _httpResponseTooLarge(cap, "SSE event");
    }
    const parsed = _parseSseEvent(rawEvent);
    if (parsed.id != null && parsed.id !== "") {
      stream.lastEventId = parsed.id;
    }
    if (parsed.retry != null) stream.retryMs = parsed.retry;
    if (parsed.message) onMessage(parsed.message);
  };

  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await _readBodyCapped(response, cap);
    for (const event of text.split(/\r?\n\r?\n/)) dispatch(event);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const separator = buffer.match(/\r?\n\r?\n/)[0];
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + separator.length);
        dispatch(event);
      }
      if (Buffer.byteLength(buffer, "utf8") > cap) {
        throw _httpResponseTooLarge(cap, "unterminated SSE event");
      }
    }
    buffer += decoder.decode();
    if (Buffer.byteLength(buffer, "utf8") > cap) {
      throw _httpResponseTooLarge(cap, "unterminated SSE event");
    }
    if (buffer.trim()) dispatch(buffer);
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Best-effort cleanup; the bounded stream error remains authoritative.
    }
    throw error;
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      // Best-effort cleanup; abort/disconnect owns cancellation.
    }
  }
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
        headers TEXT DEFAULT '{}',
        headers_helper TEXT,
        config_scope TEXT DEFAULT 'user',
        config_source TEXT,
        project_path TEXT,
        display_name TEXT,
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
      if (!cols.has("headers")) {
        this.db.exec(
          "ALTER TABLE mcp_servers ADD COLUMN headers TEXT DEFAULT '{}'",
        );
      }
      if (!cols.has("headers_helper")) {
        this.db.exec("ALTER TABLE mcp_servers ADD COLUMN headers_helper TEXT");
      }
      if (!cols.has("config_scope")) {
        this.db.exec(
          "ALTER TABLE mcp_servers ADD COLUMN config_scope TEXT DEFAULT 'user'",
        );
      }
      if (!cols.has("config_source")) {
        this.db.exec("ALTER TABLE mcp_servers ADD COLUMN config_source TEXT");
      }
      if (!cols.has("project_path")) {
        this.db.exec("ALTER TABLE mcp_servers ADD COLUMN project_path TEXT");
      }
      if (!cols.has("display_name")) {
        this.db.exec("ALTER TABLE mcp_servers ADD COLUMN display_name TEXT");
      }
    } catch {
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
    const configScope = normalizeMcpConfigScope(config.configScope || "user");
    if (configScope === "managed" && config.allowManagedWrite !== true) {
      throw new Error(
        "Managed MCP configuration is read-only; provision it through managed settings",
      );
    }
    const projectPath =
      configScope === "local" || configScope === "project"
        ? String(config.projectPath || process.cwd())
        : null;
    const configSource =
      config.configSource ||
      (configScope === "managed"
        ? "managed-settings"
        : configScope === "user"
          ? "user-database"
          : `${configScope}:${projectPath}`);
    const headersHelper =
      typeof config.headersHelper === "string" && config.headersHelper.trim()
        ? config.headersHelper
        : null;
    // The legacy table uses `name` as its primary key. Encode workspace-bound
    // identities in that key so `foo` can coexist at local/project/user scope
    // while retaining the old key for user rows and backwards compatibility.
    const storageName =
      configScope === "user"
        ? name
        : `${configScope}:${Buffer.from(projectPath || "managed", "utf8").toString("base64url")}:${name}`;
    this.db
      .prepare(
        "INSERT OR REPLACE INTO mcp_servers (name, command, args, env, auto_connect, url, transport, headers, headers_helper, config_scope, config_source, project_path, display_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
      )
      .run(
        storageName,
        config.command || null,
        JSON.stringify(config.args || []),
        JSON.stringify(config.env || {}),
        config.autoConnect ? 1 : 0,
        url,
        transport,
        JSON.stringify(config.headers || {}),
        headersHelper,
        configScope,
        configSource,
        projectPath,
        name,
      );
  }

  remove(name, options = {}) {
    const current = this.get(name, options);
    if (!current) return false;
    if (
      options.scope &&
      current.configScope !== normalizeMcpConfigScope(options.scope)
    ) {
      return false;
    }
    if (
      current.configScope === "managed" &&
      options.allowManagedWrite !== true
    ) {
      throw new Error(
        "Managed MCP configuration is read-only; change the managed settings source",
      );
    }
    const result = this.db
      .prepare("DELETE FROM mcp_servers WHERE name = ?")
      .run(current._storageName || name);
    return result.changes > 0;
  }

  _rowToConfig(row) {
    const config = {
      name: row.display_name || row.name,
      command: row.command || null,
      // safeJsonParse, not bare JSON.parse: list()/getAutoConnect() map every
      // row through here, so one corrupt cell must not take down the whole
      // MCP server list (`|| "[]"` only guards NULL, not a corrupt non-empty string).
      args: safeJsonParse(row.args, []),
      env: safeJsonParse(row.env, {}),
      autoConnect: row.auto_connect === 1,
      url: row.url || null,
      transport:
        row.transport || (row.url ? inferTransport({ url: row.url }) : "stdio"),
      headers: safeJsonParse(row.headers, {}),
      ...(typeof row.headers_helper === "string" && row.headers_helper.trim()
        ? { headersHelper: row.headers_helper }
        : {}),
      configScope: normalizeMcpConfigScope(row.config_scope || "user"),
      configSource:
        row.config_source ||
        (row.config_scope === "managed"
          ? "managed-settings"
          : "legacy-database"),
      projectPath: row.project_path || null,
    };
    Object.defineProperty(config, "_storageName", {
      value: row.name,
      enumerable: false,
    });
    return config;
  }

  get(name, options = {}) {
    return this.list(options).find((config) => config.name === name) || null;
  }

  list(options = {}) {
    const rows = this.db
      .prepare("SELECT * FROM mcp_servers ORDER BY name")
      .all();
    const visible = rows
      .map((row) => this._rowToConfig(row))
      .filter((config) => this._isVisible(config, options));
    return options.allScopes === true || options.scope
      ? visible
      : this._effectiveByName(visible);
  }

  getAutoConnect(options = {}) {
    const rows = this.db
      .prepare("SELECT * FROM mcp_servers WHERE auto_connect = ? ORDER BY name")
      .all(1);
    const visible = rows
      .map((row) => this._rowToConfig(row))
      .filter((config) => this._isVisible(config, options));
    return options.allScopes === true || options.scope
      ? visible
      : this._effectiveByName(visible);
  }

  _effectiveByName(configs) {
    const priority = { managed: 4, local: 3, project: 2, user: 1 };
    const selected = new Map();
    for (const config of configs) {
      const current = selected.get(config.name);
      if (
        !current ||
        (priority[config.configScope] || 0) >
          (priority[current.configScope] || 0)
      ) {
        selected.set(config.name, config);
      }
    }
    return [...selected.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  _isVisible(config, options = {}) {
    if (
      options.scope &&
      config.configScope !== normalizeMcpConfigScope(options.scope)
    ) {
      return false;
    }
    if (options.allScopes === true) return true;
    if (config.configScope !== "local" && config.configScope !== "project") {
      return true;
    }
    if (!config.projectPath) return false;
    const cwd = String(options.cwd || process.cwd());
    // Avoid importing path solely for an authority comparison: URL
    // normalization gives stable case-insensitive file URLs on Windows and
    // resolves dot segments on every supported platform.
    try {
      const normalizeAuthority = (value) => {
        const href = pathToFileURL(value).href;
        return process.platform === "win32" ? href.toLowerCase() : href;
      };
      const expected = normalizeAuthority(config.projectPath);
      const actual = normalizeAuthority(cwd);
      return (
        actual === expected ||
        actual.startsWith(`${expected.replace(/\/$/, "")}/`)
      );
    } catch {
      return false;
    }
  }
}
