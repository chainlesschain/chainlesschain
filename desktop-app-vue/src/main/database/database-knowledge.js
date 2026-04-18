/**
 * database-knowledge — extracted from database.js as part of H3 split (v0.45.33).
 *
 * Each function takes the DatabaseManager instance and a logger; behavior
 * is byte-identical to the original DatabaseManager methods. The class
 * itself keeps thin delegate methods so the public API is unchanged.
 *
 * Extracted on 2026-04-07.
 */

const { v4: uuidv4 } = require("uuid");

function getKnowledgeItems(dbManager, logger, limit = 100, offset = 0) {
  // 数据库未初始化检查
  if (!dbManager.db) {
    logger.warn("[Database] 数据库未初始化，无法获取知识库项");
    return [];
  }

  const parsedLimit = Number(limit);
  const parsedOffset = Number(offset);
  const safeLimit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.floor(parsedLimit)
      : 100;
  const safeOffset =
    Number.isFinite(parsedOffset) && parsedOffset >= 0
      ? Math.floor(parsedOffset)
      : 0;

  try {
    const sql = `
      SELECT * FROM knowledge_items
      ORDER BY updated_at DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset}
    `;

    // Use the unified all() method which handles both sql.js and better-sqlite3
    return dbManager.all(sql);
  } catch (error) {
    logger.error("[Database] 获取知识库项失败:", error.message);
    return [];
  }
}

function getKnowledgeItemById(dbManager, logger, id) {
  if (!id || !dbManager.db) {
    return null;
  }

  try {
    return dbManager.get("SELECT * FROM knowledge_items WHERE id = ?", [id]);
  } catch (error) {
    logger.error("[Database] 获取知识库项失败:", error.message);
    return null;
  }
}

function getKnowledgeItem(dbManager, logger, id) {
  return dbManager.getKnowledgeItemById(id);
}

function getKnowledgeItemByTitle(dbManager, logger, title) {
  if (!title || !dbManager.db) {
    return null;
  }

  try {
    return dbManager.get(
      "SELECT * FROM knowledge_items WHERE title = ? LIMIT 1",
      [title],
    );
  } catch (error) {
    logger.error("[Database] 根据标题获取知识库项失败:", error.message);
    return null;
  }
}

function getAllKnowledgeItems(dbManager, logger) {
  if (!dbManager.db) {
    logger.warn("[Database] 数据库未初始化，无法获取知识库项");
    return [];
  }

  try {
    return dbManager.all(
      "SELECT * FROM knowledge_items ORDER BY updated_at DESC",
    );
  } catch (error) {
    logger.error("[Database] 获取所有知识库项失败:", error.message);
    return [];
  }
}

function addKnowledgeItem(dbManager, logger, item) {
  const safeItem = item || {};
  const id = safeItem.id || uuidv4();
  const now = Date.now();
  const rawTitle =
    typeof safeItem.title === "string" ? safeItem.title.trim() : "";
  const title = rawTitle || "Untitled";
  const type =
    typeof safeItem.type === "string" && safeItem.type ? safeItem.type : "note";
  const content =
    typeof safeItem.content === "string" ? safeItem.content : null;

  dbManager.db.run(
    `
    INSERT INTO knowledge_items (
      id, title, type, content, content_path, embedding_path,
      created_at, updated_at, git_commit_hash, device_id, sync_status
    ) VALUES (?, COALESCE(NULLIF(?, ''), 'Untitled'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      id,
      title,
      type,
      content,
      safeItem.content_path || null,
      safeItem.embedding_path || null,
      now,
      now,
      safeItem.git_commit_hash || null,
      safeItem.device_id || null,
      safeItem.sync_status || "pending",
    ],
  );

  // 更新全文搜索索引
  dbManager.updateSearchIndex(id, title, content || "");

  // 保存到文件
  dbManager.saveToFile();

  return dbManager.getKnowledgeItemById(id);
}

function updateKnowledgeItem(dbManager, logger, id, updates) {
  const now = Date.now();
  const fields = [];
  const values = [];

  // 动态构建更新字段
  if (updates.title !== undefined) {
    fields.push("title = ?");
    values.push(updates.title);
  }
  if (updates.type !== undefined) {
    fields.push("type = ?");
    values.push(updates.type);
  }
  if (updates.content !== undefined) {
    fields.push("content = ?");
    values.push(updates.content);
  }
  if (updates.content_path !== undefined) {
    fields.push("content_path = ?");
    values.push(updates.content_path);
  }
  if (updates.sync_status !== undefined) {
    fields.push("sync_status = ?");
    values.push(updates.sync_status);
  }

  // 总是更新 updated_at
  fields.push("updated_at = ?");
  values.push(now);

  // 添加 WHERE 条件的 ID
  values.push(id);

  if (fields.length === 1) {
    // 只有 updated_at，不需要更新
    return dbManager.getKnowledgeItemById(id);
  }

  dbManager.db.run(
    `
    UPDATE knowledge_items
    SET ${fields.join(", ")}
    WHERE id = ?
  `,
    values,
  );

  // 更新全文搜索索引
  const item = dbManager.getKnowledgeItemById(id);
  if (item) {
    dbManager.updateSearchIndex(id, item.title, item.content || "");
  }

  // 保存到文件
  dbManager.saveToFile();

  return item;
}

function deleteKnowledgeItem(dbManager, logger, id) {
  // 删除搜索索引
  dbManager.run("DELETE FROM knowledge_search WHERE id = ?", [id]);

  // 删除知识库项
  dbManager.run("DELETE FROM knowledge_items WHERE id = ?", [id]);

  return true;
}

function searchKnowledge(dbManager, logger, query) {
  if (!query || !query.trim()) {
    return dbManager.getKnowledgeItems();
  }

  // 使用 LIKE 搜索（sql.js 不支持 FTS5）
  const pattern = `%${query}%`;
  return dbManager.all(
    `
    SELECT * FROM knowledge_items
    WHERE title LIKE ? OR content LIKE ?
    ORDER BY updated_at DESC
    LIMIT 50
  `,
    [pattern, pattern],
  );
}

function updateSearchIndex(dbManager, logger, id, title, content) {
  // 先删除旧索引
  dbManager.db.run("DELETE FROM knowledge_search WHERE id = ?", [id]);

  // 插入新索引
  dbManager.db.run(
    `
    INSERT INTO knowledge_search (id, title, content)
    VALUES (?, ?, ?)
  `,
    [id, title, content],
  );
}

function getAllTags(dbManager, logger) {
  return dbManager.all("SELECT * FROM tags ORDER BY name");
}

function createTag(dbManager, logger, name, color = "#1890ff") {
  const id = uuidv4();
  const now = Date.now();

  try {
    dbManager.run(
      `
      INSERT INTO tags (id, name, color, created_at)
      VALUES (?, ?, ?, ?)
    `,
      [id, name, color, now],
    );

    return { id, name, color, created_at: now };
  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      // 标签已存在，返回现有标签
      return dbManager.get("SELECT * FROM tags WHERE name = ?", [name]);
    }
    throw error;
  }
}

function addTagToKnowledge(dbManager, logger, knowledgeId, tagId) {
  dbManager.db.run(
    `
    INSERT OR IGNORE INTO knowledge_tags (knowledge_id, tag_id, created_at)
    VALUES (?, ?, ?)
  `,
    [knowledgeId, tagId, Date.now()],
  );
  dbManager.saveToFile();
}

function getKnowledgeTags(dbManager, logger, knowledgeId) {
  return dbManager.all(
    `
    SELECT t.* FROM tags t
    JOIN knowledge_tags kt ON t.id = kt.tag_id
    WHERE kt.knowledge_id = ?
  `,
    [knowledgeId],
  );
}

function getStatistics(dbManager, logger) {
  const total = dbManager.get("SELECT COUNT(*) as count FROM knowledge_items");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();

  const todayCount = dbManager.get(
    "SELECT COUNT(*) as count FROM knowledge_items WHERE created_at >= ?",
    [todayTimestamp],
  );

  const byType = dbManager.all(`
    SELECT type, COUNT(*) as count
    FROM knowledge_items
    GROUP BY type
  `);

  return {
    total: total.count,
    today: todayCount.count,
    byType: byType.reduce((acc, item) => {
      acc[item.type] = item.count;
      return acc;
    }, {}),
  };
}

module.exports = {
  getKnowledgeItems,
  getKnowledgeItemById,
  getKnowledgeItem,
  getKnowledgeItemByTitle,
  getAllKnowledgeItems,
  addKnowledgeItem,
  updateKnowledgeItem,
  deleteKnowledgeItem,
  searchKnowledge,
  updateSearchIndex,
  getAllTags,
  createTag,
  addTagToKnowledge,
  getKnowledgeTags,
  getStatistics,
};
