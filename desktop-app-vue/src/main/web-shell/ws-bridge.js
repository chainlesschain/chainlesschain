/**
 * ws-bridge — Phase 0 spike step 2 (2026-04-29).
 *
 * Minimal WebSocket server hosted inside the Electron main-process Node
 * runtime. Designed to back the web-panel SPA loaded via `web-ui-loader.js`.
 *
 * Wire protocol (request → response):
 *   client → server : { type: "<topic>", id: "<request-id>", ...payload }
 *   server → client : { type: "<topic>.result", id: "<request-id>", ok: true, result }
 *                     { type: "<topic>.result", id: "<request-id>", ok: false, error }
 *
 * Handlers are pure functions `(payload, ctx) => Promise<result>` and live in
 * a small registry so each subsystem (ukey, fs, mcp, …) can register its own
 * topics without bloating this module.
 *
 * Phase 0 deliberately keeps this thin — no auth, no broadcasts, no streaming
 * — just enough to verify "request-id 关联" works end-to-end (risk #2 in
 * `memory/desktop_web_shell_strategy.md`).
 */

const { WebSocketServer } = require("ws");

/**
 * @typedef {(payload: any, ctx: { topic: string, id: string }) => Promise<any> | any} WsHandler
 *
 * @typedef {Object} StartWsBridgeOptions
 * @property {number} [port]           TCP port. 0 = OS-assigned (default).
 * @property {string} [host]           Bind host. Defaults to 127.0.0.1.
 * @property {Record<string, WsHandler>} [handlers]
 *                                     Topic → handler. Topics without a `.result` suffix.
 */

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Start a WebSocket bridge in this same Node process.
 *
 * @param {StartWsBridgeOptions} [options]
 * @returns {Promise<{
 *   wss: import("ws").WebSocketServer,
 *   host: string,
 *   port: number,
 *   url: string,
 *   register: (topic: string, handler: WsHandler) => void,
 *   close: () => Promise<void>
 * }>}
 */
async function startWsBridge(options = {}) {
  const host = options.host || "127.0.0.1";
  const port = typeof options.port === "number" ? options.port : 0;
  const handlers = new Map();

  if (options.handlers) {
    for (const [topic, fn] of Object.entries(options.handlers)) {
      if (typeof fn !== "function") {
        throw new TypeError(
          `ws-bridge: handler for "${topic}" must be a function`,
        );
      }
      handlers.set(topic, fn);
    }
  }

  const wss = new WebSocketServer({ host, port });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      wss.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      wss.removeListener("error", onError);
      resolve();
    };
    wss.once("error", onError);
    wss.once("listening", onListening);
  });

  const address = wss.address();
  const boundPort =
    typeof address === "object" && address ? address.port : port;
  const boundHost =
    typeof address === "object" && address && address.address
      ? address.address
      : host;
  const url = `ws://${boundHost}:${boundPort}/`;

  wss.on("connection", (socket) => {
    socket.on("message", async (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString("utf8"));
      } catch {
        sendError(socket, null, null, "invalid_json");
        return;
      }
      if (!isPlainObject(frame) || typeof frame.type !== "string") {
        sendError(socket, null, frame?.id ?? null, "invalid_frame");
        return;
      }

      const topic = frame.type;
      const id = typeof frame.id === "string" ? frame.id : null;
      const handler = handlers.get(topic);
      if (!handler) {
        sendError(socket, topic, id, `no_handler:${topic}`);
        return;
      }

      try {
        const result = await handler(frame, { topic, id });
        send(socket, {
          type: `${topic}.result`,
          id,
          ok: true,
          result: result ?? null,
        });
      } catch (err) {
        sendError(
          socket,
          topic,
          id,
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  });

  function register(topic, fn) {
    if (typeof topic !== "string" || !topic) {
      throw new TypeError("ws-bridge: topic must be a non-empty string");
    }
    if (typeof fn !== "function") {
      throw new TypeError("ws-bridge: handler must be a function");
    }
    handlers.set(topic, fn);
  }

  function close() {
    return new Promise((resolve) => {
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          /* ignore */
        }
      }
      wss.close(() => resolve());
    });
  }

  return { wss, host: boundHost, port: boundPort, url, register, close };
}

function send(socket, frame) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(frame));
  }
}

function sendError(socket, topic, id, error) {
  send(socket, {
    type: topic ? `${topic}.result` : "error",
    id,
    ok: false,
    error,
  });
}

module.exports = { startWsBridge };
