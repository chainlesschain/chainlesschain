import { describe, it, expect } from "vitest";
import {
  escapeMarkdownV2,
  toTelegramMarkdown,
  formatForTelegram,
} from "../../src/gateways/telegram/telegram-formatter.js";

describe("escapeMarkdownV2", () => {
  it("escapes MarkdownV2 special characters", () => {
    expect(escapeMarkdownV2("a.b-c!")).toBe("a\\.b\\-c\\!");
    expect(escapeMarkdownV2("(x)[y]")).toBe("\\(x\\)\\[y\\]");
  });
  it("returns empty string for falsy", () => {
    expect(escapeMarkdownV2("")).toBe("");
    expect(escapeMarkdownV2(null)).toBe("");
  });
});

describe("toTelegramMarkdown — code blocks preserve $ sequences", () => {
  it("keeps $&, $1, $$ literally inside a fenced code block", () => {
    const out = toTelegramMarkdown('run:\n```\nsed "s/x/$&/" f\n```\nend');
    expect(out).toContain("$&"); // not eaten by String.replace patterns
    expect(out).not.toMatch(/CODE_?BLOCK/); // no placeholder leaked into code
  });

  it("keeps $ sequences literally inside inline code", () => {
    const out = toTelegramMarkdown("inline `echo $HOME $1 $$` text");
    expect(out).toContain("$HOME");
    expect(out).toContain("$1");
    expect(out).toContain("$$");
    expect(out).not.toMatch(/INLINE_?CODE/);
  });

  it("still escapes special characters in ordinary (non-code) text", () => {
    const out = toTelegramMarkdown("a.b-c! plain");
    expect(out).toContain("\\.");
    expect(out).toContain("\\-");
    expect(out).toContain("\\!");
  });

  it("preserves multiple distinct code blocks", () => {
    const out = toTelegramMarkdown("```\n$1\n```\nmid\n```\n$2\n```");
    expect(out).toContain("$1");
    expect(out).toContain("$2");
  });

  it("returns empty string for falsy input", () => {
    expect(toTelegramMarkdown("")).toBe("");
  });
});

describe("formatForTelegram", () => {
  it("converts headers and bold, truncates over-long text", () => {
    expect(formatForTelegram("# Title")).toBe("*Title*");
    expect(formatForTelegram("**bold**")).toBe("*bold*");
    const long = formatForTelegram("x".repeat(5000), { maxLength: 100 });
    expect(long.length).toBe(100);
    expect(long.endsWith("...")).toBe(true);
  });
});
