import { beforeEach, describe, expect, it, vi } from "vitest";

const { judgeChat } = vi.hoisted(() => ({ judgeChat: vi.fn() }));
vi.mock("../../src/runtime/agent-core.js", async (importOriginal) => ({
  ...(await importOriginal()),
  chatWithTools: judgeChat,
}));

import { runAgentHeadless } from "../helpers/test-model-egress.js";

function setup({ afterWork, mainUsage } = {}) {
  const out = [];
  const agentLoop = vi.fn(async function* (_messages, options) {
    options.iterationBudget.consume();
    yield {
      type: "tool-executing",
      tool: "read_file",
      tool_use_id: "inspect",
      args: { path: "result.txt" },
    };
    yield {
      type: "tool-result",
      tool: "read_file",
      tool_use_id: "inspect",
      result: { content: "verified artifact" },
    };
    yield {
      type: "token-usage",
      provider: "anthropic",
      model: "claude-opus",
      usage: mainUsage || { input_tokens: 7, output_tokens: 3 },
    };
    afterWork?.();
    yield { type: "response-complete", content: "finished" };
    yield { type: "run-ended", reason: "complete" };
  });
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    resolveAgentMcp: async () => null,
    writeOut: (s) => out.push(s),
    writeErr: () => {},
    agentLoop,
  };
  const run = (options = {}) =>
    runAgentHeadless(
      {
        prompt: "inspect the artifact",
        provider: "anthropic",
        model: "claude-opus",
        outputFormat: "stream-json",
        evolutionIngress: null,
        ephemeral: true,
        hermeticExecution: true,
        expandFileRefs: false,
        goalCondition: "model:the artifact is correct",
        maxOuterTurns: 3,
        ...options,
      },
      deps,
    );
  const events = () => out.join("").trim().split("\n").map(JSON.parse);
  return { run, events, deps, agentLoop };
}

function verdict(met = true, usage = { input_tokens: 100, output_tokens: 7 }) {
  return {
    message: {
      content: JSON.stringify({
        met,
        reason: "checked",
        evidenceIds: ["goal-tool-1"],
      }),
    },
    usage,
  };
}

beforeEach(() => {
  judgeChat.mockReset();
});

describe("headless Goal model calls share the run budget", () => {
  it("does not send a judge request after the last permitted model turn", async () => {
    const { run, events, agentLoop } = setup();
    judgeChat.mockResolvedValue(verdict());
    expect(await run({ maxTurns: 1 })).toMatchObject({
      isError: true,
      exitCode: 3,
    });
    expect(judgeChat).not.toHaveBeenCalled();
    expect(agentLoop).toHaveBeenCalledOnce();
    expect(events().at(-1)).toMatchObject({
      subtype: "error_max_turns",
      num_turns: 1,
    });
    expect(events().some((e) => e.type === "goal_completed")).toBe(false);
  });

  it("includes judge usage and cache cost in the result and completed Goal", async () => {
    const { run, events } = setup();
    judgeChat.mockResolvedValue(
      verdict(true, {
        input_tokens: 100,
        output_tokens: 7,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 30,
      }),
    );
    expect(
      await run({ maxTurns: 2, maxOutputTokens: 128, serviceTier: "standard" }),
    ).toMatchObject({ isError: false, exitCode: 0 });
    const result = events().at(-1);
    expect(result).toMatchObject({
      num_turns: 2,
      usage: {
        input_tokens: 107,
        output_tokens: 10,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 30,
      },
    });
    expect(result.total_cost_usd).toBeGreaterThan(0.0005);
    expect(events().find((e) => e.type === "goal_completed")).toMatchObject({
      tokens: 167,
      costUsd: result.total_cost_usd,
    });
    expect(judgeChat.mock.calls[0][1]).toMatchObject({
      enabledToolNames: [],
      maxOutputTokens: 128,
      serviceTier: "standard",
    });
    expect(events().filter((e) => e.type === "token_usage")).toHaveLength(2);
  });

  it("does not re-drive work after an unmet judge uses the remaining turn", async () => {
    const { run, agentLoop, events } = setup();
    judgeChat.mockResolvedValue(verdict(false));
    expect(await run({ maxTurns: 2 })).toMatchObject({
      isError: true,
      exitCode: 3,
    });
    expect(agentLoop).toHaveBeenCalledOnce();
    expect(judgeChat).toHaveBeenCalledOnce();
    expect(events().at(-1)).toMatchObject({ num_turns: 2 });
  });

  it.each([undefined, {}, { input_tokens: -1, output_tokens: 7 }])(
    "stops on unknown judge usage without accepting its verdict or re-driving (%j)",
    async (usage) => {
      const { run, agentLoop, events } = setup();
      judgeChat.mockResolvedValue({ ...verdict(), usage });
      expect(await run({ maxTurns: 4 })).toMatchObject({ isError: true });
      expect(agentLoop).toHaveBeenCalledOnce();
      expect(judgeChat).toHaveBeenCalledOnce();
      expect(events().some((e) => e.type === "goal_completed")).toBe(false);
      expect(events().at(-1)).toMatchObject({
        subtype: "error_goal_usage_unknown",
      });
    },
  );

  it("does not retry a judge transport failure through another outer turn", async () => {
    const { run, agentLoop } = setup();
    judgeChat.mockRejectedValue(
      Object.assign(new Error("private provider message"), {
        code: "ECONNRESET",
      }),
    );
    const result = await run({ maxTurns: 4 });
    expect(result.isError).toBe(true);
    expect(result.result).not.toContain("private provider message");
    expect(agentLoop).toHaveBeenCalledOnce();
    expect(judgeChat).toHaveBeenCalledOnce();
  });

  it("does not call the judge when cancellation arrives after the main work", async () => {
    const controller = new AbortController();
    const { run, agentLoop } = setup({ afterWork: () => controller.abort() });
    judgeChat.mockResolvedValue(verdict());
    expect(await run({ signal: controller.signal })).toMatchObject({
      isError: true,
    });
    expect(judgeChat).not.toHaveBeenCalled();
    expect(agentLoop).toHaveBeenCalledOnce();
  });

  it("forwards cancellation and retains usage returned after cancel without completing", async () => {
    const controller = new AbortController();
    const { run, events, agentLoop } = setup();
    judgeChat.mockImplementation(async (_messages, options) => {
      expect(options.signal?.aborted).toBe(false);
      controller.abort();
      expect(options.signal?.aborted).toBe(true);
      return verdict();
    });
    expect(await run({ signal: controller.signal })).toMatchObject({
      isError: true,
    });
    expect(agentLoop).toHaveBeenCalledOnce();
    expect(events().some((e) => e.type === "goal_completed")).toBe(false);
    expect(events().at(-1)).toMatchObject({
      usage: { input_tokens: 107, output_tokens: 10 },
    });
  });

  it("stops at the cost cap reached by the judge and reports the charge", async () => {
    const { run, events, agentLoop } = setup();
    judgeChat.mockResolvedValue(
      verdict(true, { input_tokens: 1_000_000, output_tokens: 0 }),
    );
    expect(await run({ maxCostUsd: 0.1 })).toMatchObject({
      isError: true,
      exitCode: 4,
    });
    expect(events().at(-1)).toMatchObject({
      subtype: "error_max_budget",
      usage: { input_tokens: 1_000_007 },
    });
    expect(events().at(-1).total_cost_usd).toBeGreaterThanOrEqual(5);
    expect(events().some((e) => e.type === "goal_completed")).toBe(false);
    expect(agentLoop).toHaveBeenCalledOnce();
  });

  it("skips the judge once the Goal token budget is already spent", async () => {
    const { run } = setup();
    judgeChat.mockResolvedValue(verdict());
    expect(await run({ goalMaxTokens: 10 })).toMatchObject({ isError: true });
    expect(judgeChat).not.toHaveBeenCalled();
  });

  it.each(["turns", "unknown", "cost", "success"])(
    "applies the same budget and usage contract to --goal-assess (%s)",
    async (scenario) => {
      const { run, events, deps } = setup();
      const goal = {
        id: "budget-test-goal",
        objective: "finish",
        keyResults: [],
      };
      deps.resolveActiveGoal = () => goal;
      deps.getGoal = () => goal;
      // Invalid assessment JSON avoids applying a progress update to a real goal;
      // the production assessor must still enforce the model call contract.
      judgeChat.mockResolvedValue({
        message: { content: "no assessment" },
        usage:
          scenario === "unknown"
            ? undefined
            : {
                input_tokens: scenario === "cost" ? 1_000_000 : 100,
                output_tokens: 7,
              },
      });
      const result = await run({
        goalCondition: undefined,
        goal: goal.id,
        goalAssess: true,
        maxTurns: scenario === "turns" ? 1 : 2,
        ...(scenario === "cost" ? { maxCostUsd: 0.1 } : {}),
      });
      expect(result.isError).toBe(scenario !== "success");
      expect(judgeChat).toHaveBeenCalledTimes(scenario === "turns" ? 0 : 1);
      expect(events().at(-1).num_turns).toBe(scenario === "turns" ? 1 : 2);
      if (scenario === "success") {
        expect(events().at(-1).usage).toMatchObject({
          input_tokens: 107,
          output_tokens: 10,
        });
        expect(judgeChat.mock.calls[0][1].maxOutputTokens).toBe(2048);
      }
    },
  );
});
