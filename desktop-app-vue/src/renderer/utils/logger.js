/**
 * 渲染进程日志管理器
 * 通过IPC发送日志到主进程
 */

import {
  LOG_LEVELS,
  LOG_LEVEL_NAMES,
  DEFAULT_CONFIG,
  formatLogMessage,
  getStackTrace,
  sanitizeData,
} from '../../shared/logger-config.js';

class RendererLogger {
  constructor(module = 'renderer') {
    this.module = module;
    this.config = { ...DEFAULT_CONFIG };
    this.performanceMarks = new Map();
    this.ipcAvailable = typeof window !== 'undefined' && window.electronAPI;
  }

  /**
   * 写入日志
   */
  log(level, message, data = {}) {
    if (level < this.config.level) return;

    const sanitized = sanitizeData(data);
    const formatted = formatLogMessage(
      level,
      this.module,
      message,
      sanitized,
      this.config.timestamp
    );

    // 控制台输出
    if (this.config.console) {
      const consoleMethod = level >= LOG_LEVELS.ERROR ? 'error' :
                           level >= LOG_LEVELS.WARN ? 'warn' :
                           level >= LOG_LEVELS.INFO ? 'info' : 'log';
      console[consoleMethod](formatted);

      // ERROR及以上级别显示堆栈
      if (level >= LOG_LEVELS.ERROR && this.config.stackTrace) {
        console[consoleMethod](getStackTrace());
      }
    }

    // 通过IPC发送到主进程
    if (this.ipcAvailable && this.config.file) {
      try {
        window.electronAPI.invoke('logger:write', {
          level: LOG_LEVEL_NAMES[level],
          module: this.module,
          message,
          data: sanitized,
          timestamp: new Date().toISOString(),
          stack: level >= LOG_LEVELS.ERROR ? getStackTrace() : null,
        }).catch(err => {
          logger.error('发送日志到主进程失败:', err);
        });
      } catch (error) {
        logger.error('IPC日志发送失败:', error);
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
    if (!this.config.performance.enabled) return;
    this.performanceMarks.set(label, performance.now());
  }

  /**
   * 性能监控 - 结束
   */
  perfEnd(label, data = {}) {
    if (!this.config.performance.enabled) return;

    const startTime = this.performanceMarks.get(label);
    if (!startTime) {
      this.warn(`性能标记不存在: ${label}`);
      return;
    }

    const duration = performance.now() - startTime;
    this.performanceMarks.delete(label);

    const logData = { ...data, duration: `${duration.toFixed(2)}ms` };

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
    const childLogger = new RendererLogger(`${this.module}:${subModule}`);
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
   * 捕获未处理的错误
   */
  captureErrors() {
    if (typeof window === 'undefined') return;

    // 捕获未处理的Promise拒绝
    window.addEventListener('unhandledrejection', (event) => {
      this.error('未处理的Promise拒绝', {
        reason: event.reason,
        promise: event.promise,
      });
    });

    // 捕获全局错误
    window.addEventListener('error', (event) => {
      this.error('全局错误', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
      });
    });

    // Vue错误处理器（如果使用Vue）
    if (window.app && window.app.config) {
      window.app.config.errorHandler = (err, instance, info) => {
        this.error('Vue错误', {
          error: err.message,
          component: instance?.$options?.name,
          info,
        });
      };
    }
  }
}

// 导出单例
export const logger = new RendererLogger('renderer');

// 导出类用于创建子日志器
export { RendererLogger };

// 便捷方法
export const createLogger = (module) => new RendererLogger(module);

// 自动捕获错误
if (typeof window !== 'undefined') {
  logger.captureErrors();
}
