import { logger, createLogger } from '@/utils/logger';

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

/**
 * Generic Object Pool
 * 通用对象池
 *
 * Reuse objects instead of creating new ones to reduce GC pressure
 */
export class ObjectPool {
  constructor(factory, options = {}) {
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
        `[ObjectPool] Created with ${this.available.length} initial objects`,
      );
    }
  }

  /**
   * Acquire object from pool
   */
  acquire() {
    let obj;

    if (this.available.length > 0) {
      obj = this.available.pop();

      if (this.options.debug) {
        logger.info(
          `[ObjectPool] Reused object (${this.available.length} available)`,
        );
      }
    } else {
      obj = this.factory();

      if (this.options.debug) {
        logger.info("[ObjectPool] Created new object (pool exhausted)");
      }
    }

    this.inUse.add(obj);
    return obj;
  }

  /**
   * Release object back to pool
   */
  release(obj) {
    if (!this.inUse.has(obj)) {
      logger.warn("[ObjectPool] Attempted to release object not from pool");
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
        logger.warn("[ObjectPool] Object failed validation, discarding");
      }
      return false;
    }

    // Check pool size limit
    if (this.available.length >= this.options.maxSize) {
      if (this.options.debug) {
        logger.info("[ObjectPool] Pool at max size, discarding object");
      }
      return false;
    }

    this.available.push(obj);

    if (this.options.debug) {
      logger.info(
        `[ObjectPool] Released object (${this.available.length} available)`,
      );
    }

    return true;
  }

  /**
   * Get pool stats
   */
  getStats() {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.available.length + this.inUse.size,
    };
  }

  /**
   * Clear pool
   */
  clear() {
    this.available = [];
    this.inUse.clear();

    if (this.options.debug) {
      logger.info("[ObjectPool] Cleared");
    }
  }

  /**
   * Drain pool (remove all available objects)
   */
  drain() {
    const count = this.available.length;
    this.available = [];

    if (this.options.debug) {
      logger.info(`[ObjectPool] Drained ${count} objects`);
    }

    return count;
  }
}

/**
 * Memory Leak Detector
 * 内存泄漏检测器
 */
export class MemoryLeakDetector {
  constructor(options = {}) {
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
  start() {
    if (this.intervalId) {
      logger.warn("[MemoryLeakDetector] Already monitoring");
      return;
    }

    this.samples = [];

    this.intervalId = setInterval(() => {
      this.checkMemory();
    }, this.options.checkInterval);

    logger.info("[MemoryLeakDetector] Started monitoring");
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("[MemoryLeakDetector] Stopped monitoring");
    }
  }

  /**
   * Check memory usage
   */
  checkMemory() {
    if (!performance.memory) {
      logger.warn("[MemoryLeakDetector] performance.memory not available");
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
  analyzeTrend() {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];

    const timeDiff = (last.time - first.time) / 1000; // seconds
    const memoryDiff = last.usedMB - first.usedMB;

    // Check if memory is consistently increasing
    if (memoryDiff > this.options.threshold) {
      const rate = memoryDiff / timeDiff; // MB/second

      const leak = {
        memoryIncrease: memoryDiff,
        timeWindow: timeDiff,
        rate,
        samples: [...this.samples],
      };

      logger.warn(
        "[MemoryLeakDetector] ⚠️ Potential memory leak detected:",
        leak,
      );

      // Notify listeners
      this.listeners.forEach((listener) => listener(leak));
    }
  }

  /**
   * Add leak listener
   */
  onLeak(callback) {
    this.listeners.push(callback);
  }

  /**
   * Get current memory stats
   */
  getStats() {
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

/**
 * Weak Reference Manager
 * 弱引用管理器
 *
 * Use WeakMap and WeakSet for automatic garbage collection
 */
export class WeakReferenceManager {
  constructor() {
    this.weakMaps = new Map();
    this.weakSets = new Map();
  }

  /**
   * Create or get weak map
   */
  getWeakMap(name) {
    if (!this.weakMaps.has(name)) {
      this.weakMaps.set(name, new WeakMap());
    }

    return this.weakMaps.get(name);
  }

  /**
   * Create or get weak set
   */
  getWeakSet(name) {
    if (!this.weakSets.has(name)) {
      this.weakSets.set(name, new WeakSet());
    }

    return this.weakSets.get(name);
  }

  /**
   * Clear all weak references
   */
  clear() {
    this.weakMaps.clear();
    this.weakSets.clear();
  }
}

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
  static requestGC() {
    if (global.gc) {
      logger.info("[MemoryOptimizer] Requesting garbage collection");
      global.gc();
      return true;
    }

    logger.warn(
      "[MemoryOptimizer] GC not available (run with --expose-gc flag)",
    );
    return false;
  }

  /**
   * Clear large objects
   */
  static clearObject(obj) {
    if (!obj || typeof obj !== "object") {
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
  static nullifyRefs(...refs) {
    refs.forEach((ref, index) => {
      if (ref && typeof ref === "object") {
        Object.keys(ref).forEach((key) => {
          ref[key] = null;
        });
      }
    });
  }

  /**
   * Get memory usage
   */
  static getMemoryUsage() {
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
        "%",
    };
  }
}

/**
 * Create common object pools
 */

// DOM element pool
export const domElementPool = new ObjectPool(
  () => document.createElement("div"),
  {
    initialSize: 20,
    maxSize: 100,
    resetFn: (el) => {
      el.replaceChildren();
      el.className = "";
      el.removeAttribute("style");
    },
  },
);

// Array pool
export const arrayPool = new ObjectPool(() => [], {
  initialSize: 50,
  maxSize: 200,
  resetFn: (arr) => {
    arr.length = 0;
  },
});

// Object pool
export const objectPool = new ObjectPool(() => ({}), {
  initialSize: 50,
  maxSize: 200,
  resetFn: (obj) => {
    Object.keys(obj).forEach((key) => delete obj[key]);
  },
});

// Global instances
export const memoryLeakDetector = new MemoryLeakDetector();
export const weakRefManager = new WeakReferenceManager();

/**
 * Export default object
 */
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
