import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const {
  createCollabBoundaries,
  assertDocumentId,
  normalizeUpdate,
  assertAwarenessState,
} = require("../collab-boundaries");
const YjsCollabManager = require("../yjs-collab-manager");

function createDatabase() {
  return {
    getDatabase: () => ({
      prepare: () => ({
        all: () => [],
        get: () => null,
        run: vi.fn(),
      }),
    }),
  };
}

function createStream() {
  const stream = new EventEmitter();
  stream.abort = vi.fn();
  return stream;
}

describe("collaboration boundary config", () => {
  it("rejects arrays, unknown keys, and values above the hard limit", () => {
    expect(() => createCollabBoundaries([])).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_BOUNDARY_CONFIG" }),
    );
    expect(() => createCollabBoundaries({ typo: 1 })).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_BOUNDARY_CONFIG" }),
    );
    expect(() =>
      createCollabBoundaries({ maxStreamBytes: Number.MAX_SAFE_INTEGER }),
    ).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_BOUNDARY_CONFIG" }),
    );
  });

  it("normalizes numeric strings without allowing zero or fractions", () => {
    expect(createCollabBoundaries({ maxStreamBytes: "4096" })).toMatchObject({
      maxStreamBytes: 4096,
    });
    expect(() => createCollabBoundaries({ maxStreamBytes: 0 })).toThrow();
    expect(() => createCollabBoundaries({ maxStreamBytes: 1.5 })).toThrow();
  });

  it("bounds document IDs, updates, and awareness payloads by UTF-8 bytes", () => {
    const boundaries = createCollabBoundaries({
      maxDocumentIdBytes: 4,
      maxIpcUpdateBytes: 3,
      maxAwarenessBytes: 16,
    });

    expect(assertDocumentId("doc", boundaries)).toBe("doc");
    expect(() => assertDocumentId("文档", boundaries)).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_DOCUMENT_ID_TOO_LARGE" }),
    );
    expect(Array.from(normalizeUpdate([0, 1, 255], boundaries))).toEqual([
      0, 1, 255,
    ]);
    expect(() => normalizeUpdate([256], boundaries)).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_UPDATE_INVALID" }),
    );
    expect(() => normalizeUpdate([1, 2, 3, 4], boundaries)).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_UPDATE_TOO_LARGE" }),
    );
    expect(assertAwarenessState({ x: 1 }, boundaries)).toEqual({ x: 1 });
    expect(() =>
      assertAwarenessState({ value: "payload-too-large" }, boundaries),
    ).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_AWARENESS_TOO_LARGE" }),
    );
  });
});

describe("YjsCollabManager bounded stream reads", () => {
  let manager;

  afterEach(() => {
    manager?.destroy();
    manager = null;
  });

  function createManager(boundaries = {}) {
    manager = new YjsCollabManager(null, createDatabase(), {
      boundaries: {
        maxStreamBytes: 8,
        maxStreamChunks: 2,
        streamReadTimeoutMs: 1000,
        ...boundaries,
      },
    });
    return manager;
  }

  it("combines a bounded stream and removes listeners after completion", async () => {
    const stream = createStream();
    const pending = createManager()._readFromStream(stream);

    stream.emit("data", Buffer.from("ab"));
    stream.emit("data", Uint8Array.from([99, 100]));
    stream.emit("end");

    await expect(pending).resolves.toEqual(Buffer.from("abcd"));
    expect(stream.listenerCount("data")).toBe(0);
    expect(stream.listenerCount("end")).toBe(0);
    expect(stream.listenerCount("error")).toBe(0);
  });

  it("fails closed when byte or chunk limits are exceeded", async () => {
    const byteStream = createStream();
    const byteRead = createManager({ maxStreamBytes: 3 })._readFromStream(
      byteStream,
    );
    byteStream.emit("data", Buffer.from("four"));
    await expect(byteRead).rejects.toMatchObject({
      code: "ERR_COLLAB_STREAM_BYTES_EXCEEDED",
    });
    expect(byteStream.abort).toHaveBeenCalledOnce();

    manager.destroy();
    const chunkStream = createStream();
    const chunkRead = createManager({ maxStreamChunks: 1 })._readFromStream(
      chunkStream,
    );
    chunkStream.emit("data", Buffer.from("a"));
    chunkStream.emit("data", Buffer.from("b"));
    await expect(chunkRead).rejects.toMatchObject({
      code: "ERR_COLLAB_STREAM_CHUNKS_EXCEEDED",
    });
    expect(chunkStream.abort).toHaveBeenCalledOnce();
  });

  it("times out and detaches listeners when a peer never ends the stream", async () => {
    const stream = createStream();
    const pending = createManager({ streamReadTimeoutMs: 20 })._readFromStream(
      stream,
    );

    await expect(pending).rejects.toMatchObject({
      code: "ERR_COLLAB_STREAM_TIMEOUT",
    });
    expect(stream.abort).toHaveBeenCalledOnce();
    expect(stream.listenerCount("data")).toBe(0);
  });
});
