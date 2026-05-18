/**
 * Envelope HTTP Server — Deep Agents Deploy Phase 5 (hosted HTTP follow-up)
 *
 * Wires the `@chainlesschain/session-core/envelope-sse` primitive to a node
 * `http.Server` so consumers without a WebSocket can subscribe to a session's
 * Phase 5 envelope stream via Server-Sent Events.
 *
 * Routes:
 *   GET /v1/health                       → { ok: true, ... }
 *   GET /v1/sessions/:sessionId/events   → text/event-stream
 *
 * The bus is a minimal pub/sub: callers (ws-server / session-protocol) call
 * `bus.publish(sessionId, envelope)` whenever an envelope is produced, and the
 * HTTP route forwards it to every subscriber for that session.
 *
 * Authentication: optional bearer token via `Authorization: Bearer <token>`
 * (matches the WS server's `--token` semantics).
 */

import http from "node:http";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { sseResponseHeaders, formatEnvelopeAsSse, formatSseComment } = require_(
  "@chainlesschain/session-core/envelope-sse",
);

/** Minimal pub/sub. Not exported as a class to keep the surface small. */
export function createEnvelopeBus() {
  /** @type {Map<string, Set<(env: object) => void>>} */
  const subs = new Map();
  return {
    subscribe(sessionId, fn) {
      let set = subs.get(sessionId);
      if (!set) {
        set = new Set();
        subs.set(sessionId, set);
      }
      set.add(fn);
      return () => {
        const s = subs.get(sessionId);
        if (!s) return;
        s.delete(fn);
        if (s.size === 0) subs.delete(sessionId);
      };
    },
    publish(sessionId, envelope) {
      const set = subs.get(sessionId);
      if (!set) return 0;
      for (const fn of set) {
        try {
          fn(envelope);
        } catch (_e) {
          // Subscriber error must not stop fan-out.
        }
      }
      return set.size;
    },
    subscriberCount(sessionId) {
      const set = subs.get(sessionId);
      return set ? set.size : 0;
    },
  };
}

const SESSION_EVENTS_RE = /^\/v1\/sessions\/([^/]+)\/events\/?$/;

function checkAuth(req, token) {
  if (!token) return true;
  const header = req.headers["authorization"] || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(match && match[1] === token);
}

/**
 * @param {object} options
 * @param {ReturnType<typeof createEnvelopeBus>} options.bus
 * @param {number} [options.port=18801]
 * @param {string} [options.host="127.0.0.1"]
 * @param {string} [options.token] - optional bearer token; required for SSE
 * @param {number} [options.heartbeatMs=15000]
 */
export function createEnvelopeHttpServer(options = {}) {
  const bus = options.bus;
  if (!bus)
    throw new Error("createEnvelopeHttpServer: options.bus is required");
  const port = options.port ?? 18801;
  const host = options.host ?? "127.0.0.1";
  const token = options.token || null;
  const heartbeatMs = options.heartbeatMs ?? 15000;

  /** Active SSE subscriber unsubscribers, keyed by response object. */
  const activeStreams = new Set();

  function handleHealth(_req, res) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "envelope-http", version: 1 }));
  }

  function handleSessionEvents(req, res, sessionId) {
    if (!checkAuth(req, token)) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    res.writeHead(200, sseResponseHeaders());
    // Prime the stream so HTTP/1.1 clients see headers immediately.
    res.write(formatSseComment(`subscribed sessionId=${sessionId}`));

    const send = (envelope) => {
      try {
        res.write(formatEnvelopeAsSse(envelope));
      } catch (_e) {
        // Bad envelope — drop, do not crash the stream.
      }
    };

    const unsubscribe = bus.subscribe(sessionId, send);

    let heartbeatTimer = null;
    if (heartbeatMs > 0) {
      heartbeatTimer = setInterval(() => {
        try {
          res.write(formatSseComment("keep-alive"));
        } catch (_e) {
          // Connection broken — cleanup will run via 'close' below.
        }
      }, heartbeatMs);
      if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
    }

    const cleanup = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      unsubscribe();
      activeStreams.delete(cleanup);
    };
    activeStreams.add(cleanup);

    req.on("close", cleanup);
    req.on("aborted", cleanup);
  }

  function handler(req, res) {
    const url = req.url || "/";
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET" });
      res.end();
      return;
    }
    if (url === "/v1/health") return handleHealth(req, res);
    const match = SESSION_EVENTS_RE.exec(url);
    if (match)
      return handleSessionEvents(req, res, decodeURIComponent(match[1]));
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  }

  const server = http.createServer(handler);

  return {
    server,
    bus,
    start() {
      return new Promise((resolve, reject) => {
        const onError = (err) => {
          server.removeListener("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener("error", onError);
          const addr = server.address();
          resolve({
            port: typeof addr === "object" && addr ? addr.port : port,
            host,
          });
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
    },
    stop() {
      return new Promise((resolve) => {
        for (const cleanup of [...activeStreams]) cleanup();
        server.close(() => resolve());
        // Force-close any kept-alive sockets so the server fully shuts down.
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
      });
    },
  };
}
