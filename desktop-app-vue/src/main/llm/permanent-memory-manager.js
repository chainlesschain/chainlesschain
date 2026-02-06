/**
 * PermanentMemoryManager - 永久记忆管理器
 *
 * 实现 Clawdbot 风格的永久记忆机制:
 * 1. Daily Notes (每日日志) - memory/daily/YYYY-MM-DD.md
 * 2. MEMORY.md (长期知识库) - memory/MEMORY.md
 * 3. 自动索引更新
 * 4. 混合搜索 (Vector + BM25)
 *
 * 参考: https://docs.openclaw.ai/concepts/memory
 *
 * @module permanent-memory-manager
 * @version 0.1.0
 * @since 2026-02-01
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const { HybridSearchEngine } = require("../rag/hybrid-search-engine");
const { MemoryFileWatcher } = require("./memory-file-watcher");
const { EmbeddingCache } = require("../rag/embedding-cache");

/**
 * PermanentMemoryManager 类
 */
class PermanentMemoryManager extends EventEmitter {
  /**
   * 创建永久记忆管理器
   * @param {Object} options - 配置选项
   * @param {string} options.memoryDir - 记忆目录路径
   * @param {Object} options.database - 数据库实例
   * @param {Object} [options.llmManager] - LLM 管理器实例
   * @param {Object} [options.ragManager] - RAG 管理器实例
   * @param {boolean} [options.enableDailyNotes=true] - 启用 Daily Notes
   * @param {boolean} [options.enableLongTermMemory=true] - 启用 MEMORY.md
   * @param {boolean} [options.enableAutoIndexing=true] - 启用自动索引
   * @param {number} [options.maxDailyNotesRetention=30] - Daily Notes 保留天数
   */
  constructor(options = {}) {
    super();

    if (!options.memoryDir) {
      throw new Error("[PermanentMemoryManager] memoryDir 参数是必需的");
    }

    if (!options.database) {
      throw new Error("[PermanentMemoryManager] database 参数是必需的");
    }

    this.memoryDir = options.memoryDir;
    this.db = options.database;
    this.llmManager = options.llmManager || null;
    this.ragManager = options.ragManager || null;

    // 配置
    this.enableDailyNotes = options.enableDailyNotes !== false;
    this.enableLongTermMemory = options.enableLongTermMemory !== false;
    this.enableAutoIndexing = options.enableAutoIndexing !== false;
    this.maxDailyNotesRetention = options.maxDailyNotesRetention || 30;

    // 子目录路径
    this.dailyNotesDir = path.join(this.memoryDir, "daily");
    this.memoryFilePath = path.join(this.memoryDir, "MEMORY.md");
    this.indexDir = path.join(this.memoryDir, "index");

    // 内存缓存
    this.dailyNotesCache = new Map();
    this.memoryContentCache = null;
    this.fileHashCache = new Map();

    // 混合搜索引擎 (Phase 2)
    this.hybridSearchEngine = null;
    if (this.ragManager) {
      try {
        this.hybridSearchEngine = new HybridSearchEngine({
          ragManager: this.ragManager,
          vectorWeight: 0.6,
          textWeight: 0.4,
          rrfK: 60,
          language: "zh",
        });
        logger.info("[PermanentMemoryManager] 混合搜索引擎已初始化");
      } catch (error) {
        logger.warn(
          "[PermanentMemoryManager] 混合搜索引擎初始化失败:",
          error.message,
        );
      }
    }

    // Embedding 缓存 (Phase 4)
    this.embeddingCache = null;
    if (options.enableEmbeddingCache !== false) {
      try {
        this.embeddingCache = new EmbeddingCache({
          database: this.db,
          maxCacheSize: 100000,
          cacheExpiration: 30 * 24 * 60 * 60 * 1000, // 30天
          enableAutoCleanup: true,
        });
        logger.info("[PermanentMemoryManager] Embedding 缓存已初始化");
      } catch (error) {
        logger.warn(
          "[PermanentMemoryManager] Embedding 缓存初始化失败:",
          error.message,
        );
      }
    }

    // 文件监听器 (Phase 5)
    this.fileWatcher = null;
    if (this.enableAutoIndexing) {
      try {
        this.fileWatcher = new MemoryFileWatcher({
          memoryDir: this.memoryDir,
          database: this.db,
          debounceMs: 1500,
          onChangeCallback: this._handleFileChange.bind(this),
        });
        logger.info("[PermanentMemoryManager] 文件监听器已初始化");
      } catch (error) {
        logger.warn(
          "[PermanentMemoryManager] 文件监听器初始化失败:",
          error.message,
        );
      }
    }

    logger.info("[PermanentMemoryManager] 初始化完成", {
      记忆目录: this.memoryDir,
      启用DailyNotes: this.enableDailyNotes,
      启用长期记忆: this.enableLongTermMemory,
      启用自动索引: this.enableAutoIndexing,
      保留天数: this.maxDailyNotesRetention,
      混合搜索: !!this.hybridSearchEngine,
      Embedding缓存: !!this.embeddingCache,
      文件监听: !!this.fileWatcher,
    });
  }

  /**
   * 初始化 (创建目录结构)
   */
  async initialize() {
    try {
      // 创建主目录
      await fs.mkdir(this.memoryDir, { recursive: true });

      // 创建子目录
      if (this.enableDailyNotes) {
        await fs.mkdir(this.dailyNotesDir, { recursive: true });
      }

      if (this.enableAutoIndexing) {
        await fs.mkdir(this.indexDir, { recursive: true });
      }

      // 创建 MEMORY.md (如果不存在)
      if (this.enableLongTermMemory) {
        await this.ensureMemoryFileExists();
      }

      logger.info("[PermanentMemoryManager] 目录结构创建完成");

      // 清理过期 Daily Notes
      if (this.enableDailyNotes) {
        await this.cleanupExpiredDailyNotes();
      }

      // 初始化统计
      await this.initializeTodayStats();

      // 启动 Embedding 缓存自动清理 (Phase 4)
      if (this.embeddingCache) {
        this.embeddingCache.startAutoCleanup();
      }

      // 启动文件监听 (Phase 5)
      if (this.fileWatcher && this.enableAutoIndexing) {
        await this.startFileWatcher();
      }

      return true;
    } catch (error) {
      logger.error("[PermanentMemoryManager] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 确保 MEMORY.md 文件存在
   */
  async ensureMemoryFileExists() {
    try {
      await fs.access(this.memoryFilePath);
      logger.info("[PermanentMemoryManager] MEMORY.md 已存在");
    } catch (error) {
      // 文件不存在,创建默认内容
      const defaultContent = this.getDefaultMemoryContent();
      await fs.writeFile(this.memoryFilePath, defaultContent, "utf-8");
      logger.info("[PermanentMemoryManager] MEMORY.md 已创建");
    }
  }

  /**
   * 获取 MEMORY.md 默认内容
   */
  getDefaultMemoryContent() {
    const now = new Date().toISOString().split("T")[0];
    return `# ChainlessChain 长期记忆

> 本文件由 PermanentMemoryManager 自动维护
> 最后更新: ${now}

---

## 🧑 用户偏好

### 开发习惯
<!-- 用户的开发偏好和习惯 -->

### 技术栈偏好
<!-- 用户偏好的技术栈和工具 -->

---

## 🏗️ 架构决策

<!-- 使用 ADR (Architecture Decision Record) 格式记录架构决策 -->

---

## 🐛 常见问题解决方案

<!-- 记录遇到的问题和解决方案 -->

---

## 📚 重要技术发现

<!-- 记录重要的技术发现和最佳实践 -->

---

## 🔧 系统配置

<!-- 记录系统配置和环境变量 -->

---

_此文件会自动更新,也可手动编辑。_
`;
  }

  /**
   * 写入今日 Daily Note
   * @param {string} content - 内容 (Markdown 格式)
   * @param {Object} options - 选项
   * @param {boolean} [options.append=true] - 是否追加模式
   * @returns {Promise<string>} Daily Note 文件路径
   */
  async writeDailyNote(content, options = {}) {
    if (!this.enableDailyNotes) {
      throw new Error("[PermanentMemoryManager] Daily Notes 功能未启用");
    }

    const append = options.append !== false;
    const today = this.getTodayDate();
    const filePath = this.getDailyNoteFilePath(today);

    try {
      // 检查文件是否存在
      let fileExists = false;
      try {
        await fs.access(filePath);
        fileExists = true;
      } catch (err) {
        // 文件不存在
      }

      if (fileExists && append) {
        // 追加模式
        const separator = "\n\n";
        await fs.appendFile(filePath, separator + content, "utf-8");
        logger.info("[PermanentMemoryManager] Daily Note 已追加:", today);
      } else {
        // 创建或覆盖模式
        const header = this.getDailyNoteHeader(today);
        const fullContent = fileExists ? content : header + "\n\n" + content;
        await fs.writeFile(
          filePath,
          fileExists
            ? (await this.readDailyNote(today)) + "\n\n" + content
            : fullContent,
          "utf-8",
        );
        logger.info("[PermanentMemoryManager] Daily Note 已写入:", today);
      }

      // 更新缓存
      this.dailyNotesCache.delete(today);

      // 更新元数据
      await this.updateDailyNoteMetadata(today);

      // 触发事件
      this.emit("daily-note-updated", { date: today, filePath });

      return filePath;
    } catch (error) {
      logger.error("[PermanentMemoryManager] 写入 Daily Note 失败:", error);
      throw error;
    }
  }

  /**
   * 读取指定日期的 Daily Note
   * @param {string} date - 日期 (YYYY-MM-DD)
   * @returns {Promise<string>} Daily Note 内容
   */
  async readDailyNote(date) {
    if (!this.enableDailyNotes) {
      throw new Error("[PermanentMemoryManager] Daily Notes 功能未启用");
    }

    // 检查缓存
    if (this.dailyNotesCache.has(date)) {
      return this.dailyNotesCache.get(date);
    }

    const filePath = this.getDailyNoteFilePath(date);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      this.dailyNotesCache.set(date, content);
      return content;
    } catch (error) {
      if (error.code === "ENOENT") {
        return null; // 文件不存在
      }
      logger.error("[PermanentMemoryManager] 读取 Daily Note 失败:", error);
      throw error;
    }
  }

  /**
   * 追加到 MEMORY.md
   * @param {string} content - 内容 (Markdown 格式)
   * @param {Object} options - 选项
   * @param {string} [options.section] - 章节名称
   * @returns {Promise<void>}
   */
  async appendToMemory(content, options = {}) {
    if (!this.enableLongTermMemory) {
      throw new Error("[PermanentMemoryManager] 长期记忆功能未启用");
    }

    try {
      const currentContent = await this.readMemory();
      const section = options.section || null;

      let newContent;
      if (section) {
        // 追加到指定章节
        newContent = this.appendToSection(currentContent, section, content);
      } else {
        // 追加到文件末尾
        newContent = currentContent + "\n\n" + content;
      }

      // 更新最后更新时间
      const today = new Date().toISOString().split("T")[0];
      newContent = newContent.replace(/> 最后更新: .+/, `> 最后更新: ${today}`);

      await fs.writeFile(this.memoryFilePath, newContent, "utf-8");

      // 清除缓存
      this.memoryContentCache = null;

      logger.info("[PermanentMemoryManager] MEMORY.md 已更新", { section });

      // 触发事件
      this.emit("memory-updated", { section, filePath: this.memoryFilePath });
    } catch (error) {
      logger.error("[PermanentMemoryManager] 追加到 MEMORY.md 失败:", error);
      throw error;
    }
  }

  /**
   * 读取 MEMORY.md
   * @returns {Promise<string>} MEMORY.md 内容
   */
  async readMemory() {
    if (!this.enableLongTermMemory) {
      throw new Error("[PermanentMemoryManager] 长期记忆功能未启用");
    }

    // 检查缓存
    if (this.memoryContentCache) {
      return this.memoryContentCache;
    }

    try {
      const content = await fs.readFile(this.memoryFilePath, "utf-8");
      this.memoryContentCache = content;
      return content;
    } catch (error) {
      logger.error("[PermanentMemoryManager] 读取 MEMORY.md 失败:", error);
      throw error;
    }
  }

  /**
   * 更新 MEMORY.md 内容（完整覆盖）
   * @param {string} content - 新的完整内容
   * @returns {Promise<void>}
   */
  async updateMemory(content) {
    if (!this.enableLongTermMemory) {
      throw new Error("[PermanentMemoryManager] 长期记忆功能未启用");
    }

    try {
      // 更新最后更新时间
      const today = new Date().toISOString().split("T")[0];
      let newContent = content;
      if (newContent.includes("> 最后更新:")) {
        newContent = newContent.replace(/> 最后更新: .+/, `> 最后更新: ${today}`);
      }

      await fs.writeFile(this.memoryFilePath, newContent, "utf-8");

      // 清除缓存
      this.memoryContentCache = null;

      logger.info("[PermanentMemoryManager] MEMORY.md 已完整更新");

      // 触发事件
      this.emit("memory-updated", { fullUpdate: true, filePath: this.memoryFilePath });
    } catch (error) {
      logger.error("[PermanentMemoryManager] 更新 MEMORY.md 失败:", error);
      throw error;
    }
  }

  /**
   * 追加内容到指定章节
   * @param {string} content - 原始内容
   * @param {string} section - 章节名称 (如 '🧑 用户偏好')
   * @param {string} newContent - 新增内容
   * @returns {string} 更新后的内容
   */
  appendToSection(content, section, newContent) {
    const sectionRegex = new RegExp(
      `(## ${section}[\\s\\S]*?)(?=\\n## |$)`,
      "i",
    );
    const match = content.match(sectionRegex);

    if (match) {
      const sectionContent = match[1];
      const updatedSection = sectionContent.trimEnd() + "\n\n" + newContent;
      return content.replace(sectionRegex, updatedSection);
    } else {
      // 章节不存在,追加到末尾
      return content + "\n\n## " + section + "\n\n" + newContent;
    }
  }

  /**
   * 获取 Daily Note 文件路径
   * @param {string} date - 日期 (YYYY-MM-DD)
   * @returns {string} 文件路径
   */
  getDailyNoteFilePath(date) {
    return path.join(this.dailyNotesDir, `${date}.md`);
  }

  /**
   * 获取 Daily Note 头部
   * @param {string} date - 日期 (YYYY-MM-DD)
   * @returns {string} 头部内容
   */
  getDailyNoteHeader(date) {
    return `# ${date} 运行日志

## 📌 今日概览
- 总对话数: 0
- 活跃会话: 0
- 创建笔记: 0

## 💬 重要对话

## ✅ 完成任务

## 📝 待办事项

## 💡 技术发现
`;
  }

  /**
   * 获取今日日期 (YYYY-MM-DD)
   * @returns {string} 今日日期
   */
  getTodayDate() {
    return new Date().toISOString().split("T")[0];
  }

  /**
   * 计算内容 hash
   * @param {string} content - 内容
   * @returns {string} SHA-256 hash
   */
  hashContent(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * 更新 Daily Note 元数据
   * @param {string} date - 日期
   */
  async updateDailyNoteMetadata(date) {
    try {
      const content = await this.readDailyNote(date);
      if (!content) {
        return;
      }

      const metadata = this.parseDailyNoteMetadata(content);

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO daily_notes_metadata
        (date, title, conversation_count, completed_tasks, pending_tasks, discoveries_count, word_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();
      stmt.run(
        date,
        `${date} 运行日志`,
        metadata.conversationCount,
        metadata.completedTasks,
        metadata.pendingTasks,
        metadata.discoveriesCount,
        metadata.wordCount,
        now,
        now,
      );

      logger.info("[PermanentMemoryManager] Daily Note 元数据已更新:", date);
    } catch (error) {
      logger.error("[PermanentMemoryManager] 更新元数据失败:", error);
    }
  }

  /**
   * 解析 Daily Note 元数据
   * @param {string} content - Daily Note 内容
   * @returns {Object} 元数据对象
   */
  parseDailyNoteMetadata(content) {
    const conversationCount = (content.match(/### \d{2}:\d{2} - /g) || [])
      .length;
    const completedTasks = (content.match(/- \[x\]/gi) || []).length;
    const pendingTasks = (content.match(/- \[ \]/g) || []).length;
    const discoveriesCount = (
      content.match(/## 💡 技术发现[\s\S]*?(?=\n## |$)/i)?.[0].match(/^- /gm) ||
      []
    ).length;
    const wordCount = content.length;

    return {
      conversationCount,
      completedTasks,
      pendingTasks,
      discoveriesCount,
      wordCount,
    };
  }

  /**
   * 清理过期 Daily Notes
   */
  async cleanupExpiredDailyNotes() {
    try {
      const files = await fs.readdir(this.dailyNotesDir);
      const now = Date.now();
      const retentionMs = this.maxDailyNotesRetention * 24 * 60 * 60 * 1000;

      let deletedCount = 0;

      for (const file of files) {
        if (!file.endsWith(".md")) {
          continue;
        }

        const filePath = path.join(this.dailyNotesDir, file);
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > retentionMs) {
          await fs.unlink(filePath);
          deletedCount++;
          logger.info("[PermanentMemoryManager] 已删除过期 Daily Note:", file);
        }
      }

      if (deletedCount > 0) {
        logger.info(
          `[PermanentMemoryManager] 清理完成,删除 ${deletedCount} 个过期文件`,
        );
      }
    } catch (error) {
      logger.error("[PermanentMemoryManager] 清理过期文件失败:", error);
    }
  }

  /**
   * 初始化今日统计
   */
  async initializeTodayStats() {
    try {
      const today = this.getTodayDate();
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO memory_stats (date, updated_at)
        VALUES (?, ?)
      `);
      stmt.run(today, Date.now());
    } catch (error) {
      logger.error("[PermanentMemoryManager] 初始化统计失败:", error);
    }
  }

  /**
   * 获取记忆统计
   * @returns {Promise<Object>} 统计对象
   */
  async getStats() {
    try {
      const today = this.getTodayDate();

      // 统计 Daily Notes
      const dailyNotesCount = await this.countDailyNotes();

      // 统计 MEMORY.md 条目
      const memorySectionsCount = await this.countMemorySections();

      // 统计缓存
      const cachedEmbeddingsCount = this.db
        .prepare("SELECT COUNT(*) as count FROM embedding_cache")
        .get().count;

      // 统计索引文件
      const indexedFilesCount = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM memory_file_hashes WHERE index_status = ?",
        )
        .get("indexed").count;

      // 更新统计表
      const stmt = this.db.prepare(`
        UPDATE memory_stats
        SET daily_notes_count = ?,
            memory_sections_count = ?,
            cached_embeddings_count = ?,
            indexed_files_count = ?,
            updated_at = ?
        WHERE date = ?
      `);

      stmt.run(
        dailyNotesCount,
        memorySectionsCount,
        cachedEmbeddingsCount,
        indexedFilesCount,
        Date.now(),
        today,
      );

      return {
        dailyNotesCount,
        memorySectionsCount,
        cachedEmbeddingsCount,
        indexedFilesCount,
        date: today,
      };
    } catch (error) {
      logger.error("[PermanentMemoryManager] 获取统计失败:", error);
      throw error;
    }
  }

  /**
   * 统计 Daily Notes 数量
   */
  async countDailyNotes() {
    try {
      const files = await fs.readdir(this.dailyNotesDir);
      return files.filter((f) => f.endsWith(".md")).length;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 统计 MEMORY.md 章节数
   */
  async countMemorySections() {
    try {
      const content = await this.readMemory();
      const sections = content.match(/^## /gm) || [];
      return sections.length;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 获取最近的 Daily Notes
   * @param {number} limit - 返回数量
   * @returns {Promise<Array>} Daily Notes 列表
   */
  async getRecentDailyNotes(limit = 7) {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM daily_notes_metadata
           ORDER BY date DESC
           LIMIT ?`,
        )
        .all(limit);

      return rows;
    } catch (error) {
      logger.error(
        "[PermanentMemoryManager] 获取最近 Daily Notes 失败:",
        error,
      );
      return [];
    }
  }

  /**
   * 混合搜索记忆 (Vector + BM25)
   * @param {string} query - 查询字符串
   * @param {Object} options - 搜索选项
   * @param {number} [options.limit=10] - 返回结果数量
   * @param {boolean} [options.searchDailyNotes=true] - 搜索 Daily Notes
   * @param {boolean} [options.searchMemory=true] - 搜索 MEMORY.md
   * @param {number} [options.vectorWeight=0.6] - Vector 权重
   * @param {number} [options.textWeight=0.4] - BM25 权重
   * @returns {Promise<Array<Object>>} 搜索结果
   */
  async searchMemory(query, options = {}) {
    if (!this.hybridSearchEngine) {
      logger.warn(
        "[PermanentMemoryManager] 混合搜索引擎未初始化，回退到简单搜索",
      );
      return this.simpleSearch(query, options);
    }

    const limit = options.limit || 10;
    const searchDailyNotes = options.searchDailyNotes !== false;
    const searchMemory = options.searchMemory !== false;

    try {
      // 收集待搜索的文档
      const documents = [];

      // 添加 Daily Notes
      if (searchDailyNotes) {
        const dailyNotesDocs = await this.getDailyNotesDocuments();
        documents.push(...dailyNotesDocs);
      }

      // 添加 MEMORY.md
      if (searchMemory) {
        const memoryDoc = await this.getMemoryDocument();
        if (memoryDoc) {
          documents.push(memoryDoc);
        }
      }

      // 索引文档
      await this.hybridSearchEngine.indexDocuments(documents);

      // 更新权重（如果提供）
      if (
        options.vectorWeight !== undefined ||
        options.textWeight !== undefined
      ) {
        this.hybridSearchEngine.updateWeights(
          options.vectorWeight || 0.6,
          options.textWeight || 0.4,
        );
      }

      // 执行搜索
      const results = await this.hybridSearchEngine.search(query, {
        limit,
        vectorLimit: options.vectorLimit || 20,
        bm25Limit: options.bm25Limit || 20,
        threshold: options.threshold || 0,
      });

      return results;
    } catch (error) {
      logger.error("[PermanentMemoryManager] 混合搜索失败:", error);
      throw error;
    }
  }

  /**
   * 简单搜索（回退方案，不使用混合搜索）
   * @param {string} query - 查询字符串
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array<Object>>} 搜索结果
   */
  async simpleSearch(query, options = {}) {
    const limit = options.limit || 10;
    const results = [];

    try {
      // 搜索 Daily Notes
      if (options.searchDailyNotes !== false) {
        const dailyNotes = await this.getRecentDailyNotes(30);
        for (const note of dailyNotes) {
          const content = await this.readDailyNote(note.date);
          if (content && content.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              document: {
                id: `daily-${note.date}`,
                content,
                metadata: { type: "daily_note", date: note.date },
              },
              score: 0.5,
              source: "simple",
            });
          }
        }
      }

      // 搜索 MEMORY.md
      if (options.searchMemory !== false) {
        const memoryContent = await this.readMemory();
        if (
          memoryContent &&
          memoryContent.toLowerCase().includes(query.toLowerCase())
        ) {
          results.push({
            document: {
              id: "memory",
              content: memoryContent,
              metadata: { type: "long_term_memory" },
            },
            score: 0.7,
            source: "simple",
          });
        }
      }

      // 按分数排序
      results.sort((a, b) => b.score - a.score);

      return results.slice(0, limit);
    } catch (error) {
      logger.error("[PermanentMemoryManager] 简单搜索失败:", error);
      return [];
    }
  }

  /**
   * 获取 Daily Notes 文档列表
   * @returns {Promise<Array<Object>>} 文档列表
   */
  async getDailyNotesDocuments() {
    const documents = [];

    try {
      const recentNotes = await this.getRecentDailyNotes(30);

      for (const note of recentNotes) {
        const content = await this.readDailyNote(note.date);
        if (content) {
          documents.push({
            id: `daily-${note.date}`,
            content,
            metadata: {
              type: "daily_note",
              date: note.date,
              wordCount: note.word_count,
            },
          });
        }
      }

      return documents;
    } catch (error) {
      logger.error(
        "[PermanentMemoryManager] 获取 Daily Notes 文档失败:",
        error,
      );
      return [];
    }
  }

  /**
   * 获取 MEMORY.md 文档
   * @returns {Promise<Object|null>} MEMORY.md 文档
   */
  async getMemoryDocument() {
    try {
      const content = await this.readMemory();
      if (content) {
        return {
          id: "memory",
          content,
          metadata: {
            type: "long_term_memory",
            wordCount: content.length,
          },
        };
      }
      return null;
    } catch (error) {
      logger.error("[PermanentMemoryManager] 获取 MEMORY.md 文档失败:", error);
      return null;
    }
  }

  // ============================================================
  // Phase 5: 文件监听和自动索引
  // ============================================================

  /**
   * 启动文件监听
   * @returns {Promise<void>}
   */
  async startFileWatcher() {
    if (!this.fileWatcher) {
      logger.warn("[PermanentMemoryManager] 文件监听器未初始化");
      return;
    }

    try {
      await this.fileWatcher.start();

      // 监听索引需求事件
      this.fileWatcher.on("index-needed", async (data) => {
        await this._handleIndexNeeded(data);
      });

      // 监听索引删除事件
      this.fileWatcher.on("index-delete", async (data) => {
        await this._handleIndexDelete(data);
      });

      logger.info("[PermanentMemoryManager] 文件监听已启动");
      this.emit("file-watcher-started");
    } catch (error) {
      logger.error("[PermanentMemoryManager] 启动文件监听失败:", error);
      throw error;
    }
  }

  /**
   * 停止文件监听
   * @returns {Promise<void>}
   */
  async stopFileWatcher() {
    if (!this.fileWatcher) {
      return;
    }

    try {
      await this.fileWatcher.stop();
      logger.info("[PermanentMemoryManager] 文件监听已停止");
      this.emit("file-watcher-stopped");
    } catch (error) {
      logger.error("[PermanentMemoryManager] 停止文件监听失败:", error);
    }
  }

  /**
   * 处理文件变化回调
   * @private
   * @param {string} event - 事件类型
   * @param {string} filePath - 文件路径
   * @param {string} relativePath - 相对路径
   */
  async _handleFileChange(event, filePath, relativePath) {
    logger.info("[PermanentMemoryManager] 文件变化:", { event, relativePath });

    // 清除相关缓存
    if (relativePath.startsWith("daily/")) {
      const date = path.basename(relativePath, ".md");
      this.dailyNotesCache.delete(date);
    } else if (relativePath === "MEMORY.md") {
      this.memoryContentCache = null;
    }

    // 触发事件
    this.emit("file-changed", { event, filePath, relativePath });
  }

  /**
   * 处理索引需求
   * @private
   * @param {Object} data - 文件数据
   */
  async _handleIndexNeeded(data) {
    const { filePath, relativePath, content, contentHash } = data;

    try {
      logger.info("[PermanentMemoryManager] 开始索引文件:", relativePath);

      // 如果有 RAG 管理器，进行索引
      if (this.ragManager && this.hybridSearchEngine) {
        // 将文件添加到混合搜索引擎
        const document = {
          id: relativePath,
          content,
          metadata: {
            filePath,
            contentHash,
            indexedAt: Date.now(),
          },
        };

        await this.hybridSearchEngine.indexDocuments([document]);

        // 更新索引状态
        if (this.fileWatcher) {
          this.fileWatcher.updateIndexStatus(relativePath, "indexed", 1);
        }

        logger.info("[PermanentMemoryManager] 文件索引完成:", relativePath);
      }

      this.emit("file-indexed", { relativePath, contentHash });
    } catch (error) {
      logger.error(
        "[PermanentMemoryManager] 索引文件失败:",
        relativePath,
        error,
      );

      if (this.fileWatcher) {
        this.fileWatcher.updateIndexStatus(
          relativePath,
          "failed",
          0,
          error.message,
        );
      }

      this.emit("index-error", { relativePath, error });
    }
  }

  /**
   * 处理索引删除
   * @private
   * @param {Object} data - 文件数据
   */
  async _handleIndexDelete(data) {
    const { relativePath } = data;

    try {
      logger.info("[PermanentMemoryManager] 删除索引:", relativePath);

      // TODO: 从混合搜索引擎中删除文档
      // 目前 HybridSearchEngine 没有 removeDocument 方法

      this.emit("file-unindexed", { relativePath });
    } catch (error) {
      logger.error(
        "[PermanentMemoryManager] 删除索引失败:",
        relativePath,
        error,
      );
    }
  }

  /**
   * 全量重建索引
   * @returns {Promise<Object>} 重建结果
   */
  async rebuildIndex() {
    if (!this.fileWatcher) {
      throw new Error("[PermanentMemoryManager] 文件监听器未初始化");
    }

    try {
      logger.info("[PermanentMemoryManager] 开始全量重建索引");

      // 扫描目录获取需要索引的文件
      const filesToIndex = await this.fileWatcher.scanDirectory();

      let indexed = 0;
      let failed = 0;

      for (const file of filesToIndex) {
        try {
          await this._handleIndexNeeded(file);
          indexed++;
        } catch (error) {
          logger.warn(
            `[PermanentMemoryManager] 索引文件失败: ${file.relativePath}`,
            error.message,
          );
          failed++;
        }
      }

      const result = {
        total: filesToIndex.length,
        indexed,
        failed,
        timestamp: Date.now(),
      };

      logger.info("[PermanentMemoryManager] 全量重建索引完成:", result);
      this.emit("index-rebuilt", result);

      return result;
    } catch (error) {
      logger.error("[PermanentMemoryManager] 全量重建索引失败:", error);
      throw error;
    }
  }

  /**
   * 获取索引统计
   * @returns {Object} 统计信息
   */
  getIndexStats() {
    const stats = {
      embeddingCache: this.embeddingCache
        ? this.embeddingCache.getStats()
        : null,
      fileWatcher: this.fileWatcher ? this.fileWatcher.getStats() : null,
      indexedFiles: this.fileWatcher
        ? this.fileWatcher.getIndexedFiles().length
        : 0,
    };

    return stats;
  }

  // ============================================================
  // Phase 6: 会话记忆提取
  // ============================================================

  /**
   * 保存内容到永久记忆
   * @param {string} content - 要保存的内容
   * @param {Object} options - 选项
   * @param {string} [options.type='conversation'] - 类型 (conversation, discovery, solution, preference)
   * @param {string} [options.section] - MEMORY.md 章节名 (可选)
   * @returns {Promise<Object>} 保存结果
   */
  async saveToMemory(content, options = {}) {
    const type = options.type || "conversation";
    const timestamp = new Date().toISOString().split("T")[0];

    try {
      // 根据类型决定保存位置
      if (type === "daily" || type === "conversation") {
        // 保存到 Daily Notes
        const formattedContent = `### ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} - 对话记录

${content}
`;
        await this.writeDailyNote(formattedContent, { append: true });
        logger.info("[PermanentMemoryManager] 对话已保存到 Daily Notes");

        return {
          savedTo: "daily_notes",
          date: timestamp,
          type,
        };
      } else {
        // 保存到 MEMORY.md
        const sectionMap = {
          discovery: "📚 重要技术发现",
          solution: "🐛 常见问题解决方案",
          preference: "🧑 用户偏好",
          architecture: "🏗️ 架构决策",
          config: "🔧 系统配置",
        };

        const section = options.section || sectionMap[type] || "📚 重要技术发现";
        const formattedContent = `### ${timestamp}

${content}
`;
        await this.appendToMemory(formattedContent, { section });
        logger.info("[PermanentMemoryManager] 内容已保存到 MEMORY.md:", section);

        return {
          savedTo: "memory_md",
          section,
          date: timestamp,
          type,
        };
      }
    } catch (error) {
      logger.error("[PermanentMemoryManager] 保存到记忆失败:", error);
      throw error;
    }
  }

  /**
   * 从对话中提取重要信息并保存到永久记忆
   * @param {Array<Object>} messages - 对话消息数组 [{role, content}]
   * @param {string} conversationTitle - 对话标题
   * @returns {Promise<Object>} 提取结果
   */
  async extractFromConversation(messages, conversationTitle = "") {
    if (!messages || messages.length === 0) {
      throw new Error("[PermanentMemoryManager] 消息列表为空");
    }

    try {
      // 构建对话摘要
      const conversationSummary = this._buildConversationSummary(
        messages,
        conversationTitle,
      );

      // 保存到 Daily Notes
      const timestamp = new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const dailyContent = `### ${timestamp} - ${conversationTitle || "对话记录"}

**消息数**: ${messages.length}

${conversationSummary}
`;

      await this.writeDailyNote(dailyContent, { append: true });

      logger.info(
        "[PermanentMemoryManager] 对话摘要已保存到 Daily Notes:",
        conversationTitle,
      );

      // 尝试提取技术发现 (如果有 LLM 管理器)
      let discoveries = [];
      if (this.llmManager) {
        try {
          discoveries = await this._extractDiscoveries(messages);
          if (discoveries.length > 0) {
            const discoveriesContent = discoveries
              .map((d) => `- ${d}`)
              .join("\n");
            await this.appendToMemory(
              `### ${new Date().toISOString().split("T")[0]} - 从对话中提取\n\n${discoveriesContent}\n`,
              { section: "📚 重要技术发现" },
            );
            logger.info(
              "[PermanentMemoryManager] 技术发现已保存:",
              discoveries.length,
            );
          }
        } catch (error) {
          logger.warn("[PermanentMemoryManager] 技术发现提取失败:", error.message);
        }
      }

      return {
        savedTo: "daily_notes",
        messageCount: messages.length,
        title: conversationTitle,
        discoveriesExtracted: discoveries.length,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error("[PermanentMemoryManager] 提取对话记忆失败:", error);
      throw error;
    }
  }

  /**
   * 构建对话摘要
   * @private
   * @param {Array<Object>} messages - 消息数组
   * @param {string} title - 对话标题
   * @returns {string} 对话摘要
   */
  _buildConversationSummary(messages, title) {
    const lines = [];

    // 收集关键内容
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role === "user" ? "👤 用户" : "🤖 AI";
      const content = msg.content || "";

      // 截断过长的内容
      const truncatedContent =
        content.length > 500
          ? content.substring(0, 500) + "..."
          : content;

      lines.push(`**${role}**: ${truncatedContent}`);

      // 最多显示最后5条消息
      if (i >= messages.length - 5 && i < messages.length - 1) {
        continue;
      } else if (i < messages.length - 5) {
        if (i === 0) {
          lines.push("\n*... 中间省略 ...*\n");
        }
        continue;
      }
    }

    return lines.join("\n\n");
  }

  /**
   * 使用 LLM 提取技术发现
   * @private
   * @param {Array<Object>} messages - 消息数组
   * @returns {Promise<Array<string>>} 技术发现列表
   */
  async _extractDiscoveries(messages) {
    if (!this.llmManager) {
      return [];
    }

    try {
      // 构建提取 prompt
      const conversationText = messages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n\n");

      const prompt = `请从以下对话中提取值得记住的技术发现、解决方案或最佳实践。
只列出关键点，每个发现用一行描述。如果没有值得记录的内容，返回空。

对话内容:
${conversationText.substring(0, 3000)}

请用简洁的中文列出发现（每行一个）:`;

      // 调用 LLM (如果可用)
      if (this.llmManager.chat) {
        const response = await this.llmManager.chat({
          messages: [{ role: "user", content: prompt }],
          maxTokens: 500,
        });

        if (response && response.content) {
          // 解析响应，提取每行作为一个发现
          const discoveries = response.content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#") && line.length > 5);

          return discoveries.slice(0, 5); // 最多5个发现
        }
      }

      return [];
    } catch (error) {
      logger.warn("[PermanentMemoryManager] LLM 提取失败:", error.message);
      return [];
    }
  }

  /**
   * 获取 MEMORY.md 章节列表
   * @returns {Promise<Array<Object>>} 章节列表
   */
  async getMemorySections() {
    try {
      const content = await this.readMemory();
      const sections = [];

      // 匹配所有 ## 开头的章节
      const sectionRegex = /^## (.+)$/gm;
      const matches = [];
      let match;

      // 先收集所有匹配
      while ((match = sectionRegex.exec(content)) !== null) {
        matches.push({
          title: match[1].trim(),
          index: match.index,
        });
      }

      // 然后处理每个章节
      for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const nextIndex = i + 1 < matches.length
          ? matches[i + 1].index
          : content.length;

        // 提取章节内容
        const sectionContent = content.substring(current.index, nextIndex);
        const itemCount = (sectionContent.match(/^- /gm) || []).length +
          (sectionContent.match(/^### /gm) || []).length;

        sections.push({
          title: current.title,
          itemCount,
          hasContent: sectionContent.trim().length > current.title.length + 10,
        });
      }

      return sections;
    } catch (error) {
      logger.error("[PermanentMemoryManager] 获取章节列表失败:", error);
      return [];
    }
  }

  /**
   * 销毁实例
   */
  async destroy() {
    // 停止文件监听
    if (this.fileWatcher) {
      await this.fileWatcher.destroy();
    }

    // 清理 Embedding 缓存
    if (this.embeddingCache) {
      this.embeddingCache.destroy();
    }

    this.dailyNotesCache.clear();
    this.memoryContentCache = null;
    this.fileHashCache.clear();

    // 清理混合搜索引擎
    if (this.hybridSearchEngine) {
      this.hybridSearchEngine.clear();
    }

    this.removeAllListeners();
    logger.info("[PermanentMemoryManager] 实例已销毁");
  }
}

module.exports = {
  PermanentMemoryManager,
};
