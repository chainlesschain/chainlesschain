/**
 * Social IPC handlers — file-voice group.
 * Split verbatim from social-ipc.js registerSocialIPC(); ipcMain + managers via ctx.
 *
 * @module social/social-ipc-file-voice
 */
import { logger } from "../utils/logger.js";
import { dialog, app } from "electron";
import fs from "fs";
import path from "path";

export function registerFileVoiceHandlers(ctx) {
  const { ipcMain, database } = ctx;

  // ============================================================
  // 文件传输 (File Transfer in Chat) - 4 handlers
  // ============================================================

  /**
   * 发送文件消息（图片/文件）
   * Channel: 'chat:send-file'
   */
  ipcMain.handle(
    "chat:send-file",
    async (_event, { sessionId, filePath, messageType, duration }) => {
      try {
        // dialog, path, fs imported at top

        if (!database || !database.db) {
          throw new Error("数据库未初始化");
        }

        // 如果没有提供文件路径，打开文件选择对话框
        if (!filePath) {
          const result = await dialog.showOpenDialog({
            properties: ["openFile"],
            filters:
              messageType === "image"
                ? [
                    {
                      name: "Images",
                      extensions: ["jpg", "jpeg", "png", "gif", "webp"],
                    },
                  ]
                : messageType === "voice"
                  ? [
                      {
                        name: "Audio",
                        extensions: ["mp3", "wav", "ogg", "m4a", "webm"],
                      },
                    ]
                  : [{ name: "All Files", extensions: ["*"] }],
          });

          if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: "未选择文件" };
          }

          filePath = result.filePaths[0];
        }

        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
          throw new Error("文件不存在");
        }

        // 获取文件信息
        const stats = fs.statSync(filePath);
        const fileName = path.basename(filePath);
        const fileSize = stats.size;

        // 获取会话信息
        const sessionStmt = database.prepare(
          "SELECT * FROM chat_sessions WHERE id = ?",
        );
        const session = sessionStmt.get(sessionId);

        if (!session) {
          throw new Error("会话不存在");
        }

        // 复制文件到应用数据目录
        // app imported at top
        const uploadsDir = path.join(
          app.getPath("userData"),
          "uploads",
          "chat",
        );
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const timestamp = Date.now();
        const fileExt = path.extname(fileName);
        const newFileName = `${timestamp}-${Math.random().toString(36).substring(7)}${fileExt}`;
        const destPath = path.join(uploadsDir, newFileName);

        fs.copyFileSync(filePath, destPath);

        // 生成消息ID
        const messageId = `msg-${timestamp}-${Math.random().toString(36).substring(7)}`;

        // 获取当前用户DID
        const currentUserDid = session.participant_did; // 这里需要从实际的用户身份获取

        // 保存消息到数据库
        const insertStmt = database.prepare(`
        INSERT INTO p2p_chat_messages (
          id, session_id, sender_did, receiver_did, content,
          message_type, file_path, file_size, duration, encrypted, status, timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

        insertStmt.run(
          messageId,
          sessionId,
          currentUserDid,
          session.participant_did,
          fileName,
          messageType || "file",
          destPath,
          fileSize,
          duration || null,
          1,
          "sent",
          timestamp,
        );

        // 更新会话
        const updateStmt = database.prepare(`
        UPDATE chat_sessions
        SET last_message = ?, last_message_time = ?, updated_at = ?
        WHERE id = ?
      `);

        const lastMessage =
          messageType === "image"
            ? "[图片]"
            : messageType === "voice"
              ? "[语音]"
              : `[文件] ${fileName}`;
        updateStmt.run(lastMessage, timestamp, timestamp, sessionId);

        database.saveToFile();

        // 通过P2P发送文件（如果P2P管理器可用）
        if (
          global.mainApp &&
          global.mainApp.p2pEnhancedManager &&
          global.mainApp.p2pEnhancedManager.fileTransferManager
        ) {
          try {
            logger.info("[Social IPC] 开始P2P文件传输...");

            // 使用FileTransferManager进行P2P传输
            const transferId =
              await global.mainApp.p2pEnhancedManager.fileTransferManager.uploadFile(
                session.participant_did,
                destPath,
                {
                  messageId,
                  sessionId,
                  fileName,
                  fileSize,
                  duration,
                },
              );

            logger.info("[Social IPC] ✅ P2P文件传输已启动:", transferId);

            // 更新消息状态为传输中
            const updateTransferStmt = database.prepare(`
            UPDATE p2p_chat_messages
            SET transfer_id = ?, status = 'transferring'
            WHERE id = ?
          `);
            updateTransferStmt.run(transferId, messageId);
            database.saveToFile();
          } catch (error) {
            logger.error("[Social IPC] P2P文件传输失败:", error);
            // 即使P2P传输失败，消息仍然保存在本地
          }
        }

        return {
          success: true,
          message: {
            id: messageId,
            sessionId,
            senderDid: currentUserDid,
            receiverDid: session.participant_did,
            content: fileName,
            messageType: messageType || "file",
            filePath: destPath,
            fileSize,
            duration,
            timestamp,
          },
        };
      } catch (error) {
        logger.error("[Social IPC] 发送文件失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 选择并发送图片
   * Channel: 'chat:select-and-send-image'
   */
  ipcMain.handle(
    "chat:select-and-send-image",
    async (_event, { sessionId }) => {
      return ipcMain.emit("chat:send-file", _event, {
        sessionId,
        messageType: "image",
      });
    },
  );

  /**
   * 选择并发送文件
   * Channel: 'chat:select-and-send-file'
   */
  ipcMain.handle("chat:select-and-send-file", async (_event, { sessionId }) => {
    return ipcMain.emit("chat:send-file", _event, {
      sessionId,
      messageType: "file",
    });
  });

  /**
   * 下载文件
   * Channel: 'chat:download-file'
   */
  ipcMain.handle(
    "chat:download-file",
    async (_event, { messageId, savePath }) => {
      try {
        // dialog, path, fs imported at top

        if (!database || !database.db) {
          throw new Error("数据库未初始化");
        }

        // 获取消息信息
        const stmt = database.prepare(
          "SELECT * FROM p2p_chat_messages WHERE id = ?",
        );
        const message = stmt.get(messageId);

        if (!message) {
          throw new Error("消息不存在");
        }

        if (!message.file_path) {
          throw new Error("消息不包含文件");
        }

        // 如果没有提供保存路径，打开保存对话框
        if (!savePath) {
          const result = await dialog.showSaveDialog({
            defaultPath: message.content,
            filters: [{ name: "All Files", extensions: ["*"] }],
          });

          if (result.canceled || !result.filePath) {
            return { success: false, error: "未选择保存位置" };
          }

          savePath = result.filePath;
        }

        // 复制文件
        fs.copyFileSync(message.file_path, savePath);

        return {
          success: true,
          filePath: savePath,
        };
      } catch (error) {
        logger.error("[Social IPC] 下载文件失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 转发消息
   * Channel: 'chat:forward-message'
   */
  ipcMain.handle(
    "chat:forward-message",
    async (_event, { messageId, targetSessionIds }) => {
      try {
        if (!database || !database.db) {
          throw new Error("数据库未初始化");
        }

        // 获取原始消息
        const originalStmt = database.prepare(
          "SELECT * FROM p2p_chat_messages WHERE id = ?",
        );
        const originalMessage = originalStmt.get(messageId);

        if (!originalMessage) {
          throw new Error("原始消息不存在");
        }

        // 更新原始消息的转发计数
        const updateStmt = database.prepare(`
        UPDATE p2p_chat_messages
        SET forward_count = forward_count + ?
        WHERE id = ?
      `);
        updateStmt.run(targetSessionIds.length, messageId);

        const forwardedMessages = [];

        // 为每个目标会话创建转发消息
        for (const targetSessionId of targetSessionIds) {
          // 获取目标会话信息
          const sessionStmt = database.prepare(
            "SELECT * FROM chat_sessions WHERE id = ?",
          );
          const session = sessionStmt.get(targetSessionId);

          if (!session) {
            logger.warn(`[Social IPC] 会话不存在: ${targetSessionId}`);
            continue;
          }

          // 生成新消息ID
          const newMessageId = `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          const timestamp = Date.now();

          // 如果是文件消息，需要复制文件
          let newFilePath = null;
          if (originalMessage.file_path) {
            // path, fs, app imported at top

            const uploadsDir = path.join(
              app.getPath("userData"),
              "uploads",
              "chat",
            );
            if (!fs.existsSync(uploadsDir)) {
              fs.mkdirSync(uploadsDir, { recursive: true });
            }

            const fileExt = path.extname(originalMessage.file_path);
            const newFileName = `${timestamp}-${Math.random().toString(36).substring(7)}${fileExt}`;
            newFilePath = path.join(uploadsDir, newFileName);

            // 复制文件
            fs.copyFileSync(originalMessage.file_path, newFilePath);
          }

          // 插入转发消息
          const insertStmt = database.prepare(`
          INSERT INTO p2p_chat_messages (
            id, session_id, sender_did, receiver_did, content,
            message_type, file_path, file_size, encrypted, status,
            device_id, timestamp, forwarded_from_id, forward_count
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

          insertStmt.run(
            newMessageId,
            targetSessionId,
            originalMessage.sender_did, // 保持原发送者
            session.participant_did,
            originalMessage.content,
            originalMessage.message_type,
            newFilePath || originalMessage.file_path,
            originalMessage.file_size,
            originalMessage.encrypted,
            "sent",
            originalMessage.device_id,
            timestamp,
            messageId, // 记录原始消息ID
            0, // 新消息的转发计数为0
          );

          // 更新会话
          const updateSessionStmt = database.prepare(`
          UPDATE chat_sessions
          SET last_message = ?, last_message_time = ?, updated_at = ?
          WHERE id = ?
        `);

          const lastMessage =
            originalMessage.message_type === "text"
              ? `[转发] ${originalMessage.content}`
              : `[转发] ${originalMessage.message_type === "image" ? "[图片]" : "[文件]"}`;

          updateSessionStmt.run(
            lastMessage,
            timestamp,
            timestamp,
            targetSessionId,
          );

          forwardedMessages.push({
            id: newMessageId,
            sessionId: targetSessionId,
            originalMessageId: messageId,
          });
        }

        database.saveToFile();

        return {
          success: true,
          forwardedMessages,
          count: forwardedMessages.length,
        };
      } catch (error) {
        logger.error("[Social IPC] 转发消息失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取文件传输进度
   * Channel: 'chat:get-transfer-progress'
   */
  ipcMain.handle(
    "chat:get-transfer-progress",
    async (_event, { transferId }) => {
      try {
        if (
          !global.mainApp ||
          !global.mainApp.p2pEnhancedManager ||
          !global.mainApp.p2pEnhancedManager.fileTransferManager
        ) {
          return { success: false, error: "P2P文件传输管理器未初始化" };
        }

        const progress =
          global.mainApp.p2pEnhancedManager.fileTransferManager.getProgress(
            transferId,
          );

        if (!progress) {
          return { success: false, error: "传输任务不存在" };
        }

        return {
          success: true,
          progress,
        };
      } catch (error) {
        logger.error("[Social IPC] 获取传输进度失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 取消文件传输
   * Channel: 'chat:cancel-transfer'
   */
  ipcMain.handle("chat:cancel-transfer", async (_event, { transferId }) => {
    try {
      if (
        !global.mainApp ||
        !global.mainApp.p2pEnhancedManager ||
        !global.mainApp.p2pEnhancedManager.fileTransferManager
      ) {
        return { success: false, error: "P2P文件传输管理器未初始化" };
      }

      await global.mainApp.p2pEnhancedManager.fileTransferManager.cancelTransfer(
        transferId,
      );

      return { success: true };
    } catch (error) {
      logger.error("[Social IPC] 取消传输失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 接受文件传输
   * Channel: 'chat:accept-transfer'
   */
  ipcMain.handle(
    "chat:accept-transfer",
    async (_event, { transferId, savePath }) => {
      try {
        if (
          !global.mainApp ||
          !global.mainApp.p2pEnhancedManager ||
          !global.mainApp.p2pEnhancedManager.fileTransferManager
        ) {
          return { success: false, error: "P2P文件传输管理器未初始化" };
        }

        // dialog, path imported at top

        // 如果没有提供保存路径,打开保存对话框
        if (!savePath) {
          const downloadTask =
            global.mainApp.p2pEnhancedManager.fileTransferManager.downloads.get(
              transferId,
            );
          if (!downloadTask) {
            return { success: false, error: "传输任务不存在" };
          }

          const result = await dialog.showSaveDialog({
            defaultPath: downloadTask.fileName,
            filters: [{ name: "All Files", extensions: ["*"] }],
          });

          if (result.canceled || !result.filePath) {
            return { success: false, error: "未选择保存位置" };
          }

          savePath = result.filePath;
        }

        // 开始下载
        const filePath =
          await global.mainApp.p2pEnhancedManager.fileTransferManager.downloadFile(
            null, // peerId will be retrieved from download task
            transferId,
            savePath,
          );

        return {
          success: true,
          filePath,
        };
      } catch (error) {
        logger.error("[Social IPC] 接受传输失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // 语音消息播放 (Voice Message Playback) - 1 handler
  // ============================================================

  /**
   * 播放语音消息
   * Channel: 'chat:play-voice-message'
   */
  ipcMain.handle("chat:play-voice-message", async (_event, { messageId }) => {
    try {
      if (!database || !database.db) {
        return { success: false, error: "数据库未初始化" };
      }

      // 获取消息信息
      const stmt = database.prepare(
        "SELECT * FROM p2p_chat_messages WHERE id = ?",
      );
      const message = stmt.get(messageId);

      if (!message) {
        return { success: false, error: "消息不存在" };
      }

      if (message.message_type !== "voice") {
        return { success: false, error: "不是语音消息" };
      }

      if (!message.file_path) {
        return { success: false, error: "语音文件路径不存在" };
      }

      // fs imported at top
      if (!fs.existsSync(message.file_path)) {
        return { success: false, error: "语音文件不存在" };
      }

      // 返回文件路径，让前端使用HTML5 Audio API播放
      return {
        success: true,
        filePath: message.file_path,
        duration: message.duration || 0,
      };
    } catch (error) {
      logger.error("[Social IPC] 播放语音消息失败:", error);
      return { success: false, error: error.message };
    }
  });
}
