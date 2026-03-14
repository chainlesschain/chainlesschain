/**
 * E2E tests for `chainlesschain serve` command
 *
 * Launches the actual CLI serve command as a child process, connects via
 * WebSocket, and validates the full end-to-end protocol.
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

const E2E_PORT = 19300;
let portCounter = 0;
function nextPort() {
  return E2E_PORT + portCounter++;
}

/** Spawn the serve command */
function startServer(args = []) {
  const child = spawn(process.execPath, [bin, "serve", ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  return child;
}

/** Wait until the server is ready by polling for WS connection */
async function waitForReady(port, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ws = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const timer = setTimeout(() => {
          ws.terminate();
          reject(new Error("Connection timeout"));
        }, 1000);
        ws.on("open", () => {
          clearTimeout(timer);
          resolve(ws);
        });
        ws.on("error", () => {
          clearTimeout(timer);
          reject(new Error("Connection error"));
        });
      });
      return ws;
    } catch (_err) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(
    `Server did not become ready on port ${port} within ${timeoutMs}ms`,
  );
}

/** Send JSON and receive one response */
function rpc(ws, msg) {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString("utf8"))));
    ws.send(JSON.stringify(msg));
  });
}

/** Collect N messages */
function collectMessages(ws, n, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const msgs = [];
    const timer = setTimeout(() => {
      ws.removeListener("message", handler);
      resolve(msgs);
    }, timeoutMs);
    const handler = (data) => {
      msgs.push(JSON.parse(data.toString("utf8")));
      if (msgs.length >= n) {
        clearTimeout(timer);
        ws.removeListener("message", handler);
        resolve(msgs);
      }
    };
    ws.on("message", handler);
  });
}

describe("E2E: chainlesschain serve", () => {
  let child;
  let ws;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (child && !child.killed) {
      child.kill("SIGTERM");
      // Wait for child to exit
      await new Promise((resolve) => {
        child.on("exit", resolve);
        setTimeout(resolve, 2000);
      });
    }
  });

  it("serve --help shows usage", () => {
    const { execSync } = require("node:child_process");
    const output = execSync(`node ${bin} serve --help`, {
      encoding: "utf-8",
    });
    expect(output).toContain("Start WebSocket server");
    expect(output).toContain("--port");
    expect(output).toContain("--token");
    expect(output).toContain("--allow-remote");
  });

  it("starts server, accepts connection, and executes command", async () => {
    const port = nextPort();
    child = startServer(["--port", String(port)]);

    ws = await waitForReady(port);

    // Ping
    const pong = await rpc(ws, { id: "1", type: "ping" });
    expect(pong.type).toBe("pong");
    expect(typeof pong.serverTime).toBe("number");

    // Execute --version
    const result = await rpc(ws, {
      id: "2",
      type: "execute",
      command: "--version",
    });
    expect(result.type).toBe("result");
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 15000);

  it("enforces token authentication", async () => {
    const port = nextPort();
    child = startServer(["--port", String(port), "--token", "e2e-secret"]);

    ws = await waitForReady(port);

    // Command without auth should fail
    const failResp = await rpc(ws, {
      id: "1",
      type: "execute",
      command: "--version",
    });
    expect(failResp.type).toBe("error");
    expect(failResp.code).toBe("AUTH_REQUIRED");

    // Authenticate
    const authResp = await rpc(ws, {
      id: "2",
      type: "auth",
      token: "e2e-secret",
    });
    expect(authResp.success).toBe(true);

    // Now command should work
    const okResp = await rpc(ws, {
      id: "3",
      type: "execute",
      command: "--version",
    });
    expect(okResp.type).toBe("result");
    expect(okResp.success).toBe(true);
  }, 15000);

  it("streams command output", async () => {
    const port = nextPort();
    child = startServer(["--port", String(port)]);

    ws = await waitForReady(port);

    const msgPromise = collectMessages(ws, 2);
    ws.send(JSON.stringify({ id: "s1", type: "stream", command: "--version" }));
    const msgs = await msgPromise;

    const dataMsg = msgs.find((m) => m.type === "stream-data");
    const endMsg = msgs.find((m) => m.type === "stream-end");

    expect(dataMsg).toBeDefined();
    expect(dataMsg.channel).toBe("stdout");
    expect(endMsg).toBeDefined();
    expect(endMsg.exitCode).toBe(0);
  }, 15000);

  it("blocks serve command via WebSocket (prevents recursion)", async () => {
    const port = nextPort();
    child = startServer(["--port", String(port)]);

    ws = await waitForReady(port);

    const resp = await rpc(ws, {
      id: "1",
      type: "execute",
      command: "serve",
    });
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("COMMAND_BLOCKED");
  }, 15000);

  it("blocks interactive commands (chat, agent, setup)", async () => {
    const port = nextPort();
    child = startServer(["--port", String(port)]);

    ws = await waitForReady(port);

    for (const cmd of ["chat", "agent", "setup"]) {
      const resp = await rpc(ws, {
        id: `b-${cmd}`,
        type: "execute",
        command: cmd,
      });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("COMMAND_BLOCKED");
    }
  }, 15000);

  it("executes note --help successfully", async () => {
    const port = nextPort();
    child = startServer(["--port", String(port)]);

    ws = await waitForReady(port);

    const resp = await rpc(ws, {
      id: "1",
      type: "execute",
      command: "note --help",
    });
    expect(resp.type).toBe("result");
    expect(resp.success).toBe(true);
    expect(resp.stdout).toContain("note");
  }, 15000);

  it("--allow-remote without --token exits with error", () => {
    const { execSync } = require("node:child_process");
    try {
      execSync(`node ${bin} serve --allow-remote`, {
        encoding: "utf-8",
        timeout: 5000,
        stdio: "pipe",
      });
      // Should not reach here
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err.status).not.toBe(0);
    }
  });
});
