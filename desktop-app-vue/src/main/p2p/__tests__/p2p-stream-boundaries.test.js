import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const {
  HARD_P2P_STREAM_LIMITS,
  P2PProtocolRegistry,
  assertBoundedPayload,
  readBoundedStream,
  resolveP2PStreamLimits,
} = require("../p2p-stream-boundaries");

function streamFrom(chunks) {
  return {
    source: (async function* () {
      for (const chunk of chunks) {
        yield Buffer.from(chunk);
      }
    })(),
    abort: vi.fn(),
  };
}

describe("p2p stream boundaries", () => {
  it("keeps every P2PManager protocol read and registration behind the boundary adapter", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const managerSource = readFileSync(
      path.resolve(testDirectory, "..", "p2p-manager.js"),
      "utf8",
    );

    expect(managerSource).not.toMatch(/this\.node\.handle\(/);
    expect(managerSource).not.toMatch(
      /for await \(const chunk of (?:stream|stream\.source)\)/,
    );
    expect(managerSource.match(/this\._registerProtocol\(/g)?.length).toBe(10);
    expect(managerSource.match(/this\._readProtocolStream\(/g)?.length).toBe(
      12,
    );
    expect(managerSource).toContain("protocolRegistry?.close()");
    expect(managerSource).toContain("connectionPool?.destroy()");
  });

  it("resolves strict limits and refuses unknown or hard-limit values", () => {
    expect(
      resolveP2PStreamLimits({ maxMessageBytes: 32 }).maxMessageBytes,
    ).toBe(32);
    expect(() => resolveP2PStreamLimits({ unknown: 1 })).toThrow(/unknown/);
    expect(() =>
      resolveP2PStreamLimits({
        maxChunks: HARD_P2P_STREAM_LIMITS.maxChunks + 1,
      }),
    ).toThrow(/maxChunks/);
  });

  it("collects a valid byte stream without retaining source views", async () => {
    const backing = Buffer.from("abcdef");
    const stream = streamFrom([backing.subarray(0, 3), backing.subarray(3)]);
    const result = await readBoundedStream(stream, {
      maxMessageBytes: 6,
      maxChunks: 2,
      operationTimeoutMs: 100,
    });

    backing.fill(0);
    expect(result.toString()).toBe("abcdef");
    expect(stream.abort).not.toHaveBeenCalled();
  });

  it("aborts oversized, over-chunked, and stalled streams", async () => {
    const oversized = streamFrom([Buffer.alloc(5)]);
    await expect(
      readBoundedStream(oversized, {
        maxMessageBytes: 4,
        operationTimeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "P2P_STREAM_TOO_LARGE" });
    expect(oversized.abort).toHaveBeenCalledTimes(1);

    const fragmented = streamFrom([Buffer.from("a"), Buffer.from("b")]);
    await expect(
      readBoundedStream(fragmented, {
        maxChunks: 1,
        operationTimeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "P2P_STREAM_TOO_MANY_CHUNKS" });

    const stalled = {
      source: {
        [Symbol.asyncIterator]() {
          return { next: () => new Promise(() => {}) };
        },
      },
      abort: vi.fn(),
    };
    await expect(
      readBoundedStream(stalled, { operationTimeoutMs: 5 }),
    ).rejects.toMatchObject({ code: "P2P_STREAM_TIMEOUT" });
    expect(stalled.abort).toHaveBeenCalledTimes(1);
  });

  it("rejects outbound payloads before transport", () => {
    expect(
      assertBoundedPayload(Buffer.alloc(4), { maxMessageBytes: 4 }),
    ).toHaveLength(4);
    expect(() =>
      assertBoundedPayload(Buffer.alloc(5), { maxMessageBytes: 4 }),
    ).toThrow(/exceeded 4 bytes/);
  });
});

describe("p2p protocol registry", () => {
  it("bounds admission and unregisters exact protocols during close", async () => {
    const handlers = new Map();
    const node = {
      handle: vi.fn((protocol, handler) => handlers.set(protocol, handler)),
      unhandle: vi.fn((protocol) => handlers.delete(protocol)),
    };
    const registry = new P2PProtocolRegistry(node, {
      maxInboundStreams: 1,
      closeTimeoutMs: 100,
    });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    expect(registry.register("/bounded/1.0.0", () => gate)).toBe(true);
    expect(registry.register("/bounded/1.0.0", vi.fn())).toBe(false);

    const firstStream = { abort: vi.fn() };
    const secondStream = { abort: vi.fn() };
    const first = handlers.get("/bounded/1.0.0")({ stream: firstStream });
    await expect(
      handlers.get("/bounded/1.0.0")({ stream: secondStream }),
    ).rejects.toMatchObject({ code: "P2P_STREAM_OVERLOADED" });
    expect(secondStream.abort).toHaveBeenCalledTimes(1);

    const closing = registry.close();
    expect(firstStream.abort).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, closing]);
    expect(node.unhandle).toHaveBeenCalledWith("/bounded/1.0.0");
    await registry.close();
    expect(node.unhandle).toHaveBeenCalledTimes(1);
  });

  it("rolls back a protocol whose asynchronous registration fails", async () => {
    const node = {
      handle: vi.fn(async () => {
        throw new Error("registration failed");
      }),
      unhandle: vi.fn(),
    };
    const registry = new P2PProtocolRegistry(node);
    expect(registry.register("/failed/1.0.0", vi.fn())).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.protocols.has("/failed/1.0.0")).toBe(false);
    await registry.close();
    expect(node.unhandle).not.toHaveBeenCalled();
  });
});
