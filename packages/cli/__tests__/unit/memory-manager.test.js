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

// ═══════════════════════════════════════════════════════════════
// V2 Surface — Memory governance layer
// ═══════════════════════════════════════════════════════════════

import {
  ENTRY_MATURITY_V2,
  CONSOLIDATION_LIFECYCLE_V2,
  MEMORY_DEFAULT_MAX_ACTIVE_ENTRIES_PER_CATEGORY,
  MEMORY_DEFAULT_MAX_RUNNING_JOBS_PER_SOURCE,
  MEMORY_DEFAULT_ENTRY_IDLE_MS,
  MEMORY_DEFAULT_JOB_STUCK_MS,
  getMaxActiveEntriesPerCategoryV2,
  setMaxActiveEntriesPerCategoryV2,
  getMaxRunningJobsPerSourceV2,
  setMaxRunningJobsPerSourceV2,
  getEntryIdleMsV2,
  setEntryIdleMsV2,
  getJobStuckMsV2,
  setJobStuckMsV2,
  getActiveEntryCountV2,
  getRunningJobCountV2,
  registerEntryV2,
  getEntryV2,
  listEntriesV2,
  setEntryStatusV2,
  activateEntryV2,
  parkEntryV2,
  archiveEntryV2,
  touchEntryV2,
  createConsolidationJobV2,
  getConsolidationJobV2,
  listConsolidationJobsV2,
  setJobStatusV2,
  startConsolidationJobV2,
  succeedConsolidationJobV2,
  failConsolidationJobV2,
  cancelConsolidationJobV2,
  autoParkIdleEntriesV2,
  autoFailStuckJobsV2,
  getMemoryManagerStatsV2,
  _resetStateMemoryManagerV2,
} from "../../src/lib/memory-manager.js";

describe("Memory Manager V2", () => {
  beforeEach(() => {
    _resetStateMemoryManagerV2();
  });

  describe("enums", () => {
    it("ENTRY_MATURITY_V2 is frozen with 4 states", () => {
      expect(Object.values(ENTRY_MATURITY_V2)).toEqual([
        "pending",
        "active",
        "parked",
        "archived",
      ]);
      expect(Object.isFrozen(ENTRY_MATURITY_V2)).toBe(true);
    });
    it("CONSOLIDATION_LIFECYCLE_V2 is frozen with 5 states", () => {
      expect(Object.values(CONSOLIDATION_LIFECYCLE_V2)).toEqual([
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
      ]);
      expect(Object.isFrozen(CONSOLIDATION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config defaults & setters", () => {
    it("exposes defaults", () => {
      expect(MEMORY_DEFAULT_MAX_ACTIVE_ENTRIES_PER_CATEGORY).toBe(200);
      expect(MEMORY_DEFAULT_MAX_RUNNING_JOBS_PER_SOURCE).toBe(2);
      expect(MEMORY_DEFAULT_ENTRY_IDLE_MS).toBe(1000 * 60 * 60 * 24 * 90);
      expect(MEMORY_DEFAULT_JOB_STUCK_MS).toBe(1000 * 60 * 10);
    });
    it("getters return current values", () => {
      expect(getMaxActiveEntriesPerCategoryV2()).toBe(200);
      expect(getMaxRunningJobsPerSourceV2()).toBe(2);
      expect(getEntryIdleMsV2()).toBeGreaterThan(0);
      expect(getJobStuckMsV2()).toBeGreaterThan(0);
    });
    it("setters update values and floor non-integers", () => {
      setMaxActiveEntriesPerCategoryV2(11.7);
      expect(getMaxActiveEntriesPerCategoryV2()).toBe(11);
      setMaxRunningJobsPerSourceV2(3.9);
      expect(getMaxRunningJobsPerSourceV2()).toBe(3);
      setEntryIdleMsV2(99);
      expect(getEntryIdleMsV2()).toBe(99);
      setJobStuckMsV2(11);
      expect(getJobStuckMsV2()).toBe(11);
    });
    it("setters reject zero/negative/NaN", () => {
      expect(() => setMaxActiveEntriesPerCategoryV2(0)).toThrow();
      expect(() => setMaxRunningJobsPerSourceV2(-1)).toThrow();
      expect(() => setEntryIdleMsV2(NaN)).toThrow();
      expect(() => setJobStuckMsV2(0)).toThrow();
    });
    it("_resetStateMemoryManagerV2 restores defaults", () => {
      setMaxActiveEntriesPerCategoryV2(99);
      setMaxRunningJobsPerSourceV2(99);
      setEntryIdleMsV2(99);
      setJobStuckMsV2(99);
      _resetStateMemoryManagerV2();
      expect(getMaxActiveEntriesPerCategoryV2()).toBe(200);
      expect(getMaxRunningJobsPerSourceV2()).toBe(2);
      expect(getEntryIdleMsV2()).toBe(MEMORY_DEFAULT_ENTRY_IDLE_MS);
      expect(getJobStuckMsV2()).toBe(MEMORY_DEFAULT_JOB_STUCK_MS);
    });
  });

  describe("registerEntryV2", () => {
    it("creates a pending entry", () => {
      const e = registerEntryV2("e1", { category: "kb", summary: "fact" });
      expect(e.id).toBe("e1");
      expect(e.status).toBe("pending");
      expect(e.activatedAt).toBeNull();
      expect(e.archivedAt).toBeNull();
    });
    it("rejects missing/invalid params", () => {
      expect(() =>
        registerEntryV2("", { category: "c", summary: "s" }),
      ).toThrow();
      expect(() =>
        registerEntryV2("e", { category: "", summary: "s" }),
      ).toThrow();
      expect(() =>
        registerEntryV2("e", { category: "c", summary: "" }),
      ).toThrow();
    });
    it("rejects duplicate id", () => {
      registerEntryV2("e1", { category: "c", summary: "s" });
      expect(() =>
        registerEntryV2("e1", { category: "c", summary: "s" }),
      ).toThrow(/already exists/);
    });
    it("returns defensive copy", () => {
      const e = registerEntryV2("e1", {
        category: "c",
        summary: "s",
        metadata: { tag: "x" },
      });
      e.metadata.tag = "mutated";
      expect(getEntryV2("e1").metadata.tag).toBe("x");
    });
  });

  describe("entry transitions", () => {
    beforeEach(() => {
      registerEntryV2("e1", { category: "kb", summary: "fact" });
    });
    it("pending → active stamps activatedAt", () => {
      const e = activateEntryV2("e1", { now: 1000 });
      expect(e.status).toBe("active");
      expect(e.activatedAt).toBe(1000);
    });
    it("active → parked → active recovery preserves activatedAt", () => {
      const a = activateEntryV2("e1", { now: 1000 });
      parkEntryV2("e1", { now: 2000 });
      const r = activateEntryV2("e1", { now: 3000 });
      expect(r.status).toBe("active");
      expect(r.activatedAt).toBe(a.activatedAt);
    });
    it("→ archived stamps archivedAt and is terminal", () => {
      activateEntryV2("e1");
      const ar = archiveEntryV2("e1", { now: 5000 });
      expect(ar.status).toBe("archived");
      expect(ar.archivedAt).toBe(5000);
      expect(() => activateEntryV2("e1")).toThrow(/terminal/);
    });
    it("rejects unknown next status", () => {
      expect(() => setEntryStatusV2("e1", "weird")).toThrow(/unknown/);
    });
    it("rejects illegal transition (pending → parked)", () => {
      expect(() => parkEntryV2("e1")).toThrow(/cannot transition/);
    });
    it("throws on missing entry", () => {
      expect(() => activateEntryV2("ghost")).toThrow(/not found/);
    });
    it("enforces per-category active-entry cap on pending → active only", () => {
      setMaxActiveEntriesPerCategoryV2(2);
      registerEntryV2("e2", { category: "kb", summary: "s" });
      registerEntryV2("e3", { category: "kb", summary: "s" });
      activateEntryV2("e1");
      activateEntryV2("e2");
      expect(() => activateEntryV2("e3")).toThrow(/cap/);
    });
    it("parked → active recovery is exempt from cap", () => {
      setMaxActiveEntriesPerCategoryV2(1);
      activateEntryV2("e1");
      parkEntryV2("e1");
      registerEntryV2("e2", { category: "kb", summary: "s" });
      activateEntryV2("e2");
      expect(() => activateEntryV2("e1")).not.toThrow();
    });
    it("cap is per-category", () => {
      setMaxActiveEntriesPerCategoryV2(1);
      registerEntryV2("e2", { category: "other", summary: "s" });
      activateEntryV2("e1");
      expect(() => activateEntryV2("e2")).not.toThrow();
    });
  });

  describe("touchEntryV2", () => {
    it("updates lastSeenAt", () => {
      registerEntryV2("e1", { category: "c", summary: "s", now: 100 });
      const e = touchEntryV2("e1", { now: 500 });
      expect(e.lastSeenAt).toBe(500);
    });
    it("throws on missing entry", () => {
      expect(() => touchEntryV2("ghost")).toThrow(/not found/);
    });
  });

  describe("listEntriesV2 + getActiveEntryCountV2", () => {
    beforeEach(() => {
      registerEntryV2("e1", { category: "kb", summary: "s" });
      registerEntryV2("e2", { category: "kb", summary: "s" });
      registerEntryV2("e3", { category: "other", summary: "s" });
      activateEntryV2("e1");
      activateEntryV2("e2");
    });
    it("filters by category/status", () => {
      expect(listEntriesV2({ category: "kb" })).toHaveLength(2);
      expect(listEntriesV2({ status: "active" })).toHaveLength(2);
      expect(listEntriesV2({ status: "pending" })).toHaveLength(1);
    });
    it("counts only active per category", () => {
      expect(getActiveEntryCountV2("kb")).toBe(2);
      expect(getActiveEntryCountV2("other")).toBe(0);
    });
  });

  describe("createConsolidationJobV2", () => {
    it("creates a queued job", () => {
      const j = createConsolidationJobV2("j1", {
        source: "auto",
        scope: "daily",
      });
      expect(j.status).toBe("queued");
      expect(j.startedAt).toBeNull();
      expect(j.finishedAt).toBeNull();
    });
    it("rejects missing/invalid params", () => {
      expect(() =>
        createConsolidationJobV2("", { source: "s", scope: "x" }),
      ).toThrow();
      expect(() =>
        createConsolidationJobV2("j", { source: "", scope: "x" }),
      ).toThrow();
      expect(() =>
        createConsolidationJobV2("j", { source: "s", scope: "" }),
      ).toThrow();
    });
    it("rejects duplicate id", () => {
      createConsolidationJobV2("j1", { source: "s", scope: "x" });
      expect(() =>
        createConsolidationJobV2("j1", { source: "s", scope: "x" }),
      ).toThrow(/already exists/);
    });
  });

  describe("job transitions", () => {
    beforeEach(() => {
      createConsolidationJobV2("j1", { source: "auto", scope: "daily" });
    });
    it("queued → running stamps startedAt", () => {
      const j = startConsolidationJobV2("j1", { now: 100 });
      expect(j.status).toBe("running");
      expect(j.startedAt).toBe(100);
    });
    it("running → succeeded stamps finishedAt and is terminal", () => {
      startConsolidationJobV2("j1");
      const j = succeedConsolidationJobV2("j1", { now: 200 });
      expect(j.status).toBe("succeeded");
      expect(j.finishedAt).toBe(200);
      expect(() => failConsolidationJobV2("j1")).toThrow(/terminal/);
    });
    it("running → failed stamps finishedAt and is terminal", () => {
      startConsolidationJobV2("j1");
      const j = failConsolidationJobV2("j1", { now: 300 });
      expect(j.status).toBe("failed");
      expect(j.finishedAt).toBe(300);
    });
    it("queued → cancelled stamps finishedAt", () => {
      const j = cancelConsolidationJobV2("j1", { now: 400 });
      expect(j.status).toBe("cancelled");
      expect(j.finishedAt).toBe(400);
    });
    it("rejects unknown next status", () => {
      expect(() => setJobStatusV2("j1", "weird")).toThrow(/unknown/);
    });
    it("rejects illegal transition (queued → succeeded)", () => {
      expect(() => succeedConsolidationJobV2("j1")).toThrow(
        /cannot transition/,
      );
    });
    it("throws on missing job", () => {
      expect(() => startConsolidationJobV2("ghost")).toThrow(/not found/);
    });
    it("enforces per-source running-job cap on queued → running only", () => {
      setMaxRunningJobsPerSourceV2(1);
      createConsolidationJobV2("j2", { source: "auto", scope: "daily" });
      startConsolidationJobV2("j1");
      expect(() => startConsolidationJobV2("j2")).toThrow(/cap/);
    });
    it("cap is per-source", () => {
      setMaxRunningJobsPerSourceV2(1);
      createConsolidationJobV2("j2", { source: "user", scope: "daily" });
      startConsolidationJobV2("j1");
      expect(() => startConsolidationJobV2("j2")).not.toThrow();
    });
  });

  describe("listConsolidationJobsV2 + getRunningJobCountV2", () => {
    beforeEach(() => {
      createConsolidationJobV2("j1", { source: "auto", scope: "daily" });
      createConsolidationJobV2("j2", { source: "auto", scope: "daily" });
      createConsolidationJobV2("j3", { source: "user", scope: "weekly" });
      startConsolidationJobV2("j1");
      startConsolidationJobV2("j2");
    });
    it("filters by source/status", () => {
      expect(listConsolidationJobsV2({ source: "auto" })).toHaveLength(2);
      expect(listConsolidationJobsV2({ status: "running" })).toHaveLength(2);
      expect(listConsolidationJobsV2({ status: "queued" })).toHaveLength(1);
    });
    it("counts only running per source", () => {
      expect(getRunningJobCountV2("auto")).toBe(2);
      expect(getRunningJobCountV2("user")).toBe(0);
    });
  });

  describe("autoParkIdleEntriesV2", () => {
    it("flips active entries past idle threshold", () => {
      registerEntryV2("e1", { category: "kb", summary: "s", now: 0 });
      activateEntryV2("e1", { now: 0 });
      setEntryIdleMsV2(1000);
      const flipped = autoParkIdleEntriesV2({ now: 5000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("parked");
    });
    it("skips non-active entries", () => {
      registerEntryV2("e1", { category: "kb", summary: "s", now: 0 });
      const flipped = autoParkIdleEntriesV2({ now: 9999999 });
      expect(flipped).toHaveLength(0);
    });
    it("preserves active under idle threshold", () => {
      registerEntryV2("e1", { category: "kb", summary: "s", now: 0 });
      activateEntryV2("e1", { now: 0 });
      setEntryIdleMsV2(10000);
      const flipped = autoParkIdleEntriesV2({ now: 500 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoFailStuckJobsV2", () => {
    it("flips running past stuck threshold to failed", () => {
      createConsolidationJobV2("j1", {
        source: "auto",
        scope: "daily",
        now: 0,
      });
      startConsolidationJobV2("j1", { now: 0 });
      setJobStuckMsV2(1000);
      const flipped = autoFailStuckJobsV2({ now: 5000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("failed");
      expect(flipped[0].finishedAt).toBe(5000);
    });
    it("skips terminal jobs", () => {
      createConsolidationJobV2("j1", {
        source: "auto",
        scope: "daily",
        now: 0,
      });
      cancelConsolidationJobV2("j1", { now: 0 });
      const flipped = autoFailStuckJobsV2({ now: 9999999 });
      expect(flipped).toHaveLength(0);
    });
    it("skips queued (not running)", () => {
      createConsolidationJobV2("j1", {
        source: "auto",
        scope: "daily",
        now: 0,
      });
      setJobStuckMsV2(1);
      const flipped = autoFailStuckJobsV2({ now: 9999999 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getMemoryManagerStatsV2", () => {
    it("zero-initializes all enum keys", () => {
      const s = getMemoryManagerStatsV2();
      expect(s.entriesByStatus.pending).toBe(0);
      expect(s.entriesByStatus.active).toBe(0);
      expect(s.entriesByStatus.parked).toBe(0);
      expect(s.entriesByStatus.archived).toBe(0);
      expect(s.jobsByStatus.queued).toBe(0);
      expect(s.jobsByStatus.running).toBe(0);
      expect(s.jobsByStatus.succeeded).toBe(0);
      expect(s.jobsByStatus.failed).toBe(0);
      expect(s.jobsByStatus.cancelled).toBe(0);
      expect(s.totalEntriesV2).toBe(0);
      expect(s.totalJobsV2).toBe(0);
    });
    it("counts entries + jobs by status", () => {
      registerEntryV2("e1", { category: "c", summary: "s" });
      activateEntryV2("e1");
      createConsolidationJobV2("j1", { source: "auto", scope: "daily" });
      startConsolidationJobV2("j1");
      const s = getMemoryManagerStatsV2();
      expect(s.entriesByStatus.active).toBe(1);
      expect(s.jobsByStatus.running).toBe(1);
      expect(s.totalEntriesV2).toBe(1);
      expect(s.totalJobsV2).toBe(1);
    });
    it("includes config snapshot", () => {
      const s = getMemoryManagerStatsV2();
      expect(s.maxActiveEntriesPerCategory).toBe(200);
      expect(s.maxRunningJobsPerSource).toBe(2);
      expect(s.entryIdleMs).toBeGreaterThan(0);
      expect(s.jobStuckMs).toBeGreaterThan(0);
    });
  });
});
