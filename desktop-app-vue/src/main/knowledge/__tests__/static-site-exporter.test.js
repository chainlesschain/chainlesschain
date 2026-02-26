/**
 * StaticSiteExporter unit tests
 *
 * Note: Due to CJS/ESM interop issues with vi.mock('fs'), we test
 * exportToStaticSite() by spying on internal methods rather than
 * asserting on fs mock calls directly. Pure helper methods are tested
 * directly without needing fs mocks.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Mock fs — the source uses require('fs') (CJS). Due to known vitest CJS interop
// issues, we also mock 'node:fs' and provide both named + default exports.
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("fs", () => ({ ...mockFs, default: mockFs }));
vi.mock("node:fs", () => ({ ...mockFs, default: mockFs }));

function createMockDatabase(notes = []) {
  const prepResult = {
    all: vi.fn().mockReturnValue(notes),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    db: {
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
  };
}

import { StaticSiteExporter } from "../static-site-exporter.js";

describe("StaticSiteExporter", () => {
  let exporter;
  let mockDb;
  const sampleNotes = [
    {
      id: "note-1",
      title: "First Note",
      content: "# Hello\n\nWorld",
      folder: "General",
      tags: '["tag1"]',
      updated_at: 1700000000000,
      created_at: 1690000000000,
    },
    {
      id: "note-2",
      title: "Second Note",
      content: "**Bold text**",
      folder: "General",
      tags: '["tag2","tag3"]',
      updated_at: 1700100000000,
      created_at: 1690100000000,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockDb = createMockDatabase(sampleNotes);
    exporter = new StaticSiteExporter(mockDb);
  });

  describe("constructor", () => {
    it("should store database reference", () => {
      expect(exporter.database).toBe(mockDb);
    });
  });

  describe("exportToStaticSite()", () => {
    it("should handle empty notes gracefully", async () => {
      const emptyDb = createMockDatabase([]);
      const emptyExporter = new StaticSiteExporter(emptyDb);

      const result = await emptyExporter.exportToStaticSite("/output/site");

      expect(result.exported).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should filter by folder when specified", async () => {
      await exporter.exportToStaticSite("/output/site", { folder: "General" });

      const prepCall = mockDb.db.prepare.mock.calls[0][0];
      expect(prepCall).toContain("WHERE folder = ?");
    });

    it("should return correct result object", async () => {
      const result = await exporter.exportToStaticSite("/output/site", {
        title: "Test Site",
      });

      expect(result.exported).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(result.outputDir).toBe("/output/site");
    });

    it("should handle note page generation errors", async () => {
      const origGenerate = exporter._generateNotePage.bind(exporter);
      let callNum = 0;
      exporter._generateNotePage = (...args) => {
        callNum++;
        if (callNum === 2) {
          throw new Error("Render failed");
        }
        return origGenerate(...args);
      };

      const result = await exporter.exportToStaticSite("/output/site");

      expect(result.exported).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].noteId).toBe("note-2");
    });

    it("should call _fetchNotes with null when no folder", async () => {
      const spy = vi.spyOn(exporter, "_fetchNotes");
      await exporter.exportToStaticSite("/output/site");
      expect(spy).toHaveBeenCalledWith(null);
    });

    it("should call _fetchNotes with folder when specified", async () => {
      const spy = vi.spyOn(exporter, "_fetchNotes");
      await exporter.exportToStaticSite("/output/site", { folder: "Work" });
      expect(spy).toHaveBeenCalledWith("Work");
    });

    it("should call _generateIndexPage with correct params", async () => {
      const spy = vi.spyOn(exporter, "_generateIndexPage");
      await exporter.exportToStaticSite("/output/site", {
        title: "My Site",
        theme: "dark",
      });
      expect(spy).toHaveBeenCalledWith("My Site", sampleNotes, "dark");
    });

    it("should call _generateNotePage for each note", async () => {
      const spy = vi.spyOn(exporter, "_generateNotePage");
      await exporter.exportToStaticSite("/output/site");
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("should call _generateCSS with theme", async () => {
      const spy = vi.spyOn(exporter, "_generateCSS");
      await exporter.exportToStaticSite("/output/site", { theme: "dark" });
      expect(spy).toHaveBeenCalledWith("dark");
    });

    it("should use default options when none specified", async () => {
      const indexSpy = vi.spyOn(exporter, "_generateIndexPage");
      const cssSpy = vi.spyOn(exporter, "_generateCSS");
      await exporter.exportToStaticSite("/output/site");
      expect(indexSpy).toHaveBeenCalledWith(
        "My Knowledge Base",
        sampleNotes,
        "light",
      );
      expect(cssSpy).toHaveBeenCalledWith("light");
    });
  });

  describe("_generateIndexPage()", () => {
    it("should generate valid HTML with DOCTYPE", () => {
      const html = exporter._generateIndexPage(
        "Test Site",
        sampleNotes,
        "light",
      );
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
    });

    it("should include site title", () => {
      const html = exporter._generateIndexPage(
        "My Knowledge Base",
        sampleNotes,
        "light",
      );
      expect(html).toContain("My Knowledge Base");
    });

    it("should include note count", () => {
      const html = exporter._generateIndexPage("Site", sampleNotes, "light");
      expect(html).toContain("2 notes");
    });

    it("should include links to note pages", () => {
      const html = exporter._generateIndexPage("Site", sampleNotes, "light");
      expect(html).toContain("First Note");
      expect(html).toContain("Second Note");
      expect(html).toContain(".html");
    });

    it("should set theme attribute", () => {
      const html = exporter._generateIndexPage("Site", sampleNotes, "dark");
      expect(html).toContain('data-theme="dark"');
    });

    it("should include tags", () => {
      const html = exporter._generateIndexPage("Site", sampleNotes, "light");
      expect(html).toContain("tag1");
    });
  });

  describe("_generateNotePage()", () => {
    it("should generate valid HTML for a note", () => {
      const html = exporter._generateNotePage("Site", sampleNotes[0], "light");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("First Note");
    });

    it("should include back link to index", () => {
      const html = exporter._generateNotePage("Site", sampleNotes[0], "light");
      expect(html).toContain("index.html");
    });

    it("should render note content as HTML", () => {
      const html = exporter._generateNotePage("Site", sampleNotes[0], "light");
      expect(html).toContain("<h1>Hello</h1>");
    });

    it("should include site title in page title", () => {
      const html = exporter._generateNotePage(
        "My Site",
        sampleNotes[0],
        "light",
      );
      expect(html).toContain("First Note - My Site");
    });
  });

  describe("_markdownToHtml()", () => {
    it("should convert headers", () => {
      expect(exporter._markdownToHtml("# Title")).toContain("<h1>Title</h1>");
      expect(exporter._markdownToHtml("## Subtitle")).toContain(
        "<h2>Subtitle</h2>",
      );
      expect(exporter._markdownToHtml("### Section")).toContain(
        "<h3>Section</h3>",
      );
    });

    it("should convert bold and italic", () => {
      expect(exporter._markdownToHtml("**bold**")).toContain(
        "<strong>bold</strong>",
      );
      expect(exporter._markdownToHtml("*italic*")).toContain("<em>italic</em>");
    });

    it("should convert code blocks", () => {
      const md = "```js\nconst x = 1;\n```";
      const html = exporter._markdownToHtml(md);
      expect(html).toContain("<pre><code");
      expect(html).toContain("language-js");
    });

    it("should convert inline code", () => {
      expect(exporter._markdownToHtml("use `npm install`")).toContain(
        "<code>npm install</code>",
      );
    });

    it("should return empty string for falsy input", () => {
      expect(exporter._markdownToHtml("")).toBe("");
      expect(exporter._markdownToHtml(null)).toBe("");
      expect(exporter._markdownToHtml(undefined)).toBe("");
    });
  });

  describe("_slugify()", () => {
    it("should convert to lowercase with hyphens", () => {
      expect(exporter._slugify("Hello World")).toBe("hello-world");
    });

    it("should handle special characters", () => {
      expect(exporter._slugify("Note #1: Test!")).toBe("note-1-test");
    });

    it("should preserve Chinese characters", () => {
      const slug = exporter._slugify("Chinese");
      expect(slug).toBe("chinese");
    });

    it("should trim leading/trailing hyphens", () => {
      expect(exporter._slugify("--hello--")).toBe("hello");
    });

    it('should return "untitled" for empty result', () => {
      expect(exporter._slugify("---")).toBe("untitled");
    });

    it("should truncate long slugs to 80 chars", () => {
      const longTitle = "a".repeat(100);
      expect(exporter._slugify(longTitle).length).toBeLessThanOrEqual(80);
    });
  });

  describe("_escapeHtml()", () => {
    it("should escape ampersand", () => {
      expect(exporter._escapeHtml("A & B")).toBe("A &amp; B");
    });

    it("should escape angle brackets", () => {
      expect(exporter._escapeHtml("<script>")).toBe("&lt;script&gt;");
    });

    it("should escape double quotes", () => {
      expect(exporter._escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
    });

    it("should return empty string for falsy input", () => {
      expect(exporter._escapeHtml(null)).toBe("");
      expect(exporter._escapeHtml("")).toBe("");
      expect(exporter._escapeHtml(undefined)).toBe("");
    });
  });

  describe("_generateCSS()", () => {
    it("should return light theme by default", () => {
      const css = exporter._generateCSS("light");
      expect(css).toContain("#ffffff");
      expect(css).toContain("#333333");
    });

    it("should return dark theme when specified", () => {
      const css = exporter._generateCSS("dark");
      expect(css).toContain("#1a1a2e");
      expect(css).toContain("#e0e0e0");
      expect(css).toContain("#16213e");
    });

    it("should always include accent color", () => {
      const lightCss = exporter._generateCSS("light");
      const darkCss = exporter._generateCSS("dark");
      expect(lightCss).toContain("#4a90d9");
      expect(darkCss).toContain("#4a90d9");
    });
  });

  describe("_fetchNotes()", () => {
    it("should query all notes without folder filter", () => {
      exporter._fetchNotes(null);

      const query = mockDb.db.prepare.mock.calls[0][0];
      expect(query).toContain("SELECT * FROM notes");
      expect(query).not.toContain("WHERE");
    });

    it("should filter by folder when provided", () => {
      exporter._fetchNotes("Work");

      const query = mockDb.db.prepare.mock.calls[0][0];
      expect(query).toContain("WHERE folder = ?");
      expect(mockDb.db._prep.all).toHaveBeenCalledWith("Work");
    });
  });
});
