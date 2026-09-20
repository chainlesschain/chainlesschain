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
  });
});
