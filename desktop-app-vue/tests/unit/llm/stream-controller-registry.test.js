import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STREAM_CONTROLLER_REGISTRY_LIMITS,
  HARD_STREAM_CONTROLLER_REGISTRY_LIMITS,
  StreamControllerRegistry,
} from "../../../src/main/llm/stream-controller-registry.js";

function createController(status = "idle") {
  return {
    status,
    removeAllListeners: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("StreamControllerRegistry", () => {
  it("uses finite defaults and clamps custom limits to hard ceilings", () => {
    expect(new StreamControllerRegistry().limits).toEqual(
      DEFAULT_STREAM_CONTROLLER_REGISTRY_LIMITS,
    );
    expect(
      new StreamControllerRegistry({
        maxActiveControllers: Number.MAX_SAFE_INTEGER,
        maxStreamIdBytes: Number.MAX_SAFE_INTEGER,
        retryAfterMs: Number.MAX_SAFE_INTEGER,
      }).limits,
    ).toEqual(HARD_STREAM_CONTROLLER_REGISTRY_LIMITS);
  });

  it("returns structured overload metadata at active capacity", () => {
    const registry = new StreamControllerRegistry({
      maxActiveControllers: 2,
      retryAfterMs: 25,
    });
    registry.getOrCreate("one", () => createController());
    registry.getOrCreate("two", () => createController());

    let overload;
    try {
      registry.getOrCreate("three", () => createController());
    } catch (error) {
      overload = error;
    }

    expect(overload).toMatchObject({
      code: "OVERLOADED",
      scope: "stream_controllers",
      retryAfterMs: 25,
      limit: { maxActiveControllers: 2 },
    });
    expect(registry.size).toBe(2);
  });

  it("evicts the oldest terminal controller before admitting a replacement", () => {
    const registry = new StreamControllerRegistry({ maxActiveControllers: 2 });
    const oldest = createController("completed");
    registry.getOrCreate("oldest", () => oldest);
    registry.getOrCreate("active", () => createController("streaming"));

    const replacement = createController();
    expect(registry.getOrCreate("replacement", () => replacement)).toEqual({
      controller: replacement,
      created: true,
    });
    expect(registry.has("oldest")).toBe(false);
    expect(oldest.removeAllListeners).toHaveBeenCalledOnce();
    expect(registry.size).toBe(2);
  });

  it("keeps delayed terminal cleanup timers bounded with the registry", () => {
    vi.useFakeTimers();
    try {
      const registry = new StreamControllerRegistry({
        maxActiveControllers: 1,
      });
      const terminal = createController("completed");
      registry.getOrCreate("terminal", () => terminal);
      expect(registry.scheduleTerminalDelete("terminal", 100)).toBe(true);
      expect(registry.getStats().scheduledCleanups).toBe(1);

      registry.getOrCreate("replacement", () => createController());
      expect(registry.getStats().scheduledCleanups).toBe(0);
      expect(registry.has("terminal")).toBe(false);

      vi.advanceTimersByTime(100);
      expect(registry.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds identifiers by UTF-8 byte length before retaining them", () => {
    const registry = new StreamControllerRegistry({ maxStreamIdBytes: 4 });

    expect(registry.validateStreamId("ab")).toEqual({
      accepted: true,
      streamId: "ab",
    });
    expect(registry.validateStreamId("你好")).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "stream_controller_id",
      limit: { maxStreamIdBytes: 4 },
    });
    expect(registry.size).toBe(0);
  });

  it("destroys all retained controllers even when one destroy call fails", () => {
    const registry = new StreamControllerRegistry();
    const first = createController();
    first.destroy.mockImplementation(() => {
      throw new Error("destroy failed");
    });
    const second = createController();
    registry.getOrCreate("first", () => first);
    registry.getOrCreate("second", () => second);

    registry.destroyAll();

    expect(first.removeAllListeners).toHaveBeenCalledOnce();
    expect(second.removeAllListeners).toHaveBeenCalledOnce();
    expect(second.destroy).toHaveBeenCalledOnce();
    expect(registry.size).toBe(0);
  });
});
