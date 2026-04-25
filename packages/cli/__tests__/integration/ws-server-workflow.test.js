/**
 * Integration tests for WebSocket server workflow
 *
 * Tests realistic multi-step workflows: auth → execute → stream → cancel,
 * concurrent requests, connection limits, and command isolation.
 */

import { describe, it, expect, afterEach } from "vitest";
import { ChainlessChainWSServer } from "../../src/lib/ws-server.js";
import WebSocket from "ws";

const BASE_PORT = 19200;
let portCounter = 0;
function nextPort() {
  return BASE_PORT + portCounter++;
}

/** Connect and wait for open */
function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

/** Send JSON and receive one response */
function rpc(ws, msg) {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString("utf8"))));
    ws.send(JSON.stringify(msg));
  });
}

/** Collect N messages (with timeout) */
function collectMessages(ws, n, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const msgs = [];
    const timer = setTimeout(() => {
      ws.removeListener("message", handler);
      resolve(msgs); // resolve with whatever we got
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

// Previously this suite was skipped on CI because afterEach's
// `await server.stop()` hung — wss.close() awaits TIME_WAIT-d
// sockets and the callback never fired on GH runners. The fix in
// ws-server.js (2s hard ceiling on wss.close) lets the cleanup
// always return, so we can run the full integration suite on CI
// again. Set CC_SKIP_WS_INTEGRATION=1 to opt back into skipping
// if a regression turns up.
const skipWsSuite = process.env.CC_SKIP_WS_INTEGRATION === "1";
const describeWS = skipWsSuite ? describe.skip : describe;

describeWS("Integration: WebSocket Server Workflow", { timeout: 60000 }, () => {
  /** @type {ChainlessChainWSServer} */
  let server;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  // ---- Full auth → command workflow ----
  it("auth → execute → stream workflow", async () => {
    const port = nextPort();
    server = new ChainlessChainWSServer({ port, token: "mytoken" });
    await server.start();

    const ws = await connect(port);

    // Step 1: Authenticate
    const authResp = await rpc(ws, {
      id: "1",
      type: "auth",
      token: "mytoken",
    });
    expect(authResp.success).toBe(true);

    // Step 2: Execute a command
    const execResp = await rpc(ws, {
      id: "2",
      type: "execute",
      command: "--version",
    });
    expect(execResp.type).toBe("result");
    expect(execResp.success).toBe(true);
    expect(execResp.stdout.trim()).toMatch(/\d+\.\d+\.\d+/);

    // Step 3: Stream the same command
    const msgPromise = collectMessages(ws, 2);
    ws.send(JSON.stringify({ id: "3", type: "stream", command: "--version" }));
    const msgs = await msgPromise;

    const streamEnd = msgs.find((m) => m.type === "stream-end");
    expect(streamEnd).toBeDefined();
    expect(streamEnd.exitCode).toBe(0);

    ws.close();
  });

  // ---- Multiple concurrent execute requests ----
  it("handles multiple concurrent execute requests", async () => {
    const port = nextPort();
    server = new ChainlessChainWSServer({ port });
    await server.start();

    const ws = await connect(port);

    // Fire 3 commands simultaneously
    const p1 = collectMessages(ws, 3, 15000);
    ws.send(JSON.stringify({ id: "a", type: "execute", command: "--version" }));
    ws.send(JSON.stringify({ id: "b", type: "execute", command: "--version" }));
    ws.send(JSON.stringify({ id: "c", type: "execute", command: "--version" }));

    const msgs = await p1;
    expect(msgs).toHaveLength(3);

    const ids = msgs.map((m) => m.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
    msgs.forEach((m) => {
      expect(m.type).toBe("result");
      expect(m.success).toBe(true);
    });

    ws.close();
  });

  // ---- Multiple clients ----
  it("supports multiple simultaneous clients", async () => {
    const port = nextPort();
    server = new ChainlessChainWSServer({ port, maxConnections: 5 });
    await server.start();

    const ws1 = await connect(port);
    const ws2 = await connect(port);

    const resp1 = rpc(ws1, {
      id: "x1",
      type: "execute",
      command: "--version",
    });
    const resp2 = rpc(ws2, {
      id: "x2",
      type: "execute",
      command: "--version",
    });

    const [r1, r2] = await Promise.all([resp1, resp2]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    ws1.close();
    ws2.close();
  });

  // ---- Blocked commands return clear error ----
  it("all blocked commands return COMMAND_BLOCKED", async () => {
    const port = nextPort();
    server = new ChainlessChainWSServer({ port });
    await server.start();

    const ws = await connect(port);

    const blockedCmds = ["serve", "chat", "agent", "setup"];
    for (const cmd of blockedCmds) {
      const resp = await rpc(ws, {
        id: `b-${cmd}`,
        type: "execute",
        command: cmd,
      });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("COMMAND_BLOCKED");
      expect(resp.message).toContain(cmd);
    }

    ws.close();
  });

  // ---- Failed auth blocks all subsequent commands ----
  it("failed auth blocks subsequent commands until reconnect", async () => {
    const port = nextPort();
    server = new ChainlessChainWSServer({ port, token: "secret" });
    await server.start();

    const ws = await connect(port);

    // Wrong token
    const authResp = await rpc(ws, {
      id: "1",
      type: "auth",
      token: "wrong",
    });
    expect(authResp.success).toBe(false);

    // Connection gets closed by server after failed auth
    const closeCode = await new Promise((resolve) =>
      ws.on("close", (code) => resolve(code)),
    );
    expect(closeCode).toBe(4001);
  });

  // ---- Interleaved ping during command execution ----
  it("responds to ping while command is running", async () => {
    const port = nextPort();
    server = new ChainlessChainWSServer({ port });
    await server.start();

    const ws = await connect(port);

    // Start a command
    ws.send(
      JSON.stringify({
        id: "cmd1",
        type: "execute",
        command: "--help",
      }),
    );

    // Immediately send a ping
    const pingResp = await rpc(ws, { id: "ping1", type: "ping" });
    expect(pingResp.type).toBe("pong");

    // Wait for the command result too
    const cmdResp = await new Promise((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString("utf8"));
        if (msg.id === "cmd1") resolve(msg);
      });
    });
    expect(cmdResp.type).toBe("result");

    ws.close();
  });

  // ---- Execute with --help flag returns valid output ----
  it("note --help returns help text", async () => {
    const port = nextPort();
    server = new ChainlessChainWSServer({ port });
    await server.start();

    const ws = await connect(port);
    const resp = await rpc(ws, {
      id: "1",
      type: "execute",
      command: "note --help",
    });
    expect(resp.type).toBe("result");
    expect(resp.success).toBe(true);
    expect(resp.stdout).toContain("note");
    ws.close();
  });
});
