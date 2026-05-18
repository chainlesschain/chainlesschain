/**
 * Object Pool and Memory Optimization Utilities
 * 对象池和内存优化工具
 *
 * Features:
 * - Object pooling for frequent allocations
 * - Memory leak detection
 * - Automatic garbage collection hints
 * - Weak reference management
 * - Memory usage tracking
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 对象池选项
 */
export interface ObjectPoolOptions<T> {
  initialSize?: number;
  maxSize?: number;
  resetFn?: ((obj: T) => void) | null;
  validateFn?: ((obj: T) => boolean) | null;
  debug?: boolean;
}

/**
 * 对象池统计
 */
export interface ObjectPoolStats {
  available: number;
  inUse: number;
  total: number;
}

/**
 * 内存泄漏检测器选项
 */
export interface MemoryLeakDetectorOptions {
  checkInterval?: number;
  threshold?: number;
  sampleSize?: number;
  debug?: boolean;
}

/**
 * 内存样本
 */
export interface MemorySample {
  time: number;
  usedMB: number;
}

/**
 * 内存泄漏信息
 */
export interface MemoryLeak {
  memoryIncrease: number;
  timeWindow: number;
  rate: number;
  samples: MemorySample[];
}

/**
 * 内存泄漏监听器
 */
export type LeakListener = (leak: MemoryLeak) => void;

/**
 * 内存统计
 */
export interface MemoryStats {
  usedMB: string;
  totalMB: string;
  limitMB: string;
  samples: number;
}

/**
 * 内存使用信息
 */
export interface MemoryUsage {
  used: number;
  total: number;
  limit: number;
  usedMB: string;
  totalMB: string;
  limitMB: string;
  usage: string;
}

// ==================== 扩展全局类型 ====================

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }
}

// Type for global gc function (available when running with --expose-gc)
type GCFunction = () => void;

// Access gc through globalThis to avoid type conflicts
const getGC = (): GCFunction | undefined => {
  return (globalThis as { gc?: GCFunction }).gc;
};

// ==================== 对象池类 ====================

/**
 * Generic Object Pool
 * 通用对象池
 *
 * Reuse objects instead of creating new ones to reduce GC pressure
 */
export class ObjectPool<T extends object> {
  private factory: () => T;
  private options: Required<ObjectPoolOptions<T>>;
  private available: T[];
  private inUse: Set<T>;

  constructor(factory: () => T, options: ObjectPoolOptions<T> = {}) {
    this.factory = factory;
    this.options = {
      initialSize: options.initialSize || 10,
      maxSize: options.maxSize || 100,
      resetFn: options.resetFn || null,
      validateFn: options.validateFn || null,
      debug: options.debug || false,
    };

    this.available = [];
    this.inUse = new Set();

    // Pre-fill pool
    for (let i = 0; i < this.options.initialSize; i++) {
      this.available.push(this.factory());
    }

    if (this.options.debug) {
      logger.info(
        `[ObjectPool] Created with ${this.available.length} initial objects`
      );
    }
  }

  /**
   * Acquire object from pool
   */
  acquire(): T {
    let obj: T;

    if (this.available.length > 0) {
      obj = this.available.pop()!;

      if (this.options.debug) {
        logger.info(
          `[ObjectPool] Reused object (${this.available.length} available)`
        );
      }
    } else {
      obj = this.factory();

      if (this.options.debug) {
        logger.info('[ObjectPool] Created new object (pool exhausted)');
      }
    }

    this.inUse.add(obj);
    return obj;
  }

  /**
   * Release object back to pool
   */
  release(obj: T): boolean {
    if (!this.inUse.has(obj)) {
      logger.warn('[ObjectPool] Attempted to release object not from pool');
      return false;
    }

    this.inUse.delete(obj);

    // Reset object state
    if (this.options.resetFn) {
      this.options.resetFn(obj);
    }

    // Validate before returning to pool
    if (this.options.validateFn && !this.options.validateFn(obj)) {
      if (this.options.debug) {
        logger.warn('[ObjectPool] Object failed validation, discarding');
      }
      return false;
    }

    // Check pool size limit
    if (this.available.length >= this.options.maxSize) {
      if (this.options.debug) {
        logger.info('[ObjectPool] Pool at max size, discarding object');
      }
      return false;
    }

    this.available.push(obj);

    if (this.options.debug) {
      logger.info(
        `[ObjectPool] Released object (${this.available.length} available)`
      );
    }

    return true;
  }

  /**
   * Get pool stats
   */
  getStats(): ObjectPoolStats {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.available.length + this.inUse.size,
    };
  }

  /**
   * Clear pool
   */
  clear(): void {
    this.available = [];
    this.inUse.clear();

    if (this.options.debug) {
      logger.info('[ObjectPool] Cleared');
    }
  }

  /**
   * Drain pool (remove all available objects)
   */
  drain(): number {
    const count = this.available.length;
    this.available = [];

    if (this.options.debug) {
      logger.info(`[ObjectPool] Drained ${count} objects`);
    }

    return count;
  }
}

// ==================== 内存泄漏检测器类 ====================

/**
 * Memory Leak Detector
 * 内存泄漏检测器
 */
export class MemoryLeakDetector {
  private options: Required<MemoryLeakDetectorOptions>;
  private samples: MemorySample[];
  private intervalId: ReturnType<typeof setInterval> | null;
  private listeners: LeakListener[];

  constructor(options: MemoryLeakDetectorOptions = {}) {
    this.options = {
      checkInterval: options.checkInterval || 5000, // 5 seconds
      threshold: options.threshold || 10, // MB
      sampleSize: options.sampleSize || 10,
      debug: options.debug || false,
    };

    this.samples = [];
    this.intervalId = null;
    this.listeners = [];
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('[MemoryLeakDetector] Already monitoring');
      return;
    }

    this.samples = [];

    this.intervalId = setInterval(() => {
      this.checkMemory();
    }, this.options.checkInterval);

    logger.info('[MemoryLeakDetector] Started monitoring');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('[MemoryLeakDetector] Stopped monitoring');
    }
  }

  /**
   * Check memory usage
   */
  checkMemory(): void {
    if (!performance.memory) {
      logger.warn('[MemoryLeakDetector] performance.memory not available');
      return;
    }

    const usedMB = performance.memory.usedJSHeapSize / (1024 * 1024);

    this.samples.push({
      time: Date.now(),
      usedMB,
    });

    // Keep only recent samples
    if (this.samples.length > this.options.sampleSize) {
      this.samples.shift();
    }

    if (this.options.debug) {
      logger.info(`[MemoryLeakDetector] Memory: ${usedMB.toFixed(2)} MB`);
    }

    // Analyze trend
    if (this.samples.length >= this.options.sampleSize) {
      this.analyzeTrend();
    }
  }

  /**
   * Analyze memory trend
   */
  analyzeTrend(): void {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];

    const timeDiff = (last.time - first.time) / 1000; // seconds
    const memoryDiff = last.usedMB - first.usedMB;

    // Check if memory is consistently increasing
    if (memoryDiff > this.options.threshold) {
      const rate = memoryDiff / timeDiff; // MB/second

      const leak: MemoryLeak = {
        memoryIncrease: memoryDiff,
        timeWindow: timeDiff,
        rate,
        samples: [...this.samples],
      };

      logger.warn(
        '[MemoryLeakDetector] Potential memory leak detected:',
        leak
      );

      // Notify listeners
      this.listeners.forEach((listener) => listener(leak));
    }
  }

  /**
   * Add leak listener
   */
  onLeak(callback: LeakListener): void {
    this.listeners.push(callback);
  }

  /**
   * Get current memory stats
   */
  getStats(): MemoryStats | null {
    if (!performance.memory) {
      return null;
    }

    const memory = performance.memory;

    return {
      usedMB: (memory.usedJSHeapSize / (1024 * 1024)).toFixed(2),
      totalMB: (memory.totalJSHeapSize / (1024 * 1024)).toFixed(2),
      limitMB: (memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(2),
      samples: this.samples.length,
    };
  }
}

// ==================== 弱引用管理器类 ====================

/**
 * Weak Reference Manager
 * 弱引用管理器
 *
 * Use WeakMap and WeakSet for automatic garbage collection
 */
export class WeakReferenceManager {
  private weakMaps: Map<string, WeakMap<object, any>>;
  private weakSets: Map<string, WeakSet<object>>;

  constructor() {
    this.weakMaps = new Map();
    this.weakSets = new Map();
  }

  /**
   * Create or get weak map
   */
  getWeakMap<K extends object, V>(name: string): WeakMap<K, V> {
    if (!this.weakMaps.has(name)) {
      this.weakMaps.set(name, new WeakMap());
    }

    return this.weakMaps.get(name) as WeakMap<K, V>;
  }

  /**
   * Create or get weak set
   */
  getWeakSet<T extends object>(name: string): WeakSet<T> {
    if (!this.weakSets.has(name)) {
      this.weakSets.set(name, new WeakSet());
    }

    return this.weakSets.get(name) as WeakSet<T>;
  }

  /**
   * Clear all weak references
   */
  clear(): void {
    this.weakMaps.clear();
    this.weakSets.clear();
  }
}

// ==================== 内存优化器类 ====================

/**
 * Memory Optimizer
 * 内存优化器
 *
 * Provides hints to garbage collector
 */
export class MemoryOptimizer {
  /**
   * Request garbage collection (if available)
   */
  static requestGC(): boolean {
    const gc = getGC();
    if (gc) {
      logger.info('[MemoryOptimizer] Requesting garbage collection');
      gc();
      return true;
    }

    logger.warn(
      '[MemoryOptimizer] GC not available (run with --expose-gc flag)'
    );
    return false;
  }

  /**
   * Clear large objects
   */
  static clearObject(obj: Record<string, any> | null | undefined): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    // Clear all properties
    Object.keys(obj).forEach((key) => {
      delete obj[key];
    });
  }

  /**
   * Nullify references to help GC
   */
  static nullifyRefs(...refs: (Record<string, any> | null | undefined)[]): void {
    refs.forEach((ref) => {
      if (ref && typeof ref === 'object') {
        Object.keys(ref).forEach((key) => {
          (ref as Record<string, any>)[key] = null;
        });
      }
    });
  }

  /**
   * Get memory usage
   */
  static getMemoryUsage(): MemoryUsage | null {
    if (!performance.memory) {
      return null;
    }

    const memory = performance.memory;

    return {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      limit: memory.jsHeapSizeLimit,
      usedMB: (memory.usedJSHeapSize / (1024 * 1024)).toFixed(2),
      totalMB: (memory.totalJSHeapSize / (1024 * 1024)).toFixed(2),
      limitMB: (memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(2),
      usage:
        ((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(2) +
        '%',
    };
  }
}

// ==================== 预定义对象池 ====================

/**
 * DOM element pool
 */
export const domElementPool = new ObjectPool<HTMLDivElement>(
  () => document.createElement('div'),
  {
    initialSize: 20,
    maxSize: 100,
    resetFn: (el) => {
      el.replaceChildren();
      el.className = '';
      el.removeAttribute('style');
    },
  }
);

/**
 * Array pool
 */
export const arrayPool = new ObjectPool<any[]>(() => [], {
  initialSize: 50,
  maxSize: 200,
  resetFn: (arr) => {
    arr.length = 0;
  },
});

/**
 * Object pool
 */
export const objectPool = new ObjectPool<Record<string, any>>(() => ({}), {
  initialSize: 50,
  maxSize: 200,
  resetFn: (obj) => {
    Object.keys(obj).forEach((key) => delete obj[key]);
  },
});

// ==================== 全局实例 ====================

export const memoryLeakDetector = new MemoryLeakDetector();
export const weakRefManager = new WeakReferenceManager();

// ==================== 默认导出 ====================

export default {
  ObjectPool,
  MemoryLeakDetector,
  WeakReferenceManager,
  MemoryOptimizer,
  domElementPool,
  arrayPool,
  objectPool,
  memoryLeakDetector,
  weakRefManager,
};
