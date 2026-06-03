/**
 * KnowledgeHandler — Phase 6.3 Action 测试
 *
 * 覆盖新加 10 method:
 *   getNote (alias) / getNotes
 *   getFolders / createFolder / deleteFolder / renameFolder / moveFolder
 *   createTag / deleteTag / renameTag
 *
 * 用 in-memory better-sqlite3-multiple-ciphers + thin async wrapper 匹配 handler
 * 期望的 `database.run/.get/.all` 异步 API。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const Database = require("better-sqlite3-multiple-ciphers");
const KnowledgeHandler = require("../handlers/knowledge-handler");

// 把同步 better-sqlite3 包成 handler 期望的异步 API
function wrapAsyncDb(db) {
  return {
    async run(sql, args = []) {
      // INSERT/UPDATE/DELETE/CREATE/ALTER 都用 run; better-sqlite3 errors
      // (UNIQUE constraint 等) 直接传递给 caller 不 catch
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

describe("KnowledgeHandler — Phase 6.3 (10 new methods)", () => {
  let handler;
  let dbInner;
  let db;
  const ctx = { did: "did:test:phone" };

  beforeEach(async () => {
    dbInner = new Database(":memory:");
    // 建 notes 表 (CLI schema 风格)
    dbInner
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT DEFAULT '',
          tags TEXT DEFAULT '[]',
          category TEXT DEFAULT 'general',
          created_at INTEGER DEFAULT 0,
          updated_at INTEGER DEFAULT 0,
          deleted_at TEXT DEFAULT NULL
        )
      `,
      )
      .run();
    dbInner.pragma("foreign_keys = ON");
    db = wrapAsyncDb(dbInner);
    handler = new KnowledgeHandler(db, null);
  });

  afterEach(() => {
    dbInner.close();
  });

  // ===== _ensureSchema =====

  describe("_ensureSchema", () => {
    it("creates knowledge_folders + adds notes.folder_id on first call", async () => {
      // 任意 method 调用触发 ensure
      await handler.handle("getFolders", {}, ctx);

      const tables = dbInner
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name);
      expect(tables).toContain("knowledge_folders");

      // notes.folder_id 列存在
      const cols = dbInner.prepare("PRAGMA table_info(notes)").all();
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain("folder_id");
    });

    it("is idempotent on repeat calls", async () => {
      await handler.handle("getFolders", {}, ctx);
      await handler.handle("getFolders", {}, ctx);
      await handler.handle("getFolders", {}, ctx);
      // 不应 throw
    });
  });

  // ===== getNote alias =====

  describe("getNote (alias)", () => {
    it("routes to getNoteById", async () => {
      // 插入一条 note
      dbInner
        .prepare(
          "INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("n1", "Title", "Body", 1700000000000, 1700000000000);
      const r = await handler.handle("getNote", { noteId: "n1" }, ctx);
      expect(r.id).toBe("n1");
      expect(r.title).toBe("Title");
    });
  });

  // ===== getNotes =====

  describe("getNotes", () => {
    beforeEach(() => {
      // 插入 5 条 notes
      for (let i = 1; i <= 5; i++) {
        dbInner
          .prepare(
            "INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(`n${i}`, `T${i}`, `C${i}`, 1700000000000 + i, 1700000000000 + i);
      }
    });

    it("returns all notes by default DESC updated_at", async () => {
      const r = await handler.handle("getNotes", {}, ctx);
      expect(r.notes).toHaveLength(5);
      expect(r.notes[0].id).toBe("n5"); // 最新先
      expect(r.notes[4].id).toBe("n1");
    });

    it("respects limit + offset", async () => {
      const r = await handler.handle("getNotes", { limit: 2, offset: 1 }, ctx);
      expect(r.notes).toHaveLength(2);
      expect(r.notes[0].id).toBe("n4");
      expect(r.notes[1].id).toBe("n3");
    });

    it("filters by folderId=null (root notes)", async () => {
      const r = await handler.handle("getNotes", { folderId: null }, ctx);
      // 所有 5 条都没 folder_id (NULL)
      expect(r.notes).toHaveLength(5);
    });

    it("filters by specific folderId", async () => {
      // 创建文件夹 + 给一条 note 设 folder_id
      const f = await handler.handle("createFolder", { name: "F1" }, ctx);
      dbInner
        .prepare("UPDATE notes SET folder_id = ? WHERE id = ?")
        .run(f.folderId, "n2");
      const r = await handler.handle("getNotes", { folderId: f.folderId }, ctx);
      expect(r.notes).toHaveLength(1);
      expect(r.notes[0].id).toBe("n2");
    });

    it("rejects SQL injection in orderBy", async () => {
      const r = await handler.handle(
        "getNotes",
        { orderBy: "DROP TABLE notes" },
        ctx,
      );
      // 不合法 orderBy fall back to updated_at — table 仍在
      const stillExists = dbInner
        .prepare("SELECT COUNT(*) AS n FROM notes")
        .get().n;
      expect(stillExists).toBe(5);
      expect(r.notes).toHaveLength(5);
    });
  });

  // ===== Folders (5) =====

  describe("Folders", () => {
    it("createFolder + getFolders round-trip", async () => {
      const f = await handler.handle(
        "createFolder",
        { name: "我的笔记夹" },
        ctx,
      );
      expect(f.folderId).toMatch(/^folder_/);
      expect(f.name).toBe("我的笔记夹");
      expect(f.parentId).toBeNull();

      const list = await handler.handle("getFolders", {}, ctx);
      expect(list.total).toBe(1);
      expect(list.folders[0].id).toBe(f.folderId);
    });

    it("createFolder with parentId", async () => {
      const root = await handler.handle("createFolder", { name: "Root" }, ctx);
      const child = await handler.handle(
        "createFolder",
        { name: "Child", parentId: root.folderId },
        ctx,
      );
      expect(child.parentId).toBe(root.folderId);

      const list = await handler.handle("getFolders", {}, ctx);
      expect(list.total).toBe(2);
    });

    it("createFolder rejects empty name", async () => {
      await expect(
        handler.handle("createFolder", { name: "" }, ctx),
      ).rejects.toThrow(/name/);
    });

    it("deleteFolder removes folder + cascades children", async () => {
      const root = await handler.handle("createFolder", { name: "Root" }, ctx);
      await handler.handle(
        "createFolder",
        { name: "Child", parentId: root.folderId },
        ctx,
      );
      let list = await handler.handle("getFolders", {}, ctx);
      expect(list.total).toBe(2);

      await handler.handle("deleteFolder", { folderId: root.folderId }, ctx);
      list = await handler.handle("getFolders", {}, ctx);
      expect(list.total).toBe(0); // CASCADE 删了 child
    });

    it("deleteFolder throws when not found", async () => {
      await expect(
        handler.handle("deleteFolder", { folderId: "nope" }, ctx),
      ).rejects.toThrow(/not found/);
    });

    it("renameFolder updates name", async () => {
      const f = await handler.handle("createFolder", { name: "Old" }, ctx);
      const r = await handler.handle(
        "renameFolder",
        { folderId: f.folderId, name: "New" },
        ctx,
      );
      expect(r.name).toBe("New");
      const list = await handler.handle("getFolders", {}, ctx);
      expect(list.folders[0].name).toBe("New");
    });

    it("renameFolder requires both folderId and name", async () => {
      await expect(handler.handle("renameFolder", {}, ctx)).rejects.toThrow(
        /Folder ID/,
      );
      const f = await handler.handle("createFolder", { name: "A" }, ctx);
      await expect(
        handler.handle("renameFolder", { folderId: f.folderId }, ctx),
      ).rejects.toThrow(/name/);
    });

    it("moveFolder changes parent_id", async () => {
      const a = await handler.handle("createFolder", { name: "A" }, ctx);
      const b = await handler.handle("createFolder", { name: "B" }, ctx);
      const moved = await handler.handle(
        "moveFolder",
        { folderId: a.folderId, newParentId: b.folderId },
        ctx,
      );
      expect(moved.newParentId).toBe(b.folderId);

      const list = await handler.handle("getFolders", {}, ctx);
      const aRow = list.folders.find((f) => f.id === a.folderId);
      expect(aRow.parent_id).toBe(b.folderId);
    });

    it("moveFolder to root (newParentId=null)", async () => {
      const a = await handler.handle("createFolder", { name: "A" }, ctx);
      const b = await handler.handle(
        "createFolder",
        { name: "B", parentId: a.folderId },
        ctx,
      );
      const moved = await handler.handle(
        "moveFolder",
        { folderId: b.folderId, newParentId: null },
        ctx,
      );
      expect(moved.newParentId).toBeNull();
    });

    it("moveFolder rejects moving into itself", async () => {
      const a = await handler.handle("createFolder", { name: "A" }, ctx);
      await expect(
        handler.handle(
          "moveFolder",
          { folderId: a.folderId, newParentId: a.folderId },
          ctx,
        ),
      ).rejects.toThrow(/into itself/);
    });

    it("deleteFolder sets associated notes.folder_id to NULL", async () => {
      const f = await handler.handle("createFolder", { name: "F" }, ctx);
      // 给 note 设 folder_id
      dbInner
        .prepare(
          "INSERT INTO notes (id, title, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("n100", "X", f.folderId, 0, 0);
      // 验证 folder_id 已设
      const before = dbInner
        .prepare("SELECT folder_id FROM notes WHERE id = ?")
        .get("n100");
      expect(before.folder_id).toBe(f.folderId);

      await handler.handle("deleteFolder", { folderId: f.folderId }, ctx);
      const after = dbInner
        .prepare("SELECT folder_id FROM notes WHERE id = ?")
        .get("n100");
      expect(after.folder_id).toBeNull(); // SET NULL FK 触发
    });
  });

  // ===== Tags CRUD (3) =====

  describe("Tags CRUD", () => {
    it("createTag basic", async () => {
      const t = await handler.handle(
        "createTag",
        { name: "工作", color: "#FF0000" },
        ctx,
      );
      expect(t.tagId).toMatch(/^tag_/);
      expect(t.name).toBe("工作");
      expect(t.color).toBe("#FF0000");
    });

    it("createTag default color", async () => {
      const t = await handler.handle("createTag", { name: "Personal" }, ctx);
      expect(t.color).toBe("#666666");
    });

    it("createTag rejects duplicate name (UNIQUE)", async () => {
      await handler.handle("createTag", { name: "Dup" }, ctx);
      await expect(
        handler.handle("createTag", { name: "Dup" }, ctx),
      ).rejects.toThrow(/already exists/);
    });

    it("createTag rejects empty name", async () => {
      await expect(
        handler.handle("createTag", { name: "" }, ctx),
      ).rejects.toThrow(/name/);
    });

    it("deleteTag by id", async () => {
      const t = await handler.handle("createTag", { name: "T" }, ctx);
      const r = await handler.handle("deleteTag", { tagId: t.tagId }, ctx);
      expect(r.deleted).toBe(true);
    });

    it("deleteTag by name", async () => {
      await handler.handle("createTag", { name: "ByName" }, ctx);
      const r = await handler.handle("deleteTag", { name: "ByName" }, ctx);
      expect(r.deleted).toBe(true);
    });

    it("deleteTag throws when not found", async () => {
      await expect(
        handler.handle("deleteTag", { tagId: "nope" }, ctx),
      ).rejects.toThrow(/not found/);
    });

    it("deleteTag requires tagId or name", async () => {
      await expect(handler.handle("deleteTag", {}, ctx)).rejects.toThrow(
        /required/,
      );
    });

    it("renameTag by id", async () => {
      const t = await handler.handle("createTag", { name: "Old" }, ctx);
      const r = await handler.handle(
        "renameTag",
        { tagId: t.tagId, newName: "New" },
        ctx,
      );
      expect(r.renamed).toBe(true);
      expect(r.newName).toBe("New");
    });

    it("renameTag by oldName", async () => {
      await handler.handle("createTag", { name: "OldName" }, ctx);
      const r = await handler.handle(
        "renameTag",
        { oldName: "OldName", newName: "NewName" },
        ctx,
      );
      expect(r.newName).toBe("NewName");
    });

    it("renameTag rejects duplicate target name", async () => {
      await handler.handle("createTag", { name: "A" }, ctx);
      await handler.handle("createTag", { name: "B" }, ctx);
      await expect(
        handler.handle("renameTag", { oldName: "A", newName: "B" }, ctx),
      ).rejects.toThrow(/already exists/);
    });
  });
});
