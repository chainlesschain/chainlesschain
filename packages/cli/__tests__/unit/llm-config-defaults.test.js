/**
 * Config-default LLM for `cc agent` (cc ask/chat parity) — a bare run honors
 * config.json `llm` instead of silently assuming local ollama; an explicit
 * --provider wins outright (config never mixes into a different provider).
 * Regression for: editor chat panel "fetch failed" against a cloud config.
 */
import { describe, it, expect } from "vitest";
import {
  applyConfigLlmDefaults,
  reconcileConfigLlmProvider,
} from "../../src/lib/llm-config-defaults.js";

const CFG = {
  provider: "volcengine",
  model: "doubao-seed-1-6-251015",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: "sk-test",
};

describe("applyConfigLlmDefaults", () => {
  it("bare run adopts the configured provider/model/baseUrl/apiKey", () => {
    const o = applyConfigLlmDefaults({}, CFG);
    expect(o).toEqual({
      provider: "volcengine",
      model: "doubao-seed-1-6-251015",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "sk-test",
    });
  });

  it("explicit --provider wins outright — config not consulted at all", () => {
    const o = applyConfigLlmDefaults({ provider: "ollama" }, CFG);
    expect(o).toEqual({ provider: "ollama" }); // no doubao model/key bleed
  });

  it("explicit --provider that MATCHES config backfills the dropped baseUrl/apiKey (IDE panel case)", () => {
    // The editor panel pins --provider/--model from config but drops
    // --base-url/--api-key; without the backfill the cloud key is stripped → 401
    // / silent ollama fall-through.
    const o = applyConfigLlmDefaults(
      { provider: "volcengine", model: "haiku" }, // model corrupted, key absent
      CFG,
    );
    expect(o.provider).toBe("volcengine");
    expect(o.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3"); // backfilled
    expect(o.apiKey).toBe("sk-test"); // backfilled — key no longer dropped
    expect(o.model).toBe("haiku"); // explicit panel model kept (the heal fixes it later)
  });

  it("a caller-supplied baseUrl/apiKey is NOT overwritten by config on a provider match", () => {
    const o = applyConfigLlmDefaults(
      { provider: "volcengine", baseUrl: "http://my-proxy", apiKey: "sk-mine" },
      CFG,
    );
    expect(o.baseUrl).toBe("http://my-proxy");
    expect(o.apiKey).toBe("sk-mine");
  });

  it("an explicit --model survives; a settings-leaked model is replaced", () => {
    const explicit = applyConfigLlmDefaults({ model: "my-model" }, CFG, {
      explicitModel: "my-model",
    });
    expect(explicit.provider).toBe("volcengine");
    expect(explicit.model).toBe("my-model");
    // options.model came from .claude/settings.json (no explicit flag) →
    // it must NOT ride the config provider (the opus→404 vision-trap lesson)
    const leaked = applyConfigLlmDefaults({ model: "claude-opus" }, CFG, {});
    expect(leaked.model).toBe("doubao-seed-1-6-251015");
    expect(leaked.apiKey).toBe("sk-test");
  });

  it("no configured provider → unchanged (runner ollama default applies)", () => {
    expect(applyConfigLlmDefaults({}, {})).toEqual({});
    expect(applyConfigLlmDefaults({ model: "m" }, { model: "x" })).toEqual({
      model: "m",
    });
  });
});

describe("reconcileConfigLlmProvider — self-repair of a mislabeled config", () => {
  // The recurring corruption: provider/model reset to cc's defaults
  // (anthropic/haiku) while baseUrl/apiKey stay volcengine. The baseUrl is the
  // real endpoint, so it wins → relabel to volcengine + swap the foreign model.
  it("corrects provider AND foreign model to match the baseUrl endpoint", async () => {
    const { llm, changed } = await reconcileConfigLlmProvider({
      provider: "anthropic",
      model: "haiku",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "sk-x",
    });
    expect(changed).toBe(true);
    expect(llm.provider).toBe("volcengine");
    expect(llm.model).not.toBe("haiku"); // foreign → provider default
    expect(llm.apiKey).toBe("sk-x"); // key + baseUrl preserved verbatim
    expect(llm.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
  });

  it("keeps a non-foreign model when only the provider label is wrong", async () => {
    const { llm, changed } = await reconcileConfigLlmProvider({
      provider: "anthropic", // mislabeled
      model: "doubao-seed-2-1-pro-260628", // already a volcengine model
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    });
    expect(changed).toBe(true);
    expect(llm.provider).toBe("volcengine");
    expect(llm.model).toBe("doubao-seed-2-1-pro-260628"); // untouched
  });

  it("a consistent config is a no-op (no copy, no write churn)", async () => {
    const cfg = {
      provider: "volcengine",
      model: "doubao-seed-2-1-pro-260628",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    };
    const r = await reconcileConfigLlmProvider(cfg);
    expect(r.changed).toBe(false);
    expect(r.llm).toBe(cfg); // same reference — caller won't persist
  });

  it("leaves a custom/proxy host and a baseUrl-less config untouched", async () => {
    expect(
      (
        await reconcileConfigLlmProvider({
          provider: "anthropic",
          model: "x",
          baseUrl: "https://my-proxy.internal/v1",
        })
      ).changed,
    ).toBe(false);
    expect(
      (
        await reconcileConfigLlmProvider({
          provider: "anthropic",
          model: "haiku",
        })
      ).changed,
    ).toBe(false);
    expect((await reconcileConfigLlmProvider({})).changed).toBe(false);
  });

  it("does not mutate the input object", async () => {
    const cfg = {
      provider: "anthropic",
      model: "haiku",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    };
    await reconcileConfigLlmProvider(cfg);
    expect(cfg.provider).toBe("anthropic"); // original untouched
    expect(cfg.model).toBe("haiku");
  });
});
