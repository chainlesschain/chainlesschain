/**
 * 项目 RAG 检索 IPC
 * 处理项目文件的向量索引和增强检索
 *
 * @module project-rag-ipc
 * @description 项目 RAG 模块，支持文件索引、增强查询、统计等功能
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * 注册项目 RAG 检索相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Function} dependencies.getProjectRAGManager - 获取项目 RAG 管理器
 * @param {Function} dependencies.getProjectConfig - 获取项目配置
 * @param {Object} dependencies.RAGAPI - RAG API 实例
 */
function registerProjectRAGIPC({
  getProjectRAGManager,
  getProjectConfig,
  RAGAPI,
}) {
  logger.info("[Project RAG IPC] Registering Project RAG IPC handlers...");

  // ============================================================
  // 旧版 RAG 接口 (通过 ProjectRAGManager) - 5 handlers
  // ============================================================

  /**
   * 索引项目文件
   * 将项目中的所有文件建立向量索引
   */
  ipcMain.handle(
    "project:indexFiles",
    async (_event, projectId, options = {}) => {
      try {
        logger.info(`[Main] 索引项目文件: ${projectId}`);

        const projectRAG = getProjectRAGManager();

        // 确保初始化
        await projectRAG.initialize();

        // 执行索引
        const result = await projectRAG.indexProjectFiles(projectId, options);

        logger.info("[Main] 索引完成:", result);
        return result;
      } catch (error) {
        logger.error("[Main] 索引项目文件失败:", error);
        throw error;
      }
    },
  );

  /**
   * RAG 增强查询（旧版）
   * 使用向量检索增强的查询功能
   */
  ipcMain.handle(
    "project:ragQuery",
    async (_event, projectId, query, options = {}) => {
      try {
        logger.info(`[Main] RAG增强查询: ${query}`);

        const projectRAG = getProjectRAGManager();

        // 确保初始化
        await projectRAG.initialize();

        // 执行增强查询
        const result = await projectRAG.enhancedQuery(
          projectId,
          query,
          options,
        );

        logger.info("[Main] RAG查询完成，找到", result.totalDocs, "个相关文档");
        return result;
      } catch (error) {
        logger.error("[Main] RAG查询失败:", error);
        throw error;
      }
    },
  );

  /**
   * 更新单个文件索引
   * 当文件内容变化时更新其向量索引
   */
  ipcMain.handle("project:updateFileIndex", async (_event, fileId) => {
    try {
      logger.info(`[Main] 更新文件索引: ${fileId}`);

      const projectRAG = getProjectRAGManager();

      await projectRAG.initialize();

      const result = await projectRAG.updateFileIndex(fileId);

      logger.info("[Main] 文件索引更新完成");
      return result;
    } catch (error) {
      logger.error("[Main] 更新文件索引失败:", error);
      throw error;
    }
  });

  /**
   * 删除项目索引
   * 删除项目的所有向量索引数据
   */
  ipcMain.handle("project:deleteIndex", async (_event, projectId) => {
    try {
      logger.info(`[Main] 删除项目索引: ${projectId}`);

      const projectRAG = getProjectRAGManager();

      await projectRAG.initialize();

      const result = await projectRAG.deleteProjectIndex(projectId);

      logger.info("[Main] 项目索引删除完成");
      return result;
    } catch (error) {
      logger.error("[Main] 删除项目索引失败:", error);
      throw error;
    }
  });

  /**
   * 获取项目索引统计
   * 获取项目索引的文档数量、向量维度等统计信息
   */
  ipcMain.handle("project:getIndexStats", async (_event, projectId) => {
    try {
      const projectRAG = getProjectRAGManager();

      await projectRAG.initialize();

      const stats = await projectRAG.getIndexStats(projectId);

      return stats;
    } catch (error) {
      logger.error("[Main] 获取索引统计失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 新版 RAG 接口 (通过 RAGAPI) - 5 handlers
  // ============================================================

  /**
   * 索引项目（新版）
   * 使用 RAGAPI 建立项目索引
   */
  ipcMain.handle("project:rag-index", async (_event, projectId, repoPath) => {
    try {
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(repoPath);
      return await RAGAPI.indexProject(projectId, resolvedPath);
    } catch (error) {
      logger.error("[Main] RAG索引失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取索引统计（新版）
   * 使用 RAGAPI 获取索引统计信息
   */
  ipcMain.handle("project:rag-stats", async (_event, projectId) => {
    try {
      return await RAGAPI.getIndexStats(projectId);
    } catch (error) {
      logger.error("[Main] 获取索引统计失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * RAG 增强查询（新版）
   * 使用 RAGAPI 进行向量检索
   */
  ipcMain.handle(
    "project:rag-query",
    async (_event, projectId, query, topK = 5) => {
      try {
        return await RAGAPI.enhancedQuery(projectId, query, topK);
      } catch (error) {
        logger.error("[Main] RAG查询失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 更新文件索引（新版）
   * 使用 RAGAPI 更新指定文件的索引
   */
  ipcMain.handle(
    "project:rag-update-file",
    async (_event, projectId, filePath, content) => {
      try {
        return await RAGAPI.updateFileIndex(projectId, filePath, content);
      } catch (error) {
        logger.error("[Main] 更新文件索引失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 删除项目索引（新版）
   * 使用 RAGAPI 删除项目的所有索引
   */
  ipcMain.handle("project:rag-delete", async (_event, projectId) => {
    try {
      return await RAGAPI.deleteProjectIndex(projectId);
    } catch (error) {
      logger.error("[Main] 删除项目索引失败:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[Project RAG IPC] ✓ 10 handlers registered");
  logger.info(
    "[Project RAG IPC] - 5 legacy RAG handlers (via ProjectRAGManager)",
  );
  logger.info("[Project RAG IPC] - 5 new RAG handlers (via RAGAPI)");
}

module.exports = {
  registerProjectRAGIPC,
};
