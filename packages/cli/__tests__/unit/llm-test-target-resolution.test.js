/**
 * resolveLlmTestTarget — `cc llm test` provider/model/baseUrl/apiKey resolution.
 *
 * Regression: the connectivity probe used to ignore config.llm.* and hard-
 * default to ollama, so a user on volcengine/openai (and the JetBrains
 * "Configure LLM" wizard, which calls `cc llm test`) got a spurious
 * "fetch failed" against a local ollama they never ran.
 */
import { describe, it, expect } from "vitest";
import { resolveLlmTestTarget } from "../../src/commands/llm.js";

const BUILT_INS = {
  ollama: { name: "ollama", displayName: "Ollama", baseUrl: "http://localhost:11434" },
  openai: {
    name: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    models: ["gpt-4o-mini"],
  },
  volcengine: {
    name: "volcengine",
    displayName: "Volcengine (火山引擎/豆包)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyEnv: "VOLCENGINE_API_KEY",
    models: ["doubao-seed-1-6-251015"],
  },
};

describe("resolveLlmTestTarget", () => {
  it("defaults to the CONFIGURED provider, not ollama (the bug)", () => {
    const cfg = {
      llm: {
        provider: "volcengine",
        model: "doubao-seed-1-6-251015",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "sk-volc",
      },
    };
    const t = resolveLlmTestTarget({}, cfg, BUILT_INS, {});
    expect(t.provider).toBe("volcengine");
    expect(t.isOllama).toBe(false);
    expect(t.model).toBe("doubao-seed-1-6-251015");
    expect(t.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
    expect(t.apiKey).toBe("sk-volc");
    expect(t.label).toContain("Volcengine");
  });

  it("falls back to ollama only when nothing is configured", () => {
    const t = resolveLlmTestTarget({}, {}, BUILT_INS, {});
    expect(t.provider).toBe("ollama");
    expect(t.isOllama).toBe(true);
    expect(t.model).toBe("qwen2:7b");
    expect(t.baseUrl).toBe("http://localhost:11434");
    expect(t.apiKey).toBeUndefined();
  });

  it("lets an explicit --provider override the configured one", () => {
    const cfg = { llm: { provider: "volcengine", apiKey: "sk-volc" } };
    const t = resolveLlmTestTarget(
      { provider: "openai", apiKey: "sk-oa" },
      cfg,
      BUILT_INS,
      {},
    );
    expect(t.provider).toBe("openai");
    expect(t.baseUrl).toBe("https://api.openai.com/v1"); // built-in default
    expect(t.apiKey).toBe("sk-oa");
    expect(t.model).toBe("gpt-4o-mini"); // built-in first model
  });

  it("does NOT inherit a non-ollama config baseUrl for an explicit --provider ollama", () => {
    // The earlier fix: `--provider ollama` while configured for volcengine must
    // probe localhost, not the volcengine endpoint.
    const cfg = {
      llm: { provider: "volcengine", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
    };
    const t = resolveLlmTestTarget({ provider: "ollama" }, cfg, BUILT_INS, {});
    expect(t.baseUrl).toBe("http://localhost:11434");
  });

  it("inherits config baseUrl when the configured provider IS ollama", () => {
    const cfg = { llm: { provider: "ollama", baseUrl: "http://192.168.1.9:11434" } };
    const t = resolveLlmTestTarget({}, cfg, BUILT_INS, {});
    expect(t.baseUrl).toBe("http://192.168.1.9:11434");
  });

  it("reads the api key from the provider's env var as a last resort", () => {
    const cfg = { llm: { provider: "volcengine" } };
    const t = resolveLlmTestTarget({}, cfg, BUILT_INS, {
      VOLCENGINE_API_KEY: "env-key",
    });
    expect(t.apiKey).toBe("env-key");
  });

  it("explicit flags win over everything", () => {
    const cfg = { llm: { provider: "volcengine", model: "m1", baseUrl: "b1", apiKey: "k1" } };
    const t = resolveLlmTestTarget(
      { provider: "deepseek", model: "m2", baseUrl: "b2", apiKey: "k2" },
      cfg,
      BUILT_INS,
      {},
    );
    expect(t).toMatchObject({ provider: "deepseek", model: "m2", baseUrl: "b2", apiKey: "k2" });
  });

  it("uses provider label for a known built-in, raw id otherwise", () => {
    expect(resolveLlmTestTarget({ provider: "volcengine", apiKey: "x" }, {}, BUILT_INS, {}).label).toContain("Volcengine");
    expect(resolveLlmTestTarget({ provider: "customxyz", apiKey: "x" }, {}, BUILT_INS, {}).label).toBe("customxyz");
  });
});
