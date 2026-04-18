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

// ─── V2 Governance Layer ────────────────────────────────────────────

import {
  TARGET_MATURITY_V2,
  EXPORT_JOB_LIFECYCLE_V2,
  EXPORTER_DEFAULT_MAX_ACTIVE_TARGETS_PER_OWNER,
  EXPORTER_DEFAULT_MAX_PENDING_JOBS_PER_TARGET,
  EXPORTER_DEFAULT_TARGET_IDLE_MS,
  EXPORTER_DEFAULT_JOB_STUCK_MS,
  getMaxActiveTargetsPerOwnerV2,
  setMaxActiveTargetsPerOwnerV2,
  getMaxPendingJobsPerTargetV2,
  setMaxPendingJobsPerTargetV2,
  getTargetIdleMsV2,
  setTargetIdleMsV2,
  getJobStuckMsV2 as getExporterJobStuckMsV2,
  setJobStuckMsV2 as setExporterJobStuckMsV2,
  registerTargetV2,
  getTargetV2,
  listTargetsV2,
  setTargetStatusV2,
  activateTargetV2,
  pauseTargetV2,
  archiveTargetV2,
  touchTargetV2,
  getActiveTargetCountV2,
  createExportJobV2,
  getExportJobV2,
  listExportJobsV2,
  setExportJobStatusV2,
  startExportJobV2,
  completeExportJobV2,
  failExportJobV2,
  cancelExportJobV2,
  getPendingJobCountV2 as getExporterPendingJobCountV2,
  autoPauseIdleTargetsV2,
  autoFailStuckExportJobsV2,
  getKnowledgeExporterStatsV2,
  _resetStateKnowledgeExporterV2,
} from "../../src/lib/knowledge-exporter.js";

describe("Knowledge Exporter V2", () => {
  beforeEach(() => {
    _resetStateKnowledgeExporterV2();
  });

  describe("frozen enums + defaults", () => {
    it("freezes TARGET_MATURITY_V2", () => {
      expect(Object.isFrozen(TARGET_MATURITY_V2)).toBe(true);
      expect(Object.values(TARGET_MATURITY_V2)).toEqual([
        "pending",
        "active",
        "paused",
        "archived",
      ]);
    });

    it("freezes EXPORT_JOB_LIFECYCLE_V2", () => {
      expect(Object.isFrozen(EXPORT_JOB_LIFECYCLE_V2)).toBe(true);
      expect(Object.values(EXPORT_JOB_LIFECYCLE_V2)).toEqual([
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
      ]);
    });

    it("exposes defaults", () => {
      expect(EXPORTER_DEFAULT_MAX_ACTIVE_TARGETS_PER_OWNER).toBe(12);
      expect(EXPORTER_DEFAULT_MAX_PENDING_JOBS_PER_TARGET).toBe(3);
      expect(EXPORTER_DEFAULT_TARGET_IDLE_MS).toBe(14 * 24 * 60 * 60 * 1000);
      expect(EXPORTER_DEFAULT_JOB_STUCK_MS).toBe(25 * 60 * 1000);
    });
  });

  describe("config getters/setters", () => {
    it("returns defaults", () => {
      expect(getMaxActiveTargetsPerOwnerV2()).toBe(12);
      expect(getMaxPendingJobsPerTargetV2()).toBe(3);
      expect(getTargetIdleMsV2()).toBe(14 * 24 * 60 * 60 * 1000);
      expect(getExporterJobStuckMsV2()).toBe(25 * 60 * 1000);
    });

    it("setters update + validate", () => {
      setMaxActiveTargetsPerOwnerV2(50);
      expect(getMaxActiveTargetsPerOwnerV2()).toBe(50);
      setMaxPendingJobsPerTargetV2(5);
      expect(getMaxPendingJobsPerTargetV2()).toBe(5);
      setTargetIdleMsV2(60000);
      expect(getTargetIdleMsV2()).toBe(60000);
      setExporterJobStuckMsV2(45000);
      expect(getExporterJobStuckMsV2()).toBe(45000);
    });

    it("setters reject non-positive integers", () => {
      expect(() => setMaxActiveTargetsPerOwnerV2(0)).toThrow();
      expect(() => setMaxActiveTargetsPerOwnerV2(-1)).toThrow();
      expect(() => setMaxActiveTargetsPerOwnerV2(NaN)).toThrow();
      expect(() => setMaxPendingJobsPerTargetV2("abc")).toThrow();
      expect(() => setTargetIdleMsV2(0)).toThrow();
      expect(() => setExporterJobStuckMsV2(-1)).toThrow();
    });

    it("setter floors non-integer positives", () => {
      setMaxActiveTargetsPerOwnerV2(7.9);
      expect(getMaxActiveTargetsPerOwnerV2()).toBe(7);
    });
  });

  describe("registerTargetV2", () => {
    it("creates target in pending state", () => {
      const t = registerTargetV2("t1", { ownerId: "o1", label: "Site Export" });
      expect(t.status).toBe("pending");
      expect(t.ownerId).toBe("o1");
      expect(t.label).toBe("Site Export");
      expect(t.format).toBe("markdown");
      expect(t.activatedAt).toBeNull();
      expect(t.archivedAt).toBeNull();
    });

    it("accepts format override + metadata", () => {
      const t = registerTargetV2("t2", {
        ownerId: "o1",
        label: "HTML",
        format: "site",
        metadata: { dest: "/out" },
      });
      expect(t.format).toBe("site");
      expect(t.metadata.dest).toBe("/out");
    });

    it("rejects missing required fields", () => {
      expect(() => registerTargetV2()).toThrow();
      expect(() => registerTargetV2("t1")).toThrow();
      expect(() => registerTargetV2("t1", { ownerId: "o1" })).toThrow();
      expect(() => registerTargetV2("t1", { label: "L" })).toThrow();
    });

    it("rejects duplicate id", () => {
      registerTargetV2("t1", { ownerId: "o1", label: "L" });
      expect(() =>
        registerTargetV2("t1", { ownerId: "o1", label: "L" }),
      ).toThrow();
    });

    it("returns defensive copy", () => {
      const t = registerTargetV2("t1", {
        ownerId: "o1",
        label: "L",
        metadata: { k: 1 },
      });
      t.metadata.k = 999;
      expect(getTargetV2("t1").metadata.k).toBe(1);
    });
  });

  describe("target state machine", () => {
    beforeEach(() => {
      registerTargetV2("t1", { ownerId: "o1", label: "L" });
    });

    it("pending → active stamps activatedAt", () => {
      const t = activateTargetV2("t1");
      expect(t.status).toBe("active");
      expect(t.activatedAt).toBeTruthy();
    });

    it("active → paused → active preserves activatedAt", () => {
      const t1 = activateTargetV2("t1");
      const stamp = t1.activatedAt;
      pauseTargetV2("t1");
      const t2 = activateTargetV2("t1");
      expect(t2.activatedAt).toBe(stamp);
    });

    it("→ archived stamps archivedAt + is terminal", () => {
      const t = archiveTargetV2("t1");
      expect(t.status).toBe("archived");
      expect(t.archivedAt).toBeTruthy();
      expect(() => activateTargetV2("t1")).toThrow();
    });

    it("rejects invalid transitions", () => {
      expect(() => pauseTargetV2("t1")).toThrow(); // pending → paused not allowed
      activateTargetV2("t1");
      expect(() => setTargetStatusV2("t1", "pending")).toThrow();
    });

    it("setTargetStatusV2 unknown id throws", () => {
      expect(() => setTargetStatusV2("nope", "active")).toThrow();
    });

    it("touchTargetV2 updates lastSeenAt", async () => {
      const before = getTargetV2("t1").lastSeenAt;
      await new Promise((r) => setTimeout(r, 5));
      const t = touchTargetV2("t1");
      expect(t.lastSeenAt).toBeGreaterThanOrEqual(before);
    });

    it("touchTargetV2 unknown id throws", () => {
      expect(() => touchTargetV2("nope")).toThrow();
    });
  });

  describe("per-owner active-target cap", () => {
    it("blocks pending → active beyond cap", () => {
      setMaxActiveTargetsPerOwnerV2(2);
      registerTargetV2("a", { ownerId: "o1", label: "A" });
      registerTargetV2("b", { ownerId: "o1", label: "B" });
      registerTargetV2("c", { ownerId: "o1", label: "C" });
      activateTargetV2("a");
      activateTargetV2("b");
      expect(() => activateTargetV2("c")).toThrow(/cap/i);
    });

    it("paused → active recovery is exempt from cap", () => {
      setMaxActiveTargetsPerOwnerV2(2);
      registerTargetV2("a", { ownerId: "o1", label: "A" });
      registerTargetV2("b", { ownerId: "o1", label: "B" });
      activateTargetV2("a");
      activateTargetV2("b");
      pauseTargetV2("a");
      const t = activateTargetV2("a");
      expect(t.status).toBe("active");
    });

    it("scopes by owner", () => {
      setMaxActiveTargetsPerOwnerV2(1);
      registerTargetV2("a", { ownerId: "o1", label: "A" });
      registerTargetV2("b", { ownerId: "o2", label: "B" });
      activateTargetV2("a");
      activateTargetV2("b");
      expect(getActiveTargetCountV2("o1")).toBe(1);
      expect(getActiveTargetCountV2("o2")).toBe(1);
    });
  });

  describe("listTargetsV2", () => {
    it("lists all + filters by owner/status", () => {
      registerTargetV2("a", { ownerId: "o1", label: "A" });
      registerTargetV2("b", { ownerId: "o1", label: "B" });
      registerTargetV2("c", { ownerId: "o2", label: "C" });
      activateTargetV2("a");
      expect(listTargetsV2()).toHaveLength(3);
      expect(listTargetsV2({ ownerId: "o1" })).toHaveLength(2);
      expect(listTargetsV2({ status: "active" })).toHaveLength(1);
      expect(listTargetsV2({ ownerId: "o2", status: "pending" })).toHaveLength(
        1,
      );
    });
  });

  describe("createExportJobV2", () => {
    beforeEach(() => {
      registerTargetV2("t1", { ownerId: "o1", label: "L" });
    });

    it("creates job in queued state", () => {
      const j = createExportJobV2("j1", { targetId: "t1" });
      expect(j.status).toBe("queued");
      expect(j.targetId).toBe("t1");
      expect(j.kind).toBe("snapshot");
      expect(j.startedAt).toBeNull();
      expect(j.settledAt).toBeNull();
    });

    it("accepts kind + metadata", () => {
      const j = createExportJobV2("j1", {
        targetId: "t1",
        kind: "incremental",
        metadata: { since: 100 },
      });
      expect(j.kind).toBe("incremental");
      expect(j.metadata.since).toBe(100);
    });

    it("rejects missing required", () => {
      expect(() => createExportJobV2()).toThrow();
      expect(() => createExportJobV2("j1")).toThrow();
    });

    it("rejects unknown target", () => {
      expect(() => createExportJobV2("j1", { targetId: "nope" })).toThrow();
    });

    it("rejects duplicate", () => {
      createExportJobV2("j1", { targetId: "t1" });
      expect(() => createExportJobV2("j1", { targetId: "t1" })).toThrow();
    });

    it("enforces per-target pending cap (queued + running)", () => {
      setMaxPendingJobsPerTargetV2(2);
      createExportJobV2("a", { targetId: "t1" });
      createExportJobV2("b", { targetId: "t1" });
      expect(() => createExportJobV2("c", { targetId: "t1" })).toThrow(/cap/i);
      startExportJobV2("b");
      expect(() => createExportJobV2("c", { targetId: "t1" })).toThrow(/cap/i);
      completeExportJobV2("b");
      const c = createExportJobV2("c", { targetId: "t1" });
      expect(c.status).toBe("queued");
    });
  });

  describe("export job state machine", () => {
    beforeEach(() => {
      registerTargetV2("t1", { ownerId: "o1", label: "L" });
      createExportJobV2("j1", { targetId: "t1" });
    });

    it("queued → running stamps startedAt", () => {
      const j = startExportJobV2("j1");
      expect(j.status).toBe("running");
      expect(j.startedAt).toBeTruthy();
    });

    it("running → completed stamps settledAt", () => {
      startExportJobV2("j1");
      const j = completeExportJobV2("j1");
      expect(j.status).toBe("completed");
      expect(j.settledAt).toBeTruthy();
    });

    it("running → failed stamps settledAt", () => {
      startExportJobV2("j1");
      const j = failExportJobV2("j1");
      expect(j.status).toBe("failed");
      expect(j.settledAt).toBeTruthy();
    });

    it("queued → cancelled stamps settledAt", () => {
      const j = cancelExportJobV2("j1");
      expect(j.status).toBe("cancelled");
      expect(j.settledAt).toBeTruthy();
    });

    it("completed is terminal", () => {
      startExportJobV2("j1");
      completeExportJobV2("j1");
      expect(() => startExportJobV2("j1")).toThrow();
      expect(() => failExportJobV2("j1")).toThrow();
    });

    it("cannot start cancelled job", () => {
      cancelExportJobV2("j1");
      expect(() => startExportJobV2("j1")).toThrow();
    });

    it("rejects invalid transitions", () => {
      expect(() => completeExportJobV2("j1")).toThrow(); // queued → completed not allowed
      expect(() => failExportJobV2("j1")).toThrow();
    });

    it("setExportJobStatusV2 unknown id throws", () => {
      expect(() => setExportJobStatusV2("nope", "running")).toThrow();
    });
  });

  describe("listExportJobsV2", () => {
    it("filters by target/status", () => {
      registerTargetV2("t1", { ownerId: "o1", label: "L" });
      registerTargetV2("t2", { ownerId: "o1", label: "L2" });
      createExportJobV2("a", { targetId: "t1" });
      createExportJobV2("b", { targetId: "t1" });
      createExportJobV2("c", { targetId: "t2" });
      startExportJobV2("a");
      expect(listExportJobsV2()).toHaveLength(3);
      expect(listExportJobsV2({ targetId: "t1" })).toHaveLength(2);
      expect(listExportJobsV2({ status: "running" })).toHaveLength(1);
      expect(
        listExportJobsV2({ targetId: "t2", status: "queued" }),
      ).toHaveLength(1);
    });
  });

  describe("autoPauseIdleTargetsV2", () => {
    it("flips active targets past idle threshold to paused", () => {
      registerTargetV2("t1", { ownerId: "o1", label: "L" });
      activateTargetV2("t1");
      const t = getTargetV2("t1");
      const future = t.lastSeenAt + getTargetIdleMsV2() + 1000;
      const flipped = autoPauseIdleTargetsV2({ now: future });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("paused");
      expect(getTargetV2("t1").status).toBe("paused");
    });

    it("leaves fresh targets alone", () => {
      registerTargetV2("t1", { ownerId: "o1", label: "L" });
      activateTargetV2("t1");
      const flipped = autoPauseIdleTargetsV2({ now: Date.now() });
      expect(flipped).toHaveLength(0);
    });

    it("ignores non-active targets", () => {
      registerTargetV2("t1", { ownerId: "o1", label: "L" });
      const flipped = autoPauseIdleTargetsV2({
        now: Date.now() + getTargetIdleMsV2() + 1000,
      });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoFailStuckExportJobsV2", () => {
    beforeEach(() => {
      registerTargetV2("t1", { ownerId: "o1", label: "L" });
      createExportJobV2("j1", { targetId: "t1" });
    });

    it("flips stuck running jobs to failed", () => {
      startExportJobV2("j1");
      const j = getExportJobV2("j1");
      const future = j.lastSeenAt + getExporterJobStuckMsV2() + 1000;
      const flipped = autoFailStuckExportJobsV2({ now: future });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("failed");
      expect(flipped[0].settledAt).toBeTruthy();
    });

    it("leaves queued jobs alone", () => {
      const flipped = autoFailStuckExportJobsV2({
        now: Date.now() + getExporterJobStuckMsV2() + 1000,
      });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getKnowledgeExporterStatsV2", () => {
    it("zero state", () => {
      const s = getKnowledgeExporterStatsV2();
      expect(s.totalTargetsV2).toBe(0);
      expect(s.totalExportJobsV2).toBe(0);
      expect(s.maxActiveTargetsPerOwner).toBe(12);
      expect(s.maxPendingJobsPerTarget).toBe(3);
      expect(s.targetsByStatus).toEqual({
        pending: 0,
        active: 0,
        paused: 0,
        archived: 0,
      });
      expect(s.jobsByStatus).toEqual({
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      });
    });

    it("counts after operations", () => {
      registerTargetV2("a", { ownerId: "o1", label: "A" });
      registerTargetV2("b", { ownerId: "o1", label: "B" });
      activateTargetV2("a");
      createExportJobV2("j1", { targetId: "a" });
      startExportJobV2("j1");
      const s = getKnowledgeExporterStatsV2();
      expect(s.totalTargetsV2).toBe(2);
      expect(s.targetsByStatus.active).toBe(1);
      expect(s.targetsByStatus.pending).toBe(1);
      expect(s.totalExportJobsV2).toBe(1);
      expect(s.jobsByStatus.running).toBe(1);
    });
  });

  describe("counts", () => {
    it("getActiveTargetCountV2 / getPendingJobCountV2", () => {
      registerTargetV2("a", { ownerId: "o1", label: "A" });
      registerTargetV2("b", { ownerId: "o1", label: "B" });
      activateTargetV2("a");
      activateTargetV2("b");
      expect(getActiveTargetCountV2("o1")).toBe(2);
      pauseTargetV2("a");
      expect(getActiveTargetCountV2("o1")).toBe(1);

      createExportJobV2("j1", { targetId: "a" });
      createExportJobV2("j2", { targetId: "a" });
      expect(getExporterPendingJobCountV2("a")).toBe(2);
      startExportJobV2("j1");
      expect(getExporterPendingJobCountV2("a")).toBe(2);
      completeExportJobV2("j1");
      expect(getExporterPendingJobCountV2("a")).toBe(1);
    });
  });

  describe("_resetStateKnowledgeExporterV2", () => {
    it("clears state + restores defaults", () => {
      registerTargetV2("a", { ownerId: "o1", label: "A" });
      setMaxActiveTargetsPerOwnerV2(99);
      _resetStateKnowledgeExporterV2();
      expect(listTargetsV2()).toHaveLength(0);
      expect(getMaxActiveTargetsPerOwnerV2()).toBe(12);
    });
  });
});
