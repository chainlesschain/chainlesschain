/**
 * Knowledge Graph IPC Handlers
 * 知识图谱系统 IPC 处理器
 *
 * 提供11个IPC处理器用于知识图谱的构建、查询和管理
 */

const { ipcMain } = require('electron');

/**
 * 注册知识图谱相关的IPC处理器
 * @param {Object} context - 上下文对象
 * @param {Object} context.database - 数据库管理器实例
 * @param {Object} context.graphExtractor - 图谱提取器实例
 * @param {Object} context.llmManager - LLM管理器实例
 */
function registerGraphIPC(context) {
  const { database, graphExtractor, llmManager } = context;

  // 1. 获取图谱数据
  ipcMain.handle('graph:get-graph-data', async (_event, options) => {
    try {
      if (!database) {
        return { nodes: [], edges: [] };
      }
      return database.getGraphData(options);
    } catch (error) {
      console.error('[Graph IPC] 获取图谱数据失败:', error);
      return { nodes: [], edges: [] };
    }
  });

  // 2. 处理单个笔记的图谱关系
  ipcMain.handle('graph:process-note', async (_event, noteId, content, tags) => {
    try {
      if (!graphExtractor) {
        console.warn('[Graph IPC] GraphExtractor 未初始化');
        return 0;
      }
      return graphExtractor.processNote(noteId, content, tags);
    } catch (error) {
      console.error('[Graph IPC] 处理笔记关系失败:', error);
      return 0;
    }
  });

  // 3. 批量处理所有笔记
  ipcMain.handle('graph:process-all-notes', async (_event, noteIds) => {
    try {
      if (!graphExtractor) {
        console.warn('[Graph IPC] GraphExtractor 未初始化');
        return { processed: 0, linkRelations: 0, tagRelations: 0, temporalRelations: 0 };
      }
      return graphExtractor.processAllNotes(noteIds);
    } catch (error) {
      console.error('[Graph IPC] 批量处理笔记失败:', error);
      return { processed: 0, linkRelations: 0, tagRelations: 0, temporalRelations: 0 };
    }
  });

  // 4. 获取笔记的所有关系
  ipcMain.handle('graph:get-knowledge-relations', async (_event, knowledgeId) => {
    try {
      if (!database) {
        return [];
      }
      return database.getKnowledgeRelations(knowledgeId);
    } catch (error) {
      console.error('[Graph IPC] 获取笔记关系失败:', error);
      return [];
    }
  });

  // 5. 查找关联路径
  ipcMain.handle('graph:find-related-notes', async (_event, sourceId, targetId, maxDepth) => {
    try {
      if (!database) {
        return null;
      }
      return database.findRelatedNotes(sourceId, targetId, maxDepth);
    } catch (error) {
      console.error('[Graph IPC] 查找关联路径失败:', error);
      return null;
    }
  });

  // 6. 查找潜在链接
  ipcMain.handle('graph:find-potential-links', async (_event, noteId, content) => {
    try {
      if (!graphExtractor) {
        return [];
      }
      return graphExtractor.findPotentialLinks(noteId, content);
    } catch (error) {
      console.error('[Graph IPC] 查找潜在链接失败:', error);
      return [];
    }
  });

  // 7. 添加关系
  ipcMain.handle('graph:add-relation', async (_event, sourceId, targetId, type, weight, metadata) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }
      return database.addRelation(sourceId, targetId, type, weight, metadata);
    } catch (error) {
      console.error('[Graph IPC] 添加关系失败:', error);
      throw error;
    }
  });

  // 8. 删除关系
  ipcMain.handle('graph:delete-relations', async (_event, noteId, types) => {
    try {
      if (!database) {
        return 0;
      }
      return database.deleteRelations(noteId, types);
    } catch (error) {
      console.error('[Graph IPC] 删除关系失败:', error);
      return 0;
    }
  });

  // 9. 构建标签关系
  ipcMain.handle('graph:build-tag-relations', async (_event) => {
    try {
      if (!database) {
        return 0;
      }
      return database.buildTagRelations();
    } catch (error) {
      console.error('[Graph IPC] 构建标签关系失败:', error);
      return 0;
    }
  });

  // 10. 构建时间关系
  ipcMain.handle('graph:build-temporal-relations', async (_event, windowDays) => {
    try {
      if (!database) {
        return 0;
      }
      return database.buildTemporalRelations(windowDays);
    } catch (error) {
      console.error('[Graph IPC] 构建时间关系失败:', error);
      return 0;
    }
  });

  // 11. 提取语义关系
  ipcMain.handle('graph:extract-semantic-relations', async (_event, noteId, content) => {
    try {
      if (!graphExtractor || !llmManager) {
        console.warn('[Graph IPC] GraphExtractor 或 LLMManager 未初始化');
        return [];
      }
      return await graphExtractor.extractSemanticRelations(noteId, content, llmManager);
    } catch (error) {
      console.error('[Graph IPC] 提取语义关系失败:', error);
      return [];
    }
  });

  console.log('[Graph IPC] 已注册 11 个知识图谱 IPC 处理器');
}

module.exports = {
  registerGraphIPC
};
