/**
 * 项目RAG管理器
 * 负责项目文件的向量化索引、检索增强和知识库集成
 */

const { logger, createLogger } = require('../utils/logger.js');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');
const EventEmitter = require('events');

class ProjectRAGManager extends EventEmitter {
  constructor() {
    super();
    this.ragManager = null;
    this.database = null;
    this.initialized = false;
    this.fileWatchers = new Map(); // projectId -> watcher
  }

  /**
   * 初始化项目RAG系统
   */
  async initialize() {
    if (this.initialized) {return;}

    try {
      // 获取RAG管理器
      const { getRAGManager } = require('../rag/rag-manager');
      this.ragManager = getRAGManager();

      // 获取数据库
      const { getDatabase } = require('../database');
      this.database = getDatabase();

      this.initialized = true;
      logger.info('[ProjectRAG] 初始化完成');
    } catch (error) {
      logger.error('[ProjectRAG] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 确保已初始化
   */
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error('ProjectRAGManager 未初始化，请先调用 initialize()');
    }
  }

  /**
   * 索引项目文件
   * @param {string} projectId - 项目ID
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调 (current, total, fileName)
   * @returns {Promise<Object>} 索引结果
   */
  async indexProjectFiles(projectId, options = {}, onProgress = null) {
    this.ensureInitialized();

    const {
      forceReindex = false,  // 是否强制重新索引
      fileTypes = null,       // 限定文件类型，null表示所有
      enableWatcher = true    // 是否启用文件监听
    } = options;

    logger.info(`[ProjectRAG] 开始索引项目文件: ${projectId}`);

    try {
      // 1. 获取项目信息
      const project = this.database.prepare(`
        SELECT * FROM projects WHERE id = ?
      `).get(projectId);

      if (!project) {
        throw new Error(`项目不存在: ${projectId}`);
      }

      // 2. 获取项目所有文件
      let query = `
        SELECT * FROM project_files
        WHERE project_id = ?
      `;
      const params = [projectId];

      if (fileTypes && fileTypes.length > 0) {
        const placeholders = fileTypes.map(() => '?').join(',');
        query += ` AND file_type IN (${placeholders})`;
        params.push(...fileTypes);
      }

      const files = this.database.prepare(query).all(...params);

      logger.info(`[ProjectRAG] 找到 ${files.length} 个文件待索引`);

      // 3. 向量化文件内容
      let indexedCount = 0;
      let skippedCount = 0;
      const errors = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        try {
          // 报告进度
          if (onProgress) {
            onProgress(i + 1, files.length, file.file_name);
          }
          this.emit('indexing-progress', {
            current: i + 1,
            total: files.length,
            fileName: file.file_name,
            projectId
          });

          // 检查是否已索引
          if (!forceReindex) {
            const existing = await this.ragManager.getDocument(`project_file_${file.id}`);
            if (existing) {
              skippedCount++;
              continue;
            }
          }

          // 读取文件内容
          const content = await this.readFileContent(file);

          if (!content || content.trim().length === 0) {
            skippedCount++;
            continue;
          }

          // 添加到向量数据库
          await this.ragManager.addDocument({
            id: `project_file_${file.id}`,
            content: content,
            metadata: {
              type: 'project_file',
              projectId: projectId,
              projectName: project.name,
              fileId: file.id,
              fileName: file.file_name,
              filePath: file.file_path,
              fileType: file.file_type,
              createdAt: file.created_at,
              updatedAt: file.updated_at
            }
          });

          indexedCount++;
          logger.info(`[ProjectRAG] 已索引: ${file.file_name}`);

        } catch (error) {
          logger.error(`[ProjectRAG] 索引文件失败: ${file.file_name}`, error);
          errors.push({
            fileId: file.id,
            fileName: file.file_name,
            error: error.message
          });
        }
      }

      const result = {
        success: true,
        projectId: projectId,
        totalFiles: files.length,
        indexedCount: indexedCount,
        skippedCount: skippedCount,
        errors: errors
      };

      logger.info('[ProjectRAG] 索引完成:', result);

      // 4. 启动文件监听
      if (enableWatcher && project.path) {
        await this.startFileWatcher(projectId, project.path);
      }

      this.emit('indexing-complete', result);

      return result;

    } catch (error) {
      logger.error('[ProjectRAG] 索引项目文件失败:', error);
      throw error;
    }
  }

  /**
   * 读取文件内容
   * @param {Object} file - 文件对象
   * @returns {Promise<string>} 文件内容
   */
  async readFileContent(file) {
    const { file_path, file_type } = file;

    // 只索引文本类文件
    const textFileTypes = ['md', 'txt', 'html', 'css', 'js', 'json', 'xml', 'py', 'java', 'cpp', 'c', 'h'];

    if (!textFileTypes.includes(file_type.toLowerCase())) {
      return null;
    }

    try {
      const content = await fs.readFile(file_path, 'utf-8');
      return content;
    } catch (error) {
      logger.error(`[ProjectRAG] 读取文件失败: ${file_path}`, error);
      return null;
    }
  }

  /**
   * 项目AI增强查询
   * @param {string} projectId - 项目ID
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 增强的上下文
   */
  async enhancedQuery(projectId, query, options = {}) {
    this.ensureInitialized();

    const {
      projectLimit = 5,      // 项目文件检索数量
      knowledgeLimit = 3,    // 知识库检索数量
      conversationLimit = 3, // 对话历史检索数量
      useReranker = true     // 是否使用重排序
    } = options;

    logger.info(`[ProjectRAG] 增强查询: ${query}`);

    try {
      // ⚡ 优化：并行检索3个数据源（减少60%等待时间）
      const startTime = Date.now();

      const [projectDocs, knowledgeDocs, conversationDocs] = await Promise.all([
        // 1. 检索项目相关文档
        this.ragManager.search(query, {
          filter: {
            type: 'project_file',
            projectId: projectId
          },
          limit: projectLimit
        }),

        // 2. 检索知识库相关内容
        this.ragManager.search(query, {
          filter: { type: 'knowledge' },
          limit: knowledgeLimit
        }),

        // 3. 检索项目对话历史
        this.searchConversationHistory(projectId, query, conversationLimit)
      ]);

      const queryTime = Date.now() - startTime;
      logger.info(`[ProjectRAG] 并行检索完成 (${queryTime}ms): 项目${projectDocs.length}条, 知识库${knowledgeDocs.length}条, 对话${conversationDocs.length}条`);

      // 4. 合并所有文档
      const allDocs = [
        ...projectDocs.map(doc => ({ ...doc, source: 'project' })),
        ...knowledgeDocs.map(doc => ({ ...doc, source: 'knowledge' })),
        ...conversationDocs.map(doc => ({ ...doc, source: 'conversation' }))
      ];

      // 5. 重排序
      let rerankedDocs = allDocs;
      if (useReranker && allDocs.length > 0) {
        try {
          rerankedDocs = await this.ragManager.rerank(query, allDocs);
          logger.info(`[ProjectRAG] 重排序完成`);
        } catch (error) {
          logger.warn('[ProjectRAG] 重排序失败，使用原始结果', error);
        }
      }

      // 6. 构建增强的上下文
      const result = {
        query: query,
        projectId: projectId,
        totalDocs: allDocs.length,
        context: rerankedDocs,
        sources: {
          project: projectDocs.length,
          knowledge: knowledgeDocs.length,
          conversation: conversationDocs.length
        },
        summary: this.generateContextSummary(rerankedDocs)
      };

      return result;

    } catch (error) {
      logger.error('[ProjectRAG] 增强查询失败:', error);
      throw error;
    }
  }

  /**
   * 搜索对话历史
   * @param {string} projectId - 项目ID
   * @param {string} query - 查询文本
   * @param {number} limit - 返回数量
   * @returns {Promise<Array>} 对话记录
   */
  async searchConversationHistory(projectId, query, limit) {
    try {
      // 优先使用向量搜索
      try {
        const vectorResults = await this.ragManager.search(query, {
          filter: {
            type: 'conversation',
            projectId: projectId
          },
          limit: limit
        });

        if (vectorResults && vectorResults.length > 0) {
          logger.info(`[ProjectRAG] 使用向量搜索对话历史: ${vectorResults.length} 条`);
          return vectorResults;
        }
      } catch (vectorError) {
        logger.warn('[ProjectRAG] 向量搜索对话失败，使用SQL查询', vectorError);
      }

      // 降级方案: 使用SQL全文搜索对话历史
      const conversations = this.database.prepare(`
        SELECT
          id,
          role,
          content,
          created_at
        FROM project_conversations
        WHERE project_id = ?
        AND content LIKE ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(projectId, `%${query}%`, limit);

      return conversations.map(conv => ({
        id: `conversation_${conv.id}`,
        content: conv.content,
        metadata: {
          type: 'conversation',
          role: conv.role,
          createdAt: conv.created_at
        },
        score: 0.5 // 默认相关性分数
      }));

    } catch (error) {
      logger.error('[ProjectRAG] 搜索对话历史失败:', error);
      return [];
    }
  }

  /**
   * 生成上下文摘要
   * @param {Array} docs - 文档列表
   * @returns {string} 摘要文本
   */
  generateContextSummary(docs) {
    if (docs.length === 0) {
      return '未找到相关上下文';
    }

    const summary = docs.slice(0, 3).map((doc, index) => {
      const source = doc.source || 'unknown';
      const fileName = doc.metadata?.fileName || 'unknown';
      const excerpt = doc.content.substring(0, 100) + '...';

      return `[${index + 1}] 来源: ${source} | 文件: ${fileName}\n${excerpt}`;
    }).join('\n\n');

    return summary;
  }

  /**
   * 删除项目索引
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} 删除结果
   */
  async deleteProjectIndex(projectId) {
    this.ensureInitialized();

    logger.info(`[ProjectRAG] 删除项目索引: ${projectId}`);

    try {
      // 获取项目所有文件
      const files = this.database.prepare(`
        SELECT id FROM project_files WHERE project_id = ?
      `).all(projectId);

      // 删除所有文件的向量索引
      let deletedCount = 0;
      for (const file of files) {
        try {
          await this.ragManager.deleteDocument(`project_file_${file.id}`);
          deletedCount++;
        } catch (error) {
          logger.warn(`[ProjectRAG] 删除文件索引失败: ${file.id}`, error);
        }
      }

      logger.info(`[ProjectRAG] 已删除 ${deletedCount} 个文件索引`);

      return {
        success: true,
        projectId: projectId,
        deletedCount: deletedCount
      };

    } catch (error) {
      logger.error('[ProjectRAG] 删除项目索引失败:', error);
      throw error;
    }
  }

  /**
   * 更新单个文件索引
   * @param {string} fileId - 文件ID
   * @returns {Promise<Object>} 更新结果
   */
  async updateFileIndex(fileId) {
    this.ensureInitialized();

    try {
      // 获取文件信息
      const file = this.database.prepare(`
        SELECT pf.*, p.name as project_name, p.id as project_id
        FROM project_files pf
        JOIN projects p ON pf.project_id = p.id
        WHERE pf.id = ?
      `).get(fileId);

      if (!file) {
        throw new Error(`文件不存在: ${fileId}`);
      }

      // 读取文件内容
      const content = await this.readFileContent(file);

      if (!content || content.trim().length === 0) {
        logger.info(`[ProjectRAG] 文件无内容，跳过索引: ${file.file_name}`);
        return { success: true, skipped: true };
      }

      // 删除旧索引
      await this.ragManager.deleteDocument(`project_file_${fileId}`);

      // 添加新索引
      await this.ragManager.addDocument({
        id: `project_file_${fileId}`,
        content: content,
        metadata: {
          type: 'project_file',
          projectId: file.project_id,
          projectName: file.project_name,
          fileId: file.id,
          fileName: file.file_name,
          filePath: file.file_path,
          fileType: file.file_type,
          createdAt: file.created_at,
          updatedAt: file.updated_at
        }
      });

      logger.info(`[ProjectRAG] 文件索引已更新: ${file.file_name}`);

      return {
        success: true,
        fileId: fileId,
        fileName: file.file_name
      };

    } catch (error) {
      logger.error('[ProjectRAG] 更新文件索引失败:', error);
      throw error;
    }
  }

  /**
   * 获取项目索引统计
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} 统计信息
   */
  async getIndexStats(projectId) {
    this.ensureInitialized();

    try {
      // 获取项目文件总数
      const totalFiles = this.database.prepare(`
        SELECT COUNT(*) as count FROM project_files WHERE project_id = ?
      `).get(projectId).count;

      // 获取已索引文件数（通过检查向量数据库）
      const files = this.database.prepare(`
        SELECT id FROM project_files WHERE project_id = ?
      `).all(projectId);

      let indexedCount = 0;
      for (const file of files) {
        try {
          const doc = await this.ragManager.getDocument(`project_file_${file.id}`);
          if (doc) {indexedCount++;}
        } catch (error) {
          // 文档不存在，跳过
        }
      }

      return {
        projectId: projectId,
        totalFiles: totalFiles,
        indexedFiles: indexedCount,
        indexedPercentage: totalFiles > 0 ? (indexedCount / totalFiles * 100).toFixed(2) : 0
      };

    } catch (error) {
      logger.error('[ProjectRAG] 获取索引统计失败:', error);
      throw error;
    }
  }

  /**
   * 启动文件监听
   * @param {string} projectId - 项目ID
   * @param {string} projectPath - 项目路径
   */
  async startFileWatcher(projectId, projectPath) {
    // 如果已有监听器，先停止
    if (this.fileWatchers.has(projectId)) {
      this.stopFileWatcher(projectId);
    }

    logger.info(`[ProjectRAG] 启动文件监听: ${projectPath}`);

    const watcher = chokidar.watch(projectPath, {
      ignored: /(^|[/\\])\./, // 忽略隐藏文件
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100
      }
    });

    // 监听文件变化
    watcher
      .on('add', async (filePath) => {
        logger.info(`[ProjectRAG] 文件新增: ${filePath}`);
        await this.handleFileChange(projectId, filePath, 'add');
      })
      .on('change', async (filePath) => {
        logger.info(`[ProjectRAG] 文件修改: ${filePath}`);
        await this.handleFileChange(projectId, filePath, 'change');
      })
      .on('unlink', async (filePath) => {
        logger.info(`[ProjectRAG] 文件删除: ${filePath}`);
        await this.handleFileChange(projectId, filePath, 'delete');
      })
      .on('error', (error) => {
        logger.error('[ProjectRAG] 文件监听错误:', error);
      });

    this.fileWatchers.set(projectId, watcher);
  }

  /**
   * 停止文件监听
   * @param {string} projectId - 项目ID
   */
  stopFileWatcher(projectId) {
    const watcher = this.fileWatchers.get(projectId);
    if (watcher) {
      watcher.close();
      this.fileWatchers.delete(projectId);
      logger.info(`[ProjectRAG] 已停止文件监听: ${projectId}`);
    }
  }

  /**
   * 处理文件变化
   * @param {string} projectId - 项目ID
   * @param {string} filePath - 文件路径
   * @param {string} changeType - 变化类型 (add/change/delete)
   */
  async handleFileChange(projectId, filePath, changeType) {
    try {
      // 查找文件记录
      const file = this.database.prepare(`
        SELECT id FROM project_files
        WHERE project_id = ? AND file_path = ?
      `).get(projectId, filePath);

      if (changeType === 'delete') {
        if (file) {
          // 删除向量索引
          await this.ragManager.deleteDocument(`project_file_${file.id}`);
          logger.info(`[ProjectRAG] 已删除文件索引: ${filePath}`);
        }
      } else if (changeType === 'add' || changeType === 'change') {
        if (file) {
          // 更新索引
          await this.updateFileIndex(file.id);
          logger.info(`[ProjectRAG] 已更新文件索引: ${filePath}`);

          this.emit('file-indexed', {
            projectId,
            fileId: file.id,
            filePath,
            changeType
          });
        }
      }
    } catch (error) {
      logger.error(`[ProjectRAG] 处理文件变化失败: ${filePath}`, error);
    }
  }

  /**
   * 索引项目对话历史
   * @param {string} projectId - 项目ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 索引结果
   */
  async indexConversationHistory(projectId, options = {}) {
    this.ensureInitialized();

    const { limit = 100 } = options;

    logger.info(`[ProjectRAG] 开始索引对话历史: ${projectId}`);

    try {
      // 获取项目对话历史
      const conversations = this.database.prepare(`
        SELECT id, role, content, created_at
        FROM project_conversations
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(projectId, limit);

      logger.info(`[ProjectRAG] 找到 ${conversations.length} 条对话记录`);

      let indexedCount = 0;
      const errors = [];

      for (const conv of conversations) {
        try {
          // 只索引有实质内容的对话
          if (!conv.content || conv.content.trim().length < 10) {
            continue;
          }

          // 添加到向量数据库
          await this.ragManager.addDocument({
            id: `conversation_${conv.id}`,
            content: conv.content,
            metadata: {
              type: 'conversation',
              projectId: projectId,
              conversationId: conv.id,
              role: conv.role,
              createdAt: conv.created_at
            }
          });

          indexedCount++;
        } catch (error) {
          logger.error(`[ProjectRAG] 索引对话失败: ${conv.id}`, error);
          errors.push({
            conversationId: conv.id,
            error: error.message
          });
        }
      }

      const result = {
        success: true,
        projectId: projectId,
        totalConversations: conversations.length,
        indexedCount: indexedCount,
        errors: errors
      };

      logger.info('[ProjectRAG] 对话历史索引完成:', result);
      return result;

    } catch (error) {
      logger.error('[ProjectRAG] 索引对话历史失败:', error);
      throw error;
    }
  }
}

// 单例模式
let projectRAGManager = null;

/**
 * 获取项目RAG管理器实例
 * @returns {ProjectRAGManager}
 */
function getProjectRAGManager() {
  if (!projectRAGManager) {
    projectRAGManager = new ProjectRAGManager();
  }
  return projectRAGManager;
}

module.exports = {
  ProjectRAGManager,
  getProjectRAGManager
};
