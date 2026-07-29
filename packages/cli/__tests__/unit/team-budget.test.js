import { describe, it, expect } from "vitest";
import { TeamBudget } from "../../src/lib/agent-team/team-budget.js";

const usage = (i, o) => ({ input_tokens: i, output_tokens: o });

describe("TeamBudget dimensions", () => {
  it("an all-null budget is disabled and never stops", () => {
    const b = new TeamBudget();
    expect(b.enabled()).toBe(false);
    for (let i = 0; i < 100; i++) b.record({ usage: usage(1000, 1000) });
    expect(b.shouldStop()).toBe(false);
    expect(b.reason()).toBe(null);
  });

  it("stops at the task-count cap (reached BEFORE the next task)", () => {
    const b = new TeamBudget({ maxTasks: 3 });
    expect(b.shouldStop()).toBe(false);
    b.record({});
    b.record({});
    expect(b.shouldStop()).toBe(false); // 2 < 3
    b.record({});
    expect(b.shouldStop()).toBe(true); // 3 >= 3
    expect(b.reason()).toBe("max-tasks");
  });

  it("stops at the token cap, summing input+output across tasks", () => {
    const b = new TeamBudget({ maxTokens: 5000 });
    b.record({ usage: usage(1000, 1000) }); // 2000
    b.record({ usage: usage(1000, 1000) }); // 4000
    expect(b.shouldStop()).toBe(false);
    b.record({ usage: usage(500, 600) }); // 5100 ≥ 5000
    expect(b.reason()).toBe("max-tokens");
  });

  it("counts cache read/write tokens against the token cap", () => {
    const b = new TeamBudget({ maxTokens: 10 });
    b.record({
      usage: {
        input_tokens: 2,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 3,
      },
    });

    expect(b.status().tokens).toBe(10);
    expect(b.reason()).toBe("max-tokens");
  });

  it("stops at the USD cap via the composed CostBudget", () => {
    // A known-priced Anthropic model so the cost is non-zero and deterministic.
    const b = new TeamBudget({ maxUsd: 0.01 });
    // 1M input tokens on a real model far exceeds $0.01.
    b.record({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      usage: usage(1_000_000, 0),
    });
    expect(b.reason()).toBe("max-usd");
    expect(b.status().spentUsd).toBeGreaterThan(0.01);
  });

  it("stops at the wall-clock cap using the injected clock", () => {
    let t = 1000;
    const b = new TeamBudget({ maxWallMs: 500, now: () => t });
    b.record({}); // starts the window at t=1000
    expect(b.shouldStop()).toBe(false);
    t = 1400; // 400ms elapsed
    expect(b.shouldStop()).toBe(false);
    t = 1500; // 500ms elapsed ≥ cap
    expect(b.reason()).toBe("max-wall-ms");
  });

  it("does not poison the USD cap when a task cost is malformed", () => {
    const b = new TeamBudget({ maxUsd: 1 });
    // Unpriced provider → $0, cap can't bite; spend stays a finite 0.
    b.record({ provider: "ollama", model: "llama3", usage: usage(9e9, 9e9) });
    expect(b.status().spentUsd).toBe(0);
    expect(b.shouldStop()).toBe(false);
  });

  it("fails closed when a USD-capped remote usage record cannot be priced", () => {
    const b = new TeamBudget({ maxUsd: 1 });
    b.record({
      provider: "unknown-remote",
      model: "unpriced-model",
      usage: usage(100, 20),
    });

    expect(b.reason()).toBe("unpriced-usage");
    expect(b.status()).toMatchObject({
      unpricedUsage: true,
      spentUsd: 0,
    });
    const restored = TeamBudget.restore(b.snapshot());
    expect(restored.reason()).toBe("unpriced-usage");
  });

  it("atomically reserves fair token slices for concurrent tasks", () => {
    const b = new TeamBudget({ maxTokens: 100 });
    const first = b.reserve("lease-a", { slots: 4 });
    const second = b.reserve("lease-b", { slots: 3 });
    const third = b.reserve("lease-c", {
      slots: 2,
      maxTokens: 10,
    });

    expect(first).toMatchObject({ ok: true, maxTokens: 25 });
    expect(second).toMatchObject({ ok: true, maxTokens: 25 });
    expect(third).toMatchObject({ ok: true, maxTokens: 10 });
    expect(b.status()).toMatchObject({
      reservedTokens: 60,
      reservations: 3,
    });
    expect(b.releaseReservation("lease-b")).toBe(true);
    expect(b.status()).toMatchObject({
      reservedTokens: 35,
      reservations: 2,
    });
  });

  it("never reserves more USD than the unsettled team remainder", () => {
    const b = new TeamBudget({ maxUsd: 0.08 });
    const reservations = Array.from({ length: 8 }, (_, index) =>
      b.reserve(`usd-${index}`, { slots: 8 - index }),
    );

    expect(reservations.every((reservation) => reservation.ok)).toBe(true);
    expect(
      reservations.reduce(
        (total, reservation) => total + reservation.maxUsd,
        0,
      ),
    ).toBeCloseTo(0.08, 10);
    expect(b.status().reservedUsd).toBeCloseTo(0.08, 10);
    expect(b.reserve("blocked", { slots: 1 })).toMatchObject({
      ok: false,
      reason: "max-usd",
      temporary: true,
    });
  });

  it("prices each actual provider/model record without double counting tokens", () => {
    const b = new TeamBudget({ maxUsd: 100 });
    b.record({
      usage: usage(30, 10),
      usageRecords: [
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet-20241022",
          usage: usage(20, 5),
        },
        {
          provider: "openai",
          model: "gpt-4o",
          usage: usage(10, 5),
        },
      ],
    });

    expect(b.tokens).toBe(40);
    expect(b.cost.spentUsd).toBeGreaterThan(0);
  });
});

describe("TeamBudget snapshot/restore (resume consistency)", () => {
  it("carries settled totals and active wall time without charging downtime", () => {
    let t = 1000;
    const b = new TeamBudget({
      maxTasks: 10,
      maxTokens: 100000,
      maxUsd: 100,
      maxWallMs: 5000,
      now: () => t,
    });
    b.record({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      usage: usage(1000, 500),
    });
    b.record({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      usage: usage(200, 100),
    });
    t = 1300;
    const snap = b.snapshot();
    expect(snap.totals.tasks).toBe(2);
    expect(snap.totals.tokens).toBe(1800);
    expect(snap.totals.spentUsd).toBeGreaterThan(0);
    expect(snap.totals.elapsedMs).toBe(300);

    let t2 = 9999; // resumed much later — time window must NOT count the gap
    const r = TeamBudget.restore(snap, { now: () => t2 });
    expect(r.tasks).toBe(2);
    expect(r.tokens).toBe(1800);
    expect(r.cost.spentUsd).toBe(snap.totals.spentUsd);
    expect(r.status().elapsedMs).toBe(300);
    expect(r.shouldStop()).toBe(false);
    t2 = 9999 + 4699;
    expect(r.shouldStop()).toBe(false);
    t2 = 9999 + 4700;
    expect(r.reason()).toBe("max-wall-ms");
  });

  it("never raises persisted caps through lower-level restore overrides", () => {
    const original = new TeamBudget({
      maxTasks: 2,
      maxTokens: 100,
      maxUsd: 1,
      maxWallMs: 1000,
    });
    const restored = TeamBudget.restore(original.snapshot(), {
      overrides: {
        maxTasks: 20,
        maxTokens: 1000,
        maxUsd: 10,
        maxWallMs: 10000,
      },
    });

    expect(restored.snapshot().limits).toEqual({
      maxTasks: 2,
      maxTokens: 100,
      maxUsd: 1,
      maxWallMs: 1000,
    });
  });
});
