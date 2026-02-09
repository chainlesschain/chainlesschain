/**
 * 项目RAG管理器
 * 负责项目文件的向量化索引、检索增强和知识库集成
 */

const { logger } = require("../utils/logger.js");
const path = require("path");
const fs = require("fs").promises;
const chokidar = require("chokidar");
const EventEmitter = require("events");

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
    if (this.initialized) {
      return;
    }

    try {
      // 获取RAG管理器
      const { getRAGManager } = require("../rag/rag-manager");
      this.ragManager = getRAGManager();

      // 获取数据库
      const { getDatabase } = require("../database");
      this.database = getDatabase();

      this.initialized = true;
      logger.info("[ProjectRAG] 初始化完成");
    } catch (error) {
      logger.error("[ProjectRAG] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 确保已初始化
   */
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error("ProjectRAGManager 未初始化，请先调用 initialize()");
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
      forceReindex = false, // 是否强制重新索引
      fileTypes = null, // 限定文件类型，null表示所有
      enableWatcher = true, // 是否启用文件监听
    } = options;

    logger.info(`[ProjectRAG] 开始索引项目文件: ${projectId}`);

    try {
      // 1. 获取项目信息
      const project = this.database
        .prepare(
          `
        SELECT * FROM projects WHERE id = ?
      `,
        )
        .get(projectId);

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
        const placeholders = fileTypes.map(() => "?").join(",");
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
          this.emit("indexing-progress", {
            current: i + 1,
            total: files.length,
            fileName: file.file_name,
            projectId,
          });

          // 检查是否已索引
          if (!forceReindex) {
            const existing = await this.ragManager.getDocument(
              `project_file_${file.id}`,
            );
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
              type: "project_file",
              projectId: projectId,
              projectName: project.name,
              fileId: file.id,
              fileName: file.file_name,
              filePath: file.file_path,
              fileType: file.file_type,
              createdAt: file.created_at,
              updatedAt: file.updated_at,
            },
          });

          indexedCount++;
          logger.info(`[ProjectRAG] 已索引: ${file.file_name}`);
        } catch (error) {
          logger.error(`[ProjectRAG] 索引文件失败: ${file.file_name}`, error);
          errors.push({
            fileId: file.id,
            fileName: file.file_name,
            error: error.message,
          });
        }
      }

      const result = {
        success: true,
        projectId: projectId,
        totalFiles: files.length,
        indexedCount: indexedCount,
        skippedCount: skippedCount,
        errors: errors,
      };

      logger.info("[ProjectRAG] 索引完成:", result);

      // 4. 启动文件监听
      if (enableWatcher && project.path) {
        await this.startFileWatcher(projectId, project.path);
      }

      this.emit("indexing-complete", result);

      return result;
    } catch (error) {
      logger.error("[ProjectRAG] 索引项目文件失败:", error);
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
    const textFileTypes = [
      "md",
      "txt",
      "html",
      "css",
      "js",
      "json",
      "xml",
      "py",
      "java",
      "cpp",
      "c",
      "h",
    ];

    if (!textFileTypes.includes(file_type.toLowerCase())) {
      return null;
    }

    try {
      const content = await fs.readFile(file_path, "utf-8");
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
      projectLimit = 5, // 项目文件检索数量
      knowledgeLimit = 3, // 知识库检索数量
      conversationLimit = 3, // 对话历史检索数量
      useReranker = true, // 是否使用重排序
    } = options;

    logger.info(`[ProjectRAG] 增强查询: ${query}`);

    try {
      // ⚡ 优化：并行检索3个数据源（减少60%等待时间）
      const startTime = Date.now();

      const [projectDocs, knowledgeDocs, conversationDocs] = await Promise.all([
        // 1. 检索项目相关文档
        this.ragManager.search(query, {
          filter: {
            type: "project_file",
            projectId: projectId,
          },
          limit: projectLimit,
        }),

        // 2. 检索知识库相关内容
        this.ragManager.search(query, {
          filter: { type: "knowledge" },
          limit: knowledgeLimit,
        }),

        // 3. 检索项目对话历史
        this.searchConversationHistory(projectId, query, conversationLimit),
      ]);

      const queryTime = Date.now() - startTime;
      logger.info(
        `[ProjectRAG] 并行检索完成 (${queryTime}ms): 项目${projectDocs.length}条, 知识库${knowledgeDocs.length}条, 对话${conversationDocs.length}条`,
      );

      // 4. 合并所有文档
      const allDocs = [
        ...projectDocs.map((doc) => ({ ...doc, source: "project" })),
        ...knowledgeDocs.map((doc) => ({ ...doc, source: "knowledge" })),
        ...conversationDocs.map((doc) => ({ ...doc, source: "conversation" })),
      ];

      // 5. 重排序
      let rerankedDocs = allDocs;
      if (useReranker && allDocs.length > 0) {
        try {
          rerankedDocs = await this.ragManager.rerank(query, allDocs);
          logger.info(`[ProjectRAG] 重排序完成`);
        } catch (error) {
          logger.warn("[ProjectRAG] 重排序失败，使用原始结果", error);
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
          conversation: conversationDocs.length,
        },
        summary: this.generateContextSummary(rerankedDocs),
      };

      return result;
    } catch (error) {
      logger.error("[ProjectRAG] 增强查询失败:", error);
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
            type: "conversation",
            projectId: projectId,
          },
          limit: limit,
        });

        if (vectorResults && vectorResults.length > 0) {
          logger.info(
            `[ProjectRAG] 使用向量搜索对话历史: ${vectorResults.length} 条`,
          );
          return vectorResults;
        }
      } catch (vectorError) {
        logger.warn("[ProjectRAG] 向量搜索对话失败，使用SQL查询", vectorError);
      }

      // 降级方案: 使用SQL全文搜索对话历史
      const conversations = this.database
        .prepare(
          `
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
      `,
        )
        .all(projectId, `%${query}%`, limit);

      return conversations.map((conv) => ({
        id: `conversation_${conv.id}`,
        content: conv.content,
        metadata: {
          type: "conversation",
          role: conv.role,
          createdAt: conv.created_at,
        },
        score: 0.5, // 默认相关性分数
      }));
    } catch (error) {
      logger.error("[ProjectRAG] 搜索对话历史失败:", error);
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
      return "未找到相关上下文";
    }

    const summary = docs
      .slice(0, 3)
      .map((doc, index) => {
        const source = doc.source || "unknown";
        const fileName = doc.metadata?.fileName || "unknown";
        const excerpt = doc.content.substring(0, 100) + "...";

        return `[${index + 1}] 来源: ${source} | 文件: ${fileName}\n${excerpt}`;
      })
      .join("\n\n");

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
      const files = this.database
        .prepare(
          `
        SELECT id FROM project_files WHERE project_id = ?
      `,
        )
        .all(projectId);

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
        deletedCount: deletedCount,
      };
    } catch (error) {
      logger.error("[ProjectRAG] 删除项目索引失败:", error);
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
      const file = this.database
        .prepare(
          `
        SELECT pf.*, p.name as project_name, p.id as project_id
        FROM project_files pf
        JOIN projects p ON pf.project_id = p.id
        WHERE pf.id = ?
      `,
        )
        .get(fileId);

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
          type: "project_file",
          projectId: file.project_id,
          projectName: file.project_name,
          fileId: file.id,
          fileName: file.file_name,
          filePath: file.file_path,
          fileType: file.file_type,
          createdAt: file.created_at,
          updatedAt: file.updated_at,
        },
      });

      logger.info(`[ProjectRAG] 文件索引已更新: ${file.file_name}`);

      return {
        success: true,
        fileId: fileId,
        fileName: file.file_name,
      };
    } catch (error) {
      logger.error("[ProjectRAG] 更新文件索引失败:", error);
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
      const totalFiles = this.database
        .prepare(
          `
        SELECT COUNT(*) as count FROM project_files WHERE project_id = ?
      `,
        )
        .get(projectId).count;

      // 获取已索引文件数（通过检查向量数据库）
      const files = this.database
        .prepare(
          `
        SELECT id FROM project_files WHERE project_id = ?
      `,
        )
        .all(projectId);

      let indexedCount = 0;
      for (const file of files) {
        try {
          const doc = await this.ragManager.getDocument(
            `project_file_${file.id}`,
          );
          if (doc) {
            indexedCount++;
          }
        } catch (error) {
          // 文档不存在，跳过
        }
      }

      return {
        projectId: projectId,
        totalFiles: totalFiles,
        indexedFiles: indexedCount,
        indexedPercentage:
          totalFiles > 0 ? ((indexedCount / totalFiles) * 100).toFixed(2) : 0,
      };
    } catch (error) {
      logger.error("[ProjectRAG] 获取索引统计失败:", error);
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
        pollInterval: 100,
      },
    });

    // 监听文件变化
    watcher
      .on("add", async (filePath) => {
        logger.info(`[ProjectRAG] 文件新增: ${filePath}`);
        await this.handleFileChange(projectId, filePath, "add");
      })
      .on("change", async (filePath) => {
        logger.info(`[ProjectRAG] 文件修改: ${filePath}`);
        await this.handleFileChange(projectId, filePath, "change");
      })
      .on("unlink", async (filePath) => {
        logger.info(`[ProjectRAG] 文件删除: ${filePath}`);
        await this.handleFileChange(projectId, filePath, "delete");
      })
      .on("error", (error) => {
        logger.error("[ProjectRAG] 文件监听错误:", error);
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
      const file = this.database
        .prepare(
          `
        SELECT id FROM project_files
        WHERE project_id = ? AND file_path = ?
      `,
        )
        .get(projectId, filePath);

      if (changeType === "delete") {
        if (file) {
          // 删除向量索引
          await this.ragManager.deleteDocument(`project_file_${file.id}`);
          logger.info(`[ProjectRAG] 已删除文件索引: ${filePath}`);
        }
      } else if (changeType === "add" || changeType === "change") {
        if (file) {
          // 更新索引
          await this.updateFileIndex(file.id);
          logger.info(`[ProjectRAG] 已更新文件索引: ${filePath}`);

          this.emit("file-indexed", {
            projectId,
            fileId: file.id,
            filePath,
            changeType,
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
      const conversations = this.database
        .prepare(
          `
        SELECT id, role, content, created_at
        FROM project_conversations
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
        )
        .all(projectId, limit);

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
              type: "conversation",
              projectId: projectId,
              conversationId: conv.id,
              role: conv.role,
              createdAt: conv.created_at,
            },
          });

          indexedCount++;
        } catch (error) {
          logger.error(`[ProjectRAG] 索引对话失败: ${conv.id}`, error);
          errors.push({
            conversationId: conv.id,
            error: error.message,
          });
        }
      }

      const result = {
        success: true,
        projectId: projectId,
        totalConversations: conversations.length,
        indexedCount: indexedCount,
        errors: errors,
      };

      logger.info("[ProjectRAG] 对话历史索引完成:", result);
      return result;
    } catch (error) {
      logger.error("[ProjectRAG] 索引对话历史失败:", error);
      throw error;
    }
  }
}

// ============================================================
// 增量索引管理器
// ============================================================

const crypto = require("crypto");

/**
 * 增量索引管理器
 * 通过 content hash 检测文件变化，避免重复索引
 */
class IncrementalIndexManager {
  constructor(database, ragManager) {
    this.database = database;
    this.ragManager = ragManager;
  }

  /**
   * 计算内容的 MD5 哈希
   * @param {string} content - 文件内容
   * @returns {string} MD5 哈希值
   */
  _computeHash(content) {
    return crypto.createHash("md5").update(content, "utf8").digest("hex");
  }

  /**
   * 检测文件变化
   * @param {Array} files - 文件列表 [{id, content, ...}]
   * @param {string} projectId - 项目ID
   * @returns {Object} { toIndex, toUpdate, unchanged }
   */
  async detectChanges(files, projectId) {
    const result = {
      toIndex: [], // 新文件，需要索引
      toUpdate: [], // 内容变化，需要更新
      unchanged: [], // 无变化，跳过
    };

    for (const file of files) {
      if (!file.content) {
        continue;
      }

      const currentHash = this._computeHash(file.content);

      // 查询现有索引记录
      const existing = this.database
        .prepare(
          `
        SELECT content_hash FROM project_rag_index
        WHERE project_id = ? AND file_id = ?
      `,
        )
        .get(projectId, file.id);

      if (!existing) {
        // 新文件
        result.toIndex.push({ ...file, contentHash: currentHash });
      } else if (existing.content_hash !== currentHash) {
        // 内容变化
        result.toUpdate.push({ ...file, contentHash: currentHash });
      } else {
        // 无变化
        result.unchanged.push(file);
      }
    }

    return result;
  }

  /**
   * 增量索引项目文件
   * @param {string} projectId - 项目ID
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 索引结果
   */
  async incrementalIndex(projectId, options = {}, onProgress = null) {
    const { fileTypes = null } = options;

    logger.info(`[IncrementalIndex] 开始增量索引: ${projectId}`);
    const startTime = Date.now();

    try {
      // 1. 获取项目信息
      const project = this.database
        .prepare("SELECT * FROM projects WHERE id = ?")
        .get(projectId);

      if (!project) {
        throw new Error(`项目不存在: ${projectId}`);
      }

      // 2. 获取项目所有文件
      let query = "SELECT * FROM project_files WHERE project_id = ?";
      const params = [projectId];

      if (fileTypes && fileTypes.length > 0) {
        const placeholders = fileTypes.map(() => "?").join(",");
        query += ` AND file_type IN (${placeholders})`;
        params.push(...fileTypes);
      }

      const files = this.database.prepare(query).all(...params);

      // 3. 读取文件内容
      const filesWithContent = [];
      const textFileTypes = [
        "md",
        "txt",
        "html",
        "css",
        "js",
        "ts",
        "json",
        "xml",
        "py",
        "java",
        "cpp",
        "c",
        "h",
        "go",
        "rs",
        "vue",
        "jsx",
        "tsx",
      ];

      for (const file of files) {
        if (!textFileTypes.includes(file.file_type?.toLowerCase())) {
          continue;
        }

        try {
          const content = await fs.readFile(file.file_path, "utf-8");
          if (content && content.trim().length > 0) {
            filesWithContent.push({ ...file, content });
          }
        } catch (error) {
          logger.warn(
            `[IncrementalIndex] 读取文件失败: ${file.file_path}`,
            error.message,
          );
        }
      }

      // 4. 检测变化
      const changes = await this.detectChanges(filesWithContent, projectId);
      const totalToProcess = changes.toIndex.length + changes.toUpdate.length;

      logger.info(
        `[IncrementalIndex] 变化检测: 新增${changes.toIndex.length}, 更新${changes.toUpdate.length}, 无变化${changes.unchanged.length}`,
      );

      // 5. 索引新文件
      let processedCount = 0;
      const errors = [];

      for (const file of changes.toIndex) {
        try {
          if (onProgress) {
            onProgress(++processedCount, totalToProcess, file.file_name);
          }

          await this.ragManager.addDocument({
            id: `project_file_${file.id}`,
            content: file.content,
            metadata: {
              type: "project_file",
              projectId: projectId,
              projectName: project.name,
              fileId: file.id,
              fileName: file.file_name,
              filePath: file.file_path,
              fileType: file.file_type,
            },
          });

          // 记录索引信息
          this.database
            .prepare(
              `
            INSERT OR REPLACE INTO project_rag_index
            (id, project_id, file_id, content_hash, indexed_at, chunk_count)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
            )
            .run(
              `${projectId}_${file.id}`,
              projectId,
              file.id,
              file.contentHash,
              Date.now(),
              1,
            );
        } catch (error) {
          errors.push({ fileId: file.id, fileName: file.file_name, error: error.message });
        }
      }

      // 6. 更新变化的文件
      for (const file of changes.toUpdate) {
        try {
          if (onProgress) {
            onProgress(++processedCount, totalToProcess, file.file_name);
          }

          // 删除旧索引
          await this.ragManager.deleteDocument(`project_file_${file.id}`);

          // 添加新索引
          await this.ragManager.addDocument({
            id: `project_file_${file.id}`,
            content: file.content,
            metadata: {
              type: "project_file",
              projectId: projectId,
              projectName: project.name,
              fileId: file.id,
              fileName: file.file_name,
              filePath: file.file_path,
              fileType: file.file_type,
            },
          });

          // 更新索引记录
          this.database
            .prepare(
              `
            UPDATE project_rag_index
            SET content_hash = ?, indexed_at = ?
            WHERE project_id = ? AND file_id = ?
          `,
            )
            .run(file.contentHash, Date.now(), projectId, file.id);
        } catch (error) {
          errors.push({ fileId: file.id, fileName: file.file_name, error: error.message });
        }
      }

      const duration = Date.now() - startTime;

      const result = {
        success: true,
        projectId,
        stats: {
          indexed: changes.toIndex.length,
          updated: changes.toUpdate.length,
          unchanged: changes.unchanged.length,
          errors: errors.length,
        },
        duration,
        errors,
      };

      logger.info(`[IncrementalIndex] 完成 (${duration}ms):`, result.stats);
      return result;
    } catch (error) {
      logger.error("[IncrementalIndex] 增量索引失败:", error);
      throw error;
    }
  }

  /**
   * 清理项目的索引记录
   * @param {string} projectId - 项目ID
   */
  async cleanupIndexRecords(projectId) {
    this.database
      .prepare("DELETE FROM project_rag_index WHERE project_id = ?")
      .run(projectId);
    logger.info(`[IncrementalIndex] 已清理项目索引记录: ${projectId}`);
  }
}

// ============================================================
// 多文件联合检索器
// ============================================================

/**
 * 多文件联合检索器
 * 支持文件关系追踪和跨文件上下文聚合
 */
class MultiFileRetriever {
  constructor(database, ragManager) {
    this.database = database;
    this.ragManager = ragManager;
  }

  /**
   * 提取文件中的导入语句
   * @param {string} content - 文件内容
   * @param {string} fileType - 文件类型
   * @returns {Array<string>} 导入的文件路径列表
   */
  _extractImports(content, fileType) {
    const imports = [];

    if (!content) return imports;

    // JavaScript/TypeScript imports
    if (["js", "ts", "jsx", "tsx", "vue"].includes(fileType)) {
      // ES6 imports: import xxx from 'path'
      const es6Regex = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = es6Regex.exec(content)) !== null) {
        imports.push(match[1]);
      }

      // CommonJS requires: require('path')
      const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = cjsRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }
    }

    // Python imports
    if (fileType === "py") {
      // from xxx import yyy
      const fromRegex = /from\s+([^\s]+)\s+import/g;
      let match;
      while ((match = fromRegex.exec(content)) !== null) {
        imports.push(match[1].replace(/\./g, "/"));
      }

      // import xxx
      const importRegex = /^import\s+([^\s,]+)/gm;
      while ((match = importRegex.exec(content)) !== null) {
        imports.push(match[1].replace(/\./g, "/"));
      }
    }

    // Java imports
    if (fileType === "java") {
      const javaRegex = /import\s+([^;]+);/g;
      let match;
      while ((match = javaRegex.exec(content)) !== null) {
        imports.push(match[1].replace(/\./g, "/"));
      }
    }

    // Go imports
    if (fileType === "go") {
      const goRegex = /import\s+(?:\(\s*)?["']([^"']+)["']/g;
      let match;
      while ((match = goRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }
    }

    return imports;
  }

  /**
   * 查找相关文件
   * @param {Array<string>} fileIds - 初始文件ID列表
   * @param {string} projectId - 项目ID
   * @param {number} depth - 查找深度
   * @returns {Promise<Array>} 相关文件列表
   */
  async _findRelatedFiles(fileIds, projectId, depth = 1) {
    if (depth <= 0 || fileIds.length === 0) {
      return [];
    }

    const relatedFiles = [];
    const processedIds = new Set(fileIds);

    for (const fileId of fileIds) {
      // 获取文件信息
      const file = this.database
        .prepare("SELECT * FROM project_files WHERE id = ?")
        .get(fileId);

      if (!file) continue;

      // 读取文件内容
      let content;
      try {
        content = await fs.readFile(file.file_path, "utf-8");
      } catch (error) {
        continue;
      }

      // 提取导入
      const imports = this._extractImports(content, file.file_type);

      // 查找匹配的项目文件
      for (const importPath of imports) {
        // 尝试匹配项目中的文件
        const baseName = path.basename(importPath).replace(/\.[^.]+$/, "");
        const candidates = this.database
          .prepare(
            `
          SELECT * FROM project_files
          WHERE project_id = ?
          AND (file_name LIKE ? OR file_path LIKE ?)
          LIMIT 5
        `,
          )
          .all(projectId, `${baseName}%`, `%${importPath}%`);

        for (const candidate of candidates) {
          if (!processedIds.has(candidate.id)) {
            processedIds.add(candidate.id);
            relatedFiles.push({
              ...candidate,
              relationType: "import",
              referencedBy: fileId,
            });
          }
        }
      }
    }

    // 递归查找更深层的关系
    if (depth > 1 && relatedFiles.length > 0) {
      const deeperRelated = await this._findRelatedFiles(
        relatedFiles.map((f) => f.id),
        projectId,
        depth - 1,
      );
      relatedFiles.push(...deeperRelated);
    }

    return relatedFiles;
  }

  /**
   * 按文件分组检索结果
   * @param {Array} chunks - 检索到的片段列表
   * @returns {Object} 按文件分组的结果
   */
  _groupByFile(chunks) {
    const grouped = {};

    for (const chunk of chunks) {
      const fileId = chunk.metadata?.fileId || "unknown";
      if (!grouped[fileId]) {
        grouped[fileId] = {
          fileId,
          fileName: chunk.metadata?.fileName || "unknown",
          filePath: chunk.metadata?.filePath || "",
          chunks: [],
          totalScore: 0,
        };
      }
      grouped[fileId].chunks.push(chunk);
      grouped[fileId].totalScore += chunk.score || 0;
    }

    // 按总分排序
    return Object.values(grouped).sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * 构建联合上下文
   * @param {Array} primaryFiles - 主要文件
   * @param {Array} relatedFiles - 关联文件
   * @returns {Object} 联合上下文
   */
  async _buildJointContext(primaryFiles, relatedFiles) {
    const context = {
      primary: [],
      related: [],
    };

    // 处理主要文件
    for (const file of primaryFiles) {
      let content = "";
      try {
        content = await fs.readFile(file.filePath, "utf-8");
        // 截取相关部分
        content = content.substring(0, 2000);
      } catch (error) {
        content = file.chunks.map((c) => c.content).join("\n\n");
      }

      context.primary.push({
        fileId: file.fileId,
        fileName: file.fileName,
        content,
        relevanceScore: file.totalScore,
      });
    }

    // 处理关联文件
    for (const file of relatedFiles.slice(0, 5)) {
      let content = "";
      try {
        content = await fs.readFile(file.file_path, "utf-8");
        content = content.substring(0, 1000);
      } catch (error) {
        continue;
      }

      context.related.push({
        fileId: file.id,
        fileName: file.file_name,
        relationType: file.relationType,
        content,
      });
    }

    return context;
  }

  /**
   * 多文件联合检索
   * @param {string} projectId - 项目ID
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 联合检索结果
   */
  async jointRetrieve(projectId, query, options = {}) {
    const {
      maxFiles = 5,
      maxChunksPerFile = 3,
      includeRelated = true,
      relatedDepth = 1,
    } = options;

    logger.info(`[MultiFileRetriever] 联合检索: ${query}`);
    const startTime = Date.now();

    try {
      // 1. 向量检索
      const searchResults = await this.ragManager.search(query, {
        filter: {
          type: "project_file",
          projectId: projectId,
        },
        limit: maxFiles * maxChunksPerFile,
      });

      // 2. 按文件分组
      const groupedFiles = this._groupByFile(searchResults);

      // 3. 限制每个文件的片段数
      const primaryFiles = groupedFiles.slice(0, maxFiles).map((file) => ({
        ...file,
        chunks: file.chunks.slice(0, maxChunksPerFile),
      }));

      // 4. 查找关联文件
      let relatedFiles = [];
      if (includeRelated && primaryFiles.length > 0) {
        const primaryFileIds = primaryFiles.map((f) => f.fileId);
        relatedFiles = await this._findRelatedFiles(
          primaryFileIds,
          projectId,
          relatedDepth,
        );
      }

      // 5. 构建联合上下文
      const jointContext = await this._buildJointContext(
        primaryFiles,
        relatedFiles,
      );

      const duration = Date.now() - startTime;

      const result = {
        success: true,
        projectId,
        query,
        primaryFiles: jointContext.primary,
        relatedFiles: jointContext.related,
        stats: {
          primaryCount: primaryFiles.length,
          relatedCount: relatedFiles.length,
          totalChunks: searchResults.length,
        },
        duration,
      };

      logger.info(
        `[MultiFileRetriever] 完成 (${duration}ms): 主文件${result.stats.primaryCount}, 关联${result.stats.relatedCount}`,
      );
      return result;
    } catch (error) {
      logger.error("[MultiFileRetriever] 联合检索失败:", error);
      throw error;
    }
  }

  /**
   * 获取文件关系
   * @param {string} projectId - 项目ID
   * @param {string} fileId - 文件ID
   * @returns {Promise<Object>} 文件关系
   */
  async getFileRelations(projectId, fileId) {
    const file = this.database
      .prepare("SELECT * FROM project_files WHERE id = ?")
      .get(fileId);

    if (!file) {
      throw new Error(`文件不存在: ${fileId}`);
    }

    let content;
    try {
      content = await fs.readFile(file.file_path, "utf-8");
    } catch (error) {
      return { imports: [], importedBy: [] };
    }

    // 获取此文件导入的文件
    const imports = this._extractImports(content, file.file_type);

    // 查找导入此文件的其他文件
    const importedBy = [];
    const allFiles = this.database
      .prepare("SELECT * FROM project_files WHERE project_id = ? AND id != ?")
      .all(projectId, fileId);

    for (const otherFile of allFiles) {
      try {
        const otherContent = await fs.readFile(otherFile.file_path, "utf-8");
        const otherImports = this._extractImports(
          otherContent,
          otherFile.file_type,
        );

        // 检查是否导入了当前文件
        const baseName = path.basename(file.file_name, path.extname(file.file_name));
        if (
          otherImports.some(
            (imp) => imp.includes(baseName) || imp.includes(file.file_name),
          )
        ) {
          importedBy.push({
            fileId: otherFile.id,
            fileName: otherFile.file_name,
            filePath: otherFile.file_path,
          });
        }
      } catch (error) {
        // 跳过无法读取的文件
      }
    }

    return {
      fileId,
      fileName: file.file_name,
      imports,
      importedBy,
    };
  }
}

// ============================================================
// 统一检索器
// ============================================================

/**
 * 统一检索器
 * 知识库-项目-对话联合检索，支持来源权重
 */
class UnifiedRetriever {
  constructor(database, ragManager) {
    this.database = database;
    this.ragManager = ragManager;

    // 默认来源权重
    this.sourceWeights = {
      project: 0.5,
      conversation: 0.2,
      knowledge: 0.3,
    };
  }

  /**
   * 更新来源权重
   * @param {Object} weights - 新的权重配置
   */
  updateWeights(weights) {
    if (weights.project !== undefined) {
      this.sourceWeights.project = weights.project;
    }
    if (weights.conversation !== undefined) {
      this.sourceWeights.conversation = weights.conversation;
    }
    if (weights.knowledge !== undefined) {
      this.sourceWeights.knowledge = weights.knowledge;
    }

    // 归一化权重
    const total =
      this.sourceWeights.project +
      this.sourceWeights.conversation +
      this.sourceWeights.knowledge;

    if (total > 0) {
      this.sourceWeights.project /= total;
      this.sourceWeights.conversation /= total;
      this.sourceWeights.knowledge /= total;
    }

    logger.info("[UnifiedRetriever] 权重已更新:", this.sourceWeights);
    return this.sourceWeights;
  }

  /**
   * 应用来源权重到文档分数
   * @param {Array} docs - 文档列表
   * @param {string} source - 来源类型
   * @returns {Array} 加权后的文档
   */
  _applySourceWeight(docs, source) {
    const weight = this.sourceWeights[source] || 0.33;
    return docs.map((doc) => ({
      ...doc,
      source,
      originalScore: doc.score,
      score: (doc.score || 0) * weight,
    }));
  }

  /**
   * 统一检索
   * @param {string} projectId - 项目ID
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 统一检索结果
   */
  async unifiedRetrieve(projectId, query, options = {}) {
    const {
      projectLimit = 5,
      conversationLimit = 3,
      knowledgeLimit = 3,
      useReranker = false,
    } = options;

    logger.info(`[UnifiedRetriever] 统一检索: ${query}`);
    const startTime = Date.now();

    try {
      // 并行检索三个数据源
      const [projectDocs, conversationDocs, knowledgeDocs] = await Promise.all([
        // 项目文件
        this.ragManager
          .search(query, {
            filter: { type: "project_file", projectId },
            limit: projectLimit,
          })
          .catch((err) => {
            logger.warn("[UnifiedRetriever] 项目检索失败:", err.message);
            return [];
          }),

        // 对话历史
        this.ragManager
          .search(query, {
            filter: { type: "conversation", projectId },
            limit: conversationLimit,
          })
          .catch((err) => {
            logger.warn("[UnifiedRetriever] 对话检索失败:", err.message);
            return [];
          }),

        // 知识库
        this.ragManager
          .search(query, {
            filter: { type: "knowledge" },
            limit: knowledgeLimit,
          })
          .catch((err) => {
            logger.warn("[UnifiedRetriever] 知识库检索失败:", err.message);
            return [];
          }),
      ]);

      // 应用来源权重
      const weightedProject = this._applySourceWeight(projectDocs, "project");
      const weightedConversation = this._applySourceWeight(
        conversationDocs,
        "conversation",
      );
      const weightedKnowledge = this._applySourceWeight(
        knowledgeDocs,
        "knowledge",
      );

      // 合并并排序
      let allDocs = [
        ...weightedProject,
        ...weightedConversation,
        ...weightedKnowledge,
      ].sort((a, b) => b.score - a.score);

      // 可选重排序
      if (useReranker && allDocs.length > 0) {
        try {
          allDocs = await this.ragManager.rerank(query, allDocs);
        } catch (error) {
          logger.warn("[UnifiedRetriever] 重排序失败:", error.message);
        }
      }

      const duration = Date.now() - startTime;

      const result = {
        success: true,
        projectId,
        query,
        documents: allDocs,
        sources: {
          project: projectDocs.length,
          conversation: conversationDocs.length,
          knowledge: knowledgeDocs.length,
        },
        weights: { ...this.sourceWeights },
        duration,
      };

      logger.info(
        `[UnifiedRetriever] 完成 (${duration}ms): 总计${allDocs.length}条`,
      );
      return result;
    } catch (error) {
      logger.error("[UnifiedRetriever] 统一检索失败:", error);
      throw error;
    }
  }
}

// ============================================================
// 项目感知重排序器
// ============================================================

/**
 * 项目感知重排序器
 * 基于项目上下文优化检索结果排序
 */
class ProjectAwareReranker {
  constructor(database) {
    this.database = database;
  }

  /**
   * 应用项目感知权重
   * @param {Array} docs - 文档列表
   * @param {Object} context - 项目上下文
   * @returns {Array} 加权后的文档
   */
  _applyProjectAwareWeights(docs, context) {
    const { currentFile, recentFiles = [], projectType } = context;

    return docs.map((doc) => {
      let boost = 0;
      const metadata = doc.metadata || {};

      // 1. 同目录加权 (+15%)
      if (currentFile && metadata.filePath) {
        const currentDir = path.dirname(currentFile);
        const docDir = path.dirname(metadata.filePath);
        if (currentDir === docDir) {
          boost += 0.15;
        }
      }

      // 2. 最近访问加权 (+10%)
      if (recentFiles.includes(metadata.fileId)) {
        boost += 0.1;
      }

      // 3. 文件类型匹配加权 (+10%)
      if (currentFile && metadata.fileType) {
        const currentExt = path.extname(currentFile).slice(1);
        if (currentExt === metadata.fileType) {
          boost += 0.1;
        }
      }

      // 4. 项目类型相关性加权
      if (projectType && metadata.fileType) {
        const relevantTypes = this._getRelevantFileTypes(projectType);
        if (relevantTypes.includes(metadata.fileType)) {
          boost += 0.05;
        }
      }

      return {
        ...doc,
        originalScore: doc.score,
        score: (doc.score || 0) * (1 + boost),
        boostApplied: boost,
      };
    });
  }

  /**
   * 根据项目类型获取相关文件类型
   * @param {string} projectType - 项目类型
   * @returns {Array<string>} 相关文件类型列表
   */
  _getRelevantFileTypes(projectType) {
    const typeMap = {
      frontend: ["js", "ts", "jsx", "tsx", "vue", "css", "scss", "html"],
      backend: ["js", "ts", "py", "java", "go", "rs"],
      mobile: ["js", "ts", "jsx", "tsx", "swift", "kt"],
      data: ["py", "sql", "json", "csv"],
      devops: ["yml", "yaml", "sh", "dockerfile"],
    };
    return typeMap[projectType] || [];
  }

  /**
   * 应用代码相关性评分
   * @param {Array} docs - 文档列表
   * @param {string} query - 查询文本
   * @param {string} projectType - 项目类型
   * @returns {Array} 加权后的文档
   */
  _applyCodeRelevance(docs, query, projectType) {
    // 提取查询中的代码关键词
    const codeKeywords = query.match(
      /\b(function|class|method|api|endpoint|component|service|module|interface|type)\b/gi,
    );

    if (!codeKeywords || codeKeywords.length === 0) {
      return docs;
    }

    return docs.map((doc) => {
      let relevanceBoost = 0;
      const content = (doc.content || "").toLowerCase();

      for (const keyword of codeKeywords) {
        if (content.includes(keyword.toLowerCase())) {
          relevanceBoost += 0.05;
        }
      }

      return {
        ...doc,
        score: (doc.score || 0) * (1 + Math.min(relevanceBoost, 0.2)),
        codeRelevanceBoost: relevanceBoost,
      };
    });
  }

  /**
   * 项目感知重排序
   * @param {string} query - 查询文本
   * @param {Array} documents - 文档列表
   * @param {Object} context - 项目上下文
   * @returns {Promise<Array>} 重排序后的文档
   */
  async rerank(query, documents, context = {}) {
    if (!documents || documents.length === 0) {
      return [];
    }

    logger.info(
      `[ProjectAwareReranker] 重排序 ${documents.length} 个文档`,
    );
    const startTime = Date.now();

    try {
      // 1. 应用项目感知权重
      let rerankedDocs = this._applyProjectAwareWeights(documents, context);

      // 2. 应用代码相关性
      rerankedDocs = this._applyCodeRelevance(
        rerankedDocs,
        query,
        context.projectType,
      );

      // 3. 按最终分数排序
      rerankedDocs.sort((a, b) => b.score - a.score);

      const duration = Date.now() - startTime;
      logger.info(`[ProjectAwareReranker] 完成 (${duration}ms)`);

      return rerankedDocs;
    } catch (error) {
      logger.error("[ProjectAwareReranker] 重排序失败:", error);
      return documents; // 返回原始文档
    }
  }
}

// ============================================================
// 单例模式与导出
// ============================================================

let projectRAGManager = null;
let incrementalIndexManager = null;
let multiFileRetriever = null;
let unifiedRetriever = null;
let projectAwareReranker = null;

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

/**
 * 获取增量索引管理器实例
 * @returns {IncrementalIndexManager}
 */
function getIncrementalIndexManager() {
  if (!incrementalIndexManager) {
    const { getDatabase } = require("../database");
    const { getRAGManager } = require("../rag/rag-manager");
    incrementalIndexManager = new IncrementalIndexManager(
      getDatabase(),
      getRAGManager(),
    );
  }
  return incrementalIndexManager;
}

/**
 * 获取多文件检索器实例
 * @returns {MultiFileRetriever}
 */
function getMultiFileRetriever() {
  if (!multiFileRetriever) {
    const { getDatabase } = require("../database");
    const { getRAGManager } = require("../rag/rag-manager");
    multiFileRetriever = new MultiFileRetriever(getDatabase(), getRAGManager());
  }
  return multiFileRetriever;
}

/**
 * 获取统一检索器实例
 * @returns {UnifiedRetriever}
 */
function getUnifiedRetriever() {
  if (!unifiedRetriever) {
    const { getDatabase } = require("../database");
    const { getRAGManager } = require("../rag/rag-manager");
    unifiedRetriever = new UnifiedRetriever(getDatabase(), getRAGManager());
  }
  return unifiedRetriever;
}

/**
 * 获取项目感知重排序器实例
 * @returns {ProjectAwareReranker}
 */
function getProjectAwareReranker() {
  if (!projectAwareReranker) {
    const { getDatabase } = require("../database");
    projectAwareReranker = new ProjectAwareReranker(getDatabase());
  }
  return projectAwareReranker;
}

module.exports = {
  ProjectRAGManager,
  getProjectRAGManager,
  IncrementalIndexManager,
  getIncrementalIndexManager,
  MultiFileRetriever,
  getMultiFileRetriever,
  UnifiedRetriever,
  getUnifiedRetriever,
  ProjectAwareReranker,
  getProjectAwareReranker,
};
