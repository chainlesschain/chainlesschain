/**
 * 结构化日志系统
 *
 * 功能：
 * - 多级别日志（debug, info, warn, error, fatal）
 * - 日志轮转（按大小和时间）
 * - 日志分类（按模块）
 * - 性能监控
 * - 错误追踪
 * - 日志导出
 * - 向后兼容旧的Logger接口
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs");
const path = require("path");
const util = require("util");

// 日志级别
const logLevels = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
};

// 日志颜色（终端输出）
const LogColors = {
  DEBUG: "\x1b[36m", // Cyan
  INFO: "\x1b[32m", // Green
  WARN: "\x1b[33m", // Yellow
  ERROR: "\x1b[31m", // Red
  FATAL: "\x1b[35m", // Magenta
  RESET: "\x1b[0m",
};

// 全局配置
let globalConfig = {
  logDir: null,
  maxFileSize: 10, // MB
  maxFiles: 30,
  enableFile: true,
  enableConsole: true,
  level: "INFO",
};

/**
 * 初始化日志系统
 */
function initLogger(options = {}) {
  globalConfig = {
    ...globalConfig,
    ...options,
  };

  // 创建日志目录
  if (globalConfig.enableFile && globalConfig.logDir) {
    if (!fs.existsSync(globalConfig.logDir)) {
      fs.mkdirSync(globalConfig.logDir, { recursive: true });
    }
    cleanOldLogs();
  }
}

/**
 * 清理旧日志文件
 */
function cleanOldLogs() {
  try {
    if (!globalConfig.logDir || !fs.existsSync(globalConfig.logDir)) {
      return;
    }

    const files = fs
      .readdirSync(globalConfig.logDir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => ({
        name: f,
        path: path.join(globalConfig.logDir, f),
        time: fs.statSync(path.join(globalConfig.logDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    // 删除超过数量限制的文件
    if (files.length > globalConfig.maxFiles) {
      const filesToDelete = files.slice(globalConfig.maxFiles);
      filesToDelete.forEach((file) => {
        try {
          fs.unlinkSync(file.path);
        } catch (error) {
          logger.error(`Failed to delete log file: ${file.name}`, error);
        }
      });
    }
  } catch (error) {
    logger.error("Failed to clean old logs:", error);
  }
}

/**
 * 获取当前日志文件路径
 */
function getCurrentLogFile() {
  if (!globalConfig.logDir) {
    return null;
  }

  const date = new Date().toISOString().split("T")[0];
  const filename = `chainlesschain-${date}.log`;
  const filepath = path.join(globalConfig.logDir, filename);

  // 检查文件大小，如果超过限制则创建新文件
  if (fs.existsSync(filepath)) {
    const stats = fs.statSync(filepath);
    const fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB >= globalConfig.maxFileSize) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const newFilename = `chainlesschain-${timestamp}.log`;
      return path.join(globalConfig.logDir, newFilename);
    }
  }

  return filepath;
}

/**
 * 写入日志到文件
 */
function writeToFile(message) {
  if (!globalConfig.enableFile) {
    return;
  }

  try {
    const logFile = getCurrentLogFile();
    if (logFile) {
      fs.appendFileSync(logFile, message + "\n", "utf8");
    }
  } catch (error) {
    logger.error("Failed to write log file:", error);
  }
}

/**
 * Logger类
 */
class Logger {
  constructor(moduleName, options = {}) {
    this.moduleName = moduleName;
    this.level =
      options.level || globalConfig.level || process.env.LOG_LEVEL || "INFO";
    this.stats = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
      total: 0,
    };
  }

  /**
   * 格式化日志消息
   */
  formatMessage(level, args) {
    const timestamp = new Date().toISOString();

    // 提取消息和元数据
    let message = "";
    let meta = {};

    args.forEach((arg) => {
      if (typeof arg === "string") {
        message += (message ? " " : "") + arg;
      } else if (arg instanceof Error) {
        meta.error = {
          message: arg.message,
          stack: arg.stack,
          name: arg.name,
        };
      } else if (typeof arg === "object") {
        meta = { ...meta, ...arg };
      } else {
        message += (message ? " " : "") + String(arg);
      }
    });

    return {
      timestamp,
      level,
      module: this.moduleName,
      message,
      ...meta,
    };
  }

  /**
   * 格式化控制台输出
   */
  formatConsoleMessage(level, args) {
    const timestamp = new Date().toISOString();
    const color = LogColors[level] || "";
    const reset = LogColors.RESET;

    let output = `${color}[${timestamp}] [${level}] [${this.moduleName}]${reset}`;

    args.forEach((arg) => {
      if (typeof arg === "string") {
        output += " " + arg;
      } else if (arg instanceof Error) {
        output += "\n" + util.inspect(arg, { colors: true, depth: 3 });
      } else if (typeof arg === "object") {
        output += "\n" + util.inspect(arg, { colors: true, depth: 3 });
      } else {
        output += " " + String(arg);
      }
    });

    return output;
  }

  /**
   * 内部日志方法
   */
  _log(level, ...args) {
    // 检查日志级别
    if (logLevels[level] < logLevels[this.level]) {
      return;
    }

    // 更新统计
    const levelLower = level.toLowerCase();
    if (this.stats[levelLower] !== undefined) {
      this.stats[levelLower]++;
    }
    this.stats.total++;

    // 控制台输出
    if (globalConfig.enableConsole) {
      const consoleMsg = this.formatConsoleMessage(level, args);

      switch (level) {
        case "DEBUG":
          logger.debug(consoleMsg);
          break;
        case "INFO":
          logger.info(consoleMsg);
          break;
        case "WARN":
          logger.warn(consoleMsg);
          break;
        case "ERROR":
        case "FATAL":
          logger.error(consoleMsg);
          break;
        default:
          logger.info(consoleMsg);
      }
    }

    // 文件输出
    if (globalConfig.enableFile) {
      const logEntry = this.formatMessage(level, args);
      const logLine = JSON.stringify(logEntry);
      writeToFile(logLine);
    }
  }

  debug(...args) {
    this._log("DEBUG", ...args);
  }

  info(...args) {
    this._log("INFO", ...args);
  }

  warn(...args) {
    this._log("WARN", ...args);
  }

  error(...args) {
    this._log("ERROR", ...args);
  }

  fatal(...args) {
    this._log("FATAL", ...args);
  }

  /**
   * 创建子日志器
   */
  child(subModuleName) {
    return new Logger(`${this.moduleName}:${subModuleName}`, {
      level: this.level,
    });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
      total: 0,
    };
  }

  /**
   * 设置日志级别
   */
  setLevel(level) {
    this.level = level.toUpperCase();
  }
}

/**
 * 获取指定模块的 logger 实例
 * @param {string} moduleName - 模块名称
 * @returns {Logger} Logger 实例
 */
function getLogger(moduleName) {
  return new Logger(moduleName);
}

/**
 * 获取日志文件列表
 */
function getLogFiles() {
  try {
    if (!globalConfig.logDir || !fs.existsSync(globalConfig.logDir)) {
      return [];
    }

    return fs
      .readdirSync(globalConfig.logDir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => {
        const filePath = path.join(globalConfig.logDir, f);
        const stats = fs.statSync(filePath);
        return {
          name: f,
          path: filePath,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
        };
      })
      .sort((a, b) => b.modified.getTime() - a.modified.getTime());
  } catch (error) {
    logger.error("Failed to get log files:", error);
    return [];
  }
}

/**
 * 读取日志文件
 */
function readLogFile(filename, options = {}) {
  try {
    const filePath = path.join(globalConfig.logDir, filename);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Log file not found: ${filename}`);
    }

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((line) => line.trim());

    // 解析JSON日志
    const logs = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return { raw: line };
      }
    });

    // 过滤
    let filtered = logs;

    if (options.level) {
      filtered = filtered.filter((log) => log.level === options.level);
    }

    if (options.module) {
      filtered = filtered.filter(
        (log) => log.module && log.module.includes(options.module),
      );
    }

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      filtered = filtered.filter((log) =>
        JSON.stringify(log).toLowerCase().includes(searchLower),
      );
    }

    // 分页
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    return {
      total: filtered.length,
      logs: filtered.slice(offset, offset + limit),
    };
  } catch (error) {
    logger.error("Failed to read log file:", error);
    throw error;
  }
}

/**
 * 导出日志
 */
function exportLogs(outputPath, options = {}) {
  try {
    const logFiles = getLogFiles();
    const allLogs = [];

    // 读取所有日志文件
    for (const file of logFiles) {
      const content = fs.readFileSync(file.path, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());

      lines.forEach((line) => {
        try {
          allLogs.push(JSON.parse(line));
        } catch (error) {
          // 忽略解析错误
        }
      });
    }

    // 过滤
    let filtered = allLogs;

    if (options.startDate) {
      filtered = filtered.filter(
        (log) => new Date(log.timestamp) >= new Date(options.startDate),
      );
    }

    if (options.endDate) {
      filtered = filtered.filter(
        (log) => new Date(log.timestamp) <= new Date(options.endDate),
      );
    }

    if (options.level) {
      filtered = filtered.filter((log) => log.level === options.level);
    }

    // 导出
    const format = options.format || "json";

    if (format === "json") {
      fs.writeFileSync(outputPath, JSON.stringify(filtered, null, 2), "utf8");
    } else if (format === "txt") {
      const txt = filtered
        .map(
          (log) =>
            `[${log.timestamp}] [${log.level}] [${log.module}] ${log.message}`,
        )
        .join("\n");
      fs.writeFileSync(outputPath, txt, "utf8");
    }

    return {
      success: true,
      count: filtered.length,
      path: outputPath,
    };
  } catch (error) {
    logger.error("Failed to export logs:", error);
    throw error;
  }
}

module.exports = {
  getLogger,
  Logger,
  initLogger,
  getLogFiles,
  readLogFile,
  exportLogs,
  logLevels,
};
