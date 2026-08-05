/**
 * MCP stdio transport: a broken stdin pipe must not crash the CLI.
 *
 * Writing to a stdio MCP server that has closed its stdin read end (or died
 * mid-write) makes the stdin pipe emit an ASYNCHRONOUS 'error' (EPIPE). In Node
 * an 'error' event with no listener is an uncaught exception that terminates the
 * process — and the try/catch around stdin.write only catches synchronous
 * throws, not this async event. The client must attach a stdin 'error' listener
 * so a misbehaving/crashing server can't take down the whole CLI: it drains
 * in-flight requests with a clear error and emits `server-error`.
 *
 * A fake child (EventEmitter) is injected via _deps.spawn; here stdin is itself
 * an EventEmitter (as a real child's stdin Writable is) so the test can emit the
 * EPIPE the way Node would.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";
import {
  MCPClient,
  _deps,
  isLikelyConnectionError,
  isTransientMcpError,
} from "../../src/lib/mcp-client.js";

beforeEach(() => {
  _deps.consumeMcpStdioExecutionAuthority = () => ({
    approvalKind: "test-fixture",
  });
  _deps.materializeApprovedMcpStdioInvocation = (_approval, { config }) =>
    config;
  _deps.prepareMcpStdioExecutableIdentity = ({ config }) => ({
    command: config.command,
    args: config.args || [],
    identity: null,
    authority: Object.freeze({}),
  });
});

const STDIO_FRAME_HARD_LIMIT_BYTES = 16 * 1024 * 1024;
const STDIO_AGGREGATE_LIMIT_BYTES = 1024 * 1024;
const STDIO_MALFORMED_LIMIT_FRAMES = 32;
const HARD_LIMIT_OVERFLOW = "x".repeat(STDIO_FRAME_HARD_LIMIT_BYTES + 1);
const AGGREGATE_LIMIT_OVERFLOW = "z".repeat(STDIO_AGGREGATE_LIMIT_BYTES + 1);

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected promise to reject");
}

function handshakeResult(method) {
  switch (method) {
    case "initialize":
      return {
        serverInfo: { name: "fake", version: "1" },
        capabilities: { tools: {} },
      };
    case "tools/list":
      return { tools: [{ name: "doit" }] };
    case "resources/list":
      return { resources: [] };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      return undefined; // tools/call → no answer, stays pending
  }
}

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
  };
  // stdin is an EventEmitter (like a real child's Writable) so we can emit the
  // async EPIPE; write() still auto-answers the connect handshake.
  const stdin = new EventEmitter();
  stdin.write = (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data).trim());
    } catch {
      return true;
    }
    if (msg.id === undefined) return true; // notification — no response
    const result = handshakeResult(msg.method);
    if (result !== undefined) {
      setImmediate(() => {
        proc.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n",
          ),
        );
      });
    }
    return true;
  };
  proc.stdin = stdin;
  return proc;
}

describe("MCPClient stdio — broken stdin pipe doesn't crash the CLI", () => {
  let client;
  let proc;

  beforeEach(async () => {
    const mod = await import("../../src/lib/mcp-client.js");
    client = new MCPClient();
    proc = makeFakeProc();
    mod._deps.spawn = () => proc;
  });

  it("attaches an 'error' listener to stdin so EPIPE never goes unhandled", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    // A real unhandled 'error' on an EventEmitter throws synchronously from
    // emit(); with the listener attached it must NOT throw.
    expect(() =>
      proc.stdin.emit("error", new Error("write EPIPE")),
    ).not.toThrow();
    expect(proc.stdin.listenerCount("error")).toBe(1);
  });

  it("rejects in-flight requests and emits server-error on a stdin EPIPE", async () => {
    await client.connect("srv", { command: "fake-mcp" });

    const errors = [];
    client.on("server-error", (e) => errors.push(e));

    const callPromise = client.callTool("srv", "doit", {});
    // tools/call is written but never answered; the pipe then breaks.
    proc.stdin.emit("error", new Error("write EPIPE"));

    await expect(callPromise).rejects.toThrow(/stdin error/i);
    expect(errors.some((e) => /EPIPE/i.test(e.error))).toBe(true);
  });

  it("marks the server ERROR after a stdin pipe failure", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    proc.stdin.emit("error", new Error("write EPIPE"));
    const srv = client.listServers().find((s) => s.name === "srv");
    expect(srv.state).toBe("error");
  });
});

describe("MCPClient stdio — runaway buffer is capped", () => {
  let client;
  let proc;

  beforeEach(async () => {
    const mod = await import("../../src/lib/mcp-client.js");
    client = new MCPClient();
    proc = makeFakeProc();
    mod._deps.spawn = () => proc;
  });

  it("fails the transport when stdout streams past the cap with no newline", async () => {
    // Small per-server cap so the test stays fast (no 16M allocation).
    await client.connect("srv", { command: "fake-mcp", maxBufferChars: 1024 });

    const errors = [];
    client.on("server-error", (e) => errors.push(e));
    const callPromise = client.callTool("srv", "doit", {});

    // Server floods stdout with no newline — would grow _buffer unbounded.
    proc.stdout.emit("data", Buffer.from("x".repeat(2048)));

    const error = await rejectionOf(callPromise);
    expect(error).toMatchObject({
      code: "CC_MCP_STDIO_FRAME_TOO_LARGE",
      limitBytes: 1024,
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "CC_MCP_STDIO_FRAME_TOO_LARGE",
        limitBytes: 1024,
      }),
    );
    const srv = client.listServers().find((s) => s.name === "srv");
    expect(srv.state).toBe("error");
  });

  it("rejects an oversized complete line before JSON parsing or dispatch", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    const entry = client.servers.get("srv");
    entry.config.maxBufferChars = 128;
    const handleMessage = vi.spyOn(client, "_handleMessage");
    const reconnect = vi.fn(async () => true);
    client.setReconnector("srv", reconnect);
    const errors = [];
    client.on("server-error", (event) => errors.push(event));

    const pending = client.callTool("srv", "doit", {});
    proc.stdout.emit(
      "data",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 999,
        result: { canary: "COMPLETE_FRAME_CANARY".repeat(16) },
      }) + "\n",
    );
    const error = await rejectionOf(pending);

    expect(error).toMatchObject({
      code: "CC_MCP_STDIO_FRAME_TOO_LARGE",
      transport: "stdio",
      limitBytes: 128,
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(error.message).toBe(
      'MCP stdio server "srv" exceeded the 128-byte host line frame cap',
    );
    expect(error.message).not.toContain("COMPLETE_FRAME_CANARY");
    expect(handleMessage).not.toHaveBeenCalled();
    expect(isLikelyConnectionError(error)).toBe(false);
    expect(isTransientMcpError(error)).toBe(false);
    expect(reconnect).not.toHaveBeenCalled();
    expect(proc.killed).toBe(true);
    expect(entry.state).toBe("error");
    expect(entry._buffer).toBe("");
    expect(entry._bufferBytes).toBe(0);
    expect(errors).toEqual([
      {
        name: "srv",
        code: "CC_MCP_STDIO_FRAME_TOO_LARGE",
        error:
          'MCP stdio server "srv" exceeded the 128-byte host line frame cap',
        limitBytes: 128,
      },
    ]);
    proc.emit("close", 1);
    expect(entry.state).toBe("error");
  });

  it("counts an unterminated frame by UTF-8 bytes rather than characters", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    const entry = client.servers.get("srv");
    entry.config.maxBufferChars = 128;
    const payload = "你".repeat(43);
    expect(payload.length).toBeLessThan(128);
    expect(Buffer.byteLength(payload, "utf8")).toBe(129);

    const pending = client.callTool("srv", "doit", {});
    proc.stdout.emit("data", Buffer.from(payload, "utf8"));
    const error = await rejectionOf(pending);

    expect(error).toMatchObject({
      code: "CC_MCP_STDIO_FRAME_TOO_LARGE",
      limitBytes: 128,
      outcomeUnknown: true,
    });
    expect(proc.killed).toBe(true);
    expect(entry.state).toBe("error");
  });

  it.each([0, Number.MAX_SAFE_INTEGER])(
    "does not let maxBufferChars=%s disable or raise the host frame cap",
    async (maxBufferChars) => {
      await client.connect("srv", { command: "fake-mcp", maxBufferChars });
      const entry = client.servers.get("srv");
      const pending = client.callTool("srv", "doit", {});

      proc.stdout.emit("data", HARD_LIMIT_OVERFLOW);
      const error = await rejectionOf(pending);

      expect(error).toMatchObject({
        code: "CC_MCP_STDIO_FRAME_TOO_LARGE",
        limitBytes: STDIO_FRAME_HARD_LIMIT_BYTES,
        dispatched: true,
        outcomeUnknown: true,
      });
      expect(entry._buffer).toBe("");
      expect(entry._bufferBytes).toBe(0);
      expect(entry.state).toBe("error");
      expect(proc.killed).toBe(true);
    },
  );

  it("does not fire when complete newline-terminated lines keep the tail small", async () => {
    await client.connect("srv", { command: "fake-mcp", maxBufferChars: 1024 });
    const errors = [];
    client.on("server-error", (e) => errors.push(e));

    // Many valid newline-delimited frames are processed independently; only
    // malformed aggregate traffic consumes the malformed-frame budget.
    let blob = "";
    for (let i = 0; i < 50; i++) {
      blob +=
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/test",
          params: { value: "y".repeat(40) },
        }) + "\n";
    }
    expect(() => proc.stdout.emit("data", Buffer.from(blob))).not.toThrow();
    expect(errors).toHaveLength(0);
    const srv = client.listServers().find((s) => s.name === "srv");
    expect(srv.state).toBe("connected");
  });

  it("suppresses stderr content and coalesces bounded diagnostics", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    const entry = client.servers.get("srv");
    const errors = [];
    client.on("server-error", (event) => errors.push(event));
    const canary = "\u001b]8;;https://evil.test\u0007STDERR_SECRET_CANARY";
    const first = Buffer.from(canary, "utf8");
    const second = Buffer.from("second diagnostic", "utf8");

    proc.stderr.emit("data", first);
    proc.stderr.emit("data", second);

    expect(errors).toEqual([
      {
        name: "srv",
        code: "CC_MCP_STDIO_STDERR_OUTPUT",
        error: 'MCP stdio server "srv" wrote diagnostics to stderr',
        bytes: first.byteLength,
      },
    ]);
    expect(JSON.stringify(errors)).not.toContain("STDERR_SECRET_CANARY");
    expect(JSON.stringify(errors)).not.toContain("evil.test");
    expect(entry._stderrBytes).toBe(first.byteLength + second.byteLength);
    expect(entry._stderrNotified).toBe(true);
    expect(entry.state).toBe("connected");
    expect(proc.killed).toBe(false);
  });

  it("fails closed when cumulative stderr exceeds its host budget", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    const entry = client.servers.get("srv");
    const errors = [];
    const reconnect = vi.fn(async () => true);
    client.setReconnector("srv", reconnect);
    client.on("server-error", (event) => errors.push(event));
    const pending = client.callTool("srv", "doit", {});

    proc.stderr.emit("data", AGGREGATE_LIMIT_OVERFLOW);
    const error = await rejectionOf(pending);

    expect(error).toMatchObject({
      code: "CC_MCP_STDIO_STDERR_TOO_LARGE",
      transport: "stdio",
      limitBytes: STDIO_AGGREGATE_LIMIT_BYTES,
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(error.message).toBe(
      'MCP stdio server "srv" exceeded the 1048576-byte host stderr budget',
    );
    expect(JSON.stringify(error)).not.toContain("zzzz");
    expect(errors).toEqual([
      {
        name: "srv",
        code: "CC_MCP_STDIO_STDERR_TOO_LARGE",
        error:
          'MCP stdio server "srv" exceeded the 1048576-byte host stderr budget',
        limitBytes: STDIO_AGGREGATE_LIMIT_BYTES,
      },
    ]);
    expect(reconnect).not.toHaveBeenCalled();
    expect(isLikelyConnectionError(error)).toBe(false);
    expect(isTransientMcpError(error)).toBe(false);
    expect(entry.state).toBe("error");
    expect(proc.killed).toBe(true);
  });

  it("fails after the fixed malformed stdout frame count", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    const entry = client.servers.get("srv");
    const errors = [];
    const reconnect = vi.fn(async () => true);
    client.setReconnector("srv", reconnect);
    client.on("server-error", (event) => errors.push(event));
    const pending = client.callTool("srv", "doit", {});

    proc.stdout.emit("data", "{\n".repeat(STDIO_MALFORMED_LIMIT_FRAMES));
    expect(entry._malformedFrameCount).toBe(STDIO_MALFORMED_LIMIT_FRAMES);
    expect(entry._malformedFrameBytes).toBe(STDIO_MALFORMED_LIMIT_FRAMES);
    expect(entry.state).toBe("connected");
    expect(errors).toHaveLength(0);
    proc.stdout.emit("data", "MALFORMED_COUNT_CANARY\n");
    const error = await rejectionOf(pending);

    expect(error).toMatchObject({
      code: "CC_MCP_STDIO_MALFORMED_BUDGET_EXCEEDED",
      transport: "stdio",
      limitBytes: STDIO_AGGREGATE_LIMIT_BYTES,
      limitFrames: STDIO_MALFORMED_LIMIT_FRAMES,
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(error.message).toBe(
      'MCP stdio server "srv" exceeded the malformed stdout budget',
    );
    expect(error.message).not.toContain("MALFORMED_COUNT_CANARY");
    expect(errors).toEqual([
      {
        name: "srv",
        code: "CC_MCP_STDIO_MALFORMED_BUDGET_EXCEEDED",
        error: 'MCP stdio server "srv" exceeded the malformed stdout budget',
        limitBytes: STDIO_AGGREGATE_LIMIT_BYTES,
        limitFrames: STDIO_MALFORMED_LIMIT_FRAMES,
      },
    ]);
    expect(reconnect).not.toHaveBeenCalled();
    expect(entry.state).toBe("error");
    expect(proc.killed).toBe(true);
  });

  it("fails after one bounded malformed frame exhausts the byte budget", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    const entry = client.servers.get("srv");
    const pending = client.callTool("srv", "doit", {});

    proc.stdout.emit("data", `${AGGREGATE_LIMIT_OVERFLOW}\n`);
    const error = await rejectionOf(pending);

    expect(error).toMatchObject({
      code: "CC_MCP_STDIO_MALFORMED_BUDGET_EXCEEDED",
      limitBytes: STDIO_AGGREGATE_LIMIT_BYTES,
      limitFrames: STDIO_MALFORMED_LIMIT_FRAMES,
      outcomeUnknown: true,
    });
    expect(entry._malformedFrameCount).toBe(1);
    expect(entry._malformedFrameBytes).toBe(STDIO_AGGREGATE_LIMIT_BYTES + 1);
    expect(entry.state).toBe("error");
    expect(proc.killed).toBe(true);
  });
});
