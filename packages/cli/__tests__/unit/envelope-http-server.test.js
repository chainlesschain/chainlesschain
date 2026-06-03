/**
 * Unit tests: envelope-http-server.js
 *
 * Covers the Phase 5 hosted-HTTP primitive that wraps
 * `@chainlesschain/session-core/envelope-sse` onto a node http.Server.
 *
 *  - createEnvelopeBus: subscribe / publish / unsubscribe / subscriberCount
 *  - GET /v1/health → 200 JSON
 *  - GET /v1/sessions/:id/events → SSE stream, receives published envelopes
 *  - Bearer token auth (401 without, 200 with)
 *  - Cleanup on connection close (subscriberCount returns to 0)
 *  - 404 on unknown routes, 405 on non-GET
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { createRequire } from "node:module";
import {
  createEnvelopeBus,
  createEnvelopeHttpServer,
} from "../../src/gateways/http/envelope-http-server.js";

const require_ = createRequire(import.meta.url);
const { createEnvelope } = require_("@chainlesschain/session-core");

function httpGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Open an SSE connection and return { req, res, chunks, close }. */
function openSse(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        res.setEncoding("utf8");
        res.on("data", (c) => chunks.push(c));
        resolve({
          req,
          res,
          chunks,
          close: () =>
            new Promise((r) => {
              req.destroy();
              res.on("close", r);
              r();
            }),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function waitFor(predicate, { timeout = 1000, interval = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("waitFor timed out");
}

describe("createEnvelopeBus", () => {
  it("subscribe/publish delivers envelopes to all subscribers for the session", () => {
    const bus = createEnvelopeBus();
    const a = [];
    const b = [];
    bus.subscribe("s1", (e) => a.push(e));
    bus.subscribe("s1", (e) => b.push(e));
    bus.subscribe("s2", (e) => a.push({ wrong: true }));

    const count = bus.publish("s1", { v: 1, type: "x" });
    expect(count).toBe(2);
    expect(a).toEqual([{ v: 1, type: "x" }]);
    expect(b).toEqual([{ v: 1, type: "x" }]);
  });

  it("unsubscribe removes the listener and cleans empty sessions", () => {
    const bus = createEnvelopeBus();
    const unsub = bus.subscribe("s1", () => {});
    expect(bus.subscriberCount("s1")).toBe(1);
    unsub();
    expect(bus.subscriberCount("s1")).toBe(0);
    // no throw for unknown session
    expect(bus.publish("nobody", {})).toBe(0);
  });

  it("publish swallows subscriber errors so fan-out continues", () => {
    const bus = createEnvelopeBus();
    bus.subscribe("s", () => {
      throw new Error("boom");
    });
    const seen = [];
    bus.subscribe("s", (e) => seen.push(e));
    expect(() => bus.publish("s", { ok: 1 })).not.toThrow();
    expect(seen).toEqual([{ ok: 1 }]);
  });
});

describe("createEnvelopeHttpServer", () => {
  let server;
  let port;

  beforeEach(async () => {
    // set up in each test
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("throws if bus is missing", () => {
    expect(() => createEnvelopeHttpServer({})).toThrow(/bus/);
  });

  it("GET /v1/health returns 200 JSON", async () => {
    const bus = createEnvelopeBus();
    server = createEnvelopeHttpServer({ bus, port: 0, heartbeatMs: 0 });
    ({ port } = await server.start());
    const res = await httpGet(port, "/v1/health");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const json = JSON.parse(res.body);
    expect(json).toMatchObject({ ok: true, service: "envelope-http" });
  });

  it("unknown route returns 404", async () => {
    const bus = createEnvelopeBus();
    server = createEnvelopeHttpServer({ bus, port: 0, heartbeatMs: 0 });
    ({ port } = await server.start());
    const res = await httpGet(port, "/nope");
    expect(res.status).toBe(404);
  });

  it("non-GET returns 405", async () => {
    const bus = createEnvelopeBus();
    server = createEnvelopeHttpServer({ bus, port: 0, heartbeatMs: 0 });
    ({ port } = await server.start());
    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/v1/health", method: "POST" },
        (res) => {
          res.resume();
          res.on("end", () =>
            resolve({ status: res.statusCode, allow: res.headers.allow }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(result.status).toBe(405);
    expect(result.allow).toBe("GET");
  });

  it("rejects SSE without bearer token when token is configured", async () => {
    const bus = createEnvelopeBus();
    server = createEnvelopeHttpServer({
      bus,
      port: 0,
      token: "sekret",
      heartbeatMs: 0,
    });
    ({ port } = await server.start());
    const res = await httpGet(port, "/v1/sessions/abc/events");
    expect(res.status).toBe(401);
  });

  it("streams published envelopes as SSE chunks", async () => {
    const bus = createEnvelopeBus();
    server = createEnvelopeHttpServer({ bus, port: 0, heartbeatMs: 0 });
    ({ port } = await server.start());

    const sse = await openSse(port, "/v1/sessions/sess-1/events");
    expect(sse.res.statusCode).toBe(200);
    expect(sse.res.headers["content-type"]).toMatch(/text\/event-stream/);

    // Wait for the subscribe comment to prove the subscription is wired.
    await waitFor(() => sse.chunks.join("").includes("subscribed"));
    expect(bus.subscriberCount("sess-1")).toBe(1);

    const env = createEnvelope({
      type: "run.token",
      sessionId: "sess-1",
      runId: "r1",
      payload: { content: "hello" },
    });
    bus.publish("sess-1", env);

    await waitFor(() => sse.chunks.join("").includes("event: run.token"));
    const joined = sse.chunks.join("");
    expect(joined).toContain("event: run.token");
    expect(joined).toMatch(/data: \{"v":1,"type":"run.token"/);

    await sse.close();
    await waitFor(() => bus.subscriberCount("sess-1") === 0);
  });

  it("accepts SSE with a valid bearer token", async () => {
    const bus = createEnvelopeBus();
    server = createEnvelopeHttpServer({
      bus,
      port: 0,
      token: "sekret",
      heartbeatMs: 0,
    });
    ({ port } = await server.start());

    const sse = await openSse(port, "/v1/sessions/s/events", {
      Authorization: "Bearer sekret",
    });
    expect(sse.res.statusCode).toBe(200);
    await waitFor(() => sse.chunks.join("").includes("subscribed"));
    await sse.close();
  });

  it("stop() closes active streams and the server", async () => {
    const bus = createEnvelopeBus();
    server = createEnvelopeHttpServer({ bus, port: 0, heartbeatMs: 0 });
    ({ port } = await server.start());

    const sse = await openSse(port, "/v1/sessions/s/events");
    await waitFor(() => bus.subscriberCount("s") === 1);

    await server.stop();
    server = null; // don't stop again in afterEach
    expect(bus.subscriberCount("s")).toBe(0);
    sse.req.destroy();
  });
});
