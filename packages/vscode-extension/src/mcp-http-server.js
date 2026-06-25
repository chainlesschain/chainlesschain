/**
 * Minimal MCP server over Streamable HTTP — the editor side of the IDE bridge.
 *
 * The ChainlessChain `cc` agent CLI's MCP client (packages/cli, harness/
 * mcp-client.js) connects to a `sse`/`http` server by POSTing JSON-RPC 2.0 to
 * the URL and reading an `application/json` response, capturing the
 * `Mcp-Session-Id` header. It POSTs `initialize`, the `notifications/
 * initialized` notification, then `tools/list` and `tools/call`. That is the
 * entire surface we must satisfy — no persistent SSE GET channel is required.
 *
 * Pure Node (`http` + `crypto`); no `vscode` dependency, so it is fully
 * unit-testable and can be driven by the real CLI MCPClient in an interop test.
 */
const http = require("http");
const crypto = require("crypto");

const PROTOCOL_VERSION = "2024-11-05";
const MAX_BODY_BYTES = 4 * 1024 * 1024;

class IdeMcpServer {
  /**
   * @param {object} opts
   * @param {Array<{name,description,inputSchema,handler}>} opts.tools
   * @param {string} [opts.token]      bearer token required on every request
   * @param {object} [opts.serverInfo] { name, version }
   * @param {string} [opts.path]       request path (default "/mcp")
   */
  constructor({
    tools = [],
    token = null,
    serverInfo,
    path = "/mcp",
    onActivity,
    onError,
  } = {}) {
    this._tools = tools;
    this._token = token;
    this._path = path;
    // Optional observer for the UI layer: fired on connect + every tool call.
    // Best-effort; never affects request handling.
    this._onActivity = typeof onActivity === "function" ? onActivity : null;
    // Optional sink for a post-listen server 'error' event. Best-effort; its job
    // is to keep that error from being thrown uncaught (see start()).
    this._onError = typeof onError === "function" ? onError : null;
    this._serverInfo = serverInfo || {
      name: "chainlesschain-ide",
      version: "0.1.0",
    };
    this._sessionId = crypto.randomBytes(16).toString("hex");
    this._server = null;
    this.port = null;
    this.host = "127.0.0.1";
  }

  /** Start listening; resolves with the bound port. */
  async start({ host = "127.0.0.1", port = 0 } = {}) {
    this.host = host;
    this._server = http.createServer((req, res) => this._onRequest(req, res));
    // A `tools/call` for `openDiff` blocks until the user accepts/rejects the
    // review — potentially minutes. Disable Node's request/socket timeouts so
    // the held-open response is never cut (localhost + bearer-gated, trusted).
    this._server.requestTimeout = 0;
    this._server.timeout = 0;
    // Persistent guard: the one-shot start-error listener below is removed once
    // listen() succeeds, leaving the server with no 'error' handler — and Node
    // throws an 'error' event with no listener as an UNCAUGHT exception, which
    // could take down the extension host. Keep a listener for the server's whole
    // life so any later error is swallowed (and surfaced via onError, if given).
    this._server.on("error", (e) => {
      if (this._onError) {
        try {
          this._onError(e);
        } catch {
          /* best-effort */
        }
      }
    });
    await new Promise((resolve, reject) => {
      const onErr = (e) => reject(e);
      this._server.once("error", onErr);
      this._server.listen(port, host, () => {
        this._server.removeListener("error", onErr);
        resolve();
      });
    });
    this.port = this._server.address().port;
    return this.port;
  }

  /** Stop listening (idempotent). */
  async stop() {
    if (!this._server) return;
    const srv = this._server;
    this._server = null;
    await new Promise((resolve) => srv.close(() => resolve()));
  }

  /** The URL the lockfile should advertise. */
  url() {
    return `http://${this.host}:${this.port}${this._path}`;
  }

  _headers() {
    return {
      "Content-Type": "application/json",
      "Mcp-Session-Id": this._sessionId,
    };
  }

  _send(res, status, obj) {
    res.writeHead(status, this._headers());
    res.end(obj === undefined ? "" : JSON.stringify(obj));
  }

  _onRequest(req, res) {
    if (req.method !== "POST") {
      this._send(res, 405, { error: "method not allowed" });
      return;
    }
    // Localhost bearer auth: every request (incl. notifications) carries it.
    if (this._token) {
      const auth = req.headers["authorization"] || "";
      if (auth !== `Bearer ${this._token}`) {
        this._send(res, 401, { error: "unauthorized" });
        return;
      }
    }
    let body = "";
    let aborted = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        aborted = true;
        this._send(res, 413, { error: "payload too large" });
        req.destroy();
      }
    });
    req.on("end", async () => {
      if (aborted) return;
      let msg;
      try {
        msg = JSON.parse(body || "{}");
      } catch {
        this._send(res, 400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
        return;
      }
      // JSON-RPC notification (no id) — ack and run side effects, no envelope.
      if (msg.id === undefined || msg.id === null) {
        res.writeHead(202, this._headers());
        res.end();
        return;
      }
      let envelope;
      try {
        const result = await this._dispatch(msg.method, msg.params || {});
        envelope = { jsonrpc: "2.0", id: msg.id, result };
      } catch (err) {
        envelope = {
          jsonrpc: "2.0",
          id: msg.id,
          error: {
            code: Number.isInteger(err.code) ? err.code : -32603,
            message: err.message || "Internal error",
          },
        };
      }
      this._send(res, 200, envelope);
    });
  }

  _emit(event) {
    if (!this._onActivity) return;
    try {
      this._onActivity(event);
    } catch {
      /* observer errors never affect the server */
    }
  }

  async _dispatch(method, params) {
    switch (method) {
      case "initialize":
        this._emit({ type: "connect", ts: Date.now() });
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: this._serverInfo,
        };
      case "tools/list":
        return {
          tools: this._tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema: inputSchema || { type: "object", properties: {} },
          })),
        };
      case "tools/call": {
        const tool = this._tools.find((t) => t.name === params.name);
        if (!tool) {
          const e = new Error(`Unknown tool: ${params.name}`);
          e.code = -32601;
          throw e;
        }
        let out;
        try {
          out = await tool.handler(params.arguments || {});
        } catch (err) {
          this._emit({
            type: "tool",
            tool: params.name,
            ok: false,
            error: err.message,
            args: params.arguments,
            ts: Date.now(),
          });
          // Surface tool errors as an MCP isError result, not a transport error
          // (Claude-Code convention: the LLM sees the message).
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          };
        }
        this._emit({
          type: "tool",
          tool: params.name,
          ok: true,
          args: params.arguments,
          ts: Date.now(),
        });
        if (out && Array.isArray(out.content)) return out;
        if (typeof out === "string") {
          return { content: [{ type: "text", text: out }] };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(out ?? null) }],
        };
      }
      case "resources/list":
        return { resources: [] };
      case "prompts/list":
        return { prompts: [] };
      default: {
        const e = new Error(`Method not found: ${method}`);
        e.code = -32601;
        throw e;
      }
    }
  }
}

module.exports = { IdeMcpServer, PROTOCOL_VERSION };
