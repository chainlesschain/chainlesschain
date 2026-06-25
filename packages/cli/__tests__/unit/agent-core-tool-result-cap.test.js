/**
 * Per-tool-result truncation (capToolResultString) — the safety net that keeps
 * one giant tool output from blowing the context, now with a VISIBLE marker
 * (the old code silently sliced to 5000 chars mid-content, undercutting even
 * read_file's own 50k self-limit and never telling the model it was cut).
 */
import { describe, it, expect } from "vitest";
import {
  capToolResultString,
  MAX_TOOL_RESULT_CHARS,
  safeStringifyToolResult,
} from "../../src/runtime/agent-core.js";

describe("capToolResultString", () => {
  it("returns short results unchanged (no marker)", () => {
    const s = JSON.stringify({ content: "hello world" });
    expect(capToolResultString(s)).toBe(s);
    expect(capToolResultString(s)).not.toMatch(/truncated/);
  });

  it("passes a result exactly at the cap through untouched", () => {
    const s = "x".repeat(MAX_TOOL_RESULT_CHARS);
    expect(capToolResultString(s)).toBe(s);
  });

  it("truncates an oversized result and appends a visible marker with sizes", () => {
    const big = "y".repeat(MAX_TOOL_RESULT_CHARS + 5000);
    const out = capToolResultString(big);
    expect(out.startsWith("y".repeat(MAX_TOOL_RESULT_CHARS))).toBe(true);
    expect(out).toMatch(/tool output truncated/);
    expect(out).toContain(String(MAX_TOOL_RESULT_CHARS)); // shown count
    expect(out).toContain(String(MAX_TOOL_RESULT_CHARS + 5000)); // original length
    // the kept content is exactly `max` chars before the marker
    expect(out.slice(0, MAX_TOOL_RESULT_CHARS)).toBe(
      "y".repeat(MAX_TOOL_RESULT_CHARS),
    );
  });

  it("honors an explicit max argument", () => {
    expect(capToolResultString("abcdefgh", 4)).toMatch(/^abcd\n…\[tool output/);
    expect(capToolResultString("abc", 4)).toBe("abc");
  });

  it("default cap is generous enough not to undercut read_file's 50k self-limit", () => {
    // read_file caps its own content at 50000 + marker; the generic net must be
    // at least that so it stops silently re-truncating to a tiny window.
    expect(MAX_TOOL_RESULT_CHARS).toBeGreaterThanOrEqual(50000);
  });

  it("coerces a non-string input without throwing", () => {
    expect(capToolResultString(undefined)).toBe("");
    expect(capToolResultString(null)).toBe("");
    expect(capToolResultString(12345)).toBe("12345");
  });
});

describe("safeStringifyToolResult", () => {
  it("matches JSON.stringify on the happy path", () => {
    const v = { content: "ok", n: 1, arr: [1, 2], nested: { a: true } };
    expect(safeStringifyToolResult(v)).toBe(JSON.stringify(v));
    expect(safeStringifyToolResult("plain")).toBe('"plain"');
    expect(safeStringifyToolResult(undefined)).toBe(undefined); // as JSON.stringify
  });

  it("does not throw on a circular reference (recovers with [Circular])", () => {
    const a = { name: "node" };
    a.self = a; // circular — plain JSON.stringify throws here
    let out;
    expect(() => {
      out = safeStringifyToolResult(a);
    }).not.toThrow();
    expect(out).toContain("node");
    expect(out).toContain("[Circular]");
  });

  it("does not throw on a BigInt (serializes it as a string)", () => {
    let out;
    expect(() => {
      out = safeStringifyToolResult({ big: 10n, ok: 1 });
    }).not.toThrow();
    expect(out).toContain("10");
  });

  it("does not throw when a value's toJSON throws (last-resort string)", () => {
    const bad = {
      toJSON() {
        throw new Error("boom");
      },
    };
    let out;
    expect(() => {
      out = safeStringifyToolResult(bad);
    }).not.toThrow();
    expect(typeof out).toBe("string");
  });

  it("feeds cleanly into capToolResultString (the real call chain)", () => {
    const a = {};
    a.loop = a;
    expect(() => capToolResultString(safeStringifyToolResult(a))).not.toThrow();
  });
});
