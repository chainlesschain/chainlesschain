/**
 * Unit tests: web-ui-server.js – static web-panel serving
 *
 * Tests the new static-file serving path added in v5.0.2.5:
 *   - findWebPanelDist() auto-detection via opts.staticDir
 *   - index.html served with __CC_CONFIG_PLACEHOLDER__ replaced
 *   - Static assets served with correct MIME types and cache headers
 *   - Path-traversal prevention
 *   - SPA fallback (unknown paths → index.html)
 *   - Fallback to classic embedded HTML when dist/ absent
 *
 * Uses real HTTP servers on ephemeral ports and a real temp directory
 * for the mock dist/ tree. No vi.mock() for Node built-ins.
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
import path from "node:path";
import os from "node:os";
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

function get(port, urlPath = "/") {
  return new Promise((resolve, reject) => {
    const chunks = [];
    http
      .get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
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

function extractConfig(body) {
  // Match both the Vue3 placeholder pattern and the classic embedded pattern
  const m =
    body.match(/window\.__CC_CONFIG__\s*=\s*({[\s\S]*?});/) ||
    body.match(/window\.__CC_CONFIG__\s*=\s*({[^;]+});/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// ── fake dist/ directory ──────────────────────────────────────────────────────

/**
 * Create a minimal fake dist/ tree that mimics a Vite build output.
 * Returns the dist directory path.
 */
function createFakeDist(baseDir) {
  const distDir = path.join(baseDir, "dist");
  const assetsDir = path.join(distDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  // index.html with config placeholder (as Vite would build it)
  fs.writeFileSync(
    path.join(distDir, "index.html"),
    `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>ChainlessChain 管理面板</title>
  <script>
    window.__CC_CONFIG__ = __CC_CONFIG_PLACEHOLDER__;
  </script>
  <link rel="stylesheet" href="/assets/index.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/assets/index.js"></script>
</body>
</html>`,
    "utf-8",
  );

  // Static assets
  fs.writeFileSync(
    path.join(assetsDir, "index.js"),
    "// fake bundled JS\nconsole.log('web panel');",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(assetsDir, "index.css"),
    "body { background: #141414; }",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(assetsDir, "icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>',
    "utf-8",
  );
  fs.writeFileSync(path.join(assetsDir, "font.woff2"), Buffer.alloc(8, 0));

  return distDir;
}

// ── shared fixtures ────────────────────────────────────────────────────────────

const BASE_OPTS = {
  wsPort: 18800,
  wsToken: null,
  wsHost: "127.0.0.1",
  projectRoot: null,
  projectName: null,
  mode: "global",
};

// ── Panel mode: static files served ──────────────────────────────────────────

describe("createWebUIServer – static panel mode (dist/ present)", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wpanel-unit-"));
    distDir = createFakeDist(tmpDir);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  beforeEach(async () => {
    server = await startServer({ ...BASE_OPTS, staticDir: distDir });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("GET / returns 200", async () => {
    const res = await get(port, "/");
    expect(res.status).toBe(200);
  });

  it("Content-Type is text/html", async () => {
    const res = await get(port, "/");
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("Cache-Control is no-store for index.html", async () => {
    const res = await get(port, "/");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("index.html contains <!DOCTYPE html>", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain("<!DOCTYPE html>");
  });

  it("__CC_CONFIG_PLACEHOLDER__ is replaced with real JSON", async () => {
    const res = await get(port, "/");
    expect(res.body).not.toContain("__CC_CONFIG_PLACEHOLDER__");
    expect(res.body).toContain("window.__CC_CONFIG__");
  });

  it("injected __CC_CONFIG__ is valid JSON", async () => {
    const res = await get(port, "/");
    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
  });

  it("injected wsPort matches opts", async () => {
    const res = await get(port, "/");
    const cfg = extractConfig(res.body);
    expect(cfg.wsPort).toBe(18800);
  });

  it("injected mode is 'global'", async () => {
    const res = await get(port, "/");
    const cfg = extractConfig(res.body);
    expect(cfg.mode).toBe("global");
  });

  it("injected projectRoot is null in global mode", async () => {
    const res = await get(port, "/");
    const cfg = extractConfig(res.body);
    expect(cfg.projectRoot).toBeNull();
  });
});

// ── Panel mode: project opts ──────────────────────────────────────────────────

describe("createWebUIServer – static panel mode config injection (project mode)", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  const PROJECT_OPTS = {
    wsPort: 18800,
    wsToken: "tok123",
    wsHost: "127.0.0.1",
    projectRoot: "/home/user/my-project",
    projectName: "my-project",
    mode: "project",
  };

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wpanel-proj-"));
    distDir = createFakeDist(tmpDir);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  beforeEach(async () => {
    server = await startServer({ ...PROJECT_OPTS, staticDir: distDir });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("injected mode is 'project'", async () => {
    const res = await get(port, "/");
    const cfg = extractConfig(res.body);
    expect(cfg.mode).toBe("project");
  });

  it("injected projectRoot matches opts", async () => {
    const res = await get(port, "/");
    const cfg = extractConfig(res.body);
    expect(cfg.projectRoot).toBe("/home/user/my-project");
  });

  it("injected projectName matches opts", async () => {
    const res = await get(port, "/");
    const cfg = extractConfig(res.body);
    expect(cfg.projectName).toBe("my-project");
  });

  it("injected wsToken matches opts", async () => {
    const res = await get(port, "/");
    const cfg = extractConfig(res.body);
    expect(cfg.wsToken).toBe("tok123");
  });

  it("injected wsHost matches opts", async () => {
    const res = await get(port, "/");
    const cfg = extractConfig(res.body);
    expect(cfg.wsHost).toBe("127.0.0.1");
  });
});

// ── Panel mode: static asset serving ─────────────────────────────────────────

describe("createWebUIServer – static asset serving", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wpanel-assets-"));
    distDir = createFakeDist(tmpDir);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  beforeEach(async () => {
    server = await startServer({ ...BASE_OPTS, staticDir: distDir });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("GET /assets/index.js returns 200", async () => {
    const res = await get(port, "/assets/index.js");
    expect(res.status).toBe(200);
  });

  it("GET /assets/index.js Content-Type is application/javascript", async () => {
    const res = await get(port, "/assets/index.js");
    expect(res.headers["content-type"]).toContain("application/javascript");
  });

  it("GET /assets/index.css returns 200", async () => {
    const res = await get(port, "/assets/index.css");
    expect(res.status).toBe(200);
  });

  it("GET /assets/index.css Content-Type is text/css", async () => {
    const res = await get(port, "/assets/index.css");
    expect(res.headers["content-type"]).toContain("text/css");
  });

  it("GET /assets/icon.svg returns 200", async () => {
    const res = await get(port, "/assets/icon.svg");
    expect(res.status).toBe(200);
  });

  it("GET /assets/icon.svg Content-Type is image/svg+xml", async () => {
    const res = await get(port, "/assets/icon.svg");
    expect(res.headers["content-type"]).toContain("image/svg+xml");
  });

  it("GET /assets/font.woff2 Content-Type is font/woff2", async () => {
    const res = await get(port, "/assets/font.woff2");
    expect(res.headers["content-type"]).toContain("font/woff2");
  });

  it("assets under /assets/ have immutable cache header", async () => {
    const res = await get(port, "/assets/index.js");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("assets body matches file contents", async () => {
    const res = await get(port, "/assets/index.css");
    expect(res.body).toContain("background: #141414");
  });
});

// ── Panel mode: SPA routing fallback ─────────────────────────────────────────

describe("createWebUIServer – SPA routing fallback", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wpanel-spa-"));
    distDir = createFakeDist(tmpDir);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  beforeEach(async () => {
    server = await startServer({ ...BASE_OPTS, staticDir: distDir });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("GET /dashboard returns index.html (SPA route)", async () => {
    const res = await get(port, "/dashboard");
    expect(res.status).toBe(200);
    expect(res.body).toContain("<!DOCTYPE html>");
  });

  it("GET /chat returns index.html (SPA route)", async () => {
    const res = await get(port, "/chat");
    expect(res.status).toBe(200);
    expect(res.body).toContain("<!DOCTYPE html>");
  });

  it("GET /skills returns index.html (SPA route)", async () => {
    const res = await get(port, "/skills");
    expect(res.status).toBe(200);
    expect(res.body).toContain("<!DOCTYPE html>");
  });

  it("SPA fallback also injects __CC_CONFIG__", async () => {
    const res = await get(port, "/providers");
    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
    expect(cfg.wsPort).toBe(18800);
  });

  it("GET /index.html returns index.html", async () => {
    const res = await get(port, "/index.html");
    expect(res.status).toBe(200);
    expect(res.body).toContain("<!DOCTYPE html>");
  });
});

// ── Panel mode: path traversal prevention ────────────────────────────────────

describe("createWebUIServer – path traversal prevention", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;
  // Sentinel file outside dist/ that must never be served
  let sentinelPath;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wpanel-sec-"));
    distDir = createFakeDist(tmpDir);
    sentinelPath = path.join(tmpDir, "secret.txt");
    fs.writeFileSync(sentinelPath, "TOP_SECRET", "utf-8");
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  beforeEach(async () => {
    server = await startServer({ ...BASE_OPTS, staticDir: distDir });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("GET /../secret.txt does not serve file outside dist/", async () => {
    const res = await get(port, "/../secret.txt");
    // Must either 200 (SPA fallback) or 404 – but NEVER the secret content
    expect(res.body).not.toContain("TOP_SECRET");
  });

  it("GET /../../etc/passwd does not serve sensitive file", async () => {
    const res = await get(port, "/../../etc/passwd");
    expect(res.body).not.toContain("root:");
    expect(res.body).not.toContain("TOP_SECRET");
  });
});

// ── Fallback mode: no dist/ ────────────────────────────────────────────────────

describe("createWebUIServer – classic HTML fallback (no dist/)", () => {
  let server;
  let port;

  beforeEach(async () => {
    // Pass a staticDir that does NOT exist → should fall back to embedded HTML
    server = await startServer({
      ...BASE_OPTS,
      staticDir: "/nonexistent/path/that/cannot/exist",
    });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("GET / still returns 200", async () => {
    const res = await get(port, "/");
    expect(res.status).toBe(200);
  });

  it("response is HTML", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain("<!DOCTYPE html>");
  });

  it("falls back to classic embedded HTML (contains WS connect script)", async () => {
    const res = await get(port, "/");
    // Classic HTML has inline JS with WebSocket client code
    expect(res.body).toContain("WebSocket");
  });

  it("__CC_CONFIG__ still injected in fallback mode", async () => {
    const res = await get(port, "/");
    expect(res.body).toContain("window.__CC_CONFIG__");
    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
    expect(cfg.wsPort).toBe(18800);
  });

  it("GET /favicon.ico returns 404 in fallback mode", async () => {
    const res = await get(port, "/favicon.ico");
    expect(res.status).toBe(404);
  });
});

// ── XSS safety: config values are escaped ────────────────────────────────────

describe("createWebUIServer – XSS safety in injected config", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  const XSS_OPTS = {
    wsPort: 18800,
    wsToken: null,
    wsHost: "127.0.0.1",
    projectRoot: "/tmp/proj</script><script>alert(1)",
    projectName: 'evil"name',
    mode: "project",
  };

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wpanel-xss-"));
    distDir = createFakeDist(tmpDir);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  beforeEach(async () => {
    server = await startServer({ ...XSS_OPTS, staticDir: distDir });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("raw </script> tag is not present in body (escaped in JSON)", async () => {
    const res = await get(port, "/");
    // JSON.stringify escapes < as \u003c so no raw </script> should appear
    expect(res.body).not.toContain("</script><script>alert(1)");
  });

  it("config is still parseable despite special chars", async () => {
    const res = await get(port, "/");
    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
    expect(cfg.projectRoot).toContain("</script>");
  });
});
