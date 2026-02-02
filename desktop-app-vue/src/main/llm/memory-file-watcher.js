/**
 * MemoryFileWatcher - 记忆文件监听器
 *
 * 监听 memory 目录的文件变化，自动触发索引更新
 *
 * 特性:
 * - 使用 chokidar 进行文件监听
 * - 1.5s debounce 避免频繁触发
 * - 增量索引更新
 * - 文件 hash 跟踪
 *
 * @module memory-file-watcher
 * @version 0.1.0
 * @since 2026-02-01
 */

const { logger } = require("../utils/logger.js");
const chokidar = require("chokidar");
const path = require("path");
const fs = require("fs").promises;
const crypto = require("crypto");
const { EventEmitter } = require("events");

/**
 * MemoryFileWatcher 类
 */
class MemoryFileWatcher extends EventEmitter {
  /**
   * 创建文件监听器
   * @param {Object} options - 配置选项
   * @param {string} options.memoryDir - 监听的记忆目录
   * @param {Object} [options.database] - 数据库实例（用于 hash 跟踪）
   * @param {number} [options.debounceMs=1500] - 防抖延迟（毫秒）
   * @param {boolean} [options.persistent=true] - 持久化监听
   * @param {boolean} [options.ignoreInitial=true] - 忽略初始扫描
   * @param {string[]} [options.ignorePatterns] - 忽略的模式
   * @param {Function} [options.onChangeCallback] - 文件变化回调
   */
  constructor(options = {}) {
    super();

    if (!options.memoryDir) {
      throw new Error("[MemoryFileWatcher] memoryDir 参数是必需的");
    }

    this.memoryDir = options.memoryDir;
    this.db = options.database || null;
    this.debounceMs = options.debounceMs || 1500;
    this.persistent = options.persistent !== false;
    this.ignoreInitial = options.ignoreInitial !== false;
    this.onChangeCallback = options.onChangeCallback || null;

    // 默认忽略模式
    this.ignorePatterns = options.ignorePatterns || [
      /node_modules/,
      /\.git/,
      /\.DS_Store/,
      /Thumbs\.db/,
      /\.swp$/,
      /~$/,
    ];

    // 监听器实例
    this.watcher = null;

    // 防抖定时器
    this._debounceTimers = new Map();

    // 待处理的变更队列
    this._pendingChanges = new Map();

    // 状态
    this.isWatching = false;
    this.stats = {
      startedAt: null,
      filesWatched: 0,
      changesDetected: 0,
      indexesUpdated: 0,
      errors: 0,
    };

    // 预编译的 SQL 语句
    this._preparedStatements = {};
    if (this.db) {
      this._initPreparedStatements();
    }

    logger.info("[MemoryFileWatcher] 初始化完成", {
      监听目录: this.memoryDir,
      防抖延迟: `${this.debounceMs}ms`,
      持久化: this.persistent,
    });
  }

  /**
   * 初始化预编译 SQL 语句
   * @private
   */
  _initPreparedStatements() {
    try {
      // 获取文件 hash
      this._preparedStatements.getHash = this.db.prepare(`
        SELECT content_hash, last_modified_at, index_status
        FROM memory_file_hashes
        WHERE file_path = ?
      `);

      // 更新文件 hash
      this._preparedStatements.setHash = this.db.prepare(`
        INSERT OR REPLACE INTO memory_file_hashes
        (file_path, content_hash, file_size, last_modified_at, last_indexed_at, index_status, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      // 更新索引状态
      this._preparedStatements.updateStatus = this.db.prepare(`
        UPDATE memory_file_hashes
        SET index_status = ?, last_indexed_at = ?, error_message = ?
        WHERE file_path = ?
      `);

      // 删除文件记录
      this._preparedStatements.deleteHash = this.db.prepare(`
        DELETE FROM memory_file_hashes WHERE file_path = ?
      `);

      // 获取所有已索引文件
      this._preparedStatements.getAllIndexed = this.db.prepare(`
        SELECT file_path, content_hash, last_modified_at
        FROM memory_file_hashes
        WHERE index_status = 'indexed'
      `);
    } catch (error) {
      logger.error("[MemoryFileWatcher] 初始化 SQL 语句失败:", error);
    }
  }

  /**
   * 启动文件监听
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isWatching) {
      logger.info("[MemoryFileWatcher] 监听器已在运行");
      return;
    }

    try {
      // 确保目录存在
      await fs.mkdir(this.memoryDir, { recursive: true });

      // 创建 chokidar 监听器
      this.watcher = chokidar.watch(this.memoryDir, {
        ignored: this.ignorePatterns,
        persistent: this.persistent,
        ignoreInitial: this.ignoreInitial,
        depth: 5, // 最大深度
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100,
        },
      });

      // 绑定事件
      this.watcher
        .on("add", (filePath) => this._handleChange("add", filePath))
        .on("change", (filePath) => this._handleChange("change", filePath))
        .on("unlink", (filePath) => this._handleChange("unlink", filePath))
        .on("addDir", (dirPath) => this._handleChange("addDir", dirPath))
        .on("unlinkDir", (dirPath) => this._handleChange("unlinkDir", dirPath))
        .on("error", (error) => this._handleError(error))
        .on("ready", () => this._handleReady());

      this.isWatching = true;
      this.stats.startedAt = Date.now();

      logger.info("[MemoryFileWatcher] 文件监听已启动:", this.memoryDir);
    } catch (error) {
      logger.error("[MemoryFileWatcher] 启动失败:", error);
      throw error;
    }
  }

  /**
   * 停止文件监听
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isWatching || !this.watcher) {
      logger.info("[MemoryFileWatcher] 监听器未运行");
      return;
    }

    try {
      // 清除所有防抖定时器
      for (const timer of this._debounceTimers.values()) {
        clearTimeout(timer);
      }
      this._debounceTimers.clear();

      // 关闭监听器
      await this.watcher.close();
      this.watcher = null;
      this.isWatching = false;

      logger.info("[MemoryFileWatcher] 文件监听已停止");
      this.emit("stopped");
    } catch (error) {
      logger.error("[MemoryFileWatcher] 停止失败:", error);
      throw error;
    }
  }

  /**
   * 处理文件变化
   * @private
   * @param {string} event - 事件类型
   * @param {string} filePath - 文件路径
   */
  _handleChange(event, filePath) {
    // 只处理 Markdown 文件
    if (
      !this._isMarkdownFile(filePath) &&
      event !== "unlink" &&
      event !== "unlinkDir"
    ) {
      return;
    }

    // 记录变更
    const relativePath = path.relative(this.memoryDir, filePath);
    this._pendingChanges.set(relativePath, {
      event,
      filePath,
      timestamp: Date.now(),
    });
    this.stats.changesDetected++;

    // 防抖处理
    const debounceKey = relativePath;
    if (this._debounceTimers.has(debounceKey)) {
      clearTimeout(this._debounceTimers.get(debounceKey));
    }

    this._debounceTimers.set(
      debounceKey,
      setTimeout(() => {
        this._processChange(event, filePath, relativePath);
        this._debounceTimers.delete(debounceKey);
        this._pendingChanges.delete(relativePath);
      }, this.debounceMs),
    );
  }

  /**
   * 处理变更（防抖后）
   * @private
   * @param {string} event - 事件类型
   * @param {string} filePath - 文件路径
   * @param {string} relativePath - 相对路径
   */
  async _processChange(event, filePath, relativePath) {
    logger.info("[MemoryFileWatcher] 处理文件变化:", { event, relativePath });

    try {
      switch (event) {
        case "add":
        case "change":
          await this._handleFileAddOrChange(filePath, relativePath);
          break;
        case "unlink":
          await this._handleFileUnlink(filePath, relativePath);
          break;
        case "addDir":
        case "unlinkDir":
          // 目录变化暂不处理
          break;
      }

      // 触发回调
      if (this.onChangeCallback) {
        await this.onChangeCallback(event, filePath, relativePath);
      }

      // 触发事件
      this.emit("change", { event, filePath, relativePath });
    } catch (error) {
      logger.error("[MemoryFileWatcher] 处理变更失败:", error);
      this.stats.errors++;
      this.emit("error", { event, filePath, error });
    }
  }

  /**
   * 处理文件添加或修改
   * @private
   * @param {string} filePath - 文件路径
   * @param {string} relativePath - 相对路径
   */
  async _handleFileAddOrChange(filePath, relativePath) {
    try {
      // 读取文件内容
      const content = await fs.readFile(filePath, "utf-8");
      const stats = await fs.stat(filePath);

      // 计算 hash
      const contentHash = this._hashContent(content);

      // 检查是否有变化
      if (this.db) {
        const existing = this._preparedStatements.getHash.get(relativePath);
        if (existing && existing.content_hash === contentHash) {
          logger.info(
            "[MemoryFileWatcher] 文件未变化，跳过索引:",
            relativePath,
          );
          return;
        }
      }

      // 更新 hash 记录
      if (this.db) {
        const now = Date.now();
        this._preparedStatements.setHash.run(
          relativePath,
          contentHash,
          stats.size,
          stats.mtimeMs,
          now,
          "pending", // 先设为 pending，索引完成后更新
          0,
        );
      }

      // 触发索引更新事件
      this.emit("index-needed", {
        filePath,
        relativePath,
        contentHash,
        fileSize: stats.size,
        content,
      });

      logger.info("[MemoryFileWatcher] 文件需要索引:", relativePath);
    } catch (error) {
      logger.error("[MemoryFileWatcher] 处理文件失败:", relativePath, error);
      throw error;
    }
  }

  /**
   * 处理文件删除
   * @private
   * @param {string} filePath - 文件路径
   * @param {string} relativePath - 相对路径
   */
  async _handleFileUnlink(filePath, relativePath) {
    try {
      // 删除 hash 记录
      if (this.db) {
        this._preparedStatements.deleteHash.run(relativePath);
      }

      // 触发索引删除事件
      this.emit("index-delete", {
        filePath,
        relativePath,
      });

      logger.info("[MemoryFileWatcher] 文件已删除:", relativePath);
    } catch (error) {
      logger.error("[MemoryFileWatcher] 处理删除失败:", relativePath, error);
      throw error;
    }
  }

  /**
   * 处理监听器就绪
   * @private
   */
  _handleReady() {
    const watched = this.watcher.getWatched();
    let filesCount = 0;
    for (const dir of Object.values(watched)) {
      filesCount += dir.length;
    }
    this.stats.filesWatched = filesCount;

    logger.info("[MemoryFileWatcher] 监听器就绪", {
      目录数: Object.keys(watched).length,
      文件数: filesCount,
    });

    this.emit("ready", { filesWatched: filesCount });
  }

  /**
   * 处理错误
   * @private
   * @param {Error} error - 错误对象
   */
  _handleError(error) {
    logger.error("[MemoryFileWatcher] 监听错误:", error);
    this.stats.errors++;
    this.emit("error", error);
  }

  /**
   * 检查是否为 Markdown 文件
   * @private
   * @param {string} filePath - 文件路径
   * @returns {boolean}
   */
  _isMarkdownFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return [".md", ".markdown", ".txt"].includes(ext);
  }

  /**
   * 计算内容 hash
   * @private
   * @param {string} content - 内容
   * @returns {string} SHA-256 hash
   */
  _hashContent(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * 更新索引状态
   * @param {string} relativePath - 相对路径
   * @param {string} status - 状态 ('indexed', 'pending', 'failed')
   * @param {number} [chunkCount] - 分块数量
   * @param {string} [errorMessage] - 错误信息
   */
  updateIndexStatus(relativePath, status, chunkCount = 0, errorMessage = null) {
    if (!this.db) {
      return;
    }

    try {
      this._preparedStatements.updateStatus.run(
        status,
        Date.now(),
        errorMessage,
        relativePath,
      );

      if (status === "indexed") {
        this.stats.indexesUpdated++;
      }

      logger.info("[MemoryFileWatcher] 索引状态已更新:", {
        relativePath,
        status,
      });
    } catch (error) {
      logger.error("[MemoryFileWatcher] 更新索引状态失败:", error);
    }
  }

  /**
   * 全量扫描目录
   * @returns {Promise<Array<Object>>} 需要索引的文件列表
   */
  async scanDirectory() {
    const needsIndexing = [];

    try {
      const files = await this._scanRecursive(this.memoryDir);

      for (const filePath of files) {
        if (!this._isMarkdownFile(filePath)) {
          continue;
        }

        const relativePath = path.relative(this.memoryDir, filePath);
        const content = await fs.readFile(filePath, "utf-8");
        const contentHash = this._hashContent(content);
        const stats = await fs.stat(filePath);

        // 检查是否需要索引
        let needsIndex = true;
        if (this.db) {
          const existing = this._preparedStatements.getHash.get(relativePath);
          if (
            existing &&
            existing.content_hash === contentHash &&
            existing.index_status === "indexed"
          ) {
            needsIndex = false;
          }
        }

        if (needsIndex) {
          needsIndexing.push({
            filePath,
            relativePath,
            contentHash,
            fileSize: stats.size,
            content,
          });
        }
      }

      logger.info("[MemoryFileWatcher] 扫描完成", {
        总文件数: files.length,
        需要索引: needsIndexing.length,
      });

      return needsIndexing;
    } catch (error) {
      logger.error("[MemoryFileWatcher] 扫描目录失败:", error);
      throw error;
    }
  }

  /**
   * 递归扫描目录
   * @private
   * @param {string} dir - 目录路径
   * @returns {Promise<Array<string>>} 文件路径列表
   */
  async _scanRecursive(dir) {
    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // 检查忽略模式
      const shouldIgnore = this.ignorePatterns.some((pattern) => {
        if (pattern instanceof RegExp) {
          return pattern.test(fullPath);
        }
        return fullPath.includes(pattern);
      });

      if (shouldIgnore) {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await this._scanRecursive(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * 获取监听统计
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      isWatching: this.isWatching,
      memoryDir: this.memoryDir,
      debounceMs: this.debounceMs,
      pendingChanges: this._pendingChanges.size,
      runningTime: this.stats.startedAt
        ? Math.floor((Date.now() - this.stats.startedAt) / 1000) + "s"
        : null,
    };
  }

  /**
   * 获取所有已索引文件
   * @returns {Array<Object>} 已索引文件列表
   */
  getIndexedFiles() {
    if (!this.db) {
      return [];
    }

    try {
      return this._preparedStatements.getAllIndexed.all();
    } catch (error) {
      logger.error("[MemoryFileWatcher] 获取已索引文件失败:", error);
      return [];
    }
  }

  /**
   * 销毁实例
   */
  async destroy() {
    await this.stop();
    this.removeAllListeners();
    logger.info("[MemoryFileWatcher] 实例已销毁");
  }
}

module.exports = {
  MemoryFileWatcher,
};
