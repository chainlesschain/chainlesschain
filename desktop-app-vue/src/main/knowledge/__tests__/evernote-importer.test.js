/**
 * EvernoteImporter unit tests
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Note: uuid mock may not intercept require('uuid') due to CJS/ESM interop

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
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

import { EvernoteImporter } from "../evernote-importer.js";

describe("EvernoteImporter", () => {
  let importer;
  let mockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    importer = new EvernoteImporter(mockDb);
  });

  describe("constructor", () => {
    it("should store database reference", () => {
      expect(importer.database).toBe(mockDb);
    });
  });

  describe("importFromEnex()", () => {
    const sampleEnex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>First Note</title>
    <content><![CDATA[<en-note><h1>Hello</h1><p>World</p></en-note>]]></content>
    <created>20230515T120000Z</created>
    <updated>20230516T140000Z</updated>
    <tag>work</tag>
    <tag>important</tag>
  </note>
  <note>
    <title>Second Note</title>
    <content><![CDATA[<en-note><p>Simple note</p></en-note>]]></content>
    <created>20230601T080000Z</created>
    <tag>personal</tag>
    <resource><data encoding="base64">abc123</data></resource>
  </note>
</en-export>`;

    it("should parse valid ENEX XML with notes", async () => {
      const result = await importer.importFromEnex(sampleEnex);

      expect(result.imported).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle Buffer input", async () => {
      const buffer = Buffer.from(sampleEnex, "utf8");
      const result = await importer.importFromEnex(buffer);

      expect(result.imported).toBe(2);
    });

    it("should extract tags from ENEX", async () => {
      await importer.importFromEnex(sampleEnex);

      // First note should have 'work' and 'important' tags
      const firstCall = mockDb.db._prep.run.mock.calls[0];
      const tags = JSON.parse(firstCall[4]); // 5th arg is tags JSON
      expect(tags).toContain("work");
      expect(tags).toContain("important");
    });

    it("should count resources/attachments", async () => {
      const result = await importer.importFromEnex(sampleEnex);

      expect(result.attachments).toBe(1); // Second note has 1 resource
    });

    it("should handle errors per note without stopping import", async () => {
      // Mock prepare to throw on second call
      let callCount = 0;
      mockDb.db._prep.run.mockImplementation((...args) => {
        callCount++;
        if (callCount === 2) {
          throw new Error("DB write failed");
        }
      });

      const result = await importer.importFromEnex(sampleEnex);

      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].title).toBe("Second Note");
      expect(result.errors[0].error).toBe("DB write failed");
    });

    it("should use provided targetFolder", async () => {
      await importer.importFromEnex(sampleEnex, "Custom Folder");

      const firstCall = mockDb.db._prep.run.mock.calls[0];
      expect(firstCall[3]).toBe("Custom Folder");
    });

    it("should use default folder when not specified", async () => {
      await importer.importFromEnex(sampleEnex);

      const firstCall = mockDb.db._prep.run.mock.calls[0];
      expect(firstCall[3]).toBe("Evernote Import");
    });

    it("should handle empty ENEX content", async () => {
      const result = await importer.importFromEnex("<en-export></en-export>");

      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("_parseEnexXml()", () => {
    it("should extract title, content, dates, and tags", () => {
      const xml = `<note>
        <title>Test Title</title>
        <content>Test content</content>
        <created>20230101T000000Z</created>
        <updated>20230102T000000Z</updated>
        <tag>alpha</tag>
        <tag>beta</tag>
      </note>`;

      const notes = importer._parseEnexXml(xml);

      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe("Test Title");
      expect(notes[0].content).toBe("Test content");
      expect(notes[0].created).toBe("20230101T000000Z");
      expect(notes[0].updated).toBe("20230102T000000Z");
      expect(notes[0].tags).toEqual(["alpha", "beta"]);
    });

    it('should use "Untitled" when title is missing', () => {
      const xml = "<note><content>No title here</content></note>";
      const notes = importer._parseEnexXml(xml);

      expect(notes[0].title).toBe("Untitled");
    });

    it("should count resources", () => {
      const xml =
        "<note><title>T</title><content>C</content><resource></resource><resource></resource></note>";
      const notes = importer._parseEnexXml(xml);

      expect(notes[0].resources).toHaveLength(2);
    });

    it("should handle multiple notes", () => {
      const xml =
        "<note><title>A</title><content>1</content></note><note><title>B</title><content>2</content></note>";
      const notes = importer._parseEnexXml(xml);

      expect(notes).toHaveLength(2);
      expect(notes[0].title).toBe("A");
      expect(notes[1].title).toBe("B");
    });
  });

  describe("_enmlToMarkdown()", () => {
    it("should convert headers", () => {
      expect(importer._enmlToMarkdown("<h1>Title</h1>")).toContain("# Title");
      expect(importer._enmlToMarkdown("<h2>Subtitle</h2>")).toContain(
        "## Subtitle",
      );
      expect(importer._enmlToMarkdown("<h3>Section</h3>")).toContain(
        "### Section",
      );
    });

    it("should convert bold and italic", () => {
      expect(importer._enmlToMarkdown("<b>bold</b>")).toContain("**bold**");
      expect(importer._enmlToMarkdown("<strong>strong</strong>")).toContain(
        "**strong**",
      );
      expect(importer._enmlToMarkdown("<i>italic</i>")).toContain("*italic*");
      expect(importer._enmlToMarkdown("<em>emphasis</em>")).toContain(
        "*emphasis*",
      );
    });

    it("should convert links", () => {
      const result = importer._enmlToMarkdown(
        '<a href="https://example.com">Example</a>',
      );
      expect(result).toContain("[Example](https://example.com)");
    });

    it("should handle en-todo checkboxes", () => {
      expect(importer._enmlToMarkdown('<en-todo checked="true"/>')).toContain(
        "- [x]",
      );
      expect(importer._enmlToMarkdown("<en-todo/>")).toContain("- [ ]");
    });

    it("should remove CDATA wrappers", () => {
      const result = importer._enmlToMarkdown("<![CDATA[Hello World]]>");
      expect(result).toBe("Hello World");
      expect(result).not.toContain("CDATA");
    });

    it("should decode HTML entities", () => {
      const result = importer._enmlToMarkdown(
        "&amp; &lt; &gt; &quot; &#39; &nbsp;",
      );
      expect(result).toContain("&");
      expect(result).toContain("<");
      expect(result).toContain(">");
      expect(result).toContain('"');
      expect(result).toContain("'");
    });

    it("should return empty string for falsy input", () => {
      expect(importer._enmlToMarkdown(null)).toBe("");
      expect(importer._enmlToMarkdown("")).toBe("");
      expect(importer._enmlToMarkdown(undefined)).toBe("");
    });

    it("should convert code tags to backticks", () => {
      expect(importer._enmlToMarkdown("<code>const x = 1</code>")).toContain(
        "`const x = 1`",
      );
    });

    it("should convert br tags to newlines", () => {
      expect(importer._enmlToMarkdown("line1<br/>line2")).toContain(
        "line1\nline2",
      );
    });

    it("should remove en-note wrapper", () => {
      const result = importer._enmlToMarkdown(
        "<en-note>Content here</en-note>",
      );
      expect(result).not.toContain("en-note");
      expect(result).toContain("Content here");
    });
  });

  describe("_parseEnexDate()", () => {
    it("should parse Evernote date format", () => {
      const timestamp = importer._parseEnexDate("20230515T120000Z");
      const date = new Date(timestamp);
      expect(date.getUTCFullYear()).toBe(2023);
      expect(date.getUTCMonth()).toBe(4); // 0-indexed, May = 4
      expect(date.getUTCDate()).toBe(15);
      expect(date.getUTCHours()).toBe(12);
    });

    it("should return Date.now() for null input", () => {
      const before = Date.now();
      const result = importer._parseEnexDate(null);
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });

    it("should return Date.now() for invalid format", () => {
      const before = Date.now();
      const result = importer._parseEnexDate("not-a-date");
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });

  describe("_saveNote()", () => {
    it("should insert into database with correct parameters", () => {
      const noteId = importer._saveNote({
        title: "Test",
        content: "Content",
        folder: "Folder",
        tags: ["a", "b"],
        source: "evernote",
        createdAt: 1000,
        updatedAt: 2000,
      });

      expect(typeof noteId).toBe("string");
      expect(noteId.length).toBeGreaterThan(0);
      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR IGNORE INTO notes"),
      );
      expect(mockDb.db._prep.run).toHaveBeenCalledWith(
        expect.any(String),
        "Test",
        "Content",
        "Folder",
        '["a","b"]',
        "evernote",
        1000,
        2000,
      );
    });

    it("should handle null tags", () => {
      importer._saveNote({
        title: "T",
        content: "C",
        folder: "F",
        tags: null,
        source: "evernote",
        createdAt: 0,
        updatedAt: 0,
      });

      const args = mockDb.db._prep.run.mock.calls[0];
      expect(args[4]).toBe("[]");
    });
  });
});
