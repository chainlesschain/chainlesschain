import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  addMemory,
  searchMemory,
  listMemory,
  deleteMemory,
  getMemoryDir,
  appendDailyNote,
  getDailyNote,
  listDailyNotes,
  getMemoryFile,
  updateMemoryFile,
} from "../../src/lib/memory-manager.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("memory-manager", () => {
  let db;
  let tmpDir;

  beforeEach(() => {
    db = new MockDatabase();
    tmpDir = path.join(
      os.tmpdir(),
      `cc-mem-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
  });

  afterEach(() => {
    db.close();
    // Cleanup temp dir
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  // ── getMemoryDir ──

  describe("getMemoryDir", () => {
    it("returns memory subdirectory of data dir", () => {
      const dir = getMemoryDir("/data");
      expect(dir).toContain("memory");
    });
  });

  // ── addMemory ──

  describe("addMemory", () => {
    it("adds a memory entry", () => {
      const result = addMemory(db, "Remember this");
      expect(result.id).toBeDefined();
      expect(result.id.startsWith("mem-")).toBe(true);
      expect(result.content).toBe("Remember this");
      expect(result.category).toBe("general");
      expect(result.importance).toBe(3);
    });

    it("persists to database", () => {
      addMemory(db, "Test memory");
      const rows = db.data.get("memory_entries") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].content).toBe("Test memory");
    });

    it("accepts category option", () => {
      const result = addMemory(db, "Categorized", { category: "work" });
      expect(result.category).toBe("work");
    });

    it("accepts importance option", () => {
      const result = addMemory(db, "Important", { importance: 5 });
      expect(result.importance).toBe(5);
    });

    it("clamps importance to 1-5 range (too high)", () => {
      const result = addMemory(db, "Test", { importance: 10 });
      expect(result.importance).toBe(5);
    });

    it("treats 0 importance as default (3)", () => {
      // parseInt(0) is 0, which is falsy, so || 3 kicks in
      const result = addMemory(db, "Test", { importance: 0 });
      expect(result.importance).toBe(3);
    });

    it("clamps importance to 1-5 range (negative)", () => {
      const result = addMemory(db, "Test", { importance: -3 });
      expect(result.importance).toBe(1);
    });

    it("defaults importance to 3 for non-numeric value", () => {
      const result = addMemory(db, "Test", { importance: "invalid" });
      expect(result.importance).toBe(3);
    });

    it("accepts source option", () => {
      addMemory(db, "Auto memory", { source: "system" });
      const rows = db.data.get("memory_entries") || [];
      expect(rows[0].source).toBe("system");
    });

    it("defaults source to user", () => {
      addMemory(db, "Test");
      const rows = db.data.get("memory_entries") || [];
      expect(rows[0].source).toBe("user");
    });

    it("throws for empty content", () => {
      expect(() => addMemory(db, "")).toThrow("Memory content cannot be empty");
    });

    it("throws for null content", () => {
      expect(() => addMemory(db, null)).toThrow(
        "Memory content cannot be empty",
      );
    });

    it("throws for undefined content", () => {
      expect(() => addMemory(db, undefined)).toThrow(
        "Memory content cannot be empty",
      );
    });

    it("throws for whitespace-only content", () => {
      expect(() => addMemory(db, "   ")).toThrow(
        "Memory content cannot be empty",
      );
    });

    it("generates unique IDs", () => {
      const r1 = addMemory(db, "First");
      const r2 = addMemory(db, "Second");
      expect(r1.id).not.toBe(r2.id);
    });

    it("creates table on first call", () => {
      expect(db.tables.has("memory_entries")).toBe(false);
      addMemory(db, "Test");
      expect(db.tables.has("memory_entries")).toBe(true);
    });
  });

  // ── searchMemory ──

  describe("searchMemory", () => {
    beforeEach(() => {
      addMemory(db, "JavaScript is a programming language", {
        category: "tech",
      });
      addMemory(db, "Python is great for data science", { category: "tech" });
      addMemory(db, "Buy groceries from the store", { category: "personal" });
    });

    it("finds matching entries", () => {
      const results = searchMemory(db, "JavaScript");
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns empty for no match", () => {
      const results = searchMemory(db, "nonexistentkeyword12345");
      expect(results).toEqual([]);
    });

    it("returns empty for empty query", () => {
      expect(searchMemory(db, "")).toEqual([]);
    });

    it("returns empty for null query", () => {
      expect(searchMemory(db, null)).toEqual([]);
    });

    it("returns empty for undefined query", () => {
      expect(searchMemory(db, undefined)).toEqual([]);
    });

    it("returns empty for whitespace-only query", () => {
      expect(searchMemory(db, "   ")).toEqual([]);
    });

    it("respects limit option", () => {
      const results = searchMemory(db, "is", { limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it("defaults limit to 20", () => {
      // Add many entries
      for (let i = 0; i < 25; i++) {
        addMemory(db, `Test memory entry ${i} with keyword testword`);
      }
      const results = searchMemory(db, "testword");
      expect(results.length).toBeLessThanOrEqual(20);
    });

    it("handles non-numeric limit", () => {
      // Should default to 20, not crash
      const results = searchMemory(db, "JavaScript", { limit: "invalid" });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ── listMemory ──

  describe("listMemory", () => {
    beforeEach(() => {
      addMemory(db, "Entry A", { category: "work" });
      addMemory(db, "Entry B", { category: "personal" });
      addMemory(db, "Entry C", { category: "work" });
    });

    it("lists all entries", () => {
      const results = listMemory(db);
      expect(results.length).toBe(3);
    });

    it("filters by category", () => {
      const results = listMemory(db, { category: "work" });
      expect(results.length).toBe(2);
    });

    it("returns empty when category has no entries", () => {
      const results = listMemory(db, { category: "nonexistent" });
      expect(results).toEqual([]);
    });

    it("respects limit", () => {
      const results = listMemory(db, { limit: 2 });
      expect(results.length).toBe(2);
    });

    it("defaults limit to 50", () => {
      for (let i = 0; i < 55; i++) {
        addMemory(db, `Entry ${i}`);
      }
      const results = listMemory(db);
      expect(results.length).toBe(50);
    });

    it("returns empty for empty database", () => {
      const freshDb = new MockDatabase();
      const results = listMemory(freshDb);
      expect(results).toEqual([]);
      freshDb.close();
    });
  });

  // ── deleteMemory ──

  describe("deleteMemory", () => {
    it("deletes by exact ID", () => {
      const mem = addMemory(db, "To be deleted");
      const result = deleteMemory(db, mem.id);
      expect(result).toBe(true);
    });

    it("returns false for non-existent ID", () => {
      expect(deleteMemory(db, "nonexistent-id")).toBe(false);
    });

    it("entry is gone after deletion", () => {
      const mem = addMemory(db, "To be deleted");
      deleteMemory(db, mem.id);
      const rows = db.data.get("memory_entries") || [];
      expect(rows.length).toBe(0);
    });

    it("deletes by prefix match when exact fails", () => {
      const mem = addMemory(db, "Prefix test");
      // Use first 10 characters of the ID as prefix
      const prefix = mem.id.slice(0, 10);
      const result = deleteMemory(db, prefix);
      expect(result).toBe(true);
    });

    it("requires minimum 4 characters for prefix match", () => {
      addMemory(db, "Test");
      // Short prefix should not match
      const result = deleteMemory(db, "me");
      expect(result).toBe(false);
    });
  });

  // ── File-based operations ──

  describe("appendDailyNote", () => {
    it("creates daily note file", () => {
      const memDir = path.join(tmpDir, "memory");
      const result = appendDailyNote(memDir, "Today's note");
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.path).toBeDefined();
      expect(fs.existsSync(result.path)).toBe(true);
    });

    it("appends to existing daily note", () => {
      const memDir = path.join(tmpDir, "memory");
      appendDailyNote(memDir, "First entry");
      appendDailyNote(memDir, "Second entry");

      const today = new Date().toISOString().slice(0, 10);
      const content = fs.readFileSync(
        path.join(memDir, "daily", `${today}.md`),
        "utf8",
      );
      expect(content).toContain("First entry");
      expect(content).toContain("Second entry");
    });

    it("includes timestamp in entries", () => {
      const memDir = path.join(tmpDir, "memory");
      appendDailyNote(memDir, "Timestamped entry");

      const today = new Date().toISOString().slice(0, 10);
      const content = fs.readFileSync(
        path.join(memDir, "daily", `${today}.md`),
        "utf8",
      );
      // Should contain time format HH:MM:SS
      expect(content).toMatch(/## \d{2}:\d{2}:\d{2}/);
    });

    it("creates directory structure", () => {
      const memDir = path.join(tmpDir, "memory");
      appendDailyNote(memDir, "Test");
      expect(fs.existsSync(path.join(memDir, "daily"))).toBe(true);
    });
  });

  describe("getDailyNote", () => {
    it("returns null for invalid date format", () => {
      const memDir = path.join(tmpDir, "memory");
      expect(getDailyNote(memDir, "not-a-date")).toBeNull();
    });

    it("returns null for null date", () => {
      const memDir = path.join(tmpDir, "memory");
      expect(getDailyNote(memDir, null)).toBeNull();
    });

    it("returns null for undefined date", () => {
      const memDir = path.join(tmpDir, "memory");
      expect(getDailyNote(memDir, undefined)).toBeNull();
    });

    it("returns null for non-existent date", () => {
      const memDir = path.join(tmpDir, "memory");
      fs.mkdirSync(path.join(memDir, "daily"), { recursive: true });
      expect(getDailyNote(memDir, "2020-01-01")).toBeNull();
    });

    it("reads existing daily note", () => {
      const memDir = path.join(tmpDir, "memory");
      appendDailyNote(memDir, "Hello daily");
      const today = new Date().toISOString().slice(0, 10);
      const content = getDailyNote(memDir, today);
      expect(content).toContain("Hello daily");
    });

    it("validates date format strictly", () => {
      const memDir = path.join(tmpDir, "memory");
      expect(getDailyNote(memDir, "2024/01/01")).toBeNull();
      expect(getDailyNote(memDir, "24-01-01")).toBeNull();
      expect(getDailyNote(memDir, "2024-1-1")).toBeNull();
    });
  });

  describe("listDailyNotes", () => {
    it("returns empty array when no notes", () => {
      const memDir = path.join(tmpDir, "memory");
      const notes = listDailyNotes(memDir);
      expect(notes).toEqual([]);
    });

    it("lists daily notes", () => {
      const memDir = path.join(tmpDir, "memory");
      appendDailyNote(memDir, "Test entry");
      const notes = listDailyNotes(memDir);
      expect(notes.length).toBe(1);
      expect(notes[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(notes[0].size).toBeGreaterThan(0);
    });

    it("respects limit option", () => {
      const memDir = path.join(tmpDir, "memory");
      const dailyDir = path.join(memDir, "daily");
      fs.mkdirSync(dailyDir, { recursive: true });
      // Create multiple daily note files
      for (let i = 1; i <= 5; i++) {
        fs.writeFileSync(
          path.join(dailyDir, `2024-01-0${i}.md`),
          `# Day ${i}`,
          "utf8",
        );
      }
      const notes = listDailyNotes(memDir, { limit: 3 });
      expect(notes.length).toBe(3);
    });
  });

  // ── MEMORY.md file ──

  describe("getMemoryFile", () => {
    it("returns empty string when file does not exist", () => {
      const memDir = path.join(tmpDir, "memory");
      const content = getMemoryFile(memDir);
      expect(content).toBe("");
    });

    it("reads existing MEMORY.md", () => {
      const memDir = path.join(tmpDir, "memory");
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, "MEMORY.md"), "# My Memory", "utf8");
      const content = getMemoryFile(memDir);
      expect(content).toBe("# My Memory");
    });
  });

  describe("updateMemoryFile", () => {
    it("creates MEMORY.md if it does not exist", () => {
      const memDir = path.join(tmpDir, "memory");
      const result = updateMemoryFile(memDir, "# New Memory");
      expect(result.path).toBeDefined();
      expect(fs.existsSync(result.path)).toBe(true);
    });

    it("overwrites existing MEMORY.md", () => {
      const memDir = path.join(tmpDir, "memory");
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, "MEMORY.md"), "old content", "utf8");
      updateMemoryFile(memDir, "new content");
      const content = fs.readFileSync(path.join(memDir, "MEMORY.md"), "utf8");
      expect(content).toBe("new content");
    });
  });
});
