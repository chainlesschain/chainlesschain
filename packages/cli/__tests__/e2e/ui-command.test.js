/**
 * E2E tests: chainlesschain ui command
 *
 * Tests the full CLI pipeline by executing the real chainlesschain binary.
 * Validates help output, server startup, HTML responses, and project detection.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.join(__dirname, "..", "..");
const bin = path.join(cliRoot, "bin", "chainlesschain.js");

// ── helpers ───────────────────────────────────────────────────────────────────

function run(args, opts = {}) {
  return execSync(`node "${bin}" ${args}`, {
    encoding: "utf-8",
    timeout: 30000,
    stdio: "pipe",
    ...opts,
  });
}

function tryRun(args, opts = {}) {
  try {
    const stdout = run(args, opts);
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status ?? 1,
    };
  }
}

/**
 * Spawn the ui server in the background and wait until it prints the HTTP URL.
 * Returns { proc, port } and kills the process in afterEach via the returned
 * `kill` function.
 */
function startUiServer({ httpPort, wsPort, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      bin,
      "ui",
      "--no-open",
      "--port",
      String(httpPort),
      "--ws-port",
      String(wsPort),
    ];

    const proc = spawn("node", args, {
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" },
      cwd: cwd || process.cwd(),
    });

    let output = "";
    let fallbackTimer = null;
    const done = (value) => {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      resolve(value);
    };
    const onData = (data) => {
      output += data.toString("utf8");
      // Server prints "UI:" with the URL once ready
      if (output.includes(`http://127.0.0.1:${httpPort}`)) {
        done({ proc, port: httpPort, output });
      }
    };

    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);

    proc.on("error", (err) => {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      reject(err);
    });

    // Fallback timeout — cleared once the server signals readiness
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (!proc.killed) {
        resolve({ proc, port: httpPort, output });
      }
    }, 8000);
  });
}

function httpGet(port, urlPath = "/") {
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

function killProc(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed || proc.exitCode !== null) {
      resolve();
      return;
    }
    let killTimer = null;
    const done = () => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      resolve();
    };
    proc.once("close", done);
    proc.kill("SIGTERM");
    killTimer = setTimeout(() => {
      killTimer = null;
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 2000);
  });
}

// ── temp workspace ────────────────────────────────────────────────────────────

let tmpWorkspace;

beforeAll(() => {
  tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-ui-"));
});

afterAll(() => {
  try {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  } catch {
    /* cleanup */
  }
});

// ── ui --help ─────────────────────────────────────────────────────────────────

describe("chainlesschain ui --help", () => {
  it("shows 'ui' command description", () => {
    const out = run("ui --help");
    expect(out.toLowerCase()).toContain("web");
  });

  it("shows --port option", () => {
    const out = run("ui --help");
    expect(out).toContain("--port");
  });

  it("shows --ws-port option", () => {
    const out = run("ui --help");
    expect(out).toContain("--ws-port");
  });

  it("shows --no-open option", () => {
    const out = run("ui --help");
    expect(out).toContain("--no-open");
  });

  it("shows --token option", () => {
    const out = run("ui --help");
    expect(out).toContain("--token");
  });

  it("shows default port 18810", () => {
    const out = run("ui --help");
    expect(out).toContain("18810");
  });

  it("shows default ws-port 18800", () => {
    const out = run("ui --help");
    expect(out).toContain("18800");
  });
});

// ── invalid options ───────────────────────────────────────────────────────────

describe("chainlesschain ui – invalid options", () => {
  it("exits non-zero for --port 0 (invalid)", () => {
    const result = tryRun("ui --port 0 --no-open");
    expect(result.exitCode).not.toBe(0);
  });

  it("exits non-zero for --port 99999 (out of range)", () => {
    const result = tryRun("ui --port 99999 --no-open");
    expect(result.exitCode).not.toBe(0);
  });

  it("exits non-zero for --ws-port 0 (invalid)", () => {
    const result = tryRun("ui --ws-port 0 --no-open");
    expect(result.exitCode).not.toBe(0);
  });
});

// ── server startup (global mode) ─────────────────────────────────────────────

describe("chainlesschain ui – server startup (global mode)", () => {
  const HTTP_PORT = 19870;
  const WS_PORT = 19871;
  let proc;
  let startOutput;

  // Start the server ONCE for all tests in this describe block.
  beforeAll(async () => {
    const result = await startUiServer({
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
      cwd: tmpWorkspace,
    });
    proc = result.proc;
    startOutput = result.output;
  });

  afterAll(async () => {
    await killProc(proc);
  });

  it("server starts and prints UI URL", () => {
    expect(startOutput).toContain(`http://127.0.0.1:${HTTP_PORT}`);
  });

  it("GET / returns HTTP 200", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.status).toBe(200);
  });

  it("response Content-Type is text/html", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("response body is a valid HTML document", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.body).toContain("<!DOCTYPE html>");
    expect(res.body).toContain("</html>");
  });

  it("response body contains __CC_CONFIG__", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.body).toContain("window.__CC_CONFIG__");
  });

  it("config wsPort matches --ws-port flag", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[\s\S]*?});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.wsPort).toBe(WS_PORT);
  });

  it("config contains a valid mode value", async () => {
    // mode depends on whether tmpWorkspace's ancestor tree has a .chainlesschain config;
    // we only verify the field exists and is a known value.
    const res = await httpGet(HTTP_PORT, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[\s\S]*?});/);
    const cfg = JSON.parse(match[1]);
    expect(["global", "project"]).toContain(cfg.mode);
  });

  it("GET /nonexistent is handled (404 in fallback mode, 200 SPA fallback in Vue3 mode)", async () => {
    const res = await httpGet(HTTP_PORT, "/nonexistent");
    // In fallback embedded mode: 404 for unknown routes.
    // In Vue3 SPA mode: 200 SPA fallback (index.html) — both are correct behaviour.
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toContain("window.__CC_CONFIG__");
    }
  });
});

// ── server startup (project mode) ────────────────────────────────────────────

describe("chainlesschain ui – server startup (project mode)", () => {
  const HTTP_PORT = 19872;
  const WS_PORT = 19873;
  let proc;
  let projectDir;
  let startOutput;

  beforeAll(async () => {
    // Create a minimal .chainlesschain project directory
    projectDir = path.join(tmpWorkspace, "test-project");
    fs.mkdirSync(path.join(projectDir, ".chainlesschain"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".chainlesschain", "config.json"),
      JSON.stringify({ name: "test-project", version: "1.0.0" }),
      "utf-8",
    );

    // Start the server ONCE for all tests in this describe block.
    const result = await startUiServer({
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
      cwd: projectDir,
    });
    proc = result.proc;
    startOutput = result.output;
  });

  afterAll(async () => {
    await killProc(proc);
  });

  it("server starts in project mode when run from project dir", () => {
    expect(startOutput).toContain(`http://127.0.0.1:${HTTP_PORT}`);
  });

  it("config mode is 'project'", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[\s\S]*?});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.mode).toBe("project");
  });

  it("config projectRoot points to the project directory", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[\s\S]*?});/);
    const cfg = JSON.parse(match[1]);
    // Resolve symlinks for cross-platform comparison (macOS /var → /private/var)
    expect(fs.realpathSync(cfg.projectRoot)).toBe(fs.realpathSync(projectDir));
  });

  it("config projectName is the project folder name", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[\s\S]*?});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.projectName).toBe("test-project");
  });

  it("startup output contains 'project' indicator", () => {
    // The server prints "Mode: project" or the project path in startup info
    expect(startOutput.toLowerCase()).toContain("project");
  });
});

// ── authentication ────────────────────────────────────────────────────────────

describe("chainlesschain ui – --token option", () => {
  const HTTP_PORT = 19874;
  const WS_PORT = 19875;
  let proc;

  afterAll(async () => {
    await killProc(proc);
  });

  it("server starts with --token and token appears in config", async () => {
    const args = [
      bin,
      "ui",
      "--no-open",
      "--port",
      String(HTTP_PORT),
      "--ws-port",
      String(WS_PORT),
      "--token",
      "e2e-test-token",
    ];

    proc = spawn("node", args, {
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" },
      cwd: tmpWorkspace,
    });

    // Wait for server to be ready
    await new Promise((resolve) => {
      let buf = "";
      let fallbackTimer = null;
      const done = () => {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        resolve();
      };
      const onData = (d) => {
        buf += d.toString("utf8");
        if (buf.includes(`http://127.0.0.1:${HTTP_PORT}`)) done();
      };
      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        resolve();
      }, 8000);
    });

    const res = await httpGet(HTTP_PORT, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[\s\S]*?});/);
    const cfg = JSON.parse(match[1]);
    expect(cfg.wsToken).toBe("e2e-test-token");
  });
});

// ── --web-panel-dir (Vue3 SPA mode) ──────────────────────────────────────────

/**
 * Create a minimal fake Vite dist for E2E testing of --web-panel-dir.
 */
function makeFakeDistE2E(baseDir) {
  const distDir = path.join(baseDir, "fake-dist");
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
  <div id="app" data-e2e="vue3-spa"></div>
</body>
</html>`,
    "utf-8",
  );

  fs.writeFileSync(
    path.join(assetsDir, "app.e2e123.js"),
    "window.__fake__=1;",
    "utf-8",
  );

  return distDir;
}

describe("chainlesschain ui – --web-panel-dir (Vue3 SPA mode)", () => {
  const HTTP_PORT = 19876;
  const WS_PORT = 19877;
  let proc;
  let fakeDist;

  beforeAll(async () => {
    fakeDist = makeFakeDistE2E(tmpWorkspace);

    const args = [
      bin,
      "ui",
      "--no-open",
      "--port",
      String(HTTP_PORT),
      "--ws-port",
      String(WS_PORT),
      "--web-panel-dir",
      fakeDist,
    ];

    proc = await new Promise((resolve, reject) => {
      const p = spawn("node", args, {
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0" },
        cwd: tmpWorkspace,
      });

      let output = "";
      let fallbackTimer = null;
      const done = (value) => {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        resolve(value);
      };
      const onData = (data) => {
        output += data.toString("utf8");
        if (output.includes(`http://127.0.0.1:${HTTP_PORT}`)) {
          done(p);
        }
      };
      p.stdout.on("data", onData);
      p.stderr.on("data", onData);
      p.on("error", (err) => {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        reject(err);
      });
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        resolve(p);
      }, 8000);
    });
  });

  afterAll(async () => {
    await killProc(proc);
  });

  it("server starts with --web-panel-dir and returns 200", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.status).toBe(200);
  });

  it("response contains Vue3 SPA markup (data-e2e attribute)", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.body).toContain('data-e2e="vue3-spa"');
  });

  it("__CC_CONFIG_PLACEHOLDER__ is replaced with actual config JSON", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.body).not.toContain("__CC_CONFIG_PLACEHOLDER__");
    expect(res.body).toContain("window.__CC_CONFIG__");
  });

  it("injected config wsPort matches --ws-port argument", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    const match = res.body.match(/window\.__CC_CONFIG__\s*=\s*({[\s\S]*?});/);
    expect(match).toBeTruthy();
    const cfg = JSON.parse(match[1]);
    expect(cfg.wsPort).toBe(WS_PORT);
  });

  it("GET /assets/app.e2e123.js returns 200 with JS content", async () => {
    const res = await httpGet(HTTP_PORT, "/assets/app.e2e123.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
  });

  it("unknown SPA routes return 200 with index.html (SPA fallback)", async () => {
    const res = await httpGet(HTTP_PORT, "/some/nested/route");
    expect(res.status).toBe(200);
    expect(res.body).toContain("window.__CC_CONFIG__");
  });
});
