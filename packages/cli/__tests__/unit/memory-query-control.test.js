import { afterEach, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { createMemoryQueryCheckpoint } from "../../src/lib/context-memory-kernel/memory-query-control.js";

afterEach(() => vi.restoreAllMocks());

it("delivers queued Stop during fast traversal even before the clock advances", async () => {
  vi.spyOn(performance, "now").mockReturnValue(0);
  const controller = new AbortController();
  const checkpoint = createMemoryQueryCheckpoint(controller.signal);
  const stop = setImmediate(() => controller.abort());
  let traversed = 0;
  try {
    await expect(
      (async () => {
        for (; traversed < 204; traversed++) await checkpoint();
      })(),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(traversed).toBeGreaterThan(0);
    expect(traversed).toBeLessThan(204);
  } finally {
    clearImmediate(stop);
  }
});
