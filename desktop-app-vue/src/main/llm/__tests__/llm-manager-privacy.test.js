import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createLlmManagerPrivacy } = require("../llm-manager-privacy");

describe("LLM manager privacy boundary", () => {
  const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("allows every static manager event and rejects dynamic identifiers", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "llm-manager.js"),
      "utf8",
    );
    const eventNames = [
      ...source.matchAll(/managerPrivacy\.event\("([a-z-]+)"\)/gu),
    ].map((match) => match[1]);
    const privacy = createLlmManagerPrivacy(sink);

    expect(eventNames.length).toBeGreaterThan(0);
    for (const eventName of eventNames) {
      privacy.event(eventName);
      expect(sink.info).toHaveBeenLastCalledWith(
        "[LLMManager] internal event",
        { component: "manager", event: eventName },
      );
    }

    privacy.event("private-provider-model-prompt-error");
    expect(sink.info).toHaveBeenLastCalledWith("[LLMManager] internal event", {
      component: "manager",
      event: "unknown",
    });
  });

  it("returns fixed failure event receipts", () => {
    const privacy = createLlmManagerPrivacy(sink);

    expect(privacy.failureEvent("chat")).toEqual({
      code: "CC_LLM_MANAGER_OPERATION_FAILED",
      component: "manager",
      operation: "chat",
    });
    expect(privacy.failureEvent("private-operation")).toEqual({
      code: "CC_LLM_MANAGER_OPERATION_FAILED",
      component: "manager",
      operation: "unknown",
    });
  });

  it("returns fixed public event receipts", () => {
    const privacy = createLlmManagerPrivacy(sink);

    expect(privacy.publicEvent("chat-completed")).toEqual({
      code: "CC_LLM_MANAGER_EVENT",
      component: "manager",
      event: "chat-completed",
    });
    expect(privacy.publicEvent("private-event")).toEqual({
      code: "CC_LLM_MANAGER_EVENT",
      component: "manager",
      event: "unknown",
    });
  });

  it("rebuilds caught failures without retaining private error content", () => {
    const privacy = createLlmManagerPrivacy(sink);
    const source = new Error("private provider response and prompt");
    source.code = "PRIVATE_PROVIDER_CODE";
    source.cause = { apiKey: "private-api-key" };

    const failure = privacy.failure("query", source);

    expect(failure).toMatchObject({
      message: "LLM manager operation failed",
      code: "CC_LLM_MANAGER_OPERATION_FAILED",
      component: "manager",
      operation: "query",
    });
    expect(failure).not.toBe(source);
    expect(failure).not.toHaveProperty("cause");
    expect(JSON.stringify(failure)).not.toContain("private");
  });

  it("preserves only the governed terminal code with fixed content", () => {
    const privacy = createLlmManagerPrivacy(sink);
    const source = new Error("private governed failure");
    source.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";

    expect(privacy.failure("chat-stream", source)).toMatchObject({
      message: "Governed Desktop model request failed",
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      component: "manager",
      operation: "chat-stream",
    });
  });

  it("fails closed when an error object has hostile accessors", () => {
    const privacy = createLlmManagerPrivacy(sink);
    const source = new Proxy(
      {},
      {
        get() {
          throw new Error("private accessor failure");
        },
      },
    );

    expect(privacy.failure("embeddings", source)).toMatchObject({
      message: "LLM manager operation failed",
      code: "CC_LLM_MANAGER_OPERATION_FAILED",
      component: "manager",
      operation: "embeddings",
    });
  });

  it("prevents the manager from bypassing the boundary", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "llm-manager.js"),
      "utf8",
    );

    expect(source).not.toMatch(/utils\/logger\.js/u);
    expect(source).not.toMatch(
      /\blogger\.(?:debug|info|warn|error|fatal)\s*\(/u,
    );
    expect(source).not.toMatch(/console\.(?:debug|info|warn|error|log)\s*\(/u);
    expect(source).not.toMatch(/\berror\.message\b/u);
    expect(source).not.toMatch(
      /emit\("(?:query-failed|chat-failed|chat-stream-failed|stream-failed)",\s*\{/u,
    );
    expect(source).not.toMatch(/throw\s+(?:chatError|streamError)\s*;/u);
    for (const event of [
      "initialized",
      "unavailable",
      "provider-changed",
      "query-completed",
      "chat-completed",
      "chat-stream-completed",
      "stream-completed",
      "budget-alert",
      "service-paused",
      "model-switched",
      "service-resumed",
    ]) {
      const calls = source.match(
        new RegExp(`emit\\(\\s*"${event}"\\s*,`, "gu"),
      );
      const fixedCalls = source.match(
        new RegExp(
          `emit\\(\\s*"${event}"\\s*,\\s*managerPrivacy\\.publicEvent\\("${event}"\\)`,
          "gu",
        ),
      );
      expect(fixedCalls?.length).toBe(calls?.length);
    }
  });
});
