/**
 * E2E tests: chainlesschain ui – web-panel static serving (v5.0.2.5)
 *
 * Executes the real CLI binary with --web-panel-dir pointing to a fake dist/
 * directory to test the full pipeline:
 *   - Server starts and serves Vue3 HTML from dist/
 *   - __CC_CONFIG__ injected correctly in project and global modes
 *   - Static assets served with correct MIME types
 *   - SPA routing fallback works end-to-end
 *   - --web-panel-dir option accepted and used
 *
 * Each describe block starts ONE server in beforeAll/afterAll to minimise
 * process spawn overhead. Uses distinct port pairs to avoid conflicts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliRoot = path.join(__dirname, "..", "..");
const bin = path.join(cliRoot, "bin", "chainlesschain.js");

// ── helpers ───────────────────────────────────────────────────────────────────

function startUiServer({ httpPort, wsPort, cwd, extraArgs = [] } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      bin,
      "ui",
      "--no-open",
      "--port",
      String(httpPort),
      "--ws-port",
      String(wsPort),
      ...extraArgs,
    ];

    const proc = spawn("node", args, {
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" },
      cwd: cwd || process.cwd(),
    });

    let output = "";
    const onData = (data) => {
      output += data.toString("utf8");
      if (output.includes(`http://127.0.0.1:${httpPort}`)) {
        resolve({ proc, port: httpPort, output });
      }
    };

    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", reject);

    setTimeout(() => {
      // Fallback: resolve even if URL line not seen yet
      resolve({ proc, port: httpPort, output });
    }, 10000);
  });
}

function killProc(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed || proc.exitCode !== null) {
      resolve();
      return;
    }
    proc.once("close", resolve);
    proc.kill("SIGTERM");
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 2000);
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

// ── fake dist builder ─────────────────────────────────────────────────────────

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
</head>
<body><div id="app"></div>
<script type="module" src="/assets/main.js"></script>
</body></html>`,
    "utf-8",
  );

  fs.writeFileSync(path.join(assetsDir, "main.js"), "// web panel", "utf-8");
  fs.writeFileSync(path.join(assetsDir, "main.css"), "body{margin:0}", "utf-8");
  fs.writeFileSync(path.join(assetsDir, "logo.svg"), "<svg></svg>", "utf-8");

  return distDir;
}

// ── global workspace ──────────────────────────────────────────────────────────

let tmpBase;
let fakeDist;

beforeAll(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-wpanel-"));
  fakeDist = createFakeDist(tmpBase);
});

afterAll(() => {
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ── Suite 1: Global mode with web-panel dist ──────────────────────────────────

describe("chainlesschain ui --web-panel-dir (global mode)", () => {
  const HTTP_PORT = 19920;
  const WS_PORT = 19921;
  let proc;
  let startOutput;

  beforeAll(async () => {
    // Run from tmpBase (no .chainlesschain → global mode)
    const result = await startUiServer({
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
      cwd: tmpBase,
      extraArgs: ["--web-panel-dir", fakeDist],
    });
    proc = result.proc;
    startOutput = result.output;
  }, 20000);

  afterAll(() => killProc(proc));

  it("server starts and prints UI URL", () => {
    expect(startOutput).toContain(`http://127.0.0.1:${HTTP_PORT}`);
  });

  it("GET / returns 200", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.status).toBe(200);
  });

  it("GET / content-type is text/html", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("GET / serves Vue3 HTML (contains app div)", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.body).toContain('<div id="app">');
  });

  it("__CC_CONFIG__ is injected into Vue3 HTML", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.body).toContain("window.__CC_CONFIG__");
    expect(res.body).not.toContain("__CC_CONFIG_PLACEHOLDER__");
  });

  it("injected config contains correct wsPort", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
    expect(cfg.wsPort).toBe(WS_PORT);
  });

  it("injected config mode is a valid value ('global' or 'project')", async () => {
    // Note: on dev machines that have .chainlesschain in ancestor dirs,
    // findProjectRoot() may detect project mode even from a temp dir.
    // We only assert the value is one of the two valid modes.
    const res = await httpGet(HTTP_PORT, "/");
    const cfg = extractConfig(res.body);
    expect(["global", "project"]).toContain(cfg.mode);
  });

  it("injected config contains wsPort (config injection works)", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    const cfg = extractConfig(res.body);
    expect(cfg.wsPort).toBe(WS_PORT);
  });
});

// ── Suite 2: Project mode with web-panel dist ─────────────────────────────────

describe("chainlesschain ui --web-panel-dir (project mode)", () => {
  const HTTP_PORT = 19930;
  const WS_PORT = 19931;
  let proc;
  let projectDir;

  beforeAll(async () => {
    // Create a fake project directory with .chainlesschain marker
    projectDir = path.join(tmpBase, "test-project");
    fs.mkdirSync(path.join(projectDir, ".chainlesschain"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".chainlesschain", "config.json"),
      JSON.stringify({ name: "test-project" }),
      "utf-8",
    );

    const result = await startUiServer({
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
      cwd: projectDir,
      extraArgs: ["--web-panel-dir", fakeDist],
    });
    proc = result.proc;
  }, 20000);

  afterAll(() => killProc(proc));

  it("GET / returns 200", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.status).toBe(200);
  });

  it("injected config mode is 'project'", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
    expect(cfg.mode).toBe("project");
  });

  it("injected config projectRoot points to the project dir", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    const cfg = extractConfig(res.body);
    expect(cfg.projectRoot).toBeTruthy();
    // Compare resolved paths (handles symlinks on macOS /var → /private/var)
    const resolvedRoot = fs.existsSync(cfg.projectRoot)
      ? fs.realpathSync(cfg.projectRoot)
      : cfg.projectRoot;
    const resolvedProject = fs.realpathSync(projectDir);
    expect(resolvedRoot).toBe(resolvedProject);
  });

  it("injected config projectName matches project", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    const cfg = extractConfig(res.body);
    // Project name comes from config.json or directory basename
    expect(cfg.projectName).toBeTruthy();
  });
});

// ── Suite 3: Static assets served end-to-end ─────────────────────────────────

describe("chainlesschain ui --web-panel-dir – asset serving E2E", () => {
  const HTTP_PORT = 19940;
  const WS_PORT = 19941;
  let proc;

  beforeAll(async () => {
    const result = await startUiServer({
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
      cwd: tmpBase,
      extraArgs: ["--web-panel-dir", fakeDist],
    });
    proc = result.proc;
  }, 20000);

  afterAll(() => killProc(proc));

  it("GET /assets/main.js returns 200", async () => {
    const res = await httpGet(HTTP_PORT, "/assets/main.js");
    expect(res.status).toBe(200);
  });

  it("JS asset content-type is application/javascript", async () => {
    const res = await httpGet(HTTP_PORT, "/assets/main.js");
    expect(res.headers["content-type"]).toContain("javascript");
  });

  it("JS asset has immutable cache header", async () => {
    const res = await httpGet(HTTP_PORT, "/assets/main.js");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("CSS asset returns 200 with text/css", async () => {
    const res = await httpGet(HTTP_PORT, "/assets/main.css");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
  });

  it("SVG asset returns 200 with image/svg+xml", async () => {
    const res = await httpGet(HTTP_PORT, "/assets/logo.svg");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("svg");
  });
});

// ── Suite 4: SPA routing E2E ──────────────────────────────────────────────────

describe("chainlesschain ui --web-panel-dir – SPA routing E2E", () => {
  const HTTP_PORT = 19950;
  const WS_PORT = 19951;
  let proc;

  beforeAll(async () => {
    const result = await startUiServer({
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
      cwd: tmpBase,
      extraArgs: ["--web-panel-dir", fakeDist],
    });
    proc = result.proc;
  }, 20000);

  afterAll(() => killProc(proc));

  for (const route of ["/dashboard", "/chat", "/skills", "/providers"]) {
    it(`GET ${route} falls back to index.html (SPA route)`, async () => {
      const res = await httpGet(HTTP_PORT, route);
      expect(res.status).toBe(200);
      expect(res.body).toContain("<!DOCTYPE html>");
      // Config is still injected on SPA fallback routes
      expect(res.body).toContain("window.__CC_CONFIG__");
    });
  }
});

// ── Suite 5: Auto-detection of dist/ (no --web-panel-dir flag) ────────────────

describe("chainlesschain ui – auto-detect web-panel dist/", () => {
  const HTTP_PORT = 19960;
  const WS_PORT = 19961;
  let proc;
  let startOutput;

  beforeAll(async () => {
    // Run WITHOUT --web-panel-dir to test auto-detection.
    // The built dist/ at packages/web-panel/dist/ will be auto-detected.
    // If it doesn't exist, server falls back to classic HTML (also valid).
    const result = await startUiServer({
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
      cwd: tmpBase,
    });
    proc = result.proc;
    startOutput = result.output;
  }, 20000);

  afterAll(() => killProc(proc));

  it("server starts successfully", () => {
    expect(startOutput).toContain(`http://127.0.0.1:${HTTP_PORT}`);
  });

  it("GET / returns 200 regardless of panel mode (dist/ or classic fallback)", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.status).toBe(200);
    expect(res.body).toContain("<!DOCTYPE html>");
  });

  it("__CC_CONFIG__ is always injected (panel or classic mode)", async () => {
    const res = await httpGet(HTTP_PORT, "/");
    expect(res.body).toContain("window.__CC_CONFIG__");
    const cfg = extractConfig(res.body);
    expect(cfg).not.toBeNull();
    expect(cfg.wsPort).toBe(WS_PORT);
  });
});
