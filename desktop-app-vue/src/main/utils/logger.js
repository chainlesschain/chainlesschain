/**
 * 主进程日志管理器
 * 支持文件输出、日志轮转、性能监控
 */

import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";
import {
  LOG_LEVELS,
  LOG_LEVEL_NAMES,
  DEFAULT_CONFIG,
  formatLogMessage,
  getStackTrace,
  sanitizeData,
} from "../../shared/logger-config.js";

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// Handle EPIPE errors globally to prevent crashes when stdout/stderr pipe is broken
// This commonly happens when the process the output is piped to terminates
if (process.stdout && typeof process.stdout.on === "function") {
  process.stdout.on("error", (err) => {
    if (err.code === "EPIPE") {
      return;
    } // Ignore broken pipe errors
  });
}
if (process.stderr && typeof process.stderr.on === "function") {
  process.stderr.on("error", (err) => {
    if (err.code === "EPIPE") {
      return;
    } // Ignore broken pipe errors
  });
}

// Lazy initialization for electron - avoid import errors in test environment
let app = null;
let appInitialized = false;

function getApp() {
  if (appInitialized) {
    return app;
  }

  try {
    // Use require for electron (native module)
    const electron = require("electron");
    // Check if electron.app is available (not in test/non-Electron environment)
    if (
      electron &&
      electron.app &&
      typeof electron.app.getPath === "function"
    ) {
      app = electron.app;
    } else {
      throw new Error("Electron app not available");
    }
  } catch (error) {
    // In test environment, provide a mock with temp directory
    const tmpDir = path.join(os.tmpdir(), "chainlesschain-test");
    app = {
      getPath: () => tmpDir,
    };
  }

  appInitialized = true;
  return app;
}

class Logger {
  constructor(module = "main") {
    this.module = module;
    this.config = { ...DEFAULT_CONFIG };
    this.logDir = path.join(getApp().getPath("userData"), "logs");
    this.currentLogFile = null;
    this.performanceMarks = new Map();

    this.ensureLogDirectory();
    this.rotateLogsIfNeeded();
  }

  /**
   * 确保日志目录存在
   */
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * 获取当前日志文件路径
   */
  getCurrentLogFile() {
    const date = new Date().toISOString().split("T")[0];
    return path.join(this.logDir, `chainlesschain-${date}.log`);
  }

  /**
   * 日志轮转
   */
  rotateLogsIfNeeded() {
    try {
      const files = fs
        .readdirSync(this.logDir)
        .filter((f) => f.startsWith("chainlesschain-") && f.endsWith(".log"))
        .map((f) => ({
          name: f,
          path: path.join(this.logDir, f),
          stat: fs.statSync(path.join(this.logDir, f)),
        }))
        .sort((a, b) => b.stat.mtime - a.stat.mtime);

      // 删除超过最大文件数的日志
      if (files.length > this.config.fileConfig.maxFiles) {
        files.slice(this.config.fileConfig.maxFiles).forEach((file) => {
          fs.unlinkSync(file.path);
        });
      }

      // 检查当前日志文件大小
      const currentFile = this.getCurrentLogFile();
      if (fs.existsSync(currentFile)) {
        const stat = fs.statSync(currentFile);
        if (stat.size > this.config.fileConfig.maxSize) {
          const timestamp = Date.now();
          const newName = currentFile.replace(".log", `-${timestamp}.log`);
          fs.renameSync(currentFile, newName);
        }
      }
    } catch (error) {
      logger.error("日志轮转失败:", error);
    }
  }

  /**
   * 写入日志
   */
  log(level, message, data = {}) {
    if (level < this.config.level) {
      return;
    }

    const sanitized = sanitizeData(data);
    const formatted = formatLogMessage(
      level,
      this.module,
      message,
      sanitized,
      this.config.timestamp,
    );

    // 控制台输出
    if (this.config.console) {
      try {
        const consoleMethod =
          level >= LOG_LEVELS.ERROR
            ? "error"
            : level >= LOG_LEVELS.WARN
              ? "warn"
              : level >= LOG_LEVELS.INFO
                ? "info"
                : "log";
        console[consoleMethod](formatted);
      } catch (err) {
        // Ignore EPIPE errors (broken pipe) that occur when stdout/stderr is closed
        if (err.code !== "EPIPE") {
          // For non-EPIPE errors, try to write to file only
          this.config.console = false;
        }
      }
    }

    // 文件输出
    if (this.config.file) {
      try {
        const logFile = this.getCurrentLogFile();
        let output = formatted + "\n";

        // 添加堆栈跟踪（ERROR及以上）
        if (level >= LOG_LEVELS.ERROR && this.config.stackTrace) {
          output += getStackTrace() + "\n";
        }

        fs.appendFileSync(logFile, output, "utf8");
        this.rotateLogsIfNeeded();
      } catch (error) {
        logger.error("写入日志文件失败:", error);
      }
    }
  }

  /**
   * DEBUG级别日志
   */
  debug(message, data) {
    this.log(LOG_LEVELS.DEBUG, message, data);
  }

  /**
   * INFO级别日志
   */
  info(message, data) {
    this.log(LOG_LEVELS.INFO, message, data);
  }

  /**
   * WARN级别日志
   */
  warn(message, data) {
    this.log(LOG_LEVELS.WARN, message, data);
  }

  /**
   * ERROR级别日志
   */
  error(message, data) {
    this.log(LOG_LEVELS.ERROR, message, data);
  }

  /**
   * FATAL级别日志
   */
  fatal(message, data) {
    this.log(LOG_LEVELS.FATAL, message, data);
  }

  /**
   * 性能监控 - 开始
   */
  perfStart(label) {
    if (!this.config.performance.enabled) {
      return;
    }
    this.performanceMarks.set(label, Date.now());
  }

  /**
   * 性能监控 - 结束
   */
  perfEnd(label, data = {}) {
    if (!this.config.performance.enabled) {
      return;
    }

    const startTime = this.performanceMarks.get(label);
    if (!startTime) {
      this.warn(`性能标记不存在: ${label}`);
      return;
    }

    const duration = Date.now() - startTime;
    this.performanceMarks.delete(label);

    const logData = { ...data, duration: `${duration}ms` };

    if (duration > this.config.performance.slowThreshold) {
      this.warn(`慢操作: ${label}`, logData);
    } else {
      this.debug(`性能: ${label}`, logData);
    }

    return duration;
  }

  /**
   * 创建子日志器
   */
  child(subModule) {
    const childLogger = new Logger(`${this.module}:${subModule}`);
    childLogger.config = this.config;
    return childLogger;
  }

  /**
   * 更新配置
   */
  setConfig(config) {
    this.config = { ...this.config, ...config };
  }

  /**
   * 清理旧日志
   */
  cleanup(daysToKeep = 7) {
    try {
      const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
      const files = fs.readdirSync(this.logDir);

      let deletedCount = 0;
      files.forEach((file) => {
        const filePath = path.join(this.logDir, file);
        const stat = fs.statSync(filePath);

        if (stat.mtime.getTime() < cutoffTime) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      });

      this.info(`清理旧日志完成`, { deletedCount, daysToKeep });
      return deletedCount;
    } catch (error) {
      this.error("清理日志失败", { error: error.message });
      return 0;
    }
  }
}

// 导出单例
export const logger = new Logger("main");

// 导出类用于创建子日志器
export { Logger };

// 便捷方法
export const createLogger = (module) => new Logger(module);
