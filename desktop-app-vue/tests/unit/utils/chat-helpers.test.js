/**
 * chatHelpers 测试 — src/renderer/utils/chatHelpers.ts
 *
 * 覆盖纯函数：
 *  - sanitizeJSONString（控制字符清理，保留合法空白）
 *  - cleanForIPC（JSON 往返 + 循环引用/函数/symbol/undefined 兜底清理）
 *  - renderMarkdown（marked + DOMPurify 防 XSS）
 *  - formatTime（相对/绝对时间格式化）
 *  - getEmptyStateText / getEmptyHint / getInputPlaceholder / getContextInfo
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  sanitizeJSONString,
  cleanForIPC,
  renderMarkdown,
  formatTime,
  getEmptyStateText,
  getEmptyHint,
  getInputPlaceholder,
  getContextInfo,
} from "@/utils/chatHelpers";

describe("sanitizeJSONString", () => {
  it("strips harmful control chars but keeps tab/newline/CR", () => {
    const input = "a\x00b\x07c\tline1\nline2\rd\x1Fe";
    const out = sanitizeJSONString(input);
    expect(out).toBe("abc\tline1\nline2\rde");
  });

  it("passes through null/undefined/non-string unchanged", () => {
    expect(sanitizeJSONString(null)).toBeNull();
    expect(sanitizeJSONString(undefined)).toBeUndefined();
    expect(sanitizeJSONString(123)).toBe(123);
  });
});

describe("cleanForIPC", () => {
  it("round-trips a plain object and drops undefined", () => {
    expect(cleanForIPC({ a: 1, b: { c: 2 }, u: undefined })).toEqual({
      a: 1,
      b: { c: 2 },
    });
  });

  it("handles a circular reference + strips functions/symbols/undefined", () => {
    const o = { a: 1, fn: () => {}, sym: Symbol("x"), u: undefined };
    o.self = o;
    const r = cleanForIPC(o);
    expect(r.a).toBe(1);
    expect(r.self).toBe("[Circular]");
    expect("fn" in r).toBe(false);
    expect("sym" in r).toBe(false);
    expect("u" in r).toBe(false);
  });
});

describe("renderMarkdown", () => {
  it("renders markdown to HTML", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
  });

  it("extracts .text/.content from an object payload", () => {
    expect(renderMarkdown({ text: "hi *there*" })).toContain("<em>there</em>");
  });

  it("sanitizes XSS from untrusted markdown", () => {
    const out = renderMarkdown("<script>alert(1)</script>ok");
    expect(out).not.toContain("<script");
  });

  it("returns empty string for null", () => {
    expect(renderMarkdown(null)).toBe("");
  });
});

describe("formatTime", () => {
  it("returns empty string for falsy input", () => {
    expect(formatTime(null)).toBe("");
    expect(formatTime(undefined)).toBe("");
    expect(formatTime(0)).toBe("");
  });

  it("uses relative phrasing for recent timestamps", () => {
    expect(formatTime(Date.now() - 30_000)).toBe("刚刚");
    expect(formatTime(Date.now() - 5 * 60_000)).toBe("5分钟前");
    expect(formatTime(Date.now() - 2 * 3_600_000)).toBe("2小时前");
  });

  it("uses an absolute date for old timestamps", () => {
    const out = formatTime(Date.now() - 3 * 86_400_000);
    expect(out).not.toMatch(/刚刚|分钟前|小时前/);
    expect(out).toMatch(/\d/);
  });
});

describe("context-mode string helpers", () => {
  const file = { file_name: "main.ts" };

  it("getEmptyStateText maps the mode", () => {
    expect(getEmptyStateText("project")).toBe("项目 AI 助手");
    expect(getEmptyStateText("file")).toBe("文件 AI 助手");
    expect(getEmptyStateText("global")).toBe("AI 助手");
  });

  it("getEmptyHint reflects mode + file presence", () => {
    expect(getEmptyHint("project", null)).toContain("项目相关问题");
    expect(getEmptyHint("file", file)).toContain("main.ts");
    expect(getEmptyHint("file", null)).toContain("请先从左侧选择");
    expect(getEmptyHint("global", null)).toBe("开始新对话");
  });

  it("getInputPlaceholder reflects mode + file presence", () => {
    expect(getInputPlaceholder("project", null)).toContain("项目相关问题");
    expect(getInputPlaceholder("file", file)).toContain("main.ts");
    expect(getInputPlaceholder("file", null)).toContain("请先选择一个文件");
    expect(getInputPlaceholder("global", null)).toBe("输入消息...");
  });

  it("getContextInfo returns null for global, text otherwise", () => {
    expect(getContextInfo("project", null)).toContain("整个项目");
    expect(getContextInfo("file", file)).toContain("main.ts");
    expect(getContextInfo("file", null)).toContain("请先选择");
    expect(getContextInfo("global", null)).toBeNull();
  });
});
