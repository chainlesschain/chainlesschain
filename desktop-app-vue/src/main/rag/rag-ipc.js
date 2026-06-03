const { logger } = require("../utils/logger.js");

/**
 * RAG（检索增强生成）IPC 处理器
 * 负责处理 RAG 知识库检索相关的前后端通信
 *
 * @module rag-ipc
 * @description 提供 RAG 知识库检索、增强查询、索引管理、配置等 IPC 接口
 */

/**
 * 注册所有 RAG IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.ragManager - RAG 管理器
 * @param {Object} [dependencies.llmManager] - LLM 管理器（用于嵌入生成）
 * @param {Object} [dependencies.ipcMain] - IPC主进程对象（可选，用于测试注入）
 * @param {Object} [dependencies.ipcGuard] - IPC Guard模块（可选，用于测试注入）
 */
function registerRAGIPC({
  ragManager,
  llmManager,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
}) {
  // 支持依赖注入，用于测试
  const ipcGuard = injectedIpcGuard || require("../ipc/ipc-guard");

  // 防止重复注册
  if (ipcGuard.isModuleRegistered("rag-ipc")) {
    logger.info("[RAG IPC] Handlers already registered, skipping...");
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info("[RAG IPC] Registering RAG IPC handlers...");

  // ============================================================
  // RAG 知识库检索
  // ============================================================

  /**
   * 检索相关知识
   * Channel: 'rag:retrieve'
   */
  ipcMain.handle("rag:retrieve", async (_event, query, options = {}) => {
    try {
      if (!ragManager) {
        return [];
      }

      return await ragManager.retrieve(query, options);
    } catch (error) {
      logger.error("[RAG IPC] RAG检索失败:", error);
      return [];
    }
  });

  /**
   * 增强查询（检索 + 上下文增强）
   * Channel: 'rag:enhance-query'
   */
  ipcMain.handle("rag:enhance-query", async (_event, query, options = {}) => {
    try {
      if (!ragManager) {
        return {
          query,
          context: "",
          retrievedDocs: [],
        };
      }

      return await ragManager.enhanceQuery(query, options);
    } catch (error) {
      logger.error("[RAG IPC] RAG增强查询失败:", error);
      return {
        query,
        context: "",
        retrievedDocs: [],
      };
    }
  });

  // ============================================================
  // RAG 索引管理
  // ============================================================

  /**
   * 重建索引
   * Channel: 'rag:rebuild-index'
   */
  ipcMain.handle("rag:rebuild-index", async () => {
    try {
      if (!ragManager) {
        throw new Error("RAG服务未初始化");
      }

      await ragManager.rebuildIndex();
      return { success: true };
    } catch (error) {
      logger.error("[RAG IPC] RAG重建索引失败:", error);
      throw error;
    }
  });

  /**
   * 获取索引统计信息
   * Channel: 'rag:get-stats'
   */
  ipcMain.handle("rag:get-stats", async () => {
    try {
      if (!ragManager) {
        return {
          totalItems: 0,
          cacheStats: { size: 0, maxSize: 0 },
          config: {},
        };
      }

      return ragManager.getIndexStats();
    } catch (error) {
      logger.error("[RAG IPC] 获取RAG统计失败:", error);
      return {
        totalItems: 0,
        cacheStats: { size: 0, maxSize: 0 },
        config: {},
      };
    }
  });

  // ============================================================
  // RAG 配置管理
  // ============================================================

  /**
   * 更新 RAG 配置
   * Channel: 'rag:update-config'
   */
  ipcMain.handle("rag:update-config", async (_event, config) => {
    try {
      if (!ragManager) {
        throw new Error("RAG服务未初始化");
      }

      ragManager.updateConfig(config);
      return { success: true };
    } catch (error) {
      logger.error("[RAG IPC] 更新RAG配置失败:", error);
      throw error;
    }
  });

  // ============================================================
  // RAG 重排序功能
  // ============================================================

  /**
   * 获取重排序配置
   * Channel: 'rag:get-rerank-config'
   */
  ipcMain.handle("rag:get-rerank-config", async () => {
    try {
      if (!ragManager) {
        return null;
      }

      return ragManager.getRerankConfig();
    } catch (error) {
      logger.error("[RAG IPC] 获取重排序配置失败:", error);
      return null;
    }
  });

  /**
   * 设置重排序启用状态
   * Channel: 'rag:set-reranking-enabled'
   */
  ipcMain.handle("rag:set-reranking-enabled", async (_event, enabled) => {
    try {
      if (!ragManager) {
        throw new Error("RAG服务未初始化");
      }

      ragManager.setRerankingEnabled(enabled);
      return { success: true };
    } catch (error) {
      logger.error("[RAG IPC] 设置重排序状态失败:", error);
      throw error;
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered("rag-ipc");

  logger.info(
    "[RAG IPC] ✓ All RAG IPC handlers registered successfully (7 handlers)",
  );
}

module.exports = {
  registerRAGIPC,
};
