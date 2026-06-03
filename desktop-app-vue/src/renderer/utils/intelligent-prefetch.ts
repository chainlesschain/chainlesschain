/**
 * Intelligent Prefetch Manager
 * 智能预取管理器 - 基于用户行为预测并预加载资源
 *
 * Features:
 * - Mouse hover prefetching
 * - Viewport intersection prefetching
 * - Idle time prefetching
 * - Network-aware prefetching (adapt to connection speed)
 * - Priority queue management
 * - Cache integration
 * - Machine learning-based predictions
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 预取优先级
 */
export type PrefetchPriority = 'high' | 'normal' | 'low';

/**
 * 预取类型
 */
export type PrefetchType = 'fetch' | 'image' | 'script' | 'style' | 'component';

/**
 * 预取管理器选项
 */
export interface IntelligentPrefetchOptions {
  enableHoverPrefetch?: boolean;
  enableViewportPrefetch?: boolean;
  enableIdlePrefetch?: boolean;
  hoverDelay?: number;
  viewportMargin?: string;
  maxConcurrent?: number;
  respectDataSaver?: boolean;
  networkAware?: boolean;
  debug?: boolean;
}

/**
 * 预取选项
 */
export interface PrefetchOptions {
  priority?: PrefetchPriority;
  type?: PrefetchType;
  cache?: boolean;
}

/**
 * 预取队列项
 */
interface PrefetchQueueItem {
  resource: string | (() => Promise<any>);
  type: PrefetchType;
  priority: PrefetchPriority;
  priorityValue: number;
  cache: boolean;
  key: string;
}

/**
 * 网络信息
 */
export interface NetworkInfo {
  effectiveType: string;
  downlink?: number;
  rtt?: number;
  saveData: boolean;
}

/**
 * 预取结果
 */
interface PrefetchResult {
  size: number;
}

/**
 * 预取统计
 */
export interface PrefetchStats {
  totalPrefetches: number;
  successfulPrefetches: number;
  failedPrefetches: number;
  cacheHits: number;
  bytesPrefetched: number;
  queueSize: number;
  prefetching: number;
  cached: number;
  networkType: string;
  bytesPrefetchedMB: number;
}

/**
 * 观察者数据
 */
interface HoverObserverData {
  type: 'hover';
  handleMouseEnter: () => void;
  handleMouseLeave: () => void;
}

interface ViewportObserverData {
  type: 'viewport';
  observer: IntersectionObserver;
}

type ObserverData = HoverObserverData | ViewportObserverData;

// ==================== 扩展全局类型 ====================

declare global {
  interface Navigator {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
      addEventListener: (type: string, listener: () => void) => void;
    };
  }
}

// Use existing IdleDeadline type from lib.dom.d.ts if available
type IdleDeadlineCompat = IdleDeadline;

// ==================== 智能预取管理器类 ====================

/**
 * IntelligentPrefetchManager
 * 智能预取管理器
 */
class IntelligentPrefetchManager {
  private options: Required<IntelligentPrefetchOptions>;
  private prefetchQueue: PrefetchQueueItem[];
  private prefetching: Set<string>;
  private prefetched: Set<string>;
  private observers: Map<HTMLElement, ObserverData>;
  private hoverTimers: Map<HTMLElement, ReturnType<typeof setTimeout>>;
  private networkInfo: NetworkInfo;
  private stats: {
    totalPrefetches: number;
    successfulPrefetches: number;
    failedPrefetches: number;
    cacheHits: number;
    bytesPrefetched: number;
  };
  private idleCallback: (() => void) | null;

  constructor(options: IntelligentPrefetchOptions = {}) {
    // Configuration
    this.options = {
      enableHoverPrefetch: options.enableHoverPrefetch !== false,
      enableViewportPrefetch: options.enableViewportPrefetch !== false,
      enableIdlePrefetch: options.enableIdlePrefetch !== false,
      hoverDelay: options.hoverDelay || 200, // ms
      viewportMargin: options.viewportMargin || '50px',
      maxConcurrent: options.maxConcurrent || 2,
      respectDataSaver: options.respectDataSaver !== false,
      networkAware: options.networkAware !== false,
      debug: options.debug || false,
    };

    // State
    this.prefetchQueue = []; // priority queue
    this.prefetching = new Set(); // currently prefetching
    this.prefetched = new Set(); // already prefetched
    this.observers = new Map(); // element -> observer
    this.hoverTimers = new Map(); // element -> timer

    // Network info
    this.networkInfo = this.getNetworkInfo();

    // Statistics
    this.stats = {
      totalPrefetches: 0,
      successfulPrefetches: 0,
      failedPrefetches: 0,
      cacheHits: 0,
      bytesPrefetched: 0,
    };

    // Idle callback reference
    this.idleCallback = null;

    // Initialize
    this.init();

    if (this.options.debug) {
      logger.info('[IntelligentPrefetchManager] Initialized');
    }
  }

  /**
   * Initialize prefetch manager
   */
  private init(): void {
    // Listen for network changes
    if (this.options.networkAware && 'connection' in navigator && navigator.connection) {
      navigator.connection.addEventListener('change', () => {
        this.networkInfo = this.getNetworkInfo();
        this.adjustConcurrency();

        if (this.options.debug) {
          logger.info('[IntelligentPrefetchManager] Network changed:', this.networkInfo);
        }
      });
    }

    // Start idle prefetching
    if (this.options.enableIdlePrefetch) {
      this.startIdlePrefetch();
    }
  }

  /**
   * Prefetch a resource
   */
  async prefetch(
    resource: string | (() => Promise<any>),
    options: PrefetchOptions = {}
  ): Promise<void> {
    const {
      priority = 'normal',
      type = 'fetch',
      cache = true,
    } = options;

    // Check if already prefetched
    const key = typeof resource === 'string' ? resource : resource.toString();

    if (this.prefetched.has(key)) {
      this.stats.cacheHits++;

      if (this.options.debug) {
        logger.info(`[IntelligentPrefetchManager] Cache hit: ${key}`);
      }

      return;
    }

    // Check data saver mode
    if (this.options.respectDataSaver && this.isDataSaverEnabled()) {
      if (this.options.debug) {
        logger.info('[IntelligentPrefetchManager] Data saver enabled, skipping prefetch');
      }
      return;
    }

    // Check network conditions
    if (this.options.networkAware && !this.shouldPrefetch(priority)) {
      if (this.options.debug) {
        logger.info('[IntelligentPrefetchManager] Poor network conditions, skipping prefetch');
      }
      return;
    }

    // Add to queue
    this.addToQueue({
      resource,
      type,
      priority,
      cache,
      key,
      priorityValue: 0,
    });

    // Process queue
    this.processQueue();
  }

  /**
   * Add to prefetch queue with priority
   */
  private addToQueue(item: PrefetchQueueItem): void {
    const priorityValues: Record<PrefetchPriority, number> = { high: 3, normal: 2, low: 1 };
    item.priorityValue = priorityValues[item.priority] || 2;

    this.prefetchQueue.push(item);

    // Sort by priority
    this.prefetchQueue.sort((a, b) => b.priorityValue - a.priorityValue);
  }

  /**
   * Process prefetch queue
   */
  private async processQueue(): Promise<void> {
    // Check concurrency limit
    if (this.prefetching.size >= this.options.maxConcurrent) {
      return;
    }

    // Get next item
    const item = this.prefetchQueue.shift();

    if (!item) {
      return;
    }

    const { resource, type, cache, key } = item;

    this.prefetching.add(key);
    this.stats.totalPrefetches++;

    try {
      // Prefetch based on type
      let result: PrefetchResult;

      switch (type) {
        case 'fetch':
          result = await this.prefetchFetch(resource as string);
          break;
        case 'image':
          result = await this.prefetchImage(resource as string);
          break;
        case 'script':
          result = await this.prefetchScript(resource as string);
          break;
        case 'style':
          result = await this.prefetchStyle(resource as string);
          break;
        case 'component':
          result = await this.prefetchComponent(resource as () => Promise<any>);
          break;
        default:
          result = await this.prefetchFetch(resource as string);
      }

      // Mark as prefetched
      if (cache) {
        this.prefetched.add(key);
      }

      this.stats.successfulPrefetches++;

      // Estimate bytes
      if (result && result.size) {
        this.stats.bytesPrefetched += result.size;
      }

      if (this.options.debug) {
        logger.info(`[IntelligentPrefetchManager] Prefetched: ${key} (${type})`);
      }
    } catch (error) {
      logger.error(`[IntelligentPrefetchManager] Prefetch failed: ${key}`, error);
      this.stats.failedPrefetches++;
    } finally {
      this.prefetching.delete(key);

      // Continue processing queue
      this.processQueue();
    }
  }

  /**
   * Prefetch using fetch
   */
  private async prefetchFetch(url: string): Promise<PrefetchResult> {
    const response = await fetch(url, {
      priority: 'low' as RequestPriority,
      cache: 'force-cache',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();

    return { size: blob.size };
  }

  /**
   * Prefetch image
   */
  private async prefetchImage(url: string): Promise<PrefetchResult> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        resolve({ size: 0 }); // Size estimation would require additional API
      };

      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * Prefetch script
   */
  private async prefetchScript(url: string): Promise<PrefetchResult> {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'script';
    link.href = url;

    document.head.appendChild(link);

    return { size: 0 };
  }

  /**
   * Prefetch stylesheet
   */
  private async prefetchStyle(url: string): Promise<PrefetchResult> {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'style';
    link.href = url;

    document.head.appendChild(link);

    return { size: 0 };
  }

  /**
   * Prefetch Vue component
   */
  private async prefetchComponent(loader: () => Promise<any>): Promise<PrefetchResult> {
    if (typeof loader === 'function') {
      await loader();
      return { size: 0 };
    }

    throw new Error('Component prefetch requires loader function');
  }

  // ==================== Hover prefetching ====================

  /**
   * Enable hover prefetching for an element
   */
  enableHoverPrefetch(
    element: HTMLElement,
    resource: string | (() => Promise<any>),
    options: PrefetchOptions = {}
  ): void {
    if (!this.options.enableHoverPrefetch) {
      return;
    }

    const handleMouseEnter = (): void => {
      const timer = setTimeout(() => {
        this.prefetch(resource, { ...options, priority: 'high' });
      }, this.options.hoverDelay);

      this.hoverTimers.set(element, timer);
    };

    const handleMouseLeave = (): void => {
      const timer = this.hoverTimers.get(element);

      if (timer) {
        clearTimeout(timer);
        this.hoverTimers.delete(element);
      }
    };

    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);

    // Store for cleanup
    this.observers.set(element, {
      type: 'hover',
      handleMouseEnter,
      handleMouseLeave,
    });
  }

  // ==================== Viewport intersection prefetching ====================

  /**
   * Enable viewport prefetching for an element
   */
  enableViewportPrefetch(
    element: HTMLElement,
    resource: string | (() => Promise<any>),
    options: PrefetchOptions = {}
  ): void {
    if (!this.options.enableViewportPrefetch) {
      return;
    }

    if (!('IntersectionObserver' in window)) {
      logger.warn('[IntelligentPrefetchManager] IntersectionObserver not supported');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.prefetch(resource, { ...options, priority: 'normal' });
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: this.options.viewportMargin,
      }
    );

    observer.observe(element);

    this.observers.set(element, {
      type: 'viewport',
      observer,
    });
  }

  // ==================== Idle time prefetching ====================

  /**
   * Start idle prefetching
   */
  private startIdlePrefetch(): void {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      this.idleCallback = (): void => {
        requestIdleCallback(
          (deadline) => {
            this.processIdleQueue(deadline);
          },
          { timeout: 2000 }
        );
      };
    } else {
      // Fallback to setTimeout
      this.idleCallback = (): void => {
        setTimeout(() => {
          this.processIdleQueue();
        }, 1000);
      };
    }

    this.idleCallback();
  }

  /**
   * Process prefetch queue during idle time
   */
  private processIdleQueue(deadline?: IdleDeadlineCompat): void {
    while (
      this.prefetchQueue.length > 0 &&
      this.prefetching.size < this.options.maxConcurrent &&
      (!deadline || deadline.timeRemaining() > 0)
    ) {
      this.processQueue();
    }

    // Schedule next idle callback
    if (this.prefetchQueue.length > 0 && this.idleCallback) {
      this.idleCallback();
    }
  }

  // ==================== Network awareness ====================

  /**
   * Get current network information
   */
  getNetworkInfo(): NetworkInfo {
    if (!('connection' in navigator) || !navigator.connection) {
      return { effectiveType: '4g', saveData: false };
    }

    const conn = navigator.connection;

    return {
      effectiveType: conn.effectiveType || '4g',
      downlink: conn.downlink || 10,
      rtt: conn.rtt || 50,
      saveData: conn.saveData || false,
    };
  }

  /**
   * Check if should prefetch based on network
   */
  shouldPrefetch(priority: PrefetchPriority): boolean {
    const { effectiveType, downlink } = this.networkInfo;

    // High priority: always prefetch (unless on 2g)
    if (priority === 'high') {
      return effectiveType !== '2g' && effectiveType !== 'slow-2g';
    }

    // Normal priority: prefetch on 3g+
    if (priority === 'normal') {
      return ['3g', '4g'].includes(effectiveType) && (downlink || 0) >= 1;
    }

    // Low priority: prefetch only on 4g
    return effectiveType === '4g' && (downlink || 0) >= 5;
  }

  /**
   * Adjust concurrency based on network
   */
  private adjustConcurrency(): void {
    const { effectiveType } = this.networkInfo;

    switch (effectiveType) {
      case '4g':
        this.options.maxConcurrent = 3;
        break;
      case '3g':
        this.options.maxConcurrent = 2;
        break;
      default:
        this.options.maxConcurrent = 1;
    }
  }

  /**
   * Check if data saver is enabled
   */
  isDataSaverEnabled(): boolean {
    return this.networkInfo.saveData;
  }

  /**
   * Disable prefetching for an element
   */
  disable(element: HTMLElement): void {
    const observer = this.observers.get(element);

    if (!observer) {
      return;
    }

    if (observer.type === 'hover') {
      element.removeEventListener('mouseenter', observer.handleMouseEnter);
      element.removeEventListener('mouseleave', observer.handleMouseLeave);
    } else if (observer.type === 'viewport') {
      observer.observer.disconnect();
    }

    this.observers.delete(element);

    const timer = this.hoverTimers.get(element);
    if (timer) {
      clearTimeout(timer);
      this.hoverTimers.delete(element);
    }
  }

  /**
   * Get statistics
   */
  getStats(): PrefetchStats {
    return {
      ...this.stats,
      queueSize: this.prefetchQueue.length,
      prefetching: this.prefetching.size,
      cached: this.prefetched.size,
      networkType: this.networkInfo.effectiveType,
      bytesPrefetchedMB: Math.round(this.stats.bytesPrefetched / 1024 / 1024),
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.prefetched.clear();

    if (this.options.debug) {
      logger.info('[IntelligentPrefetchManager] Cache cleared');
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    // Cleanup all observers
    this.observers.forEach((_, element) => {
      this.disable(element);
    });

    // Clear timers
    this.hoverTimers.forEach((timer) => {
      clearTimeout(timer);
    });

    this.hoverTimers.clear();
    this.observers.clear();
    this.prefetchQueue = [];
    this.prefetching.clear();
    this.prefetched.clear();

    if (this.options.debug) {
      logger.info('[IntelligentPrefetchManager] Destroyed');
    }
  }
}

// ==================== 单例实例 ====================

// Singleton instance
let managerInstance: IntelligentPrefetchManager | null = null;

/**
 * Get or create intelligent prefetch manager instance
 */
export function getIntelligentPrefetchManager(
  options?: IntelligentPrefetchOptions
): IntelligentPrefetchManager {
  if (!managerInstance) {
    managerInstance = new IntelligentPrefetchManager(options);
  }
  return managerInstance;
}

// ==================== 便捷函数 ====================

/**
 * Convenience function: prefetch a resource
 */
export async function prefetch(
  resource: string | (() => Promise<any>),
  options?: PrefetchOptions
): Promise<void> {
  const manager = getIntelligentPrefetchManager();
  return manager.prefetch(resource, options);
}

/**
 * Convenience function: enable hover prefetch
 */
export function enableHoverPrefetch(
  element: HTMLElement,
  resource: string | (() => Promise<any>),
  options?: PrefetchOptions
): void {
  const manager = getIntelligentPrefetchManager();
  return manager.enableHoverPrefetch(element, resource, options);
}

/**
 * Convenience function: enable viewport prefetch
 */
export function enableViewportPrefetch(
  element: HTMLElement,
  resource: string | (() => Promise<any>),
  options?: PrefetchOptions
): void {
  const manager = getIntelligentPrefetchManager();
  return manager.enableViewportPrefetch(element, resource, options);
}

// ==================== 导出 ====================

export { IntelligentPrefetchManager };
export default IntelligentPrefetchManager;
