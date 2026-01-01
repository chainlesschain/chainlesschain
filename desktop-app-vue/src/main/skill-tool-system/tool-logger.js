/**
 * 工具日志记录器
 * 提供结构化的日志记录和错误追踪功能
 */

const fs = require('fs').promises;
const path = require('path');

class ToolLogger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || process.env.LOG_LEVEL || 'info';
    this.logDir = options.logDir || path.join(process.cwd(), 'logs');
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;
    this.context = options.context || 'ToolSystem';

    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };

    this.currentLevel = this.levels[this.logLevel] || this.levels.info;

    // 确保日志目录存在
    if (this.enableFile) {
      this._ensureLogDir();
    }
  }

  /**
   * 确保日志目录存在
   */
  async _ensureLogDir() {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      console.error('[ToolLogger] 创建日志目录失败:', error);
    }
  }

  /**
   * 格式化日志消息
   */
  _formatMessage(level, message, data = null, error = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      context: this.context,
      message,
      ...(data && { data }),
      ...(error && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: error.code
        }
      })
    };

    return logEntry;
  }

  /**
   * 写入日志
   */
  async _writeLog(level, message, data = null, error = null) {
    const levelValue = this.levels[level];

    // 检查日志级别
    if (levelValue > this.currentLevel) {
      return;
    }

    const logEntry = this._formatMessage(level, message, data, error);

    // 控制台输出
    if (this.enableConsole) {
      this._consoleOutput(level, logEntry);
    }

    // 文件输出
    if (this.enableFile) {
      await this._fileOutput(logEntry);
    }

    return logEntry;
  }

  /**
   * 控制台输出
   */
  _consoleOutput(level, logEntry) {
    const { timestamp, context, message, data, error } = logEntry;
    const timeStr = timestamp.substring(11, 23); // HH:MM:SS.mmm
    const prefix = `[${timeStr}] [${context}] [${level.toUpperCase()}]`;

    let output = `${prefix} ${message}`;

    if (data) {
      output += `\n  Data: ${JSON.stringify(data, null, 2)}`;
    }

    if (error) {
      output += `\n  Error: ${error.message}`;
      if (error.stack) {
        output += `\n${error.stack.split('\n').map(line => '    ' + line).join('\n')}`;
      }
    }

    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  /**
   * 文件输出
   */
  async _fileOutput(logEntry) {
    try {
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const logFile = path.join(this.logDir, `tool-system-${date}.log`);

      const logLine = JSON.stringify(logEntry) + '\n';
      await fs.appendFile(logFile, logLine, 'utf-8');
    } catch (error) {
      console.error('[ToolLogger] 写入日志文件失败:', error);
    }
  }

  /**
   * 记录错误
   */
  async error(message, error = null, data = null) {
    return await this._writeLog('error', message, data, error);
  }

  /**
   * 记录警告
   */
  async warn(message, data = null) {
    return await this._writeLog('warn', message, data);
  }

  /**
   * 记录信息
   */
  async info(message, data = null) {
    return await this._writeLog('info', message, data);
  }

  /**
   * 记录调试信息
   */
  async debug(message, data = null) {
    return await this._writeLog('debug', message, data);
  }

  /**
   * 记录追踪信息
   */
  async trace(message, data = null) {
    return await this._writeLog('trace', message, data);
  }

  /**
   * 记录工具调用
   */
  async logToolCall(toolName, params, startTime) {
    return await this.info(`工具调用: ${toolName}`, {
      tool: toolName,
      params: this._sanitizeParams(params),
      startTime
    });
  }

  /**
   * 记录工具成功
   */
  async logToolSuccess(toolName, result, duration) {
    return await this.info(`工具执行成功: ${toolName}`, {
      tool: toolName,
      duration: `${duration}ms`,
      resultSize: JSON.stringify(result).length
    });
  }

  /**
   * 记录工具失败
   */
  async logToolFailure(toolName, error, duration, params) {
    return await this.error(`工具执行失败: ${toolName}`, error, {
      tool: toolName,
      duration: `${duration}ms`,
      params: this._sanitizeParams(params)
    });
  }

  /**
   * 清理敏感参数（用于日志记录）
   */
  _sanitizeParams(params) {
    if (!params || typeof params !== 'object') {
      return params;
    }

    const sensitiveKeys = ['password', 'apiKey', 'apiSecret', 'token', 'accessToken', 'credentials'];
    const sanitized = { ...params };

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
        sanitized[key] = '***REDACTED***';
      }
    }

    return sanitized;
  }

  /**
   * 创建子logger（带有特定上下文）
   */
  child(context) {
    return new ToolLogger({
      logLevel: this.logLevel,
      logDir: this.logDir,
      enableConsole: this.enableConsole,
      enableFile: this.enableFile,
      context: `${this.context}:${context}`
    });
  }
}

module.exports = ToolLogger;
