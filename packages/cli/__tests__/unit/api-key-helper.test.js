/**
 * llm.apiKeyHelper (gap-analysis 2026-07-11 P0 "依赖安装与凭据"): external
 * command → API key, wired into applyConfigLlmDefaults' backfill order.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveApiKeyFromHelper,
  clearApiKeyHelperCache,
} from "../../src/lib/api-key-helper.js";
import { applyConfigLlmDefaults } from "../../src/lib/llm-config-defaults.js";

beforeEach(() => clearApiKeyHelperCache());

describe("resolveApiKeyFromHelper", () => {
  it("returns trimmed stdout and caches per command", () => {
    const exec = vi.fn(() => "  sk-secret-123\n");
    expect(resolveApiKeyFromHelper("get-key", { exec })).toBe("sk-secret-123");
    expect(resolveApiKeyFromHelper("get-key", { exec })).toBe("sk-secret-123");
    expect(exec).toHaveBeenCalledTimes(1); // second hit served from cache
  });

  it("re-runs the helper after the TTL expires", () => {
    let t = 0;
    const exec = vi.fn(() => "k");
    const now = () => t;
    resolveApiKeyFromHelper("cmd", { exec, now });
    t = 6 * 60 * 1000; // past the 5-min TTL
    resolveApiKeyFromHelper("cmd", { exec, now });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("a failing helper resolves null and warns once (fail-closed, no fallback)", () => {
    const exec = vi.fn(() => {
      throw new Error("no such credential");
    });
    const errs = [];
    const writeErr = (s) => errs.push(s);
    expect(resolveApiKeyFromHelper("bad", { exec, writeErr })).toBeNull();
    expect(resolveApiKeyFromHelper("bad", { exec, writeErr })).toBeNull();
    expect(errs.filter((e) => e.includes("apiKeyHelper failed"))).toHaveLength(
      1,
    );
  });

  it("empty stdout / empty command resolve null", () => {
    expect(resolveApiKeyFromHelper("cmd", { exec: () => "  \n" })).toBeNull();
    expect(resolveApiKeyFromHelper("", {})).toBeNull();
    expect(resolveApiKeyFromHelper(null, {})).toBeNull();
  });
});

describe("applyConfigLlmDefaults + apiKeyHelper backfill", () => {
  it("plaintext llm.apiKey still wins over the helper", () => {
    const options = {};
    applyConfigLlmDefaults(options, {
      provider: "openai",
      apiKey: "plain-key",
      apiKeyHelper: "echo helper-key",
    });
    expect(options.apiKey).toBe("plain-key");
  });

  it("helper fills the key when config has none (echo round-trip)", () => {
    const options = {};
    applyConfigLlmDefaults(options, {
      provider: "openai",
      // real subprocess: proves the execSync default path end-to-end
      apiKeyHelper: "node -e \"process.stdout.write('helper-key')\"",
    });
    expect(options.apiKey).toBe("helper-key");
  });

  it("explicit --api-key is never overridden", () => {
    const options = { apiKey: "cli-key", provider: "openai" };
    applyConfigLlmDefaults(options, {
      provider: "openai",
      apiKeyHelper: "node -e \"process.stdout.write('helper-key')\"",
    });
    expect(options.apiKey).toBe("cli-key");
  });
});
