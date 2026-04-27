/**
 * chatPanelHelpers — pure-function unit tests
 *
 * Covers:
 *  - chatErrorMessage maps known substrings (timeout/network/auth/rate)
 *    to friendly Chinese messages, falls through to generic prefix
 *  - chatErrorMessage handles non-Error inputs (string / undefined)
 *  - formatChatTime handles number, ISO string, undefined, NaN
 */

import { describe, it, expect } from "vitest";
import {
  buildExportText,
  chatErrorMessage,
  extractRagContext,
  formatChatTime,
} from "../chatPanelHelpers";

describe("chatErrorMessage", () => {
  it("returns timeout-specific Chinese message", () => {
    expect(chatErrorMessage(new Error("request timeout after 30s"))).toMatch(
      /超时/,
    );
  });

  it("returns network-specific Chinese message", () => {
    expect(chatErrorMessage(new Error("network unreachable"))).toMatch(/网络/);
  });

  it("returns auth message for 401 or 'unauthorized'", () => {
    expect(chatErrorMessage(new Error("401 unauthorized"))).toMatch(/API 密钥/);
    expect(chatErrorMessage(new Error("unauthorized"))).toMatch(/API 密钥/);
  });

  it("returns rate-limit message for 'rate limit' substring", () => {
    expect(chatErrorMessage(new Error("rate limit exceeded"))).toMatch(
      /频率超限/,
    );
  });

  it("falls back to '发送失败: <msg>' for unknown errors", () => {
    expect(chatErrorMessage(new Error("disk full"))).toBe(
      "发送失败: disk full",
    );
  });

  it("handles plain-string input", () => {
    expect(chatErrorMessage("network broken")).toMatch(/网络/);
  });

  it("returns generic '发送失败' for empty / undefined input", () => {
    expect(chatErrorMessage(undefined)).toBe("发送失败");
    expect(chatErrorMessage(null)).toBe("发送失败");
    expect(chatErrorMessage(new Error(""))).toBe("发送失败");
  });
});

describe("formatChatTime", () => {
  it("formats unix-millis as HH:MM", () => {
    const ts = new Date("2026-04-28T03:07:00").getTime();
    const result = formatChatTime(ts);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("formats ISO string", () => {
    expect(formatChatTime("2026-04-28T15:42:00")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns empty string for undefined", () => {
    expect(formatChatTime(undefined)).toBe("");
  });

  it("returns empty string for NaN-producing input", () => {
    expect(formatChatTime("not-a-date")).toBe("");
  });

  it("zero-pads single-digit hours and minutes", () => {
    const d = new Date();
    d.setHours(3);
    d.setMinutes(7);
    const result = formatChatTime(d.getTime());
    expect(result).toBe("03:07");
  });
});

describe("buildExportText", () => {
  it("returns '(empty)' marker on no messages", () => {
    expect(buildExportText([])).toBe("(empty)");
    expect(buildExportText([], "Plain")).toBe("# Plain\n\n(empty)");
  });

  it("formats messages with role + timestamp + content", () => {
    const messages = [
      { role: "user", content: "hi", timestamp: 1700000000000 },
      { role: "assistant", content: "hello!", timestamp: 1700000010000 },
    ];
    const out = buildExportText(messages, "T");
    expect(out).toContain("# T");
    expect(out).toContain("[我]");
    expect(out).toContain("[AI]");
    expect(out).toContain("hi");
    expect(out).toContain("hello!");
    expect(out).toContain("---");
  });

  it("omits timestamp when missing", () => {
    const out = buildExportText([{ role: "user", content: "x" }]);
    expect(out).toMatch(/^\[我\]\nx\n$/);
  });

  it("treats unknown role as AI", () => {
    expect(buildExportText([{ role: "system", content: "s" }])).toContain(
      "[AI]",
    );
  });

  it("handles missing content as empty string (no crash)", () => {
    expect(() =>
      buildExportText([{ role: "user", timestamp: 1700000000000 }]),
    ).not.toThrow();
  });
});

describe("extractRagContext", () => {
  it("returns fallback when rag is null/undefined", () => {
    expect(extractRagContext(null, "orig")).toEqual({
      prompt: "orig",
      retrievedDocs: [],
    });
    expect(extractRagContext(undefined, "orig")).toEqual({
      prompt: "orig",
      retrievedDocs: [],
    });
  });

  it("returns fallback when context is empty / whitespace", () => {
    expect(extractRagContext({ context: "" }, "orig").prompt).toBe("orig");
    expect(extractRagContext({ context: "   " }, "orig").prompt).toBe("orig");
  });

  it("uses rag context + retrieved docs when present", () => {
    const result = extractRagContext(
      {
        context: "Enriched context",
        retrievedDocs: [{ id: "doc1", title: "Note 1", score: 0.92 }],
      },
      "orig",
    );
    expect(result.prompt).toBe("Enriched context");
    expect(result.retrievedDocs).toHaveLength(1);
    expect(result.retrievedDocs[0].id).toBe("doc1");
  });

  it("normalizes non-array retrievedDocs to []", () => {
    const result = extractRagContext(
      { context: "ctx", retrievedDocs: undefined },
      "orig",
    );
    expect(result.retrievedDocs).toEqual([]);
  });
});
