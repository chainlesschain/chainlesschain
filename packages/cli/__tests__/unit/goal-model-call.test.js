import { describe, expect, it, vi } from "vitest";
import { runGoalModelCall } from "../../src/lib/goal-model-call.js";
import { IterationBudget } from "../../src/lib/iteration-budget.js";
import { CostBudget } from "../../src/lib/cost-budget.js";
import { SessionResourceBudget } from "../../src/lib/session-resource-budget.js";

function inputs(overrides = {}) {
  return {
    sessionId: "goal-session",
    persist: vi.fn(),
    iterationBudget: new IterationBudget({ limit: 2 }),
    costBudget: new CostBudget(),
    operationId: "goal-condition",
    chatOptions: { provider: "openai", model: "test-model" },
    prompt: "check the artifact",
    chat: vi.fn(async () => ({
      message: { content: "verdict" },
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    })),
    onUsage: vi.fn(),
    ...overrides,
  };
}

describe("Goal model request settlement", () => {
  it("reserves the shared turn before durable work and accounts only after persistence", async () => {
    const order = [];
    const budget = new SessionResourceBudget({ maxTurns: 2 });
    const args = inputs({ sessionBudget: budget });
    args.persist.mockImplementation(async (type) => {
      expect(args.iterationBudget.consumed).toBe(1);
      order.push(type);
    });
    args.chat.mockImplementation(async () => {
      order.push("chat");
      return { usage: { prompt_tokens: 3, completion_tokens: 2 } };
    });
    args.onUsage.mockImplementation(() => order.push("account"));
    try {
      await runGoalModelCall(args);
      expect(order).toEqual([
        "model_usage_started",
        "chat",
        "token_usage",
        "account",
      ]);
      expect(args.persist.mock.calls[1][1]).toMatchObject({
        operationId: "goal-condition",
        usage: { input_tokens: 3, output_tokens: 2 },
      });
      expect(budget.status().turns).toBe(1);
      expect(args.onUsage).toHaveBeenCalledOnce();
      expect(args.chat.mock.calls[0][1]).toMatchObject({
        enabledToolNames: [],
        maxOutputTokens: 2048,
      });
    } finally {
      budget.dispose();
    }
  });

  it("does not dispatch when the started record cannot be saved", async () => {
    const args = inputs();
    args.persist.mockRejectedValue(new Error("disk full"));
    await expect(runGoalModelCall(args)).rejects.toMatchObject({
      runtimeLedgerPersistence: true,
    });
    expect(args.chat).not.toHaveBeenCalled();
    expect(args.onUsage).not.toHaveBeenCalled();
  });

  it("does not expose successful settlement when its durable write fails", async () => {
    const args = inputs();
    args.persist.mockImplementation(async (type) => {
      if (type === "token_usage") throw new Error("disk full");
    });
    await expect(runGoalModelCall(args)).rejects.toMatchObject({
      runtimeLedgerPersistence: true,
    });
    expect(args.chat).toHaveBeenCalledOnce();
    expect(args.onUsage).not.toHaveBeenCalled();
  });

  it("closes a cancelled durable intent as not dispatched without a provider call", async () => {
    const controller = new AbortController();
    const args = inputs({ signal: controller.signal });
    args.persist.mockImplementation(async (type) => {
      if (type === "model_usage_started") controller.abort();
    });
    await expect(runGoalModelCall(args)).rejects.toMatchObject({
      goalModelFailure: true,
      endReason: "cancelled",
    });
    expect(args.chat).not.toHaveBeenCalled();
    expect(args.onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        settlementOrigin: "local-no-dispatch",
        usage: expect.objectContaining({ input_tokens: 0, output_tokens: 0 }),
      }),
    );
  });

  it("records unknown usage and rejects a transport error without disclosing provider text", async () => {
    const args = inputs();
    args.chat.mockRejectedValue(new Error("private provider response"));
    await expect(runGoalModelCall(args)).rejects.toMatchObject({
      goalModelFailure: true,
      endReason: "usage-unknown",
      message:
        "Goal model usage is unknown; reconcile the request before continuing",
    });
    expect(args.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
      "model_usage_unknown",
    ]);
    expect(args.onUsage).not.toHaveBeenCalled();
  });

  it("validates ephemeral usage without writing any session files", async () => {
    const args = inputs({ sessionId: null, persist: null });
    await runGoalModelCall(args);
    expect(args.onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({ input_tokens: 3, output_tokens: 2 }),
      }),
    );
  });

  it("does not reserve turns or dispatch when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const args = inputs({ signal: controller.signal });
    await expect(runGoalModelCall(args)).rejects.toMatchObject({
      endReason: "cancelled",
    });
    expect(args.iterationBudget.consumed).toBe(0);
    expect(args.persist).not.toHaveBeenCalled();
    expect(args.chat).not.toHaveBeenCalled();
  });
});
