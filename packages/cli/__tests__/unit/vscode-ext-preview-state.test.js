/**
 * getPreviewState bridge tool + MCP server audit hardening:
 *  - PreviewController captures a dev-server output tail and exposes state()
 *  - buildIdeTools exposes getPreviewState conditionally
 *  - IdeMcpServer bearer auth is timing-safe and length-mismatch-safe
 */
import { describe, it, expect, vi } from "vitest";
import http from "http";
import { PreviewController } from "../../../vscode-extension/src/preview.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";
import { IdeMcpServer } from "../../../vscode-extension/src/mcp-http-server.js";

function makeChild() {
  const handlers = { stdout: [], stderr: [], exit: [] };
  const child = {
    killed: false,
    stdout: { on: (_e, fn) => handlers.stdout.push(fn) },
    stderr: { on: (_e, fn) => handlers.stderr.push(fn) },
    on: (e, fn) => {
      if (e === "exit") handlers.exit.push(fn);
    },
    kill: () => {
      child.killed = true;
    },
    _emitStdout: (s) => handlers.stdout.forEach((fn) => fn(s)),
    _emitStderr: (s) => handlers.stderr.forEach((fn) => fn(s)),
    _emitExit: (code) => handlers.exit.forEach((fn) => fn(code)),
  };
  return child;
}

function makeController() {
  const child = makeChild();
  const ctrl = new PreviewController({
    spawn: vi.fn(() => child),
    openUrl: () => {},
    readPackageJson: () => ({ scripts: { dev: "vite" } }),
    onStatus: () => {},
  });
  return { ctrl, child };
}

describe("PreviewController.state()", () => {
  it("reports not-running before any start", () => {
    const { ctrl } = makeController();
    expect(ctrl.state()).toEqual({
      running: false,
      url: null,
      script: null,
      exitCode: null,
      output: "",
    });
  });

  it("captures output (also after the URL is found) and the crash exit code", () => {
    const { ctrl, child } = makeController();
    ctrl.start("/ws");
    child._emitStdout("VITE ready\n  ➜  Local: http://localhost:5173/\n");
    // Build error AFTER the URL — exactly what the agent needs to read.
    child._emitStderr("[vite] Internal server error: boom\n");
    const running = ctrl.state();
    expect(running).toMatchObject({
      running: true,
      url: "http://localhost:5173/",
      script: "dev",
      exitCode: null,
    });
    expect(running.output).toContain("Internal server error: boom");
    expect(running.output).toContain("VITE ready");

    child._emitExit(1);
    const crashed = ctrl.state();
    expect(crashed.running).toBe(false);
    expect(crashed.exitCode).toBe(1);
    // Output survives the crash so the agent can diagnose it.
    expect(crashed.output).toContain("boom");
  });

  it("caps the output tail and resets it on restart", () => {
    const { ctrl, child } = makeController();
    ctrl.start("/ws");
    child._emitStdout("x".repeat(PreviewController.MAX_TAIL_CHARS + 500));
    expect(ctrl.state().output.length).toBe(PreviewController.MAX_TAIL_CHARS);
    child._emitExit(1);
    ctrl.start("/ws");
    expect(ctrl.state().output).toBe("");
  });
});

describe("getPreviewState tool exposure", () => {
  it("is exposed only when the facade supports it, and passes state through", async () => {
    const bare = buildIdeTools({
      getSelection: () => null,
      getDiagnostics: () => [],
      getOpenEditors: () => [],
      openDiff: async () => null,
    });
    expect(bare.find((t) => t.name === "getPreviewState")).toBeUndefined();

    const state = {
      running: true,
      url: "http://localhost:5173/",
      output: "ok",
    };
    const tools = buildIdeTools({
      getSelection: () => null,
      getDiagnostics: () => [],
      getOpenEditors: () => [],
      openDiff: async () => null,
      getPreviewState: async () => state,
    });
    const tool = tools.find((t) => t.name === "getPreviewState");
    expect(tool).toBeDefined();
    expect(await tool.handler({})).toBe(state);

    const broken = buildIdeTools({
      getSelection: () => null,
      getDiagnostics: () => [],
      getOpenEditors: () => [],
      openDiff: async () => null,
      getPreviewState: async () => null,
    });
    expect(
      await broken.find((t) => t.name === "getPreviewState").handler({}),
    ).toMatchObject({ running: false });
  });
});

describe("IdeMcpServer bearer auth (timing-safe)", () => {
  async function post(port, token, body) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
        (res) => {
          let data = "";
          res.on("data", (d) => (data += d));
          res.on("end", () => resolve({ status: res.statusCode, data }));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  }

  it("accepts the right token, rejects wrong and wrong-length tokens", async () => {
    const server = new IdeMcpServer({ tools: [], token: "secret-token" });
    const port = await server.start({ host: "127.0.0.1", port: 0 });
    try {
      const ok = await post(port, "secret-token", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      expect(ok.status).toBe(200);
      // Same length, different bytes.
      const wrong = await post(port, "secret-tokeX", {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      expect(wrong.status).toBe(401);
      // Different length must 401 too (timingSafeEqual throws on length
      // mismatch — the guard must handle it, not crash the server).
      const short = await post(port, "x", {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
      });
      expect(short.status).toBe(401);
      const missing = await post(port, null, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
      });
      expect(missing.status).toBe(401);
    } finally {
      await server.stop();
    }
  });
});
