import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../chatHelpers";

describe("renderMarkdown", () => {
  it("renders plain markdown to HTML", () => {
    const html = renderMarkdown("**bold**");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("strips <script> tags injected via raw HTML in markdown", () => {
    const html = renderMarkdown("hello<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
  });

  it("strips inline onerror handlers injected via raw HTML", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    // DOMPurify strips the onerror attribute entirely.
    expect(html).not.toMatch(/onerror=/i);
    expect(html).not.toContain("alert(1)");
  });

  it("strips javascript: URLs in links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:alert");
  });

  it("returns empty string for null/undefined", () => {
    expect(renderMarkdown(null)).toBe("");
    expect(renderMarkdown(undefined)).toBe("");
  });

  it("handles object input by extracting text/content field", () => {
    expect(renderMarkdown({ text: "**bold**" } as unknown as string)).toContain(
      "<strong>bold</strong>",
    );
    expect(
      renderMarkdown({ content: "*italic*" } as unknown as string),
    ).toContain("<em>italic</em>");
  });
});
