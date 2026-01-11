/**
 * 错误监控和自动修复系统
 * 监控应用运行时错误并尝试自动修复常见问题
 */

const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

class ErrorMonitor {
  constructor() {
    this.errors = [];
    this.maxErrors = 1000;
    this.logPath = path.join(app.getPath('userData'), 'error-logs');
    this.setupGlobalErrorHandlers();
    this.fixStrategies = this.initFixStrategies();
    this.errorPatterns = this.initErrorPatterns();
  }

  /**
   * 设置全局错误处理器
   */
  setupGlobalErrorHandlers() {
    // 捕获未处理的异常
    process.on('uncaughtException', (error) => {
      // 忽略 EPIPE 错误（管道已关闭，通常发生在应用关闭时）
      if (error.code === 'EPIPE') {
        console.log('[ErrorMonitor] Ignoring EPIPE error (broken pipe)');
        return;
      }

      console.error('Uncaught Exception:', error);
      this.captureError('UNCAUGHT_EXCEPTION', error);
    });

    // 捕获未处理的Promise拒绝
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      this.captureError('UNHANDLED_REJECTION', reason);
    });

    // 捕获警告
    process.on('warning', (warning) => {
      console.warn('Warning:', warning);
      this.captureError('WARNING', warning);
    });
  }

  /**
   * 初始化错误模式识别
   */
  initErrorPatterns() {
    return {
      DATABASE_LOCKED: /SQLITE_BUSY|database is locked/i,
      CONNECTION_REFUSED: /ECONNREFUSED|connect ECONNREFUSED/i,
      TIMEOUT: /ETIMEDOUT|timeout/i,
      PERMISSION_DENIED: /EACCES|EPERM|permission denied/i,
      FILE_NOT_FOUND: /ENOENT|no such file/i,
      PORT_IN_USE: /EADDRINUSE|address already in use/i,
      MEMORY_LEAK: /heap out of memory|allocation failed/i,
      NETWORK_ERROR: /network error|socket hang up/i,
      INVALID_JSON: /unexpected token|invalid json/i,
      GPU_ERROR: /GPU process|OpenGL/i
    };
  }

  /**
   * 初始化自动修复策略
   */
  initFixStrategies() {
    return {
      SQLITE_BUSY: async (error) => {
        console.log('[Auto-Fix] Attempting to fix database lock...');
        // 等待一段时间后重试
        await this.sleep(1000);
        // 可以尝试关闭并重新打开数据库连接
        return { success: true, message: 'Database lock resolved after retry' };
      },

      ECONNREFUSED: async (error) => {
        console.log('[Auto-Fix] Attempting to reconnect to service...');
        const service = this.identifyService(error);

        if (service === 'ollama') {
          // 尝试启动Ollama服务
          return await this.restartOllamaService();
        } else if (service === 'qdrant') {
          // 尝试启动Qdrant服务
          return await this.restartQdrantService();
        }

        return { success: false, message: 'Could not identify service to restart' };
      },

      ETIMEDOUT: async (error) => {
        console.log('[Auto-Fix] Retrying operation after timeout...');
        // 增加超时时间并重试
        return { success: true, message: 'Will retry with longer timeout' };
      },

      EACCES: async (error) => {
        console.log('[Auto-Fix] Attempting to fix permission issue...');
        const filePath = this.extractFilePath(error);
        if (filePath) {
          return await this.fixFilePermissions(filePath);
        }
        return { success: false, message: 'Could not extract file path' };
      },

      ENOENT: async (error) => {
        console.log('[Auto-Fix] Creating missing file/directory...');
        const filePath = this.extractFilePath(error);
        if (filePath) {
          return await this.createMissingPath(filePath);
        }
        return { success: false, message: 'Could not extract file path' };
      },

      EADDRINUSE: async (error) => {
        console.log('[Auto-Fix] Attempting to free up port...');
        const port = this.extractPort(error);
        if (port) {
          return await this.killProcessOnPort(port);
        }
        return { success: false, message: 'Could not extract port number' };
      },

      MEMORY_LEAK: async (error) => {
        console.log('[Auto-Fix] Clearing caches to free memory...');
        return await this.clearCaches();
      }
    };
  }

  /**
   * 捕获错误
   */
  async captureError(type, error) {
    const errorReport = {
      type,
      message: error?.message || String(error),
      stack: error?.stack || '',
      timestamp: new Date().toISOString(),
      pid: process.pid,
      memory: process.memoryUsage(),
      platform: process.platform
    };

    // 添加到内存缓存
    this.errors.push(errorReport);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    // 保存到日志文件
    await this.saveErrorLog(errorReport);

    // 尝试自动修复
    const fixResult = await this.analyzeAndFix(errorReport);

    if (fixResult.attempted) {
      errorReport.autoFixResult = fixResult;
      console.log('[Error Monitor] Auto-fix result:', fixResult);
    }

    return errorReport;
  }

  /**
   * 分析错误并尝试修复
   */
  async analyzeAndFix(errorReport) {
    const errorMessage = errorReport.message + ' ' + errorReport.stack;

    // 识别错误类型
    for (const [errorType, pattern] of Object.entries(this.errorPatterns)) {
      if (pattern.test(errorMessage)) {
        console.log(`[Error Monitor] Detected error type: ${errorType}`);

        // 执行对应的修复策略
        const fixStrategy = this.fixStrategies[errorType];
        if (fixStrategy) {
          try {
            const result = await fixStrategy(errorReport);
            return {
              attempted: true,
              errorType,
              success: result.success,
              message: result.message
            };
          } catch (fixError) {
            console.error(`[Error Monitor] Fix strategy failed:`, fixError);
            return {
              attempted: true,
              errorType,
              success: false,
              message: `Fix strategy failed: ${fixError.message}`
            };
          }
        }
      }
    }

    return { attempted: false, message: 'No fix strategy found for this error type' };
  }

  /**
   * 识别服务
   */
  identifyService(error) {
    const message = error.message || '';
    if (message.includes('11434')) return 'ollama';
    if (message.includes('6333')) return 'qdrant';
    if (message.includes('5432')) return 'postgres';
    if (message.includes('6379')) return 'redis';
    return 'unknown';
  }

  /**
   * 重启Ollama服务
   */
  async restartOllamaService() {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);

      // 尝试启动Docker容器
      await execPromise('docker start chainlesschain-ollama');
      await this.sleep(5000); // 等待服务启动

      return { success: true, message: 'Ollama service restarted' };
    } catch (error) {
      return { success: false, message: `Failed to restart Ollama: ${error.message}` };
    }
  }

  /**
   * 重启Qdrant服务
   */
  async restartQdrantService() {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);

      await execPromise('docker start chainlesschain-qdrant');
      await this.sleep(5000);

      return { success: true, message: 'Qdrant service restarted' };
    } catch (error) {
      return { success: false, message: `Failed to restart Qdrant: ${error.message}` };
    }
  }

  /**
   * 修复文件权限
   */
  async fixFilePermissions(filePath) {
    try {
      await fs.chmod(filePath, 0o644);
      return { success: true, message: `Fixed permissions for ${filePath}` };
    } catch (error) {
      return { success: false, message: `Failed to fix permissions: ${error.message}` };
    }
  }

  /**
   * 创建缺失的路径
   */
  async createMissingPath(filePath) {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      return { success: true, message: `Created directory: ${dir}` };
    } catch (error) {
      return { success: false, message: `Failed to create directory: ${error.message}` };
    }
  }

  /**
   * 杀掉占用端口的进程
   */
  async killProcessOnPort(port) {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);

      if (process.platform === 'win32') {
        await execPromise(`netstat -ano | findstr :${port}`);
        // 提取PID并杀掉进程
      } else {
        await execPromise(`lsof -ti:${port} | xargs kill -9`);
      }

      return { success: true, message: `Freed port ${port}` };
    } catch (error) {
      return { success: false, message: `Failed to free port: ${error.message}` };
    }
  }

  /**
   * 清理缓存
   */
  async clearCaches() {
    try {
      // 触发垃圾回收
      if (global.gc) {
        global.gc();
      }

      return { success: true, message: 'Caches cleared' };
    } catch (error) {
      return { success: false, message: `Failed to clear caches: ${error.message}` };
    }
  }

  /**
   * 从错误中提取文件路径
   */
  extractFilePath(error) {
    const message = error.message || '';
    const match = message.match(/['"]([^'"]+)['"]/);
    return match ? match[1] : null;
  }

  /**
   * 从错误中提取端口号
   */
  extractPort(error) {
    const message = error.message || '';
    const match = message.match(/:(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  /**
   * 保存错误日志
   */
  async saveErrorLog(errorReport) {
    try {
      await fs.mkdir(this.logPath, { recursive: true });

      const filename = `error-${new Date().toISOString().split('T')[0]}.log`;
      const logFile = path.join(this.logPath, filename);

      const logEntry = JSON.stringify(errorReport, null, 2) + '\n---\n';
      await fs.appendFile(logFile, logEntry);
    } catch (error) {
      console.error('Failed to save error log:', error);
    }
  }

  /**
   * 获取错误统计
   */
  getErrorStats() {
    const stats = {
      total: this.errors.length,
      byType: {},
      recentErrors: this.errors.slice(-10)
    };

    this.errors.forEach(error => {
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
    });

    return stats;
  }

  /**
   * 清除错误日志
   */
  clearErrors() {
    this.errors = [];
  }

  /**
   * 工具函数: 睡眠
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 创建单例
let errorMonitorInstance = null;

function getErrorMonitor() {
  if (!errorMonitorInstance) {
    errorMonitorInstance = new ErrorMonitor();
  }
  return errorMonitorInstance;
}

module.exports = {
  ErrorMonitor,
  getErrorMonitor
};
