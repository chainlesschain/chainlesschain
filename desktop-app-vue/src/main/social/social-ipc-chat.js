/**
 * Social IPC handlers — chat group.
 * Split verbatim from social-ipc.js registerSocialIPC(); ipcMain + managers via ctx.
 *
 * @module social/social-ipc-chat
 */
import { logger } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

export function registerChatHandlers(ctx) {
  const { ipcMain, database } = ctx;

  // ============================================================
  // 聊天会话管理 (Chat/Messaging) - 5 handlers
  // ============================================================

  /**
   * 获取聊天会话列表
   * Channel: 'chat:get-sessions'
   */
  ipcMain.handle("chat:get-sessions", async () => {
    try {
      if (!database || !database.db) {
        logger.warn("[Social IPC] 数据库未初始化，返回空数组");
        return [];
      }
      // 使用 DatabaseManager 的 prepare 方法，它有更好的错误处理
      const stmt = database.prepare(
        "SELECT * FROM chat_sessions ORDER BY updated_at DESC",
      );
      const sessions = stmt.all();
      return sessions || [];
    } catch (error) {
      logger.error("[Social IPC] 获取聊天会话列表失败:", error);
      // 返回空数组而不是抛出错误，防止前端崩溃
      return [];
    }
  });

  /**
   * 获取聊天消息
   * Channel: 'chat:get-messages'
   */
  ipcMain.handle(
    "chat:get-messages",
    async (_event, sessionId, limit = 50, offset = 0) => {
      try {
        if (!database || !database.db) {
          logger.warn("[Social IPC] 数据库未初始化，返回空数组");
          return [];
        }
        const stmt = database.prepare(
          "SELECT * FROM p2p_chat_messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        );
        const messages = stmt.all(sessionId, limit, offset);
        return messages || [];
      } catch (error) {
        logger.error("[Social IPC] 获取聊天消息失败:", error);
        return [];
      }
    },
  );

  /**
   * 保存聊天消息
   * Channel: 'chat:save-message'
   */
  ipcMain.handle("chat:save-message", async (_event, message) => {
    try {
      if (!database || !database.db) {
        logger.warn("[Social IPC] 数据库未初始化");
        return { success: false, error: "数据库未初始化" };
      }

      // 保存消息
      const insertStmt = database.prepare(`
        INSERT INTO p2p_chat_messages (
          id, session_id, sender_did, receiver_did, content,
          message_type, file_path, encrypted, status, device_id, timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(
        message.id,
        message.sessionId,
        message.senderDid,
        message.receiverDid,
        message.content,
        message.messageType || "text",
        message.filePath || null,
        message.encrypted !== undefined ? message.encrypted : 1,
        message.status || "sent",
        message.deviceId || null,
        message.timestamp || Date.now(),
      );

      // 更新会话
      const sessionStmt = database.prepare(
        "SELECT * FROM chat_sessions WHERE id = ?",
      );
      const session = sessionStmt.get(message.sessionId);

      if (session) {
        const updateStmt = database.prepare(`
          UPDATE chat_sessions
          SET last_message = ?, last_message_time = ?, updated_at = ?
          WHERE id = ?
        `);
        updateStmt.run(
          message.content,
          message.timestamp || Date.now(),
          Date.now(),
          message.sessionId,
        );
      } else {
        // 创建新会话
        const createStmt = database.prepare(`
          INSERT INTO chat_sessions (
            id, participant_did, friend_nickname, last_message,
            last_message_time, unread_count, is_pinned, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        createStmt.run(
          message.sessionId,
          message.senderDid === message.receiverDid
            ? message.senderDid
            : message.receiverDid,
          null,
          message.content,
          message.timestamp || Date.now(),
          0,
          0,
          Date.now(),
          Date.now(),
        );
      }

      database.saveToFile();
      return { success: true };
    } catch (error) {
      logger.error("[Social IPC] 保存消息失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新消息状态
   * Channel: 'chat:update-message-status'
   */
  ipcMain.handle(
    "chat:update-message-status",
    async (_event, messageId, status) => {
      try {
        if (!database || !database.db) {
          throw new Error("数据库未初始化");
        }
        database.db
          .prepare("UPDATE p2p_chat_messages SET status = ? WHERE id = ?")
          .run(status, messageId);
        database.saveToFile();
        return { success: true };
      } catch (error) {
        logger.error("[Social IPC] 更新消息状态失败:", error);
        throw error;
      }
    },
  );

  /**
   * 标记会话为已读
   * Channel: 'chat:mark-as-read'
   */
  ipcMain.handle("chat:mark-as-read", async (_event, sessionId) => {
    try {
      if (!database || !database.db) {
        throw new Error("数据库未初始化");
      }
      database.db
        .prepare("UPDATE chat_sessions SET unread_count = 0 WHERE id = ?")
        .run(sessionId);
      database.saveToFile();
      return { success: true };
    } catch (error) {
      logger.error("[Social IPC] 标记已读失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 消息表情回应 (Message Reactions) - 4 handlers
  // ============================================================

  /**
   * 添加消息表情回应
   * Channel: 'chat:add-reaction'
   */
  ipcMain.handle(
    "chat:add-reaction",
    async (_event, { messageId, userDid, emoji }) => {
      try {
        if (!database || !database.db) {
          throw new Error("数据库未初始化");
        }

        const id = uuidv4();
        const now = Date.now();

        const stmt = database.prepare(`
        INSERT OR REPLACE INTO message_reactions (id, message_id, user_did, emoji, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
        stmt.run(id, messageId, userDid, emoji, now);
        database.saveToFile();

        return {
          success: true,
          reaction: { id, messageId, userDid, emoji, createdAt: now },
        };
      } catch (error) {
        logger.error("[Social IPC] 添加表情回应失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 移除消息表情回应
   * Channel: 'chat:remove-reaction'
   */
  ipcMain.handle(
    "chat:remove-reaction",
    async (_event, { messageId, userDid, emoji }) => {
      try {
        if (!database || !database.db) {
          throw new Error("数据库未初始化");
        }

        const stmt = database.prepare(`
        DELETE FROM message_reactions
        WHERE message_id = ? AND user_did = ? AND emoji = ?
      `);
        stmt.run(messageId, userDid, emoji);
        database.saveToFile();

        return { success: true };
      } catch (error) {
        logger.error("[Social IPC] 移除表情回应失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取消息的所有表情回应
   * Channel: 'chat:get-reactions'
   */
  ipcMain.handle("chat:get-reactions", async (_event, messageId) => {
    try {
      if (!database || !database.db) {
        return { success: true, reactions: [] };
      }

      const stmt = database.prepare(`
        SELECT * FROM message_reactions
        WHERE message_id = ?
        ORDER BY created_at ASC
      `);
      const reactions = stmt.all(messageId);

      return { success: true, reactions: reactions || [] };
    } catch (error) {
      logger.error("[Social IPC] 获取表情回应失败:", error);
      return { success: false, reactions: [], error: error.message };
    }
  });

  /**
   * 获取消息的表情回应统计
   * Channel: 'chat:get-reaction-stats'
   */
  ipcMain.handle("chat:get-reaction-stats", async (_event, messageId) => {
    try {
      if (!database || !database.db) {
        return { success: true, stats: {} };
      }

      const stmt = database.prepare(`
        SELECT emoji, COUNT(*) as count, GROUP_CONCAT(user_did) as users
        FROM message_reactions
        WHERE message_id = ?
        GROUP BY emoji
        ORDER BY count DESC
      `);
      const rows = stmt.all(messageId);

      const stats = {};
      rows.forEach((row) => {
        stats[row.emoji] = {
          count: row.count,
          users: row.users ? row.users.split(",") : [],
        };
      });

      return { success: true, stats };
    } catch (error) {
      logger.error("[Social IPC] 获取表情统计失败:", error);
      return { success: false, stats: {}, error: error.message };
    }
  });
}
