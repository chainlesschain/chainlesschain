/**
 * Integration tests: web-panel static serving pipeline
 *
 * Tests the full HTTP pipeline with a realistic fake dist/ directory:
 *   - Config injection into Vue3 index.html
 *   - Asset MIME types and caching
 *   - SPA routing fallback
 *   - Project vs global mode differences
 *   - Fallback to classic embedded HTML when dist/ absent
 *   - POST/PUT/DELETE method rejection
 *
 * Uses real HTTP servers on ephemeral ports. No CLI subprocess.
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

function request(port, { method = "GET", urlPath = "/" } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = http.request(
      { hostname: "127.0.0.1", port, path: urlPath, method },
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

// ── fake dist/ builder ────────────────────────────────────────────────────────

function createFakeDist(baseDir) {
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
  <link rel="stylesheet" href="/assets/main.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/assets/main.js"></script>
</body>
</html>`,
    "utf-8",
  );

  fs.writeFileSync(
    path.join(assetsDir, "main.js"),
    "// web panel bundle",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(assetsDir, "main.css"),
    "body{margin:0;background:#141414}",
    "utf-8",
  );
  fs.writeFileSync(path.join(assetsDir, "logo.svg"), "<svg></svg>", "utf-8");
  fs.writeFileSync(path.join(assetsDir, "data.json"), '{"v":1}', "utf-8");

  return distDir;
}

// ── Suite 1: Config injection pipeline ───────────────────────────────────────

describe("web-panel integration – config injection pipeline", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wp-intg-cfg-"));
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
    server = await startServer({
      wsPort: 18800,
      wsToken: "secret",
      wsHost: "127.0.0.1",
      projectRoot: "/projects/my-app",
      projectName: "my-app",
      mode: "project",
      staticDir: distDir,
    });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("placeholder is absent from served HTML", async () => {
    const res = await request(port, { urlPath: "/" });
    expect(res.body).not.toContain("__CC_CONFIG_PLACEHOLDER__");
  });

  it("config is embedded as valid JSON object", async () => {
    const res = await request(port, { urlPath: "/" });
    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
    expect(typeof cfg).toBe("object");
  });

  it("all six config fields are present", async () => {
    const res = await request(port, { urlPath: "/" });
    const cfg = extractConfig(res.body);
    expect(cfg).toHaveProperty("wsPort");
    expect(cfg).toHaveProperty("wsToken");
    expect(cfg).toHaveProperty("wsHost");
    expect(cfg).toHaveProperty("projectRoot");
    expect(cfg).toHaveProperty("projectName");
    expect(cfg).toHaveProperty("mode");
  });

  it("wsToken value is injected correctly", async () => {
    const res = await request(port, { urlPath: "/" });
    const cfg = extractConfig(res.body);
    expect(cfg.wsToken).toBe("secret");
  });

  it("projectRoot value is injected correctly", async () => {
    const res = await request(port, { urlPath: "/" });
    const cfg = extractConfig(res.body);
    expect(cfg.projectRoot).toBe("/projects/my-app");
  });

  it("mode value is 'project'", async () => {
    const res = await request(port, { urlPath: "/" });
    const cfg = extractConfig(res.body);
    expect(cfg.mode).toBe("project");
  });
});

// ── Suite 2: Global mode config ───────────────────────────────────────────────

describe("web-panel integration – global mode config", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wp-intg-global-"));
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
    server = await startServer({
      wsPort: 18800,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
      staticDir: distDir,
    });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("mode is 'global'", async () => {
    const res = await request(port, { urlPath: "/" });
    const cfg = extractConfig(res.body);
    expect(cfg.mode).toBe("global");
  });

  it("projectRoot is null", async () => {
    const res = await request(port, { urlPath: "/" });
    const cfg = extractConfig(res.body);
    expect(cfg.projectRoot).toBeNull();
  });

  it("projectName is null", async () => {
    const res = await request(port, { urlPath: "/" });
    const cfg = extractConfig(res.body);
    expect(cfg.projectName).toBeNull();
  });

  it("wsToken is null in global mode (no auth)", async () => {
    const res = await request(port, { urlPath: "/" });
    const cfg = extractConfig(res.body);
    expect(cfg.wsToken).toBeNull();
  });
});

// ── Suite 3: Asset serving pipeline ──────────────────────────────────────────

describe("web-panel integration – asset serving pipeline", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wp-intg-assets-"));
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
    server = await startServer({
      wsPort: 18800,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
      staticDir: distDir,
    });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("JS asset returns 200 with correct Content-Type", async () => {
    const res = await request(port, { urlPath: "/assets/main.js" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/javascript");
  });

  it("CSS asset returns 200 with correct Content-Type", async () => {
    const res = await request(port, { urlPath: "/assets/main.css" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
  });

  it("SVG asset returns 200 with correct Content-Type", async () => {
    const res = await request(port, { urlPath: "/assets/logo.svg" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("svg");
  });

  it("JSON asset returns 200 with correct Content-Type", async () => {
    const res = await request(port, { urlPath: "/assets/data.json" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("assets in /assets/ get immutable cache-control", async () => {
    const res = await request(port, { urlPath: "/assets/main.js" });
    const cc = res.headers["cache-control"] || "";
    expect(cc).toContain("immutable");
  });

  it("asset body content is correct", async () => {
    const res = await request(port, { urlPath: "/assets/main.css" });
    expect(res.body).toContain("background:#141414");
  });

  it("non-existent asset falls back to SPA index.html", async () => {
    const res = await request(port, {
      urlPath: "/assets/nonexistent-abc123.js",
    });
    // SPA fallback: returns index.html with injected config
    expect(res.status).toBe(200);
    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
  });
});

// ── Suite 4: SPA routing ──────────────────────────────────────────────────────

describe("web-panel integration – SPA routing", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wp-intg-spa-"));
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
    server = await startServer({
      wsPort: 18800,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
      staticDir: distDir,
    });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  for (const route of [
    "/",
    "/dashboard",
    "/chat",
    "/skills",
    "/providers",
    "/index.html",
  ]) {
    it(`GET ${route} serves index.html`, async () => {
      const res = await request(port, { urlPath: route });
      expect(res.status).toBe(200);
      expect(res.body).toContain("<!DOCTYPE html>");
      expect(res.body).toContain("window.__CC_CONFIG__");
    });
  }

  it("unknown deep path also falls back to SPA", async () => {
    const res = await request(port, { urlPath: "/some/deep/unknown/route" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("<!DOCTYPE html>");
  });
});

// ── Suite 5: HTTP method restrictions ────────────────────────────────────────

describe("web-panel integration – HTTP method restrictions", () => {
  let tmpDir;
  let distDir;
  let server;
  let port;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wp-intg-methods-"));
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
    server = await startServer({
      wsPort: 18800,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
      staticDir: distDir,
    });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("POST / returns 405", async () => {
    const res = await request(port, { method: "POST", urlPath: "/" });
    expect(res.status).toBe(405);
  });

  it("DELETE / returns 405", async () => {
    const res = await request(port, { method: "DELETE", urlPath: "/" });
    expect(res.status).toBe(405);
  });

  it("PUT /assets/main.js returns 405", async () => {
    const res = await request(port, {
      method: "PUT",
      urlPath: "/assets/main.js",
    });
    expect(res.status).toBe(405);
  });
});

// ── Suite 6: Fallback to classic HTML ────────────────────────────────────────

describe("web-panel integration – classic HTML fallback when no dist/", () => {
  let server;
  let port;

  beforeEach(async () => {
    server = await startServer({
      wsPort: 18800,
      wsToken: null,
      wsHost: "127.0.0.1",
      projectRoot: null,
      projectName: null,
      mode: "global",
      staticDir: "/path/that/definitely/does/not/exist/at/all",
    });
    port = server.address().port;
  });

  afterEach(() => stopServer(server));

  it("GET / returns 200 via fallback", async () => {
    const res = await request(port, { urlPath: "/" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("fallback HTML contains WebSocket client code", async () => {
    const res = await request(port, { urlPath: "/" });
    expect(res.body).toContain("WebSocket");
  });

  it("fallback HTML injects config", async () => {
    const res = await request(port, { urlPath: "/" });
    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
    expect(cfg.mode).toBe("global");
  });

  it("fallback: GET /other returns 404 (no SPA routing)", async () => {
    const res = await request(port, { urlPath: "/other-route" });
    expect(res.status).toBe(404);
  });
});
