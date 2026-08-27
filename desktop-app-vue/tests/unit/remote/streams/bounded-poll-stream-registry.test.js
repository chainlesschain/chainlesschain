import { describe, expect, it } from "vitest";

const {
  BoundedPollStreamRegistry,
  DEFAULT_LIMITS,
  HARD_LIMITS,
} = require("../../../../src/main/remote/streams/bounded-poll-stream-registry");

describe("BoundedPollStreamRegistry", () => {
  it("uses safe defaults and clamps caller-provided limits", () => {
    expect(new BoundedPollStreamRegistry().limits).toEqual(DEFAULT_LIMITS);

    const registry = new BoundedPollStreamRegistry({
      maxActiveStreams: Number.MAX_SAFE_INTEGER,
      maxRetainedStreams: Number.MAX_SAFE_INTEGER,
      maxChunksPerStream: Number.MAX_SAFE_INTEGER,
      maxBytesPerStream: Number.MAX_SAFE_INTEGER,
      maxTotalBufferedBytes: Number.MAX_SAFE_INTEGER,
      retentionMs: Number.MAX_SAFE_INTEGER,
    });
    expect(registry.limits).toEqual(HARD_LIMITS);
  });

  it("rejects admission until the provider physically settles", () => {
    const registry = new BoundedPollStreamRegistry({
      maxActiveStreams: 1,
      maxRetainedStreams: 2,
      retentionMs: 60_000,
    });
    const first = registry.create("first");
    registry.cancel(first);

    let overload;
    try {
      registry.create("second");
    } catch (error) {
      overload = error;
    }
    expect(overload).toMatchObject({
      code: "OVERLOADED",
      scope: "active_streams",
      retryAfterMs: 1000,
    });

    registry.settle("first", first);
    expect(registry.activeCount).toBe(0);
    expect(() => registry.create("third")).not.toThrow();
  });

  it("rejects duplicate ids and ignores stale state references", () => {
    const registry = new BoundedPollStreamRegistry({ retentionMs: 60_000 });
    const state = registry.create("same");

    let conflict;
    try {
      registry.create("same");
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toMatchObject({
      code: "STREAM_ID_CONFLICT",
      streamId: "same",
    });
    registry.settle("same", state);
    registry._deleteRecord("same", state);
    expect(registry.append(state, "late")).toBe(false);
    expect(registry.cancel(state)).toBe(false);
    expect(registry.settle("same", state)).toBe(false);
    expect(registry.totalBufferedBytes).toBe(0);
  });

  it("counts UTF-8 bytes and fails overflow closed", () => {
    const registry = new BoundedPollStreamRegistry({
      maxBytesPerStream: 5,
      retentionMs: 60_000,
    });
    const state = registry.create("utf8");

    expect(registry.append(state, "测试")).toBe(false);
    expect(state).toMatchObject({
      chunks: [],
      bufferedBytes: 0,
      done: true,
      errorCode: "STREAM_BUFFER_LIMIT_EXCEEDED",
      limit: {
        maxChunks: 2048,
        maxBytes: 5,
        maxTotalBytes: 16 * 1024 * 1024,
      },
      received: { chunks: 1, bytes: 6, totalBytes: 6 },
    });
    expect(registry.stats.rejectedBytes).toBe(6);
  });

  it("preserves accepted chunks but stops at the chunk-count boundary", () => {
    const registry = new BoundedPollStreamRegistry({
      maxChunksPerStream: 2,
      maxBytesPerStream: 100,
      retentionMs: 60_000,
    });
    const state = registry.create("chunks");

    expect(registry.append(state, "a")).toBe(true);
    expect(registry.append(state, "b")).toBe(true);
    expect(registry.append(state, "c")).toBe(false);
    expect(state.chunks).toEqual(["a", "b"]);
    expect(state.bufferedBytes).toBe(2);
  });

  it("evicts settled output before exceeding the global byte cap", () => {
    const registry = new BoundedPollStreamRegistry({
      maxBytesPerStream: 3,
      maxTotalBufferedBytes: 4,
      retentionMs: 60_000,
    });
    const first = registry.create("first");
    registry.append(first, "abc");
    registry.settle("first", first);

    const second = registry.create("second");
    expect(registry.append(second, "de")).toBe(true);

    expect(registry.states.has("first")).toBe(false);
    expect(registry.states.has("second")).toBe(true);
    expect(registry.totalBufferedBytes).toBe(2);
    expect(registry.stats.evicted).toBe(1);
  });

  it("evicts the oldest settled record at retained capacity", () => {
    const registry = new BoundedPollStreamRegistry({
      maxActiveStreams: 1,
      maxRetainedStreams: 2,
      retentionMs: 60_000,
    });
    const first = registry.create("first");
    registry.settle("first", first);
    const second = registry.create("second");
    registry.settle("second", second);
    const third = registry.create("third");

    expect(registry.states.size).toBe(2);
    expect(registry.states.has("first")).toBe(false);
    expect(registry.states.has("second")).toBe(true);
    expect(registry.states.has("third")).toBe(true);
    expect(registry.stats.evicted).toBe(1);
  });
});
