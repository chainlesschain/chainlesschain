/**
 * Advanced Code Splitting Utilities
 * 高级代码分割工具
 *
 * Features:
 * - Smart component lazy loading with retry
 * - Prefetch on hover/viewport
 * - Loading error handling with fallback
 * - Chunk name generation for better debugging
 * - Bundle size tracking
 */

import { logger } from '@/utils/logger';
import { defineAsyncComponent, type Component, type AsyncComponentLoader } from 'vue';
import { prefetch } from './resource-hints';

// ==================== 类型定义 ====================

/**
 * 加载回调
 */
export type LoadedCallback = (component: Component) => void;

/**
 * 错误回调
 */
export type ErrorCallback = (error: Error) => void;

/**
 * 懒加载选项
 */
export interface LazyLoadOptions {
  /** Loading component */
  loadingComponent?: Component | null;
  /** Error component */
  errorComponent?: Component | null;
  /** Delay before showing loading component (ms) */
  delay?: number;
  /** Timeout for loading (ms) */
  timeout?: number;
  /** Retry attempts on failure */
  retryAttempts?: number;
  /** Retry delay (ms) */
  retryDelay?: number;
  /** Chunk name for debugging */
  chunkName?: string;
  /** Enable prefetch on hover */
  prefetchOnHover?: boolean;
  /** Enable prefetch on viewport */
  prefetchOnViewport?: boolean;
  /** Callback when loaded */
  onLoaded?: LoadedCallback | null;
  /** Callback on error */
  onError?: ErrorCallback | null;
}

/**
 * 懒加载路由选项
 */
export interface LazyRouteOptions extends Omit<LazyLoadOptions, 'loadingComponent' | 'errorComponent' | 'delay' | 'timeout' | 'prefetchOnHover' | 'prefetchOnViewport'> {
  [key: string]: unknown;
}

/**
 * 路由组路由配置
 */
export interface RouteGroupRoute {
  loader?: () => Promise<Component>;
  options?: LazyRouteOptions;
}

/**
 * 路由组配置
 */
export interface RouteGroupRoutes {
  [key: string]: RouteGroupRoute | (() => Promise<Component>);
}

/**
 * Bundle 大小报告
 */
export interface BundleSizeReport {
  chunks: Record<string, number>;
  total: number;
  totalKB: string;
  totalMB: string;
}

/**
 * 智能加载选项
 */
export interface SmartLoadOptions extends LazyLoadOptions {
  /** Prefetch delay (ms) */
  prefetchDelay?: number;
}

/**
 * 智能组件类型
 */
export type SmartComponent = Component & {
  prefetchOnHover: (element: HTMLElement | null) => void;
  prefetchOnVisible: (element: HTMLElement | null) => void;
};

/**
 * 懒加载路由组件
 */
export type LazyRouteComponent = (() => Promise<Component>) & {
  __chunkName: string;
  __lazyRoute: boolean;
};

/**
 * 异步组件（带元数据）
 */
export type AsyncComponentWithMetadata = Component & {
  __chunkName?: string;
  __prefetchOnHover?: boolean;
  __prefetchOnViewport?: boolean;
};

/**
 * 渐进式加载器队列项
 */
export interface ProgressiveLoaderItem {
  loader: () => Promise<Component>;
  priority: number;
  chunkName: string;
}

/**
 * 优先级级别
 */
export type PriorityLevel = 'high' | 'normal' | 'low';

// ==================== 全局类型扩展 ====================

declare global {
  interface Window {
    __BUNDLE_SIZE_TRACKER__?: Record<string, number>;
  }
}

// ==================== 函数实现 ====================

/**
 * Create a lazy-loaded component with advanced features
 * 创建具有高级功能的懒加载组件
 *
 * @param loader - Component loader function
 * @param options - Options
 * @returns Component
 */
export function lazyLoad(
  loader: AsyncComponentLoader,
  options: LazyLoadOptions = {}
): AsyncComponentWithMetadata {
  const {
    loadingComponent = null,
    errorComponent = null,
    delay = 200,
    timeout = 30000,
    retryAttempts = 3,
    retryDelay = 1000,
    chunkName = 'async-component',
    prefetchOnHover = false,
    prefetchOnViewport = false,
    onLoaded = null,
    onError = null,
  } = options;

  let retryCount = 0;

  // Wrap loader with retry logic
  const loaderWithRetry = async (): Promise<Component> => {
    try {
      const component = await loader();

      if (onLoaded) {
        onLoaded(component as Component);
      }

      logger.info(`[CodeSplitting] Component loaded: ${chunkName}`);
      return component;
    } catch (error) {
      logger.error(`[CodeSplitting] Load failed (attempt ${retryCount + 1}/${retryAttempts}):`, {
        chunkName,
        error,
      });

      if (retryCount < retryAttempts - 1) {
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, retryDelay * retryCount));
        return loaderWithRetry();
      }

      if (onError) {
        onError(error as Error);
      }

      throw error;
    }
  };

  // Create async component
  const asyncComponent = defineAsyncComponent({
    loader: loaderWithRetry,
    loadingComponent: loadingComponent || undefined,
    errorComponent: errorComponent || undefined,
    delay,
    timeout,

    // Handle loading errors
    onError(error, retry, fail, attempts) {
      logger.error(`[CodeSplitting] Error loading ${chunkName} (attempt ${attempts}):`, { error });

      if (attempts <= retryAttempts) {
        logger.info(`[CodeSplitting] Retrying... (${attempts}/${retryAttempts})`);
        setTimeout(() => retry(), retryDelay * attempts);
      } else {
        logger.error(`[CodeSplitting] Failed to load ${chunkName} after ${retryAttempts} attempts`);
        fail();
      }
    },
  }) as AsyncComponentWithMetadata;

  // Add metadata for debugging
  asyncComponent.__chunkName = chunkName;
  asyncComponent.__prefetchOnHover = prefetchOnHover;
  asyncComponent.__prefetchOnViewport = prefetchOnViewport;

  return asyncComponent;
}

/**
 * Create lazy route component
 * 创建懒加载路由组件
 *
 * @param loader - Component loader
 * @param options - Options
 * @returns Component
 */
export function lazyRoute(
  loader: () => Promise<Component>,
  options: LazyRouteOptions = {}
): LazyRouteComponent {
  const {
    chunkName,
    retryAttempts = 3,
    retryDelay = 1000,
    onLoaded = null,
    onError = null,
  } = options;

  const resolvedChunkName = chunkName || 'route';
  let retryCount = 0;

  const loaderWithRetry = async (): Promise<Component> => {
    try {
      const component = await loader();

      if (onLoaded) {
        onLoaded(component);
      }

      logger.info(`[CodeSplitting] Route loaded: ${resolvedChunkName}`);
      return component;
    } catch (error) {
      logger.error(
        `[CodeSplitting] Route load failed (attempt ${retryCount + 1}/${retryAttempts}):`,
        { chunkName: resolvedChunkName, error }
      );

      if (retryCount < retryAttempts - 1) {
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, retryDelay * retryCount));
        return loaderWithRetry();
      }

      if (onError) {
        onError(error as Error);
      }

      throw error;
    }
  };

  const routeComponent = (() => loaderWithRetry()) as LazyRouteComponent;
  routeComponent.__chunkName = resolvedChunkName;
  routeComponent.__lazyRoute = true;

  return routeComponent;
}

/**
 * Prefetch component
 * 预取组件
 *
 * @param loader - Component loader
 * @param chunkName - Chunk name
 */
export function prefetchComponent(
  loader: () => Promise<Component>,
  chunkName: string = 'component'
): void {
  logger.info(`[CodeSplitting] Prefetching: ${chunkName}`);

  // Trigger loader to prefetch chunk
  loader().catch((error) => {
    logger.warn(`[CodeSplitting] Prefetch failed for ${chunkName}:`, { error });
  });
}

/**
 * Create route group with shared chunk
 * 创建共享chunk的路由组
 *
 * @param groupName - Group name
 * @param routes - Routes in group
 * @returns Object
 */
export function createRouteGroup(
  groupName: string,
  routes: RouteGroupRoutes
): Record<string, LazyRouteComponent> {
  const groupedRoutes: Record<string, LazyRouteComponent> = {};

  Object.keys(routes).forEach((key) => {
    const route = routes[key];
    const loader = typeof route === 'function' ? route : route.loader;
    const routeOptions = typeof route === 'function' ? {} : route.options || {};

    if (loader) {
      groupedRoutes[key] = lazyRoute(loader, {
        chunkName: `${groupName}-${key}`,
        ...routeOptions,
      });
    }
  });

  return groupedRoutes;
}

/**
 * Analyze bundle size (development only)
 * 分析bundle大小（仅开发环境）
 *
 * @param chunkName - Chunk name
 * @param size - Size in bytes
 */
export function trackBundleSize(chunkName: string, size: number): void {
  if (import.meta.env.DEV) {
    const sizeKB = (size / 1024).toFixed(2);
    const sizeColor = size > 100 * 1024 ? 'red' : size > 50 * 1024 ? 'orange' : 'green';

    logger.info(`[BundleSize] ${chunkName}: ${sizeKB} KB (${sizeColor})`);

    // Store in global tracker
    if (!window.__BUNDLE_SIZE_TRACKER__) {
      window.__BUNDLE_SIZE_TRACKER__ = {};
    }

    window.__BUNDLE_SIZE_TRACKER__[chunkName] = size;
  }
}

/**
 * Get bundle size report
 * 获取bundle大小报告
 *
 * @returns Object
 */
export function getBundleSizeReport(): BundleSizeReport {
  if (!window.__BUNDLE_SIZE_TRACKER__) {
    return { chunks: {}, total: 0, totalKB: '0', totalMB: '0' };
  }

  const chunks = window.__BUNDLE_SIZE_TRACKER__;
  const total = Object.values(chunks).reduce((sum, size) => sum + size, 0);

  return {
    chunks,
    total,
    totalKB: (total / 1024).toFixed(2),
    totalMB: (total / (1024 * 1024)).toFixed(2),
  };
}

/**
 * Smart component loader with prefetch on interaction
 * 智能组件加载器（交互时预取）
 *
 * @param loader - Component loader
 * @param options - Options
 * @returns Object
 */
export function smartLoad(
  loader: () => Promise<Component>,
  options: SmartLoadOptions = {}
): SmartComponent {
  const { prefetchDelay = 100, chunkName = 'smart-component' } = options;

  let prefetched = false;
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  const component = lazyLoad(loader as AsyncComponentLoader, {
    ...options,
    chunkName,
  }) as SmartComponent;

  // Add prefetch methods
  component.prefetchOnHover = (element: HTMLElement | null): void => {
    if (!element) {
      return;
    }

    element.addEventListener('mouseenter', () => {
      if (prefetched) {
        return;
      }

      hoverTimeout = setTimeout(() => {
        prefetchComponent(loader, chunkName);
        prefetched = true;
      }, prefetchDelay);
    });

    element.addEventListener('mouseleave', () => {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
      }
    });
  };

  component.prefetchOnVisible = (element: HTMLElement | null): void => {
    if (!element || prefetched) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !prefetched) {
            prefetchComponent(loader, chunkName);
            prefetched = true;
            observer.disconnect();
          }
        });
      },
      {
        threshold: 0.1,
      }
    );

    observer.observe(element);
  };

  return component;
}

/**
 * Progressive loading helper
 * 渐进式加载辅助函数
 *
 * Load components in priority order
 */
export class ProgressiveLoader {
  private queue: ProgressiveLoaderItem[];
  private loading: boolean;
  private loaded: Set<string>;

  constructor() {
    this.queue = [];
    this.loading = false;
    this.loaded = new Set();
  }

  /**
   * Add component to load queue
   */
  add(
    loader: () => Promise<Component>,
    priority: PriorityLevel = 'normal',
    chunkName: string = 'component'
  ): void {
    const priorityMap: Record<PriorityLevel, number> = { high: 3, normal: 2, low: 1 };

    this.queue.push({
      loader,
      priority: priorityMap[priority] || 2,
      chunkName,
    });

    // Sort by priority
    this.queue.sort((a, b) => b.priority - a.priority);

    // Start loading if not already
    if (!this.loading) {
      this.processQueue();
    }
  }

  /**
   * Process load queue
   */
  async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      this.loading = false;
      return;
    }

    this.loading = true;
    const item = this.queue.shift()!;

    if (this.loaded.has(item.chunkName)) {
      return this.processQueue();
    }

    try {
      logger.info(`[ProgressiveLoader] Loading: ${item.chunkName} (priority: ${item.priority})`);
      await item.loader();
      this.loaded.add(item.chunkName);
      logger.info(`[ProgressiveLoader] Loaded: ${item.chunkName}`);
    } catch (error) {
      logger.error(`[ProgressiveLoader] Failed: ${item.chunkName}`, { error });
    }

    // Continue with next item
    setTimeout(() => this.processQueue(), 0);
  }

  /**
   * Clear queue
   */
  clear(): void {
    this.queue = [];
    this.loading = false;
  }
}

// Global progressive loader instance
export const progressiveLoader = new ProgressiveLoader();

/**
 * Export default object
 */
export default {
  lazyLoad,
  lazyRoute,
  prefetchComponent,
  createRouteGroup,
  trackBundleSize,
  getBundleSizeReport,
  smartLoad,
  ProgressiveLoader,
  progressiveLoader,
};
