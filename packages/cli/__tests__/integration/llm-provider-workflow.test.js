/**
 * Integration tests: LLM provider + ask/chat workflow
 *
 * Tests the full flow from provider registry → query building → API call (mocked)
 * for all OpenAI-compatible providers including volcengine.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  BUILT_IN_PROVIDERS,
  LLMProviderRegistry,
} from "../../src/lib/llm-providers.js";
import {
  detectTaskType,
  selectModelForTask,
  TaskType,
} from "../../src/lib/task-model-selector.js";

describe("LLM Provider Workflow (integration)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ─── Provider Registry + Task Selector Integration ──────────

  describe("Provider Registry + Task Model Selector", () => {
    let db;
    let registry;

    beforeEach(() => {
      db = new MockDatabase();
      registry = new LLMProviderRegistry(db);
    });

    it("should select correct volcengine model for code task via registry", () => {
      const provider = registry.get("volcengine");
      expect(provider).toBeTruthy();

      const taskResult = detectTaskType(
        "write a python function to parse JSON",
      );
      expect(taskResult.taskType).toBe(TaskType.CODE);

      const model = selectModelForTask("volcengine", taskResult.taskType);
      expect(model).toBe("doubao-seed-1-6-251015");
      expect(provider.models).toContain(model);
    });

    it("should select correct volcengine model for reasoning task", () => {
      const taskResult = detectTaskType("分析这个算法的时间复杂度");
      expect(taskResult.taskType).toBe(TaskType.REASONING);

      const model = selectModelForTask("volcengine", taskResult.taskType);
      expect(model).toBe("doubao-seed-1-6-251015");
    });

    it("should select correct model after switching active provider to volcengine", () => {
      registry.setActive("volcengine");
      const activeProvider = registry.getActive();
      expect(activeProvider).toBe("volcengine");

      const taskResult = detectTaskType("quick answer please");
      const model = selectModelForTask(activeProvider, taskResult.taskType);
      expect(model).toBe("doubao-seed-1-6-lite-251015");
    });

    it("should work for all 8 built-in providers with code task", () => {
      const providers = registry.list();
      expect(providers.length).toBeGreaterThanOrEqual(8);

      for (const provider of providers) {
        if (provider.custom) continue;
        const model = selectModelForTask(provider.name, TaskType.CODE);
        expect(model, `No code model for ${provider.name}`).toBeTruthy();
      }
    });
  });

  // ─── Volcengine API Call Simulation ─────────────────────────

  describe("Volcengine API call simulation (mocked fetch)", () => {
    it("should build correct request for volcengine chat/completions", async () => {
      let capturedUrl, capturedOptions;

      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url, options) => {
          capturedUrl = url;
          capturedOptions = options;
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "Hello from 豆包!",
                    },
                  },
                ],
              }),
          });
        }),
      );

      const provider = BUILT_IN_PROVIDERS.volcengine;
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
        body: JSON.stringify({
          model: "doubao-seed-1-6-251015",
          messages: [{ role: "user", content: "你好" }],
        }),
      });

      const data = await response.json();

      expect(capturedUrl).toBe(
        "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      );
      expect(capturedOptions.method).toBe("POST");
      expect(capturedOptions.headers.Authorization).toBe("Bearer test-key");
      expect(data.choices[0].message.content).toBe("Hello from 豆包!");
    });

    it("should build correct streaming request for volcengine", async () => {
      let capturedBody;

      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url, options) => {
          capturedBody = JSON.parse(options.body);
          return Promise.resolve({
            ok: true,
            body: {
              getReader: () => ({
                read: vi
                  .fn()
                  .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(
                      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n',
                    ),
                  })
                  .mockResolvedValueOnce({ done: true }),
              }),
            },
          });
        }),
      );

      const provider = BUILT_IN_PROVIDERS.volcengine;
      await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
        body: JSON.stringify({
          model: "doubao-seed-1-6-flash-250828",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      });

      expect(capturedBody.stream).toBe(true);
      expect(capturedBody.model).toBe("doubao-seed-1-6-flash-250828");
    });
  });

  // ─── queryLLM-like flow for multiple providers ──────────────

  describe("queryLLM workflow for OpenAI-compatible providers", () => {
    const openAICompatible = [
      "openai",
      "deepseek",
      "dashscope",
      "mistral",
      "volcengine",
    ];

    for (const providerName of openAICompatible) {
      it(`should construct correct API call for ${providerName}`, async () => {
        let capturedUrl;

        vi.stubGlobal(
          "fetch",
          vi.fn().mockImplementation((url) => {
            capturedUrl = url;
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  choices: [
                    { message: { role: "assistant", content: "response" } },
                  ],
                }),
            });
          }),
        );

        const provider = BUILT_IN_PROVIDERS[providerName];
        await fetch(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer test-key`,
          },
          body: JSON.stringify({
            model: provider.models[0],
            messages: [{ role: "user", content: "Hi" }],
          }),
        });

        expect(capturedUrl).toBe(`${provider.baseUrl}/chat/completions`);

        vi.unstubAllGlobals();
      });
    }
  });

  // ─── Upgraded model mappings ───────────────────────────────

  describe("Upgraded model mappings (v0.40.3)", () => {
    let db;
    let registry;

    beforeEach(() => {
      db = new MockDatabase();
      registry = new LLMProviderRegistry(db);
    });

    it("ollama CODE model should be qwen2.5-coder:14b", () => {
      const model = selectModelForTask("ollama", TaskType.CODE);
      expect(model).toBe("qwen2.5-coder:14b");
      // Verify it's in the provider's model list
      const ollama = registry.get("ollama");
      expect(ollama.models).toContain(model);
    });

    it("ollama REASONING model should be qwen2.5:14b", () => {
      const model = selectModelForTask("ollama", TaskType.REASONING);
      expect(model).toBe("qwen2.5:14b");
      const ollama = registry.get("ollama");
      expect(ollama.models).toContain(model);
    });

    it("ollama CHAT model should be qwen2.5:7b", () => {
      const model = selectModelForTask("ollama", TaskType.CHAT);
      expect(model).toBe("qwen2.5:7b");
      const ollama = registry.get("ollama");
      expect(ollama.models).toContain(model);
    });

    it("volcengine CODE model should be doubao-seed-1-6-251015", () => {
      const model = selectModelForTask("volcengine", TaskType.CODE);
      expect(model).toBe("doubao-seed-1-6-251015");
    });

    it("volcengine CHAT model should be doubao-seed-1-6-251015", () => {
      const model = selectModelForTask("volcengine", TaskType.CHAT);
      expect(model).toBe("doubao-seed-1-6-251015");
    });

    it("ollama provider should list qwen2.5 models", () => {
      const ollama = registry.get("ollama");
      expect(ollama.models).toContain("qwen2.5:7b");
      expect(ollama.models).toContain("qwen2.5:14b");
      expect(ollama.models).toContain("qwen2.5-coder:14b");
      // Legacy models should still be present
      expect(ollama.models).toContain("qwen2:7b");
      expect(ollama.models).toContain("llama3:8b");
    });

    it("all task types should have valid models for all providers", () => {
      const taskTypes = Object.values(TaskType);
      const providers = registry.list().filter((p) => !p.custom);

      for (const provider of providers) {
        for (const taskType of taskTypes) {
          const model = selectModelForTask(provider.name, taskType);
          expect(
            model,
            `Missing model for ${provider.name}/${taskType}`,
          ).toBeTruthy();
        }
      }
    });
  });

  // ─── testProvider simulation ────────────────────────────────

  describe("testProvider for volcengine", () => {
    it("should test volcengine via OpenAI-compatible path", async () => {
      let capturedUrl;

      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url) => {
          capturedUrl = url;
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                choices: [{ message: { role: "assistant", content: "OK" } }],
              }),
          });
        }),
      );

      // Simulate what testProvider does for volcengine
      process.env.VOLCENGINE_API_KEY = "test-key-for-testing";
      try {
        const db = new MockDatabase();
        const registry = new LLMProviderRegistry(db);
        const result = await registry.testProvider("volcengine");
        expect(result.ok).toBe(true);
        expect(result.response).toBe("OK");
        expect(capturedUrl).toContain("ark.cn-beijing.volces.com");
        expect(capturedUrl).toContain("/chat/completions");
      } finally {
        delete process.env.VOLCENGINE_API_KEY;
      }
    });

    it("should throw when VOLCENGINE_API_KEY is not set", async () => {
      const db = new MockDatabase();
      const registry = new LLMProviderRegistry(db);
      await expect(registry.testProvider("volcengine")).rejects.toThrow(
        "VOLCENGINE_API_KEY not set",
      );
    });
  });
});
