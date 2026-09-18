import { describe, expect, it } from "vitest";

import { executePmExplorationBudgetedOperation } from "../../src/lib/evolution/pm-exploration-budget-executor.js";

const LIMITS = Object.freeze({
  maxTokens: 10,
  maxToolCalls: 2,
  maxWallClockMs: 1000,
});

describe("PM exploration budget executor", () => {
  it("accounts model tokens and brokers allow-listed tools", async () => {
    const calls = [];
    const outcome = await executePmExplorationBudgetedOperation({
      limits: LIMITS,
      allowedToolIds: ["project:get"],
      invokeTool: async ({ toolId, input, signal }) => {
        calls.push({ toolId, input, aborted: signal.aborted });
        return { projectId: input.projectId, status: "active" };
      },
      operation: async (runtime) => {
        runtime.recordTokens(4);
        return runtime.invokeTool("project:get", { projectId: "project-one" });
      },
    });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.metrics.tokens).toBe(4);
    expect(outcome.metrics.toolCalls).toBe(1);
    expect(outcome.value).toEqual({
      projectId: "project-one",
      status: "active",
    });
    expect(calls).toEqual([
      {
        toolId: "project:get",
        input: { projectId: "project-one" },
        aborted: false,
      },
    ]);
  });

  it("actively aborts token and tool-policy violations", async () => {
    const tokens = await executePmExplorationBudgetedOperation({
      limits: { ...LIMITS, maxTokens: 2 },
      operation: async (runtime) => {
        runtime.recordTokens(3);
        return "unreachable";
      },
    });
    expect(tokens).toMatchObject({
      status: "aborted",
      failureClass: "budget",
      reason: "max-tokens",
      metrics: { tokens: 3, toolCalls: 0 },
    });

    let brokerCalls = 0;
    const tool = await executePmExplorationBudgetedOperation({
      limits: LIMITS,
      allowedToolIds: ["project:get"],
      invokeTool: async () => {
        brokerCalls += 1;
        return {};
      },
      operation: async (runtime) =>
        runtime.invokeTool("project:delete", { projectId: "project-one" }),
    });
    expect(tool.status).toBe("aborted");
    expect(tool.reason).toBe("tool-not-allowed");
    expect(brokerCalls).toBe(0);
  });

  it("returns on the wall-clock deadline even when an operation ignores abort", async () => {
    const outcome = await executePmExplorationBudgetedOperation({
      limits: { ...LIMITS, maxWallClockMs: 5 },
      operation: () => new Promise(() => {}),
    });
    expect(outcome.status).toBe("aborted");
    expect(outcome.failureClass).toBe("budget");
    expect(outcome.reason).toBe("max-wall-clock-ms");
    expect(outcome.metrics.wallClockMs).toBeGreaterThanOrEqual(1);
  });

  it("does not admit an operation when no wall-clock budget remains", async () => {
    let invoked = false;
    const outcome = await executePmExplorationBudgetedOperation({
      limits: { ...LIMITS, maxWallClockMs: 0 },
      operation: async () => {
        invoked = true;
        return null;
      },
    });
    expect(invoked).toBe(false);
    expect(outcome).toMatchObject({
      status: "aborted",
      failureClass: "budget",
      reason: "max-wall-clock-ms",
    });
  });

  it("propagates parent cancellation and closes the runtime capability", async () => {
    const parent = new AbortController();
    let runtimePort;
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const completed = executePmExplorationBudgetedOperation({
      limits: LIMITS,
      parentSignal: parent.signal,
      operation: async (runtime) => {
        runtimePort = runtime;
        markStarted();
        await new Promise((resolve) =>
          runtime.signal.addEventListener("abort", resolve, { once: true }),
        );
        return null;
      },
    });
    await started;
    parent.abort(new Error("stop"));
    const outcome = await completed;
    expect(outcome.status).toBe("aborted");
    expect(outcome.reason).toBe("parent-aborted");
    expect(() => runtimePort.recordTokens(1)).toThrow(/closed/);
  });
});
