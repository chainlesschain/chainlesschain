import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

// Mock fs
vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

import { writeFileSync, mkdirSync, existsSync } from "fs";
import {
  fetchNotes,
  sanitizeFilename,
  noteToMarkdown,
  exportToMarkdown,
  noteToHtml,
  generateIndexHtml,
  generateStyleCss,
  exportToSite,
} from "../../src/lib/knowledge-exporter.js";

describe("Knowledge Exporter", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    vi.clearAllMocks();
    existsSync.mockReturnValue(false);

    // Seed notes table
    db.exec(`CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT DEFAULT '',
      tags TEXT DEFAULT '[]', category TEXT DEFAULT 'general',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT DEFAULT NULL
    )`);
  });

  function seedNote(overrides = {}) {
    const note = {
      id: `note-${Math.random().toString(36).slice(2, 10)}`,
      title: "Test Note",
      content: "Test content",
      tags: '["tag1"]',
      category: "general",
      created_at: "2024-01-15 10:00:00",
      updated_at: "2024-01-15 10:00:00",
      deleted_at: null,
      ...overrides,
    };
    db.data.get("notes").push(note);
    return note;
  }

  // ─── fetchNotes ───────────────────────────────────────────────

  describe("fetchNotes", () => {
    it("should fetch all active notes", () => {
      seedNote({ title: "Note 1" });
      seedNote({ title: "Note 2" });
      seedNote({ title: "Deleted", deleted_at: "2024-01-20" });

      const notes = fetchNotes(db);
      expect(notes).toHaveLength(2);
    });

    it("should filter by category", () => {
      seedNote({ title: "Work", category: "work" });
      seedNote({ title: "Personal", category: "personal" });

      const notes = fetchNotes(db, { category: "work" });
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe("Work");
    });

    it("should filter by tag", () => {
      seedNote({ title: "Tagged", tags: '["important"]' });
      seedNote({ title: "Untagged", tags: "[]" });

      const notes = fetchNotes(db, { tag: "important" });
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe("Tagged");
    });

    it("should respect limit", () => {
      seedNote({ title: "N1" });
      seedNote({ title: "N2" });
      seedNote({ title: "N3" });

      const notes = fetchNotes(db, { limit: 2 });
      expect(notes).toHaveLength(2);
    });
  });

  // ─── sanitizeFilename ────────────────────────────────────────

  describe("sanitizeFilename", () => {
    it("should remove invalid characters", () => {
      expect(sanitizeFilename('File: "test" <1>')).toBe("File-test-1");
    });

    it("should replace spaces with dashes", () => {
      expect(sanitizeFilename("my note title")).toBe("my-note-title");
    });

    it("should truncate long names", () => {
      const long = "a".repeat(300);
      expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200);
    });
  });

  // ─── noteToMarkdown ──────────────────────────────────────────

  describe("noteToMarkdown", () => {
    it("should generate markdown with frontmatter", () => {
      const md = noteToMarkdown({
        id: "test-id",
        title: "My Note",
        content: "Hello world",
        tags: '["tag1", "tag2"]',
        category: "work",
        created_at: "2024-01-15",
      });

      expect(md).toContain("---");
      expect(md).toContain('title: "My Note"');
      expect(md).toContain("category: work");
      expect(md).toContain('"tag1"');
      expect(md).toContain("# My Note");
      expect(md).toContain("Hello world");
    });

    it("should handle note without tags", () => {
      const md = noteToMarkdown({
        id: "id",
        title: "Minimal",
        content: "",
        tags: "[]",
        category: "general",
        created_at: "",
      });
      expect(md).toContain("tags: []");
    });
  });

  // ─── exportToMarkdown ────────────────────────────────────────

  describe("exportToMarkdown", () => {
    it("should export notes as markdown files", () => {
      seedNote({ title: "Note A", category: "work" });
      seedNote({ title: "Note B", category: "personal" });

      const exported = exportToMarkdown(db, "/output");

      expect(exported).toHaveLength(2);
      expect(mkdirSync).toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalledTimes(2);
      expect(exported[0].path).toContain(".md");
    });

    it("should return empty array for no notes", () => {
      const exported = exportToMarkdown(db, "/output");
      expect(exported).toHaveLength(0);
    });
  });

  // ─── noteToHtml ──────────────────────────────────────────────

  describe("noteToHtml", () => {
    it("should generate valid HTML", () => {
      const html = noteToHtml({
        id: "id",
        title: "Test Page",
        content: "Hello **bold**",
        tags: '["web"]',
        category: "blog",
        created_at: "2024-01-15",
      });

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<title>Test Page</title>");
      expect(html).toContain("blog");
      expect(html).toContain("web");
      expect(html).toContain("<strong>bold</strong>");
    });

    it("should escape HTML in title", () => {
      const html = noteToHtml({
        id: "id",
        title: "<script>alert(1)</script>",
        content: "",
        tags: "[]",
        category: "general",
        created_at: "",
      });

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  // ─── generateIndexHtml ───────────────────────────────────────

  describe("generateIndexHtml", () => {
    it("should generate index with note links", () => {
      const notes = [
        {
          id: "1",
          title: "Note 1",
          tags: "[]",
          category: "general",
          created_at: "2024-01-15",
        },
        {
          id: "2",
          title: "Note 2",
          tags: '["tag"]',
          category: "work",
          created_at: "2024-01-16",
        },
      ];

      const html = generateIndexHtml(notes);
      expect(html).toContain("2 notes");
      expect(html).toContain("Note 1");
      expect(html).toContain("Note 2");
      expect(html).toContain("ChainlessChain Knowledge Base");
    });

    it("should use custom site title", () => {
      const html = generateIndexHtml([], "My KB");
      expect(html).toContain("My KB");
    });
  });

  // ─── generateStyleCss ────────────────────────────────────────

  describe("generateStyleCss", () => {
    it("should return CSS string", () => {
      const css = generateStyleCss();
      expect(css).toContain("body");
      expect(css).toContain("font-family");
      expect(css.length).toBeGreaterThan(100);
    });
  });

  // ─── exportToSite ────────────────────────────────────────────

  describe("exportToSite", () => {
    it("should export notes as static HTML site", () => {
      seedNote({ title: "Page 1", category: "blog" });

      const exported = exportToSite(db, "/site-output");

      expect(exported).toHaveLength(1);
      // index.html + style.css + 1 page = at least 3 writes
      expect(writeFileSync.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it("should create style.css and index.html", () => {
      seedNote({ title: "Test" });
      exportToSite(db, "/out");

      const writtenPaths = writeFileSync.mock.calls.map((c) => c[0]);
      const hasStyle = writtenPaths.some((p) => p.includes("style.css"));
      const hasIndex = writtenPaths.some((p) => p.includes("index.html"));
      expect(hasStyle).toBe(true);
      expect(hasIndex).toBe(true);
    });

    it("should return empty array for no notes", () => {
      const exported = exportToSite(db, "/out");
      expect(exported).toHaveLength(0);
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────

  describe("edge cases", () => {
    it("should sanitize empty filename", () => {
      const result = sanitizeFilename("");
      expect(result).toBe("");
    });
  });
});
