/**
 * `/config` REPL command (Claude-Code parity) — secret-safe effective-config
 * render. The load-bearing invariant: an API key value is NEVER printed.
 */
import { describe, it, expect } from "vitest";
import {
  maskSecret,
  renderConfigSummary,
  isSecretConfigKey,
  parseConfigCommand,
  renderConfigGet,
  renderConfigSet,
  renderConfigHelp,
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

describe("isSecretConfigKey", () => {
  it("matches secret-bearing keys on the last dotted segment", () => {
    expect(isSecretConfigKey("llm.apiKey")).toBe(true);
    expect(isSecretConfigKey("webSearch.apiKey")).toBe(true);
    expect(isSecretConfigKey("llm.api_key")).toBe(true);
    expect(isSecretConfigKey("foo.token")).toBe(true);
    expect(isSecretConfigKey("foo.secret")).toBe(true);
    expect(isSecretConfigKey("db.password")).toBe(true);
  });
  it("does not match non-secret keys", () => {
    expect(isSecretConfigKey("llm.provider")).toBe(false);
    expect(isSecretConfigKey("llm.model")).toBe(false);
    expect(isSecretConfigKey("cli.theme")).toBe(false);
    expect(isSecretConfigKey("")).toBe(false);
    expect(isSecretConfigKey(undefined)).toBe(false);
    // `keyboard` ends in "board", not a bare secret token
    expect(isSecretConfigKey("ui.keyboard")).toBe(false);
  });
});

describe("parseConfigCommand", () => {
  it("treats empty input as show", () => {
    expect(parseConfigCommand("")).toEqual({ action: "show" });
    expect(parseConfigCommand("   ")).toEqual({ action: "show" });
  });
  it("parses key=value (Claude-Code syntax)", () => {
    expect(parseConfigCommand(" llm.model=opus ")).toEqual({
      action: "set",
      key: "llm.model",
      value: "opus",
    });
  });
  it("parses the key value form", () => {
    expect(parseConfigCommand(" llm.provider anthropic ")).toEqual({
      action: "set",
      key: "llm.provider",
      value: "anthropic",
    });
  });
  it("keeps spaces and = inside a value", () => {
    expect(parseConfigCommand("llm.baseUrl=https://x/api?a=b")).toEqual({
      action: "set",
      key: "llm.baseUrl",
      value: "https://x/api?a=b",
    });
    expect(parseConfigCommand("note hello world")).toEqual({
      action: "set",
      key: "note",
      value: "hello world",
    });
  });
  it("treats a bare token as a get", () => {
    expect(parseConfigCommand("llm.model")).toEqual({
      action: "get",
      key: "llm.model",
    });
  });
  it("allows clearing a value with key=", () => {
    expect(parseConfigCommand("llm.baseUrl=")).toEqual({
      action: "set",
      key: "llm.baseUrl",
      value: "",
    });
  });
  it("errors on a missing key before =", () => {
    expect(parseConfigCommand("=value").action).toBe("error");
  });
  it("recognizes --help / -h / help / ? as the help action", () => {
    for (const a of ["--help", "-h", "help", "?", " --help "]) {
      expect(parseConfigCommand(a)).toEqual({ action: "help" });
    }
  });
  it("does NOT treat 'helper' (a real key) as help", () => {
    expect(parseConfigCommand("helper")).toEqual({
      action: "get",
      key: "helper",
    });
  });
});

describe("renderConfigHelp", () => {
  it("lists usage and the common keys without printing secrets", () => {
    const out = renderConfigHelp();
    expect(out).toContain("/config <key>=<value>");
    expect(out).toContain("llm.provider");
    expect(out).toContain("llm.visionModel");
    expect(out).toContain("cli.theme");
    // it documents keys, never values — no secret material
    expect(out).not.toMatch(/sk-/);
  });
});

describe("renderConfigGet / renderConfigSet (secret-safe)", () => {
  it("masks secret values on read and write", () => {
    expect(renderConfigGet("llm.apiKey", "sk-ant-verysecret-4XYZ")).toBe(
      "llm.apiKey = set (…4XYZ)",
    );
    expect(
      renderConfigGet("llm.apiKey", "sk-ant-verysecret-4XYZ"),
    ).not.toContain("verysecret");
    expect(renderConfigSet("webSearch.apiKey", "tvly-secret-9999")).toBe(
      "set webSearch.apiKey = set (…9999)",
    );
  });
  it("shows non-secret values plainly, JSON-stringifying objects", () => {
    expect(renderConfigGet("llm.model", "opus")).toBe("llm.model = opus");
    expect(renderConfigGet("llm", { provider: "ollama" })).toBe(
      'llm = {"provider":"ollama"}',
    );
    expect(renderConfigGet("missing.key", undefined)).toBe(
      "missing.key = (unset)",
    );
    expect(renderConfigSet("cli.theme", "dark")).toBe("set cli.theme = dark");
  });
});
