import { describe, expect, it, vi } from "vitest";
import { runBatch, _internal } from "../../src/lib/agent-batch.js";

/**
 * Fully-injected batch core: no real worktrees, agents, or git. Each dep is a
 * spy/stub so we can assert the fan-out, per-unit aggregation, and sequential
 * integration behavior deterministically.
 */
function makeDeps(overrides = {}) {
  const state = { created: [], removed: [], merges: [] };
  const deps = {
    createWorktree: vi.fn((key, branch) => {
      state.created.push({ key, branch });
      return `/wt/${key}`;
    }),
    removeWorktree: vi.fn((p, opts) => state.removed.push({ p, opts })),
    runAgent: vi.fn(async () => ({ code: 0 })),
    runTest: vi.fn(async () => ({ code: 0 })),
    diffStat: vi.fn(() => ({ filesChanged: 2, insertions: 10, deletions: 1 })),
    commit: vi.fn(() => true),
    previewMerge: vi.fn(() => ({ success: true, conflicts: [] })),
    mergeBranch: vi.fn((branch) => {
      state.merges.push(branch);
      return { success: true };
    }),
    branchFor: (key) => `batch/${key}`,
    ...overrides,
  };
  return { deps, state };
}

const UNITS = [
  { key: "a", prompt: "do a" },
  { key: "b", prompt: "do b" },
];

describe("runBatch", () => {
  it("runs every unit in its own worktree and aggregates done status", async () => {
    const { deps } = makeDeps();
    const { units, summary } = await runBatch({ units: UNITS }, deps);
    expect(deps.createWorktree).toHaveBeenCalledTimes(2);
    expect(deps.runAgent).toHaveBeenCalledTimes(2);
    expect(units.every((u) => u.status === "done")).toBe(true);
    expect(summary).toMatchObject({ total: 2, done: 2, errored: 0 });
  });

  it("runs a per-unit test and marks test-failed without merging it", async () => {
    const { deps } = makeDeps({
      runTest: vi.fn(async (cmd) => {
        if (cmd === "fail") throw new Error("boom");
        return { code: 0 };
      }),
    });
    const { units, summary } = await runBatch(
      {
        units: [
          { key: "ok", prompt: "x", test: "pass" },
          { key: "bad", prompt: "y", test: "fail" },
        ],
        merge: true,
      },
      deps,
    );
    const bad = units.find((u) => u.key === "bad");
    expect(bad.status).toBe("test-failed");
    expect(bad.testPassed).toBe(false);
    expect(bad.integration.eligible).toBe(false);
    // The failing unit never merges; the passing one does.
    expect(deps.mergeBranch).toHaveBeenCalledTimes(1);
    expect(deps.mergeBranch).toHaveBeenCalledWith(
      "batch/ok",
      expect.any(String),
    );
    expect(summary.testFailed).toBe(1);
    expect(summary.merged).toBe(1);
  });

  it("reports conflicts from the merge preview instead of clobbering", async () => {
    const { deps } = makeDeps({
      previewMerge: vi.fn((branch) =>
        branch === "batch/b"
          ? { success: false, conflicts: ["src/x.js"] }
          : { success: true, conflicts: [] },
      ),
    });
    const { units, summary } = await runBatch(
      { units: UNITS, merge: true },
      deps,
    );
    const b = units.find((u) => u.key === "b");
    expect(b.integration.clean).toBe(false);
    expect(b.integration.conflicts).toEqual(["src/x.js"]);
    expect(b.integration.merged).toBe(false);
    expect(summary.conflicted).toBe(1);
    expect(summary.merged).toBe(1); // only "a"
  });

  it("marks a unit that changed nothing as no-changes and skips integration", async () => {
    const { deps } = makeDeps({
      diffStat: vi.fn(() => ({ filesChanged: 0, insertions: 0, deletions: 0 })),
    });
    const { units, summary } = await runBatch({ units: UNITS }, deps);
    expect(units.every((u) => u.status === "no-changes")).toBe(true);
    expect(deps.commit).not.toHaveBeenCalled();
    expect(summary.noChanges).toBe(2);
  });

  it("captures an agent error as unit status error", async () => {
    const { deps } = makeDeps({
      runAgent: vi.fn(async (prompt) => {
        if (prompt === "do b") throw new Error("agent died");
        return { code: 0 };
      }),
    });
    const { units, summary } = await runBatch({ units: UNITS }, deps);
    const b = units.find((u) => u.key === "b");
    expect(b.status).toBe("error");
    expect(b.error).toMatch(/agent died/);
    expect(summary.errored).toBe(1);
  });

  it("honours concurrency (never more than N agents in flight)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { deps } = makeDeps({
      runAgent: vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      }),
    });
    const units = Array.from({ length: 6 }, (_, i) => ({
      key: `u${i}`,
      prompt: `p${i}`,
    }));
    await runBatch({ units, concurrency: 2 }, deps);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("emits progress events", async () => {
    const { deps } = makeDeps();
    const events = [];
    await runBatch({ units: UNITS, onEvent: (e) => events.push(e.type) }, deps);
    expect(events).toContain("batch:start");
    expect(events).toContain("unit:done");
    expect(events).toContain("batch:done");
  });

  it("rejects empty / duplicate / prompt-less units", async () => {
    const { deps } = makeDeps();
    await expect(runBatch({ units: [] }, deps)).rejects.toThrow(/non-empty/);
    await expect(
      runBatch(
        {
          units: [
            { key: "x", prompt: "a" },
            { key: "x", prompt: "b" },
          ],
        },
        deps,
      ),
    ).rejects.toThrow(/duplicate/);
    await expect(runBatch({ units: [{ key: "x" }] }, deps)).rejects.toThrow(
      /no prompt/,
    );
  });
});

describe("agent-batch internals", () => {
  it("mapPool preserves order and bounds concurrency", async () => {
    const out = await _internal.mapPool([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("normalizeUnits fills default keys", () => {
    const norm = _internal.normalizeUnits([{ prompt: "a" }, { prompt: "b" }]);
    expect(norm.map((u) => u.key)).toEqual(["unit-1", "unit-2"]);
  });
});
