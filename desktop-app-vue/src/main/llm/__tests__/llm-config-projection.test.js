import { describe, expect, it } from "vitest";

const {
  mergeLlmConfigWrite,
  projectLlmConfigForRenderer,
} = require("../llm-config-projection");

function privateConfig() {
  return {
    provider: "openai",
    openai: {
      apiKey: "sk-openai-secret",
      baseURL: "https://tenant.example.test/private",
      organization: "org-private",
      model: "gpt-private",
      embeddingModel: "embed-private",
      arbitrary: "must-not-cross",
    },
    anthropic: {
      apiKey: "sk-anthropic-secret",
      baseURL: "https://anthropic.example.test/private",
      model: "claude-private",
      embeddingModel: "",
      version: "2023-06-01",
    },
    custom: {
      apiKey: "sk-custom-secret",
      baseURL: "https://custom.example.test/tenant",
      name: "Private Custom",
      model: "custom-model",
      embeddingModel: "custom-embed",
    },
    options: {
      temperature: 0.3,
      max_tokens: 512,
      arbitrary: "must-not-cross",
    },
    systemPrompt: "private system prompt",
    streamEnabled: true,
    autoSaveConversations: false,
    arbitrary: "must-not-cross",
  };
}

describe("LLM config renderer projection", () => {
  it("returns configured receipts without private values", () => {
    const projected = projectLlmConfigForRenderer(privateConfig());
    const serialized = JSON.stringify(projected);

    expect(projected).toMatchObject({
      provider: "openai",
      systemPrompt: "",
      systemPromptConfigured: true,
      openai: {
        apiKey: "",
        apiKeyConfigured: true,
        baseURL: "",
        baseURLConfigured: true,
        organization: "",
        organizationConfigured: true,
        model: "gpt-private",
        embeddingModel: "embed-private",
      },
      custom: {
        apiKey: "",
        apiKeyConfigured: true,
        baseURL: "",
        baseURLConfigured: true,
      },
      options: { temperature: 0.3, max_tokens: 512 },
    });
    expect(serialized).not.toContain("sk-openai-secret");
    expect(serialized).not.toContain("tenant.example.test");
    expect(serialized).not.toContain("private system prompt");
    expect(serialized).not.toContain("must-not-cross");
  });

  it("preserves hidden values on blank writes and drops receipt fields", () => {
    const current = privateConfig();
    const merged = mergeLlmConfigWrite(
      {
        ...projectLlmConfigForRenderer(current),
        openai: {
          ...projectLlmConfigForRenderer(current).openai,
          model: "gpt-updated",
        },
        arbitrary: "must-not-persist",
      },
      current,
    );

    expect(merged.openai).toEqual({
      apiKey: "sk-openai-secret",
      baseURL: "https://tenant.example.test/private",
      organization: "org-private",
      model: "gpt-updated",
      embeddingModel: "embed-private",
    });
    expect(merged.systemPrompt).toBe("private system prompt");
    expect(merged.openai.apiKeyConfigured).toBeUndefined();
    expect(merged.arbitrary).toBeUndefined();
  });

  it("accepts replacements and explicit null clears", () => {
    const merged = mergeLlmConfigWrite(
      {
        provider: "openai",
        openai: {
          apiKey: "sk-replacement",
          baseURL: null,
          organization: null,
          model: "gpt-next",
        },
        systemPrompt: null,
      },
      privateConfig(),
    );

    expect(merged.openai.apiKey).toBe("sk-replacement");
    expect(merged.openai.baseURL).toBe("");
    expect(merged.openai.organization).toBe("");
    expect(merged.systemPrompt).toBe("");
    expect(merged.options).toEqual({ temperature: 0.3, max_tokens: 512 });
  });
});
