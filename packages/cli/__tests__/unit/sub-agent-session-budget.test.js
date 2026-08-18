import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/agent-core.js", () => ({
  buildSystemPrompt: () => "SYSTEM",
  AGENT_TOOLS: [],
  agentLoop: vi.fn(),
}));

import { agentLoop } from "../../src/lib/agent-core.js";
import { SessionResourceBudget } from "../../src/lib/session-resource-budget.js";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";

describe("SubAgentContext session-wide budget integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("holds one shared concurrency lease and forwards the budget signal", async () => {
    let observedOptions;
    agentLoop.mockImplementation(async function* (_messages, options) {
      observedOptions = options;
      yield { type: "response-complete", content: "done" };
    });
    const budget = new SessionResourceBudget({
      maxConcurrent: 1,
      maxSpawns: 2,
      maxDepth: 2,
    });
    const context = SubAgentContext.create({
      role: "worker",
      task: "work",
      depth: 2,
      useWorktree: false,
      sessionBudget: budget,
    });

    const result = await context.run("go");

    expect(result.summary).toBe("done");
    expect(observedOptions.sessionBudget).toBe(budget);
    expect(observedOptions.signal).toBeInstanceOf(AbortSignal);
    expect(budget.status()).toMatchObject({
      spawns: 1,
      active: 0,
      resources: 0,
      aborted: false,
    });
    budget.dispose();
  });

  it("rejects excessive depth before entering the child loop", async () => {
    const budget = new SessionResourceBudget({ maxDepth: 1 });
    const context = SubAgentContext.create({
      role: "worker",
      task: "work",
      depth: 2,
      useWorktree: false,
      sessionBudget: budget,
    });

    const result = await context.run("go");

    expect(result).toMatchObject({
      budgetReason: "max-depth",
      summary: "Sub-agent blocked by session budget: max-depth",
    });
    expect(context.status).toBe("failed");
    expect(agentLoop).not.toHaveBeenCalled();
    expect(budget.status()).toMatchObject({ spawns: 0, active: 0 });
    budget.dispose();
  });

  it("interrupts a blocked child immediately and leaves no live lease", async () => {
    let started;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    agentLoop.mockImplementation(async function* (_messages, options) {
      started(options);
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          const error = new Error("provider call aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener("abort", onAbort, { once: true });
      });
      yield { type: "unreachable-after-abort" };
    });
    const budget = new SessionResourceBudget({ maxTokens: 5 });
    const context = SubAgentContext.create({
      role: "worker",
      task: "work",
      useWorktree: false,
      sessionBudget: budget,
    });

    const running = context.run("go");
    const options = await entered;
    expect(options.signal.aborted).toBe(false);
    expect(budget.status()).toMatchObject({ active: 1, resources: 1 });

    budget.recordUsage({ usage: { input_tokens: 5 } });
    const result = await running;

    expect(options.signal.aborted).toBe(true);
    expect(result.summary).toMatch(/force-completed: max-tokens/i);
    expect(context.status).toBe("completed");
    expect(budget.status()).toMatchObject({
      reason: "max-tokens",
      active: 0,
      resources: 0,
      aborted: true,
    });
    budget.dispose();
  });

  it("charges direct child usage once and skips attributed replay", async () => {
    agentLoop.mockImplementation(async function* () {
      yield {
        type: "token-usage",
        provider: "anthropic",
        model: "claude-3-5-sonnet-20241022",
        usage: { input_tokens: 2 },
      };
      yield {
        type: "token-usage",
        provider: "anthropic",
        model: "claude-3-5-sonnet-20241022",
        usage: { input_tokens: 2 },
        attribution: { origin: "subagent", subagentId: "nested" },
      };
      yield { type: "response-complete", content: "done" };
    });
    const budget = new SessionResourceBudget({ maxTokens: 3 });
    const context = SubAgentContext.create({
      role: "worker",
      task: "work",
      useWorktree: false,
      sessionBudget: budget,
    });

    const result = await context.run("go");

    expect(result.summary).toBe("done");
    expect(budget.status()).toMatchObject({
      tokens: 2,
      aborted: false,
      active: 0,
      resources: 0,
    });
    budget.dispose();
  });

  it("keeps unknown child provider usage in recovery instead of charging zero", async () => {
    agentLoop.mockImplementation(async function* () {
      yield {
        type: "model-usage-started",
        callId: "child-unknown-call",
        provider: "openai",
        model: "gpt-test",
        source: "model",
      };
      yield {
        type: "model-usage-unknown",
        callId: "child-unknown-call",
        provider: "openai",
        model: "gpt-test",
        source: "model",
        code: "provider_usage_missing",
      };
      yield { type: "response-complete", content: "must not succeed" };
    });
    const budget = new SessionResourceBudget({ maxTokens: 100 });
    const context = SubAgentContext.create({
      role: "worker",
      task: "work",
      useWorktree: false,
      sessionBudget: budget,
    });

    const result = await context.run("go");

    expect(result.summary).toMatch(/force-completed: recovery-required/i);
    expect(budget.status()).toMatchObject({
      tokens: 0,
      pendingUsage: 0,
      pendingRecovery: 1,
      recoveryRequired: true,
      reason: "recovery-required",
      active: 0,
      resources: 0,
    });
    budget.dispose();
  });
});
