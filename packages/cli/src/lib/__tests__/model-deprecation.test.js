import { describe, it, expect, beforeEach } from "vitest";
import {
  DEPRECATED_MODELS,
  checkModelDeprecation,
  formatModelDeprecationWarning,
  maybeWarnDeprecatedModel,
  _warned,
} from "../model-deprecation.js";

describe("checkModelDeprecation", () => {
  it("flags an exact retired snapshot", () => {
    const info = checkModelDeprecation("claude-3-opus-20240229");
    expect(info).toBeTruthy();
    expect(info.id).toBe("claude-3-opus-20240229");
    expect(info.state).toBe("retired");
    expect(info.replacement).toMatch(/claude-opus-4-8/);
  });

  it("flags retired Claude 3.5 / 3.7 families by prefix (the common ones)", () => {
    expect(checkModelDeprecation("claude-3-5-sonnet-20240620")).toBeTruthy();
    expect(checkModelDeprecation("claude-3-5-sonnet-20241022")).toBeTruthy();
    expect(checkModelDeprecation("claude-3-5-haiku-20241022")).toBeTruthy();
    expect(checkModelDeprecation("claude-3-7-sonnet-20250219")).toBeTruthy();
    expect(checkModelDeprecation("claude-3-haiku-20240307")).toBeTruthy();
  });

  it("flags the retired ORIGINAL Claude 4 snapshots (exact dated id)", () => {
    expect(checkModelDeprecation("claude-opus-4-20250514").state).toBe(
      "retired",
    );
    expect(checkModelDeprecation("claude-sonnet-4-20250514").state).toBe(
      "retired",
    );
  });

  it("flags deprecated-but-live Claude Opus 4.1 with state=deprecated", () => {
    const info = checkModelDeprecation("claude-opus-4-1-20250805");
    expect(info).toBeTruthy();
    expect(info.state).toBe("deprecated");
  });

  it("prefix-matches a retired family (claude-2 → claude-2.1)", () => {
    expect(checkModelDeprecation("claude-2.1")).toBeTruthy();
    expect(checkModelDeprecation("claude-2.0")).toBeTruthy();
    expect(checkModelDeprecation("claude-instant-1.2")).toBeTruthy();
  });

  it("flags retired OpenAI snapshots", () => {
    expect(checkModelDeprecation("gpt-4-0314")).toBeTruthy();
    expect(checkModelDeprecation("gpt-4-32k-0613")).toBeTruthy();
    expect(checkModelDeprecation("gpt-3.5-turbo-0301")).toBeTruthy();
    expect(checkModelDeprecation("text-davinci-003")).toBeTruthy();
  });

  it("is case-insensitive and trims", () => {
    expect(checkModelDeprecation("  GPT-4-0314  ")).toBeTruthy();
    expect(checkModelDeprecation("Claude-2.1")).toBeTruthy();
  });

  it("CRITICAL: does NOT flag ACTIVE Claude 4 models (prefix-collision guard)", () => {
    // These share a prefix with the retired 4.x snapshots — the entries use
    // exact dated ids precisely so these stay silent.
    expect(checkModelDeprecation("claude-opus-4-8")).toBeNull();
    expect(checkModelDeprecation("claude-opus-4-7")).toBeNull();
    expect(checkModelDeprecation("claude-opus-4-6")).toBeNull();
    expect(checkModelDeprecation("claude-opus-4-5-20251101")).toBeNull();
    expect(checkModelDeprecation("claude-sonnet-4-6")).toBeNull();
    expect(checkModelDeprecation("claude-sonnet-4-5-20250929")).toBeNull();
    expect(checkModelDeprecation("claude-haiku-4-5-20251001")).toBeNull();
    expect(checkModelDeprecation("claude-haiku-4-5")).toBeNull();
  });

  it("does NOT flag other current GA / provider models", () => {
    expect(checkModelDeprecation("gpt-4o")).toBeNull();
    expect(checkModelDeprecation("gpt-4o-mini")).toBeNull();
    expect(checkModelDeprecation("gpt-5")).toBeNull();
    expect(checkModelDeprecation("gpt-4-turbo")).toBeNull();
    // provider-specific ids (volcengine/doubao/ollama) never match
    expect(checkModelDeprecation("doubao-seed-2-0-lite-260215")).toBeNull();
    expect(checkModelDeprecation("qwen2.5-coder:7b")).toBeNull();
  });

  it("handles empty / non-string input", () => {
    expect(checkModelDeprecation("")).toBeNull();
    expect(checkModelDeprecation(null)).toBeNull();
    expect(checkModelDeprecation(undefined)).toBeNull();
    expect(checkModelDeprecation(42)).toBeNull();
  });

  it("every list entry is internally consistent and self-matches", () => {
    for (const e of DEPRECATED_MODELS) {
      expect(typeof e.id).toBe("string");
      expect(e.id.length).toBeGreaterThan(0);
      expect(["retired", "deprecated"]).toContain(e.state);
      expect(typeof e.reason).toBe("string");
      expect(typeof e.replacement).toBe("string");
      expect(checkModelDeprecation(e.id)).toBeTruthy();
      // the recommended replacement must itself never be flagged as retired
      const firstReplacement = e.replacement.split(/\s+or\s+|\s+/)[0];
      expect(checkModelDeprecation(firstReplacement)).toBeNull();
    }
  });
});

describe("formatModelDeprecationWarning", () => {
  it("uses 'has been retired' for retired models", () => {
    const info = checkModelDeprecation("claude-3-5-sonnet-20241022");
    const line = formatModelDeprecationWarning(info);
    expect(line).toMatch(/claude-3-5-sonnet-20241022/);
    expect(line).toMatch(/has been retired/);
    expect(line).toMatch(/claude-sonnet-4-6/);
    expect(line).toMatch(/CC_MODEL_NOTICE=0/);
  });

  it("uses 'is deprecated' for deprecated-but-live models", () => {
    const info = checkModelDeprecation("claude-opus-4-1-20250805");
    const line = formatModelDeprecationWarning(info);
    expect(line).toMatch(/is deprecated/);
    expect(line).not.toMatch(/has been retired/);
  });
});

describe("maybeWarnDeprecatedModel", () => {
  let lines;
  let print;
  beforeEach(() => {
    _warned.clear();
    lines = [];
    print = (l) => lines.push(l);
  });

  it("warns once for a deprecated model", () => {
    const r = maybeWarnDeprecatedModel({ model: "claude-2.1", env: {}, print });
    expect(r.warned).toBe(true);
    expect(r.info.id).toBe("claude-2.1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/claude-2\.1/);
  });

  it("warns for a retired Claude 3.5 Sonnet (the common stale id)", () => {
    const r = maybeWarnDeprecatedModel({
      model: "claude-3-5-sonnet-20241022",
      env: {},
      print,
    });
    expect(r.warned).toBe(true);
    expect(lines[0]).toMatch(/has been retired/);
  });

  it("does not repeat the same model within a process", () => {
    maybeWarnDeprecatedModel({ model: "gpt-4-0314", env: {}, print });
    const r = maybeWarnDeprecatedModel({ model: "gpt-4-0314", env: {}, print });
    expect(r.warned).toBe(false);
    expect(r.info).toBeTruthy(); // still reports the match, just doesn't re-print
    expect(lines).toHaveLength(1);
  });

  it("stays silent for a current model", () => {
    const r = maybeWarnDeprecatedModel({
      model: "claude-opus-4-8",
      env: {},
      print,
    });
    expect(r.warned).toBe(false);
    expect(r.info).toBeNull();
    expect(lines).toHaveLength(0);
  });

  it("honors CC_MODEL_NOTICE=0", () => {
    const r = maybeWarnDeprecatedModel({
      model: "claude-2.1",
      env: { CC_MODEL_NOTICE: "0" },
      print,
    });
    expect(r.warned).toBe(false);
    expect(lines).toHaveLength(0);
  });

  it("fail-open on a throwing print", () => {
    const r = maybeWarnDeprecatedModel({
      model: "claude-2.1",
      env: {},
      print: () => {
        throw new Error("boom");
      },
    });
    expect(r.warned).toBe(false); // swallowed, no throw
  });

  it("no-ops on missing model", () => {
    expect(maybeWarnDeprecatedModel({ env: {}, print }).warned).toBe(false);
    expect(lines).toHaveLength(0);
  });
});
