/**
 * 应用日志管理器
 * 提供统一的日志记录、分级、轮转和查询功能
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

/**
 * 日志级别
 */
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
};

/**
 * 日志级别名称
 */
const LogLevelNames = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.FATAL]: "FATAL",
};

class LogManager {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(app.getPath("userData"), "logs");
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 7; // 保留7个日志文件
    this.minLevel = options.minLevel || LogLevel.INFO;
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;

    // 当前日志文件
    this.currentLogFile = null;
    this.currentLogStream = null;

    // 日志缓冲区
    this.logBuffer = [];
    this.bufferSize = 100;
    this.flushInterval = 5000; // 5秒刷新一次

    // 初始化
    this.init();
  }

  /**
   * 初始化日志管理器
   */
  init() {
    // 确保日志目录存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // 创建日志文件
    this.createLogFile();

    // 启动定时刷新
    this.startFlushTimer();

    // 监听进程退出
    process.on("exit", () => {
      this.flush();
      this.close();
    });

    logger.info("[LogManager] Initialized, log directory:", this.logDir);
  }

  /**
   * 创建日志文件
   */
  createLogFile() {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .split("T")[0];
    const filename = `app-${timestamp}.log`;
    this.currentLogFile = path.join(this.logDir, filename);

    // 如果文件已存在且超过大小限制，轮转
    if (fs.existsSync(this.currentLogFile)) {
      const stats = fs.statSync(this.currentLogFile);
      if (stats.size >= this.maxFileSize) {
        this.rotateLogFile();
        return;
      }
    }

    // 创建写入流
    this.currentLogStream = fs.createWriteStream(this.currentLogFile, {
      flags: "a",
    });
  }

  /**
   * 轮转日志文件
   */
  rotateLogFile() {
    // 关闭当前流
    if (this.currentLogStream) {
      this.currentLogStream.end();
    }

    // 重命名当前文件
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const newFilename = `app-${timestamp}.log`;
    const newPath = path.join(this.logDir, newFilename);

    if (fs.existsSync(this.currentLogFile)) {
      fs.renameSync(this.currentLogFile, newPath);
    }

    // 创建新文件
    this.createLogFile();

    // 清理旧文件
    this.cleanOldLogs();
  }

  /**
   * 清理旧日志文件
   */
  cleanOldLogs() {
    try {
      const files = fs
        .readdirSync(this.logDir)
        .filter((f) => f.endsWith(".log"))
        .map((f) => ({
          name: f,
          path: path.join(this.logDir, f),
          time: fs.statSync(path.join(this.logDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time);

      // 删除超过限制的文件
      if (files.length > this.maxFiles) {
        const toDelete = files.slice(this.maxFiles);
        for (const file of toDelete) {
          fs.unlinkSync(file.path);
          logger.info("[LogManager] Deleted old log file:", file.name);
        }
      }
    } catch (error) {
      logger.error("[LogManager] Clean old logs error:", error);
    }
  }

  /**
   * 写入日志
   */
  log(level, message, meta = {}) {
    if (level < this.minLevel) {return;}

    const timestamp = new Date().toISOString();
    const levelName = LogLevelNames[level] || "UNKNOWN";

    // 构建日志条目
    const logEntry = {
      timestamp,
      level: levelName,
      message,
      meta,
      pid: process.pid,
    };

    // 格式化日志行
    const logLine = this.formatLogLine(logEntry);

    // 输出到控制台
    if (this.enableConsole) {
      this.logToConsole(level, logLine);
    }

    // 写入文件
    if (this.enableFile) {
      this.logBuffer.push(logLine);

      // 如果缓冲区满了，立即刷新
      if (this.logBuffer.length >= this.bufferSize) {
        this.flush();
      }
    }
  }

  /**
   * 格式化日志行
   */
  formatLogLine(entry) {
    let line = `[${entry.timestamp}] [${entry.level}] [PID:${entry.pid}] ${entry.message}`;

    if (Object.keys(entry.meta).length > 0) {
      line += ` ${JSON.stringify(entry.meta)}`;
    }

    return line + "\n";
  }

  /**
   * 输出到控制台
   */
  logToConsole(level, message) {
    switch (level) {
      case LogLevel.DEBUG:
        logger.debug(message.trim());
        break;
      case LogLevel.INFO:
        logger.info(message.trim());
        break;
      case LogLevel.WARN:
        logger.warn(message.trim());
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        logger.error(message.trim());
        break;
      default:
        logger.info(message.trim());
    }
  }

  /**
   * 刷新缓冲区
   */
  flush() {
    if (this.logBuffer.length === 0) {return;}

    try {
      // 检查文件大小
      if (fs.existsSync(this.currentLogFile)) {
        const stats = fs.statSync(this.currentLogFile);
        if (stats.size >= this.maxFileSize) {
          this.rotateLogFile();
        }
      }

      // 写入所有缓冲的日志
      if (this.currentLogStream) {
        for (const line of this.logBuffer) {
          this.currentLogStream.write(line);
        }
      }

      this.logBuffer = [];
    } catch (error) {
      logger.error("[LogManager] Flush error:", error);
    }
  }

  /**
   * 启动定时刷新
   */
  startFlushTimer() {
    setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  /**
   * 关闭日志管理器
   */
  close() {
    this.flush();

    if (this.currentLogStream) {
      this.currentLogStream.end();
      this.currentLogStream = null;
    }
  }

  /**
   * DEBUG级别日志
   */
  debug(message, meta = {}) {
    this.log(LogLevel.DEBUG, message, meta);
  }

  /**
   * INFO级别日志
   */
  info(message, meta = {}) {
    this.log(LogLevel.INFO, message, meta);
  }

  /**
   * WARN级别日志
   */
  warn(message, meta = {}) {
    this.log(LogLevel.WARN, message, meta);
  }

  /**
   * ERROR级别日志
   */
  error(message, meta = {}) {
    this.log(LogLevel.ERROR, message, meta);
  }

  /**
   * FATAL级别日志
   */
  fatal(message, meta = {}) {
    this.log(LogLevel.FATAL, message, meta);
  }

  /**
   * 获取日志文件列表
   */
  getLogFiles() {
    try {
      const files = fs
        .readdirSync(this.logDir)
        .filter((f) => f.endsWith(".log"))
        .map((f) => ({
          name: f,
          path: path.join(this.logDir, f),
          size: fs.statSync(path.join(this.logDir, f)).size,
          created: fs.statSync(path.join(this.logDir, f)).birthtime,
          modified: fs.statSync(path.join(this.logDir, f)).mtime,
        }))
        .sort((a, b) => b.modified - a.modified);

      return files;
    } catch (error) {
      logger.error("[LogManager] Get log files error:", error);
      return [];
    }
  }

  /**
   * 读取日志文件
   */
  readLogFile(filename, options = {}) {
    try {
      const filePath = path.join(this.logDir, filename);
      if (!fs.existsSync(filePath)) {
        throw new Error("Log file not found");
      }

      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());

      // 应用过滤器
      let filteredLines = lines;

      if (options.level) {
        filteredLines = filteredLines.filter((line) =>
          line.includes(`[${options.level}]`),
        );
      }

      if (options.search) {
        filteredLines = filteredLines.filter((line) =>
          line.toLowerCase().includes(options.search.toLowerCase()),
        );
      }

      // 应用限制
      if (options.limit) {
        filteredLines = filteredLines.slice(-options.limit);
      }

      return filteredLines;
    } catch (error) {
      logger.error("[LogManager] Read log file error:", error);
      throw error;
    }
  }

  /**
   * 搜索日志
   */
  searchLogs(query, options = {}) {
    try {
      const files = this.getLogFiles();
      const results = [];

      for (const file of files) {
        const lines = this.readLogFile(file.name, {
          search: query,
          ...options,
        });
        if (lines.length > 0) {
          results.push({
            file: file.name,
            lines,
            count: lines.length,
          });
        }
      }

      return results;
    } catch (error) {
      logger.error("[LogManager] Search logs error:", error);
      return [];
    }
  }

  /**
   * 清空所有日志
   */
  clearAllLogs() {
    try {
      const files = fs
        .readdirSync(this.logDir)
        .filter((f) => f.endsWith(".log"));

      for (const file of files) {
        fs.unlinkSync(path.join(this.logDir, file));
      }

      // 重新创建日志文件
      this.createLogFile();

      logger.info("[LogManager] All logs cleared");
      return true;
    } catch (error) {
      logger.error("[LogManager] Clear all logs error:", error);
      return false;
    }
  }

  /**
   * 导出日志
   */
  exportLogs(outputPath) {
    try {
      const files = this.getLogFiles();
      const allLogs = [];

      for (const file of files) {
        const content = fs.readFileSync(file.path, "utf8");
        allLogs.push(`\n=== ${file.name} ===\n`);
        allLogs.push(content);
      }

      fs.writeFileSync(outputPath, allLogs.join("\n"), "utf8");
      logger.info("[LogManager] Logs exported to:", outputPath);
      return true;
    } catch (error) {
      logger.error("[LogManager] Export logs error:", error);
      return false;
    }
  }
}

// 创建全局实例
let logManager = null;

function getLogManager(options) {
  if (!logManager) {
    logManager = new LogManager(options);
  }
  return logManager;
}

module.exports = { LogManager, getLogManager, LogLevel };
