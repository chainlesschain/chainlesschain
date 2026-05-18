const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * 注册协作实时编辑相关的IPC处理器
 *
 * 功能：
 * - 启动/停止协作服务器
 * - 文档协作管理
 * - 操作提交与历史记录
 * - 在线用户管理
 * - 服务器状态查询
 */
function registerCollaborationIPC() {
  logger.info("[IPC] 注册协作实时编辑IPC处理器");

  // 启动协作服务器
  ipcMain.handle("collaboration:startServer", async (_event, options = {}) => {
    try {
      logger.info("[Main] 启动协作服务器");

      const { getCollaborationManager } = require("./collaboration-manager");
      const collaborationManager = getCollaborationManager();

      await collaborationManager.initialize(options);
      const result = await collaborationManager.startServer();

      logger.info("[Main] 协作服务器启动成功");
      return result;
    } catch (error) {
      logger.error("[Main] 启动协作服务器失败:", error);
      throw error;
    }
  });

  // 停止协作服务器
  ipcMain.handle("collaboration:stopServer", async () => {
    try {
      logger.info("[Main] 停止协作服务器");

      const { getCollaborationManager } = require("./collaboration-manager");
      const collaborationManager = getCollaborationManager();

      const result = await collaborationManager.stopServer();

      logger.info("[Main] 协作服务器已停止");
      return result;
    } catch (error) {
      logger.error("[Main] 停止协作服务器失败:", error);
      throw error;
    }
  });

  // 加入文档协作
  ipcMain.handle(
    "collaboration:joinDocument",
    async (_event, userId, userName, documentId) => {
      try {
        logger.info("[Main] 加入文档协作:", documentId);

        const { getCollaborationManager } = require("./collaboration-manager");
        const collaborationManager = getCollaborationManager();

        await collaborationManager.initialize();

        const result = await collaborationManager.joinDocument(
          userId,
          userName,
          documentId,
        );

        logger.info("[Main] 已加入文档协作");
        return result;
      } catch (error) {
        logger.error("[Main] 加入文档协作失败:", error);
        throw error;
      }
    },
  );

  // 提交协作操作
  ipcMain.handle(
    "collaboration:submitOperation",
    async (_event, documentId, userId, operation) => {
      try {
        const { getCollaborationManager } = require("./collaboration-manager");
        const collaborationManager = getCollaborationManager();

        await collaborationManager.initialize();

        const result = await collaborationManager.submitOperation(
          documentId,
          userId,
          operation,
        );

        return result;
      } catch (error) {
        logger.error("[Main] 提交协作操作失败:", error);
        throw error;
      }
    },
  );

  // 获取在线用户
  ipcMain.handle("collaboration:getOnlineUsers", async (_event, documentId) => {
    try {
      const { getCollaborationManager } = require("./collaboration-manager");
      const collaborationManager = getCollaborationManager();

      await collaborationManager.initialize();

      const users = collaborationManager.getOnlineUsers(documentId);

      return users;
    } catch (error) {
      logger.error("[Main] 获取在线用户失败:", error);
      throw error;
    }
  });

  // 获取操作历史
  ipcMain.handle(
    "collaboration:getOperationHistory",
    async (_event, documentId, limit) => {
      try {
        const { getCollaborationManager } = require("./collaboration-manager");
        const collaborationManager = getCollaborationManager();

        await collaborationManager.initialize();

        const history = collaborationManager.getOperationHistory(
          documentId,
          limit,
        );

        return history;
      } catch (error) {
        logger.error("[Main] 获取操作历史失败:", error);
        throw error;
      }
    },
  );

  // 获取会话历史
  ipcMain.handle(
    "collaboration:getSessionHistory",
    async (_event, documentId, limit) => {
      try {
        const { getCollaborationManager } = require("./collaboration-manager");
        const collaborationManager = getCollaborationManager();

        await collaborationManager.initialize();

        const history = collaborationManager.getSessionHistory(
          documentId,
          limit,
        );

        return history;
      } catch (error) {
        logger.error("[Main] 获取会话历史失败:", error);
        throw error;
      }
    },
  );

  // 获取服务器状态
  ipcMain.handle("collaboration:getStatus", async () => {
    try {
      const { getCollaborationManager } = require("./collaboration-manager");
      const collaborationManager = getCollaborationManager();

      await collaborationManager.initialize();

      const status = collaborationManager.getStatus();

      return status;
    } catch (error) {
      logger.error("[Main] 获取服务器状态失败:", error);
      throw error;
    }
  });

  logger.info("[IPC] 协作实时编辑IPC处理器注册完成（8个handlers）");
}

module.exports = {
  registerCollaborationIPC,
};
