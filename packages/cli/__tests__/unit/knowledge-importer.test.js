import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

// Mock fs and path for file operations
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { readFileSync, readdirSync, statSync } from "fs";
import {
  parseMarkdownFile,
  collectMarkdownFiles,
  parseEnex,
  stripHtml,
  parseNotionExport,
  insertNote,
  ensureNotesTable,
  importMarkdownDir,
  importEnexFile,
  importNotionDir,
} from "../../src/lib/knowledge-importer.js";

describe("Knowledge Importer", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    vi.clearAllMocks();
  });

  // ─── ensureNotesTable ─────────────────────────────────────────

  describe("ensureNotesTable", () => {
    it("should create notes table", () => {
      ensureNotesTable(db);
      expect(db.tables.has("notes")).toBe(true);
    });
  });

  // ─── insertNote ───────────────────────────────────────────────

  describe("insertNote", () => {
    it("should insert a note and return it", () => {
      ensureNotesTable(db);
      const note = insertNote(db, {
        title: "Test Note",
        content: "Hello world",
        tags: ["test", "hello"],
        category: "general",
      });

      expect(note.title).toBe("Test Note");
      expect(note.tags).toEqual(["test", "hello"]);
      expect(note.category).toBe("general");
      expect(note.id).toBeTruthy();
    });

    it("should use default values when not provided", () => {
      ensureNotesTable(db);
      const note = insertNote(db, { title: "Minimal" });
      expect(note.category).toBe("general");
      expect(note.tags).toEqual([]);
    });
  });

  // ─── parseMarkdownFile ────────────────────────────────────────

  describe("parseMarkdownFile", () => {
    it("should parse a plain markdown file", () => {
      readFileSync.mockReturnValue("# My Title\n\nSome content here.");
      const result = parseMarkdownFile("/test/note.md");
      expect(result.title).toBe("My Title");
      expect(result.content).toBe("# My Title\n\nSome content here.");
      expect(result.category).toBe("markdown");
    });

    it("should parse frontmatter", () => {
      readFileSync.mockReturnValue(
        '---\ntitle: "Custom Title"\ntags: [tag1, tag2]\ncategory: work\ndate: 2024-01-15\n---\nBody content',
      );
      const result = parseMarkdownFile("/test/note.md");
      expect(result.title).toBe("Custom Title");
      expect(result.tags).toEqual(["tag1", "tag2"]);
      expect(result.category).toBe("work");
      expect(result.createdAt).toBe("2024-01-15");
      expect(result.content).toBe("Body content");
    });

    it("should use filename as title when no frontmatter or H1", () => {
      readFileSync.mockReturnValue("Just some text without a heading.");
      const result = parseMarkdownFile("/test/my-note.md");
      expect(result.title).toBe("my-note");
    });

    it("should handle empty frontmatter tags", () => {
      readFileSync.mockReturnValue("---\ntitle: Test\ntags: []\n---\nContent");
      const result = parseMarkdownFile("/test/note.md");
      expect(result.tags).toEqual([]);
    });
  });

  // ─── collectMarkdownFiles ─────────────────────────────────────

  describe("collectMarkdownFiles", () => {
    it("should collect .md files recursively", () => {
      readdirSync
        .mockReturnValueOnce(["file1.md", "subdir", "file2.txt"])
        .mockReturnValueOnce(["nested.md"]);

      statSync
        .mockReturnValueOnce({ isDirectory: () => false })
        .mockReturnValueOnce({ isDirectory: () => true })
        .mockReturnValueOnce({ isDirectory: () => false })
        .mockReturnValueOnce({ isDirectory: () => false });

      const files = collectMarkdownFiles("/test");
      expect(files).toHaveLength(2);
      expect(files[0]).toContain("file1.md");
      expect(files[1]).toContain("nested.md");
    });

    it("should return empty array for dir with no .md files", () => {
      readdirSync.mockReturnValueOnce(["file.txt", "image.png"]);
      statSync
        .mockReturnValueOnce({ isDirectory: () => false })
        .mockReturnValueOnce({ isDirectory: () => false });

      const files = collectMarkdownFiles("/test");
      expect(files).toHaveLength(0);
    });
  });

  // ─── parseEnex ────────────────────────────────────────────────

  describe("parseEnex", () => {
    it("should parse a single note from ENEX", () => {
      const enex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>My Evernote Note</title>
    <content><![CDATA[<p>Hello world</p>]]></content>
    <tag>tag1</tag>
    <tag>tag2</tag>
    <created>20210315T120000Z</created>
  </note>
</en-export>`;

      const notes = parseEnex(enex);
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe("My Evernote Note");
      expect(notes[0].content).toBe("Hello world");
      expect(notes[0].tags).toEqual(["tag1", "tag2"]);
      expect(notes[0].category).toBe("evernote");
      expect(notes[0].createdAt).toBe("2021-03-15 12:00:00");
    });

    it("should parse multiple notes", () => {
      const enex = `<en-export>
  <note><title>Note 1</title><content>Text 1</content></note>
  <note><title>Note 2</title><content>Text 2</content></note>
  <note><title>Note 3</title><content>Text 3</content></note>
</en-export>`;

      const notes = parseEnex(enex);
      expect(notes).toHaveLength(3);
      expect(notes[0].title).toBe("Note 1");
      expect(notes[2].title).toBe("Note 3");
    });

    it("should handle notes without tags or dates", () => {
      const enex = `<en-export>
  <note><title>Simple</title><content>Just text</content></note>
</en-export>`;

      const notes = parseEnex(enex);
      expect(notes[0].tags).toEqual([]);
      expect(notes[0].createdAt).toBeNull();
    });

    it("should handle empty ENEX", () => {
      const notes = parseEnex("<en-export></en-export>");
      expect(notes).toHaveLength(0);
    });

    it("should handle note without title", () => {
      const enex = `<en-export><note><content>No title</content></note></en-export>`;
      const notes = parseEnex(enex);
      expect(notes[0].title).toBe("Untitled");
    });
  });

  // ─── stripHtml ────────────────────────────────────────────────

  describe("stripHtml", () => {
    it("should strip HTML tags", () => {
      expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
    });

    it("should convert br to newlines", () => {
      expect(stripHtml("Line 1<br/>Line 2")).toBe("Line 1\nLine 2");
    });

    it("should decode HTML entities", () => {
      expect(stripHtml("&amp; &lt; &gt; &quot; &#39;")).toBe("& < > \" '");
    });

    it("should handle nbsp", () => {
      expect(stripHtml("Hello&nbsp;world")).toBe("Hello world");
    });

    it("should collapse multiple newlines", () => {
      const result = stripHtml("<p>A</p><p></p><p></p><p>B</p>");
      expect(result).not.toMatch(/\n{3,}/);
    });
  });

  // ─── parseNotionExport ────────────────────────────────────────

  describe("parseNotionExport", () => {
    it("should parse Notion export files", () => {
      readdirSync
        .mockReturnValueOnce(["Projects", "page.md"])
        .mockReturnValueOnce(["nested.md"]);

      statSync
        .mockReturnValueOnce({ isDirectory: () => true })
        .mockReturnValueOnce({ isDirectory: () => false })
        .mockReturnValueOnce({ isDirectory: () => false });

      readFileSync
        .mockReturnValueOnce("# Nested Page\nContent here")
        .mockReturnValueOnce("# Top Page\nMore content");

      const notes = parseNotionExport("/notion-export");
      expect(notes).toHaveLength(2);
      expect(notes[0].category).toBe("notion");
    });

    it("should strip Notion UUID suffixes from titles", () => {
      readdirSync.mockReturnValueOnce([
        "My Page abc123def456789012345678abcdef01.md",
      ]);
      statSync.mockReturnValueOnce({ isDirectory: () => false });
      readFileSync.mockReturnValue("# My Page\nContent");

      // The filename after removing .md: "My Page abc123def456789012345678abcdef01"
      // UUID suffix is 32 hex chars
      const notes = parseNotionExport("/notion-export");
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe("My Page");
    });

    it("should use parent folder as tag", () => {
      readdirSync
        .mockReturnValueOnce(["Work"])
        .mockReturnValueOnce(["task.md"]);

      statSync
        .mockReturnValueOnce({ isDirectory: () => true })
        .mockReturnValueOnce({ isDirectory: () => false });

      readFileSync.mockReturnValue("Task content");

      const notes = parseNotionExport("/notion-export");
      expect(notes[0].tags).toContain("Work");
    });
  });

  // ─── Integration: importMarkdownDir ───────────────────────────

  describe("importMarkdownDir", () => {
    it("should import markdown files into DB", () => {
      readdirSync.mockReturnValueOnce(["note1.md", "note2.md"]);
      statSync
        .mockReturnValueOnce({ isDirectory: () => false })
        .mockReturnValueOnce({ isDirectory: () => false });
      readFileSync
        .mockReturnValueOnce("# First Note\nContent 1")
        .mockReturnValueOnce("# Second Note\nContent 2");

      const imported = importMarkdownDir(db, "/test-dir");
      expect(imported).toHaveLength(2);
      expect(imported[0].title).toBe("First Note");
      expect(imported[1].title).toBe("Second Note");
      expect(db.data.get("notes")).toHaveLength(2);
    });
  });

  // ─── Integration: importEnexFile ──────────────────────────────

  describe("importEnexFile", () => {
    it("should import ENEX notes into DB", () => {
      readFileSync.mockReturnValue(`<en-export>
        <note><title>EN Note 1</title><content>Content</content><tag>work</tag></note>
        <note><title>EN Note 2</title><content>More</content></note>
      </en-export>`);

      const imported = importEnexFile(db, "/test.enex");
      expect(imported).toHaveLength(2);
      expect(imported[0].title).toBe("EN Note 1");
      expect(imported[0].tags).toEqual(["work"]);
      expect(db.data.get("notes")).toHaveLength(2);
    });
  });

  // ─── Integration: importNotionDir ─────────────────────────────

  describe("importNotionDir", () => {
    it("should import Notion pages into DB", () => {
      readdirSync.mockReturnValueOnce(["page.md"]);
      statSync.mockReturnValueOnce({ isDirectory: () => false });
      readFileSync.mockReturnValue("# Notion Page\nNotion content");

      const imported = importNotionDir(db, "/notion");
      expect(imported).toHaveLength(1);
      // Title comes from filename, not H1 heading
      expect(imported[0].title).toBe("page");
      expect(db.data.get("notes")).toHaveLength(1);
    });
  });
});
