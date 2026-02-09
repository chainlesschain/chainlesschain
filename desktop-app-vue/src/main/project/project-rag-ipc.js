/**
 * 项目 RAG 检索 IPC
 * 处理项目文件的向量索引和增强检索
 *
 * @module project-rag-ipc
 * @description 项目 RAG 模块，支持文件索引、增强查询、统计等功能
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");
const {
  getIncrementalIndexManager,
  getMultiFileRetriever,
  getUnifiedRetriever,
  getProjectAwareReranker,
} = require("./project-rag.js");

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

  // ============================================================
  // 增强 RAG 接口 (v0.32.0) - 6 handlers
  // ============================================================

  /**
   * 增量索引项目文件
   * 通过 content hash 检测变化，避免重复索引
   */
  ipcMain.handle(
    "project:incrementalIndex",
    async (_event, projectId, options = {}) => {
      try {
        logger.info(`[Main] 增量索引项目: ${projectId}`);

        const manager = getIncrementalIndexManager();
        const result = await manager.incrementalIndex(projectId, options);

        logger.info("[Main] 增量索引完成:", result.stats);
        return result;
      } catch (error) {
        logger.error("[Main] 增量索引失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 多文件联合检索
   * 支持文件关系追踪和跨文件上下文聚合
   */
  ipcMain.handle(
    "project:jointRetrieve",
    async (_event, projectId, query, options = {}) => {
      try {
        logger.info(`[Main] 联合检索: ${query}`);

        const retriever = getMultiFileRetriever();
        const result = await retriever.jointRetrieve(projectId, query, options);

        logger.info("[Main] 联合检索完成:", result.stats);
        return result;
      } catch (error) {
        logger.error("[Main] 联合检索失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取文件关系（导入/被导入）
   */
  ipcMain.handle(
    "project:getFileRelations",
    async (_event, projectId, fileId) => {
      try {
        logger.info(`[Main] 获取文件关系: ${fileId}`);

        const retriever = getMultiFileRetriever();
        const result = await retriever.getFileRelations(projectId, fileId);

        return { success: true, ...result };
      } catch (error) {
        logger.error("[Main] 获取文件关系失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 统一检索（知识库-项目-对话联合）
   * 并行检索3个数据源，应用来源权重
   */
  ipcMain.handle(
    "project:unifiedRetrieve",
    async (_event, projectId, query, options = {}) => {
      try {
        logger.info(`[Main] 统一检索: ${query}`);

        const retriever = getUnifiedRetriever();
        const result = await retriever.unifiedRetrieve(
          projectId,
          query,
          options,
        );

        logger.info("[Main] 统一检索完成:", result.sources);
        return result;
      } catch (error) {
        logger.error("[Main] 统一检索失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 更新检索权重
   * 调整项目/对话/知识库的检索权重
   */
  ipcMain.handle("project:updateRetrieveWeights", async (_event, weights) => {
    try {
      logger.info("[Main] 更新检索权重:", weights);

      const retriever = getUnifiedRetriever();
      const newWeights = retriever.updateWeights(weights);

      return { success: true, weights: newWeights };
    } catch (error) {
      logger.error("[Main] 更新检索权重失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 项目感知重排序
   * 基于项目上下文优化检索结果排序
   */
  ipcMain.handle(
    "project:projectAwareRerank",
    async (_event, query, documents, context = {}) => {
      try {
        logger.info(`[Main] 项目感知重排序: ${documents.length} 个文档`);

        const reranker = getProjectAwareReranker();
        const result = await reranker.rerank(query, documents, context);

        return { success: true, documents: result };
      } catch (error) {
        logger.error("[Main] 项目感知重排序失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  logger.info("[Project RAG IPC] ✓ 16 handlers registered");
  logger.info(
    "[Project RAG IPC] - 5 legacy RAG handlers (via ProjectRAGManager)",
  );
  logger.info("[Project RAG IPC] - 5 new RAG handlers (via RAGAPI)");
  logger.info("[Project RAG IPC] - 6 enhanced RAG handlers (v0.32.0)");
}

module.exports = {
  registerProjectRAGIPC,
};
