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

// ─── V2 Governance Layer ────────────────────────────────────────────

import {
  SOURCE_MATURITY_V2,
  IMPORT_JOB_LIFECYCLE_V2,
  IMPORTER_DEFAULT_MAX_ACTIVE_SOURCES_PER_OWNER,
  IMPORTER_DEFAULT_MAX_PENDING_JOBS_PER_SOURCE,
  IMPORTER_DEFAULT_SOURCE_IDLE_MS,
  IMPORTER_DEFAULT_JOB_STUCK_MS,
  getMaxActiveSourcesPerOwnerV2,
  setMaxActiveSourcesPerOwnerV2,
  getMaxPendingJobsPerSourceV2,
  setMaxPendingJobsPerSourceV2,
  getSourceIdleMsV2,
  setSourceIdleMsV2,
  getJobStuckMsV2,
  setJobStuckMsV2,
  registerSourceV2,
  getSourceV2,
  listSourcesV2,
  setSourceStatusV2,
  activateSourceV2,
  pauseSourceV2,
  archiveSourceV2,
  touchSourceV2,
  getActiveSourceCountV2,
  createImportJobV2,
  getImportJobV2,
  listImportJobsV2,
  setImportJobStatusV2,
  startImportJobV2,
  completeImportJobV2,
  failImportJobV2,
  cancelImportJobV2,
  getPendingJobCountV2,
  autoPauseIdleSourcesV2,
  autoFailStuckImportJobsV2,
  getKnowledgeImporterStatsV2,
  _resetStateKnowledgeImporterV2,
} from "../../src/lib/knowledge-importer.js";

describe("Knowledge Importer V2", () => {
  beforeEach(() => {
    _resetStateKnowledgeImporterV2();
  });

  describe("frozen enums + defaults", () => {
    it("freezes SOURCE_MATURITY_V2", () => {
      expect(Object.isFrozen(SOURCE_MATURITY_V2)).toBe(true);
      expect(Object.values(SOURCE_MATURITY_V2)).toEqual([
        "pending",
        "active",
        "paused",
        "archived",
      ]);
    });

    it("freezes IMPORT_JOB_LIFECYCLE_V2", () => {
      expect(Object.isFrozen(IMPORT_JOB_LIFECYCLE_V2)).toBe(true);
      expect(Object.values(IMPORT_JOB_LIFECYCLE_V2)).toEqual([
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
      ]);
    });

    it("exposes defaults", () => {
      expect(IMPORTER_DEFAULT_MAX_ACTIVE_SOURCES_PER_OWNER).toBe(15);
      expect(IMPORTER_DEFAULT_MAX_PENDING_JOBS_PER_SOURCE).toBe(3);
      expect(IMPORTER_DEFAULT_SOURCE_IDLE_MS).toBe(7 * 24 * 60 * 60 * 1000);
      expect(IMPORTER_DEFAULT_JOB_STUCK_MS).toBe(20 * 60 * 1000);
    });
  });

  describe("config getters/setters", () => {
    it("returns defaults", () => {
      expect(getMaxActiveSourcesPerOwnerV2()).toBe(15);
      expect(getMaxPendingJobsPerSourceV2()).toBe(3);
      expect(getSourceIdleMsV2()).toBe(7 * 24 * 60 * 60 * 1000);
      expect(getJobStuckMsV2()).toBe(20 * 60 * 1000);
    });

    it("setters update + validate", () => {
      setMaxActiveSourcesPerOwnerV2(50);
      expect(getMaxActiveSourcesPerOwnerV2()).toBe(50);
      setMaxPendingJobsPerSourceV2(7);
      expect(getMaxPendingJobsPerSourceV2()).toBe(7);
      setSourceIdleMsV2(60000);
      expect(getSourceIdleMsV2()).toBe(60000);
      setJobStuckMsV2(45000);
      expect(getJobStuckMsV2()).toBe(45000);
    });

    it("setters reject non-positive integers", () => {
      expect(() => setMaxActiveSourcesPerOwnerV2(0)).toThrow();
      expect(() => setMaxActiveSourcesPerOwnerV2(-1)).toThrow();
      expect(() => setMaxActiveSourcesPerOwnerV2(NaN)).toThrow();
      expect(() => setMaxPendingJobsPerSourceV2("abc")).toThrow();
      expect(() => setSourceIdleMsV2(0)).toThrow();
      expect(() => setJobStuckMsV2(-100)).toThrow();
    });

    it("setter floors non-integer positives", () => {
      setMaxActiveSourcesPerOwnerV2(7.9);
      expect(getMaxActiveSourcesPerOwnerV2()).toBe(7);
    });
  });

  describe("registerSourceV2", () => {
    it("creates source in pending state", () => {
      const s = registerSourceV2("s1", { ownerId: "o1", label: "Notes Vault" });
      expect(s.status).toBe("pending");
      expect(s.ownerId).toBe("o1");
      expect(s.label).toBe("Notes Vault");
      expect(s.kind).toBe("markdown");
      expect(s.activatedAt).toBeNull();
      expect(s.archivedAt).toBeNull();
    });

    it("accepts kind override + metadata", () => {
      const s = registerSourceV2("s2", {
        ownerId: "o1",
        label: "ENEX",
        kind: "evernote",
        metadata: { path: "/x.enex" },
      });
      expect(s.kind).toBe("evernote");
      expect(s.metadata.path).toBe("/x.enex");
    });

    it("rejects missing required fields", () => {
      expect(() => registerSourceV2()).toThrow();
      expect(() => registerSourceV2("s1")).toThrow();
      expect(() => registerSourceV2("s1", { ownerId: "o1" })).toThrow();
      expect(() => registerSourceV2("s1", { label: "L" })).toThrow();
    });

    it("rejects duplicate id", () => {
      registerSourceV2("s1", { ownerId: "o1", label: "L" });
      expect(() =>
        registerSourceV2("s1", { ownerId: "o1", label: "L" }),
      ).toThrow();
    });

    it("returns defensive copy", () => {
      const s = registerSourceV2("s1", {
        ownerId: "o1",
        label: "L",
        metadata: { k: 1 },
      });
      s.metadata.k = 999;
      expect(getSourceV2("s1").metadata.k).toBe(1);
    });
  });

  describe("source state machine", () => {
    beforeEach(() => {
      registerSourceV2("s1", { ownerId: "o1", label: "L" });
    });

    it("pending → active stamps activatedAt", () => {
      const s = activateSourceV2("s1");
      expect(s.status).toBe("active");
      expect(s.activatedAt).toBeTruthy();
    });

    it("active → paused → active preserves activatedAt", () => {
      const s1 = activateSourceV2("s1");
      const t1 = s1.activatedAt;
      pauseSourceV2("s1");
      const s2 = activateSourceV2("s1");
      expect(s2.activatedAt).toBe(t1);
    });

    it("→ archived stamps archivedAt + is terminal", () => {
      const s = archiveSourceV2("s1");
      expect(s.status).toBe("archived");
      expect(s.archivedAt).toBeTruthy();
      expect(() => activateSourceV2("s1")).toThrow();
    });

    it("rejects invalid transitions", () => {
      expect(() => pauseSourceV2("s1")).toThrow(); // pending → paused not allowed
      activateSourceV2("s1");
      expect(() => setSourceStatusV2("s1", "pending")).toThrow();
    });

    it("setSourceStatusV2 unknown id throws", () => {
      expect(() => setSourceStatusV2("nope", "active")).toThrow();
    });

    it("touchSourceV2 updates lastSeenAt", async () => {
      const before = getSourceV2("s1").lastSeenAt;
      await new Promise((r) => setTimeout(r, 5));
      const t = touchSourceV2("s1");
      expect(t.lastSeenAt).toBeGreaterThanOrEqual(before);
    });

    it("touchSourceV2 unknown id throws", () => {
      expect(() => touchSourceV2("nope")).toThrow();
    });
  });

  describe("per-owner active-source cap", () => {
    it("blocks pending → active beyond cap", () => {
      setMaxActiveSourcesPerOwnerV2(2);
      registerSourceV2("a", { ownerId: "o1", label: "A" });
      registerSourceV2("b", { ownerId: "o1", label: "B" });
      registerSourceV2("c", { ownerId: "o1", label: "C" });
      activateSourceV2("a");
      activateSourceV2("b");
      expect(() => activateSourceV2("c")).toThrow(/cap/i);
    });

    it("paused → active recovery is exempt from cap", () => {
      setMaxActiveSourcesPerOwnerV2(2);
      registerSourceV2("a", { ownerId: "o1", label: "A" });
      registerSourceV2("b", { ownerId: "o1", label: "B" });
      activateSourceV2("a");
      activateSourceV2("b");
      pauseSourceV2("a");
      // even though already at cap with b active + recovering a, recovery should pass
      const s = activateSourceV2("a");
      expect(s.status).toBe("active");
    });

    it("scopes by owner", () => {
      setMaxActiveSourcesPerOwnerV2(1);
      registerSourceV2("a", { ownerId: "o1", label: "A" });
      registerSourceV2("b", { ownerId: "o2", label: "B" });
      activateSourceV2("a");
      activateSourceV2("b");
      expect(getActiveSourceCountV2("o1")).toBe(1);
      expect(getActiveSourceCountV2("o2")).toBe(1);
    });
  });

  describe("listSourcesV2", () => {
    it("lists all + filters by owner/status", () => {
      registerSourceV2("a", { ownerId: "o1", label: "A" });
      registerSourceV2("b", { ownerId: "o1", label: "B" });
      registerSourceV2("c", { ownerId: "o2", label: "C" });
      activateSourceV2("a");
      expect(listSourcesV2()).toHaveLength(3);
      expect(listSourcesV2({ ownerId: "o1" })).toHaveLength(2);
      expect(listSourcesV2({ status: "active" })).toHaveLength(1);
      expect(listSourcesV2({ ownerId: "o2", status: "pending" })).toHaveLength(
        1,
      );
    });
  });

  describe("createImportJobV2", () => {
    beforeEach(() => {
      registerSourceV2("s1", { ownerId: "o1", label: "L" });
    });

    it("creates job in queued state", () => {
      const j = createImportJobV2("j1", { sourceId: "s1" });
      expect(j.status).toBe("queued");
      expect(j.sourceId).toBe("s1");
      expect(j.kind).toBe("scan");
      expect(j.startedAt).toBeNull();
      expect(j.settledAt).toBeNull();
    });

    it("accepts kind + metadata", () => {
      const j = createImportJobV2("j1", {
        sourceId: "s1",
        kind: "delta",
        metadata: { since: 100 },
      });
      expect(j.kind).toBe("delta");
      expect(j.metadata.since).toBe(100);
    });

    it("rejects missing required", () => {
      expect(() => createImportJobV2()).toThrow();
      expect(() => createImportJobV2("j1")).toThrow();
    });

    it("rejects unknown source", () => {
      expect(() => createImportJobV2("j1", { sourceId: "nope" })).toThrow();
    });

    it("rejects duplicate", () => {
      createImportJobV2("j1", { sourceId: "s1" });
      expect(() => createImportJobV2("j1", { sourceId: "s1" })).toThrow();
    });

    it("enforces per-source pending cap (queued + running)", () => {
      setMaxPendingJobsPerSourceV2(2);
      createImportJobV2("a", { sourceId: "s1" });
      createImportJobV2("b", { sourceId: "s1" });
      expect(() => createImportJobV2("c", { sourceId: "s1" })).toThrow(/cap/i);
      // promote b to running — still counts toward cap
      startImportJobV2("b");
      expect(() => createImportJobV2("c", { sourceId: "s1" })).toThrow(/cap/i);
      // settle one to free a slot
      completeImportJobV2("b");
      const c = createImportJobV2("c", { sourceId: "s1" });
      expect(c.status).toBe("queued");
    });
  });

  describe("import job state machine", () => {
    beforeEach(() => {
      registerSourceV2("s1", { ownerId: "o1", label: "L" });
      createImportJobV2("j1", { sourceId: "s1" });
    });

    it("queued → running stamps startedAt", () => {
      const j = startImportJobV2("j1");
      expect(j.status).toBe("running");
      expect(j.startedAt).toBeTruthy();
    });

    it("running → completed stamps settledAt", () => {
      startImportJobV2("j1");
      const j = completeImportJobV2("j1");
      expect(j.status).toBe("completed");
      expect(j.settledAt).toBeTruthy();
    });

    it("running → failed stamps settledAt", () => {
      startImportJobV2("j1");
      const j = failImportJobV2("j1");
      expect(j.status).toBe("failed");
      expect(j.settledAt).toBeTruthy();
    });

    it("queued → cancelled stamps settledAt", () => {
      const j = cancelImportJobV2("j1");
      expect(j.status).toBe("cancelled");
      expect(j.settledAt).toBeTruthy();
    });

    it("completed is terminal", () => {
      startImportJobV2("j1");
      completeImportJobV2("j1");
      expect(() => startImportJobV2("j1")).toThrow();
      expect(() => failImportJobV2("j1")).toThrow();
    });

    it("cannot start cancelled job", () => {
      cancelImportJobV2("j1");
      expect(() => startImportJobV2("j1")).toThrow();
    });

    it("rejects invalid transitions", () => {
      expect(() => completeImportJobV2("j1")).toThrow(); // queued → completed not allowed
      expect(() => failImportJobV2("j1")).toThrow();
    });

    it("setImportJobStatusV2 unknown id throws", () => {
      expect(() => setImportJobStatusV2("nope", "running")).toThrow();
    });
  });

  describe("listImportJobsV2", () => {
    it("filters by source/status", () => {
      registerSourceV2("s1", { ownerId: "o1", label: "L" });
      registerSourceV2("s2", { ownerId: "o1", label: "L2" });
      createImportJobV2("a", { sourceId: "s1" });
      createImportJobV2("b", { sourceId: "s1" });
      createImportJobV2("c", { sourceId: "s2" });
      startImportJobV2("a");
      expect(listImportJobsV2()).toHaveLength(3);
      expect(listImportJobsV2({ sourceId: "s1" })).toHaveLength(2);
      expect(listImportJobsV2({ status: "running" })).toHaveLength(1);
      expect(
        listImportJobsV2({ sourceId: "s2", status: "queued" }),
      ).toHaveLength(1);
    });
  });

  describe("autoPauseIdleSourcesV2", () => {
    it("flips active sources past idle threshold to paused", () => {
      registerSourceV2("s1", { ownerId: "o1", label: "L" });
      activateSourceV2("s1");
      const s = getSourceV2("s1");
      const future = s.lastSeenAt + getSourceIdleMsV2() + 1000;
      const flipped = autoPauseIdleSourcesV2({ now: future });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("paused");
      expect(getSourceV2("s1").status).toBe("paused");
    });

    it("leaves fresh sources alone", () => {
      registerSourceV2("s1", { ownerId: "o1", label: "L" });
      activateSourceV2("s1");
      const flipped = autoPauseIdleSourcesV2({ now: Date.now() });
      expect(flipped).toHaveLength(0);
    });

    it("ignores non-active sources", () => {
      registerSourceV2("s1", { ownerId: "o1", label: "L" });
      // pending — never activated
      const flipped = autoPauseIdleSourcesV2({
        now: Date.now() + getSourceIdleMsV2() + 1000,
      });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoFailStuckImportJobsV2", () => {
    beforeEach(() => {
      registerSourceV2("s1", { ownerId: "o1", label: "L" });
      createImportJobV2("j1", { sourceId: "s1" });
    });

    it("flips stuck running jobs to failed", () => {
      startImportJobV2("j1");
      const j = getImportJobV2("j1");
      const future = j.lastSeenAt + getJobStuckMsV2() + 1000;
      const flipped = autoFailStuckImportJobsV2({ now: future });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("failed");
      expect(flipped[0].settledAt).toBeTruthy();
    });

    it("leaves queued jobs alone", () => {
      const flipped = autoFailStuckImportJobsV2({
        now: Date.now() + getJobStuckMsV2() + 1000,
      });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getKnowledgeImporterStatsV2", () => {
    it("zero state", () => {
      const s = getKnowledgeImporterStatsV2();
      expect(s.totalSourcesV2).toBe(0);
      expect(s.totalImportJobsV2).toBe(0);
      expect(s.maxActiveSourcesPerOwner).toBe(15);
      expect(s.maxPendingJobsPerSource).toBe(3);
      expect(s.sourcesByStatus).toEqual({
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
      registerSourceV2("a", { ownerId: "o1", label: "A" });
      registerSourceV2("b", { ownerId: "o1", label: "B" });
      activateSourceV2("a");
      createImportJobV2("j1", { sourceId: "a" });
      startImportJobV2("j1");
      const s = getKnowledgeImporterStatsV2();
      expect(s.totalSourcesV2).toBe(2);
      expect(s.sourcesByStatus.active).toBe(1);
      expect(s.sourcesByStatus.pending).toBe(1);
      expect(s.totalImportJobsV2).toBe(1);
      expect(s.jobsByStatus.running).toBe(1);
    });
  });

  describe("counts", () => {
    it("getActiveSourceCountV2 / getPendingJobCountV2", () => {
      registerSourceV2("a", { ownerId: "o1", label: "A" });
      registerSourceV2("b", { ownerId: "o1", label: "B" });
      activateSourceV2("a");
      activateSourceV2("b");
      expect(getActiveSourceCountV2("o1")).toBe(2);
      pauseSourceV2("a");
      expect(getActiveSourceCountV2("o1")).toBe(1);

      createImportJobV2("j1", { sourceId: "a" });
      createImportJobV2("j2", { sourceId: "a" });
      expect(getPendingJobCountV2("a")).toBe(2);
      startImportJobV2("j1");
      expect(getPendingJobCountV2("a")).toBe(2); // running still counts
      completeImportJobV2("j1");
      expect(getPendingJobCountV2("a")).toBe(1); // terminal does not count
    });
  });

  describe("_resetStateKnowledgeImporterV2", () => {
    it("clears state + restores defaults", () => {
      registerSourceV2("a", { ownerId: "o1", label: "A" });
      setMaxActiveSourcesPerOwnerV2(99);
      _resetStateKnowledgeImporterV2();
      expect(listSourcesV2()).toHaveLength(0);
      expect(getMaxActiveSourcesPerOwnerV2()).toBe(15);
    });
  });
});
