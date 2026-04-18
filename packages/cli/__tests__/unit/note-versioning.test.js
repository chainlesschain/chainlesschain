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

// ═══════════════════════════════════════════════════════════════
// V2 Surface — Note governance layer
// ═══════════════════════════════════════════════════════════════

import {
  NOTE_MATURITY_V2,
  REVISION_LIFECYCLE_V2,
  NOTE_DEFAULT_MAX_ACTIVE_NOTES_PER_AUTHOR,
  NOTE_DEFAULT_MAX_OPEN_REVS_PER_NOTE,
  NOTE_DEFAULT_NOTE_IDLE_MS,
  NOTE_DEFAULT_REV_STUCK_MS,
  getMaxActiveNotesPerAuthorV2,
  setMaxActiveNotesPerAuthorV2,
  getMaxOpenRevsPerNoteV2,
  setMaxOpenRevsPerNoteV2,
  getNoteIdleMsV2,
  setNoteIdleMsV2,
  getRevStuckMsV2,
  setRevStuckMsV2,
  getActiveNoteCountV2,
  getOpenRevCountV2,
  registerNoteV2,
  getNoteV2,
  listNotesV2,
  setNoteStatusV2,
  activateNoteV2,
  lockNoteV2,
  archiveNoteV2,
  touchNoteV2,
  createRevisionV2,
  getRevisionV2,
  listRevisionsV2,
  setRevisionStatusV2,
  reviewRevisionV2,
  applyRevisionV2,
  supersedeRevisionV2,
  discardRevisionV2,
  autoLockIdleNotesV2,
  autoDiscardStaleRevisionsV2,
  getNoteVersioningStatsV2,
  _resetStateNoteVersioningV2,
} from "../../src/lib/note-versioning.js";

describe("Note Versioning V2", () => {
  beforeEach(() => {
    _resetStateNoteVersioningV2();
  });

  describe("enums", () => {
    it("NOTE_MATURITY_V2 is frozen with 4 states", () => {
      expect(Object.values(NOTE_MATURITY_V2)).toEqual([
        "draft",
        "active",
        "locked",
        "archived",
      ]);
      expect(Object.isFrozen(NOTE_MATURITY_V2)).toBe(true);
    });
    it("REVISION_LIFECYCLE_V2 is frozen with 5 states", () => {
      expect(Object.values(REVISION_LIFECYCLE_V2)).toEqual([
        "proposed",
        "reviewed",
        "applied",
        "superseded",
        "discarded",
      ]);
      expect(Object.isFrozen(REVISION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config defaults & setters", () => {
    it("exposes defaults", () => {
      expect(NOTE_DEFAULT_MAX_ACTIVE_NOTES_PER_AUTHOR).toBe(100);
      expect(NOTE_DEFAULT_MAX_OPEN_REVS_PER_NOTE).toBe(10);
      expect(NOTE_DEFAULT_NOTE_IDLE_MS).toBe(1000 * 60 * 60 * 24 * 30);
      expect(NOTE_DEFAULT_REV_STUCK_MS).toBe(1000 * 60 * 60 * 24 * 7);
    });
    it("getters return current values", () => {
      expect(getMaxActiveNotesPerAuthorV2()).toBe(100);
      expect(getMaxOpenRevsPerNoteV2()).toBe(10);
      expect(getNoteIdleMsV2()).toBeGreaterThan(0);
      expect(getRevStuckMsV2()).toBeGreaterThan(0);
    });
    it("setters update values and floor non-integers", () => {
      setMaxActiveNotesPerAuthorV2(11.7);
      expect(getMaxActiveNotesPerAuthorV2()).toBe(11);
      setMaxOpenRevsPerNoteV2(3.9);
      expect(getMaxOpenRevsPerNoteV2()).toBe(3);
      setNoteIdleMsV2(99);
      expect(getNoteIdleMsV2()).toBe(99);
      setRevStuckMsV2(11);
      expect(getRevStuckMsV2()).toBe(11);
    });
    it("setters reject zero/negative/NaN", () => {
      expect(() => setMaxActiveNotesPerAuthorV2(0)).toThrow();
      expect(() => setMaxOpenRevsPerNoteV2(-1)).toThrow();
      expect(() => setNoteIdleMsV2(NaN)).toThrow();
      expect(() => setRevStuckMsV2(0)).toThrow();
    });
    it("_resetStateNoteVersioningV2 restores defaults", () => {
      setMaxActiveNotesPerAuthorV2(99);
      setMaxOpenRevsPerNoteV2(99);
      setNoteIdleMsV2(99);
      setRevStuckMsV2(99);
      _resetStateNoteVersioningV2();
      expect(getMaxActiveNotesPerAuthorV2()).toBe(100);
      expect(getMaxOpenRevsPerNoteV2()).toBe(10);
      expect(getNoteIdleMsV2()).toBe(NOTE_DEFAULT_NOTE_IDLE_MS);
      expect(getRevStuckMsV2()).toBe(NOTE_DEFAULT_REV_STUCK_MS);
    });
  });

  describe("registerNoteV2", () => {
    it("creates a draft note", () => {
      const n = registerNoteV2("n1", { authorId: "u1", title: "T" });
      expect(n.id).toBe("n1");
      expect(n.status).toBe("draft");
      expect(n.activatedAt).toBeNull();
      expect(n.archivedAt).toBeNull();
    });
    it("rejects missing/invalid params", () => {
      expect(() => registerNoteV2("", { authorId: "u", title: "T" })).toThrow();
      expect(() => registerNoteV2("n", { authorId: "", title: "T" })).toThrow();
      expect(() => registerNoteV2("n", { authorId: "u", title: "" })).toThrow();
    });
    it("rejects duplicate id", () => {
      registerNoteV2("n1", { authorId: "u", title: "T" });
      expect(() => registerNoteV2("n1", { authorId: "u", title: "T" })).toThrow(
        /already exists/,
      );
    });
    it("returns defensive copy", () => {
      const n = registerNoteV2("n1", {
        authorId: "u",
        title: "T",
        metadata: { tag: "x" },
      });
      n.metadata.tag = "mutated";
      expect(getNoteV2("n1").metadata.tag).toBe("x");
    });
  });

  describe("note transitions", () => {
    beforeEach(() => {
      registerNoteV2("n1", { authorId: "u1", title: "T" });
    });
    it("draft → active stamps activatedAt", () => {
      const n = activateNoteV2("n1", { now: 1000 });
      expect(n.status).toBe("active");
      expect(n.activatedAt).toBe(1000);
    });
    it("active → locked → active recovery preserves activatedAt", () => {
      const a = activateNoteV2("n1", { now: 1000 });
      lockNoteV2("n1", { now: 2000 });
      const r = activateNoteV2("n1", { now: 3000 });
      expect(r.status).toBe("active");
      expect(r.activatedAt).toBe(a.activatedAt);
    });
    it("→ archived stamps archivedAt and is terminal", () => {
      activateNoteV2("n1");
      const ar = archiveNoteV2("n1", { now: 5000 });
      expect(ar.status).toBe("archived");
      expect(ar.archivedAt).toBe(5000);
      expect(() => activateNoteV2("n1")).toThrow(/terminal/);
    });
    it("rejects unknown next status", () => {
      expect(() => setNoteStatusV2("n1", "weird")).toThrow(/unknown/);
    });
    it("rejects illegal transition (draft → locked)", () => {
      expect(() => lockNoteV2("n1")).toThrow(/cannot transition/);
    });
    it("throws on missing note", () => {
      expect(() => activateNoteV2("ghost")).toThrow(/not found/);
    });
    it("enforces per-author active-note cap on draft → active only", () => {
      setMaxActiveNotesPerAuthorV2(2);
      registerNoteV2("n2", { authorId: "u1", title: "T" });
      registerNoteV2("n3", { authorId: "u1", title: "T" });
      activateNoteV2("n1");
      activateNoteV2("n2");
      expect(() => activateNoteV2("n3")).toThrow(/cap/);
    });
    it("locked → active recovery is exempt from cap", () => {
      setMaxActiveNotesPerAuthorV2(1);
      activateNoteV2("n1");
      lockNoteV2("n1");
      registerNoteV2("n2", { authorId: "u1", title: "T" });
      activateNoteV2("n2");
      expect(() => activateNoteV2("n1")).not.toThrow();
    });
    it("cap is per-author", () => {
      setMaxActiveNotesPerAuthorV2(1);
      registerNoteV2("n2", { authorId: "u2", title: "T" });
      activateNoteV2("n1");
      expect(() => activateNoteV2("n2")).not.toThrow();
    });
  });

  describe("touchNoteV2", () => {
    it("updates lastSeenAt", () => {
      registerNoteV2("n1", { authorId: "u", title: "T", now: 100 });
      const n = touchNoteV2("n1", { now: 500 });
      expect(n.lastSeenAt).toBe(500);
    });
    it("throws on missing note", () => {
      expect(() => touchNoteV2("ghost")).toThrow(/not found/);
    });
  });

  describe("listNotesV2 + getActiveNoteCountV2", () => {
    beforeEach(() => {
      registerNoteV2("n1", { authorId: "u1", title: "T" });
      registerNoteV2("n2", { authorId: "u1", title: "T" });
      registerNoteV2("n3", { authorId: "u2", title: "T" });
      activateNoteV2("n1");
      activateNoteV2("n2");
    });
    it("filters by authorId/status", () => {
      expect(listNotesV2({ authorId: "u1" })).toHaveLength(2);
      expect(listNotesV2({ status: "active" })).toHaveLength(2);
      expect(listNotesV2({ status: "draft" })).toHaveLength(1);
    });
    it("counts only active per author", () => {
      expect(getActiveNoteCountV2("u1")).toBe(2);
      expect(getActiveNoteCountV2("u2")).toBe(0);
    });
  });

  describe("createRevisionV2", () => {
    beforeEach(() => {
      registerNoteV2("n1", { authorId: "u", title: "T" });
    });
    it("creates a proposed revision", () => {
      const r = createRevisionV2("r1", { noteId: "n1", summary: "edit" });
      expect(r.status).toBe("proposed");
      expect(r.reviewedAt).toBeNull();
      expect(r.appliedAt).toBeNull();
      expect(r.settledAt).toBeNull();
    });
    it("rejects missing/invalid params", () => {
      expect(() =>
        createRevisionV2("", { noteId: "n1", summary: "s" }),
      ).toThrow();
      expect(() =>
        createRevisionV2("r", { noteId: "", summary: "s" }),
      ).toThrow();
      expect(() =>
        createRevisionV2("r", { noteId: "n1", summary: "" }),
      ).toThrow();
    });
    it("rejects duplicate id", () => {
      createRevisionV2("r1", { noteId: "n1", summary: "s" });
      expect(() =>
        createRevisionV2("r1", { noteId: "n1", summary: "s" }),
      ).toThrow(/already exists/);
    });
    it("enforces per-note open-revision cap at create time", () => {
      setMaxOpenRevsPerNoteV2(2);
      createRevisionV2("r1", { noteId: "n1", summary: "s" });
      createRevisionV2("r2", { noteId: "n1", summary: "s" });
      expect(() =>
        createRevisionV2("r3", { noteId: "n1", summary: "s" }),
      ).toThrow(/cap/);
    });
    it("cap counts proposed + reviewed", () => {
      setMaxOpenRevsPerNoteV2(2);
      createRevisionV2("r1", { noteId: "n1", summary: "s" });
      reviewRevisionV2("r1");
      createRevisionV2("r2", { noteId: "n1", summary: "s" });
      expect(() =>
        createRevisionV2("r3", { noteId: "n1", summary: "s" }),
      ).toThrow(/cap/);
    });
    it("cap excludes applied/superseded/discarded", () => {
      setMaxOpenRevsPerNoteV2(2);
      createRevisionV2("r1", { noteId: "n1", summary: "s" });
      reviewRevisionV2("r1");
      applyRevisionV2("r1");
      createRevisionV2("r2", { noteId: "n1", summary: "s" });
      expect(() =>
        createRevisionV2("r3", { noteId: "n1", summary: "s" }),
      ).not.toThrow();
    });
  });

  describe("revision transitions", () => {
    beforeEach(() => {
      registerNoteV2("n1", { authorId: "u", title: "T" });
      createRevisionV2("r1", { noteId: "n1", summary: "s" });
    });
    it("proposed → reviewed stamps reviewedAt", () => {
      const r = reviewRevisionV2("r1", { now: 100 });
      expect(r.status).toBe("reviewed");
      expect(r.reviewedAt).toBe(100);
    });
    it("reviewed → applied stamps appliedAt (NOT settledAt — applied non-terminal)", () => {
      reviewRevisionV2("r1");
      const r = applyRevisionV2("r1", { now: 200 });
      expect(r.status).toBe("applied");
      expect(r.appliedAt).toBe(200);
      expect(r.settledAt).toBeNull();
    });
    it("applied → superseded stamps settledAt and is terminal", () => {
      reviewRevisionV2("r1");
      applyRevisionV2("r1");
      const r = supersedeRevisionV2("r1", { now: 300 });
      expect(r.status).toBe("superseded");
      expect(r.settledAt).toBe(300);
      expect(() => discardRevisionV2("r1")).toThrow(/terminal/);
    });
    it("reviewed → discarded stamps settledAt and is terminal", () => {
      reviewRevisionV2("r1");
      const r = discardRevisionV2("r1", { now: 400 });
      expect(r.status).toBe("discarded");
      expect(r.settledAt).toBe(400);
    });
    it("reviewed → superseded is allowed (without going through applied)", () => {
      reviewRevisionV2("r1");
      const r = supersedeRevisionV2("r1");
      expect(r.status).toBe("superseded");
    });
    it("proposed cannot apply directly", () => {
      expect(() => applyRevisionV2("r1")).toThrow(/cannot transition/);
    });
    it("rejects unknown next status", () => {
      expect(() => setRevisionStatusV2("r1", "weird")).toThrow(/unknown/);
    });
    it("throws on missing revision", () => {
      expect(() => reviewRevisionV2("ghost")).toThrow(/not found/);
    });
  });

  describe("listRevisionsV2 + getOpenRevCountV2", () => {
    beforeEach(() => {
      registerNoteV2("n1", { authorId: "u", title: "T" });
      registerNoteV2("n2", { authorId: "u", title: "T" });
      createRevisionV2("r1", { noteId: "n1", summary: "s" });
      createRevisionV2("r2", { noteId: "n1", summary: "s" });
      createRevisionV2("r3", { noteId: "n2", summary: "s" });
      reviewRevisionV2("r2");
      discardRevisionV2("r3");
    });
    it("filters by noteId/status", () => {
      expect(listRevisionsV2({ noteId: "n1" })).toHaveLength(2);
      expect(listRevisionsV2({ noteId: "n2" })).toHaveLength(1);
      expect(listRevisionsV2({ status: "proposed" })).toHaveLength(1);
      expect(listRevisionsV2({ status: "discarded" })).toHaveLength(1);
    });
    it("counts open (proposed+reviewed) per note", () => {
      expect(getOpenRevCountV2("n1")).toBe(2);
      expect(getOpenRevCountV2("n2")).toBe(0);
    });
  });

  describe("autoLockIdleNotesV2", () => {
    it("flips active notes past idle threshold", () => {
      registerNoteV2("n1", { authorId: "u", title: "T", now: 0 });
      activateNoteV2("n1", { now: 0 });
      setNoteIdleMsV2(1000);
      const flipped = autoLockIdleNotesV2({ now: 5000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("locked");
    });
    it("skips non-active notes", () => {
      registerNoteV2("n1", { authorId: "u", title: "T", now: 0 });
      const flipped = autoLockIdleNotesV2({ now: 9999999 });
      expect(flipped).toHaveLength(0);
    });
    it("preserves active under idle threshold", () => {
      registerNoteV2("n1", { authorId: "u", title: "T", now: 0 });
      activateNoteV2("n1", { now: 0 });
      setNoteIdleMsV2(10000);
      const flipped = autoLockIdleNotesV2({ now: 500 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoDiscardStaleRevisionsV2", () => {
    it("flips proposed/reviewed past stuck threshold to discarded", () => {
      registerNoteV2("n1", { authorId: "u", title: "T" });
      createRevisionV2("r1", { noteId: "n1", summary: "s", now: 0 });
      createRevisionV2("r2", { noteId: "n1", summary: "s", now: 0 });
      reviewRevisionV2("r2", { now: 0 });
      setRevStuckMsV2(1000);
      const flipped = autoDiscardStaleRevisionsV2({ now: 5000 });
      expect(flipped).toHaveLength(2);
      expect(flipped.every((r) => r.status === "discarded")).toBe(true);
      expect(flipped.every((r) => r.settledAt === 5000)).toBe(true);
    });
    it("skips terminal revisions", () => {
      registerNoteV2("n1", { authorId: "u", title: "T" });
      createRevisionV2("r1", { noteId: "n1", summary: "s", now: 0 });
      discardRevisionV2("r1", { now: 0 });
      const flipped = autoDiscardStaleRevisionsV2({ now: 9999999 });
      expect(flipped).toHaveLength(0);
    });
    it("skips applied (not open)", () => {
      registerNoteV2("n1", { authorId: "u", title: "T" });
      createRevisionV2("r1", { noteId: "n1", summary: "s", now: 0 });
      reviewRevisionV2("r1", { now: 0 });
      applyRevisionV2("r1", { now: 0 });
      setRevStuckMsV2(1);
      const flipped = autoDiscardStaleRevisionsV2({ now: 9999999 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getNoteVersioningStatsV2", () => {
    it("zero-initializes all enum keys", () => {
      const s = getNoteVersioningStatsV2();
      expect(s.notesByStatus.draft).toBe(0);
      expect(s.notesByStatus.active).toBe(0);
      expect(s.notesByStatus.locked).toBe(0);
      expect(s.notesByStatus.archived).toBe(0);
      expect(s.revisionsByStatus.proposed).toBe(0);
      expect(s.revisionsByStatus.reviewed).toBe(0);
      expect(s.revisionsByStatus.applied).toBe(0);
      expect(s.revisionsByStatus.superseded).toBe(0);
      expect(s.revisionsByStatus.discarded).toBe(0);
      expect(s.totalNotesV2).toBe(0);
      expect(s.totalRevisionsV2).toBe(0);
    });
    it("counts notes + revisions by status", () => {
      registerNoteV2("n1", { authorId: "u", title: "T" });
      activateNoteV2("n1");
      createRevisionV2("r1", { noteId: "n1", summary: "s" });
      reviewRevisionV2("r1");
      const s = getNoteVersioningStatsV2();
      expect(s.notesByStatus.active).toBe(1);
      expect(s.revisionsByStatus.reviewed).toBe(1);
      expect(s.totalNotesV2).toBe(1);
      expect(s.totalRevisionsV2).toBe(1);
    });
    it("includes config snapshot", () => {
      const s = getNoteVersioningStatsV2();
      expect(s.maxActiveNotesPerAuthor).toBe(100);
      expect(s.maxOpenRevsPerNote).toBe(10);
      expect(s.noteIdleMs).toBeGreaterThan(0);
      expect(s.revStuckMs).toBeGreaterThan(0);
    });
  });
});
