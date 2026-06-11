/**
 * Config-default LLM for `cc agent` (cc ask/chat parity) — a bare run honors
 * config.json `llm` instead of silently assuming local ollama; an explicit
 * --provider wins outright (config never mixes into a different provider).
 * Regression for: editor chat panel "fetch failed" against a cloud config.
 */
import { describe, it, expect } from "vitest";
import { applyConfigLlmDefaults } from "../../src/lib/llm-config-defaults.js";

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
