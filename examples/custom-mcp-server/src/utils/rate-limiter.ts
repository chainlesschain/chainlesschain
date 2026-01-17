/**
 * API 速率限制器
 *
 * 使用 bottleneck 实现 API 调用速率限制，防止超出配额
 */

import Bottleneck from "bottleneck";
import { logger } from "./logger.js";

/**
 * 速率限制配置选项
 */
export interface RateLimiterOptions {
  /** 每个时间窗口最大请求数 */
  maxConcurrent: number;
  /** 最小间隔时间（毫秒） */
  minTime: number;
  /** 每分钟最大请求数 */
  reservoir: number;
  /** 时间窗口刷新间隔（毫秒），默认 60000（1分钟） */
  reservoirRefreshInterval: number;
  /** 刷新时补充的请求数 */
  reservoirRefreshAmount: number;
  /** 高优先级请求数（用于优先处理） */
  highWater: number;
  /** 策略：阻塞 | 泄漏 | 溢出 */
  strategy: Bottleneck.Strategy;
  /** 队列超时时间（毫秒），0 表示不超时 */
  timeout: number;
}

/**
 * 速率限制统计信息
 */
export interface RateLimiterStats {
  /** 执行中的请求数 */
  running: number;
  /** 等待中的请求数 */
  queued: number;
  /** 已完成的请求总数 */
  done: number;
  /** 被拒绝的请求数（超时或被取消） */
  rejected: number;
  /** 剩余配额 */
  reservoir: number | null;
  /** 是否正在限流 */
  isRateLimited: boolean;
}

/**
 * 作业结果包装
 */
export interface JobResult<T> {
  /** 执行结果 */
  data: T;
  /** 执行时间（毫秒） */
  duration: number;
  /** 是否被限流等待 */
  wasQueued: boolean;
  /** 等待时间（毫秒） */
  waitTime: number;
}

/**
 * 默认速率限制配置
 *
 * 适用于大多数天气 API：
 * - 每分钟 60 次请求
 * - 最多 5 个并发请求
 * - 每次请求间隔至少 100ms
 */
const DEFAULT_RATE_LIMITER_OPTIONS: RateLimiterOptions = {
  maxConcurrent: 5,
  minTime: 100,
  reservoir: 60,
  reservoirRefreshInterval: 60000,
  reservoirRefreshAmount: 60,
  highWater: 10,
  strategy: Bottleneck.strategy.LEAK,
  timeout: 30000,
};

/**
 * 天气 API 速率限制器
 *
 * 提供统一的速率限制接口，支持：
 * - 并发控制
 * - 请求队列
 * - 自动重试
 * - 统计信息
 */
class WeatherRateLimiter {
  private limiter: Bottleneck;
  private doneCount: number = 0;
  private rejectedCount: number = 0;
  private options: RateLimiterOptions;

  constructor(options: Partial<RateLimiterOptions> = {}) {
    this.options = { ...DEFAULT_RATE_LIMITER_OPTIONS, ...options };

    this.limiter = new Bottleneck({
      maxConcurrent: this.options.maxConcurrent,
      minTime: this.options.minTime,
      reservoir: this.options.reservoir,
      reservoirRefreshInterval: this.options.reservoirRefreshInterval,
      reservoirRefreshAmount: this.options.reservoirRefreshAmount,
      highWater: this.options.highWater,
      strategy: this.options.strategy,
    });

    // 监听事件
    this.limiter.on("executing", (info) => {
      logger.debug(`Rate limiter: executing job`, {
        args: info.args,
        retryCount: info.retryCount,
      });
    });

    this.limiter.on("done", (info) => {
      this.doneCount++;
      logger.debug(`Rate limiter: job done`, {
        args: info.args,
        retryCount: info.retryCount,
      });
    });

    this.limiter.on("error", (error) => {
      this.rejectedCount++;
      logger.error(`Rate limiter: job error`, { error: error.message });
    });

    this.limiter.on("depleted", () => {
      logger.warn(`Rate limiter: reservoir depleted, requests will be queued`);
    });

    this.limiter.on("dropped", (dropped) => {
      this.rejectedCount++;
      logger.warn(`Rate limiter: job dropped due to strategy`, { dropped });
    });

    logger.info("Weather rate limiter initialized", {
      maxConcurrent: this.options.maxConcurrent,
      minTime: this.options.minTime,
      reservoir: this.options.reservoir,
      refreshInterval: this.options.reservoirRefreshInterval,
    });
  }

  /**
   * 执行受限函数
   *
   * @param fn - 要执行的异步函数
   * @param priority - 优先级（数字越小优先级越高，默认 5）
   * @returns 包装后的结果
   */
  async schedule<T>(
    fn: () => Promise<T>,
    priority: number = 5,
  ): Promise<JobResult<T>> {
    const startTime = Date.now();
    const queuedAt = Date.now();

    const data = await this.limiter.schedule({ priority }, async () => {
      const executionStart = Date.now();
      const result = await fn();
      return {
        result,
        executionStart,
      };
    });

    const endTime = Date.now();
    const waitTime = data.executionStart - queuedAt;

    return {
      data: data.result,
      duration: endTime - data.executionStart,
      wasQueued: waitTime > this.options.minTime,
      waitTime,
    };
  }

  /**
   * 包装函数，返回受限版本
   *
   * @param fn - 原始异步函数
   * @param priority - 优先级
   * @returns 受限版本的函数
   */
  wrap<T, Args extends unknown[]>(
    fn: (...args: Args) => Promise<T>,
    priority: number = 5,
  ): (...args: Args) => Promise<T> {
    return this.limiter.wrap(fn).withOptions({ priority });
  }

  /**
   * 获取统计信息
   *
   * @returns 速率限制统计
   */
  async getStats(): Promise<RateLimiterStats> {
    const counts = this.limiter.counts();
    const reservoir = await this.limiter.currentReservoir();

    return {
      running: counts.RUNNING,
      queued: counts.QUEUED,
      done: this.doneCount,
      rejected: this.rejectedCount,
      reservoir,
      isRateLimited: counts.QUEUED > 0 || (reservoir !== null && reservoir <= 0),
    };
  }

  /**
   * 检查是否正在限流
   *
   * @returns 是否限流中
   */
  async isRateLimited(): Promise<boolean> {
    const reservoir = await this.limiter.currentReservoir();
    const counts = this.limiter.counts();
    return counts.QUEUED > 0 || (reservoir !== null && reservoir <= 0);
  }

  /**
   * 获取剩余配额
   *
   * @returns 剩余请求数
   */
  async getRemainingQuota(): Promise<number | null> {
    return this.limiter.currentReservoir();
  }

  /**
   * 更新配置
   *
   * @param options - 新配置（部分）
   */
  async updateSettings(options: Partial<RateLimiterOptions>): Promise<void> {
    const newOptions = { ...this.options, ...options };

    await this.limiter.updateSettings({
      maxConcurrent: newOptions.maxConcurrent,
      minTime: newOptions.minTime,
      reservoir: newOptions.reservoir,
      reservoirRefreshInterval: newOptions.reservoirRefreshInterval,
      reservoirRefreshAmount: newOptions.reservoirRefreshAmount,
    });

    this.options = newOptions;
    logger.info("Rate limiter settings updated", options);
  }

  /**
   * 重置统计计数
   */
  resetStats(): void {
    this.doneCount = 0;
    this.rejectedCount = 0;
    logger.info("Rate limiter stats reset");
  }

  /**
   * 停止所有等待中的作业
   *
   * @param dropWaiting - 是否丢弃等待中的作业
   */
  async stop(dropWaiting: boolean = false): Promise<void> {
    await this.limiter.stop({ dropWaitingJobs: dropWaiting });
    logger.info("Rate limiter stopped", { droppedWaiting: dropWaiting });
  }

  /**
   * 断开连接（清理资源）
   */
  disconnect(): Promise<void> {
    return this.limiter.disconnect();
  }

  /**
   * 获取配置
   *
   * @returns 当前配置
   */
  getOptions(): RateLimiterOptions {
    return { ...this.options };
  }
}

// 单例实例
let limiterInstance: WeatherRateLimiter | null = null;

/**
 * 获取速率限制器实例（单例）
 *
 * @param options - 速率限制配置选项
 * @returns 速率限制器实例
 */
export function getRateLimiter(
  options?: Partial<RateLimiterOptions>,
): WeatherRateLimiter {
  if (!limiterInstance) {
    limiterInstance = new WeatherRateLimiter(options);
  }
  return limiterInstance;
}

/**
 * 重置速率限制器实例（用于测试）
 */
export async function resetRateLimiter(): Promise<void> {
  if (limiterInstance) {
    await limiterInstance.disconnect();
    limiterInstance = null;
  }
}

/**
 * 速率限制装饰器工厂
 *
 * 用于包装异步函数，自动添加速率限制逻辑
 *
 * @param priority - 优先级（默认 5）
 * @returns 装饰后的函数
 */
export function withRateLimit<T, Args extends unknown[]>(priority: number = 5) {
  return function (fn: (...args: Args) => Promise<T>) {
    return async function (...args: Args): Promise<T> {
      const limiter = getRateLimiter();
      const result = await limiter.schedule(() => fn(...args), priority);
      return result.data;
    };
  };
}

/**
 * 预定义的 API 速率限制配置
 */
export const RATE_LIMIT_PRESETS = {
  /** OpenWeatherMap 免费版：每分钟 60 次 */
  openweathermap_free: {
    maxConcurrent: 5,
    minTime: 100,
    reservoir: 60,
    reservoirRefreshInterval: 60000,
    reservoirRefreshAmount: 60,
  } as Partial<RateLimiterOptions>,

  /** OpenWeatherMap 付费版：每分钟 600 次 */
  openweathermap_pro: {
    maxConcurrent: 10,
    minTime: 50,
    reservoir: 600,
    reservoirRefreshInterval: 60000,
    reservoirRefreshAmount: 600,
  } as Partial<RateLimiterOptions>,

  /** 和风天气免费版：每天 1000 次 */
  qweather_free: {
    maxConcurrent: 3,
    minTime: 200,
    reservoir: 1000,
    reservoirRefreshInterval: 86400000,
    reservoirRefreshAmount: 1000,
  } as Partial<RateLimiterOptions>,

  /** 测试模式：几乎无限制 */
  test: {
    maxConcurrent: 100,
    minTime: 0,
    reservoir: 10000,
    reservoirRefreshInterval: 1000,
    reservoirRefreshAmount: 10000,
  } as Partial<RateLimiterOptions>,

  /** 严格模式：每分钟 10 次 */
  strict: {
    maxConcurrent: 2,
    minTime: 500,
    reservoir: 10,
    reservoirRefreshInterval: 60000,
    reservoirRefreshAmount: 10,
  } as Partial<RateLimiterOptions>,
};

export { WeatherRateLimiter };
