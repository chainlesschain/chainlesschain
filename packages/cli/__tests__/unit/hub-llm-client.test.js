/**
 * hub-llm-client — standalone `cc hub ask` cloud-LLM adapter.
 *
 * Verifies the OPT-IN resolution (CC_HUB_LLM) so the default stays local
 * Ollama (privacy promise), and the OpenAI-compat / Anthropic chat shapes
 * map onto the hub LLMClient contract `{ text, usage?, model? }`.
 */
import { describe, it, expect } from "vitest";
import {
  buildCliHubLLM,
  isCloudHubConfigured,
  openAiCompatChat,
  anthropicChat,
} from "../../src/lib/hub-llm-client.js";

const VOLC_CFG = {
  llm: {
    provider: "volcengine",
    model: "doubao-seed-2-1-pro-260628",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: "sk-volc",
  },
};

describe("buildCliHubLLM — opt-in resolution", () => {
  it("returns null when CC_HUB_LLM is unset (keeps local Ollama default)", () => {
    expect(buildCliHubLLM({ config: VOLC_CFG, env: {} })).toBeNull();
  });

  it.each(["ollama", "local", "off", "0", "false", "no", ""])(
    "returns null for local sentinel %j",
    (v) => {
      expect(
        buildCliHubLLM({ config: VOLC_CFG, env: { CC_HUB_LLM: v } }),
      ).toBeNull();
    },
  );

  it("CC_HUB_LLM=config uses the saved provider/model/baseUrl/apiKey", () => {
    const llm = buildCliHubLLM({
      config: VOLC_CFG,
      env: { CC_HUB_LLM: "config" },
    });
    expect(llm).toBeTruthy();
    expect(llm.isLocal).toBe(false);
    expect(llm.name).toBe("volcengine:doubao-seed-2-1-pro-260628");
    expect(typeof llm.chat).toBe("function");
  });

  it.each(["auto", "on", "1", "true", "yes"])(
    "treats %j as a config alias",
    (v) => {
      const llm = buildCliHubLLM({ config: VOLC_CFG, env: { CC_HUB_LLM: v } });
      expect(llm && llm.name).toBe("volcengine:doubao-seed-2-1-pro-260628");
    },
  );

  it("CC_HUB_LLM=<provider> reuses config creds when provider matches", () => {
    const llm = buildCliHubLLM({
      config: VOLC_CFG,
      env: { CC_HUB_LLM: "volcengine" },
    });
    expect(llm.name).toBe("volcengine:doubao-seed-2-1-pro-260628");
  });

  it("CC_HUB_LLM=<other provider> falls back to provider default + env key", () => {
    const llm = buildCliHubLLM({
      config: VOLC_CFG,
      env: { CC_HUB_LLM: "deepseek", DEEPSEEK_API_KEY: "sk-ds" },
    });
    expect(llm).toBeTruthy();
    // default deepseek model + its own baseUrl, NOT volcengine's creds
    expect(llm.name.startsWith("deepseek:")).toBe(true);
  });

  it("returns null when a cloud provider has no key (→ safe local fallback)", () => {
    const noKey = { llm: { ...VOLC_CFG.llm, apiKey: "" } };
    expect(
      buildCliHubLLM({ config: noKey, env: { CC_HUB_LLM: "config" } }),
    ).toBeNull();
  });

  it("returns null when CC_HUB_LLM=<provider> resolves to ollama", () => {
    expect(
      buildCliHubLLM({ config: {}, env: { CC_HUB_LLM: "ollama" } }),
    ).toBeNull();
  });

  it("never throws on a malformed config (fail-open to null is the caller's job)", () => {
    expect(() =>
      buildCliHubLLM({ config: null, env: { CC_HUB_LLM: "config" } }),
    ).not.toThrow();
  });
});

describe("buildCliHubLLM — persistent config.hub.llm (no env needed)", () => {
  it("config.hub.llm='config' selects cloud without CC_HUB_LLM", () => {
    const cfg = { ...VOLC_CFG, hub: { llm: "config" } };
    const llm = buildCliHubLLM({ config: cfg, env: {} });
    expect(llm && llm.name).toBe("volcengine:doubao-seed-2-1-pro-260628");
    expect(llm.isLocal).toBe(false);
  });

  it("config.hub.llm='<provider>' selects that provider", () => {
    const cfg = { ...VOLC_CFG, hub: { llm: "volcengine" } };
    expect(buildCliHubLLM({ config: cfg, env: {} }).name).toBe(
      "volcengine:doubao-seed-2-1-pro-260628",
    );
  });

  it("env CC_HUB_LLM wins over config.hub.llm", () => {
    const cfg = {
      llm: {
        provider: "volcengine",
        model: "m1",
        baseUrl: "https://v",
        apiKey: "kv",
      },
      hub: { llm: "config" },
    };
    const llm = buildCliHubLLM({
      config: cfg,
      env: { CC_HUB_LLM: "deepseek", DEEPSEEK_API_KEY: "kd" },
    });
    expect(llm.name.startsWith("deepseek:")).toBe(true);
  });

  it("env CC_HUB_LLM=ollama overrides a cloud config back to local (null)", () => {
    const cfg = { ...VOLC_CFG, hub: { llm: "config" } };
    expect(
      buildCliHubLLM({ config: cfg, env: { CC_HUB_LLM: "ollama" } }),
    ).toBeNull();
  });

  it("object form: self-contained provider/model/baseUrl/apiKey", () => {
    const cfg = {
      llm: { provider: "anthropic", model: "haiku", apiKey: "cc-wide" },
      hub: {
        llm: {
          provider: "volcengine",
          model: "doubao-x",
          baseUrl: "https://ark/api/v3",
          apiKey: "hub-only-key",
        },
      },
    };
    const llm = buildCliHubLLM({ config: cfg, env: {} });
    expect(llm.name).toBe("volcengine:doubao-x");
  });

  it("object form: apiKeyEnv reads the key from a named env var", () => {
    const cfg = {
      hub: {
        llm: {
          provider: "volcengine",
          model: "doubao-x",
          baseUrl: "https://ark/api/v3",
          apiKeyEnv: "MY_HUB_KEY",
        },
      },
    };
    expect(
      buildCliHubLLM({ config: cfg, env: {} }),
      "no env value → no key → null",
    ).toBeNull();
    const llm = buildCliHubLLM({ config: cfg, env: { MY_HUB_KEY: "sk-env" } });
    expect(llm && llm.name).toBe("volcengine:doubao-x");
  });

  it("object form: falls back to cc-wide config.llm creds for same provider", () => {
    const cfg = {
      llm: {
        provider: "volcengine",
        model: "doubao-default",
        baseUrl: "https://ark/api/v3",
        apiKey: "cc-wide",
      },
      hub: { llm: { provider: "volcengine" } }, // model/baseUrl/key inherited
    };
    const llm = buildCliHubLLM({ config: cfg, env: {} });
    expect(llm.name).toBe("volcengine:doubao-default");
  });
});

describe("isCloudHubConfigured (standing-consent predicate)", () => {
  it("true when config.hub.llm selects a usable cloud backend", () => {
    expect(isCloudHubConfigured({ ...VOLC_CFG, hub: { llm: "config" } })).toBe(
      true,
    );
  });

  it("false when hub.llm is unset (no standing consent)", () => {
    expect(isCloudHubConfigured(VOLC_CFG)).toBe(false);
  });

  it("false when hub.llm resolves to local", () => {
    expect(isCloudHubConfigured({ hub: { llm: "ollama" } })).toBe(false);
  });

  it("ignores the ephemeral env path (env must not grant standing consent)", () => {
    // even with CC_HUB_LLM in the ambient env, the predicate is config-only
    const prev = process.env.CC_HUB_LLM;
    process.env.CC_HUB_LLM = "config";
    try {
      expect(isCloudHubConfigured(VOLC_CFG)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CC_HUB_LLM;
      else process.env.CC_HUB_LLM = prev;
    }
  });
});

describe("openAiCompatChat", () => {
  it("POSTs /chat/completions with bearer auth and maps the reply", async () => {
    let seen = null;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return {
        ok: true,
        json: async () => ({
          model: "doubao-x",
          choices: [{ message: { content: "hi there" } }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        }),
      };
    };
    const out = await openAiCompatChat({
      base: "https://ark.example/api/v3/",
      key: "sk-1",
      model: "doubao-x",
      messages: [{ role: "user", content: "hi" }],
      opts: { temperature: 0.2, maxTokens: 256 },
      fetchImpl,
    });
    expect(out.text).toBe("hi there");
    expect(out.model).toBe("doubao-x");
    expect(out.usage).toEqual({
      promptTokens: 10,
      completionTokens: 3,
      totalTokens: 13,
    });
    // trailing slash trimmed, auth + body shape
    expect(seen.url).toBe("https://ark.example/api/v3/chat/completions");
    expect(seen.init.headers.Authorization).toBe("Bearer sk-1");
    const body = JSON.parse(seen.init.body);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(256);
  });

  it("falls back to reasoning_content when content is empty", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "", reasoning_content: "thought" } }],
      }),
    });
    const out = await openAiCompatChat({
      base: "https://x",
      key: "k",
      model: "m",
      messages: [],
      fetchImpl,
    });
    expect(out.text).toBe("thought");
  });

  it("throws with status + body on a non-2xx response", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "bad key",
    });
    await expect(
      openAiCompatChat({
        base: "https://x",
        key: "k",
        model: "m",
        messages: [],
        fetchImpl,
      }),
    ).rejects.toThrow(/401.*bad key/);
  });
});

describe("anthropicChat", () => {
  it("extracts system, posts /messages with x-api-key, maps text blocks", async () => {
    let seen = null;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return {
        ok: true,
        json: async () => ({
          model: "claude-x",
          content: [
            { type: "text", text: "part1 " },
            { type: "thinking", text: "ignore" },
            { type: "text", text: "part2" },
          ],
          usage: { input_tokens: 7, output_tokens: 2 },
        }),
      };
    };
    const out = await anthropicChat({
      base: "https://api.anthropic.com/v1",
      key: "sk-ant",
      model: "claude-x",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
      opts: { maxTokens: 100 },
      fetchImpl,
    });
    expect(out.text).toBe("part1 part2");
    expect(out.usage).toEqual({
      promptTokens: 7,
      completionTokens: 2,
      totalTokens: 9,
    });
    expect(seen.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen.init.headers["x-api-key"]).toBe("sk-ant");
    expect(seen.init.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(seen.init.body);
    expect(body.system).toBe("be brief");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.max_tokens).toBe(100);
  });
});
