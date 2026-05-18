/**
 * database-conversations — extracted from database.js as part of H3 split (v0.45.33).
 *
 * Each function takes the DatabaseManager instance and a logger; behavior
 * is byte-identical to the original DatabaseManager methods. The class
 * itself keeps thin delegate methods so the public API is unchanged.
 *
 * Extracted on 2026-04-07.
 */

const SqlSecurity = require("./sql-security");

function createConversation(dbManager, logger, conversationData) {
  const id =
    conversationData.id ||
    `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const now = Date.now();

  const stmt = dbManager.db.prepare(`
    INSERT INTO conversations (
      id, title, knowledge_id, project_id, context_type, context_data,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    conversationData.title || "新对话",
    conversationData.knowledge_id || null,
    conversationData.project_id || null,
    conversationData.context_type || "global",
    conversationData.context_data
      ? JSON.stringify(conversationData.context_data)
      : null,
    conversationData.created_at || now,
    conversationData.updated_at || now,
  );

  dbManager.saveToFile();

  return dbManager.getConversationById(id);
}

function getConversationById(dbManager, logger, conversationId) {
  const stmt = dbManager.db.prepare("SELECT * FROM conversations WHERE id = ?");
  const conversation = stmt.get(conversationId);

  if (!conversation) {
    return null;
  }

  // 解析 context_data
  if (conversation.context_data) {
    try {
      conversation.context_data = JSON.parse(conversation.context_data);
    } catch (_e) {
      logger.error("解析 context_data 失败:", _e);
    }
  }

  return conversation;
}

function getConversationByProject(dbManager, logger, projectId) {
  const stmt = dbManager.db.prepare(`
    SELECT * FROM conversations
    WHERE project_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `);

  const conversation = stmt.get(projectId);

  if (!conversation) {
    return null;
  }

  // 解析 context_data
  if (conversation.context_data) {
    try {
      conversation.context_data = JSON.parse(conversation.context_data);
    } catch (_e) {
      logger.error("解析 context_data 失败:", _e);
    }
  }

  return conversation;
}

function getConversations(dbManager, logger, options = {}) {
  let query = "SELECT * FROM conversations WHERE 1=1";
  const params = [];

  if (options.project_id) {
    query += " AND project_id = ?";
    params.push(options.project_id);
  }

  if (options.knowledge_id) {
    query += " AND knowledge_id = ?";
    params.push(options.knowledge_id);
  }

  if (options.context_type) {
    query += " AND context_type = ?";
    params.push(options.context_type);
  }

  query += " ORDER BY updated_at DESC";

  if (options.limit) {
    query += " LIMIT ?";
    params.push(options.limit);
  }

  const stmt = dbManager.db.prepare(query);
  const conversations = stmt.all(...params);

  // 解析 context_data
  return conversations.map((conv) => {
    if (conv.context_data) {
      try {
        conv.context_data = JSON.parse(conv.context_data);
      } catch (_e) {
        logger.error("解析 context_data 失败:", _e);
      }
    }
    return conv;
  });
}

function updateConversation(dbManager, logger, conversationId, updates) {
  const fields = [];
  const values = [];

  const allowedFields = ["title", "context_type", "context_data"];

  allowedFields.forEach((field) => {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      if (field === "context_data" && typeof updates[field] !== "string") {
        values.push(JSON.stringify(updates[field]));
      } else {
        values.push(updates[field]);
      }
    }
  });

  // 总是更新 updated_at
  fields.push("updated_at = ?");
  values.push(Date.now());

  values.push(conversationId);

  if (fields.length === 1) {
    return dbManager.getConversationById(conversationId);
  }

  dbManager.db.run(
    `
    UPDATE conversations SET ${fields.join(", ")} WHERE id = ?
  `,
    values,
  );

  dbManager.saveToFile();
  return dbManager.getConversationById(conversationId);
}

function deleteConversation(dbManager, logger, conversationId) {
  // 先删除相关消息
  dbManager.db.run("DELETE FROM messages WHERE conversation_id = ?", [
    conversationId,
  ]);

  // 删除对话
  dbManager.db.run("DELETE FROM conversations WHERE id = ?", [conversationId]);

  dbManager.saveToFile();
  return true;
}

function createMessage(dbManager, logger, messageData) {
  const id =
    messageData.id ||
    `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const now = Date.now();

  // 确定message_type：优先使用messageData.type，否则根据role推断
  let messageType = messageData.type || messageData.message_type;
  if (!messageType) {
    // 向后兼容：根据role推断message_type
    if (messageData.role === "user") {
      messageType = "USER";
    } else if (messageData.role === "assistant") {
      messageType = "ASSISTANT";
    } else if (messageData.role === "system") {
      messageType = "SYSTEM";
    } else {
      messageType = "ASSISTANT";
    } // 默认值
  }

  // 序列化metadata为JSON字符串
  const metadataStr = messageData.metadata
    ? JSON.stringify(messageData.metadata)
    : null;

  const stmt = dbManager.db.prepare(`
    INSERT INTO messages (
      id, conversation_id, role, content, timestamp, tokens, message_type, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    messageData.conversation_id,
    messageData.role,
    messageData.content,
    messageData.timestamp || now,
    messageData.tokens || null,
    messageType,
    metadataStr,
  );

  dbManager.saveToFile();

  // 更新对话的 updated_at
  dbManager.updateConversation(messageData.conversation_id, {});

  return dbManager.getMessageById(id);
}

function getMessageById(dbManager, logger, messageId) {
  const stmt = dbManager.db.prepare("SELECT * FROM messages WHERE id = ?");
  return stmt.get(messageId);
}

function getMessagesByConversation(
  dbManager,
  logger,
  conversationId,
  options = {},
) {
  // ✅ 安全验证：防止SQL注入
  const safeOrder = SqlSecurity.validateOrder(options.order || "ASC");
  let query = `SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ${safeOrder}`;
  const params = [conversationId];

  // 添加分页支持
  if (options.limit) {
    const safeLimit = SqlSecurity.validateLimit(options.limit);
    query += " LIMIT ?";
    params.push(safeLimit);

    if (options.offset) {
      const safeOffset = SqlSecurity.validateOffset(options.offset);
      query += " OFFSET ?";
      params.push(safeOffset);
    }
  }

  const stmt = dbManager.db.prepare(query);
  const rawMessages = stmt.all(...params);

  // 反序列化metadata字段
  const messages = rawMessages.map((msg) => {
    if (msg.metadata) {
      try {
        msg.metadata = JSON.parse(msg.metadata);
      } catch (_e) {
        logger.warn("[Database] 无法解析消息metadata:", msg.id, _e);
        msg.metadata = null;
      }
    }
    // 向后兼容：如果没有message_type，根据role设置
    if (!msg.message_type) {
      if (msg.role === "user") {
        msg.message_type = "USER";
      } else if (msg.role === "assistant") {
        msg.message_type = "ASSISTANT";
      } else if (msg.role === "system") {
        msg.message_type = "SYSTEM";
      } else {
        msg.message_type = "ASSISTANT";
      }
    }
    return msg;
  });

  // 获取总消息数
  const countStmt = dbManager.db.prepare(
    "SELECT COUNT(*) as total FROM messages WHERE conversation_id = ?",
  );
  const countResult = countStmt.get(conversationId);
  const total = countResult ? countResult.total : 0;

  return {
    messages,
    total,
    hasMore:
      options.limit && options.offset
        ? options.offset + options.limit < total
        : false,
  };
}

function deleteMessage(dbManager, logger, messageId) {
  dbManager.db.run("DELETE FROM messages WHERE id = ?", [messageId]);
  dbManager.saveToFile();
  return true;
}

function clearConversationMessages(dbManager, logger, conversationId) {
  dbManager.db.run("DELETE FROM messages WHERE conversation_id = ?", [
    conversationId,
  ]);
  dbManager.saveToFile();
  return true;
}

function searchMessages(dbManager, logger, options = {}) {
  const {
    query,
    conversationId,
    role,
    limit = 50,
    offset = 0,
    order = "DESC",
  } = options;

  if (!query || !query.trim()) {
    return { messages: [], total: 0, hasMore: false };
  }

  const searchPattern = `%${query.trim()}%`;
  const params = [searchPattern];
  const whereConditions = ["content LIKE ?"];

  // 添加对话ID过滤
  if (conversationId) {
    whereConditions.push("conversation_id = ?");
    params.push(conversationId);
  }

  // 添加角色过滤
  if (role) {
    whereConditions.push("role = ?");
    params.push(role);
  }

  // 构建查询SQL
  const whereClause = whereConditions.join(" AND ");
  const orderClause = order === "ASC" ? "ASC" : "DESC";

  // 查询消息
  const messagesQuery = `
    SELECT * FROM messages
    WHERE ${whereClause}
    ORDER BY timestamp ${orderClause}
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const stmt = dbManager.db.prepare(messagesQuery);
  const rawMessages = stmt.all(...params);

  // 反序列化metadata字段
  const messages = rawMessages.map((msg) => {
    if (msg.metadata) {
      try {
        msg.metadata = JSON.parse(msg.metadata);
      } catch (_e) {
        logger.warn("[Database] 无法解析消息metadata:", msg.id, _e);
        msg.metadata = null;
      }
    }
    // 向后兼容：如果没有message_type，根据role设置
    if (!msg.message_type) {
      if (msg.role === "user") {
        msg.message_type = "USER";
      } else if (msg.role === "assistant") {
        msg.message_type = "ASSISTANT";
      } else if (msg.role === "system") {
        msg.message_type = "SYSTEM";
      } else {
        msg.message_type = "ASSISTANT";
      }
    }
    return msg;
  });

  // 获取总数
  const countQuery = `
    SELECT COUNT(*) as total FROM messages
    WHERE ${whereClause}
  `;
  const countParams = params.slice(0, -2); // 移除limit和offset参数
  const countStmt = dbManager.db.prepare(countQuery);
  const countResult = countStmt.get(...countParams);
  const total = countResult ? countResult.total : 0;

  return {
    messages,
    total,
    hasMore: offset + limit < total,
  };
}

module.exports = {
  createConversation,
  getConversationById,
  getConversationByProject,
  getConversations,
  updateConversation,
  deleteConversation,
  createMessage,
  getMessageById,
  getMessagesByConversation,
  deleteMessage,
  clearConversationMessages,
  searchMessages,
};
