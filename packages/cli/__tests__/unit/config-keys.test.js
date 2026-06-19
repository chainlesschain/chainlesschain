/**
 * config-keys — discoverable config-key registry backing `cc config keys`
 * (Claude-Code 2.1.183 "list available shorthand keys" parity).
 */
import { describe, it, expect } from "vitest";
import {
  getKnownConfigKeys,
  describeConfigKeys,
  isSecretConfigKey,
} from "../../src/lib/config-keys.js";

describe("config-keys", () => {
  it("derives base keys from DEFAULT_CONFIG and adds verified extras", () => {
    const keys = getKnownConfigKeys().map((e) => e.key);
    // From DEFAULT_CONFIG
    expect(keys).toContain("llm.provider");
    expect(keys).toContain("llm.model");
    expect(keys).toContain("update.channel");
    expect(keys).toContain("enterprise.serverUrl");
    expect(keys).toContain("edition");
    // Open-map object emitted as a single key (not recursed away)
    expect(keys).toContain("features");
    // Extras not in DEFAULT_CONFIG but read via loadConfig()
    expect(keys).toContain("llm.visionModel");
    expect(keys).toContain("llm.pricing");
    expect(keys).toContain("cli.theme");
  });

  it("is sorted, de-duplicated, and carries type + description", () => {
    const entries = getKnownConfigKeys();
    const keys = entries.map((e) => e.key);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    expect(new Set(keys).size).toBe(keys.length);
    const provider = entries.find((e) => e.key === "llm.provider");
    expect(provider.type).toBe("string");
    expect(provider.description).toMatch(/provider/i);
    const autoCheck = entries.find((e) => e.key === "update.autoCheck");
    expect(autoCheck.type).toBe("boolean");
    expect(autoCheck.default).toBe(true);
  });

  it("flags secret keys", () => {
    expect(isSecretConfigKey("llm.apiKey")).toBe(true);
    expect(isSecretConfigKey("enterprise.apiKey")).toBe(true);
    expect(isSecretConfigKey("llm.provider")).toBe(false);
    expect(isSecretConfigKey("cli.theme")).toBe(false);
    const apiKey = getKnownConfigKeys().find((e) => e.key === "llm.apiKey");
    expect(apiKey.secret).toBe(true);
  });

  it("annotates current values and masks secrets (injected config)", () => {
    const loadConfig = () => ({
      llm: { provider: "ollama", apiKey: "sk-supersecret", model: "qwen" },
      cli: { theme: "mono" },
    });
    const described = describeConfigKeys({ loadConfig });
    const by = (k) => described.find((e) => e.key === k);
    expect(by("llm.provider").current).toBe("ollama");
    expect(by("llm.model").current).toBe("qwen");
    expect(by("cli.theme").current).toBe("mono");
    // secret present → masked, never leaked
    expect(by("llm.apiKey").current).toBe("****");
    expect(JSON.stringify(described)).not.toContain("sk-supersecret");
    // unset key → undefined current
    expect(by("enterprise.tenantId").current).toBeUndefined();
  });

  it("does not throw when the config loader fails", () => {
    const loadConfig = () => {
      throw new Error("boom");
    };
    expect(() => describeConfigKeys({ loadConfig })).not.toThrow();
    const described = describeConfigKeys({ loadConfig });
    expect(described.length).toBeGreaterThan(0);
    expect(described.every((e) => e.current === undefined)).toBe(true);
  });
});
