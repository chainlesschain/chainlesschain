/**
 * Computer-use MCP server (gap-2026-07-11 P1#6) — exposes GUI control verbs to
 * an MCP client, gated by the authorization core (authorization.js) and driven
 * by an OS backend (control-backend.js). Streamable-HTTP MCP, same transport
 * shape as `cc mcp serve`: POST JSON-RPC → application/json.
 *
 * Every tools/call runs through the authorizer first. A verb the authorizer
 * marks `requiresConfirmation` is refused unless the caller supplied
 * `confirm: true` in the tool args (the MCP client's approval surface / the
 * agent's confirm flow owns the human check) — an unattended agent can never
 * silently click a high-risk app.
 */

import http from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createAuthorizer,
  COMPUTER_USE_CAPABILITIES,
  TOOL_PRIORITY,
} from "./authorization.js";
import { createWindowsBackend } from "./control-backend.js";

const rpcResult = (id, result) =>
  JSON.stringify({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) =>
  JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
const ok = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});
const fail = (msg) => ({
  content: [{ type: "text", text: msg }],
  isError: true,
});

function bearerMatches(authHeader, token) {
  const m = /^Bearer\s+(.+)$/.exec(String(authHeader || ""));
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const TOOL_SCHEMAS = {
  computer_screenshot: {
    description: "Capture the screen to a PNG (read-only observation).",
    inputSchema: { type: "object", properties: {} },
  },
  computer_window_list: {
    description: "List visible windows (pid, app, title).",
    inputSchema: { type: "object", properties: {} },
  },
  computer_clipboard_read: {
    description: "Read the system clipboard text.",
    inputSchema: { type: "object", properties: {} },
  },
  computer_clipboard_write: {
    description: "Write text to the system clipboard.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  computer_click: {
    description:
      "Click at screen coordinates (input injection; requires confirm:true for high-risk apps).",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        app: { type: "string" },
        confirm: { type: "boolean" },
      },
      required: ["x", "y"],
    },
  },
  computer_type: {
    description: "Type text into the focused window (input injection).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        app: { type: "string" },
        confirm: { type: "boolean" },
      },
      required: ["text"],
    },
  },
  computer_scroll: {
    description: "Scroll by N notches (positive up, negative down).",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        app: { type: "string" },
        confirm: { type: "boolean" },
      },
      required: ["amount"],
    },
  },
  computer_app_launch: {
    description: "Launch an application by path/name.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        confirm: { type: "boolean" },
      },
      required: ["app"],
    },
  },
};

const TOOL_CAPABILITY = {
  computer_screenshot: "screenshot",
  computer_window_list: "window_list",
  computer_clipboard_read: "clipboard_read",
  computer_clipboard_write: "clipboard_write",
  computer_click: "click",
  computer_type: "type",
  computer_scroll: "scroll",
  computer_app_launch: "app_launch",
};

/**
 * Execute one tool call through authorize → confirm-gate → backend.
 * Pure orchestration (no HTTP) so it is unit-tested directly.
 */
export function handleToolCall(name, args = {}, { authorizer, backend }) {
  const capability = TOOL_CAPABILITY[name];
  if (!capability) return fail(`unknown tool: ${name}`);

  const context = { app: args.app || null, target: args.app || null };
  const verdict = authorizer.authorize(capability, context);
  if (!verdict.allowed) return fail(`[computer-use denied] ${verdict.reason}`);
  if (verdict.requiresConfirmation && args.confirm !== true) {
    return fail(
      `[computer-use needs confirmation] ${verdict.reason || capability} — re-call with confirm:true after the user approves`,
    );
  }

  let result;
  switch (name) {
    case "computer_screenshot":
      result = backend.screenshot(
        args.path ||
          join(tmpdir(), `cc-screenshot-${randomBytes(4).toString("hex")}.png`),
      );
      break;
    case "computer_window_list":
      result = backend.windowList();
      break;
    case "computer_clipboard_read":
      result = backend.clipboardRead();
      break;
    case "computer_clipboard_write":
      result = backend.clipboardWrite(args.text);
      break;
    case "computer_click":
      result = backend.click(args.x, args.y);
      break;
    case "computer_type":
      result = backend.type(args.text);
      break;
    case "computer_scroll":
      result = backend.scroll(args.amount);
      break;
    case "computer_app_launch":
      result = backend.appLaunch(args.app, args.args || []);
      break;
    default:
      return fail(`unhandled tool: ${name}`);
  }
  return result.ok ? ok(result) : fail(result.error || `${name} failed`);
}

export function availableTools(authorizer) {
  return Object.entries(TOOL_SCHEMAS)
    .filter(([name]) => authorizer.capabilities.includes(TOOL_CAPABILITY[name]))
    .map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
}

export function startComputerUseServer(opts = {}) {
  const authorizer = createAuthorizer({
    enabled: true, // starting the server IS the explicit opt-in
    ...opts.config,
  });
  const backend = opts.backend || createWindowsBackend();
  const token =
    opts.token === false ? null : opts.token || randomBytes(16).toString("hex");

  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body);
    };
    if (req.method !== "POST")
      return send(405, rpcError(null, -32600, "POST only"));
    if (token && !bearerMatches(req.headers.authorization, token)) {
      return send(401, rpcError(null, -32001, "unauthorized"));
    }
    let raw = "";
    let bytes = 0;
    let aborted = false;
    req.on("data", (c) => {
      if (aborted) return;
      bytes += c.length;
      if (bytes > 1024 * 1024) {
        aborted = true;
        send(413, rpcError(null, -32600, "request too large"));
        req.destroy();
      } else raw += c;
    });
    req.on("end", () => {
      if (aborted) return;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return send(400, rpcError(null, -32700, "parse error"));
      }
      const { id, method, params } = msg || {};
      if (method === "initialize") {
        return send(
          200,
          rpcResult(id, {
            protocolVersion: params?.protocolVersion || "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "cc-computer-use", version: "1.0.0" },
            instructions: `Tool priority (prefer the cheapest, most auditable): ${TOOL_PRIORITY.join(" > ")}. Input verbs need confirm:true.`,
          }),
        );
      }
      if (method === "notifications/initialized") {
        res.writeHead(202);
        return res.end();
      }
      if (method === "tools/list") {
        return send(200, rpcResult(id, { tools: availableTools(authorizer) }));
      }
      if (method === "tools/call") {
        const result = handleToolCall(params?.name, params?.arguments || {}, {
          authorizer,
          backend,
        });
        return send(200, rpcResult(id, result));
      }
      return send(200, rpcError(id, -32601, `unknown method: ${method}`));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port || 0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        token,
        url: `http://127.0.0.1:${port}`,
        capabilities: authorizer.capabilities,
        stop: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

export { COMPUTER_USE_CAPABILITIES };
