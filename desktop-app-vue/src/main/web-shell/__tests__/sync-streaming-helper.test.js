/**
 * sync-streaming-helper 单元测试 — Phase 3c.D9
 */

import { describe, it, expect, vi } from "vitest";

const { syncStreamFromEngine } = require("../handlers/sync-streaming-helper");

/**
 * Helper: drain async generator into chunks array; capture return value.
 */
async function drain(gen) {
  const chunks = [];
  let returnValue;
  while (true) {
    const { value, done } = await gen.next();
    if (done) {
      returnValue = value;
      break;
    }
    chunks.push(value);
  }
  return { chunks, returnValue };
}

// ── happy paths ─────────────────────────────────────────────────────

describe("syncStreamFromEngine · happy path", () => {
  it("yields each onProgress call as a chunk + returns engine result", async () => {
    const engineEvents = [
      { phase: "start", pushed: 0, skipped: 0, deleted: 0, totalPending: 3 },
      { phase: "push", pushed: 1, skipped: 0, deleted: 0, totalPending: 3 },
      { phase: "push", pushed: 2, skipped: 0, deleted: 0, totalPending: 3 },
      { phase: "push", pushed: 3, skipped: 0, deleted: 0, totalPending: 3 },
      { phase: "success", pushed: 3, skipped: 0, deleted: 0, totalPending: 3 },
    ];
    const finalResult = {
      success: true,
      status: "success",
      pushed: 3,
      skipped: 0,
      deleted: 0,
      durationMs: 42,
    };

    const gen = syncStreamFromEngine({
      runEngine: async ({ onProgress }) => {
        for (const e of engineEvents) {
          onProgress(e);
          await new Promise((r) => setTimeout(r, 1));
        }
        return finalResult;
      },
    });

    const { chunks, returnValue } = await drain(gen);
    expect(chunks).toHaveLength(5);
    expect(chunks[0].phase).toBe("start");
    expect(chunks[4].phase).toBe("success");
    expect(returnValue).toEqual(finalResult);
  });

  it("synchronously-emitted progress events all surface in order", async () => {
    const finalResult = {
      status: "success",
      pushed: 2,
      skipped: 0,
      deleted: 0,
    };
    const gen = syncStreamFromEngine({
      runEngine: async ({ onProgress }) => {
        // Fire all events synchronously before any micro-task yields
        onProgress({ phase: "start", totalPending: 2 });
        onProgress({ phase: "push", pushed: 1 });
        onProgress({ phase: "push", pushed: 2 });
        return finalResult;
      },
    });
    const { chunks, returnValue } = await drain(gen);
    expect(chunks.map((c) => c.phase)).toEqual(["start", "push", "push"]);
    expect(returnValue).toEqual(finalResult);
  });

  it("empty progress (engine returns w/o calling onProgress) still returns result", async () => {
    const finalResult = { status: "success", pushed: 0 };
    const gen = syncStreamFromEngine({
      runEngine: async () => finalResult,
    });
    const { chunks, returnValue } = await drain(gen);
    expect(chunks).toEqual([]);
    expect(returnValue).toEqual(finalResult);
  });

  it("defensive: non-object progress (null / number) is silently dropped", async () => {
    const finalResult = { status: "success" };
    const gen = syncStreamFromEngine({
      runEngine: async ({ onProgress }) => {
        onProgress(null);
        onProgress(undefined);
        onProgress("a string");
        onProgress(42);
        onProgress({ phase: "real" });
        return finalResult;
      },
    });
    const { chunks } = await drain(gen);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].phase).toBe("real");
  });
});

// ── error paths ─────────────────────────────────────────────────────

describe("syncStreamFromEngine · engine error", () => {
  it("engine throws → generator throws (chunks before error still surface)", async () => {
    const gen = syncStreamFromEngine({
      runEngine: async ({ onProgress }) => {
        onProgress({ phase: "start", totalPending: 5 });
        onProgress({ phase: "push", pushed: 1 });
        throw new Error("network down");
      },
    });
    // Drain until throw
    const chunks = [];
    let caught;
    try {
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          break;
        }
        chunks.push(value);
      }
    } catch (err) {
      caught = err;
    }
    expect(chunks).toHaveLength(2);
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/network down/);
  });

  it("engine rejects synchronously → no chunks yielded, throws on next()", async () => {
    const gen = syncStreamFromEngine({
      runEngine: () => Promise.reject(new Error("immediate fail")),
    });
    await expect(gen.next()).rejects.toThrow(/immediate fail/);
  });
});

// ── cancellation path ──────────────────────────────────────────────

describe("syncStreamFromEngine · cancellation", () => {
  it("generator.return() mid-stream stops further yields, finalPromise unhandled-rejection safe", async () => {
    let resolveEngine;
    const enginePromise = new Promise((resolve) => {
      resolveEngine = resolve;
    });

    const gen = syncStreamFromEngine({
      runEngine: async ({ onProgress }) => {
        onProgress({ phase: "start", totalPending: 100 });
        return enginePromise; // hangs until we resolve
      },
    });

    // Pull first chunk then cancel
    const first = await gen.next();
    expect(first.value.phase).toBe("start");

    const ret = await gen.return("cancelled");
    expect(ret.done).toBe(true);

    // Subsequent next() returns done — no infinite hang
    const after = await gen.next();
    expect(after.done).toBe(true);

    // Resolve the engine after we already returned; should not throw
    // unhandled. We swallow via .catch(()=>{}) in helper.
    resolveEngine({ status: "success" });
    // Wait a tick to let the resolved value settle
    await new Promise((r) => setTimeout(r, 5));
  });
});

// ── input validation ──────────────────────────────────────────────

describe("syncStreamFromEngine · input validation", () => {
  // Note: async function* defers validation until first .next() call —
  // the generator object is created lazily; body doesn't run until iterated.
  it("throws TypeError on first .next() if runEngine missing", async () => {
    const gen = syncStreamFromEngine({});
    await expect(gen.next()).rejects.toThrow(/runEngine/);
  });

  it("throws TypeError on first .next() if runEngine not a function", async () => {
    const gen = syncStreamFromEngine({ runEngine: 42 });
    await expect(gen.next()).rejects.toThrow(/runEngine/);
  });
});
