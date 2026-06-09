/**
 * status-line — the built-in context-usage half ("上下文用量显示"): token
 * formatting, the enriched context shape, the default renderer, and explicit
 * `statusLine: false` disable detection. Complements status-line.test.js (which
 * covers the custom-command loader/renderer).
 */
import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import sl from "../../src/lib/status-line.cjs";

const {
  formatTokens,
  shortenPath,
  buildContext,
  renderDefaultStatusLine,
  isStatusLineDisabled,
  _deps,
} = sl;

describe("formatTokens", () => {
  it("passes small counts, k for thousands, M for millions", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12345)).toBe("12.3k");
    expect(formatTokens(8000)).toBe("8k");
    expect(formatTokens(128000)).toBe("128k");
    expect(formatTokens(1500000)).toBe("1.5M");
  });
  it("is safe on garbage", () => {
    expect(formatTokens(undefined)).toBe("0");
    expect(formatTokens(NaN)).toBe("0");
  });
});

describe("shortenPath", () => {
  it("collapses the home dir to ~", () => {
    const home = os.homedir();
    expect(shortenPath(home)).toBe("~");
    expect(shortenPath(home + "/p/x")).toBe("~/p/x");
  });
  it("leaves non-home paths unchanged", () => {
    expect(shortenPath("/var/tmp")).toBe("/var/tmp");
  });
});

describe("buildContext — context-usage enrichment", () => {
  it("adds context{used,window,pct} + turn, keeps prior fields", () => {
    const ctx = buildContext({
      sessionId: "S",
      model: "claude-opus-4-8",
      provider: "anthropic",
      cwd: "/p",
      usedTokens: 50000,
      contextWindow: 200000,
      turn: 3,
    });
    expect(ctx.context).toEqual({ used_tokens: 50000, window: 200000, pct: 25 });
    expect(ctx.turn).toBe(3);
    // backward-compatible fields the custom-command path relies on:
    expect(ctx.session_id).toBe("S");
    expect(ctx.model).toEqual({ id: "claude-opus-4-8", display_name: "claude-opus-4-8" });
  });
  it("pct is 0 with an unknown window, clamps at 100 over budget", () => {
    expect(buildContext({ cwd: "/", usedTokens: 9999, contextWindow: 0 }).context.pct).toBe(0);
    expect(buildContext({ cwd: "/", usedTokens: 300000, contextWindow: 200000 }).context.pct).toBe(100);
  });
});

describe("renderDefaultStatusLine", () => {
  it("renders model · usage · cwd · turn", () => {
    const ctx = buildContext({
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      cwd: "/var/proj",
      usedTokens: 12345,
      contextWindow: 200000,
      turn: 2,
    });
    const line = renderDefaultStatusLine(ctx);
    expect(line).toContain("claude-sonnet-4-6");
    expect(line).toContain("⛁ 12.3k/200k (6%)");
    expect(line).toContain("/var/proj");
    expect(line).toContain("turn 2");
    expect(line).toContain("·");
  });
  it("omits the window readout when the window is unknown", () => {
    const ctx = buildContext({ model: "qwen2.5:7b", provider: "ollama", cwd: "/x", contextWindow: 0 });
    const line = renderDefaultStatusLine(ctx);
    expect(line).toContain("qwen2.5:7b");
    expect(line).not.toContain("⛁");
  });
});

describe("isStatusLineDisabled", () => {
  beforeEach(() => {
    _deps.readSettings = () => _deps.__layers || [];
  });
  it("true only when the effective (last) layer sets statusLine:false", () => {
    _deps.__layers = [{ statusLine: "a.sh" }, { statusLine: false }];
    expect(isStatusLineDisabled({ cwd: "/x" })).toBe(true);
  });
  it("false when a later layer re-enables a command", () => {
    _deps.__layers = [{ statusLine: false }, { statusLine: "b.sh" }];
    expect(isStatusLineDisabled({ cwd: "/x" })).toBe(false);
  });
  it("false when statusLine is absent", () => {
    _deps.__layers = [{ model: "m" }];
    expect(isStatusLineDisabled({ cwd: "/x" })).toBe(false);
  });
});
