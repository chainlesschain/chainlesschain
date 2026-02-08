/**
 * 文件监视器
 * 监视文件系统变化
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

class FileWatcher extends EventEmitter {
  constructor(options = {}) {
    super();

    this.watchers = new Map(); // path -> watcher
    this.debounceTimers = new Map(); // path -> timer
    this.debounceDelay = options.debounceDelay || 300;

    logger.info("[FileWatcher] Initialized");
  }

  /**
   * 监视文件或目录
   */
  watch(targetPath, options = {}) {
    if (this.watchers.has(targetPath)) {
      logger.warn("[FileWatcher] Already watching:", targetPath);
      return;
    }

    try {
      const watcher = fs.watch(
        targetPath,
        {
          recursive: options.recursive !== false,
          persistent: options.persistent !== false,
        },
        (eventType, filename) => {
          this.handleChange(targetPath, eventType, filename);
        },
      );

      this.watchers.set(targetPath, {
        watcher,
        options,
      });

      logger.info("[FileWatcher] Watching:", targetPath);

      return () => this.unwatch(targetPath);
    } catch (error) {
      logger.error("[FileWatcher] Watch error:", error);
      throw error;
    }
  }

  /**
   * 停止监视
   */
  unwatch(targetPath) {
    const watcherData = this.watchers.get(targetPath);
    if (!watcherData) {
      return false;
    }

    watcherData.watcher.close();
    this.watchers.delete(targetPath);

    // 清除防抖定时器
    if (this.debounceTimers.has(targetPath)) {
      clearTimeout(this.debounceTimers.get(targetPath));
      this.debounceTimers.delete(targetPath);
    }

    logger.info("[FileWatcher] Stopped watching:", targetPath);
    return true;
  }

  /**
   * 停止所有监视
   */
  unwatchAll() {
    for (const targetPath of this.watchers.keys()) {
      this.unwatch(targetPath);
    }

    logger.info("[FileWatcher] Stopped all watchers");
  }

  /**
   * 处理文件变化
   */
  handleChange(targetPath, eventType, filename) {
    const fullPath = filename ? path.join(targetPath, filename) : targetPath;

    // 防抖处理
    if (this.debounceTimers.has(fullPath)) {
      clearTimeout(this.debounceTimers.get(fullPath));
    }

    const timer = setTimeout(() => {
      this.processChange(targetPath, eventType, fullPath);
      this.debounceTimers.delete(fullPath);
    }, this.debounceDelay);

    this.debounceTimers.set(fullPath, timer);
  }

  /**
   * 处理变化
   */
  async processChange(targetPath, eventType, fullPath) {
    try {
      // 检查文件是否存在
      const exists = fs.existsSync(fullPath);

      if (eventType === "rename") {
        if (exists) {
          // 文件创建
          const stats = fs.statSync(fullPath);
          this.emit("created", {
            path: fullPath,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            mtime: stats.mtime,
          });
        } else {
          // 文件删除
          this.emit("deleted", {
            path: fullPath,
          });
        }
      } else if (eventType === "change") {
        if (exists) {
          // 文件修改
          const stats = fs.statSync(fullPath);
          this.emit("modified", {
            path: fullPath,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            mtime: stats.mtime,
          });
        }
      }

      // 触发通用变化事件
      this.emit("change", {
        path: fullPath,
        eventType,
        exists,
      });

      logger.info("[FileWatcher] Change detected:", eventType, fullPath);
    } catch (error) {
      logger.error("[FileWatcher] Process change error:", error);
      this.emit("error", error);
    }
  }

  /**
   * 获取监视列表
   */
  getWatchList() {
    return Array.from(this.watchers.keys());
  }

  /**
   * 检查是否正在监视
   */
  isWatching(targetPath) {
    return this.watchers.has(targetPath);
  }

  /**
   * 获取监视数量
   */
  getWatchCount() {
    return this.watchers.size;
  }

  /**
   * 销毁监视器
   */
  destroy() {
    this.unwatchAll();
    this.removeAllListeners();
    logger.info("[FileWatcher] Destroyed");
  }
}

// 创建全局实例
let fileWatcher = null;

function getFileWatcher(options) {
  if (!fileWatcher) {
    fileWatcher = new FileWatcher(options);
  }
  return fileWatcher;
}

module.exports = { FileWatcher, getFileWatcher };
