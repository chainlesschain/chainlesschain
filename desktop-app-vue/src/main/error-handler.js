/**
 * 全局错误处理系统
 *
 * 功能：
 * - 全局错误捕获（未捕获异常、Promise拒绝）
 * - 错误分类和优先级
 * - 错误恢复策略
 * - 用户友好的错误提示
 * - 错误报告和统计
 * - 崩溃报告
 */

const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { getLogger } = require('./logger');

const logger = getLogger('ErrorHandler');

// 错误类型
const ErrorType = {
  FATAL: 'FATAL',           // 致命错误，需要重启
  CRITICAL: 'CRITICAL',     // 严重错误，影响核心功能
  ERROR: 'ERROR',           // 一般错误，影响部分功能
  WARNING: 'WARNING',       // 警告，不影响功能
  RECOVERABLE: 'RECOVERABLE' // 可恢复错误
};

// 错误分类
const ErrorCategory = {
  DATABASE: 'DATABASE',
  NETWORK: 'NETWORK',
  FILE_SYSTEM: 'FILE_SYSTEM',
  UKEY: 'UKEY',
  LLM: 'LLM',
  P2P: 'P2P',
  PLUGIN: 'PLUGIN',
  UNKNOWN: 'UNKNOWN'
};

/**
 * 错误处理器类
 */
class ErrorHandler {
  constructor(options = {}) {
    this.options = {
      // 是否显示错误对话框
      showDialog: options.showDialog !== false,

      // 是否自动重启（致命错误）
      autoRestart: options.autoRestart !== false,

      // 错误报告目录
      reportDir: options.reportDir || path.join(app.getPath('userData'), 'crash-reports'),

      // 最大错误报告数量
      maxReports: options.maxReports || 50,

      // 错误恢复回调
      onError: options.onError || null,

      // 是否在开发模式
      isDev: options.isDev || process.env.NODE_ENV === 'development'
    };

    // 错误统计
    this.stats = {
      total: 0,
      byType: {},
      byCategory: {},
      recent: []
    };

    // 错误恢复策略
    this.recoveryStrategies = new Map();

    // 初始化
    this.initialize();
  }

  /**
   * 初始化错误处理器
   */
  initialize() {
    // 创建报告目录
    if (!fs.existsSync(this.options.reportDir)) {
      fs.mkdirSync(this.options.reportDir, { recursive: true });
    }

    // 注册全局错误处理
    this.registerGlobalHandlers();

    // 注册默认恢复策略
    this.registerDefaultRecoveryStrategies();

    // 清理旧报告
    this.cleanOldReports();

    logger.info('Error handler initialized', {
      reportDir: this.options.reportDir,
      showDialog: this.options.showDialog,
      autoRestart: this.options.autoRestart
    });
  }

  /**
   * 注册全局错误处理器
   */
  registerGlobalHandlers() {
    // 未捕获的异常
    process.on('uncaughtException', (error) => {
      logger.fatal('Uncaught exception', error);
      this.handleError(error, {
        type: ErrorType.FATAL,
        category: ErrorCategory.UNKNOWN,
        source: 'uncaughtException'
      });
    });

    // 未处理的Promise拒绝
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection', {
        reason: reason instanceof Error ? reason.message : reason,
        stack: reason instanceof Error ? reason.stack : undefined
      });

      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.handleError(error, {
        type: ErrorType.CRITICAL,
        category: ErrorCategory.UNKNOWN,
        source: 'unhandledRejection'
      });
    });

    // 警告
    process.on('warning', (warning) => {
      logger.warn('Process warning', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
      });
    });

    logger.info('Global error handlers registered');
  }

  /**
   * 注册默认恢复策略
   */
  registerDefaultRecoveryStrategies() {
    // 数据库错误恢复
    this.registerRecoveryStrategy(ErrorCategory.DATABASE, async (error, context) => {
      logger.info('Attempting database error recovery');

      // 尝试重新连接
      if (context.db && typeof context.db.reconnect === 'function') {
        try {
          await context.db.reconnect();
          logger.info('Database reconnected successfully');
          return { success: true, message: '数据库已重新连接' };
        } catch (reconnectError) {
          logger.error('Database reconnection failed', reconnectError);
          return { success: false, message: '数据库重连失败' };
        }
      }

      return { success: false, message: '无法恢复数据库连接' };
    });

    // 网络错误恢复
    this.registerRecoveryStrategy(ErrorCategory.NETWORK, async (error, context) => {
      logger.info('Attempting network error recovery');

      // 等待一段时间后重试
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (context.retry && typeof context.retry === 'function') {
        try {
          await context.retry();
          logger.info('Network operation retried successfully');
          return { success: true, message: '网络操作已重试' };
        } catch (retryError) {
          logger.error('Network retry failed', retryError);
          return { success: false, message: '网络重试失败' };
        }
      }

      return { success: false, message: '无法恢复网络连接' };
    });

    // 文件系统错误恢复
    this.registerRecoveryStrategy(ErrorCategory.FILE_SYSTEM, async (error, context) => {
      logger.info('Attempting file system error recovery');

      // 检查磁盘空间
      if (error.code === 'ENOSPC') {
        return {
          success: false,
          message: '磁盘空间不足，请清理磁盘后重试',
          userAction: 'CLEAN_DISK'
        };
      }

      // 检查权限
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        return {
          success: false,
          message: '文件权限不足，请检查文件权限',
          userAction: 'CHECK_PERMISSIONS'
        };
      }

      return { success: false, message: '文件系统错误无法自动恢复' };
    });
  }

  /**
   * 注册错误恢复策略
   */
  registerRecoveryStrategy(category, strategy) {
    this.recoveryStrategies.set(category, strategy);
    logger.debug(`Recovery strategy registered for ${category}`);
  }

  /**
   * 处理错误
   */
  async handleError(error, options = {}) {
    const {
      type = ErrorType.ERROR,
      category = ErrorCategory.UNKNOWN,
      source = 'unknown',
      context = {},
      showDialog = this.options.showDialog,
      attemptRecovery = true
    } = options;

    // 更新统计
    this.updateStats(type, category, error);

    // 记录错误
    logger.error(`Error handled: ${type} - ${category}`, {
      message: error.message,
      stack: error.stack,
      source,
      context
    });

    // 生成错误报告
    const report = this.generateErrorReport(error, {
      type,
      category,
      source,
      context
    });

    // 保存错误报告
    this.saveErrorReport(report);

    // 尝试恢复
    let recoveryResult = null;
    if (attemptRecovery && this.recoveryStrategies.has(category)) {
      try {
        const strategy = this.recoveryStrategies.get(category);
        recoveryResult = await strategy(error, context);
        logger.info('Recovery attempt result', recoveryResult);
      } catch (recoveryError) {
        logger.error('Recovery strategy failed', recoveryError);
      }
    }

    // 显示用户提示
    if (showDialog) {
      this.showErrorDialog(error, {
        type,
        category,
        recoveryResult
      });
    }

    // 调用错误回调
    if (this.options.onError) {
      try {
        this.options.onError(error, {
          type,
          category,
          source,
          context,
          recoveryResult
        });
      } catch (callbackError) {
        logger.error('Error callback failed', callbackError);
      }
    }

    // 致命错误处理
    if (type === ErrorType.FATAL) {
      this.handleFatalError(error, report);
    }

    return {
      handled: true,
      recoveryResult,
      report
    };
  }

  /**
   * 处理致命错误
   */
  handleFatalError(error, report) {
    logger.fatal('Fatal error occurred, application will exit', {
      error: error.message,
      reportId: report.id
    });

    // 显示致命错误对话框
    if (this.options.showDialog) {
      dialog.showErrorBox(
        '应用程序遇到致命错误',
        `应用程序遇到无法恢复的错误，将自动退出。\n\n错误信息：${error.message}\n\n错误报告已保存到：${this.options.reportDir}`
      );
    }

    // 自动重启或退出
    if (this.options.autoRestart) {
      app.relaunch();
    }

    app.exit(1);
  }

  /**
   * 显示错误对话框
   */
  showErrorDialog(error, options = {}) {
    const { type, category, recoveryResult } = options;

    let title = '错误';
    let message = error.message || '发生了一个未知错误';

    // 根据错误类型设置标题
    switch (type) {
      case ErrorType.FATAL:
        title = '致命错误';
        break;
      case ErrorType.CRITICAL:
        title = '严重错误';
        break;
      case ErrorType.ERROR:
        title = '错误';
        break;
      case ErrorType.WARNING:
        title = '警告';
        break;
    }

    // 添加分类信息
    const categoryText = this.getCategoryText(category);
    if (categoryText) {
      message = `${categoryText}\n\n${message}`;
    }

    // 添加恢复结果
    if (recoveryResult) {
      if (recoveryResult.success) {
        message += `\n\n✓ ${recoveryResult.message}`;
      } else {
        message += `\n\n✗ ${recoveryResult.message}`;
      }
    }

    // 在开发模式下添加堆栈信息
    if (this.options.isDev && error.stack) {
      message += `\n\n堆栈跟踪：\n${error.stack}`;
    }

    dialog.showMessageBox({
      type: type === ErrorType.FATAL || type === ErrorType.CRITICAL ? 'error' : 'warning',
      title,
      message,
      buttons: ['确定'],
      defaultId: 0
    });
  }

  /**
   * 获取分类文本
   */
  getCategoryText(category) {
    const texts = {
      [ErrorCategory.DATABASE]: '数据库错误',
      [ErrorCategory.NETWORK]: '网络错误',
      [ErrorCategory.FILE_SYSTEM]: '文件系统错误',
      [ErrorCategory.UKEY]: 'U-Key错误',
      [ErrorCategory.LLM]: 'AI模型错误',
      [ErrorCategory.P2P]: 'P2P网络错误',
      [ErrorCategory.PLUGIN]: '插件错误'
    };

    return texts[category] || '';
  }

  /**
   * 生成错误报告
   */
  generateErrorReport(error, options = {}) {
    const { type, category, source, context } = options;

    const report = {
      id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type,
      category,
      source,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      },
      context,
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        appVersion: app.getVersion(),
        memory: process.memoryUsage(),
        uptime: process.uptime()
      }
    };

    return report;
  }

  /**
   * 保存错误报告
   */
  saveErrorReport(report) {
    try {
      const filename = `${report.id}.json`;
      const filepath = path.join(this.options.reportDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf8');

      logger.info('Error report saved', {
        reportId: report.id,
        filepath
      });
    } catch (saveError) {
      logger.error('Failed to save error report', saveError);
    }
  }

  /**
   * 更新统计信息
   */
  updateStats(type, category, error) {
    this.stats.total++;

    // 按类型统计
    if (!this.stats.byType[type]) {
      this.stats.byType[type] = 0;
    }
    this.stats.byType[type]++;

    // 按分类统计
    if (!this.stats.byCategory[category]) {
      this.stats.byCategory[category] = 0;
    }
    this.stats.byCategory[category]++;

    // 最近错误
    this.stats.recent.unshift({
      timestamp: new Date().toISOString(),
      type,
      category,
      message: error.message
    });

    // 限制最近错误数量
    if (this.stats.recent.length > 100) {
      this.stats.recent = this.stats.recent.slice(0, 100);
    }
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
      total: 0,
      byType: {},
      byCategory: {},
      recent: []
    };
  }

  /**
   * 获取错误报告列表
   */
  getErrorReports() {
    try {
      if (!fs.existsSync(this.options.reportDir)) {
        return [];
      }

      return fs.readdirSync(this.options.reportDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const filepath = path.join(this.options.reportDir, f);
          const stats = fs.statSync(filepath);
          return {
            filename: f,
            path: filepath,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime
          };
        })
        .sort((a, b) => b.modified.getTime() - a.modified.getTime());
    } catch (error) {
      logger.error('Failed to get error reports', error);
      return [];
    }
  }

  /**
   * 读取错误报告
   */
  readErrorReport(filename) {
    try {
      const filepath = path.join(this.options.reportDir, filename);

      if (!fs.existsSync(filepath)) {
        throw new Error(`Error report not found: ${filename}`);
      }

      const content = fs.readFileSync(filepath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      logger.error('Failed to read error report', error);
      throw error;
    }
  }

  /**
   * 清理旧报告
   */
  cleanOldReports() {
    try {
      const reports = this.getErrorReports();

      if (reports.length > this.options.maxReports) {
        const reportsToDelete = reports.slice(this.options.maxReports);

        reportsToDelete.forEach(report => {
          try {
            fs.unlinkSync(report.path);
            logger.debug(`Deleted old error report: ${report.filename}`);
          } catch (error) {
            logger.error(`Failed to delete error report: ${report.filename}`, error);
          }
        });

        logger.info(`Cleaned ${reportsToDelete.length} old error reports`);
      }
    } catch (error) {
      logger.error('Failed to clean old reports', error);
    }
  }

  /**
   * 导出错误报告
   */
  exportErrorReports(outputPath, options = {}) {
    try {
      const reports = this.getErrorReports();
      const allReports = [];

      // 读取所有报告
      for (const report of reports) {
        try {
          const content = this.readErrorReport(report.filename);
          allReports.push(content);
        } catch (error) {
          logger.error(`Failed to read report: ${report.filename}`, error);
        }
      }

      // 过滤
      let filtered = allReports;

      if (options.startDate) {
        filtered = filtered.filter(r =>
          new Date(r.timestamp) >= new Date(options.startDate)
        );
      }

      if (options.endDate) {
        filtered = filtered.filter(r =>
          new Date(r.timestamp) <= new Date(options.endDate)
        );
      }

      if (options.type) {
        filtered = filtered.filter(r => r.type === options.type);
      }

      if (options.category) {
        filtered = filtered.filter(r => r.category === options.category);
      }

      // 导出
      fs.writeFileSync(outputPath, JSON.stringify(filtered, null, 2), 'utf8');

      logger.info('Error reports exported', {
        outputPath,
        count: filtered.length
      });

      return {
        success: true,
        count: filtered.length,
        path: outputPath
      };
    } catch (error) {
      logger.error('Failed to export error reports', error);
      throw error;
    }
  }
}

// 全局错误处理器实例
let globalErrorHandler = null;

/**
 * 获取全局错误处理器
 */
function getErrorHandler() {
  if (!globalErrorHandler) {
    globalErrorHandler = new ErrorHandler();
  }
  return globalErrorHandler;
}

/**
 * 初始化错误处理器
 */
function initErrorHandler(options = {}) {
  globalErrorHandler = new ErrorHandler(options);
  return globalErrorHandler;
}

/**
 * 便捷方法：处理错误
 */
function handleError(error, options = {}) {
  const handler = getErrorHandler();
  return handler.handleError(error, options);
}

module.exports = {
  ErrorHandler,
  ErrorType,
  ErrorCategory,
  getErrorHandler,
  initErrorHandler,
  handleError
};
