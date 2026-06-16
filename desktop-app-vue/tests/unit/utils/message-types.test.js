/**
 * messageTypes 测试 — src/renderer/utils/messageTypes.ts
 *
 * Pure message-factory functions + the MessageType / MessageRole maps.
 */

import { describe, it, expect } from "vitest";
import {
  MessageType,
  MessageRole,
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createIntentSystemMessage,
  createIntentRecognitionMessage,
  createTaskAnalysisMessage,
  createInterviewMessage,
  createTaskPlanMessage,
  createProgressMessage,
  createErrorMessage,
  createIntentConfirmationMessage,
} from "@/utils/messageTypes";

describe("messageTypes — enums", () => {
  it("exposes the message type + role maps", () => {
    expect(MessageType.USER).toBe("user");
    expect(MessageType.TASK_PLAN).toBe("task-plan");
    expect(MessageType.ERROR).toBe("error");
    expect(MessageRole).toEqual({
      USER: "user",
      ASSISTANT: "assistant",
      SYSTEM: "system",
    });
  });
});

describe("messageTypes — basic factories", () => {
  it("createUserMessage", () => {
    const m = createUserMessage("hello", "conv1");
    expect(m).toMatchObject({
      role: "user",
      type: "user",
      content: "hello",
      conversation_id: "conv1",
    });
    expect(m.id).toMatch(/_user$/);
    expect(typeof m.timestamp).toBe("number");
  });

  it("createUserMessage defaults conversation_id to null", () => {
    expect(createUserMessage("hi").conversation_id).toBeNull();
  });

  it("createAssistantMessage carries metadata (default {})", () => {
    expect(createAssistantMessage("a", "c", { model: "x" })).toMatchObject({
      role: "assistant",
      type: "assistant",
      content: "a",
      conversation_id: "c",
      metadata: { model: "x" },
    });
    expect(createAssistantMessage("a").metadata).toEqual({});
  });

  it("createSystemMessage", () => {
    expect(createSystemMessage("sys", { k: 1 })).toMatchObject({
      role: "system",
      type: "system",
      content: "sys",
      metadata: { k: 1 },
    });
  });
});

describe("messageTypes — createIntentSystemMessage", () => {
  it("maps each intent to its canned content", () => {
    expect(
      createIntentSystemMessage("CONTINUE_EXECUTION", "go").content,
    ).toContain("继续执行");
    expect(createIntentSystemMessage("CANCEL_TASK", "x").content).toContain(
      "任务已取消",
    );
  });

  it("embeds extractedInfo for MODIFY_REQUIREMENT / CLARIFICATION", () => {
    expect(
      createIntentSystemMessage("MODIFY_REQUIREMENT", "u", {
        extractedInfo: "dark mode",
      }).content,
    ).toContain("dark mode");
    expect(
      createIntentSystemMessage("CLARIFICATION", "u", { extractedInfo: "TS" })
        .content,
    ).toContain("TS");
  });

  it("falls back for an unknown intent and records metadata", () => {
    const m = createIntentSystemMessage("BOGUS", "in", { reason: "r" });
    expect(m.content).toContain("未知意图");
    expect(m.metadata).toMatchObject({
      intent: "BOGUS",
      reason: "r",
      userInput: "in",
    });
  });
});

describe("messageTypes — specialized factories", () => {
  it("createIntentRecognitionMessage", () => {
    const m = createIntentRecognitionMessage({ intent: "x" });
    expect(m.type).toBe("intent-recognition");
    expect(m.metadata.intentResult).toEqual({ intent: "x" });
  });

  it("createTaskAnalysisMessage (default analyzing)", () => {
    expect(createTaskAnalysisMessage().metadata.status).toBe("analyzing");
    expect(createTaskAnalysisMessage("completed").metadata.status).toBe(
      "completed",
    );
  });

  it("createInterviewMessage", () => {
    const m = createInterviewMessage(["q1", "q2"], 1);
    expect(m).toMatchObject({ role: "assistant", type: "interview" });
    expect(m.metadata).toMatchObject({
      questions: ["q1", "q2"],
      currentIndex: 1,
      answers: {},
    });
  });

  it("createTaskPlanMessage starts pending", () => {
    const m = createTaskPlanMessage({ title: "P" });
    expect(m.type).toBe("task-plan");
    expect(m.metadata).toMatchObject({
      plan: { title: "P" },
      status: "pending",
    });
  });

  it("createProgressMessage (default progress 0)", () => {
    expect(createProgressMessage("step", 42)).toMatchObject({
      type: "progress",
      content: "step",
      metadata: { progress: 42 },
    });
    expect(createProgressMessage("step").metadata.progress).toBe(0);
  });

  it("createErrorMessage handles Error and string", () => {
    expect(createErrorMessage(new Error("boom")).content).toBe("boom");
    expect(createErrorMessage("plain").content).toBe("plain");
    expect(createErrorMessage("plain").type).toBe("error");
  });

  it("createIntentConfirmationMessage", () => {
    const m = createIntentConfirmationMessage("do X", { summary: "s" });
    expect(m).toMatchObject({ role: "assistant", type: "intent-confirmation" });
    expect(m.metadata).toMatchObject({
      originalInput: "do X",
      understanding: { summary: "s" },
      status: "pending",
      correction: null,
    });
  });
});
