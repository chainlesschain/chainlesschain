/**
 * KnowledgeHandler — Phase 6.3 step 3 测试
 *
 * 覆盖新加 10 method:
 *   archiveNote / restoreNote / getArchivedNotes
 *   exportNote / exportNotes / importNote / importFromFile
 *   mergeTags / addTagsToNote / removeTagsFromNote
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const Database = require("better-sqlite3-multiple-ciphers");
const KnowledgeHandler = require("../handlers/knowledge-handler");

function wrapAsyncDb(db) {
  return {
    async run(sql, args = []) {
      const stmt = db.prepare(sql);
      const info = stmt.run(...args);
      return { lastID: info.lastInsertRowid, changes: info.changes };
    },
    async get(sql, args = []) {
      return db.prepare(sql).get(...args);
    },
    async all(sql, args = []) {
      return db.prepare(sql).all(...args);
    },
  };
}

describe("KnowledgeHandler — Phase 6.3 step 3 (archive + import-export + tags advanced)", () => {
  let handler;
  let dbInner;
  let db;
  const ctx = { did: "did:test:phone" };

  beforeEach(async () => {
    dbInner = new Database(":memory:");
    dbInner
      .prepare(
        `CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          content TEXT DEFAULT '',
          tags TEXT DEFAULT '[]',
          category TEXT DEFAULT 'general',
          created_by_did TEXT,
          created_at INTEGER DEFAULT 0,
          updated_at INTEGER DEFAULT 0,
          deleted_at TEXT DEFAULT NULL
        )`,
      )
      .run();
    dbInner.pragma("foreign_keys = ON");
    db = wrapAsyncDb(dbInner);
    handler = new KnowledgeHandler(db, null);
  });

  afterEach(() => {
    dbInner.close();
  });

  async function makeNote(title = "T", content = "C", tags = []) {
    const r = await handler.handle("createNote", { title, content, tags }, ctx);
    return r.noteId;
  }

  // ===== Schema =====

  describe("_ensureSchema (step 3 — archived column)", () => {
    it("adds archived column to notes", async () => {
      await handler.handle("getFolders", {}, ctx);
      const cols = dbInner
        .prepare("PRAGMA table_info(notes)")
        .all()
        .map((c) => c.name);
      expect(cols).toContain("archived");
    });
  });

  // ===== Archive (3) =====

  describe("archiveNote / restoreNote / getArchivedNotes", () => {
    it("archiveNote sets archived=1", async () => {
      const id = await makeNote("A", "body");
      const r = await handler.handle("archiveNote", { noteId: id }, ctx);
      expect(r.archived).toBe(true);
      const row = dbInner
        .prepare("SELECT archived FROM notes WHERE id = ?")
        .get(id);
      expect(row.archived).toBe(1);
    });

    it("restoreNote sets archived=0", async () => {
      const id = await makeNote("A", "body");
      await handler.handle("archiveNote", { noteId: id }, ctx);
      const r = await handler.handle("restoreNote", { noteId: id }, ctx);
      expect(r.archived).toBe(false);
      const row = dbInner
        .prepare("SELECT archived FROM notes WHERE id = ?")
        .get(id);
      expect(row.archived).toBe(0);
    });

    it("getArchivedNotes filters by archived=1", async () => {
      const a = await makeNote("Archived", "x");
      const b = await makeNote("Active", "y");
      await handler.handle("archiveNote", { noteId: a }, ctx);
      const r = await handler.handle("getArchivedNotes", {}, ctx);
      expect(r.total).toBe(1);
      expect(r.notes[0].id).toBe(a);
      expect(r.notes[0].id).not.toBe(b);
    });

    it("getArchivedNotes respects limit/offset", async () => {
      for (let i = 0; i < 5; i += 1) {
        const id = await makeNote(`N${i}`, "x");
        await handler.handle("archiveNote", { noteId: id }, ctx);
      }
      const r = await handler.handle(
        "getArchivedNotes",
        { limit: 2, offset: 1 },
        ctx,
      );
      expect(r.total).toBe(2);
    });

    it("archiveNote throws on missing noteId", async () => {
      await expect(handler.handle("archiveNote", {}, ctx)).rejects.toThrow(
        "Note ID is required",
      );
    });

    it("archiveNote throws on non-existent note", async () => {
      await expect(
        handler.handle("archiveNote", { noteId: 99999 }, ctx),
      ).rejects.toThrow("Note not found");
    });

    it("restoreNote throws on missing noteId", async () => {
      await expect(handler.handle("restoreNote", {}, ctx)).rejects.toThrow(
        "Note ID is required",
      );
    });

    it("archived notes still appear in getNotes (no filter)", async () => {
      const a = await makeNote("X", "x");
      await handler.handle("archiveNote", { noteId: a }, ctx);
      const r = await handler.handle("getNotes", {}, ctx);
      expect(r.notes.some((n) => n.id === a)).toBe(true);
    });
  });

  // ===== Export (2) =====

  describe("exportNote / exportNotes", () => {
    it("exportNote markdown format prefixes title H1", async () => {
      const id = await makeNote("Title", "Body content", ["t1"]);
      const r = await handler.handle(
        "exportNote",
        { noteId: id, format: "markdown" },
        ctx,
      );
      expect(r.format).toBe("markdown");
      expect(r.mime).toBe("text/markdown");
      expect(r.content).toContain("# Title");
      expect(r.content).toContain("Body content");
      expect(r.content).toContain("tags: t1");
    });

    it("exportNote markdown omits tags line if empty", async () => {
      const id = await makeNote("Title", "Body");
      const r = await handler.handle("exportNote", { noteId: id }, ctx);
      expect(r.content).toContain("# Title");
      expect(r.content).not.toContain("tags:");
    });

    it("exportNote json format returns parsed structure", async () => {
      const id = await makeNote("T", "C", ["x"]);
      const r = await handler.handle(
        "exportNote",
        { noteId: id, format: "json" },
        ctx,
      );
      expect(r.mime).toBe("application/json");
      const parsed = JSON.parse(r.content);
      expect(parsed.title).toBe("T");
      expect(parsed.content).toBe("C");
      expect(parsed.tags).toEqual(["x"]);
    });

    it("exportNote html format escapes HTML chars", async () => {
      const id = await makeNote("<script>", "alert(1) & </script>");
      const r = await handler.handle(
        "exportNote",
        { noteId: id, format: "html" },
        ctx,
      );
      expect(r.mime).toBe("text/html");
      expect(r.content).toContain("&lt;script&gt;");
      expect(r.content).toContain("&amp;");
      expect(r.content).not.toContain("<script>");
    });

    it("exportNote throws on missing noteId", async () => {
      await expect(handler.handle("exportNote", {}, ctx)).rejects.toThrow(
        "Note ID is required",
      );
    });

    it("exportNote throws on non-existent note", async () => {
      await expect(
        handler.handle("exportNote", { noteId: 99999 }, ctx),
      ).rejects.toThrow("Note not found");
    });

    it("exportNotes bulk by noteIds returns all", async () => {
      const a = await makeNote("A", "a");
      const b = await makeNote("B", "b");
      const r = await handler.handle(
        "exportNotes",
        { noteIds: [a, b], format: "markdown" },
        ctx,
      );
      expect(r.total).toBe(2);
      expect(r.notes[0].noteId).toBe(a);
      expect(r.notes[1].noteId).toBe(b);
    });

    it("exportNotes by folderId enumerates folder contents", async () => {
      const folder = await handler.handle("createFolder", { name: "F" }, ctx);
      const a = await makeNote("A", "a");
      const b = await makeNote("B", "b");
      // 手动 move into folder
      await db.run("UPDATE notes SET folder_id = ? WHERE id IN (?, ?)", [
        folder.folderId,
        a,
        b,
      ]);
      const r = await handler.handle(
        "exportNotes",
        { folderId: folder.folderId },
        ctx,
      );
      expect(r.total).toBe(2);
    });

    it("exportNotes throws on missing noteIds and folderId", async () => {
      await expect(handler.handle("exportNotes", {}, ctx)).rejects.toThrow(
        "noteIds[] or folderId is required",
      );
    });

    it("exportNotes captures per-note error and continues", async () => {
      const a = await makeNote("A", "a");
      const r = await handler.handle(
        "exportNotes",
        { noteIds: [a, 99999] },
        ctx,
      );
      expect(r.total).toBe(2);
      expect(r.notes[0].noteId).toBe(a);
      expect(r.notes[1].error).toContain("Note not found");
    });
  });

  // ===== Import (2) =====

  describe("importNote / importFromFile", () => {
    it("importNote creates note with title+content", async () => {
      const r = await handler.handle(
        "importNote",
        { title: "Imported", content: "Body" },
        ctx,
      );
      expect(r.imported).toBe(true);
      const row = dbInner
        .prepare("SELECT title, content FROM notes WHERE id = ?")
        .get(r.noteId);
      expect(row.title).toBe("Imported");
      expect(row.content).toBe("Body");
    });

    it("importNote accepts tags + folderId", async () => {
      const folder = await handler.handle("createFolder", { name: "F" }, ctx);
      const r = await handler.handle(
        "importNote",
        {
          title: "T",
          content: "C",
          tags: ["a", "b"],
          folderId: folder.folderId,
        },
        ctx,
      );
      const row = dbInner
        .prepare("SELECT tags, folder_id FROM notes WHERE id = ?")
        .get(r.noteId);
      expect(JSON.parse(row.tags)).toEqual(["a", "b"]);
      expect(row.folder_id).toBe(folder.folderId);
    });

    it("importNote throws on missing title", async () => {
      await expect(
        handler.handle("importNote", { content: "x" }, ctx),
      ).rejects.toThrow("Title and content are required");
    });

    it("importFromFile parses markdown H1 as title", async () => {
      const r = await handler.handle(
        "importFromFile",
        {
          filename: "draft.md",
          content: "# Real Title\n\nBody line 1\nBody line 2",
        },
        ctx,
      );
      const row = dbInner
        .prepare("SELECT title, content FROM notes WHERE id = ?")
        .get(r.noteId);
      expect(row.title).toBe("Real Title");
      expect(row.content).toContain("Body line 1");
    });

    it("importFromFile markdown without H1 falls back to filename", async () => {
      const r = await handler.handle(
        "importFromFile",
        { filename: "note.md", content: "Just body, no H1" },
        ctx,
      );
      const row = dbInner
        .prepare("SELECT title, content FROM notes WHERE id = ?")
        .get(r.noteId);
      expect(row.title).toBe("note");
      expect(row.content).toBe("Just body, no H1");
    });

    it("importFromFile json parses structured payload", async () => {
      const r = await handler.handle(
        "importFromFile",
        {
          filename: "data.json",
          content: JSON.stringify({
            title: "From JSON",
            content: "JSON body",
            tags: ["j1", "j2"],
          }),
        },
        ctx,
      );
      const row = dbInner
        .prepare("SELECT title, content, tags FROM notes WHERE id = ?")
        .get(r.noteId);
      expect(row.title).toBe("From JSON");
      expect(row.content).toBe("JSON body");
      expect(JSON.parse(row.tags)).toEqual(["j1", "j2"]);
    });

    it("importFromFile json with invalid payload throws", async () => {
      await expect(
        handler.handle(
          "importFromFile",
          { filename: "x.json", content: "not-json {" },
          ctx,
        ),
      ).rejects.toThrow("Invalid JSON content");
    });

    it("importFromFile txt uses filename as title", async () => {
      const r = await handler.handle(
        "importFromFile",
        { filename: "memo.txt", content: "raw text" },
        ctx,
      );
      const row = dbInner
        .prepare("SELECT title, content FROM notes WHERE id = ?")
        .get(r.noteId);
      expect(row.title).toBe("memo");
      expect(row.content).toBe("raw text");
    });

    it("importFromFile explicit format wins over extension", async () => {
      const r = await handler.handle(
        "importFromFile",
        {
          filename: "thing.txt",
          format: "markdown",
          content: "# Header\n\nbody",
        },
        ctx,
      );
      const row = dbInner
        .prepare("SELECT title FROM notes WHERE id = ?")
        .get(r.noteId);
      expect(row.title).toBe("Header");
    });

    it("importFromFile throws on missing filename or content", async () => {
      await expect(
        handler.handle("importFromFile", { content: "x" }, ctx),
      ).rejects.toThrow("filename and content are required");
    });
  });

  // ===== Tags advanced (3) =====

  describe("addTagsToNote / removeTagsFromNote / mergeTags", () => {
    it("addTagsToNote merges new tags (dedup)", async () => {
      const id = await makeNote("T", "C", ["old1"]);
      const r = await handler.handle(
        "addTagsToNote",
        { noteId: id, tags: ["old1", "new1", "new2"] },
        ctx,
      );
      expect(r.tags).toEqual(["old1", "new1", "new2"]); // old1 dedup
      expect(r.added).toBe(3);
    });

    it("addTagsToNote throws on missing noteId / non-array", async () => {
      await expect(
        handler.handle("addTagsToNote", { tags: [] }, ctx),
      ).rejects.toThrow("Note ID is required");
      const id = await makeNote("T", "C");
      await expect(
        handler.handle("addTagsToNote", { noteId: id, tags: "nope" }, ctx),
      ).rejects.toThrow("tags must be an array");
    });

    it("addTagsToNote throws on non-existent note", async () => {
      await expect(
        handler.handle("addTagsToNote", { noteId: 99999, tags: ["x"] }, ctx),
      ).rejects.toThrow("Note not found");
    });

    it("removeTagsFromNote filters out specified tags", async () => {
      const id = await makeNote("T", "C", ["a", "b", "c"]);
      const r = await handler.handle(
        "removeTagsFromNote",
        { noteId: id, tags: ["b"] },
        ctx,
      );
      expect(r.tags).toEqual(["a", "c"]);
      expect(r.removed).toBe(1);
    });

    it("removeTagsFromNote no-op when tag absent", async () => {
      const id = await makeNote("T", "C", ["a"]);
      const r = await handler.handle(
        "removeTagsFromNote",
        { noteId: id, tags: ["z"] },
        ctx,
      );
      expect(r.tags).toEqual(["a"]);
      expect(r.removed).toBe(0);
    });

    it("mergeTags by name rewrites all notes' tags JSON", async () => {
      const n1 = await makeNote("T1", "C", ["work", "x"]);
      const n2 = await makeNote("T2", "C", ["work"]);
      const n3 = await makeNote("T3", "C", ["other"]);
      // Pre-create source tag (would normally exist)
      await handler.handle("createTag", { name: "work" }, ctx);
      const r = await handler.handle(
        "mergeTags",
        { sourceName: "work", targetName: "job" },
        ctx,
      );
      expect(r.merged).toBe(true);
      expect(r.notesUpdated).toBe(2);
      const r1 = JSON.parse(
        dbInner.prepare("SELECT tags FROM notes WHERE id = ?").get(n1).tags,
      );
      expect(r1).toEqual(["job", "x"]);
      const r2 = JSON.parse(
        dbInner.prepare("SELECT tags FROM notes WHERE id = ?").get(n2).tags,
      );
      expect(r2).toEqual(["job"]);
      const r3 = JSON.parse(
        dbInner.prepare("SELECT tags FROM notes WHERE id = ?").get(n3).tags,
      );
      expect(r3).toEqual(["other"]);
      // Source tag row deleted
      const srcRow = dbInner
        .prepare("SELECT * FROM tags WHERE name = ?")
        .get("work");
      expect(srcRow).toBeUndefined();
    });

    it("mergeTags dedupes when target already in note", async () => {
      const n1 = await makeNote("T", "C", ["work", "job"]);
      const r = await handler.handle(
        "mergeTags",
        { sourceName: "work", targetName: "job" },
        ctx,
      );
      expect(r.notesUpdated).toBe(1);
      const tags = JSON.parse(
        dbInner.prepare("SELECT tags FROM notes WHERE id = ?").get(n1).tags,
      );
      expect(tags).toEqual(["job"]); // dedup
    });

    it("mergeTags throws when source = target", async () => {
      await expect(
        handler.handle(
          "mergeTags",
          { sourceName: "same", targetName: "same" },
          ctx,
        ),
      ).rejects.toThrow("Source and target tags are the same");
    });

    it("mergeTags throws on missing source/target", async () => {
      await expect(
        handler.handle("mergeTags", { targetName: "x" }, ctx),
      ).rejects.toThrow("sourceTagId or sourceName is required");
      await expect(
        handler.handle("mergeTags", { sourceName: "x" }, ctx),
      ).rejects.toThrow("targetTagId or targetName is required");
    });

    it("mergeTags by tagId resolves to name", async () => {
      const t1 = await handler.handle("createTag", { name: "src" }, ctx);
      const t2 = await handler.handle("createTag", { name: "tgt" }, ctx);
      const n1 = await makeNote("T", "C", ["src"]);
      const r = await handler.handle(
        "mergeTags",
        { sourceTagId: t1.tagId, targetTagId: t2.tagId },
        ctx,
      );
      expect(r.sourceName).toBe("src");
      expect(r.targetName).toBe("tgt");
      expect(r.notesUpdated).toBe(1);
      const tags = JSON.parse(
        dbInner.prepare("SELECT tags FROM notes WHERE id = ?").get(n1).tags,
      );
      expect(tags).toEqual(["tgt"]);
    });

    it("mergeTags throws when tagId not found", async () => {
      await expect(
        handler.handle(
          "mergeTags",
          { sourceTagId: "no-such", targetName: "tgt" },
          ctx,
        ),
      ).rejects.toThrow("Source tag not found");
    });
  });
});
