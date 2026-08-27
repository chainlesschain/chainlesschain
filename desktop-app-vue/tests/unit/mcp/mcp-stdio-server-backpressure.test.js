import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  BoundedLineReader,
} = require("../../../src/main/mcp/sdk/bounded-line-reader.js");
const {
  JSON_RPC_ERRORS,
  MCPStdioServer,
  ServerState,
  STDIO_SERVER_HARD_LIMITS,
  STDIO_SERVER_LIMITS,
} = require("../../../src/main/mcp/sdk/stdio-server.js");

class FakeInput extends EventEmitter {
  constructor() {
    super();
    this.resume = vi.fn();
    this.pause = vi.fn();
  }
}

class FakeOutput extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.writeResult = true;
  }

  write(value) {
    this.writes.push(String(value));
    return this.writeResult;
  }
}

function createServer(config = {}) {
  const input = config.input || new FakeInput();
  const output = config.output || new FakeOutput();
  return {
    input,
    output,
    server: new MCPStdioServer({ ...config, input, output }),
  };
}

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("BoundedLineReader", () => {
  it("preserves split UTF-8 lines without retaining beyond the byte limit", () => {
    const reader = new BoundedLineReader(4);
    const encoded = Buffer.from("é\n好\n", "utf8");

    expect(reader.push(encoded.subarray(0, 1))).toEqual([]);
    expect(reader.push(encoded.subarray(1, 4))).toEqual(["é"]);
    expect(reader.push(encoded.subarray(4))).toEqual(["好"]);
    expect(reader.lineBytes).toBe(0);
  });

  it("fails closed and clears retained parts for an oversized line", () => {
    const reader = new BoundedLineReader(4);
    let thrown;

    try {
      reader.push(Buffer.from("12345"));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "CC_MCP_STDIO_LINE_TOO_LARGE" });
    expect(reader.lineBytes).toBe(0);
    expect(reader.parts).toEqual([]);
  });

  it("copies a short tail instead of retaining a large parent chunk", () => {
    const reader = new BoundedLineReader(2048);
    const chunk = Buffer.alloc(1024, 0x61);
    chunk[1021] = 0x0a;

    reader.push(chunk);

    expect(reader.lineBytes).toBe(2);
    expect(reader.parts[0].buffer).not.toBe(chunk.buffer);
  });
});

describe("MCPStdioServer bounded admission and backpressure", () => {
  it("uses bounded defaults and clamps caller-provided limits", () => {
    const { server: defaults } = createServer({
      maxInputLineBytes: 0,
      maxConcurrentMessages: Number.POSITIVE_INFINITY,
    });
    expect(defaults.limits).toMatchObject({
      maxInputLineBytes: STDIO_SERVER_LIMITS.maxInputLineBytes,
      maxConcurrentMessages: STDIO_SERVER_LIMITS.maxConcurrentMessages,
    });

    const { server: clamped } = createServer({
      maxInputLineBytes: Number.MAX_SAFE_INTEGER,
      maxConcurrentMessages: Number.MAX_SAFE_INTEGER,
      maxOutputMessageBytes: Number.MAX_SAFE_INTEGER,
      maxQueuedOutputMessages: Number.MAX_SAFE_INTEGER,
      maxQueuedOutputBytes: Number.MAX_SAFE_INTEGER,
      outputDrainTimeoutMs: Number.MAX_SAFE_INTEGER,
    });
    expect(clamped.limits).toEqual(STDIO_SERVER_HARD_LIMITS);
    expect(Object.isFrozen(clamped.limits)).toBe(true);
  });

  it("assembles input chunks and dispatches only complete non-comment lines", async () => {
    const { server, input } = createServer({ maxInputLineBytes: 64 });
    server.handleMessage = vi.fn(() => Promise.resolve());
    await server.start();

    input.emit("data", Buffer.from('{"jsonrpc":"2.0",'));
    input.emit("data", Buffer.from('"method":"ping"}\n# ignored\n\n'));
    await flushAsyncWork();

    expect(server.handleMessage).toHaveBeenCalledOnce();
    expect(server.handleMessage).toHaveBeenCalledWith(
      '{"jsonrpc":"2.0","method":"ping"}',
    );
    await server.stop();
  });

  it("rejects an oversized UTF-8 input line and stops the server", async () => {
    const { server, input, output } = createServer({ maxInputLineBytes: 4 });
    await server.start();

    input.emit("data", Buffer.from("ééé\n", "utf8"));
    await flushAsyncWork();

    expect(input.pause).toHaveBeenCalled();
    expect(server.state).toBe(ServerState.STOPPED);
    expect(server.getStats()).toMatchObject({
      inputLinesRejected: 1,
      activeMessages: 0,
    });
    expect(JSON.parse(output.writes[0])).toMatchObject({
      error: {
        code: JSON_RPC_ERRORS.SERVER_OVERLOADED,
        data: { maxInputLineBytes: 4 },
      },
    });
  });

  it("returns overload without admitting excess message handlers", async () => {
    const { server, output } = createServer({ maxConcurrentMessages: 1 });
    let resolveFirst;
    server._processMessage = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const first = server.handleMessage("first");
    expect(server.activeMessages).toBe(1);
    const rejected = await server.handleMessage("second");

    expect(rejected).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      retryAfterMs: 100,
    });
    expect(server.activeMessages).toBe(1);
    expect(server.getStats().messagesOverloaded).toBe(1);
    expect(JSON.parse(output.writes[0])).toMatchObject({
      error: { code: JSON_RPC_ERRORS.SERVER_OVERLOADED },
    });

    resolveFirst();
    await first;
    expect(server.activeMessages).toBe(0);
  });

  it("stops consuming the current chunk after the first handler overload", async () => {
    const { server, input } = createServer({ maxConcurrentMessages: 1 });
    let resolveFirst;
    server._processMessage = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    await server.start();

    input.emit("data", Buffer.from("first\nsecond\nthird\nfourth\n"));
    await flushAsyncWork();

    expect(server._processMessage).toHaveBeenCalledOnce();
    expect(server.getStats().messagesOverloaded).toBe(1);
    expect(input.pause).toHaveBeenCalled();
    expect(server.state).toBe(ServerState.STOPPED);

    resolveFirst();
    await flushAsyncWork();
    expect(server.activeMessages).toBe(0);
  });

  it("preserves output ordering across a backpressured drain", async () => {
    const output = new FakeOutput();
    output.writeResult = false;
    const { server } = createServer({ output, maxQueuedOutputMessages: 2 });

    const first = server.sendNotification("first", {});
    const second = server.sendNotification("second", {});
    expect(server.getStats()).toMatchObject({
      queuedOutputMessages: 2,
      queuedOutputBytes: expect.any(Number),
    });

    output.writeResult = true;
    output.emit("drain");
    await expect(first).resolves.toMatchObject({ accepted: true });
    await expect(second).resolves.toMatchObject({ accepted: true });
    expect(output.writes.map((line) => JSON.parse(line).method)).toEqual([
      "first",
      "second",
    ]);
    expect(server.getStats().queuedOutputMessages).toBe(0);
  });

  it("fails closed when the bounded output queue is full", async () => {
    const output = new FakeOutput();
    output.writeResult = false;
    const { server } = createServer({
      output,
      maxQueuedOutputMessages: 1,
    });
    server.state = ServerState.RUNNING;

    const first = server.sendNotification("first", {});
    const rejected = await server.sendNotification("second", {});
    await flushAsyncWork();

    expect(rejected).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      retryAfterMs: 100,
    });
    await expect(first).resolves.toMatchObject({ accepted: false });
    expect(server.state).toBe(ServerState.STOPPED);
    expect(server.getStats()).toMatchObject({
      outputQueueOverloaded: 1,
      queuedOutputMessages: 0,
    });
  });

  it("replaces an oversized response with a bounded JSON-RPC error", async () => {
    const { server, output } = createServer({ maxOutputMessageBytes: 256 });

    const result = await server.sendResponse(7, { value: "x".repeat(512) });

    expect(result).toMatchObject({ accepted: true, substituted: true });
    expect(JSON.parse(output.writes[0])).toMatchObject({
      id: 7,
      error: {
        code: JSON_RPC_ERRORS.SERVER_OVERLOADED,
        data: { maxOutputMessageBytes: 256 },
      },
    });
    expect(server.getStats().outputMessagesRejected).toBe(1);
  });

  it("terminates a stdout consumer that never drains", async () => {
    vi.useFakeTimers();
    const output = new FakeOutput();
    output.writeResult = false;
    const { server } = createServer({ output, outputDrainTimeoutMs: 10 });
    server.state = ServerState.RUNNING;

    const pending = server.sendNotification("blocked", {});
    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toMatchObject({
      accepted: false,
      code: "CC_MCP_STDIO_SLOW_CONSUMER",
    });
    expect(server.state).toBe(ServerState.STOPPED);
    expect(server.getStats().outputSlowConsumers).toBe(1);
  });
});
