const { logger } = require('../utils/logger.js');
const { getProjectRAGManager } = require('./project-rag.js');

/**
 * RAG API - Project RAG indexing and query API
 * 提供项目级别的 RAG 索引和查询功能
 *
 * @module rag-api
 * @description 项目 RAG 向量检索 API - 委托给 ProjectRAGManager 实现
 */

// 缓存 ProjectRAGManager 实例
let projectRAGManager = null;

/**
 * 获取并初始化 ProjectRAGManager
 * @returns {Promise<Object>} ProjectRAGManager 实例
 */
async function getManager() {
  if (!projectRAGManager) {
    projectRAGManager = getProjectRAGManager();
    await projectRAGManager.initialize();
  }
  return projectRAGManager;
}

/**
 * 索引项目
 * @param {string} projectId - 项目ID
 * @param {string} projectPath - 项目路径 (可选，将从数据库获取)
 * @param {Object} options - 索引选项
 * @param {boolean} options.forceReindex - 是否强制重新索引
 * @param {string[]} options.fileTypes - 限定文件类型
 * @param {boolean} options.enableWatcher - 是否启用文件监听
 * @param {Function} options.onProgress - 进度回调
 * @returns {Promise<Object>} { success: boolean, error?: string, ... }
 */
async function indexProject(projectId, projectPath = null, options = {}) {
  try {
    logger.info(`[RAG API] 索引项目: ${projectId}, 路径: ${projectPath || '(从数据库获取)'}`);

    const manager = await getManager();

    const result = await manager.indexProjectFiles(projectId, {
      forceReindex: options.forceReindex || false,
      fileTypes: options.fileTypes || null,
      enableWatcher: options.enableWatcher !== false,
    }, options.onProgress || null);

    return {
      success: true,
      projectId,
      projectPath,
      totalFiles: result.totalFiles,
      indexedCount: result.indexedCount,
      skippedCount: result.skippedCount,
      errors: result.errors,
    };
  } catch (error) {
    logger.error('[RAG API] 索引项目失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 获取索引统计
 * @param {string} projectId - 项目ID
 * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }
 */
async function getIndexStats(projectId) {
  try {
    logger.info(`[RAG API] 获取索引统计: ${projectId}`);

    const manager = await getManager();
    const stats = await manager.getIndexStats(projectId);

    return {
      success: true,
      data: {
        projectId: stats.projectId,
        totalFiles: stats.totalFiles,
        indexedFiles: stats.indexedFiles,
        indexedPercentage: stats.indexedPercentage,
        indexedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.error('[RAG API] 获取索引统计失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * RAG 增强查询
 * @param {string} projectId - 项目ID
 * @param {string} query - 查询字符串
 * @param {number} topK - 返回结果数量
 * @param {Object} options - 查询选项
 * @param {number} options.projectLimit - 项目文件检索数量
 * @param {number} options.knowledgeLimit - 知识库检索数量
 * @param {number} options.conversationLimit - 对话历史检索数量
 * @param {boolean} options.useReranker - 是否使用重排序
 * @returns {Promise<Object>} { success: boolean, results?: Array, error?: string }
 */
async function enhancedQuery(projectId, query, topK = 5, options = {}) {
  try {
    logger.info(`[RAG API] RAG查询: ${projectId}, query: ${query}, topK: ${topK}`);

    const manager = await getManager();

    const result = await manager.enhancedQuery(projectId, query, {
      projectLimit: options.projectLimit || topK,
      knowledgeLimit: options.knowledgeLimit || Math.ceil(topK / 2),
      conversationLimit: options.conversationLimit || Math.ceil(topK / 2),
      useReranker: options.useReranker !== false,
    });

    return {
      success: true,
      query: result.query,
      projectId: result.projectId,
      results: result.context,
      totalDocs: result.totalDocs,
      sources: result.sources,
      summary: result.summary,
    };
  } catch (error) {
    logger.error('[RAG API] RAG查询失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 更新文件索引
 * @param {string} projectId - 项目ID
 * @param {string} filePath - 文件路径
 * @param {string} content - 文件内容 (可选，将从文件系统读取)
 * @returns {Promise<Object>} { success: boolean, error?: string }
 */
async function updateFileIndex(projectId, filePath, _content = null) {
  try {
    logger.info(`[RAG API] 更新文件索引: ${projectId}, 文件: ${filePath}`);

    const manager = await getManager();

    // 获取文件ID (从数据库查询)
    const { getDatabase } = require('../database');
    const db = getDatabase();

    const file = db.prepare(`
      SELECT id FROM project_files
      WHERE project_id = ? AND file_path = ?
    `).get(projectId, filePath);

    if (!file) {
      return {
        success: false,
        error: `文件不存在: ${filePath}`,
      };
    }

    const result = await manager.updateFileIndex(file.id);

    return {
      success: true,
      fileId: file.id,
      fileName: result.fileName,
      skipped: result.skipped || false,
    };
  } catch (error) {
    logger.error('[RAG API] 更新文件索引失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 删除项目索引
 * @param {string} projectId - 项目ID
 * @returns {Promise<Object>} { success: boolean, error?: string }
 */
async function deleteProjectIndex(projectId) {
  try {
    logger.info(`[RAG API] 删除项目索引: ${projectId}`);

    const manager = await getManager();
    const result = await manager.deleteProjectIndex(projectId);

    // 同时停止文件监听
    manager.stopFileWatcher(projectId);

    return {
      success: true,
      projectId: result.projectId,
      deletedCount: result.deletedCount,
    };
  } catch (error) {
    logger.error('[RAG API] 删除项目索引失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 索引项目对话历史
 * @param {string} projectId - 项目ID
 * @param {Object} options - 选项
 * @param {number} options.limit - 对话数量限制
 * @returns {Promise<Object>} { success: boolean, error?: string, ... }
 */
async function indexConversationHistory(projectId, options = {}) {
  try {
    logger.info(`[RAG API] 索引对话历史: ${projectId}`);

    const manager = await getManager();
    const result = await manager.indexConversationHistory(projectId, options);

    return {
      success: true,
      projectId: result.projectId,
      totalConversations: result.totalConversations,
      indexedCount: result.indexedCount,
      errors: result.errors,
    };
  } catch (error) {
    logger.error('[RAG API] 索引对话历史失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 启动文件监听
 * @param {string} projectId - 项目ID
 * @param {string} projectPath - 项目路径
 * @returns {Promise<Object>} { success: boolean, error?: string }
 */
async function startFileWatcher(projectId, projectPath) {
  try {
    logger.info(`[RAG API] 启动文件监听: ${projectId}, 路径: ${projectPath}`);

    const manager = await getManager();
    await manager.startFileWatcher(projectId, projectPath);

    return {
      success: true,
      projectId,
      projectPath,
    };
  } catch (error) {
    logger.error('[RAG API] 启动文件监听失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 停止文件监听
 * @param {string} projectId - 项目ID
 * @returns {Promise<Object>} { success: boolean, error?: string }
 */
async function stopFileWatcher(projectId) {
  try {
    logger.info(`[RAG API] 停止文件监听: ${projectId}`);

    const manager = await getManager();
    manager.stopFileWatcher(projectId);

    return {
      success: true,
      projectId,
    };
  } catch (error) {
    logger.error('[RAG API] 停止文件监听失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 获取 ProjectRAGManager 事件发射器
 * 用于监听索引进度等事件
 * @returns {Promise<EventEmitter>} ProjectRAGManager 实例
 */
async function getEventEmitter() {
  return await getManager();
}

module.exports = {
  indexProject,
  getIndexStats,
  enhancedQuery,
  updateFileIndex,
  deleteProjectIndex,
  indexConversationHistory,
  startFileWatcher,
  stopFileWatcher,
  getEventEmitter,
};
