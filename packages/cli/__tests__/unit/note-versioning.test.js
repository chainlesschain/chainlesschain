import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureVersionsTable,
  getNextVersion,
  saveVersion,
  getHistory,
  getVersion,
  simpleDiff,
  formatDiff,
  revertToVersion,
} from "../../src/lib/note-versioning.js";

describe("Note Versioning", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    // Create both notes and note_versions tables
    db.exec(`CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT DEFAULT '',
      tags TEXT DEFAULT '[]', category TEXT DEFAULT 'general',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT DEFAULT NULL
    )`);
  });

  // ─── ensureVersionsTable ──────────────────────────────────────

  describe("ensureVersionsTable", () => {
    it("should create note_versions table", () => {
      ensureVersionsTable(db);
      expect(db.tables.has("note_versions")).toBe(true);
    });

    it("should be idempotent", () => {
      ensureVersionsTable(db);
      ensureVersionsTable(db);
      expect(db.tables.has("note_versions")).toBe(true);
    });
  });

  // ─── getNextVersion ───────────────────────────────────────────

  describe("getNextVersion", () => {
    it("should return 1 for first version", () => {
      ensureVersionsTable(db);
      const ver = getNextVersion(db, "note-1");
      expect(ver).toBe(1);
    });

    it("should increment version numbers", () => {
      ensureVersionsTable(db);
      saveVersion(
        db,
        "note-1",
        { title: "V1", content: "Content 1" },
        "create",
      );
      const ver = getNextVersion(db, "note-1");
      expect(ver).toBe(2);
    });
  });

  // ─── saveVersion ──────────────────────────────────────────────

  describe("saveVersion", () => {
    it("should save a version and return it", () => {
      const result = saveVersion(
        db,
        "note-1",
        {
          title: "My Note",
          content: "Hello",
          tags: ["tag1"],
          category: "work",
        },
        "create",
      );

      expect(result.note_id).toBe("note-1");
      expect(result.version).toBe(1);
      expect(result.title).toBe("My Note");
      expect(result.change_type).toBe("create");
    });

    it("should auto-increment versions for same note", () => {
      const v1 = saveVersion(db, "note-1", { title: "V1" }, "create");
      const v2 = saveVersion(db, "note-1", { title: "V2" }, "edit");
      const v3 = saveVersion(db, "note-1", { title: "V3" }, "edit");

      expect(v1.version).toBe(1);
      expect(v2.version).toBe(2);
      expect(v3.version).toBe(3);
    });

    it("should keep separate versions per note", () => {
      saveVersion(db, "note-1", { title: "N1V1" }, "create");
      saveVersion(db, "note-1", { title: "N1V2" }, "edit");
      const n2v1 = saveVersion(db, "note-2", { title: "N2V1" }, "create");

      expect(n2v1.version).toBe(1);
    });

    it("should handle tags as string or array", () => {
      const v1 = saveVersion(
        db,
        "note-1",
        { title: "T", tags: '["a","b"]' },
        "create",
      );
      expect(v1.tags).toBe('["a","b"]');

      const v2 = saveVersion(
        db,
        "note-1",
        { title: "T", tags: ["c", "d"] },
        "edit",
      );
      expect(v2.tags).toBe('["c","d"]');
    });

    it("should default change_type to edit", () => {
      const v = saveVersion(db, "note-1", { title: "T" });
      expect(v.change_type).toBe("edit");
    });
  });

  // ─── getHistory ───────────────────────────────────────────────

  describe("getHistory", () => {
    it("should return version history in descending order", () => {
      saveVersion(db, "note-1", { title: "V1" }, "create");
      saveVersion(db, "note-1", { title: "V2" }, "edit");
      saveVersion(db, "note-1", { title: "V3" }, "edit");

      const history = getHistory(db, "note-1");
      expect(history).toHaveLength(3);
      expect(history[0].version).toBe(3);
      expect(history[2].version).toBe(1);
    });

    it("should return empty array for unknown note", () => {
      ensureVersionsTable(db);
      const history = getHistory(db, "unknown");
      expect(history).toHaveLength(0);
    });
  });

  // ─── getVersion ───────────────────────────────────────────────

  describe("getVersion", () => {
    it("should return a specific version", () => {
      saveVersion(db, "note-1", { title: "V1", content: "Old" }, "create");
      saveVersion(db, "note-1", { title: "V2", content: "New" }, "edit");

      const v1 = getVersion(db, "note-1", 1);
      expect(v1.title).toBe("V1");
      expect(v1.content).toBe("Old");

      const v2 = getVersion(db, "note-1", 2);
      expect(v2.title).toBe("V2");
    });

    it("should return null for non-existent version", () => {
      ensureVersionsTable(db);
      const v = getVersion(db, "note-1", 999);
      expect(v).toBeNull();
    });
  });

  // ─── simpleDiff ───────────────────────────────────────────────

  describe("simpleDiff", () => {
    it("should show no changes for identical text", () => {
      const diff = simpleDiff("Hello\nWorld", "Hello\nWorld");
      expect(diff.every((d) => d.type === "same")).toBe(true);
    });

    it("should detect added lines", () => {
      const diff = simpleDiff("Line 1", "Line 1\nLine 2");
      const added = diff.filter((d) => d.type === "add");
      expect(added.length).toBeGreaterThan(0);
      expect(added.some((d) => d.line === "Line 2")).toBe(true);
    });

    it("should detect removed lines", () => {
      const diff = simpleDiff("Line 1\nLine 2", "Line 1");
      const removed = diff.filter((d) => d.type === "remove");
      expect(removed.length).toBeGreaterThan(0);
      expect(removed.some((d) => d.line === "Line 2")).toBe(true);
    });

    it("should handle empty strings", () => {
      const diff = simpleDiff("", "New content");
      expect(diff.filter((d) => d.type === "add").length).toBeGreaterThan(0);
    });

    it("should handle null inputs", () => {
      const diff = simpleDiff(null, "Something");
      expect(diff).toBeTruthy();
    });
  });

  // ─── formatDiff ───────────────────────────────────────────────

  describe("formatDiff", () => {
    it("should format diff with +/- prefixes", () => {
      const diff = [
        { type: "same", line: "unchanged" },
        { type: "remove", line: "old line" },
        { type: "add", line: "new line" },
      ];

      const formatted = formatDiff(diff);
      expect(formatted).toContain("  unchanged");
      expect(formatted).toContain("- old line");
      expect(formatted).toContain("+ new line");
    });
  });

  // ─── revertToVersion ─────────────────────────────────────────

  describe("revertToVersion", () => {
    it("should revert a note to a previous version", () => {
      // Add a note to the notes table
      db.data.get("notes").push({
        id: "note-1",
        title: "Current Title",
        content: "Current content",
        tags: "[]",
        category: "general",
        created_at: "2024-01-15",
        updated_at: "2024-01-16",
        deleted_at: null,
      });

      // Save version history
      saveVersion(
        db,
        "note-1",
        {
          title: "Original",
          content: "Original content",
          tags: "[]",
          category: "general",
        },
        "create",
      );
      saveVersion(
        db,
        "note-1",
        {
          title: "Current Title",
          content: "Current content",
          tags: "[]",
          category: "general",
        },
        "edit",
      );

      const result = revertToVersion(db, "note-1", 1);
      expect(result).toBeTruthy();
      expect(result.reverted_to).toBe(1);
      expect(result.title).toBe("Original");
    });

    it("should return null for non-existent version", () => {
      ensureVersionsTable(db);
      db.data.get("notes").push({
        id: "note-1",
        title: "T",
        content: "C",
        tags: "[]",
        category: "general",
        created_at: "2024-01-15",
        updated_at: "2024-01-15",
        deleted_at: null,
      });

      const result = revertToVersion(db, "note-1", 999);
      expect(result).toBeNull();
    });

    it("should return null for deleted note", () => {
      ensureVersionsTable(db);
      saveVersion(db, "note-1", { title: "T" }, "create");

      // Note doesn't exist in notes table
      const result = revertToVersion(db, "note-1", 1);
      expect(result).toBeNull();
    });
  });
});
