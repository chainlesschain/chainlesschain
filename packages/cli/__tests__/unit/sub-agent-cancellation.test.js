/**
 * Sub-agent completion-path correctness: when the run loop force-completes
 * (abort signal / token budget exceeded), the post-loop summary path must NOT
 * overwrite the cancellation marker with a normal completion — otherwise the
 * parent agent mistakes a truncated/cancelled run for a clean one.
 *
 * agentLoop is mocked here (isolated file scope) so we can drive the loop
 * deterministically; the rest of sub-agent-context (context engine, worktree
 * gating) runs for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/agent-core.js", () => ({
  buildSystemPrompt: () => "SYSTEM",
  AGENT_TOOLS: [],
  agentLoop: vi.fn(),
}));

import { SubAgentContext } from "../../src/lib/sub-agent-context.js";
import { agentLoop } from "../../src/lib/agent-core.js";

function makeLoop(events) {
  return async function* () {
    for (const e of events) yield e;
  };
}

describe("sub-agent _runCore force-complete preservation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves the cancelled result when the abort signal fires mid-loop", async () => {
    agentLoop.mockImplementation(
      makeLoop([{ type: "response-complete", content: "partial work so far" }]),
    );
    const ctx = SubAgentContext.create({
      role: "t",
      task: "task",
      useWorktree: false,
      signal: { aborted: true },
    });
    const result = await ctx.run("go");
    expect(ctx.status).toBe("completed");
    // The cancellation marker must survive (was overwritten by the plain
    // summary "partial work so far" before the fix).
    expect(result.summary).toMatch(/cancelled/i);
    expect(result.summary).not.toBe("partial work so far");
  });

  it("preserves the token-budget-exceeded result", async () => {
    agentLoop.mockImplementation(
      makeLoop([
        // ~8000-char tool result → ~2000 estimated tokens, far over the budget.
        { type: "tool-result", tool: "x", result: { data: "y".repeat(8000) } },
      ]),
    );
    const ctx = SubAgentContext.create({
      role: "t",
      task: "task",
      useWorktree: false,
      tokenBudget: 100,
    });
    const result = await ctx.run("go");
    expect(ctx.status).toBe("completed");
    expect(result.summary).toMatch(/token-budget/i);
  });

  it("returns partial work to the parent when the loop throws mid-run", async () => {
    const bigToolOutput = { data: "z".repeat(3000) }; // >2000 chars → artifact
    agentLoop.mockImplementation(async function* () {
      yield { type: "tool-result", tool: "x", result: bigToolOutput };
      yield { type: "response-complete", content: "partial findings so far" };
      throw new Error("429 rate limited");
    });
    const ctx = SubAgentContext.create({
      role: "t",
      task: "task",
      useWorktree: false,
    });
    const result = await ctx.run("go");
    expect(ctx.status).toBe("failed");
    expect(result.summary).toContain("Sub-agent failed: 429 rate limited");
    // Partial output produced before the failure must reach the parent
    // (was discarded — summary carried only the error, artifacts were []).
    expect(result.summary).toContain("partial findings so far");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].tool).toBe("x");
  });

  it("keeps the error-only summary when the loop throws with no output yet", async () => {
    agentLoop.mockImplementation(async function* () {
      throw new Error("boom");
    });
    const ctx = SubAgentContext.create({
      role: "t",
      task: "task",
      useWorktree: false,
    });
    const result = await ctx.run("go");
    expect(result.summary).toBe("Sub-agent failed: boom");
    expect(result.artifacts).toHaveLength(0);
  });

  it("token-budget cutoff hands over partial content and artifacts", async () => {
    agentLoop.mockImplementation(
      makeLoop([
        { type: "response-complete", content: "work before budget cutoff" },
        // ~8000-char tool result → ~2000 estimated tokens, far over the budget.
        { type: "tool-result", tool: "x", result: { data: "y".repeat(8000) } },
      ]),
    );
    const ctx = SubAgentContext.create({
      role: "t",
      task: "task",
      useWorktree: false,
      tokenBudget: 100,
    });
    const result = await ctx.run("go");
    expect(result.summary).toMatch(/token-budget/i);
    expect(result.summary).toContain("work before budget cutoff");
    expect(result.artifacts).toHaveLength(1);
  });

  it("normal completion still summarizes the streamed content", async () => {
    agentLoop.mockImplementation(
      makeLoop([{ type: "response-complete", content: "the final answer" }]),
    );
    const ctx = SubAgentContext.create({
      role: "t",
      task: "task",
      useWorktree: false,
    });
    const result = await ctx.run("go");
    expect(ctx.status).toBe("completed");
    expect(result.summary).toBe("the final answer"); // not a cancellation marker
  });
});
