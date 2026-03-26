/**
 * Integration tests: ui HTTP server + web UI HTML pipeline
 *
 * Starts real HTTP servers on random ports, makes actual loopback requests,
 * and validates the complete HTML output including the injected config JSON.
 * No live CLI subprocess is needed.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWebUIServer } from "../../src/lib/web-ui-server.js";

// ── fake dist helper (shared with Vue3 SPA integration tests) ─────────────────

function makeFakeDist(baseDir) {
  const distDir = path.join(baseDir, "dist");
  const assetsDir = path.join(distDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  fs.writeFileSync(
    path.join(distDir, "index.html"),
    `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>ChainlessChain 管理面板</title>
  <script>window.__CC_CONFIG__ = __CC_CONFIG_PLACEHOLDER__;</script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./assets/app.js"></script>
</body>
</html>`,
    "utf-8",
  );

  fs.writeFileSync(
    path.join(assetsDir, "app.abc123.js"),
    "console.log('bundle');",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(assetsDir, "style.abc123.css"),
    "body{margin:0}",
    "utf-8",
  );
  fs.writeFileSync(path.join(assetsDir, "logo.abc123.svg"), "<svg/>", "utf-8");
  return distDir;
}

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

// Force fallback embedded HTML mode (bypasses packages/web-panel/dist/ auto-detection)
const FORCE_FALLBACK = {
  staticDir: path.join(os.tmpdir(), ".cc-int-test-no-dist-sentinel-xzq9"),
};

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

describe("ui HTTP server – global mode HTML (fallback embedded mode)", () => {
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
      ...FORCE_FALLBACK,
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

describe("ui HTTP server – project mode HTML (fallback embedded mode)", () => {
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
      ...FORCE_FALLBACK,
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

describe("ui HTTP server – routing (fallback embedded mode)", () => {
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
      ...FORCE_FALLBACK,
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

describe("ui HTTP server – embedded WebSocket client (fallback embedded mode)", () => {
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
      ...FORCE_FALLBACK,
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

// ── Vue3 SPA mode integration ─────────────────────────────────────────────────

describe("ui HTTP server – Vue3 SPA mode (staticDir)", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-int-spa-"));
    distDir = makeFakeDist(tmpDir);
    server = await new Promise((resolve, reject) => {
      const s = createWebUIServer({
        wsPort: 19810,
        wsToken: null,
        wsHost: "127.0.0.1",
        projectRoot: null,
        projectName: null,
        mode: "global",
        staticDir: distDir,
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("server starts and listens", () => {
    expect(server.listening).toBe(true);
  });

  it("GET / returns 200 with Vue3 index.html", async () => {
    const res = await request(port);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<div id="app">');
  });

  it("__CC_CONFIG_PLACEHOLDER__ is fully replaced", async () => {
    const res = await request(port);
    expect(res.body).not.toContain("__CC_CONFIG_PLACEHOLDER__");
  });

  it("config is valid JSON embedded in index.html", async () => {
    const res = await request(port);
    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
    expect(cfg.wsPort).toBe(19810);
    expect(cfg.mode).toBe("global");
  });

  it("GET /assets/app.abc123.js returns 200 with JS content-type", async () => {
    const res = await request(port, { path: "/assets/app.abc123.js" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
  });

  it("GET /assets/style.abc123.css returns 200 with CSS content-type", async () => {
    const res = await request(port, { path: "/assets/style.abc123.css" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
  });

  it("GET /assets/logo.abc123.svg returns 200 with SVG content-type", async () => {
    const res = await request(port, { path: "/assets/logo.abc123.svg" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("svg");
  });

  it("/assets/ files have immutable cache-control", async () => {
    const res = await request(port, { path: "/assets/app.abc123.js" });
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers["cache-control"]).toContain("max-age=31536000");
  });

  it("index.html has no-store cache-control", async () => {
    const res = await request(port);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("GET /dashboard (unknown SPA route) returns 200 with index.html", async () => {
    const res = await request(port, { path: "/dashboard" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("window.__CC_CONFIG__");
  });

  it("GET /settings/profile (nested SPA route) returns 200 with index.html", async () => {
    const res = await request(port, { path: "/settings/profile" });
    expect(res.status).toBe(200);
    expect(res.body).toContain('<div id="app">');
  });

  it("POST / returns 405", async () => {
    const res = await request(port, { method: "POST", path: "/" });
    expect(res.status).toBe(405);
  });

  it("X-Content-Type-Options is nosniff for all responses", async () => {
    const res = await request(port);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("ui HTTP server – Vue3 SPA mode project config injection", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-int-spa-proj-"));
    distDir = makeFakeDist(tmpDir);
    server = await new Promise((resolve, reject) => {
      const s = createWebUIServer({
        wsPort: 19811,
        wsToken: "int-token-xyz",
        wsHost: "127.0.0.1",
        projectRoot: "/workspace/my-proj",
        projectName: "my-proj",
        mode: "project",
        staticDir: distDir,
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mode is project in injected config", async () => {
    const res = await request(port);
    expect(extractConfig(res.body).mode).toBe("project");
  });

  it("projectRoot is injected correctly", async () => {
    const res = await request(port);
    expect(extractConfig(res.body).projectRoot).toBe("/workspace/my-proj");
  });

  it("projectName is injected correctly", async () => {
    const res = await request(port);
    expect(extractConfig(res.body).projectName).toBe("my-proj");
  });

  it("wsToken is injected correctly", async () => {
    const res = await request(port);
    expect(extractConfig(res.body).wsToken).toBe("int-token-xyz");
  });
});

describe("ui HTTP server – $ in config values (bug fix regression)", () => {
  let tmpDir;
  let distDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-int-dollar-"));
    distDir = makeFakeDist(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("projectRoot with $& pattern is injected without corruption", async () => {
    const server = await new Promise((resolve, reject) => {
      const s = createWebUIServer({
        wsPort: 19812,
        wsToken: null,
        wsHost: "127.0.0.1",
        projectRoot: "/path/$HOME/project",
        projectName: "$HOME-proj",
        mode: "project",
        staticDir: distDir,
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    const port = server.address().port;
    const res = await request(port);
    await new Promise((resolve) => server.close(resolve));

    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
    expect(cfg.projectRoot).toBe("/path/$HOME/project");
    expect(cfg.projectName).toBe("$HOME-proj");
  });

  it("wsToken with $$ pattern is injected without corruption", async () => {
    const server = await new Promise((resolve, reject) => {
      const s = createWebUIServer({
        wsPort: 19813,
        wsToken: "tok$$secret$'val",
        wsHost: "127.0.0.1",
        projectRoot: null,
        projectName: null,
        mode: "global",
        staticDir: distDir,
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    const port = server.address().port;
    const res = await request(port);
    await new Promise((resolve) => server.close(resolve));

    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
    expect(cfg.wsToken).toBe("tok$$secret$'val");
  });
});
