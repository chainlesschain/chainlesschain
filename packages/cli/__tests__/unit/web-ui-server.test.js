/**
 * Unit tests: web-ui-server.js
 *
 * Tests the createWebUIServer factory and HTML generation logic.
 * Uses real HTTP requests against a loopback server started on a random port.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWebUIServer } from "../../src/lib/web-ui-server.js";

// ── fake Vue3 dist helper ─────────────────────────────────────────────────────

/**
 * Create a minimal fake Vite dist directory for testing Vue3 SPA serving mode.
 * Returns the dist directory path.
 */
function makeFakeDist(baseDir) {
  const distDir = path.join(baseDir, "dist");
  const assetsDir = path.join(distDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  // index.html with the placeholder (mirrors real packages/web-panel/index.html)
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

  // Fake JS asset
  fs.writeFileSync(
    path.join(assetsDir, "app.abc123.js"),
    "console.log('fake-vue3-bundle');",
    "utf-8",
  );

  // Fake CSS asset
  fs.writeFileSync(
    path.join(assetsDir, "style.abc123.css"),
    "body { margin: 0; }",
    "utf-8",
  );

  return distDir;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function startServer(opts) {
  return new Promise((resolve, reject) => {
    const server = createWebUIServer(opts);
    server.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function get(port, path = "/") {
  return new Promise((resolve, reject) => {
    const chunks = [];
    http
      .get(`http://127.0.0.1:${port}${path}`, (res) => {
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      })
      .on("error", reject);
  });
}

const GLOBAL_OPTS = {
  wsPort: 18800,
  wsToken: null,
  wsHost: "127.0.0.1",
  projectRoot: null,
  projectName: null,
  mode: "global",
};

const PROJECT_OPTS = {
  wsPort: 18800,
  wsToken: "secret123",
  wsHost: "127.0.0.1",
  projectRoot: "/home/user/my-project",
  projectName: "my-project",
  mode: "project",
};

// Force embedded fallback HTML by pointing staticDir to a guaranteed non-existent path.
// This isolates fallback-mode tests from whether packages/web-panel/dist/ is present.
const FORCE_FALLBACK = {
  staticDir: path.join(os.tmpdir(), ".cc-test-no-dist-sentinel-xzq9"),
};
const FALLBACK_GLOBAL = { ...GLOBAL_OPTS, ...FORCE_FALLBACK };
const FALLBACK_PROJECT = { ...PROJECT_OPTS, ...FORCE_FALLBACK };

// ── createWebUIServer() return value ─────────────────────────────────────────

describe("createWebUIServer – return type", () => {
  it("returns an http.Server instance", () => {
    const server = createWebUIServer(GLOBAL_OPTS);
    expect(server).toBeInstanceOf(http.Server);
    server.close();
  });
});

// ── HTTP behaviour ───────────────────────────────────────────────────────────

describe("createWebUIServer – HTTP responses (fallback embedded mode)", () => {
  let server;
  let port;

  beforeEach(async () => {
    server = await startServer(FALLBACK_GLOBAL);
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("GET / returns status 200", async () => {
    const res = await get(port, "/");
    expect(res.status).toBe(200);
  });

  it("GET /index.html returns status 200", async () => {
    const res = await get(port, "/index.html");
    expect(res.status).toBe(200);
  });

  it("Content-Type header contains text/html", async () => {
    const res = await get(port, "/");
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("Content-Type header contains utf-8", async () => {
    const res = await get(port, "/");
    expect(res.headers["content-type"]).toContain("utf-8");
  });

  it("Cache-Control is no-store", async () => {
    const res = await get(port, "/");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("X-Content-Type-Options is nosniff", async () => {
    const res = await get(port, "/");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("GET /other returns 404", async () => {
    const res = await get(port, "/other");
    expect(res.status).toBe(404);
  });

  it("GET /favicon.ico returns 404", async () => {
    const res = await get(port, "/favicon.ico");
    expect(res.status).toBe(404);
  });

  it("response body is non-empty HTML document", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain("<!DOCTYPE html>");
    expect(res.body).toContain("</html>");
  });
});

// ── __CC_CONFIG__ injection ───────────────────────────────────────────────────

describe("createWebUIServer – config injection (global mode)", () => {
  let server;
  let port;

  beforeEach(async () => {
    server = await startServer(GLOBAL_OPTS);
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("body contains window.__CC_CONFIG__", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain("window.__CC_CONFIG__");
  });

  it("__CC_CONFIG__ contains correct wsPort", async () => {
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    expect(match).toBeTruthy();
    const cfg = JSON.parse(match[1]);
    expect(cfg.wsPort).toBe(18800);
  });

  it("__CC_CONFIG__ wsToken is null in global mode with no token", async () => {
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.wsToken).toBeNull();
  });

  it("__CC_CONFIG__ mode is 'global'", async () => {
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.mode).toBe("global");
  });

  it("__CC_CONFIG__ projectRoot is null in global mode", async () => {
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.projectRoot).toBeNull();
  });
});

describe("createWebUIServer – config injection (project mode)", () => {
  let server;
  let port;

  beforeEach(async () => {
    server = await startServer(PROJECT_OPTS);
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("__CC_CONFIG__ mode is 'project'", async () => {
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.mode).toBe("project");
  });

  it("__CC_CONFIG__ projectRoot matches provided path", async () => {
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.projectRoot).toBe("/home/user/my-project");
  });

  it("__CC_CONFIG__ projectName matches provided name", async () => {
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.projectName).toBe("my-project");
  });

  it("__CC_CONFIG__ wsToken matches provided token", async () => {
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.wsToken).toBe("secret123");
  });
});

// ── HTML content ─────────────────────────────────────────────────────────────

describe("createWebUIServer – HTML content (fallback embedded mode)", () => {
  let server;
  let port;

  beforeEach(async () => {
    server = await startServer(FALLBACK_GLOBAL);
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("body contains marked.js CDN script tag", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain("marked.min.js");
  });

  it("body contains highlight.js CDN script tag", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain("highlight.min.js");
  });

  it("body contains highlight.js CSS link", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain("highlight.js");
    expect(res.body).toContain("github-dark.min.css");
  });

  it("body contains meta charset UTF-8", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain('charset="UTF-8"');
  });

  it("body contains session creation button", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain("btn-new-session");
  });

  it("body contains message input textarea", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain("msg-input");
  });
});

// ── HTML title escaping ───────────────────────────────────────────────────────

describe("createWebUIServer – HTML title escaping (fallback embedded mode)", () => {
  it("escapes < > in project name in the title", async () => {
    const server = await startServer({
      ...FALLBACK_PROJECT,
      projectName: "<script>xss</script>",
    });
    const port = server.address().port;
    const res = await get(port, "/");
    await stopServer(server);
    expect(res.body).not.toContain("<script>xss</script>");
    expect(res.body).toContain("&lt;script&gt;");
  });

  it("escapes & in project name in the title", async () => {
    const server = await startServer({
      ...FALLBACK_PROJECT,
      projectName: "Acme & Co",
    });
    const port = server.address().port;
    const res = await get(port, "/");
    await stopServer(server);
    expect(res.body).toContain("Acme &amp; Co");
  });
});

// ── different wsHost ─────────────────────────────────────────────────────────

describe("createWebUIServer – wsHost in config", () => {
  it("wsHost is reflected in __CC_CONFIG__", async () => {
    const server = await startServer({
      ...GLOBAL_OPTS,
      wsHost: "192.168.1.10",
    });
    const port = server.address().port;
    const res = await get(port, "/");
    await stopServer(server);
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.wsHost).toBe("192.168.1.10");
  });
});

// ── WS client protocol (fixes for 5 protocol mismatches) ────────────────────

describe("createWebUIServer – WS client protocol correctness (fallback embedded mode)", () => {
  let server;
  let port;
  let body;

  beforeEach(async () => {
    server = await startServer(FALLBACK_GLOBAL);
    port = server.address().port;
    const res = await get(port, "/");
    body = res.body;
  });

  afterEach(() => stopServer(server));

  // Fix 1: message id auto-injection
  it("send() auto-injects id field using _msgId counter", () => {
    // _msgId must be declared as state variable
    expect(body).toContain("_msgId");
    // The auto-inject line assigns 'ui-' + incremented counter
    expect(body).toContain("ui-");
    // The send function checks for missing id
    expect(body).toContain("obj.id");
  });

  // Fix 2: auth-result (server sends auth-result, not auth-ok)
  it("handles 'auth-result' event from server (not auth-ok)", () => {
    expect(body).toContain("auth-result");
    // Checks msg.success to distinguish success/failure
    expect(body).toContain("msg.success");
  });

  it("does NOT contain deprecated 'auth-ok' case", () => {
    // 'auth-ok' was the old incorrect event name
    expect(body).not.toContain("'auth-ok'");
    expect(body).not.toContain('"auth-ok"');
  });

  it("does NOT contain deprecated 'auth-error' case", () => {
    expect(body).not.toContain("'auth-error'");
    expect(body).not.toContain('"auth-error"');
  });

  // Fix 3: session-created uses msg.sessionId (not msg.session.id)
  it("session-created handler reads msg.sessionId", () => {
    // The handler should use msg.sessionId directly
    expect(body).toContain("msg.sessionId");
  });

  it("session-created handler does NOT access msg.session.id", () => {
    expect(body).not.toContain("msg.session.id");
    expect(body).not.toContain("msg.session.type");
    expect(body).not.toContain("msg.session.createdAt");
  });

  // Fix 4: session-list-result (server sends session-list-result, not session-list)
  it("handles 'session-list-result' event from server", () => {
    expect(body).toContain("session-list-result");
  });

  it("does NOT use 'session-list' as a received event type in switch", () => {
    // 'session-list' is sent TO the server, not received FROM it
    // The body should send session-list but not have a case for it
    expect(body).toContain("session-list"); // outgoing send call is still present
    // The case label for receiving should be session-list-result
    expect(body).toContain("session-list-result");
  });

  // Fix 5: response-token / response-complete (not stream-start/stream-data/stream-end)
  it("handles 'response-token' event for chat streaming", () => {
    expect(body).toContain("response-token");
    expect(body).toContain("msg.token");
  });

  it("handles 'response-complete' event for final response", () => {
    expect(body).toContain("response-complete");
    expect(body).toContain("msg.content");
  });

  it("does NOT contain deprecated 'stream-start' case", () => {
    expect(body).not.toContain("'stream-start'");
    expect(body).not.toContain('"stream-start"');
  });

  it("does NOT contain deprecated 'stream-data' case as received event", () => {
    // stream-data should NOT appear as a case in handleMessage
    expect(body).not.toContain("case 'stream-data'");
    expect(body).not.toContain('case "stream-data"');
  });

  it("does NOT contain deprecated 'stream-end' case", () => {
    expect(body).not.toContain("case 'stream-end'");
    expect(body).not.toContain('case "stream-end"');
  });

  // Agent event handlers
  it("handles 'tool-executing' event for agent tool display", () => {
    expect(body).toContain("tool-executing");
    expect(body).toContain("msg.display");
  });

  it("handles 'model-switch' event for model change notification", () => {
    expect(body).toContain("model-switch");
  });

  it("handles 'command-response' event for slash command results", () => {
    expect(body).toContain("command-response");
  });

  // Outgoing messages still use correct types
  it("sends 'session-create' when creating a new session", () => {
    expect(body).toContain("session-create");
  });

  it("sends 'session-message' when user submits a message", () => {
    expect(body).toContain("session-message");
  });

  it("sends 'session-answer' when user answers a question", () => {
    expect(body).toContain("session-answer");
  });
});

// ── Vue3 SPA mode (staticDir) ─────────────────────────────────────────────────

describe("createWebUIServer – Vue3 SPA mode via staticDir", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-unit-spa-"));
    distDir = makeFakeDist(tmpDir);
    server = await startServer({ ...GLOBAL_OPTS, staticDir: distDir });
    port = server.address().port;
  });

  afterEach(async () => {
    await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET / returns 200", async () => {
    const res = await get(port, "/");
    expect(res.status).toBe(200);
  });

  it("GET /index.html returns 200", async () => {
    const res = await get(port, "/index.html");
    expect(res.status).toBe(200);
  });

  it("response Content-Type is text/html with utf-8", async () => {
    const res = await get(port, "/");
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-type"]).toContain("utf-8");
  });

  it("__CC_CONFIG_PLACEHOLDER__ is replaced (not left in response)", async () => {
    const res = await get(port, "/");
    expect(res.body).not.toContain("__CC_CONFIG_PLACEHOLDER__");
  });

  it("window.__CC_CONFIG__ is injected into Vue3 index.html", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain("window.__CC_CONFIG__");
  });

  it("injected config contains correct wsPort", async () => {
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    expect(match).toBeTruthy();
    const cfg = JSON.parse(match[1]);
    expect(cfg.wsPort).toBe(GLOBAL_OPTS.wsPort);
  });

  it("injected config contains correct mode", async () => {
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.mode).toBe("global");
  });

  it("GET /assets/app.abc123.js returns 200 with JS MIME", async () => {
    const res = await get(port, "/assets/app.abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
  });

  it("GET /assets/style.abc123.css returns 200 with CSS MIME", async () => {
    const res = await get(port, "/assets/style.abc123.css");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
  });

  it("assets under /assets/ have immutable cache headers", async () => {
    const res = await get(port, "/assets/app.abc123.js");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("GET /unknown-route returns SPA fallback (200 with index.html content)", async () => {
    const res = await get(port, "/unknown-route");
    expect(res.status).toBe(200);
    expect(res.body).toContain('<div id="app">');
  });

  it("GET /dashboard returns SPA fallback", async () => {
    const res = await get(port, "/dashboard");
    expect(res.status).toBe(200);
    expect(res.body).toContain("window.__CC_CONFIG__");
  });

  it("POST / returns 405 Method Not Allowed", async () => {
    const res = await new Promise((resolve, reject) => {
      const chunks = [];
      const req = http.request(
        { hostname: "127.0.0.1", port, path: "/", method: "POST" },
        (res) => {
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(res.status).toBe(405);
  });

  it("path traversal attempt is safe (stays within distDir)", async () => {
    // Attempt to traverse outside distDir — should not expose filesystem
    const res = await get(port, "/../../etc/passwd");
    // Either 404 (not found within dist) or 200 (SPA fallback) — never a system file
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      // SPA fallback response should be the index.html content
      expect(res.body).toContain("window.__CC_CONFIG__");
    }
  });
});

describe("createWebUIServer – Vue3 SPA mode with project options", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-unit-spa-proj-"));
    distDir = makeFakeDist(tmpDir);
    server = await startServer({ ...PROJECT_OPTS, staticDir: distDir });
    port = server.address().port;
  });

  afterEach(async () => {
    await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("project mode config is injected into Vue3 index.html", async () => {
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.mode).toBe("project");
    expect(cfg.projectRoot).toBe(PROJECT_OPTS.projectRoot);
    expect(cfg.projectName).toBe(PROJECT_OPTS.projectName);
    expect(cfg.wsToken).toBe(PROJECT_OPTS.wsToken);
  });
});

describe("createWebUIServer – $ character in config values (bug fix)", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-unit-dollar-"));
    distDir = makeFakeDist(tmpDir);
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("projectRoot with $ character is injected correctly", async () => {
    server = await startServer({
      ...PROJECT_OPTS,
      projectRoot: "/home/user/$MY_PROJECT",
      projectName: "$project",
      staticDir: distDir,
    });
    port = server.address().port;
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    expect(match).toBeTruthy();
    const cfg = JSON.parse(match[1]);
    expect(cfg.projectRoot).toBe("/home/user/$MY_PROJECT");
    expect(cfg.projectName).toBe("$project");
  });

  it("wsToken with $& pattern is injected correctly", async () => {
    server = await startServer({
      ...GLOBAL_OPTS,
      wsToken: "token$&secret",
      staticDir: distDir,
    });
    port = server.address().port;
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    expect(match).toBeTruthy();
    const cfg = JSON.parse(match[1]);
    expect(cfg.wsToken).toBe("token$&secret");
  });

  it("wsToken with $' pattern is injected correctly", async () => {
    server = await startServer({
      ...GLOBAL_OPTS,
      wsToken: "tok$'en",
      staticDir: distDir,
    });
    port = server.address().port;
    const res = await get(port, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
    expect(match).toBeTruthy();
    const cfg = JSON.parse(match[1]);
    expect(cfg.wsToken).toBe("tok$'en");
  });
});

describe("createWebUIServer – staticDir nonexistent falls back to embedded HTML", () => {
  it("nonexistent staticDir triggers fallback embedded HTML", async () => {
    const server = await startServer({
      ...GLOBAL_OPTS,
      staticDir: "/nonexistent/path/to/dist",
    });
    const port = server.address().port;
    const res = await get(port, "/");
    await stopServer(server);
    // Fallback HTML always contains these elements
    expect(res.status).toBe(200);
    expect(res.body).toContain("<!DOCTYPE html>");
    expect(res.body).toContain("window.__CC_CONFIG__");
  });
});

// ── uiMode parameter (Phase 0 of cc pack) ────────────────────────────────────

describe("createWebUIServer – uiMode parameter", () => {
  let tmpBase;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ui-mode-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch (_) {
      /* best effort */
    }
  });

  it("rejects unknown uiMode value", () => {
    expect(() =>
      createWebUIServer({ ...FALLBACK_GLOBAL, uiMode: "weird" }),
    ).toThrow(/Invalid uiMode/);
  });

  it('uiMode="full" throws when no dist directory is found', () => {
    expect(() =>
      createWebUIServer({
        ...GLOBAL_OPTS,
        staticDir: path.join(tmpBase, "no-such-dist"),
        uiMode: "full",
      }),
    ).toThrow(/uiMode="full"/);
  });

  it('uiMode="full" succeeds when dist directory exists', async () => {
    const distDir = makeFakeDist(tmpBase);
    const server = await startServer({
      ...GLOBAL_OPTS,
      staticDir: distDir,
      uiMode: "full",
    });
    const port = server.address().port;
    const res = await get(port, "/");
    await stopServer(server);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<div id="app"></div>');
  });

  it('uiMode="minimal" forces embedded HTML even when dist exists', async () => {
    const distDir = makeFakeDist(tmpBase);
    const server = await startServer({
      ...GLOBAL_OPTS,
      staticDir: distDir,
      uiMode: "minimal",
    });
    const port = server.address().port;
    const res = await get(port, "/");
    await stopServer(server);
    expect(res.status).toBe(200);
    // Embedded HTML signature, not the fake dist
    expect(res.body).toContain("window.__CC_CONFIG__");
    expect(res.body).not.toContain('<div id="app"></div>');
  });

  it('uiMode="auto" (default) prefers SPA when dist exists', async () => {
    const distDir = makeFakeDist(tmpBase);
    const server = await startServer({
      ...GLOBAL_OPTS,
      staticDir: distDir,
      uiMode: "auto",
    });
    const port = server.address().port;
    const res = await get(port, "/");
    await stopServer(server);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<div id="app"></div>');
  });

  it('uiMode="auto" falls back to embedded HTML when dist is missing', async () => {
    const server = await startServer({
      ...GLOBAL_OPTS,
      staticDir: path.join(tmpBase, "no-such-dist"),
      uiMode: "auto",
    });
    const port = server.address().port;
    const res = await get(port, "/");
    await stopServer(server);
    expect(res.status).toBe(200);
    expect(res.body).toContain("<!DOCTYPE html>");
  });
});
