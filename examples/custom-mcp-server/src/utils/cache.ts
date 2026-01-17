/**
 * 响应缓存工具
 *
 * 使用 node-cache 实现内存缓存，减少重复请求
 */

import NodeCache from "node-cache";
import { logger } from "./logger.js";

/**
 * 缓存配置选项
 */
export interface CacheOptions {
  /** 默认 TTL（秒），0 表示永不过期 */
  stdTTL: number;
  /** 检查过期键的间隔（秒），0 表示不自动检查 */
  checkperiod: number;
  /** 是否在获取时重置 TTL */
  useClones: boolean;
  /** 删除过期键时是否触发回调 */
  deleteOnExpire: boolean;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  /** 缓存命中次数 */
  hits: number;
  /** 缓存未命中次数 */
  misses: number;
  /** 当前缓存键数量 */
  keys: number;
  /** 缓存命中率 */
  hitRate: number;
}

/**
 * 默认缓存配置
 */
const DEFAULT_CACHE_OPTIONS: CacheOptions = {
  stdTTL: 600, // 10 分钟
  checkperiod: 120, // 2 分钟检查一次
  useClones: true, // 返回克隆对象，避免引用问题
  deleteOnExpire: true,
};

/**
 * 天气数据缓存管理器
 *
 * 提供统一的缓存接口，支持：
 * - 自动过期
 * - 缓存统计
 * - 按类型分组的 TTL
 */
class WeatherCache {
  private cache: NodeCache;
  private hitCount: number = 0;
  private missCount: number = 0;

  // 不同数据类型的 TTL（秒）
  private readonly ttlByType: Record<string, number> = {
    current: 300, // 当前天气：5 分钟
    forecast: 1800, // 天气预报：30 分钟
    airQuality: 600, // 空气质量：10 分钟
    cities: 86400, // 城市列表：24 小时
    apiStatus: 60, // API 状态：1 分钟
  };

  constructor(options: Partial<CacheOptions> = {}) {
    const mergedOptions = { ...DEFAULT_CACHE_OPTIONS, ...options };

    this.cache = new NodeCache({
      stdTTL: mergedOptions.stdTTL,
      checkperiod: mergedOptions.checkperiod,
      useClones: mergedOptions.useClones,
      deleteOnExpire: mergedOptions.deleteOnExpire,
    });

    // 监听缓存事件
    this.cache.on("expired", (key: string) => {
      logger.debug(`Cache expired: ${key}`);
    });

    this.cache.on("del", (key: string) => {
      logger.debug(`Cache deleted: ${key}`);
    });

    logger.info("Weather cache initialized", {
      stdTTL: mergedOptions.stdTTL,
      checkperiod: mergedOptions.checkperiod,
    });
  }

  /**
   * 生成缓存键
   *
   * @param type - 数据类型（current, forecast, airQuality）
   * @param params - 参数对象
   * @returns 缓存键
   */
  generateKey(type: string, params: Record<string, unknown>): string {
    // 对参数排序以确保一致性
    const sortedParams = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    return `${type}:${sortedParams}`;
  }

  /**
   * 获取缓存数据
   *
   * @param key - 缓存键
   * @returns 缓存的数据，未命中返回 undefined
   */
  get<T>(key: string): T | undefined {
    const value = this.cache.get<T>(key);

    if (value !== undefined) {
      this.hitCount++;
      logger.debug(`Cache hit: ${key}`);
      return value;
    }

    this.missCount++;
    logger.debug(`Cache miss: ${key}`);
    return undefined;
  }

  /**
   * 设置缓存数据
   *
   * @param key - 缓存键
   * @param value - 要缓存的数据
   * @param type - 数据类型（用于确定 TTL）
   * @returns 是否成功
   */
  set<T>(key: string, value: T, type?: string): boolean {
    const ttl = type ? this.ttlByType[type] || DEFAULT_CACHE_OPTIONS.stdTTL : undefined;

    const success = ttl ? this.cache.set(key, value, ttl) : this.cache.set(key, value);

    if (success) {
      logger.debug(`Cache set: ${key}`, { ttl: ttl || DEFAULT_CACHE_OPTIONS.stdTTL });
    }

    return success;
  }

  /**
   * 删除缓存
   *
   * @param key - 缓存键
   * @returns 删除的键数量
   */
  del(key: string): number {
    return this.cache.del(key);
  }

  /**
   * 按模式删除缓存
   *
   * @param pattern - 键模式（支持 * 通配符）
   * @returns 删除的键数量
   */
  delByPattern(pattern: string): number {
    const keys = this.cache.keys();
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    const matchedKeys = keys.filter((k) => regex.test(k));

    if (matchedKeys.length > 0) {
      this.cache.del(matchedKeys);
      logger.info(`Cache cleared by pattern: ${pattern}`, { count: matchedKeys.length });
    }

    return matchedKeys.length;
  }

  /**
   * 清空所有缓存
   */
  flush(): void {
    this.cache.flushAll();
    logger.info("Cache flushed");
  }

  /**
   * 获取缓存统计
   *
   * @returns 缓存统计信息
   */
  getStats(): CacheStats {
    const total = this.hitCount + this.missCount;
    return {
      hits: this.hitCount,
      misses: this.missCount,
      keys: this.cache.keys().length,
      hitRate: total > 0 ? this.hitCount / total : 0,
    };
  }

  /**
   * 重置统计计数
   */
  resetStats(): void {
    this.hitCount = 0;
    this.missCount = 0;
    logger.info("Cache stats reset");
  }

  /**
   * 获取所有缓存键
   *
   * @returns 缓存键列表
   */
  keys(): string[] {
    return this.cache.keys();
  }

  /**
   * 检查键是否存在
   *
   * @param key - 缓存键
   * @returns 是否存在
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * 获取键的 TTL
   *
   * @param key - 缓存键
   * @returns TTL（毫秒），不存在返回 undefined
   */
  getTtl(key: string): number | undefined {
    return this.cache.getTtl(key);
  }

  /**
   * 设置数据类型的 TTL
   *
   * @param type - 数据类型
   * @param ttl - TTL（秒）
   */
  setTypeTTL(type: string, ttl: number): void {
    this.ttlByType[type] = ttl;
    logger.info(`Cache TTL updated: ${type} = ${ttl}s`);
  }

  /**
   * 获取数据类型的 TTL
   *
   * @param type - 数据类型
   * @returns TTL（秒）
   */
  getTypeTTL(type: string): number {
    return this.ttlByType[type] || DEFAULT_CACHE_OPTIONS.stdTTL;
  }

  /**
   * 关闭缓存（清理定时器）
   */
  close(): void {
    this.cache.close();
    logger.info("Cache closed");
  }
}

// 单例实例
let cacheInstance: WeatherCache | null = null;

/**
 * 获取缓存实例（单例）
 *
 * @param options - 缓存配置选项
 * @returns 缓存实例
 */
export function getCache(options?: Partial<CacheOptions>): WeatherCache {
  if (!cacheInstance) {
    cacheInstance = new WeatherCache(options);
  }
  return cacheInstance;
}

/**
 * 重置缓存实例（用于测试）
 */
export function resetCache(): void {
  if (cacheInstance) {
    cacheInstance.close();
    cacheInstance = null;
  }
}

/**
 * 缓存装饰器工厂
 *
 * 用于包装异步函数，自动添加缓存逻辑
 *
 * @param type - 数据类型
 * @param keyGenerator - 缓存键生成函数
 * @returns 装饰后的函数
 */
export function withCache<T, Args extends unknown[]>(
  type: string,
  keyGenerator: (...args: Args) => Record<string, unknown>,
) {
  return function (fn: (...args: Args) => Promise<T>) {
    return async function (...args: Args): Promise<T> {
      const cache = getCache();
      const params = keyGenerator(...args);
      const key = cache.generateKey(type, params);

      // 尝试从缓存获取
      const cached = cache.get<T>(key);
      if (cached !== undefined) {
        return cached;
      }

      // 执行原函数
      const result = await fn(...args);

      // 缓存结果
      cache.set(key, result, type);

      return result;
    };
  };
}

export { WeatherCache };
