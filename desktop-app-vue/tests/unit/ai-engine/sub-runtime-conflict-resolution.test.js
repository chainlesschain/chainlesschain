/**
 * sub-runtime-conflict-resolution.test.js — Path B-1 tests
 *
 * Tests the generic conflict resolution API added to SubRuntimePool:
 *   - detectConflictPairs / pickWinnersAndLosers pure helpers
 *   - runWithConflictResolution method (mocked dispatch)
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const mod = require("../../../src/main/ai-engine/code-agent/sub-runtime-pool.js");

const { detectConflictPairs, pickWinnersAndLosers, SubRuntimePool, _deps } =
  mod;

// ── Pure helper tests ─────────────────────────────────────────────

describe("detectConflictPairs", () => {
  test("returns empty array when no conflicts", () => {
    const results = [
      { id: "a", range: [0, 5] },
      { id: "b", range: [10, 15] },
    ];
    const detector = (a, b) => {
      const [aS, aE] = a.range;
      const [bS, bE] = b.range;
      return aS < bE && aE > bS;
    };
    expect(detectConflictPairs(results, detector)).toEqual([]);
  });

  test("detects overlapping time ranges", () => {
    const results = [
      { id: "a", range: [0, 10] },
      { id: "b", range: [5, 15] },
      { id: "c", range: [20, 30] },
    ];
    const detector = (a, b) => {
      const [aS, aE] = a.range;
      const [bS, bE] = b.range;
      return aS < bE && aE > bS;
    };
    const pairs = detectConflictPairs(results, detector);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual([results[0], results[1]]);
  });

  test("detects multiple conflicts", () => {
    const results = [
      { id: "a", range: [0, 10] },
      { id: "b", range: [5, 15] },
      { id: "c", range: [8, 20] },
    ];
    const detector = (a, b) => {
      const [aS, aE] = a.range;
      const [bS, bE] = b.range;
      return aS < bE && aE > bS;
    };
    const pairs = detectConflictPairs(results, detector);
    expect(pairs).toHaveLength(3); // a-b, a-c, b-c
  });

  test("returns empty for empty input", () => {
    expect(detectConflictPairs([], () => true)).toEqual([]);
  });

  test("single result has no conflicts", () => {
    expect(detectConflictPairs([{ id: "a" }], () => true)).toEqual([]);
  });
});

describe("pickWinnersAndLosers", () => {
  test("higher scorer wins", () => {
    const a = { id: "a", quality: 0.8 };
    const b = { id: "b", quality: 0.3 };
    const pairs = [[a, b]];
    const scorer = (r) => r.quality;
    const { winners, losers } = pickWinnersAndLosers(pairs, scorer);
    expect(winners.has(a)).toBe(true);
    expect(losers.has(b)).toBe(true);
    expect(losers.get(b)).toEqual([a]);
  });

  test("equal scores: first wins (tiebreak)", () => {
    const a = { id: "a", quality: 0.5 };
    const b = { id: "b", quality: 0.5 };
    const { winners, losers } = pickWinnersAndLosers(
      [[a, b]],
      (r) => r.quality,
    );
    expect(winners.has(a)).toBe(true);
    expect(losers.has(b)).toBe(true);
  });

  test("loser collects multiple winners", () => {
    const a = { id: "a", quality: 0.9 };
    const b = { id: "b", quality: 0.8 };
    const c = { id: "c", quality: 0.2 };
    const pairs = [
      [a, c],
      [b, c],
    ];
    const { losers } = pickWinnersAndLosers(pairs, (r) => r.quality);
    expect(losers.get(c)).toHaveLength(2);
    expect(losers.get(c)).toContain(a);
    expect(losers.get(c)).toContain(b);
  });

  test("empty pairs returns empty sets", () => {
    const { winners, losers } = pickWinnersAndLosers([], (r) => r.q);
    expect(winners.size).toBe(0);
    expect(losers.size).toBe(0);
  });
});

// ── runWithConflictResolution integration ──────────────────────────

describe("SubRuntimePool.runWithConflictResolution", () => {
  let pool;
  let spawnMock;

  beforeEach(() => {
    // Mock spawn to avoid real child processes
    spawnMock = vi.fn();
    _deps.spawn = spawnMock;
    _deps.now = () => 1700000000000;

    pool = new SubRuntimePool({
      maxSize: 4,
      readyTimeoutMs: 100,
      runTimeoutMs: 200,
    });

    // Mock _runSingle to return predictable results
    pool._runSingle = vi.fn();
  });

  test("throws on missing required parameters", async () => {
    await expect(
      pool.runWithConflictResolution({
        tasks: [],
        conflictDetector: () => {},
        qualityScorer: () => {},
      }),
    ).rejects.toThrow("projectRoot, sessionId, tasks required");
  });

  test("throws on missing callback functions", async () => {
    await expect(
      pool.runWithConflictResolution({
        projectRoot: "/tmp",
        sessionId: "s1",
        tasks: [{ id: "t1", assignment: {} }],
        conflictDetector: "not-a-function",
        qualityScorer: () => 1,
        rerunBuilder: () => ({}),
      }),
    ).rejects.toThrow("must be functions");
  });

  test("returns empty array for empty tasks", async () => {
    const result = await pool.runWithConflictResolution({
      projectRoot: "/tmp",
      sessionId: "s1",
      tasks: [],
      conflictDetector: () => false,
      qualityScorer: () => 1,
      rerunBuilder: () => ({}),
    });
    expect(result).toEqual([]);
  });

  test("runs tasks and returns results when no conflicts", async () => {
    pool._runSingle.mockResolvedValueOnce({
      success: true,
      memberIdx: 0,
      progressEvents: [],
    });
    pool._runSingle.mockResolvedValueOnce({
      success: true,
      memberIdx: 1,
      progressEvents: [],
    });

    const result = await pool.runWithConflictResolution({
      projectRoot: "/tmp",
      sessionId: "s1",
      tasks: [
        { id: "t1", payload: { range: [0, 5] }, assignment: { memberIdx: 0 } },
        {
          id: "t2",
          payload: { range: [10, 15] },
          assignment: { memberIdx: 1 },
        },
      ],
      conflictDetector: () => false,
      qualityScorer: () => 1,
      rerunBuilder: () => ({}),
    });

    expect(result).toHaveLength(2);
    expect(result[0].taskId).toBe("t1");
    expect(result[1].taskId).toBe("t2");
    expect(result[0].success).toBe(true);
    expect(result[0].rerunCount).toBe(0);
  });

  test("detects conflicts and reruns losers", async () => {
    // Initial run: both succeed with overlapping payloads
    pool._runSingle.mockResolvedValueOnce({
      success: true,
      memberIdx: 0,
      progressEvents: [],
    });
    pool._runSingle.mockResolvedValueOnce({
      success: true,
      memberIdx: 1,
      progressEvents: [],
    });
    // Rerun of loser
    pool._runSingle.mockResolvedValueOnce({
      success: true,
      memberIdx: 1,
      progressEvents: [],
    });

    let conflictRound = 0;
    const result = await pool.runWithConflictResolution({
      projectRoot: "/tmp",
      sessionId: "s1",
      tasks: [
        { id: "t1", payload: { quality: 0.9 }, assignment: { memberIdx: 0 } },
        { id: "t2", payload: { quality: 0.3 }, assignment: { memberIdx: 1 } },
      ],
      conflictDetector: (a, b) => {
        // Only conflict on first round
        if (conflictRound === 0) {
          conflictRound++;
          return true;
        }
        return false;
      },
      qualityScorer: (r) => r.payload?.quality ?? 0.5,
      rerunBuilder: (loser, winners) => {
        return { memberIdx: loser.memberIdx || 1, rerun: true };
      },
    });

    expect(result).toHaveLength(2);
    // t2 was the loser (quality 0.3 < 0.9), should have been rerun
    expect(pool._runSingle).toHaveBeenCalledTimes(3); // 2 initial + 1 rerun
  });

  test("emits conflict-resolution events", async () => {
    const events = [];
    pool.on("conflict-resolution:initial-done", (e) =>
      events.push(["initial", e]),
    );
    pool.on("conflict-resolution:round-start", (e) =>
      events.push(["round", e]),
    );
    pool.on("conflict-resolution:rerun", (e) => events.push(["rerun", e]));
    pool.on("conflict-resolution:round-end", (e) => events.push(["end", e]));

    pool._runSingle.mockResolvedValue({
      success: true,
      memberIdx: 0,
      progressEvents: [],
    });

    let firstCall = true;
    await pool.runWithConflictResolution({
      projectRoot: "/tmp",
      sessionId: "s1",
      tasks: [
        { id: "t1", payload: { q: 0.9 }, assignment: { memberIdx: 0 } },
        { id: "t2", payload: { q: 0.2 }, assignment: { memberIdx: 1 } },
      ],
      conflictDetector: () => {
        if (firstCall) {
          firstCall = false;
          return true;
        }
        return false;
      },
      qualityScorer: (r) => r.payload?.q ?? 0.5,
      rerunBuilder: () => ({ memberIdx: 1 }),
    });

    expect(events.some(([t]) => t === "initial")).toBe(true);
    expect(events.some(([t]) => t === "round")).toBe(true);
    expect(events.some(([t]) => t === "rerun")).toBe(true);
    expect(events.some(([t]) => t === "end")).toBe(true);
  });

  test("respects maxReruns limit", async () => {
    pool._runSingle.mockResolvedValue({
      success: true,
      memberIdx: 0,
      progressEvents: [],
    });

    await pool.runWithConflictResolution({
      projectRoot: "/tmp",
      sessionId: "s1",
      tasks: [
        { id: "t1", payload: {}, assignment: { memberIdx: 0 } },
        { id: "t2", payload: {}, assignment: { memberIdx: 1 } },
      ],
      conflictDetector: () => true, // always conflicts
      qualityScorer: (r) => (r.taskId === "t1" ? 0.9 : 0.1),
      rerunBuilder: () => ({ memberIdx: 1 }),
      maxReruns: 2,
    });

    // 2 initial + 2 reruns (maxReruns=2)
    expect(pool._runSingle).toHaveBeenCalledTimes(4);
  });

  test("skips rerun when rerunBuilder returns null", async () => {
    pool._runSingle.mockResolvedValue({
      success: true,
      memberIdx: 0,
      progressEvents: [],
    });

    let firstCall = true;
    await pool.runWithConflictResolution({
      projectRoot: "/tmp",
      sessionId: "s1",
      tasks: [
        { id: "t1", payload: {}, assignment: { memberIdx: 0 } },
        { id: "t2", payload: {}, assignment: { memberIdx: 1 } },
      ],
      conflictDetector: () => {
        if (firstCall) {
          firstCall = false;
          return true;
        }
        return false;
      },
      qualityScorer: (r) => (r.taskId === "t1" ? 0.9 : 0.1),
      rerunBuilder: () => null, // skip rerun
    });

    // Only 2 initial runs, no rerun
    expect(pool._runSingle).toHaveBeenCalledTimes(2);
  });
});
