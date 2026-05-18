/**
 * markdown-renderer 单元测试 — Phase 3c.2
 *
 * 验证文件名与 markdown 渲染的稳定输出，确保多 provider 同时启用时
 * 远端文件结构一致（与 git/markdown-exporter.js 兼容）。
 */

import { describe, it, expect } from "vitest";

const {
  generateFilename,
  generateMarkdown,
  FILENAME_TITLE_MAX,
} = require("../markdown-renderer");

describe("markdown-renderer · generateFilename", () => {
  it("uses id-cleanTitle.md format", () => {
    expect(generateFilename({ id: "abc", title: "Hello" })).toBe(
      "abc-Hello.md",
    );
  });

  it("replaces invalid Windows path chars with -", () => {
    expect(generateFilename({ id: "1", title: 'a<b>c:d"e/f\\g|h?i*j' })).toBe(
      "1-a-b-c-d-e-f-g-h-i-j.md",
    );
  });

  it("collapses whitespace into single -", () => {
    expect(generateFilename({ id: "1", title: "hello   world\ttab" })).toBe(
      "1-hello-world-tab.md",
    );
  });

  it("truncates titles to 50 chars", () => {
    const longTitle = "x".repeat(80);
    const out = generateFilename({ id: "1", title: longTitle });
    // out is `1-${50 chars}.md`
    expect(out.length).toBe(2 + FILENAME_TITLE_MAX + 3); // "1-" + 50 + ".md"
  });

  it("handles empty title", () => {
    expect(generateFilename({ id: "1", title: "" })).toBe("1-.md");
  });

  it("handles missing title gracefully", () => {
    expect(generateFilename({ id: "1" })).toBe("1-.md");
  });
});

describe("markdown-renderer · generateMarkdown", () => {
  const baseItem = {
    id: "item-1",
    title: "测试笔记",
    type: "note",
    content: "这是正文",
    created_at: 1700000000000,
    updated_at: 1700000001000,
  };

  it("emits YAML front-matter with required fields", () => {
    const md = generateMarkdown(baseItem);
    expect(md).toContain("---\nid: item-1");
    expect(md).toContain("title: 测试笔记");
    expect(md).toContain("type: note");
    expect(md).toContain("created_at: 1700000000000");
    expect(md).toContain("updated_at: 1700000001000");
  });

  it("includes h1 title and body content", () => {
    const md = generateMarkdown(baseItem);
    expect(md).toContain("# 测试笔记");
    expect(md).toContain("这是正文");
  });

  it("emits 元数据 trailer", () => {
    const md = generateMarkdown(baseItem);
    expect(md).toContain("## 元数据");
    expect(md).toContain("- **类型**: note");
  });

  it("includes tags when array is non-empty", () => {
    const md = generateMarkdown({ ...baseItem, tags: ["a", "b"] });
    expect(md).toContain("tags: [a, b]");
    expect(md).toContain("- **标签**: a, b");
  });

  it("omits tags line when array is empty or missing", () => {
    const md1 = generateMarkdown(baseItem);
    expect(md1).not.toContain("tags:");
    const md2 = generateMarkdown({ ...baseItem, tags: [] });
    expect(md2).not.toContain("tags:");
  });

  it("includes source_url when present", () => {
    const md = generateMarkdown({
      ...baseItem,
      source_url: "https://example.com/x",
    });
    expect(md).toContain("source_url: https://example.com/x");
    expect(md).toContain(
      "- **来源**: [https://example.com/x](https://example.com/x)",
    );
  });

  it("handles missing content gracefully", () => {
    const md = generateMarkdown({ ...baseItem, content: null });
    expect(md).toContain("# 测试笔记");
    expect(md).toContain("## 元数据");
  });

  it("output is deterministic given same input (line-stable)", () => {
    const a = generateMarkdown(baseItem);
    const b = generateMarkdown(baseItem);
    expect(a).toBe(b);
  });
});
