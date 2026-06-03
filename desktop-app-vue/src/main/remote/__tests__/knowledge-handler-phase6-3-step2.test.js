/**
 * KnowledgeHandler — Phase 6.3 step 2 测试
 *
 * 覆盖新加 10 method:
 *   getNoteHistory / getNoteVersion / restoreNoteVersion / compareVersions
 *   starNote / getStarredNotes / pinNote / getPinnedNotes /
 *   getRecentlyEdited / getRecentlyViewed
 *
 * 复用 step 1 测试的 wrapAsyncDb pattern。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const Database = require("better-sqlite3-multiple-ciphers");
const KnowledgeHandler = require("../handlers/knowledge-handler");

function wrapAsyncDb(db) {
  return {
    async run(sql, args = []) {
      const stmt = db.prepare(sql);
      const info = stmt.run(...args);
      return {
        lastID: info.lastInsertRowid,
        changes: info.changes,
      };
    },
    async get(sql, args = []) {
      return db.prepare(sql).get(...args);
    },
    async all(sql, args = []) {
      return db.prepare(sql).all(...args);
    },
  };
}

describe("KnowledgeHandler — Phase 6.3 step 2 (versions + star/pin)", () => {
  let handler;
  let dbInner;
  let db;
  const ctx = { did: "did:test:phone" };

  beforeEach(async () => {
    dbInner = new Database(":memory:");
    dbInner
      .prepare(
        // 含 created_by_did 列 (既有 createNote 需要) + id INTEGER AUTOINCREMENT 兼容
        // SQLite 默认 INTEGER PRIMARY KEY = rowid，省略 AUTOINCREMENT 仍工作。
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

  // 创建一条 note 并返其 id (复用 createNote — 它要求 title + content)
  async function makeNote(title = "T", content = "C", tags = []) {
    const r = await handler.handle("createNote", { title, content, tags }, ctx);
    return String(r.noteId);
  }

  // ===== Schema =====

  describe("_ensureSchema (step 2 additions)", () => {
    it("creates knowledge_note_versions + adds starred/pinned/last_viewed_at columns", async () => {
      await handler.handle("getFolders", {}, ctx); // 任意 method 触发 ensure

      const tables = dbInner
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name);
      expect(tables).toContain("knowledge_note_versions");

      const cols = dbInner
        .prepare("PRAGMA table_info(notes)")
        .all()
        .map((c) => c.name);
      expect(cols).toContain("starred");
      expect(cols).toContain("pinned");
      expect(cols).toContain("last_viewed_at");
    });
  });

  // ===== Versions =====

  describe("Versions", () => {
    it("updateNote auto-snapshots prior state to versions", async () => {
      const id = await makeNote("Original", "Body v1");
      // 修改一次 — 应自动 snapshot 原版
      await handler.handle(
        "updateNote",
        { noteId: id, content: "Body v2" },
        ctx,
      );

      const hist = await handler.handle("getNoteHistory", { noteId: id }, ctx);
      expect(hist.total).toBe(1); // 1 个历史快照 = 修改前的 v1
      expect(hist.versions[0].title).toBe("Original");
    });

    it("multiple updates create cumulative version history (DESC version)", async () => {
      const id = await makeNote("T", "C1");
      await handler.handle("updateNote", { noteId: id, content: "C2" }, ctx);
      await handler.handle("updateNote", { noteId: id, content: "C3" }, ctx);
      await handler.handle("updateNote", { noteId: id, content: "C4" }, ctx);

      const hist = await handler.handle("getNoteHistory", { noteId: id }, ctx);
      expect(hist.total).toBe(3); // 3 snapshots (修改前 v1, v2, v3)
      expect(hist.versions[0].version_number).toBe(3);
      expect(hist.versions[2].version_number).toBe(1);
    });

    it("getNoteHistory rejects missing noteId", async () => {
      await expect(handler.handle("getNoteHistory", {}, ctx)).rejects.toThrow(
        /Note ID/,
      );
    });

    it("getNoteVersion by id", async () => {
      const id = await makeNote("T1", "Original");
      await handler.handle("updateNote", { noteId: id, content: "New" }, ctx);
      const hist = await handler.handle("getNoteHistory", { noteId: id }, ctx);
      const versionId = hist.versions[0].id;
      const v = await handler.handle("getNoteVersion", { versionId }, ctx);
      expect(v.version.content).toBe("Original");
    });

    it("getNoteVersion by noteId + versionNumber", async () => {
      const id = await makeNote("T1", "v1");
      await handler.handle("updateNote", { noteId: id, content: "v2" }, ctx);
      const v = await handler.handle(
        "getNoteVersion",
        { noteId: id, versionNumber: 1 },
        ctx,
      );
      expect(v.version.content).toBe("v1");
    });

    it("getNoteVersion rejects bad params", async () => {
      await expect(handler.handle("getNoteVersion", {}, ctx)).rejects.toThrow(
        /versionId or/,
      );
    });

    it("getNoteVersion throws when not found", async () => {
      await expect(
        handler.handle("getNoteVersion", { versionId: "nope" }, ctx),
      ).rejects.toThrow(/not found/);
    });

    it("restoreNoteVersion reverts content + snapshots current as new version", async () => {
      const id = await makeNote("T", "v1");
      await handler.handle("updateNote", { noteId: id, content: "v2" }, ctx);
      await handler.handle("updateNote", { noteId: id, content: "v3" }, ctx);
      // 此时 history: v2, v1 (按版本 DESC)

      const r = await handler.handle(
        "restoreNoteVersion",
        { noteId: id, versionNumber: 1 },
        ctx,
      );
      expect(r.restoredFromVersion).toBe(1);

      // notes.content 应回到 v1
      const note = await handler.handle("getNoteById", { noteId: id }, ctx);
      expect(note.content).toBe("v1");

      // history 应多 1 个 snapshot (restore 前的 v3)
      const hist = await handler.handle("getNoteHistory", { noteId: id }, ctx);
      expect(hist.total).toBe(3); // v1 + v2 + v3 (restored 前 snapshot)
    });

    it("compareVersions returns diff summary", async () => {
      const id = await makeNote("Original Title", "Body 1");
      await handler.handle(
        "updateNote",
        { noteId: id, title: "New Title", content: "Body 2 with more text" },
        ctx,
      );
      // History 此时只有 1 版 (修改前)，加多一次 update 触发 v2
      await handler.handle(
        "updateNote",
        { noteId: id, content: "Body 3" },
        ctx,
      );

      const r = await handler.handle(
        "compareVersions",
        { noteId: id, versionA: 1, versionB: 2 },
        ctx,
      );
      expect(r.diff.titleChanged).toBe(true); // 1: Original, 2: New
      expect(r.diff.contentChanged).toBe(true);
      expect(r.diff.contentSizeDelta).toBeGreaterThan(0); // 2 longer
    });

    it("compareVersions rejects missing params", async () => {
      await expect(
        handler.handle("compareVersions", { noteId: "x" }, ctx),
      ).rejects.toThrow(/required/);
    });

    it("compareVersions throws when version not found", async () => {
      const id = await makeNote();
      await handler.handle("updateNote", { noteId: id, content: "x" }, ctx);
      await expect(
        handler.handle(
          "compareVersions",
          { noteId: id, versionA: 1, versionB: 99 },
          ctx,
        ),
      ).rejects.toThrow(/not found/);
    });
  });

  // ===== Star / Pin =====

  describe("Star / Pin", () => {
    it("starNote toggles when no explicit value", async () => {
      const id = await makeNote();
      const r1 = await handler.handle("starNote", { noteId: id }, ctx);
      expect(r1.starred).toBe(true);
      const r2 = await handler.handle("starNote", { noteId: id }, ctx);
      expect(r2.starred).toBe(false);
    });

    it("starNote explicit set", async () => {
      const id = await makeNote();
      await handler.handle("starNote", { noteId: id, starred: true }, ctx);
      const r = await handler.handle(
        "starNote",
        { noteId: id, starred: true },
        ctx,
      );
      expect(r.starred).toBe(true); // 仍 true (没 toggle)
    });

    it("starNote throws when note not found", async () => {
      await expect(
        handler.handle("starNote", { noteId: "999" }, ctx),
      ).rejects.toThrow(/not found/);
    });

    it("getStarredNotes filters correctly", async () => {
      const a = await makeNote("A");
      const b = await makeNote("B");
      await makeNote("C");
      await handler.handle("starNote", { noteId: a, starred: true }, ctx);
      await handler.handle("starNote", { noteId: b, starred: true }, ctx);

      const r = await handler.handle("getStarredNotes", {}, ctx);
      expect(r.notes).toHaveLength(2);
    });

    it("pinNote toggles + getPinnedNotes filters", async () => {
      const a = await makeNote("A");
      await makeNote("B");
      const r1 = await handler.handle("pinNote", { noteId: a }, ctx);
      expect(r1.pinned).toBe(true);

      const list = await handler.handle("getPinnedNotes", {}, ctx);
      expect(list.notes).toHaveLength(1);
      expect(String(list.notes[0].id)).toBe(a);
    });

    it("starred and pinned are independent", async () => {
      const id = await makeNote();
      await handler.handle("starNote", { noteId: id, starred: true }, ctx);
      const pinList = await handler.handle("getPinnedNotes", {}, ctx);
      expect(pinList.notes).toHaveLength(0); // 只 star 没 pin
      const starList = await handler.handle("getStarredNotes", {}, ctx);
      expect(starList.notes).toHaveLength(1);
    });
  });

  // ===== Recently =====

  describe("Recently edited / viewed", () => {
    it("getRecentlyEdited returns notes ORDER BY updated_at DESC", async () => {
      const a = await makeNote("A");
      await new Promise((r) => setTimeout(r, 5));
      const b = await makeNote("B");
      await new Promise((r) => setTimeout(r, 5));
      // 编辑 A — updated_at 更新到现在 → A 应是最新
      await handler.handle("updateNote", { noteId: a, content: "edited" }, ctx);

      const r = await handler.handle("getRecentlyEdited", {}, ctx);
      expect(String(r.notes[0].id)).toBe(a);
      expect(String(r.notes[1].id)).toBe(b);
    });

    it("getRecentlyViewed falls back to updated_at when last_viewed_at NULL", async () => {
      const a = await makeNote("A");
      const b = await makeNote("B");
      const r = await handler.handle("getRecentlyViewed", {}, ctx);
      // 都没 view 过, ORDER BY COALESCE(last_viewed_at, updated_at) DESC
      // = ORDER BY updated_at DESC → B 是后建 (updated_at 大) 优先
      expect(r.notes).toHaveLength(2);
      expect(String(r.notes[0].id)).toBe(b);
      expect(String(r.notes[1].id)).toBe(a);
    });

    it("getRecentlyViewed honors last_viewed_at when set", async () => {
      const a = await makeNote("A");
      const b = await makeNote("B");
      // 直接 SQL 注 last_viewed_at 模拟 view (Phase 6.3 v0.1 没显式 recordView 方法)
      dbInner
        .prepare("UPDATE notes SET last_viewed_at = ? WHERE id = ?")
        .run(Date.now() + 10000, a);
      const r = await handler.handle("getRecentlyViewed", {}, ctx);
      // A last_viewed_at 远大于 B updated_at → A 优先
      expect(String(r.notes[0].id)).toBe(a);
    });

    it("respects limit + offset", async () => {
      for (let i = 0; i < 5; i++) {
        await makeNote(`N${i}`);
        await new Promise((r) => setTimeout(r, 2));
      }
      const r = await handler.handle(
        "getRecentlyEdited",
        { limit: 2, offset: 1 },
        ctx,
      );
      expect(r.notes).toHaveLength(2);
    });
  });
});
