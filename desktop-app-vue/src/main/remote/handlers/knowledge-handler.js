/**
 * 知识库命令处理器
 */

const { logger } = require("../../utils/logger");

class KnowledgeHandler {
  constructor(database, ragManager) {
    this.database = database;
    this.ragManager = ragManager;
    // Phase 6.3: 幂等建表 + ALTER ADD COLUMN (deferred to first use 避免
    // constructor 卡 async init - 通过 _ensureSchemaOnce flag).
    this._schemaEnsured = false;
    logger.info(
      "[KnowledgeHandler] 知识库命令处理器已初始化 (Phase 6.3 — 19 method)",
    );
  }

  /**
   * Phase 6.3 — 首次操作前幂等建 knowledge_folders 表 + 给 notes 加 folder_id 列。
   * 老 notes 表来自 CLI schema (id/title/content/tags/category/created_at/updated_at/
   * deleted_at)，本次添加：folder_id (TEXT, FK knowledge_folders.id NULL=root)。
   * SQLite 不支持 IF NOT EXISTS for ADD COLUMN，所以 try/catch 兜底。
   */
  async _ensureSchema() {
    if (this._schemaEnsured || !this.database) {
      return;
    }
    try {
      await this.database.run(`
        CREATE TABLE IF NOT EXISTS knowledge_folders (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          parent_id TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (parent_id) REFERENCES knowledge_folders(id) ON DELETE CASCADE
        )
      `);
      await this.database.run(`
        CREATE INDEX IF NOT EXISTS idx_kfolders_parent
        ON knowledge_folders(parent_id)
      `);
      // tags 表 (knowledge_items schema 也有 — 重复 CREATE IF NOT EXISTS 安全)
      await this.database.run(`
        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      // notes 表加 folder_id 列 — SQLite 重复 ADD COLUMN 会 throw "duplicate column"，吞掉
      try {
        await this.database.run(
          `ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES knowledge_folders(id) ON DELETE SET NULL`,
        );
      } catch (_err) {
        // 已存在 — 忽略
      }
      this._schemaEnsured = true;
    } catch (err) {
      logger.warn(
        "[KnowledgeHandler] _ensureSchema 失败 (非致命):",
        err.message,
      );
    }
  }

  async handle(action, params, context) {
    logger.debug("[KnowledgeHandler] 处理命令: " + action);
    await this._ensureSchema();

    switch (action) {
      // Phase 3.5+ 既有 9 method
      case "createNote":
        return await this.createNote(params, context);
      case "searchNotes":
        return await this.searchNotes(params, context);
      case "getNoteById":
        return await this.getNoteById(params, context);
      case "getTags":
        return await this.getTags(params, context);
      case "updateNote":
        return await this.updateNote(params, context);
      case "deleteNote":
        return await this.deleteNote(params, context);
      case "getNotesByTag":
        return await this.getNotesByTag(params, context);
      case "getFavorites":
        return await this.getFavorites(params, context);
      case "syncNote":
        return await this.syncNote(params, context);

      // Phase 6.3 新增 10 method (folders 5 + tags CRUD 3 + naming alias getNote + getNotes 通用列表)
      case "getNote": // Android invoke 名，桌面 alias to getNoteById
        return await this.getNoteById(params, context);
      case "getNotes":
        return await this.getNotes(params, context);
      case "getFolders":
        return await this.getFolders(params, context);
      case "createFolder":
        return await this.createFolder(params, context);
      case "deleteFolder":
        return await this.deleteFolder(params, context);
      case "renameFolder":
        return await this.renameFolder(params, context);
      case "moveFolder":
        return await this.moveFolder(params, context);
      case "createTag":
        return await this.createTag(params, context);
      case "deleteTag":
        return await this.deleteTag(params, context);
      case "renameTag":
        return await this.renameTag(params, context);

      default:
        throw new Error("Unknown action: " + action);
    }
  }

  async createNote(params, context) {
    const { title, content, tags = [] } = params;
    if (!title || !content) {
      throw new Error("Title and content are required");
    }

    logger.info("[KnowledgeHandler] 创建笔记: " + title);

    const result = await this.database.run(
      "INSERT INTO notes (title, content, tags, created_by_did, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        title,
        content,
        JSON.stringify(tags),
        context.did,
        Date.now(),
        Date.now(),
      ],
    );

    return {
      noteId: result.lastID,
      title,
      message: "Note created successfully",
    };
  }

  async searchNotes(params, context) {
    const { query, limit = 10 } = params;
    if (!query) {
      throw new Error("Search query is required");
    }

    logger.info("[KnowledgeHandler] 搜索笔记: " + query);

    const rows = await this.database.all(
      "SELECT id, title, content, tags FROM notes WHERE title LIKE ? OR content LIKE ? LIMIT ?",
      ["%" + query + "%", "%" + query + "%", limit],
    );

    return { results: rows, total: rows.length };
  }

  async getNoteById(params, context) {
    const { noteId } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }

    const row = await this.database.get("SELECT * FROM notes WHERE id = ?", [
      noteId,
    ]);
    if (!row) {
      throw new Error("Note not found");
    }

    return row;
  }

  async getTags(params, context) {
    const rows = await this.database.all(
      "SELECT DISTINCT tags FROM notes WHERE tags IS NOT NULL",
    );
    const tagSet = new Set();
    rows.forEach((row) => {
      const tags = JSON.parse(row.tags || "[]");
      tags.forEach((tag) => tagSet.add(tag));
    });

    return { tags: Array.from(tagSet).sort(), total: tagSet.size };
  }

  async updateNote(params, context) {
    const { noteId, title, content, tags } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }

    logger.info("[KnowledgeHandler] 更新笔记: " + noteId);

    const existing = await this.database.get(
      "SELECT * FROM notes WHERE id = ?",
      [noteId],
    );
    if (!existing) {
      throw new Error("Note not found");
    }

    await this.database.run(
      "UPDATE notes SET title = ?, content = ?, tags = ?, updated_at = ? WHERE id = ?",
      [
        title || existing.title,
        content || existing.content,
        tags ? JSON.stringify(tags) : existing.tags,
        Date.now(),
        noteId,
      ],
    );

    return { noteId, message: "Note updated successfully" };
  }

  async deleteNote(params, context) {
    const { noteId } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }

    logger.info("[KnowledgeHandler] 删除笔记: " + noteId);

    const result = await this.database.run("DELETE FROM notes WHERE id = ?", [
      noteId,
    ]);
    if (result.changes === 0) {
      throw new Error("Note not found");
    }

    return { noteId, message: "Note deleted successfully" };
  }

  async getNotesByTag(params, context) {
    const { tag, limit = 50 } = params;
    if (!tag) {
      throw new Error("Tag is required");
    }

    logger.info("[KnowledgeHandler] 按标签搜索笔记: " + tag);

    const rows = await this.database.all(
      "SELECT id, title, content, tags, created_at FROM notes WHERE tags LIKE ? LIMIT ?",
      ['%"' + tag + '"%', limit],
    );

    return { results: rows, total: rows.length, tag };
  }

  async getFavorites(params, context) {
    const { limit = 50 } = params;

    logger.info("[KnowledgeHandler] 获取收藏笔记");

    const rows = await this.database.all(
      "SELECT id, title, content, tags, created_at FROM notes WHERE is_favorite = 1 ORDER BY updated_at DESC LIMIT ?",
      [limit],
    );

    return { results: rows, total: rows.length };
  }

  async syncNote(params, context) {
    const { noteId, vectorize = false } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }

    logger.info("[KnowledgeHandler] 同步笔记到向量库: " + noteId);

    const note = await this.database.get("SELECT * FROM notes WHERE id = ?", [
      noteId,
    ]);
    if (!note) {
      throw new Error("Note not found");
    }

    if (vectorize && this.ragManager) {
      await this.ragManager.indexDocument({
        id: note.id,
        text: note.title + "\n\n" + note.content,
        metadata: {
          type: "note",
          tags: JSON.parse(note.tags || "[]"),
          created_at: note.created_at,
        },
      });
      return {
        noteId,
        message: "Note synced and vectorized",
        vectorized: true,
      };
    }

    return { noteId, message: "Note synced", vectorized: false };
  }

  // ============================================================================
  // Phase 6.3 新增 10 method — folders + tags CRUD + getNote alias + getNotes
  // ============================================================================

  /**
   * 通用 list — 按 limit/offset/folder_id/order 过滤。Android `getNotes` 对应。
   */
  async getNotes(params, _context) {
    const {
      limit = 50,
      offset = 0,
      folderId,
      orderBy = "updated_at",
      order = "DESC",
    } = params;

    let sql =
      "SELECT id, title, content, tags, category, folder_id, created_at, updated_at FROM notes WHERE 1=1";
    const args = [];
    if (folderId !== undefined) {
      if (folderId === null || folderId === "") {
        sql += " AND folder_id IS NULL";
      } else {
        sql += " AND folder_id = ?";
        args.push(folderId);
      }
    }
    // 限制 orderBy 字段防 SQL 注入
    const validOrderBy = ["updated_at", "created_at", "title"];
    const orderByFinal = validOrderBy.includes(orderBy)
      ? orderBy
      : "updated_at";
    const orderFinal = order === "ASC" ? "ASC" : "DESC";
    sql += ` ORDER BY ${orderByFinal} ${orderFinal} LIMIT ? OFFSET ?`;
    args.push(limit | 0, offset | 0);
    const rows = await this.database.all(sql, args);
    return { notes: rows, total: rows.length, limit, offset };
  }

  // ----- Folders (5) -----

  async getFolders(_params, _context) {
    const rows = await this.database.all(
      "SELECT id, name, parent_id, created_at FROM knowledge_folders ORDER BY name ASC",
    );
    return { folders: rows, total: rows.length };
  }

  async createFolder(params, _context) {
    const { name, parentId } = params;
    if (!name || typeof name !== "string") {
      throw new Error("Folder name is required");
    }
    const id = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();
    await this.database.run(
      "INSERT INTO knowledge_folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)",
      [id, name, parentId || null, now],
    );
    logger.info(`[KnowledgeHandler] createFolder: ${id} "${name}"`);
    return { folderId: id, name, parentId: parentId || null, createdAt: now };
  }

  async deleteFolder(params, _context) {
    const { folderId } = params;
    if (!folderId) {
      throw new Error("Folder ID is required");
    }
    // FK CASCADE 处理子文件夹；notes.folder_id 由 SET NULL 自动清空
    const result = await this.database.run(
      "DELETE FROM knowledge_folders WHERE id = ?",
      [folderId],
    );
    if (result.changes === 0) {
      throw new Error("Folder not found");
    }
    logger.info(`[KnowledgeHandler] deleteFolder: ${folderId}`);
    return { folderId, deleted: true };
  }

  async renameFolder(params, _context) {
    const { folderId, name } = params;
    if (!folderId) {
      throw new Error("Folder ID is required");
    }
    if (!name || typeof name !== "string") {
      throw new Error("New name is required");
    }
    const result = await this.database.run(
      "UPDATE knowledge_folders SET name = ? WHERE id = ?",
      [name, folderId],
    );
    if (result.changes === 0) {
      throw new Error("Folder not found");
    }
    return { folderId, name };
  }

  async moveFolder(params, _context) {
    const { folderId, newParentId } = params;
    if (!folderId) {
      throw new Error("Folder ID is required");
    }
    if (folderId === newParentId) {
      throw new Error("Cannot move folder into itself");
    }
    // 简化：不检测循环（深度遍历开销 — caller 应避免）
    const result = await this.database.run(
      "UPDATE knowledge_folders SET parent_id = ? WHERE id = ?",
      [newParentId || null, folderId],
    );
    if (result.changes === 0) {
      throw new Error("Folder not found");
    }
    return { folderId, newParentId: newParentId || null };
  }

  // ----- Tags CRUD (3) -----
  // 用 knowledge_items schema 里既有 tags 表 (id/name UNIQUE/color/created_at)

  async createTag(params, _context) {
    const { name, color = "#666666" } = params;
    if (!name || typeof name !== "string") {
      throw new Error("Tag name is required");
    }
    // tags 表已在 _ensureSchema 中建
    const id = `tag_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();
    try {
      await this.database.run(
        "INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)",
        [id, name, color, now],
      );
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        throw new Error(`Tag "${name}" already exists`);
      }
      throw err;
    }
    return { tagId: id, name, color, createdAt: now };
  }

  async deleteTag(params, _context) {
    const { tagId, name } = params;
    if (!tagId && !name) {
      throw new Error("tagId or name is required");
    }
    const sql = tagId
      ? "DELETE FROM tags WHERE id = ?"
      : "DELETE FROM tags WHERE name = ?";
    const result = await this.database.run(sql, [tagId || name]);
    if (result.changes === 0) {
      throw new Error("Tag not found");
    }
    return { deleted: true, identifier: tagId || name };
  }

  async renameTag(params, _context) {
    const { tagId, oldName, newName } = params;
    if (!newName || typeof newName !== "string") {
      throw new Error("newName is required");
    }
    if (!tagId && !oldName) {
      throw new Error("tagId or oldName is required");
    }
    const sql = tagId
      ? "UPDATE tags SET name = ? WHERE id = ?"
      : "UPDATE tags SET name = ? WHERE name = ?";
    try {
      const result = await this.database.run(sql, [newName, tagId || oldName]);
      if (result.changes === 0) {
        throw new Error("Tag not found");
      }
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        throw new Error(`Tag "${newName}" already exists`);
      }
      throw err;
    }
    return { renamed: true, newName };
  }
}

module.exports = KnowledgeHandler;
