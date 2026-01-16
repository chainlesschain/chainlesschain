/**
 * SessionManager IPC 处理器
 * 负责处理会话管理相关的前后端通信
 *
 * @module session-manager-ipc
 * @version 1.0.0
 * @since 2026-01-16
 */

const ipcGuard = require("../ipc-guard");

/**
 * 注册所有 SessionManager IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.sessionManager - SessionManager 实例
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象（可选，用于测试注入）
 */
function registerSessionManagerIPC({
  sessionManager,
  ipcMain: injectedIpcMain,
}) {
  // 防止重复注册
  if (ipcGuard.isModuleRegistered("session-manager-ipc")) {
    console.log(
      "[SessionManager IPC] Handlers already registered, skipping...",
    );
    return;
  }

  // 支持依赖注入，用于测试
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  console.log(
    "[SessionManager IPC] Registering SessionManager IPC handlers...",
  );

  // 创建可变的引用容器
  const managerRef = { current: sessionManager };

  // ============================================================
  // 会话管理
  // ============================================================

  /**
   * 创建新会话
   * Channel: 'session:create'
   */
  ipcMain.handle("session:create", async (_event, params) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.createSession(params);
    } catch (error) {
      console.error("[SessionManager IPC] 创建会话失败:", error);
      throw error;
    }
  });

  /**
   * 加载会话
   * Channel: 'session:load'
   */
  ipcMain.handle("session:load", async (_event, sessionId, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.loadSession(sessionId, options);
    } catch (error) {
      console.error("[SessionManager IPC] 加载会话失败:", error);
      throw error;
    }
  });

  /**
   * 添加消息到会话
   * Channel: 'session:add-message'
   */
  ipcMain.handle(
    "session:add-message",
    async (_event, sessionId, message, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.addMessage(sessionId, message, options);
      } catch (error) {
        console.error("[SessionManager IPC] 添加消息失败:", error);
        throw error;
      }
    },
  );

  /**
   * 压缩会话历史
   * Channel: 'session:compress'
   */
  ipcMain.handle("session:compress", async (_event, sessionId) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.compressSession(sessionId);
    } catch (error) {
      console.error("[SessionManager IPC] 压缩会话失败:", error);
      throw error;
    }
  });

  /**
   * 保存会话
   * Channel: 'session:save'
   */
  ipcMain.handle("session:save", async (_event, sessionId) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      await managerRef.current.saveSession(sessionId);
      return { success: true };
    } catch (error) {
      console.error("[SessionManager IPC] 保存会话失败:", error);
      throw error;
    }
  });

  /**
   * 获取有效消息（用于 LLM 调用）
   * Channel: 'session:get-effective-messages'
   */
  ipcMain.handle(
    "session:get-effective-messages",
    async (_event, sessionId) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.getEffectiveMessages(sessionId);
      } catch (error) {
        console.error("[SessionManager IPC] 获取有效消息失败:", error);
        throw error;
      }
    },
  );

  /**
   * 删除会话
   * Channel: 'session:delete'
   */
  ipcMain.handle("session:delete", async (_event, sessionId) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      await managerRef.current.deleteSession(sessionId);
      return { success: true };
    } catch (error) {
      console.error("[SessionManager IPC] 删除会话失败:", error);
      throw error;
    }
  });

  /**
   * 列出会话
   * Channel: 'session:list'
   */
  ipcMain.handle("session:list", async (_event, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.listSessions(options);
    } catch (error) {
      console.error("[SessionManager IPC] 列出会话失败:", error);
      throw error;
    }
  });

  /**
   * 获取会话统计
   * Channel: 'session:get-stats'
   */
  ipcMain.handle("session:get-stats", async (_event, sessionId) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.getSessionStats(sessionId);
    } catch (error) {
      console.error("[SessionManager IPC] 获取统计失败:", error);
      throw error;
    }
  });

  /**
   * 清理旧会话
   * Channel: 'session:cleanup-old'
   */
  ipcMain.handle("session:cleanup-old", async (_event, daysToKeep = 30) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      const deletedCount =
        await managerRef.current.cleanupOldSessions(daysToKeep);
      return {
        success: true,
        deletedCount,
      };
    } catch (error) {
      console.error("[SessionManager IPC] 清理旧会话失败:", error);
      throw error;
    }
  });

  /**
   * 更新 SessionManager 引用
   * 用于热重载或重新初始化
   * @param {SessionManager} newSessionManager - 新的 SessionManager 实例
   */
  function updateSessionManager(newSessionManager) {
    managerRef.current = newSessionManager;
    console.log("[SessionManager IPC] SessionManager 引用已更新");
  }

  // 标记为已注册
  ipcGuard.markAsRegistered("session-manager-ipc");

  console.log(
    "[SessionManager IPC] SessionManager IPC handlers registered successfully",
  );

  // 返回更新函数，供主进程使用
  return {
    updateSessionManager,
  };
}

module.exports = {
  registerSessionManagerIPC,
};
