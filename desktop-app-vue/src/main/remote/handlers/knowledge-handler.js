/**
 * 知识库命令处理器
 */

const { logger } = require("../../utils/logger");

class KnowledgeHandler {
  constructor(database, ragManager) {
    this.database = database;
    this.ragManager = ragManager;
    logger.info("[KnowledgeHandler] 知识库命令处理器已初始化");
  }

  async handle(action, params, context) {
    logger.debug("[KnowledgeHandler] 处理命令: " + action);

    switch (action) {
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
}

module.exports = KnowledgeHandler;
