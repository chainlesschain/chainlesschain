import { describe, expect, it } from "vitest";
import {
  normalizeSessionResourceBudgetSnapshot,
  SessionBudgetError,
  SessionResourceBudget,
} from "../../src/lib/session-resource-budget.js";

class ManualClock {
  constructor(at = 0) {
    this.at = at;
    this.nextId = 1;
    this.timers = new Map();
  }

  now = () => this.at;

  setTimer = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, {
      callback,
      due: this.at + Math.max(0, Number(delay) || 0),
    });
    return id;
  };

  clearTimer = (id) => {
    this.timers.delete(id);
  };

  advance(ms) {
    const target = this.at + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (!due) break;
      const [id, timer] = due;
      this.timers.delete(id);
      this.at = timer.due;
      timer.callback();
    }
    this.at = target;
  }
}

function makeBudget(limits = {}, clock = new ManualClock()) {
  return {
    clock,
    budget: new SessionResourceBudget({
      ...limits,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    }),
  };
}

describe("SessionResourceBudget admission", () => {
  it("atomically caps concurrent work across racing continuations", async () => {
    const { budget } = makeBudget({ maxConcurrent: 3, maxSpawns: 20 });
    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        Promise.resolve().then(() =>
          budget.acquireWork({ id: `work-${index}`, depth: 1 }),
        ),
      ),
    );

    expect(attempts.filter((entry) => entry.ok)).toHaveLength(3);
    expect(
      attempts
        .filter((entry) => !entry.ok)
        .every((entry) => entry.reason === "max-concurrent"),
    ).toBe(true);
    expect(budget.status()).toMatchObject({ active: 3, spawns: 3 });

    attempts.find((entry) => entry.ok).release();
    expect(
      budget.acquireWork({ id: "replacement", kind: "background", depth: 2 }),
    ).toMatchObject({ ok: true, kind: "background", depth: 2 });
    expect(budget.status()).toMatchObject({ active: 3, spawns: 4 });
    budget.dispose();
  });

  it("enforces total spawn and depth without consuming rejected attempts", () => {
    const { budget } = makeBudget({
      maxConcurrent: 2,
      maxSpawns: 2,
      maxDepth: 2,
    });

    expect(budget.acquireWork({ id: "too-deep", depth: 3 })).toMatchObject({
      ok: false,
      reason: "max-depth",
    });
    const first = budget.acquireWork({ id: "first", depth: 2 });
    expect(first.ok).toBe(true);
    first.release();
    const second = budget.acquireWork({ id: "second", depth: 1 });
    expect(second.ok).toBe(true);
    second.release();
    expect(budget.acquireWork({ id: "third", depth: 1 })).toMatchObject({
      ok: false,
      reason: "max-spawns",
    });
    expect(budget.status()).toMatchObject({ active: 0, spawns: 2 });
    budget.dispose();
  });

  it("shares one max-turn counter for the complete session", () => {
    const { budget } = makeBudget({ maxTurns: 2 });
    expect(budget.consumeTurn({ id: "root:1" })).toMatchObject({ ok: true });
    expect(budget.consumeTurn({ id: "child:1" })).toMatchObject({ ok: true });
    expect(budget.consumeTurn({ id: "root:2" })).toMatchObject({
      ok: false,
      reason: "max-turns",
    });
    expect(budget.status()).toMatchObject({ turns: 2, maxTurns: 2 });
    budget.dispose();
  });

  it("keeps work and tool ids globally unique", () => {
    const { budget } = makeBudget();
    const work = budget.acquireWork({ id: "shared-id", depth: 1 });
    expect(work.ok).toBe(true);
    expect(budget.beginTool({ id: "shared-id" })).toMatchObject({
      ok: false,
      reason: "duplicate-resource-id",
    });
    work.release();

    const tool = budget.beginTool({ id: "tool-first" });
    expect(tool.ok).toBe(true);
    expect(budget.acquireWork({ id: "tool-first", depth: 1 })).toMatchObject({
      ok: false,
      reason: "duplicate-resource-id",
    });
    tool.end();
    budget.dispose();
  });
});

describe("SessionResourceBudget continuous enforcement", () => {
  it("tracks concurrent provider usage until each call settles", () => {
    const { budget } = makeBudget({ maxTokens: 20 });
    const first = budget.beginUsageSettlement({ id: "provider-call-a" });
    const second = budget.beginUsageSettlement({ id: "provider-call-b" });

    expect(first).toMatchObject({ ok: true, id: "provider-call-a" });
    expect(second).toMatchObject({ ok: true, id: "provider-call-b" });
    expect(first.authorityId).not.toBe(second.authorityId);
    expect(budget.status()).toMatchObject({
      pendingUsage: 2,
      recoveryRequired: false,
    });
    expect(budget.consumeTurn({ id: "parallel-turn" })).toMatchObject({
      ok: true,
    });

    budget.recordUsage({
      callId: "provider-call-a",
      provider: "ollama",
      model: "local",
      usage: { input_tokens: 3, output_tokens: 2 },
    });
    expect(budget.status()).toMatchObject({
      tokens: 5,
      pendingUsage: 1,
      recoveryRequired: false,
    });

    budget.markUsageUnknown({ callId: "provider-call-b" });
    expect(budget.status()).toMatchObject({
      tokens: 5,
      pendingUsage: 0,
      recoveryRequired: true,
      pendingRecovery: 1,
      reason: "recovery-required",
    });
    expect(budget.snapshot().inFlight.work).toEqual([
      expect.objectContaining({
        id: second.authorityId,
        kind: "usage-settlement",
      }),
    ]);
    expect(
      budget.adjudicateRecovery({ abandoned: [second.authorityId] }),
    ).toMatchObject({ ok: true });
    budget.dispose();
  });

  it("atomically records verified usage while abandoning other recovery authorities", () => {
    const source = makeBudget({ maxTokens: 100, maxUsd: 100 }).budget;
    const work = source.acquireWork({ id: "crashed-work", depth: 1 });
    const usage = source.beginUsageSettlement({ id: "unknown-provider-call" });
    source.markUsageUnknown({ callId: usage.id });
    const snapshot = source.snapshot();
    source.dispose();

    const resumed = SessionResourceBudget.restore(snapshot);
    const result = resumed.adjudicateRecovery({
      abandoned: [work.authorityId],
      settled: [
        {
          authorityId: usage.authorityId,
          provider: "anthropic",
          model: "claude-3-5-sonnet-20241022",
          usage: { input_tokens: 8, output_tokens: 2 },
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      abandoned: [work.authorityId],
      settled: [usage.authorityId],
    });
    expect(resumed.status()).toMatchObject({
      tokens: 10,
      recoveryRequired: false,
      pendingRecovery: 0,
      unpricedUsage: false,
    });
    expect(resumed.cost.spentUsd).toBeGreaterThan(0);
    resumed.dispose();
  });

  it("leaves recovery and totals unchanged when verified usage is invalid", () => {
    const source = makeBudget({ maxTokens: 100 }).budget;
    const usage = source.beginUsageSettlement({ id: "invalid-recovery-usage" });
    source.markUsageUnknown({ callId: usage.id });
    const snapshot = source.snapshot();
    source.dispose();
    const resumed = SessionResourceBudget.restore(snapshot);

    expect(() =>
      resumed.adjudicateRecovery({
        settled: [
          {
            authorityId: usage.authorityId,
            provider: "openai",
            model: "gpt-test",
            usage: { input_tokens: -1 },
          },
        ],
      }),
    ).toThrow(/invalid session budget usage: input_tokens/);
    expect(resumed.status()).toMatchObject({
      tokens: 0,
      recoveryRequired: true,
      pendingRecovery: 1,
      aborted: false,
    });
    resumed.dispose();
  });

  it("rolls back verified recovery accounting when persistence fails", () => {
    const source = makeBudget({ maxTokens: 100, maxUsd: 100 }).budget;
    const usage = source.beginUsageSettlement({ id: "recovery-write-fails" });
    source.markUsageUnknown({ callId: usage.id });
    const snapshot = source.snapshot();
    source.dispose();
    const persistenceError = new Error("recovery store unavailable");
    const resumed = SessionResourceBudget.restore(snapshot, {
      onAuthorityChange: ({ type }) => {
        if (type === "budget:recovery-adjudicated") throw persistenceError;
      },
    });

    expect(() =>
      resumed.adjudicateRecovery({
        settled: [
          {
            authorityId: usage.authorityId,
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
            usage: { input_tokens: 8, output_tokens: 2 },
          },
        ],
      }),
    ).toThrow(persistenceError);
    expect(resumed.status()).toMatchObject({
      tokens: 0,
      spentUsd: 0,
      recoveryRequired: true,
      pendingRecovery: 1,
      aborted: true,
      reason: "persistence-failed",
    });
    resumed.dispose();
  });

  it("rolls back ordinary usage accounting when its durable write fails", () => {
    const persistenceError = new Error("usage store unavailable");
    const { budget } = makeBudget({
      maxTokens: 100,
      maxUsd: 100,
      onAuthorityChange: ({ type }) => {
        if (type === "budget:usage-recorded") throw persistenceError;
      },
    });
    budget.beginUsageSettlement({ id: "known-write-fails" });

    expect(() =>
      budget.recordUsage({
        callId: "known-write-fails",
        provider: "anthropic",
        model: "claude-3-5-sonnet-20241022",
        usage: { input_tokens: 8, output_tokens: 2 },
      }),
    ).toThrow(persistenceError);
    expect(budget.status()).toMatchObject({
      tokens: 0,
      spentUsd: 0,
      pendingUsage: 1,
      aborted: true,
      reason: "persistence-failed",
    });
    budget.dispose();
  });

  it("actively aborts descendants when tokens cross the limit", () => {
    const { budget, clock } = makeBudget({ maxTokens: 10 });
    const child = new AbortController();
    const stopped = [];
    const work = budget.acquireWork({ id: "child", depth: 1 });
    budget.registerAbortable("child-controller", child);
    budget.registerAbortable("background-process", () => {
      stopped.push("tree-killed");
      work.release();
    });

    budget.recordUsage({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      usage: { input_tokens: 6, output_tokens: 4 },
    });

    expect(budget.signal.aborted).toBe(true);
    expect(budget.signal.reason).toBeInstanceOf(SessionBudgetError);
    expect(child.signal.aborted).toBe(true);
    expect(stopped).toEqual(["tree-killed"]);
    expect(budget.status()).toMatchObject({
      reason: "max-tokens",
      active: 0,
      resources: 0,
    });
    expect(clock.timers.size).toBe(0);
    expect(budget.abort("again")).toBe(false);
    budget.dispose();
  });

  it("fails closed on unpriced remote usage under a USD cap", () => {
    const { budget } = makeBudget({ maxUsd: 1 });
    budget.recordUsage({
      provider: "unknown-remote",
      model: "unknown-model",
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    expect(budget.status()).toMatchObject({
      aborted: true,
      reason: "unpriced-usage",
      unpricedUsage: true,
    });
    budget.dispose();
  });

  it("actively aborts at the wall deadline without another admission", () => {
    const { budget, clock } = makeBudget({ maxWallMs: 50 });
    const stopped = [];
    budget.registerAbortable("descendant", () => stopped.push(clock.now()));
    budget.start();

    clock.advance(49);
    expect(budget.signal.aborted).toBe(false);
    clock.advance(1);

    expect(budget.status()).toMatchObject({
      aborted: true,
      reason: "max-wall-ms",
      elapsedMs: 50,
    });
    expect(stopped).toEqual([50]);
    expect(clock.timers.size).toBe(0);
    budget.dispose();
  });

  it("uses aggregate concurrent tool time and cancels at its live deadline", () => {
    const { budget, clock } = makeBudget({ maxToolMs: 100 });
    const first = budget.beginTool({ id: "tool-a" });
    const second = budget.beginTool({ id: "tool-b" });
    expect(first.ok && second.ok).toBe(true);

    clock.advance(49);
    expect(budget.signal.aborted).toBe(false);
    expect(budget.status().toolMs).toBe(98);
    clock.advance(1);

    expect(budget.status()).toMatchObject({
      aborted: true,
      reason: "max-tool-ms",
      toolMs: 100,
      activeTools: 2,
    });
    first.end();
    second.end();
    expect(budget.status()).toMatchObject({ activeTools: 0, toolMs: 100 });
    budget.dispose();
  });

  it("prices known provider usage and aborts at the USD ceiling", () => {
    const { budget } = makeBudget({ maxUsd: 0.01 });
    budget.recordUsage({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    });
    expect(budget.status().spentUsd).toBeGreaterThan(0.01);
    expect(budget.reason()).toBe("max-usd");
    budget.dispose();
  });

  it("fails closed on malformed detailed usage even with an aggregate", () => {
    const { budget } = makeBudget({ maxUsd: 1 });

    expect(() =>
      budget.recordUsage({
        usage: { input_tokens: 2, output_tokens: 1 },
        usageRecords: [
          {
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
            usage: { input_tokens: 2, output_tokens: 1 },
          },
          {
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
            usage: { input_tokens: -1 },
          },
        ],
      }),
    ).toThrow(/invalid session budget usage: input_tokens/);
    expect(budget.status()).toMatchObject({
      aborted: true,
      reason: "invalid-usage",
      tokens: 0,
      spentUsd: 0,
    });
    budget.dispose();
  });

  it("rejects aggregate/detail mismatches without changing settled totals", () => {
    const { budget } = makeBudget({ maxUsd: 100 });
    budget.recordUsage({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      usage: { input_tokens: 2, output_tokens: 1 },
    });
    const totalsBefore = budget.snapshot().totals;
    const costBefore = {
      spentUsd: budget.cost.spentUsd,
      priced: budget.cost.priced,
      sawUnpriced: budget.cost.sawUnpriced,
      sawFree: budget.cost.sawFree,
    };

    expect(() =>
      budget.recordUsage({
        usage: { input_tokens: 4, output_tokens: 2 },
        usageRecords: [
          {
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
            usage: { input_tokens: 3, output_tokens: 2 },
          },
        ],
      }),
    ).toThrow(
      /session budget usage records do not match aggregate usage: input_tokens/,
    );
    expect(budget.status().reason).toBe("invalid-usage");
    expect(budget.snapshot().totals).toEqual(totalsBefore);
    expect({
      spentUsd: budget.cost.spentUsd,
      priced: budget.cost.priced,
      sawUnpriced: budget.cost.sawUnpriced,
      sawFree: budget.cost.sawFree,
    }).toEqual(costBefore);
    budget.dispose();
  });

  it("checks cache fields independently even when the grand total matches", () => {
    const { budget } = makeBudget({ maxUsd: 100 });

    expect(() =>
      budget.recordUsage({
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 4,
          cache_creation_input_tokens: 1,
        },
        usageRecords: [
          {
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_read_input_tokens: 1,
              cache_creation_input_tokens: 4,
            },
          },
        ],
      }),
    ).toThrow(/do not match aggregate usage: cache_read_input_tokens/);
    expect(budget.status()).toMatchObject({
      reason: "invalid-usage",
      tokens: 0,
      spentUsd: 0,
    });
    budget.dispose();
  });

  it("rejects unsafe detailed sums while accepting explicit zero totals", () => {
    const overflow = makeBudget({ maxUsd: 100 }).budget;
    expect(() =>
      overflow.recordUsage({
        usageRecords: [
          {
            usage: { input_tokens: Number.MAX_SAFE_INTEGER },
          },
          { usage: { input_tokens: 1 } },
        ],
      }),
    ).toThrow(/aggregate exceeds safe integer: input_tokens/);
    expect(overflow.status()).toMatchObject({
      reason: "invalid-usage",
      tokens: 0,
      spentUsd: 0,
    });
    overflow.dispose();

    const zero = makeBudget({ maxUsd: 100 }).budget;
    expect(
      zero.recordUsage({
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        usageRecords: [
          {
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
        ],
      }),
    ).toMatchObject({ aborted: false, tokens: 0, spentUsd: 0 });
    zero.dispose();
  });

  it("uses detailed totals when aggregate usage is absent", () => {
    const { budget } = makeBudget({ maxUsd: 100 });
    budget.recordUsage({
      usageRecords: [
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet-20241022",
          usage: {
            input_tokens: 2,
            output_tokens: 1,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
          },
        },
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet-20241022",
          usage: {
            input_tokens: 5,
            output_tokens: 6,
            cache_read_input_tokens: 7,
            cache_creation_input_tokens: 8,
          },
        },
      ],
    });

    expect(budget.status()).toMatchObject({
      aborted: false,
      tokens: 36,
      unpricedUsage: false,
    });
    expect(budget.cost.spentUsd).toBeGreaterThan(0);
    budget.dispose();
  });

  it("prices records whose aggregate usage matches every token field", () => {
    const { budget } = makeBudget({ maxUsd: 100 });
    budget.recordUsage({
      usage: {
        input_tokens: 7,
        output_tokens: 7,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 12,
      },
      usageRecords: [
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet-20241022",
          usage: {
            input_tokens: 2,
            output_tokens: 1,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
          },
        },
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet-20241022",
          usage: {
            input_tokens: 5,
            output_tokens: 6,
            cache_read_input_tokens: 7,
            cache_creation_input_tokens: 8,
          },
        },
      ],
    });

    expect(budget.status()).toMatchObject({
      aborted: false,
      tokens: 36,
      unpricedUsage: false,
    });
    expect(budget.cost.spentUsd).toBeGreaterThan(0);
    budget.dispose();
  });
});

describe("SessionResourceBudget snapshot and recovery", () => {
  it("restores clean totals and only permits tighter limits", () => {
    const originalClock = new ManualClock(100);
    const original = makeBudget(
      {
        maxConcurrent: 4,
        maxSpawns: 10,
        maxDepth: 5,
        maxTurns: 10,
        maxTokens: 1000,
        maxUsd: 10,
        maxWallMs: 1000,
        maxToolMs: 500,
      },
      originalClock,
    ).budget;
    original.consumeTurn({ id: "turn-1" });
    const work = original.acquireWork({ id: "child-1", depth: 1 });
    work.release();
    const tool = original.beginTool({ id: "read-1" });
    originalClock.advance(20);
    tool.end();
    original.recordUsage({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      usage: { input_tokens: 4, output_tokens: 6 },
    });
    originalClock.advance(30);
    const snapshot = original.snapshot();
    original.dispose();

    const resumedClock = new ManualClock(10_000);
    const resumed = SessionResourceBudget.restore(snapshot, {
      now: resumedClock.now,
      setTimer: resumedClock.setTimer,
      clearTimer: resumedClock.clearTimer,
      overrides: {
        maxConcurrent: 40,
        maxSpawns: 3,
        maxDepth: 2,
        maxTurns: 100,
        maxTokens: 100,
        maxUsd: 100,
        maxWallMs: 500,
        maxToolMs: 50,
      },
    });

    expect(resumed.snapshot().limits).toEqual({
      maxConcurrent: 4,
      maxSpawns: 3,
      maxDepth: 2,
      maxTurns: 10,
      maxTokens: 100,
      maxUsd: 10,
      maxWallMs: 500,
      maxToolMs: 50,
    });
    expect(resumed.status()).toMatchObject({
      spawns: 1,
      turns: 1,
      tokens: 10,
      elapsedMs: 50,
      toolMs: 20,
      recoveryRequired: false,
    });
    resumedClock.advance(449);
    expect(resumed.signal.aborted).toBe(false);
    resumedClock.advance(1);
    expect(resumed.reason()).toBe("max-wall-ms");
    resumed.dispose();
  });

  it("blocks a dirty restore until every in-flight id is adjudicated", () => {
    const sourceClock = new ManualClock(0);
    const source = makeBudget(
      { maxConcurrent: 2, maxSpawns: 4, maxToolMs: 1000 },
      sourceClock,
    ).budget;
    const workLease = source.acquireWork({
      id: "child-live",
      kind: "sub-agent",
      depth: 2,
    });
    const toolLease = source.beginTool({
      id: "tool-live",
      kind: "run_shell",
    });
    sourceClock.advance(25);
    const snapshot = source.snapshot();
    expect(Object.getOwnPropertySymbols(snapshot)).toEqual([]);
    expect(snapshot.inFlight.work[0].id).toBe(workLease.authorityId);
    expect(snapshot.inFlight.tools[0].id).toBe(toolLease.authorityId);
    expect(JSON.stringify(snapshot)).not.toContain("child-live");
    expect(JSON.stringify(snapshot)).not.toContain("tool-live");
    source.dispose();

    const resumedClock = new ManualClock(5000);
    const resumed = SessionResourceBudget.restore(snapshot, {
      now: resumedClock.now,
      setTimer: resumedClock.setTimer,
      clearTimer: resumedClock.clearTimer,
    });
    expect(resumed.status()).toMatchObject({
      active: 0,
      activeTools: 0,
      spawns: 1,
      toolMs: 25,
      recoveryRequired: true,
      pendingRecovery: 2,
      reason: "recovery-required",
    });
    expect(resumed.acquireWork({ id: "new", depth: 1 })).toMatchObject({
      ok: false,
      reason: "recovery-required",
    });
    expect(
      resumed.adjudicateRecovery({
        abandoned: ["tool-live", "child-live"],
      }),
    ).toMatchObject({
      ok: false,
      reason: "recovery-adjudication-incomplete",
    });
    expect(
      resumed.adjudicateRecovery({ abandoned: [workLease.authorityId] }),
    ).toMatchObject({
      ok: false,
      reason: "recovery-adjudication-incomplete",
    });
    expect(
      resumed.adjudicateRecovery({
        abandoned: [toolLease.authorityId, workLease.authorityId],
      }),
    ).toMatchObject({ ok: true });
    expect(resumed.acquireWork({ id: "new", depth: 1 })).toMatchObject({
      ok: true,
    });
    resumed.dispose();
  });

  it("restores an exhausted snapshot as permanently aborted", () => {
    const source = makeBudget({ maxTokens: 1 }).budget;
    source.recordUsage({ usage: { input_tokens: 1 } });
    const snapshot = source.snapshot();
    source.dispose();

    const resumed = SessionResourceBudget.restore(snapshot);
    expect(resumed.signal.aborted).toBe(true);
    expect(resumed.reason()).toBe("max-tokens");
    expect(resumed.consumeTurn()).toMatchObject({
      ok: false,
      reason: "max-tokens",
    });
    resumed.dispose();
  });

  it("rejects malformed snapshots instead of resetting totals", () => {
    const source = makeBudget({ maxTurns: 2 }).budget;
    const snapshot = source.snapshot();
    source.dispose();
    snapshot.totals.turns = -1;

    expect(() => SessionResourceBudget.restore(snapshot)).toThrow(
      /invalid session budget total: turns/,
    );
  });

  it("rejects business labels in normalized and restored in-flight state", () => {
    const source = makeBudget({ maxConcurrent: 2 }).budget;
    source.acquireWork({ id: "private-business-label", depth: 1 });
    const forged = source.snapshot();
    source.dispose();
    forged.inFlight.work[0].id = "secret-business-label";

    expect(() => normalizeSessionResourceBudgetSnapshot(forged)).toThrow(
      /invalid session budget in-flight entry: work/,
    );
    expect(() => SessionResourceBudget.restore(forged)).toThrow(
      /invalid session budget in-flight entry: work/,
    );
    expect(forged.inFlight.work[0].id).toBe("secret-business-label");
  });

  it("rejects a work authority id in tool recovery state", () => {
    const source = makeBudget({ maxConcurrent: 2 }).budget;
    source.acquireWork({ id: "work-live", depth: 1 });
    source.beginTool({ id: "tool-live" });
    const snapshot = source.snapshot();
    source.dispose();
    snapshot.inFlight.tools[0].id = snapshot.inFlight.work[0].id;

    expect(() => SessionResourceBudget.restore(snapshot)).toThrow(
      /invalid session budget in-flight entry: tools/,
    );
  });
});
