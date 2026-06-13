/**
 * `/config` REPL command (Claude-Code parity) — secret-safe effective-config
 * render. The load-bearing invariant: an API key value is NEVER printed.
 */
import { describe, it, expect } from "vitest";
import {
  maskSecret,
  renderConfigSummary,
} from "../../src/repl/config-summary.js";

describe("maskSecret", () => {
  it("reports not set / set with last 4 only", () => {
    expect(maskSecret(undefined)).toBe("not set");
    expect(maskSecret("")).toBe("not set");
    expect(maskSecret("abcd")).toBe("set (hidden)");
    expect(maskSecret("sk-supersecretkey-1234")).toBe("set (…1234)");
  });
});

describe("renderConfigSummary", () => {
  const SECRET = "sk-ant-verysecret-abcd1234XYZ";

  it("shows provider/model/baseUrl and NEVER the raw key", () => {
    const out = renderConfigSummary(
      {
        llm: {
          provider: "anthropic",
          model: "claude-opus",
          baseUrl: "https://api.anthropic.com",
          apiKey: SECRET,
        },
      },
      { path: "/home/u/.chainlesschain/config.json" },
    );
    expect(out).toContain("provider: anthropic");
    expect(out).toContain("model:    claude-opus");
    expect(out).toContain("baseUrl:  https://api.anthropic.com");
    expect(out).toContain("apiKey:   set (…4XYZ)"); // last 4 of the secret
    expect(out).toContain("config file: /home/u/.chainlesschain/config.json");
    // The invariant: the secret is not anywhere in the output.
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain("verysecret");
  });

  it("handles an empty / unconfigured config", () => {
    const out = renderConfigSummary(null);
    expect(out).toContain("provider: (unset → defaults to ollama)");
    expect(out).toContain("model:    (unset)");
    expect(out).toContain("apiKey:   not set");
  });

  it("renders webSearch and vision model when present, masking the ws key", () => {
    const out = renderConfigSummary({
      llm: {
        provider: "volcengine",
        model: "doubao",
        visionModel: "doubao-vision",
      },
      webSearch: { provider: "tavily", apiKey: "tvly-secret-9999" },
    });
    expect(out).toContain("vision:   doubao-vision");
    expect(out).toContain("webSearch:");
    expect(out).toContain("provider: tavily");
    expect(out).toContain("apiKey:   set (…9999)");
    expect(out).not.toContain("tvly-secret-9999");
  });

  it("flags when the active session provider/model overrides config", () => {
    const cfg = { llm: { provider: "ollama", model: "qwen2.5:7b" } };
    const overridden = renderConfigSummary(cfg, {
      activeProvider: "anthropic",
      activeModel: "claude-opus",
    });
    expect(overridden).toContain(
      "active this session: anthropic · claude-opus  (overrides config)",
    );
    const matched = renderConfigSummary(cfg, {
      activeProvider: "ollama",
      activeModel: "qwen2.5:7b",
    });
    expect(matched).toContain("active this session: ollama · qwen2.5:7b");
    expect(matched).not.toContain("(overrides config)");
  });
});
