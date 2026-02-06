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

// ==================== 类型定义 ====================

/**
 * 日志级别
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

/**
 * 日志级别数值
 */
export type LogLevelValue = 0 | 1 | 2 | 3 | 4;

/**
 * 日志配置
 */
export interface LoggerConfig {
  level: LogLevelValue;
  console: boolean;
  file: boolean;
  fileConfig: {
    maxSize: number;
    maxFiles: number;
    compress: boolean;
  };
  stackTrace: boolean;
  timestamp: boolean;
  module: boolean;
  performance: {
    enabled: boolean;
    slowThreshold: number;
  };
}

/**
 * 日志数据
 */
export type LogData = any;

/**
 * 日志条目
 */
export interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  data: LogData;
  timestamp: string;
  stack: string | null;
}

// ==================== 日志类 ====================

/**
 * 渲染进程日志器
 */
class RendererLogger {
  private module: string;
  private config: LoggerConfig;
  private performanceMarks: Map<string, number>;
  private ipcAvailable: boolean;

  constructor(module: string = 'renderer') {
    this.module = module;
    this.config = { ...DEFAULT_CONFIG } as LoggerConfig;
    this.performanceMarks = new Map();
    this.ipcAvailable = typeof window !== 'undefined' && !!(window as any).electronAPI;
  }

  /**
   * 写入日志
   */
  log(level: LogLevelValue, message: string, data: LogData = {}): void {
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
        (window as any).electronAPI.invoke('logger:write', {
          level: LOG_LEVEL_NAMES[level],
          module: this.module,
          message,
          data: sanitized,
          timestamp: new Date().toISOString(),
          stack: level >= LOG_LEVELS.ERROR ? getStackTrace() : null,
        } as LogEntry).catch((err: Error) => {
          console.error('发送日志到主进程失败:', err);
        });
      } catch (error) {
        console.error('IPC日志发送失败:', error);
      }
    }
  }

  /**
   * DEBUG级别日志
   */
  debug(message: string, data?: LogData): void {
    this.log(LOG_LEVELS.DEBUG, message, data);
  }

  /**
   * INFO级别日志
   */
  info(message: string, data?: LogData): void {
    this.log(LOG_LEVELS.INFO, message, data);
  }

  /**
   * WARN级别日志
   */
  warn(message: string, data?: LogData): void {
    this.log(LOG_LEVELS.WARN, message, data);
  }

  /**
   * ERROR级别日志
   */
  error(message: string, data?: LogData): void {
    this.log(LOG_LEVELS.ERROR, message, data);
  }

  /**
   * FATAL级别日志
   */
  fatal(message: string, data?: LogData): void {
    this.log(LOG_LEVELS.FATAL, message, data);
  }

  /**
   * 性能监控 - 开始
   */
  perfStart(label: string): void {
    if (!this.config.performance.enabled) return;
    this.performanceMarks.set(label, performance.now());
  }

  /**
   * 性能监控 - 结束
   */
  perfEnd(label: string, data: LogData = {}): number | undefined {
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
  child(subModule: string): RendererLogger {
    const childLogger = new RendererLogger(`${this.module}:${subModule}`);
    childLogger.config = this.config;
    return childLogger;
  }

  /**
   * 更新配置
   */
  setConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 捕获未处理的错误
   */
  captureErrors(): void {
    if (typeof window === 'undefined') return;

    // 捕获未处理的Promise拒绝
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      this.error('未处理的Promise拒绝', {
        reason: event.reason,
        promise: event.promise,
      });
    });

    // 捕获全局错误
    window.addEventListener('error', (event: ErrorEvent) => {
      this.error('全局错误', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
      });
    });

    // Vue错误处理器（如果使用Vue）
    const app = (window as any).app;
    if (app && app.config) {
      app.config.errorHandler = (err: Error, instance: any, info: string) => {
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
export const createLogger = (module: string): RendererLogger => new RendererLogger(module);

// 自动捕获错误
if (typeof window !== 'undefined') {
  logger.captureErrors();
}
