/**
 * Knowledge Graph IPC Handlers
 * 知识图谱系统 IPC 处理器
 *
 * 提供11个IPC处理器用于知识图谱的构建、查询和管理
 */

const { logger, createLogger } = require('../utils/logger.js');
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
      logger.error('[Graph IPC] 获取图谱数据失败:', error);
      return { nodes: [], edges: [] };
    }
  });

  // 2. 处理单个笔记的图谱关系
  ipcMain.handle('graph:process-note', async (_event, noteId, content, tags) => {
    try {
      if (!graphExtractor) {
        logger.warn('[Graph IPC] GraphExtractor 未初始化');
        return 0;
      }
      return graphExtractor.processNote(noteId, content, tags);
    } catch (error) {
      logger.error('[Graph IPC] 处理笔记关系失败:', error);
      return 0;
    }
  });

  // 3. 批量处理所有笔记
  ipcMain.handle('graph:process-all-notes', async (_event, noteIds) => {
    try {
      if (!graphExtractor) {
        logger.warn('[Graph IPC] GraphExtractor 未初始化');
        return { processed: 0, linkRelations: 0, tagRelations: 0, temporalRelations: 0 };
      }
      return graphExtractor.processAllNotes(noteIds);
    } catch (error) {
      logger.error('[Graph IPC] 批量处理笔记失败:', error);
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
      logger.error('[Graph IPC] 获取笔记关系失败:', error);
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
      logger.error('[Graph IPC] 查找关联路径失败:', error);
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
      logger.error('[Graph IPC] 查找潜在链接失败:', error);
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
      logger.error('[Graph IPC] 添加关系失败:', error);
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
      logger.error('[Graph IPC] 删除关系失败:', error);
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
      logger.error('[Graph IPC] 构建标签关系失败:', error);
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
      logger.error('[Graph IPC] 构建时间关系失败:', error);
      return 0;
    }
  });

  // 11. 提取语义关系
  ipcMain.handle('graph:extract-semantic-relations', async (_event, noteId, content) => {
    try {
      if (!graphExtractor || !llmManager) {
        logger.warn('[Graph IPC] GraphExtractor 或 LLMManager 未初始化');
        return [];
      }
      return await graphExtractor.extractSemanticRelations(noteId, content, llmManager);
    } catch (error) {
      logger.error('[Graph IPC] 提取语义关系失败:', error);
      return [];
    }
  });

  // 12. 计算节点中心性
  ipcMain.handle('graph:calculate-centrality', async (_event, nodes, edges, type) => {
    try {
      const analytics = require('./graph-analytics');

      switch (type) {
        case 'degree':
          return Array.from(analytics.calculateDegreeCentrality(nodes, edges).entries());
        case 'closeness':
          return Array.from(analytics.calculateClosenessCentrality(nodes, edges).entries());
        case 'betweenness':
          return Array.from(analytics.calculateBetweennessCentrality(nodes, edges).entries());
        case 'pagerank':
          return Array.from(analytics.calculatePageRank(nodes, edges).entries());
        default:
          throw new Error(`未知的中心性类型: ${type}`);
      }
    } catch (error) {
      logger.error('[Graph IPC] 计算中心性失败:', error);
      return [];
    }
  });

  // 13. 社区检测
  ipcMain.handle('graph:detect-communities', async (_event, nodes, edges) => {
    try {
      const analytics = require('./graph-analytics');
      const communities = analytics.detectCommunities(nodes, edges);
      return Array.from(communities.entries());
    } catch (error) {
      logger.error('[Graph IPC] 社区检测失败:', error);
      return [];
    }
  });

  // 14. 节点聚类
  ipcMain.handle('graph:cluster-nodes', async (_event, nodes, edges, k) => {
    try {
      const analytics = require('./graph-analytics');
      const clusters = analytics.clusterNodes(nodes, edges, k);
      return Array.from(clusters.entries());
    } catch (error) {
      logger.error('[Graph IPC] 节点聚类失败:', error);
      return [];
    }
  });

  // 15. 查找关键节点
  ipcMain.handle('graph:find-key-nodes', async (_event, nodes, edges, topN) => {
    try {
      const analytics = require('./graph-analytics');
      return analytics.findKeyNodes(nodes, edges, topN);
    } catch (error) {
      logger.error('[Graph IPC] 查找关键节点失败:', error);
      return [];
    }
  });

  // 16. 分析图谱统计
  ipcMain.handle('graph:analyze-stats', async (_event, nodes, edges) => {
    try {
      const analytics = require('./graph-analytics');
      return analytics.analyzeGraphStats(nodes, edges);
    } catch (error) {
      logger.error('[Graph IPC] 分析图谱统计失败:', error);
      return null;
    }
  });

  // 17. 导出图谱
  ipcMain.handle('graph:export-graph', async (_event, nodes, edges, format) => {
    try {
      const { exportGraph } = require('./graph-export');
      const result = await exportGraph(nodes, edges, format);
      return result;
    } catch (error) {
      logger.error('[Graph IPC] 导出图谱失败:', error);
      throw error;
    }
  });

  // 18. 提取实体
  ipcMain.handle('graph:extract-entities', async (_event, text, useLLM) => {
    try {
      const entityExtraction = require('./entity-extraction');

      if (useLLM && llmManager) {
        return await entityExtraction.extractEntitiesWithLLM(text, llmManager);
      } else {
        return { entities: entityExtraction.extractEntities(text), relations: [] };
      }
    } catch (error) {
      logger.error('[Graph IPC] 提取实体失败:', error);
      return { entities: [], relations: [] };
    }
  });

  // 19. 提取关键词
  ipcMain.handle('graph:extract-keywords', async (_event, text, topN) => {
    try {
      const entityExtraction = require('./entity-extraction');
      return entityExtraction.extractKeywords(text, topN);
    } catch (error) {
      logger.error('[Graph IPC] 提取关键词失败:', error);
      return [];
    }
  });

  // 20. 批量处理笔记提取实体
  ipcMain.handle('graph:process-notes-entities', async (_event, notes, useLLM) => {
    try {
      const entityExtraction = require('./entity-extraction');
      const manager = useLLM ? llmManager : null;
      return await entityExtraction.processNotesForEntities(notes, manager);
    } catch (error) {
      logger.error('[Graph IPC] 批量处理笔记失败:', error);
      return [];
    }
  });

  // 21. 构建实体关系图
  ipcMain.handle('graph:build-entity-graph', async (_event, processedNotes) => {
    try {
      const entityExtraction = require('./entity-extraction');
      return entityExtraction.buildEntityGraph(processedNotes);
    } catch (error) {
      logger.error('[Graph IPC] 构建实体关系图失败:', error);
      return { nodes: [], edges: [] };
    }
  });

  logger.info('[Graph IPC] 已注册 21 个知识图谱 IPC 处理器');
}

module.exports = {
  registerGraphIPC
};
