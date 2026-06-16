/**
 * followupIntentHelper 测试 — src/renderer/utils/followupIntentHelper.ts
 *
 * Pure intent-classification helpers (only logger imported, mocked).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  findExecutingTask,
  buildClassificationContext,
  createIntentSystemMessage,
  mergeRequirements,
  addClarificationToTaskPlan,
  getIntentDescription,
  needsUserConfirmation,
  createConfirmationDialogConfig,
  handleClassificationError,
  formatIntentLog,
} from "@/utils/followupIntentHelper";

describe("findExecutingTask", () => {
  it("returns null for nullish / non-array", () => {
    expect(findExecutingTask(null)).toBeNull();
    expect(findExecutingTask(undefined)).toBeNull();
    expect(findExecutingTask("nope")).toBeNull();
  });

  it("finds the latest executing TASK_PLAN", () => {
    const msgs = [
      { id: "a", type: "TASK_PLAN", metadata: { status: "completed" } },
      { id: "b", type: "TASK_PLAN", metadata: { status: "executing" } },
      { id: "c", type: "USER" },
    ];
    expect(findExecutingTask(msgs)?.id).toBe("b");
  });

  it("returns null when no task is executing", () => {
    expect(
      findExecutingTask([
        { type: "TASK_PLAN", metadata: { status: "completed" } },
      ]),
    ).toBeNull();
  });
});

describe("buildClassificationContext", () => {
  it("returns {} when there is no task message", () => {
    expect(buildClassificationContext(null)).toEqual({});
  });

  it("builds currentTask + last-5 conversation history (content sliced)", () => {
    const tm = {
      type: "TASK_PLAN",
      metadata: {
        status: "executing",
        plan: { title: "Build", description: "d", steps: [1, 2] },
      },
    };
    const msgs = Array.from({ length: 7 }, (_, i) => ({
      role: "user",
      content: "x".repeat(300) + i,
    }));
    const ctx = buildClassificationContext(tm, msgs);
    expect(ctx.currentTask).toMatchObject({
      name: "Build",
      status: "executing",
      steps: [1, 2],
    });
    expect(ctx.taskPlan).toEqual(tm.metadata.plan);
    expect(ctx.conversationHistory).toHaveLength(5);
    expect(ctx.conversationHistory[0].content.length).toBe(200);
  });

  it("defaults the task name when the plan has no title", () => {
    const ctx = buildClassificationContext({
      type: "TASK_PLAN",
      metadata: { plan: {} },
    });
    expect(ctx.currentTask.name).toBe("未命名任务");
  });
});

describe("createIntentSystemMessage", () => {
  it("uses the canned message for CONTINUE_EXECUTION", () => {
    const m = createIntentSystemMessage("CONTINUE_EXECUTION", "go");
    expect(m.role).toBe("system");
    expect(m.type).toBe("SYSTEM");
    expect(m.content).toContain("继续执行");
    expect(m.metadata).toMatchObject({
      intent: "CONTINUE_EXECUTION",
      userInput: "go",
    });
  });

  it("embeds extractedInfo for MODIFY_REQUIREMENT and CLARIFICATION", () => {
    expect(
      createIntentSystemMessage("MODIFY_REQUIREMENT", "u", {
        extractedInfo: "add dark mode",
      }).content,
    ).toContain("add dark mode");
    expect(
      createIntentSystemMessage("CLARIFICATION", "u", {
        extractedInfo: "use TS",
      }).content,
    ).toContain("use TS");
  });
});

describe("mergeRequirements", () => {
  it("appends the new requirement under a 追加需求 header", () => {
    const out = mergeRequirements("原始", "新增");
    expect(out).toContain("原始");
    expect(out).toContain("【追加需求】");
    expect(out).toContain("新增");
  });
});

describe("addClarificationToTaskPlan", () => {
  it("returns null for a nullish plan", () => {
    expect(addClarificationToTaskPlan(null, "c")).toBeNull();
  });

  it("creates the clarifications array and appends", () => {
    const r = addClarificationToTaskPlan({ title: "t" }, "more info");
    expect(r.clarifications).toHaveLength(1);
    expect(r.clarifications[0].content).toBe("more info");
    expect(typeof r.clarifications[0].timestamp).toBe("number");
  });

  it("appends to an existing clarifications array", () => {
    const r = addClarificationToTaskPlan(
      { clarifications: [{ content: "first", timestamp: 1 }] },
      "second",
    );
    expect(r.clarifications.map((c) => c.content)).toEqual(["first", "second"]);
  });
});

describe("getIntentDescription", () => {
  it("maps known intents and falls back for unknown", () => {
    expect(getIntentDescription("CONTINUE_EXECUTION")).toBe("继续执行");
    expect(getIntentDescription("CANCEL_TASK")).toBe("取消任务");
    expect(getIntentDescription("BOGUS")).toBe("未知意图");
  });
});

describe("needsUserConfirmation", () => {
  it("requires confirmation when there is no result", () => {
    expect(needsUserConfirmation(null)).toBe(true);
    expect(needsUserConfirmation({})).toBe(true);
  });

  it("skips confirmation for high-confidence rule matches", () => {
    expect(
      needsUserConfirmation({ data: { method: "rule", confidence: 0.9 } }),
    ).toBe(false);
  });

  it("requires confirmation below the threshold", () => {
    expect(
      needsUserConfirmation({ data: { method: "llm", confidence: 0.4 } }),
    ).toBe(true);
    expect(
      needsUserConfirmation({ data: { method: "llm", confidence: 0.7 } }),
    ).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(
      needsUserConfirmation({ data: { method: "llm", confidence: 0.7 } }, 0.8),
    ).toBe(true);
  });
});

describe("createConfirmationDialogConfig", () => {
  it("renders intent description, reason and confidence %", () => {
    const cfg = createConfirmationDialogConfig(
      {
        data: {
          intent: "CANCEL_TASK",
          confidence: 0.85,
          reason: "user said stop",
        },
      },
      "stop",
    );
    expect(cfg.content).toContain("取消任务");
    expect(cfg.content).toContain("user said stop");
    expect(cfg.content).toContain("85.0%");
    expect(cfg.okText).toBe("是的");
  });
});

describe("handleClassificationError", () => {
  it("returns a CLARIFICATION fallback carrying the error message", () => {
    const r = handleClassificationError(new Error("boom"), "input");
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      intent: "CLARIFICATION",
      confidence: 0.5,
      method: "error_fallback",
      error: "boom",
    });
  });
});

describe("formatIntentLog", () => {
  it("formats a failure when there is no result", () => {
    expect(formatIntentLog(null, "hi")).toContain("分类失败");
  });

  it("formats a full classification line", () => {
    const log = formatIntentLog(
      {
        data: {
          intent: "CONTINUE_EXECUTION",
          confidence: 0.92,
          method: "rule",
          latency: 12,
        },
      },
      "go on",
    );
    expect(log).toContain("继续执行");
    expect(log).toContain("92.0%");
    expect(log).toContain("rule");
    expect(log).toContain("12ms");
  });
});
