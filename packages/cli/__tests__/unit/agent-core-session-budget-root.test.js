import { describe, expect, it, vi } from "vitest";
import { SessionResourceBudget } from "../../src/lib/session-resource-budget.js";
import { agentLoop, executeTool } from "../../src/runtime/agent-core.js";

async function drain(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("agent-core session budget root", () => {
  it("charges each loop turn and blocks the next provider call at the shared cap", async () => {
    const sessionBudget = new SessionResourceBudget({ maxTurns: 1 });
    const firstChat = vi.fn(async () => ({
      message: { role: "assistant", content: "done" },
      usage: { input_tokens: 2, output_tokens: 1 },
    }));

    const events = await drain(
      agentLoop([{ role: "user", content: "go" }], {
        chatFn: firstChat,
        autoCompact: false,
        runnableProviderFallback: false,
        sessionBudget,
      }),
    );

    expect(firstChat).toHaveBeenCalledOnce();
    expect(events.some((event) => event.type === "response-complete")).toBe(
      true,
    );
    expect(sessionBudget.status()).toMatchObject({ turns: 1, maxTurns: 1 });

    const blockedChat = vi.fn();
    await expect(
      drain(
        agentLoop([{ role: "user", content: "again" }], {
          chatFn: blockedChat,
          autoCompact: false,
          runnableProviderFallback: false,
          sessionBudget,
        }),
      ),
    ).rejects.toMatchObject({
      code: "CC_SESSION_BUDGET_EXHAUSTED",
      budgetReason: "max-turns",
    });
    expect(blockedChat).not.toHaveBeenCalled();
  });

  it("wraps admitted tool effects and fails closed before a denied effect", async () => {
    const end = vi.fn();
    const admittedBudget = {
      beginTool: vi.fn(() => ({ ok: true, end })),
    };
    const admitted = await executeTool(
      "read_file",
      { path: "missing-session-budget-fixture.txt" },
      {
        sessionId: "budget-session",
        turnId: "turn-1",
        toolCallId: "call-1",
        sessionBudget: admittedBudget,
      },
    );

    expect(admitted.error).toContain("File not found");
    expect(admittedBudget.beginTool).toHaveBeenCalledWith({
      id: expect.stringMatching(/^tool:[a-f0-9]{48}$/),
      kind: "read_file",
    });
    expect(end).toHaveBeenCalledOnce();

    const deniedBudget = {
      beginTool: vi.fn(() => ({ ok: false, reason: "max-tool-ms" })),
    };
    const denied = await executeTool(
      "read_file",
      { path: "missing-session-budget-fixture.txt" },
      {
        toolCallId: "call-2",
        sessionBudget: deniedBudget,
      },
    );

    expect(denied).toMatchObject({
      code: "CC_SESSION_BUDGET_EXHAUSTED",
      budgetReason: "max-tool-ms",
      policy: { decision: "blocked", via: "session-budget" },
    });
  });
});
