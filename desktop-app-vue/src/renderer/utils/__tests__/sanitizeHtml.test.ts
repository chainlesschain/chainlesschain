import { describe, it, expect } from "vitest";
import { safeHtml, escapeHtml, escapeRegExp } from "../sanitizeHtml";

describe("safeHtml", () => {
  it("returns empty string for null/undefined", () => {
    expect(safeHtml(null)).toBe("");
    expect(safeHtml(undefined)).toBe("");
  });

  it("preserves benign HTML tags", () => {
    expect(safeHtml("<p>hello <strong>world</strong></p>")).toContain(
      "<strong>world</strong>",
    );
  });

  it("strips <script> tags", () => {
    const evil = "<p>hi</p><script>alert(1)</script>";
    const cleaned = safeHtml(evil);
    expect(cleaned).not.toContain("<script>");
    expect(cleaned).not.toContain("alert");
  });

  it("strips inline event handlers", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const cleaned = safeHtml(evil);
    expect(cleaned).not.toContain("onerror");
  });

  it("strips javascript: URLs", () => {
    const evil = '<a href="javascript:alert(1)">click</a>';
    const cleaned = safeHtml(evil);
    expect(cleaned).not.toContain("javascript:");
  });

  it("textOnly returns only text", () => {
    expect(safeHtml("<b>bold</b> text", { textOnly: true })).toBe("bold text");
  });
});

describe("escapeHtml", () => {
  it("returns empty string for null/undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("escapes all 5 XSS-relevant characters", () => {
    expect(escapeHtml(`<script>"it's"&</script>`)).toBe(
      "&lt;script&gt;&quot;it&#39;s&quot;&amp;&lt;/script&gt;",
    );
  });

  it("returns plain text unchanged when no special chars", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("escapeRegExp", () => {
  it("escapes regex special characters", () => {
    expect(escapeRegExp("a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o")).toBe(
      "a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o",
    );
  });

  it("returns plain text unchanged when no special chars", () => {
    expect(escapeRegExp("hello")).toBe("hello");
  });
});
