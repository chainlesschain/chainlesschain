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
});

describe("TeamBudget snapshot/restore (resume consistency)", () => {
  it("carries task/token/USD totals across a resume, restarting the time window", () => {
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
    b.record({ usage: usage(200, 100) });
    const snap = b.snapshot();
    expect(snap.totals.tasks).toBe(2);
    expect(snap.totals.tokens).toBe(1800);
    expect(snap.totals.spentUsd).toBeGreaterThan(0);

    let t2 = 9999; // resumed much later — time window must NOT count the gap
    const r = TeamBudget.restore(snap, { now: () => t2 });
    expect(r.tasks).toBe(2);
    expect(r.tokens).toBe(1800);
    expect(r.cost.spentUsd).toBe(snap.totals.spentUsd);
    // Wall-clock restarts on the next task, not from the pre-crash start.
    expect(r.shouldStop()).toBe(false);
    r.record({}); // starts a fresh window at t2
    t2 = 9999 + 4999;
    expect(r.shouldStop()).toBe(false);
    t2 = 9999 + 5000;
    expect(r.reason()).toBe("max-wall-ms");
  });
});
