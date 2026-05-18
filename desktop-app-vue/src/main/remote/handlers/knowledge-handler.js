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
      "[KnowledgeHandler] 知识库命令处理器已初始化 (Phase 6.3 — 30 method)",
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
      // Phase 6.3 step 1: folder_id
      // Phase 6.3 step 2: starred / pinned / last_viewed_at (各一个 try/catch)
      const altersNeeded = [
        `ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES knowledge_folders(id) ON DELETE SET NULL`,
        `ALTER TABLE notes ADD COLUMN starred INTEGER DEFAULT 0`,
        `ALTER TABLE notes ADD COLUMN pinned INTEGER DEFAULT 0`,
        `ALTER TABLE notes ADD COLUMN last_viewed_at INTEGER`,
        // Phase 6.3 step 3: archive
        `ALTER TABLE notes ADD COLUMN archived INTEGER DEFAULT 0`,
      ];
      for (const sql of altersNeeded) {
        try {
          await this.database.run(sql);
        } catch (_err) {
          // 已存在 — 忽略 (duplicate column / table already has column)
        }
      }
      // Phase 6.3 step 2: 版本快照表
      await this.database.run(`
        CREATE TABLE IF NOT EXISTS knowledge_note_versions (
          id TEXT PRIMARY KEY,
          note_id TEXT NOT NULL,
          version_number INTEGER NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          tags TEXT,
          created_at INTEGER NOT NULL,
          created_by_did TEXT,
          UNIQUE(note_id, version_number)
        )
      `);
      await this.database.run(`
        CREATE INDEX IF NOT EXISTS idx_kversions_note
        ON knowledge_note_versions(note_id, version_number DESC)
      `);
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

      // Phase 6.3 step 2 — versions 4 + star/pin 6
      case "getNoteHistory":
        return await this.getNoteHistory(params, context);
      case "getNoteVersion":
        return await this.getNoteVersion(params, context);
      case "restoreNoteVersion":
        return await this.restoreNoteVersion(params, context);
      case "compareVersions":
        return await this.compareVersions(params, context);
      case "starNote":
        return await this.starNote(params, context);
      case "getStarredNotes":
        return await this.getStarredNotes(params, context);
      case "pinNote":
        return await this.pinNote(params, context);
      case "getPinnedNotes":
        return await this.getPinnedNotes(params, context);
      case "getRecentlyEdited":
        return await this.getRecentlyEdited(params, context);
      case "getRecentlyViewed":
        return await this.getRecentlyViewed(params, context);

      // Phase 6.3 step 3 — archive 3 + import-export 4 + tags advanced 3
      case "archiveNote":
        return await this.archiveNote(params, context);
      case "restoreNote":
        return await this.restoreNote(params, context);
      case "getArchivedNotes":
        return await this.getArchivedNotes(params, context);
      case "exportNote":
        return await this.exportNote(params, context);
      case "exportNotes":
        return await this.exportNotes(params, context);
      case "importNote":
        return await this.importNote(params, context);
      case "importFromFile":
        return await this.importFromFile(params, context);
      case "mergeTags":
        return await this.mergeTags(params, context);
      case "addTagsToNote":
        return await this.addTagsToNote(params, context);
      case "removeTagsFromNote":
        return await this.removeTagsFromNote(params, context);

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

    // Phase 6.3 step 2: 自动 snapshot 当前版本到 knowledge_note_versions
    // 然后再 UPDATE。用户 restoreNoteVersion 时可回到历史任意版本。
    await this._snapshotVersion(existing, context && context.did);

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

  /**
   * Phase 6.3 step 2 — 把当前 note 状态快照写 knowledge_note_versions。
   * UPDATE 前调，确保历史每次变化都可恢复。
   */
  async _snapshotVersion(note, did) {
    if (!note || !note.id) {
      return;
    }
    // Trap: better-sqlite3 把 JS Number(N) 绑到 TEXT 列存为 "N.0" — 必须 String()
    // 包一层，否则后续 WHERE note_id = "1" 查不到存为 "1.0" 的行。
    const noteIdStr = String(note.id);
    // 当前版本号 = max(version_number) + 1
    const row = await this.database.get(
      "SELECT MAX(version_number) AS max_v FROM knowledge_note_versions WHERE note_id = ?",
      [noteIdStr],
    );
    const nextVersion = (row && row.max_v ? row.max_v : 0) + 1;
    const versionId = `ver_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    try {
      await this.database.run(
        `INSERT INTO knowledge_note_versions
         (id, note_id, version_number, title, content, tags, created_at, created_by_did)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          versionId,
          noteIdStr,
          nextVersion,
          note.title || "",
          note.content || "",
          note.tags || "[]",
          Date.now(),
          did || null,
        ],
      );
    } catch (err) {
      logger.warn(
        "[KnowledgeHandler] snapshot version 失败 (非致命):",
        err.message,
      );
    }
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

  // ============================================================================
  // Phase 6.3 step 2 — versions 4 + star/pin 6
  // ============================================================================

  // ---- Versions (4) ----

  /** 列出 note 的所有历史版本（按 version_number DESC）。 */
  async getNoteHistory(params, _context) {
    const { noteId, limit = 50 } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }
    const rows = await this.database.all(
      `SELECT id, version_number, title, created_at, created_by_did
       FROM knowledge_note_versions
       WHERE note_id = ?
       ORDER BY version_number DESC
       LIMIT ?`,
      [String(noteId), limit | 0], // Trap: TEXT col binding 必须 String 防 "1.0"
    );
    return { noteId, versions: rows, total: rows.length };
  }

  /** 拉单个版本完整内容 (id 优先；缺省 fallback 到 noteId+versionNumber)。 */
  async getNoteVersion(params, _context) {
    const { versionId, noteId, versionNumber } = params;
    let row;
    if (versionId) {
      row = await this.database.get(
        "SELECT * FROM knowledge_note_versions WHERE id = ?",
        [versionId],
      );
    } else if (noteId && versionNumber !== undefined) {
      row = await this.database.get(
        "SELECT * FROM knowledge_note_versions WHERE note_id = ? AND version_number = ?",
        [String(noteId), versionNumber | 0],
      );
    } else {
      throw new Error("versionId or (noteId + versionNumber) required");
    }
    if (!row) {
      throw new Error("Version not found");
    }
    return { version: row };
  }

  /**
   * 把 note 还原到指定版本。同时 snapshot 当前状态作为新版本（防丢失），
   * 然后把指定版本的 title/content/tags 写回 notes。
   */
  async restoreNoteVersion(params, context) {
    const { noteId, versionId, versionNumber } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }
    // 取目标版本
    let target;
    if (versionId) {
      target = await this.database.get(
        "SELECT * FROM knowledge_note_versions WHERE id = ?",
        [versionId],
      );
    } else if (versionNumber !== undefined) {
      target = await this.database.get(
        "SELECT * FROM knowledge_note_versions WHERE note_id = ? AND version_number = ?",
        [String(noteId), versionNumber | 0],
      );
    } else {
      throw new Error("versionId or versionNumber required");
    }
    if (!target) {
      throw new Error("Version not found");
    }

    // 取当前 note + snapshot 当前状态作为新版本
    const current = await this.database.get(
      "SELECT * FROM notes WHERE id = ?",
      [noteId],
    );
    if (!current) {
      throw new Error("Note not found");
    }
    await this._snapshotVersion(current, context && context.did);

    // 写回目标版本内容
    await this.database.run(
      "UPDATE notes SET title = ?, content = ?, tags = ?, updated_at = ? WHERE id = ?",
      [target.title, target.content, target.tags || "[]", Date.now(), noteId],
    );
    return {
      noteId,
      restoredFromVersion: target.version_number,
      message: "Note restored",
    };
  }

  /**
   * 比较 note 两个版本 (versionA / versionB) — 返字段级 diff 摘要 (title / content
   * / tags 各是否变化 + content size delta)。
   *
   * **v0.1 不做行级 diff** — 那是 client UI 工作 (cli 端用 `diff` 库渲染)。
   */
  async compareVersions(params, _context) {
    const { noteId, versionA, versionB } = params;
    if (!noteId || versionA === undefined || versionB === undefined) {
      throw new Error("noteId, versionA and versionB are required");
    }
    const noteIdStr = String(noteId);
    const [a, b] = await Promise.all([
      this.database.get(
        "SELECT * FROM knowledge_note_versions WHERE note_id = ? AND version_number = ?",
        [noteIdStr, versionA | 0],
      ),
      this.database.get(
        "SELECT * FROM knowledge_note_versions WHERE note_id = ? AND version_number = ?",
        [noteIdStr, versionB | 0],
      ),
    ]);
    if (!a || !b) {
      throw new Error("One or both versions not found");
    }
    return {
      noteId,
      versionA: {
        id: a.id,
        version: a.version_number,
        title: a.title,
        content: a.content,
        tags: a.tags,
        createdAt: a.created_at,
      },
      versionB: {
        id: b.id,
        version: b.version_number,
        title: b.title,
        content: b.content,
        tags: b.tags,
        createdAt: b.created_at,
      },
      diff: {
        titleChanged: a.title !== b.title,
        contentChanged: a.content !== b.content,
        tagsChanged: (a.tags || "") !== (b.tags || ""),
        contentSizeDelta: (b.content || "").length - (a.content || "").length,
      },
    };
  }

  // ---- Star / Pin (6) ----

  /** 标星 (toggle 或 set)。starred=true|false 显式设；缺省则 toggle 当前状态。 */
  async starNote(params, _context) {
    const { noteId, starred } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }
    const existing = await this.database.get(
      "SELECT starred FROM notes WHERE id = ?",
      [noteId],
    );
    if (!existing) {
      throw new Error("Note not found");
    }
    const newVal =
      starred === undefined ? (existing.starred ? 0 : 1) : starred ? 1 : 0;
    await this.database.run(
      "UPDATE notes SET starred = ?, updated_at = ? WHERE id = ?",
      [newVal, Date.now(), noteId],
    );
    return { noteId, starred: !!newVal };
  }

  async getStarredNotes(params, _context) {
    const { limit = 50, offset = 0 } = params;
    const rows = await this.database.all(
      `SELECT id, title, content, tags, starred, pinned, folder_id, created_at, updated_at
       FROM notes
       WHERE starred = 1
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [limit | 0, offset | 0],
    );
    return { notes: rows, total: rows.length };
  }

  async pinNote(params, _context) {
    const { noteId, pinned } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }
    const existing = await this.database.get(
      "SELECT pinned FROM notes WHERE id = ?",
      [noteId],
    );
    if (!existing) {
      throw new Error("Note not found");
    }
    const newVal =
      pinned === undefined ? (existing.pinned ? 0 : 1) : pinned ? 1 : 0;
    await this.database.run(
      "UPDATE notes SET pinned = ?, updated_at = ? WHERE id = ?",
      [newVal, Date.now(), noteId],
    );
    return { noteId, pinned: !!newVal };
  }

  async getPinnedNotes(params, _context) {
    const { limit = 50, offset = 0 } = params;
    const rows = await this.database.all(
      `SELECT id, title, content, tags, starred, pinned, folder_id, created_at, updated_at
       FROM notes
       WHERE pinned = 1
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [limit | 0, offset | 0],
    );
    return { notes: rows, total: rows.length };
  }

  /** Recently edited = ORDER BY updated_at DESC (用户编辑时 updated_at 自动更新)。 */
  async getRecentlyEdited(params, _context) {
    const { limit = 20, offset = 0 } = params;
    const rows = await this.database.all(
      `SELECT id, title, content, tags, starred, pinned, folder_id, created_at, updated_at
       FROM notes
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [limit | 0, offset | 0],
    );
    return { notes: rows, total: rows.length };
  }

  /**
   * Recently viewed = ORDER BY COALESCE(last_viewed_at, updated_at) DESC。
   * 没有 viewed 记录时 fallback 用 updated_at — 让方法初次调用就有结果，
   * 不至于 last_viewed_at 全 NULL 返空。recordView 显式 method 留 v0.2 实现。
   */
  async getRecentlyViewed(params, _context) {
    const { limit = 20, offset = 0 } = params;
    const rows = await this.database.all(
      `SELECT id, title, content, tags, starred, pinned, folder_id, last_viewed_at, created_at, updated_at
       FROM notes
       ORDER BY COALESCE(last_viewed_at, updated_at) DESC
       LIMIT ? OFFSET ?`,
      [limit | 0, offset | 0],
    );
    return { notes: rows, total: rows.length };
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

  // ============================================================================
  // Phase 6.3 step 3 — archive 3 + import-export 4 + tags advanced 3
  // ============================================================================

  // ---- Archive (3) ----

  /** 归档 note (archived=1)。归档不删数据，restoreNote 可还原。 */
  async archiveNote(params, _context) {
    const { noteId } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }
    const result = await this.database.run(
      "UPDATE notes SET archived = 1, updated_at = ? WHERE id = ?",
      [Date.now(), noteId],
    );
    if (result.changes === 0) {
      throw new Error("Note not found");
    }
    return { noteId, archived: true };
  }

  /** 还原 (archived=0)。Android 也叫 restoreNote。 */
  async restoreNote(params, _context) {
    const { noteId } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }
    const result = await this.database.run(
      "UPDATE notes SET archived = 0, updated_at = ? WHERE id = ?",
      [Date.now(), noteId],
    );
    if (result.changes === 0) {
      throw new Error("Note not found");
    }
    return { noteId, archived: false };
  }

  async getArchivedNotes(params, _context) {
    const { limit = 50, offset = 0 } = params;
    const rows = await this.database.all(
      `SELECT id, title, content, tags, starred, pinned, folder_id, archived, created_at, updated_at
       FROM notes
       WHERE archived = 1
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [limit | 0, offset | 0],
    );
    return { notes: rows, total: rows.length };
  }

  // ---- Import / Export (4) ----

  /**
   * 单条导出。format: "markdown" (default) / "json" / "html"。
   * v0.1 假设 note.content 本身是 markdown 文本，markdown 导出 prefix `# title\n\n`。
   */
  async exportNote(params, _context) {
    const { noteId, format = "markdown" } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }
    const row = await this.database.get(
      "SELECT id, title, content, tags, folder_id, created_at, updated_at FROM notes WHERE id = ?",
      [noteId],
    );
    if (!row) {
      throw new Error("Note not found");
    }
    const tags = JSON.parse(row.tags || "[]");
    let content;
    let mime;
    if (format === "json") {
      content = JSON.stringify({ ...row, tags }, null, 2);
      mime = "application/json";
    } else if (format === "html") {
      content = `<h1>${this._escapeHtml(row.title)}</h1>\n<pre>${this._escapeHtml(row.content || "")}</pre>\n`;
      mime = "text/html";
    } else {
      // markdown (default)
      const tagLine = tags.length ? `\ntags: ${tags.join(", ")}\n` : "";
      content = `# ${row.title}\n${tagLine}\n${row.content || ""}\n`;
      mime = "text/markdown";
    }
    return { noteId, format, mime, content };
  }

  /**
   * 批量导出。指定 noteIds 数组 或 folderId 整文件夹。每条用 exportNote 复用。
   * 返 { notes: [{ noteId, title, format, content }, ...] }。
   */
  async exportNotes(params, context) {
    const { noteIds, folderId, format = "markdown" } = params;
    let ids = [];
    if (Array.isArray(noteIds) && noteIds.length) {
      ids = noteIds;
    } else if (folderId !== undefined) {
      const rows = await this.database.all(
        folderId === null || folderId === ""
          ? "SELECT id FROM notes WHERE folder_id IS NULL"
          : "SELECT id FROM notes WHERE folder_id = ?",
        folderId === null || folderId === "" ? [] : [folderId],
      );
      ids = rows.map((r) => r.id);
    } else {
      throw new Error("noteIds[] or folderId is required");
    }
    const out = [];
    for (const id of ids) {
      try {
        const r = await this.exportNote({ noteId: id, format }, context);
        out.push({
          noteId: id,
          title: r.content.split("\n")[0],
          format,
          content: r.content,
        });
      } catch (err) {
        out.push({ noteId: id, error: err.message });
      }
    }
    return { notes: out, total: out.length, format };
  }

  /**
   * 导入 — 与 createNote 等价但参数命名 Android 端约定 (有可选 folderId)。
   */
  async importNote(params, context) {
    const { title, content, tags = [], folderId } = params;
    if (!title || content === undefined) {
      throw new Error("Title and content are required");
    }
    const now = Date.now();
    const result = await this.database.run(
      "INSERT INTO notes (title, content, tags, folder_id, created_by_did, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        title,
        content,
        JSON.stringify(tags),
        folderId || null,
        context && context.did,
        now,
        now,
      ],
    );
    return {
      noteId: result.lastID,
      title,
      imported: true,
    };
  }

  /**
   * 从文件内容导入。filename 用于 format auto-detect (.md/.json/.txt)。
   * - markdown: 第一行 `# Xxx` 当 title，余作 content；缺 H1 用 filename
   * - json: 解析 {title, content, tags} 字段
   * - txt/其它: filename 当 title，全文当 content
   */
  async importFromFile(params, context) {
    const { filename, content, format, folderId } = params;
    if (!filename || content === undefined) {
      throw new Error("filename and content are required");
    }
    const extMatch = filename.match(/\.([^.]+)$/);
    const ext = (extMatch ? extMatch[1] : "").toLowerCase();
    const fmt = format || ext;
    let title;
    let body;
    let tags = [];
    if (fmt === "json") {
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error("Invalid JSON content");
      }
      title = parsed.title || filename.replace(/\.[^.]+$/, "");
      body = parsed.content || "";
      tags = Array.isArray(parsed.tags) ? parsed.tags : [];
    } else if (fmt === "md" || fmt === "markdown") {
      const lines = content.split(/\r?\n/);
      const h1Idx = lines.findIndex((l) => /^#\s+/.test(l));
      if (h1Idx >= 0) {
        title = lines[h1Idx].replace(/^#\s+/, "").trim();
        body = lines
          .slice(h1Idx + 1)
          .join("\n")
          .trim();
      } else {
        title = filename.replace(/\.[^.]+$/, "");
        body = content;
      }
    } else {
      title = filename.replace(/\.[^.]+$/, "");
      body = content;
    }
    return this.importNote({ title, content: body, tags, folderId }, context);
  }

  // ---- Tags advanced (3) ----

  /**
   * 合并 source tag 到 target tag。
   * 1. 遍历所有 notes，把 tags JSON 中 sourceName 替换为 targetName (去重)
   * 2. DELETE source tag row
   * tagId 或 name 都接受 (sourceTagId/sourceName, targetTagId/targetName)。
   */
  async mergeTags(params, _context) {
    const { sourceTagId, sourceName, targetTagId, targetName } = params;
    if (!sourceTagId && !sourceName) {
      throw new Error("sourceTagId or sourceName is required");
    }
    if (!targetTagId && !targetName) {
      throw new Error("targetTagId or targetName is required");
    }
    // 查 source / target name
    let srcName = sourceName;
    let tgtName = targetName;
    if (sourceTagId && !srcName) {
      const r = await this.database.get("SELECT name FROM tags WHERE id = ?", [
        sourceTagId,
      ]);
      if (!r) {
        throw new Error("Source tag not found");
      }
      srcName = r.name;
    }
    if (targetTagId && !tgtName) {
      const r = await this.database.get("SELECT name FROM tags WHERE id = ?", [
        targetTagId,
      ]);
      if (!r) {
        throw new Error("Target tag not found");
      }
      tgtName = r.name;
    }
    if (srcName === tgtName) {
      throw new Error("Source and target tags are the same");
    }
    // 找所有含 source tag 的 notes
    const notes = await this.database.all(
      "SELECT id, tags FROM notes WHERE tags LIKE ?",
      ['%"' + srcName + '"%'],
    );
    let updatedCount = 0;
    for (const n of notes) {
      const arr = JSON.parse(n.tags || "[]");
      if (!arr.includes(srcName)) {
        continue;
      }
      const next = Array.from(
        new Set(arr.map((t) => (t === srcName ? tgtName : t))),
      );
      await this.database.run(
        "UPDATE notes SET tags = ?, updated_at = ? WHERE id = ?",
        [JSON.stringify(next), Date.now(), n.id],
      );
      updatedCount += 1;
    }
    // 删 source tag row（只删 id；name 自动通过 UNIQUE 约束唯一）
    const delSql = sourceTagId
      ? "DELETE FROM tags WHERE id = ?"
      : "DELETE FROM tags WHERE name = ?";
    await this.database.run(delSql, [sourceTagId || srcName]);
    return {
      merged: true,
      sourceName: srcName,
      targetName: tgtName,
      notesUpdated: updatedCount,
    };
  }

  /** 把 tags 数组合并入 note.tags (去重)。tags = string[]。 */
  async addTagsToNote(params, _context) {
    const { noteId, tags } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }
    if (!Array.isArray(tags)) {
      throw new Error("tags must be an array");
    }
    const existing = await this.database.get(
      "SELECT tags FROM notes WHERE id = ?",
      [noteId],
    );
    if (!existing) {
      throw new Error("Note not found");
    }
    const cur = JSON.parse(existing.tags || "[]");
    const next = Array.from(new Set([...cur, ...tags]));
    await this.database.run(
      "UPDATE notes SET tags = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(next), Date.now(), noteId],
    );
    return { noteId, tags: next, added: tags.length };
  }

  async removeTagsFromNote(params, _context) {
    const { noteId, tags } = params;
    if (!noteId) {
      throw new Error("Note ID is required");
    }
    if (!Array.isArray(tags)) {
      throw new Error("tags must be an array");
    }
    const existing = await this.database.get(
      "SELECT tags FROM notes WHERE id = ?",
      [noteId],
    );
    if (!existing) {
      throw new Error("Note not found");
    }
    const cur = JSON.parse(existing.tags || "[]");
    const toRemove = new Set(tags);
    const next = cur.filter((t) => !toRemove.has(t));
    await this.database.run(
      "UPDATE notes SET tags = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(next), Date.now(), noteId],
    );
    return { noteId, tags: next, removed: cur.length - next.length };
  }

  // ---- helpers ----

  _escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

module.exports = KnowledgeHandler;
