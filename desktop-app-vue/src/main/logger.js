/**
 * 简单的日志模块
 * 提供统一的日志接口
 */

const logLevels = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class Logger {
  constructor(moduleName) {
    this.moduleName = moduleName;
    this.level = process.env.LOG_LEVEL || 'INFO';
  }

  _log(level, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${this.moduleName}]`;

    switch (level) {
      case 'DEBUG':
        if (logLevels[this.level] <= logLevels.DEBUG) {
          console.debug(prefix, ...args);
        }
        break;
      case 'INFO':
        if (logLevels[this.level] <= logLevels.INFO) {
          console.log(prefix, ...args);
        }
        break;
      case 'WARN':
        if (logLevels[this.level] <= logLevels.WARN) {
          console.warn(prefix, ...args);
        }
        break;
      case 'ERROR':
        if (logLevels[this.level] <= logLevels.ERROR) {
          console.error(prefix, ...args);
        }
        break;
      default:
        console.log(prefix, ...args);
    }
  }

  debug(...args) {
    this._log('DEBUG', ...args);
  }

  info(...args) {
    this._log('INFO', ...args);
  }

  warn(...args) {
    this._log('WARN', ...args);
  }

  error(...args) {
    this._log('ERROR', ...args);
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

module.exports = {
  getLogger,
  Logger
};
