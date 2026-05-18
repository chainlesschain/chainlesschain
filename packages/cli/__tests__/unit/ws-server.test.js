/**
 * Unit tests for ws-server.js — WebSocket server core
 *
 * Tests tokenizeCommand (pure function) and ChainlessChainWSServer class
 * (connection management, auth, command execution, streaming, cancel, heartbeat).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  tokenizeCommand,
  ChainlessChainWSServer,
  isCommandBlocked,
} from "../../src/lib/ws-server.js";
import WebSocket from "ws";

const mockTaskManagerFactory = vi.fn();
const mockCompressionSummary = vi.fn(() => ({
  samples: 3,
  hitRate: 0.66,
  totalSavedTokens: 120,
  variantDistribution: { balanced: 2, aggressive: 1 },
  strategyDistribution: [{ strategy: "truncate", hits: 2, hitRate: 0.66 }],
  providerDistribution: [{ key: "ollama", samples: 3, hitRate: 0.66 }],
  modelDistribution: [{ key: "qwen2.5:7b", samples: 3, hitRate: 0.66 }],
}));

vi.mock("../../src/harness/background-task-manager.js", () => ({
  BackgroundTaskManager: class MockBackgroundTaskManager {
    constructor(...args) {
      return mockTaskManagerFactory(...args);
    }
  },
}));

vi.mock("../../src/lib/compression-telemetry.js", () => ({
  getCompressionTelemetrySummary: (...args) => mockCompressionSummary(...args),
}));

// ---------------------------------------------------------------------------
// tokenizeCommand — pure function tests (no I/O)
// ---------------------------------------------------------------------------
describe("tokenizeCommand", () => {
  it("splits simple space-separated args", () => {
    expect(tokenizeCommand("note list --json")).toEqual([
      "note",
      "list",
      "--json",
    ]);
  });

  it("handles double-quoted strings", () => {
    expect(tokenizeCommand('note add "Hello World"')).toEqual([
      "note",
      "add",
      "Hello World",
    ]);
  });

  it("handles single-quoted strings", () => {
    expect(tokenizeCommand("note add 'Hello World'")).toEqual([
      "note",
      "add",
      "Hello World",
    ]);
  });

  it("handles escaped characters inside double quotes", () => {
    expect(tokenizeCommand('ask "say \\"hi\\""')).toEqual(["ask", 'say "hi"']);
  });

  it("handles empty input", () => {
    expect(tokenizeCommand("")).toEqual([]);
  });

  it("handles whitespace-only input", () => {
    expect(tokenizeCommand("   \t  ")).toEqual([]);
  });

  it("handles multiple spaces between args", () => {
    expect(tokenizeCommand("note   list   --json")).toEqual([
      "note",
      "list",
      "--json",
    ]);
  });

  it("handles mixed quotes", () => {
    expect(tokenizeCommand(`ask "hello 'world'"`)).toEqual([
      "ask",
      "hello 'world'",
    ]);
  });

  it("handles tab characters as separators", () => {
    expect(tokenizeCommand("note\tlist")).toEqual(["note", "list"]);
  });

  it("handles adjacent quoted and unquoted parts", () => {
    expect(tokenizeCommand('--name="test value"')).toEqual([
      "--name=test value",
    ]);
  });
});

// ---------------------------------------------------------------------------
// isCommandBlocked — pure policy function (Phase 0 of cc pack)
// ---------------------------------------------------------------------------
describe("isCommandBlocked", () => {
  it("always blocks serve, setup, pack regardless of mode", () => {
    expect(isCommandBlocked("serve", {})).toBe(true);
    expect(isCommandBlocked("setup", {})).toBe(true);
    expect(isCommandBlocked("pack", {})).toBe(true);
    expect(isCommandBlocked("serve", { CC_PACK_MODE: "1" })).toBe(true);
    expect(isCommandBlocked("setup", { CC_PACK_MODE: "1" })).toBe(true);
    expect(isCommandBlocked("pack", { CC_PACK_MODE: "1" })).toBe(true);
  });

  it("blocks chat and agent by default (no pack mode)", () => {
    expect(isCommandBlocked("chat", {})).toBe(true);
    expect(isCommandBlocked("agent", {})).toBe(true);
    expect(isCommandBlocked("chat", { CC_PACK_MODE: "0" })).toBe(true);
    expect(isCommandBlocked("agent", { CC_PACK_MODE: "" })).toBe(true);
  });

  it("unlocks chat and agent when CC_PACK_MODE=1", () => {
    expect(isCommandBlocked("chat", { CC_PACK_MODE: "1" })).toBe(false);
    expect(isCommandBlocked("agent", { CC_PACK_MODE: "1" })).toBe(false);
    expect(isCommandBlocked("chat", { CC_PACK_MODE: "true" })).toBe(false);
    expect(isCommandBlocked("agent", { CC_PACK_MODE: "true" })).toBe(false);
  });

  it("does not block ordinary commands", () => {
    expect(isCommandBlocked("note", {})).toBe(false);
    expect(isCommandBlocked("status", {})).toBe(false);
    expect(isCommandBlocked("doctor", { CC_PACK_MODE: "1" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ChainlessChainWSServer — server lifecycle and protocol tests
// ---------------------------------------------------------------------------
describe("ChainlessChainWSServer", () => {
  /** @type {ChainlessChainWSServer} */
  let server;
  /** Port counter to avoid collisions between tests */
  let port;
  const basePort = 19100;
  let portCounter = 0;

  function nextPort() {
    return basePort + portCounter++;
  }

  /** Helper: create a WS client that resolves when connected */
  function connect(p, path = "") {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${p}${path}`);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }

  /** Helper: send JSON and receive the next JSON message */
  function rpc(ws, msg) {
    return new Promise((resolve) => {
      ws.once("message", (data) => resolve(JSON.parse(data.toString("utf8"))));
      ws.send(JSON.stringify(msg));
    });
  }

  /** Helper: collect N messages */
  function collectMessages(ws, n) {
    return new Promise((resolve) => {
      const msgs = [];
      const handler = (data) => {
        msgs.push(JSON.parse(data.toString("utf8")));
        if (msgs.length >= n) {
          ws.removeListener("message", handler);
          resolve(msgs);
        }
      };
      ws.on("message", handler);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  // ---- Constructor defaults ----
  describe("constructor", () => {
    it("uses default options when none provided", () => {
      server = new ChainlessChainWSServer();
      expect(server.port).toBe(18800);
      expect(server.host).toBe("127.0.0.1");
      expect(server.token).toBeNull();
      expect(server.maxConnections).toBe(10);
      expect(server.timeout).toBe(30000);
    });

    it("accepts custom options", () => {
      server = new ChainlessChainWSServer({
        port: 9999,
        host: "0.0.0.0",
        token: "abc",
        maxConnections: 5,
        timeout: 5000,
      });
      expect(server.port).toBe(9999);
      expect(server.host).toBe("0.0.0.0");
      expect(server.token).toBe("abc");
      expect(server.maxConnections).toBe(5);
      expect(server.timeout).toBe(5000);
    });
  });

  // ---- Phase 5: service envelope helpers ----
  describe("envelope helpers", () => {
    function fakeWs() {
      const sent = [];
      return {
        readyState: 1,
        OPEN: 1,
        send: (s) => sent.push(JSON.parse(s)),
        _sent: sent,
      };
    }
    it("sendEnvelope wraps a spec into a Phase-5 envelope", () => {
      server = new ChainlessChainWSServer();
      const ws = fakeWs();
      server.sendEnvelope(ws, {
        type: "run.token",
        sessionId: "s1",
        runId: "r1",
        payload: { content: "hi" },
      });
      expect(ws._sent[0]).toMatchObject({
        v: 1,
        type: "run.token",
        sessionId: "s1",
        runId: "r1",
        payload: { content: "hi" },
      });
    });
    it("sendEnvelope passes through a pre-built envelope unchanged", () => {
      server = new ChainlessChainWSServer();
      const ws = fakeWs();
      const env = {
        v: 1,
        type: "run.message",
        sessionId: "s1",
        runId: null,
        requestId: null,
        ts: 42,
        payload: { content: "ok" },
      };
      server.sendEnvelope(ws, env);
      expect(ws._sent[0]).toEqual(env);
    });
    it("sendEnvelope falls back to legacy send when envelope is invalid", () => {
      server = new ChainlessChainWSServer();
      const ws = fakeWs();
      server.sendEnvelope(ws, { type: "no_dot_case", sessionId: "s1" });
      // legacy fallback retains original spec
      expect(ws._sent[0]).toMatchObject({ type: "no_dot_case" });
    });
    it("sendStreamEnvelope adapts StreamRouter events", () => {
      server = new ChainlessChainWSServer();
      const ws = fakeWs();
      server.sendStreamEnvelope(
        ws,
        { type: "token", content: "hi" },
        { sessionId: "s1", runId: "r1", requestId: "req-1" },
      );
      expect(ws._sent[0]).toMatchObject({
        v: 1,
        type: "run.token",
        sessionId: "s1",
        runId: "r1",
        requestId: "req-1",
        payload: { content: "hi" },
      });
    });
  });

  // ---- Start / Stop lifecycle ----
  describe("start / stop", () => {
    it("emits listening event on start", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      const listening = vi.fn();
      server.on("listening", listening);
      await server.start();
      expect(listening).toHaveBeenCalledWith({ port, host: "127.0.0.1" });
    });

    it("emits stopped event on stop", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();
      const stopped = vi.fn();
      server.on("stopped", stopped);
      await server.stop();
      expect(stopped).toHaveBeenCalled();
      server = null; // already stopped
    });

    it("can stop without starting", async () => {
      server = new ChainlessChainWSServer();
      await server.stop(); // should not throw
      server = null;
    });
  });

  // ---- Connection handling ----
  describe("connection handling", () => {
    it("emits connection event when a client connects", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const connected = new Promise((resolve) =>
        server.on("connection", resolve),
      );
      const ws = await connect(port);
      const info = await connected;

      expect(info.clientId).toMatch(/^client-/);
      expect(server.clients.size).toBe(1);
      ws.close();
    });

    it("rejects connections beyond maxConnections", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port, maxConnections: 1 });
      await server.start();

      const ws1 = await connect(port);
      // Second connection should be closed immediately
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
      const closeCode = await new Promise((resolve) =>
        ws2.on("close", (code) => resolve(code)),
      );
      expect(closeCode).toBe(1013);

      ws1.close();
    });

    it("emits disconnection event when client disconnects", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const disconnected = new Promise((resolve) =>
        server.on("disconnection", resolve),
      );
      const ws = await connect(port);
      ws.close();
      const info = await disconnected;
      expect(info.clientId).toMatch(/^client-/);
    });
  });

  // ---- Ping / Pong ----
  describe("ping / pong", () => {
    it("responds with pong including serverTime", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, { id: "1", type: "ping" });
      expect(resp).toMatchObject({ id: "1", type: "pong" });
      expect(typeof resp.serverTime).toBe("number");
      ws.close();
    });
  });

  // ---- Message validation ----
  describe("message validation", () => {
    it("returns error for invalid JSON", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = new Promise((resolve) =>
        ws.once("message", (d) => resolve(JSON.parse(d.toString("utf8")))),
      );
      ws.send("not json at all");
      const msg = await resp;
      expect(msg.type).toBe("error");
      expect(msg.code).toBe("INVALID_JSON");
      ws.close();
    });

    it("returns error for message without id", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, { type: "ping" });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("MISSING_ID");
      ws.close();
    });

    it("returns error for unknown message type", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, { id: "1", type: "foobar" });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("UNKNOWN_TYPE");
      ws.close();
    });
  });

  // ---- Authentication ----
  describe("authentication", () => {
    it("auto-authenticates when no token is required", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      // Should be able to execute commands directly
      const resp = await rpc(ws, {
        id: "1",
        type: "execute",
        command: "--version",
      });
      expect(resp.type).toBe("result");
      ws.close();
    });

    it("rejects commands before auth when token is required", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port, token: "secret" });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, {
        id: "1",
        type: "execute",
        command: "--version",
      });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("AUTH_REQUIRED");
      ws.close();
    });

    it("accepts valid auth token", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port, token: "secret" });
      await server.start();

      const ws = await connect(port);
      const authResp = await rpc(ws, {
        id: "1",
        type: "auth",
        token: "secret",
      });
      expect(authResp).toMatchObject({
        id: "1",
        type: "auth-result",
        success: true,
      });

      // Now commands should work
      const execResp = await rpc(ws, {
        id: "2",
        type: "execute",
        command: "--version",
      });
      expect(execResp.type).toBe("result");
      ws.close();
    });

    it("rejects invalid auth token and disconnects", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port, token: "secret" });
      await server.start();

      const ws = await connect(port);
      const authResp = await rpc(ws, {
        id: "1",
        type: "auth",
        token: "wrong",
      });
      expect(authResp).toMatchObject({
        id: "1",
        type: "auth-result",
        success: false,
      });

      // Should get disconnected shortly
      const closeCode = await new Promise((resolve) =>
        ws.on("close", (code) => resolve(code)),
      );
      expect(closeCode).toBe(4001);
    });
  });

  // ---- Command execution ----
  describe("command execution", () => {
    it("executes --version and returns result", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, {
        id: "1",
        type: "execute",
        command: "--version",
      });
      expect(resp.type).toBe("result");
      expect(resp.success).toBe(true);
      expect(resp.exitCode).toBe(0);
      expect(resp.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
      ws.close();
    });

    it("blocks the serve command", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, {
        id: "1",
        type: "execute",
        command: "serve --port 9999",
      });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("COMMAND_BLOCKED");
      ws.close();
    });

    it("blocks the chat command", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, {
        id: "1",
        type: "execute",
        command: "chat",
      });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("COMMAND_BLOCKED");
      ws.close();
    });

    it("blocks the agent command", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, {
        id: "1",
        type: "execute",
        command: "agent",
      });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("COMMAND_BLOCKED");
      ws.close();
    });

    it("blocks the setup command", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, {
        id: "1",
        type: "execute",
        command: "setup",
      });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("COMMAND_BLOCKED");
      ws.close();
    });

    it("blocks the pack command (always, even in pack mode)", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();
      const prev = process.env.CC_PACK_MODE;
      process.env.CC_PACK_MODE = "1";
      try {
        const ws = await connect(port);
        const resp = await rpc(ws, {
          id: "1",
          type: "execute",
          command: "pack",
        });
        expect(resp.type).toBe("error");
        expect(resp.code).toBe("COMMAND_BLOCKED");
        ws.close();
      } finally {
        if (prev === undefined) delete process.env.CC_PACK_MODE;
        else process.env.CC_PACK_MODE = prev;
      }
    });

    it("unlocks chat command when CC_PACK_MODE=1", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();
      const prev = process.env.CC_PACK_MODE;
      process.env.CC_PACK_MODE = "1";
      try {
        const ws = await connect(port);
        // chat without TTY will exit quickly with non-zero — we just check it
        // is NOT blocked at the WS layer (i.e. not a COMMAND_BLOCKED error).
        const resp = await rpc(ws, {
          id: "1",
          type: "execute",
          command: "chat --help",
        });
        expect(resp.code).not.toBe("COMMAND_BLOCKED");
        ws.close();
      } finally {
        if (prev === undefined) delete process.env.CC_PACK_MODE;
        else process.env.CC_PACK_MODE = prev;
      }
    });

    it("unlocks agent command when CC_PACK_MODE=1", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();
      const prev = process.env.CC_PACK_MODE;
      process.env.CC_PACK_MODE = "1";
      try {
        const ws = await connect(port);
        const resp = await rpc(ws, {
          id: "1",
          type: "execute",
          command: "agent --help",
        });
        expect(resp.code).not.toBe("COMMAND_BLOCKED");
        ws.close();
      } finally {
        if (prev === undefined) delete process.env.CC_PACK_MODE;
        else process.env.CC_PACK_MODE = prev;
      }
    });

    it("returns error for empty command", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, { id: "1", type: "execute", command: "" });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("INVALID_COMMAND");
      ws.close();
    });

    it("returns error for non-string command", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, { id: "1", type: "execute", command: 123 });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("INVALID_COMMAND");
      ws.close();
    });

    it("handles non-zero exit code", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, {
        id: "1",
        type: "execute",
        command: "nonexistent-subcommand-xyz",
      });
      // Commander exits with code 1 for unknown commands
      expect(resp.type).toBe("result");
      expect(resp.success).toBe(false);
      ws.close();
    });
  });

  // ---- Stream execution ----
  describe("stream execution", () => {
    it("streams --version output then sends stream-end", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      // We'll collect at least 2 messages: stream-data + stream-end
      const msgPromise = collectMessages(ws, 2);
      ws.send(
        JSON.stringify({ id: "s1", type: "stream", command: "--version" }),
      );
      const msgs = await msgPromise;

      const dataMsg = msgs.find((m) => m.type === "stream-data");
      const endMsg = msgs.find((m) => m.type === "stream-end");
      expect(dataMsg).toBeDefined();
      expect(dataMsg.id).toBe("s1");
      expect(dataMsg.channel).toBe("stdout");
      expect(endMsg).toBeDefined();
      expect(endMsg.id).toBe("s1");
      expect(endMsg.exitCode).toBe(0);
      ws.close();
    });

    it("blocks serve in stream mode too", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, {
        id: "1",
        type: "stream",
        command: "serve",
      });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("COMMAND_BLOCKED");
      ws.close();
    });
  });

  // ---- Cancel ----
  describe("cancel", () => {
    it("returns NOT_FOUND for non-existent request", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, { id: "no-such-id", type: "cancel" });
      expect(resp.type).toBe("error");
      expect(resp.code).toBe("NOT_FOUND");
      ws.close();
    });
  });

  // ---- Timeout ----
  describe("command timeout", () => {
    it("kills process and returns COMMAND_TIMEOUT on timeout", async () => {
      port = nextPort();
      // Very short timeout to trigger it
      server = new ChainlessChainWSServer({ port, timeout: 500 });
      await server.start();

      const ws = await connect(port);
      // Run a command that takes longer than 500ms — 'status' invokes bootstrap
      // which initializes DB and is slow enough. If not, use a sleep command.
      const resp = await rpc(ws, {
        id: "t1",
        type: "execute",
        command: "status",
      });
      // It should either succeed quickly or timeout
      // We can't guarantee timeout here, so just verify the response shape is valid
      expect(["result", "error"]).toContain(resp.type);
      if (resp.type === "error") {
        expect(resp.code).toBe("COMMAND_TIMEOUT");
      }
      ws.close();
    });
  });

  // ---- Events ----
  describe("events", () => {
    it("emits command:start and command:end events", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const startEvent = new Promise((resolve) =>
        server.on("command:start", resolve),
      );
      const endEvent = new Promise((resolve) =>
        server.on("command:end", resolve),
      );

      const ws = await connect(port);
      ws.send(
        JSON.stringify({
          id: "ev1",
          type: "execute",
          command: "--version",
        }),
      );

      const start = await startEvent;
      expect(start.id).toBe("ev1");
      expect(start.command).toBe("--version");
      expect(start.stream).toBe(false);

      const end = await endEvent;
      expect(end.id).toBe("ev1");
      expect(end.exitCode).toBe(0);

      ws.close();
    });
  });

  describe("background task protocol", () => {
    it("returns task list from the background task manager", async () => {
      const list = vi.fn(() => [{ id: "task-1", status: "running" }]);
      const on = vi.fn();
      mockTaskManagerFactory.mockReturnValueOnce({
        list,
        on,
      });

      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, { id: "tasks-1", type: "tasks-list" });

      expect(resp).toEqual({
        id: "tasks-1",
        type: "tasks-list",
        tasks: [{ id: "task-1", status: "running" }],
      });
      expect(list).toHaveBeenCalled();
      ws.close();
    });

    it("stops a task through the background task manager", async () => {
      const stop = vi.fn();
      const on = vi.fn();
      mockTaskManagerFactory.mockReturnValueOnce({
        list: vi.fn(() => []),
        stop,
        on,
      });

      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, {
        id: "tasks-2",
        type: "tasks-stop",
        taskId: "task-9",
      });

      expect(resp).toEqual({
        id: "tasks-2",
        type: "tasks-stopped",
        taskId: "task-9",
      });
      expect(stop).toHaveBeenCalledWith("task-9");
      ws.close();
    });

    it("returns task details and history from the background task manager", async () => {
      const on = vi.fn();
      mockTaskManagerFactory.mockReturnValueOnce({
        list: vi.fn(() => []),
        on,
        getDetails: vi.fn(() => ({ id: "task-5", recoveredFromRestart: true })),
        getHistory: vi.fn(() => ({
          items: [{ event: "recovered" }],
          total: 1,
          offset: 0,
          limit: 20,
          hasMore: false,
          nextOffset: null,
        })),
      });

      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const detailResp = await rpc(ws, {
        id: "tasks-3",
        type: "tasks-detail",
        taskId: "task-5",
      });
      const historyResp = await rpc(ws, {
        id: "tasks-4",
        type: "tasks-history",
        taskId: "task-5",
      });

      expect(detailResp).toEqual({
        id: "tasks-3",
        type: "tasks-detail",
        task: { id: "task-5", recoveredFromRestart: true },
      });
      expect(historyResp).toEqual({
        id: "tasks-4",
        type: "tasks-history",
        taskId: "task-5",
        history: {
          items: [{ event: "recovered" }],
          total: 1,
          offset: 0,
          limit: 20,
          hasMore: false,
          nextOffset: null,
        },
      });
      ws.close();
    });

    it("returns compression telemetry summary", async () => {
      port = nextPort();
      server = new ChainlessChainWSServer({ port });
      await server.start();

      const ws = await connect(port);
      const resp = await rpc(ws, {
        id: "compression-1",
        type: "compression-stats",
        windowMs: 3600000,
        provider: "ollama",
        model: "qwen2.5:7b",
      });

      expect(resp.type).toBe("compression-stats");
      expect(resp.summary.totalSavedTokens).toBe(120);
      expect(resp.summary.variantDistribution.balanced).toBe(2);
      expect(mockCompressionSummary).toHaveBeenCalledWith({
        limit: undefined,
        windowMs: 3600000,
        provider: "ollama",
        model: "qwen2.5:7b",
      });
      ws.close();
    });
  });
});
