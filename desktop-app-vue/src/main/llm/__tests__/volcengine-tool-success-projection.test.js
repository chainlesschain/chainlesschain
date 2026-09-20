import { describe, expect, it, vi } from "vitest";

const {
  projectVolcengineKnowledgeSetupSuccess,
  projectVolcengineToolSuccess,
} = require("../volcengine-tool-success-projection");

describe("Volcengine tool success projection", () => {
  it("keeps only bounded text, model, and usage counters", () => {
    const result = projectVolcengineToolSuccess({
      choices: [
        {
          finish_reason: "private-finish-reason",
          message: {
            content: "public answer",
            knowledge_results: [{ content: "private-knowledge-document" }],
            search_results: [{ url: "https://private.example.test" }],
            tool_calls: [{ function: { arguments: "private-tool-arguments" } }],
          },
        },
      ],
      model: "public-model",
      provider_response: "private-provider-response",
      usage: {
        prompt_tokens: 3,
        completion_tokens: 4,
        total_tokens: 7,
        billing_account: "private-billing-account",
      },
    });

    expect(result).toEqual({
      text: "public answer",
      usage: {
        prompt_tokens: 3,
        completion_tokens: 4,
        total_tokens: 7,
      },
      model: "public-model",
    });
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.usage)).toBe(true);
  });

  it("projects completed tool loops without returning message history", () => {
    const result = projectVolcengineToolSuccess({
      text: "complete",
      model: "public-model",
      messages: [
        { role: "user", content: "private-user-prompt" },
        { role: "tool", content: "private-tool-result" },
      ],
      usage: { total_tokens: 5 },
    });

    expect(result).toEqual({
      text: "complete",
      usage: { total_tokens: 5 },
      model: "public-model",
    });
    expect(result).not.toHaveProperty("messages");
  });

  it("does not invoke provider accessors or traverse proxies", () => {
    const accessor = vi.fn(() => "private-accessor");
    const result = { model: "public-model" };
    Object.defineProperty(result, "text", {
      enumerable: true,
      get: accessor,
    });
    Object.defineProperty(result, "choices", {
      enumerable: true,
      value: new Proxy([{ message: { content: "private-proxy" } }], {
        get: () => "private-proxy",
      }),
    });

    expect(projectVolcengineToolSuccess(result)).toEqual({
      text: "",
      usage: { total_tokens: 0 },
      model: "public-model",
    });
    expect(accessor).not.toHaveBeenCalled();
  });

  it("returns a fixed knowledge setup receipt", () => {
    expect(
      projectVolcengineKnowledgeSetupSuccess({
        documents: [{ content: "private-document" }],
      }),
    ).toEqual({ configured: true });
  });
});
