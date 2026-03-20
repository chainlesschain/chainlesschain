/**
 * Integration tests: ui HTTP server + web UI HTML pipeline
 *
 * Starts real HTTP servers on random ports, makes actual loopback requests,
 * and validates the complete HTML output including the injected config JSON.
 * No live CLI subprocess is needed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { createWebUIServer } from "../../src/lib/web-ui-server.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function startServer(opts) {
  return new Promise((resolve, reject) => {
    const server = createWebUIServer(opts);
    server.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function request(port, { method = "GET", path = "/" } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method },
      (res) => {
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function extractConfig(body) {
  const match = body.match(/window\.__CC_CONFIG__\s*=\s*({[\s\S]*?});/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

describe("ui HTTP server – lifecycle", () => {
  let server;

  afterEach(async () => {
    if (server) await stopServer(server);
  });

  it("server starts without throwing", async () => {
    server = await startServer({
      wsPort: 18800,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
    });
    expect(server.listening).toBe(true);
  });

  it("server address() returns an object with port > 0", async () => {
    server = await startServer({
      wsPort: 18800,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
    });
    const addr = server.address();
    expect(addr.port).toBeGreaterThan(0);
  });

  it("two servers can run simultaneously on different ports", async () => {
    const s2 = await startServer({
      wsPort: 18801,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
    });
    server = await startServer({
      wsPort: 18802,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "project",
    });
    expect(s2.listening).toBe(true);
    expect(server.listening).toBe(true);
    expect(s2.address().port).not.toBe(server.address().port);
    await stopServer(s2);
  });

  it("server can be stopped cleanly", async () => {
    server = await startServer({
      wsPort: 18800,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
    });
    await stopServer(server);
    expect(server.listening).toBe(false);
    server = null;
  });
});

// ── global mode ───────────────────────────────────────────────────────────────

describe("ui HTTP server – global mode HTML", () => {
  let server;
  let port;
  let body;

  beforeEach(async () => {
    server = await startServer({
      wsPort: 19800,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
    });
    port = server.address().port;
    const res = await request(port);
    body = res.body;
  });

  afterEach(() => stopServer(server));

  it("__CC_CONFIG__ is valid JSON", () => {
    const cfg = extractConfig(body);
    expect(cfg).not.toBeNull();
  });

  it("config.mode is 'global'", () => {
    expect(extractConfig(body).mode).toBe("global");
  });

  it("config.wsPort matches what was passed", () => {
    expect(extractConfig(body).wsPort).toBe(19800);
  });

  it("config.wsHost matches what was passed", () => {
    expect(extractConfig(body).wsHost).toBe("127.0.0.1");
  });

  it("config.projectRoot is null", () => {
    expect(extractConfig(body).projectRoot).toBeNull();
  });

  it("config.projectName is null", () => {
    expect(extractConfig(body).projectName).toBeNull();
  });

  it("config.wsToken is null when no token", () => {
    expect(extractConfig(body).wsToken).toBeNull();
  });

  it("HTML contains WS URL construction using config values", () => {
    expect(body).toContain("WS_URL");
    expect(body).toContain("wsHost");
    expect(body).toContain("wsPort");
  });

  it("body has correct page title for global mode", () => {
    expect(body).toContain("<title>");
    expect(body).toContain("ChainlessChain");
  });
});

// ── project mode ──────────────────────────────────────────────────────────────

describe("ui HTTP server – project mode HTML", () => {
  let server;
  let port;
  let body;

  beforeEach(async () => {
    server = await startServer({
      wsPort: 19801,
      wsToken: "tok-abc",
      wsHost: "127.0.0.1",
      projectRoot: "/workspace/demo-proj",
      projectName: "demo-proj",
      mode: "project",
    });
    port = server.address().port;
    const res = await request(port);
    body = res.body;
  });

  afterEach(() => stopServer(server));

  it("config.mode is 'project'", () => {
    expect(extractConfig(body).mode).toBe("project");
  });

  it("config.projectRoot is set", () => {
    expect(extractConfig(body).projectRoot).toBe("/workspace/demo-proj");
  });

  it("config.projectName is set", () => {
    expect(extractConfig(body).projectName).toBe("demo-proj");
  });

  it("config.wsToken is set", () => {
    expect(extractConfig(body).wsToken).toBe("tok-abc");
  });

  it("page title contains project name", () => {
    expect(body).toContain("demo-proj");
  });
});

// ── routing ───────────────────────────────────────────────────────────────────

describe("ui HTTP server – routing", () => {
  let server;
  let port;

  beforeEach(async () => {
    server = await startServer({
      wsPort: 19802,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
    });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("GET / → 200", async () => {
    const res = await request(port, { path: "/" });
    expect(res.status).toBe(200);
  });

  it("GET /index.html → 200", async () => {
    const res = await request(port, { path: "/index.html" });
    expect(res.status).toBe(200);
  });

  it("GET /api/foo → 404", async () => {
    const res = await request(port, { path: "/api/foo" });
    expect(res.status).toBe(404);
  });

  it("GET /static/app.js → 404", async () => {
    const res = await request(port, { path: "/static/app.js" });
    expect(res.status).toBe(404);
  });

  it("POST / → 404", async () => {
    const res = await request(port, { method: "POST", path: "/" });
    expect(res.status).toBe(404);
  });
});

// ── front-end WebSocket client code ──────────────────────────────────────────

describe("ui HTTP server – embedded WebSocket client", () => {
  let server;
  let port;
  let body;

  beforeEach(async () => {
    server = await startServer({
      wsPort: 19803,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
    });
    port = server.address().port;
    const res = await request(port);
    body = res.body;
  });

  afterEach(() => stopServer(server));

  it("contains WebSocket constructor call", () => {
    expect(body).toContain("new WebSocket");
  });

  it("contains session-create message type", () => {
    expect(body).toContain("session-create");
  });

  it("contains session-message message type", () => {
    expect(body).toContain("session-message");
  });

  // Protocol v2: streaming uses response-token / response-complete
  it("contains response-token handler", () => {
    expect(body).toContain("response-token");
  });

  it("contains response-complete handler", () => {
    expect(body).toContain("response-complete");
  });

  // Auth: server sends auth-result (not auth-ok)
  it("contains auth-result handler", () => {
    expect(body).toContain("auth-result");
  });

  // Session list: server sends session-list-result (not session-list)
  it("contains session-list-result handler", () => {
    expect(body).toContain("session-list-result");
  });

  it("contains reconnection logic", () => {
    expect(body).toContain("setTimeout");
    expect(body).toContain("connect");
  });

  // Auto-inject message id
  it("contains id auto-injection in send function", () => {
    expect(body).toContain("ui-");
    expect(body).toContain("_msgId");
  });
});
