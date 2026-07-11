/**
 * Webhook inbound channel — a tiny loopback HTTP listener that turns
 * authenticated POSTs into session events.
 *
 *   POST /v1/event
 *   Authorization: Bearer <token>
 *   { "text": "deploy finished", "sender": "ci", "meta": {...} }
 *
 * Trust boundary:
 * - bearer token REQUIRED on every request; without a configured token a
 *   random one is generated and printed once at startup (pairing secret).
 * - binds 127.0.0.1 unless `allowExternal: true` is explicitly configured
 *   (same LAN/loopback posture as remote-control direct pairing).
 * - optional `allowlist` of sender ids — configured ⇒ only those senders.
 * - body capped at 64 KB; JSON only.
 */

import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 64 * 1024;

function tokenMatches(expected, got) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(got || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startWebhookChannel(options = {}) {
  const {
    port = 18901,
    host = "127.0.0.1",
    allowExternal = false,
    allowlist,
    onEvent,
    log = () => {},
  } = options;

  const isLoopback =
    host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (!isLoopback && allowExternal !== true) {
    throw new Error(
      `webhook channel refuses to bind non-loopback host "${host}" without channels.webhook.allowExternal=true`,
    );
  }

  const token = options.token || randomBytes(24).toString("base64url");
  const generated = !options.token;

  const server = createServer((req, res) => {
    const respond = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method !== "POST" || req.url !== "/v1/event") {
      return respond(404, { error: "not found" });
    }
    const auth = String(req.headers.authorization || "");
    const got = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!tokenMatches(token, got)) {
      return respond(401, { error: "unauthorized" });
    }

    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        respond(413, { error: "body too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      } catch {
        return respond(400, { error: "invalid JSON" });
      }
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";
      if (!text) return respond(400, { error: "missing text" });
      const sender =
        typeof payload.sender === "string" ? payload.sender : "webhook";
      if (Array.isArray(allowlist) && allowlist.length > 0) {
        if (!allowlist.includes(sender)) {
          return respond(403, { error: "sender not in allowlist" });
        }
      }
      try {
        onEvent?.({
          channel: "webhook",
          sender,
          text,
          meta:
            payload.meta && typeof payload.meta === "object"
              ? payload.meta
              : undefined,
        });
      } catch {
        /* the session queue owns downstream failures */
      }
      respond(202, { ok: true });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  server.unref?.();

  const actualPort = server.address()?.port ?? port;
  const url = `http://${host}:${actualPort}/v1/event`;
  log(
    `channel webhook listening on ${url}` +
      (generated ? ` (generated token: ${token})` : ""),
  );

  return {
    kind: "webhook",
    url,
    port: actualPort,
    token,
    describe: `webhook ${url}`,
    stop: () =>
      new Promise((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      }),
  };
}
