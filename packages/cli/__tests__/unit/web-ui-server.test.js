/**
 * Unit tests: web-ui-server.js
 *
 * Tests the createWebUIServer factory and HTML generation logic.
 * Uses real HTTP requests against a loopback server started on a random port.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { createWebUIServer } from "../../src/lib/web-ui-server.js";

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

// ── createWebUIServer() return value ─────────────────────────────────────────

describe("createWebUIServer – return type", () => {
  it("returns an http.Server instance", () => {
    const server = createWebUIServer(GLOBAL_OPTS);
    expect(server).toBeInstanceOf(http.Server);
    server.close();
  });
});

// ── HTTP behaviour ───────────────────────────────────────────────────────────

describe("createWebUIServer – HTTP responses", () => {
  let server;
  let port;

  beforeEach(async () => {
    server = await startServer(GLOBAL_OPTS);
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

describe("createWebUIServer – HTML content", () => {
  let server;
  let port;

  beforeEach(async () => {
    server = await startServer(GLOBAL_OPTS);
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

describe("createWebUIServer – HTML title escaping", () => {
  it("escapes < > in project name in the title", async () => {
    const server = await startServer({
      ...PROJECT_OPTS,
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
      ...PROJECT_OPTS,
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
