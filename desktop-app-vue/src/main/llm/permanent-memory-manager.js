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

const { logger } = require('../utils/logger.js');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

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
      throw new Error('[PermanentMemoryManager] memoryDir 参数是必需的');
    }

    if (!options.database) {
      throw new Error('[PermanentMemoryManager] database 参数是必需的');
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
    this.dailyNotesDir = path.join(this.memoryDir, 'daily');
    this.memoryFilePath = path.join(this.memoryDir, 'MEMORY.md');
    this.indexDir = path.join(this.memoryDir, 'index');

    // 内存缓存
    this.dailyNotesCache = new Map();
    this.memoryContentCache = null;
    this.fileHashCache = new Map();

    logger.info('[PermanentMemoryManager] 初始化完成', {
      记忆目录: this.memoryDir,
      启用DailyNotes: this.enableDailyNotes,
      启用长期记忆: this.enableLongTermMemory,
      启用自动索引: this.enableAutoIndexing,
      保留天数: this.maxDailyNotesRetention,
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

      logger.info('[PermanentMemoryManager] 目录结构创建完成');

      // 清理过期 Daily Notes
      if (this.enableDailyNotes) {
        await this.cleanupExpiredDailyNotes();
      }

      // 初始化统计
      await this.initializeTodayStats();

      return true;
    } catch (error) {
      logger.error('[PermanentMemoryManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 确保 MEMORY.md 文件存在
   */
  async ensureMemoryFileExists() {
    try {
      await fs.access(this.memoryFilePath);
      logger.info('[PermanentMemoryManager] MEMORY.md 已存在');
    } catch (error) {
      // 文件不存在,创建默认内容
      const defaultContent = this.getDefaultMemoryContent();
      await fs.writeFile(this.memoryFilePath, defaultContent, 'utf-8');
      logger.info('[PermanentMemoryManager] MEMORY.md 已创建');
    }
  }

  /**
   * 获取 MEMORY.md 默认内容
   */
  getDefaultMemoryContent() {
    const now = new Date().toISOString().split('T')[0];
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
      throw new Error('[PermanentMemoryManager] Daily Notes 功能未启用');
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
        const separator = '\n\n';
        await fs.appendFile(filePath, separator + content, 'utf-8');
        logger.info('[PermanentMemoryManager] Daily Note 已追加:', today);
      } else {
        // 创建或覆盖模式
        const header = this.getDailyNoteHeader(today);
        const fullContent = fileExists ? content : header + '\n\n' + content;
        await fs.writeFile(
          filePath,
          fileExists ? await this.readDailyNote(today) + '\n\n' + content : fullContent,
          'utf-8'
        );
        logger.info('[PermanentMemoryManager] Daily Note 已写入:', today);
      }

      // 更新缓存
      this.dailyNotesCache.delete(today);

      // 更新元数据
      await this.updateDailyNoteMetadata(today);

      // 触发事件
      this.emit('daily-note-updated', { date: today, filePath });

      return filePath;
    } catch (error) {
      logger.error('[PermanentMemoryManager] 写入 Daily Note 失败:', error);
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
      throw new Error('[PermanentMemoryManager] Daily Notes 功能未启用');
    }

    // 检查缓存
    if (this.dailyNotesCache.has(date)) {
      return this.dailyNotesCache.get(date);
    }

    const filePath = this.getDailyNoteFilePath(date);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.dailyNotesCache.set(date, content);
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // 文件不存在
      }
      logger.error('[PermanentMemoryManager] 读取 Daily Note 失败:', error);
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
      throw new Error('[PermanentMemoryManager] 长期记忆功能未启用');
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
        newContent = currentContent + '\n\n' + content;
      }

      // 更新最后更新时间
      const today = new Date().toISOString().split('T')[0];
      newContent = newContent.replace(
        /> 最后更新: .+/,
        `> 最后更新: ${today}`
      );

      await fs.writeFile(this.memoryFilePath, newContent, 'utf-8');

      // 清除缓存
      this.memoryContentCache = null;

      logger.info('[PermanentMemoryManager] MEMORY.md 已更新', { section });

      // 触发事件
      this.emit('memory-updated', { section, filePath: this.memoryFilePath });
    } catch (error) {
      logger.error('[PermanentMemoryManager] 追加到 MEMORY.md 失败:', error);
      throw error;
    }
  }

  /**
   * 读取 MEMORY.md
   * @returns {Promise<string>} MEMORY.md 内容
   */
  async readMemory() {
    if (!this.enableLongTermMemory) {
      throw new Error('[PermanentMemoryManager] 长期记忆功能未启用');
    }

    // 检查缓存
    if (this.memoryContentCache) {
      return this.memoryContentCache;
    }

    try {
      const content = await fs.readFile(this.memoryFilePath, 'utf-8');
      this.memoryContentCache = content;
      return content;
    } catch (error) {
      logger.error('[PermanentMemoryManager] 读取 MEMORY.md 失败:', error);
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
    const sectionRegex = new RegExp(`(## ${section}[\\s\\S]*?)(?=\\n## |$)`, 'i');
    const match = content.match(sectionRegex);

    if (match) {
      const sectionContent = match[1];
      const updatedSection = sectionContent.trimEnd() + '\n\n' + newContent;
      return content.replace(sectionRegex, updatedSection);
    } else {
      // 章节不存在,追加到末尾
      return content + '\n\n## ' + section + '\n\n' + newContent;
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
    return new Date().toISOString().split('T')[0];
  }

  /**
   * 计算内容 hash
   * @param {string} content - 内容
   * @returns {string} SHA-256 hash
   */
  hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 更新 Daily Note 元数据
   * @param {string} date - 日期
   */
  async updateDailyNoteMetadata(date) {
    try {
      const content = await this.readDailyNote(date);
      if (!content) return;

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
        now
      );

      logger.info('[PermanentMemoryManager] Daily Note 元数据已更新:', date);
    } catch (error) {
      logger.error('[PermanentMemoryManager] 更新元数据失败:', error);
    }
  }

  /**
   * 解析 Daily Note 元数据
   * @param {string} content - Daily Note 内容
   * @returns {Object} 元数据对象
   */
  parseDailyNoteMetadata(content) {
    const conversationCount = (content.match(/### \d{2}:\d{2} - /g) || []).length;
    const completedTasks = (content.match(/- \[x\]/gi) || []).length;
    const pendingTasks = (content.match(/- \[ \]/g) || []).length;
    const discoveriesCount = (content.match(/## 💡 技术发现[\s\S]*?(?=\n## |$)/i)?.[0].match(/^- /gm) || []).length;
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
        if (!file.endsWith('.md')) continue;

        const filePath = path.join(this.dailyNotesDir, file);
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > retentionMs) {
          await fs.unlink(filePath);
          deletedCount++;
          logger.info('[PermanentMemoryManager] 已删除过期 Daily Note:', file);
        }
      }

      if (deletedCount > 0) {
        logger.info(`[PermanentMemoryManager] 清理完成,删除 ${deletedCount} 个过期文件`);
      }
    } catch (error) {
      logger.error('[PermanentMemoryManager] 清理过期文件失败:', error);
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
      logger.error('[PermanentMemoryManager] 初始化统计失败:', error);
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
        .prepare('SELECT COUNT(*) as count FROM embedding_cache')
        .get().count;

      // 统计索引文件
      const indexedFilesCount = this.db
        .prepare('SELECT COUNT(*) as count FROM memory_file_hashes WHERE index_status = ?')
        .get('indexed').count;

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
        today
      );

      return {
        dailyNotesCount,
        memorySectionsCount,
        cachedEmbeddingsCount,
        indexedFilesCount,
        date: today,
      };
    } catch (error) {
      logger.error('[PermanentMemoryManager] 获取统计失败:', error);
      throw error;
    }
  }

  /**
   * 统计 Daily Notes 数量
   */
  async countDailyNotes() {
    try {
      const files = await fs.readdir(this.dailyNotesDir);
      return files.filter((f) => f.endsWith('.md')).length;
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
           LIMIT ?`
        )
        .all(limit);

      return rows;
    } catch (error) {
      logger.error('[PermanentMemoryManager] 获取最近 Daily Notes 失败:', error);
      return [];
    }
  }

  /**
   * 销毁实例
   */
  destroy() {
    this.dailyNotesCache.clear();
    this.memoryContentCache = null;
    this.fileHashCache.clear();
    this.removeAllListeners();
    logger.info('[PermanentMemoryManager] 实例已销毁');
  }
}

module.exports = {
  PermanentMemoryManager,
};
