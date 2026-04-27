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
import { chatErrorMessage, formatChatTime } from "../chatPanelHelpers";

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
