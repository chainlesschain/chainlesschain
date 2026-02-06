/**
 * Component Lazy Loading Utility
 * 组件懒加载工具，支持动态导入、预加载、错误重试
 *
 * Features:
 * - Dynamic import with code splitting
 * - Component preloading
 * - Automatic retry on failure
 * - Loading and error states
 * - Route-level lazy loading
 * - Prefetch on hover/visibility
 */

import { defineAsyncComponent, type Component, type AsyncComponentLoader } from 'vue';
import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 加载器配置选项
 */
export interface ComponentLazyLoaderOptions {
  /** Delay before showing loading component (ms) */
  delay?: number;
  /** Timeout for loading (ms) */
  timeout?: number;
  /** Max retry attempts */
  maxRetries?: number;
  /** Retry delay (ms) */
  retryDelay?: number;
  /** Enable prefetch */
  enablePrefetch?: boolean;
  /** Prefetch delay (ms) */
  prefetchDelay?: number;
  /** Debug mode */
  debug?: boolean;
}

/**
 * 创建懒加载组件的选项
 */
export interface CreateLazyComponentOptions {
  /** Loading component */
  loadingComponent?: Component;
  /** Error component */
  errorComponent?: Component;
  /** Delay before showing loading component */
  delay?: number;
  /** Timeout for loading */
  timeout?: number;
  /** Error callback */
  onError?: (error: Error) => void;
}

/**
 * 路由配置
 */
export interface RouteConfig {
  /** Route path */
  path?: string;
  /** Route name */
  name?: string;
  /** Route component (function or loader) */
  component?: (() => Promise<Component>) | Component;
  /** Loading component for this route */
  loadingComponent?: Component;
  /** Error component for this route */
  errorComponent?: Component;
  /** Child routes */
  children?: RouteConfig[];
  /** Other route properties */
  [key: string]: unknown;
}

/**
 * 加载器统计信息
 */
export interface LoaderStats {
  /** Total components created */
  totalComponents: number;
  /** Successfully loaded components */
  loadedComponents: number;
  /** Failed to load components */
  failedComponents: number;
  /** Prefetched components */
  prefetchedComponents: number;
  /** Average load time (ms) */
  averageLoadTime: number;
  /** Cache hit rate (percentage string) */
  cacheHitRate: string;
  /** Number of queued prefetches */
  queuedPrefetches: number;
  /** Number of cached components */
  cachedComponents: number;
}

/**
 * Prefetch on hover event handlers
 */
export interface PrefetchOnHoverHandlers {
  onMouseenter: () => void;
  onMouseleave: () => void;
}

// ==================== 组件懒加载器类 ====================

class ComponentLazyLoader {
  private options: Required<ComponentLazyLoaderOptions>;
  private loadedComponents: Map<string, Component>;
  private loadingComponents: Map<string, Promise<Component>>;
  private failedComponents: Map<string, number>;
  private prefetchQueue: Set<string>;
  private stats: {
    totalComponents: number;
    loadedComponents: number;
    failedComponents: number;
    prefetchedComponents: number;
    averageLoadTime: number;
    cacheHitRate: number;
  };

  constructor(options: ComponentLazyLoaderOptions = {}) {
    // Configuration
    this.options = {
      delay: options.delay ?? 200,
      timeout: options.timeout ?? 30000,
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      enablePrefetch: options.enablePrefetch !== false,
      prefetchDelay: options.prefetchDelay ?? 2000,
      debug: options.debug ?? false,
    };

    // State
    this.loadedComponents = new Map();
    this.loadingComponents = new Map();
    this.failedComponents = new Map();
    this.prefetchQueue = new Set();

    // Statistics
    this.stats = {
      totalComponents: 0,
      loadedComponents: 0,
      failedComponents: 0,
      prefetchedComponents: 0,
      averageLoadTime: 0,
      cacheHitRate: 0,
    };

    if (this.options.debug) {
      logger.info('[ComponentLazyLoader] Initialized');
    }
  }

  /**
   * Create lazy component with retry logic
   * @param importFn - Dynamic import function
   * @param options - Component options
   * @returns Vue async component
   */
  createLazyComponent(
    importFn: () => Promise<{ default: Component } | Component>,
    options: CreateLazyComponentOptions = {}
  ): Component {
    this.stats.totalComponents++;

    const {
      loadingComponent,
      errorComponent,
      delay = this.options.delay,
      timeout = this.options.timeout,
      onError,
    } = options;

    return defineAsyncComponent({
      loader: async () => {
        const startTime = performance.now();

        try {
          const component = await this.loadWithRetry(importFn);
          const loadTime = performance.now() - startTime;

          this.stats.loadedComponents++;
          this.updateAverageLoadTime(loadTime);

          if (this.options.debug) {
            logger.info(`[ComponentLazyLoader] Loaded component (${Math.round(loadTime)}ms)`);
          }

          return component;
        } catch (error) {
          this.stats.failedComponents++;

          if (onError) {
            onError(error as Error);
          }

          throw error;
        }
      },

      loadingComponent: loadingComponent || this.getDefaultLoadingComponent(),
      errorComponent: errorComponent || this.getDefaultErrorComponent(),
      delay,
      timeout,
    });
  }

  /**
   * Load component with retry mechanism
   */
  private async loadWithRetry(
    importFn: () => Promise<{ default: Component } | Component>,
    retryCount: number = 0
  ): Promise<Component> {
    try {
      const module = await importFn();
      // Handle both default exports and direct component exports
      return 'default' in module ? module.default : module;
    } catch (error) {
      if (retryCount < this.options.maxRetries) {
        if (this.options.debug) {
          logger.info(
            `[ComponentLazyLoader] Retry ${retryCount + 1}/${this.options.maxRetries}`
          );
        }

        // Wait before retrying (exponential backoff)
        await this.delay(this.options.retryDelay * Math.pow(2, retryCount));

        return this.loadWithRetry(importFn, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Prefetch component (load in background)
   * @param importFn - Dynamic import function
   */
  async prefetch(importFn: () => Promise<{ default: Component } | Component>): Promise<void> {
    if (!this.options.enablePrefetch) {
      return;
    }

    const key = importFn.toString();

    // Already loaded or loading
    if (this.loadedComponents.has(key) || this.loadingComponents.has(key)) {
      return;
    }

    // Add to queue
    this.prefetchQueue.add(key);

    try {
      const loadingPromise = importFn().then((module) => {
        return 'default' in module ? module.default : module;
      });
      this.loadingComponents.set(key, loadingPromise);

      const component = await loadingPromise;

      this.loadedComponents.set(key, component);
      this.stats.prefetchedComponents++;

      if (this.options.debug) {
        logger.info('[ComponentLazyLoader] Prefetched component');
      }
    } catch (error) {
      logger.error('[ComponentLazyLoader] Prefetch failed:', { error });
    } finally {
      this.loadingComponents.delete(key);
      this.prefetchQueue.delete(key);
    }
  }

  /**
   * Prefetch on hover
   * @param importFn - Dynamic import function
   * @returns Event handlers
   */
  prefetchOnHover(
    importFn: () => Promise<{ default: Component } | Component>
  ): PrefetchOnHoverHandlers {
    let prefetchTimer: ReturnType<typeof setTimeout> | null = null;

    return {
      onMouseenter: () => {
        prefetchTimer = setTimeout(() => {
          this.prefetch(importFn);
        }, this.options.prefetchDelay);
      },

      onMouseleave: () => {
        if (prefetchTimer) {
          clearTimeout(prefetchTimer);
          prefetchTimer = null;
        }
      },
    };
  }

  /**
   * Prefetch on visibility (Intersection Observer)
   * @param element - Element to observe
   * @param importFn - Dynamic import function
   * @returns Cleanup function
   */
  prefetchOnVisible(
    element: HTMLElement,
    importFn: () => Promise<{ default: Component } | Component>
  ): (() => void) | undefined {
    if (!('IntersectionObserver' in window)) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.prefetch(importFn);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '50px',
      }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }

  /**
   * Create route-level lazy components
   * @param routes - Route configurations
   * @returns Routes with lazy components
   */
  createLazyRoutes(routes: RouteConfig[]): RouteConfig[] {
    return routes.map((route) => {
      if (route.component && typeof route.component === 'function') {
        return {
          ...route,
          component: this.createLazyComponent(
            route.component as () => Promise<{ default: Component }>,
            {
              loadingComponent: route.loadingComponent,
              errorComponent: route.errorComponent,
            }
          ),
        };
      }

      // Process nested routes
      if (route.children) {
        return {
          ...route,
          children: this.createLazyRoutes(route.children),
        };
      }

      return route;
    });
  }

  /**
   * Preload critical routes
   * @param routePaths - Route paths to preload
   */
  preloadRoutes(routePaths: string[]): void {
    if (this.options.debug) {
      logger.info(`[ComponentLazyLoader] Preloading ${routePaths.length} routes`);
    }

    routePaths.forEach((path) => {
      // This requires route configuration to be accessible
      // Implementation depends on router setup
      if (this.options.debug) {
        logger.info(`[ComponentLazyLoader] Preloading route: ${path}`);
      }
    });
  }

  /**
   * Get default loading component
   */
  private getDefaultLoadingComponent(): Component {
    return {
      template: `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 200px; color: #1890ff;">
          <div style="text-align: center;">
            <div class="spinner" style="margin: 0 auto 12px;"></div>
            <div style="font-size: 14px;">Loading...</div>
          </div>
        </div>
      `,
    };
  }

  /**
   * Get default error component
   */
  private getDefaultErrorComponent(): Component {
    return {
      template: `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 200px; color: #ff4d4f;">
          <div style="text-align: center;">
            <div style="font-size: 48px; margin-bottom: 12px;">Warning</div>
            <div style="font-size: 14px; margin-bottom: 12px;">Failed to load component</div>
            <button @click="retry" style="padding: 6px 16px; cursor: pointer;">Retry</button>
          </div>
        </div>
      `,
      methods: {
        retry(): void {
          window.location.reload();
        },
      },
    };
  }

  /**
   * Update average load time
   */
  private updateAverageLoadTime(newTime: number): void {
    const count = this.stats.loadedComponents;
    this.stats.averageLoadTime = (this.stats.averageLoadTime * (count - 1) + newTime) / count;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get statistics
   */
  getStats(): LoaderStats {
    const totalLoaded = this.stats.loadedComponents + this.stats.prefetchedComponents;
    const cacheHitRate =
      this.stats.totalComponents > 0
        ? Math.round((totalLoaded / this.stats.totalComponents) * 100)
        : 0;

    return {
      ...this.stats,
      cacheHitRate: `${cacheHitRate}%`,
      queuedPrefetches: this.prefetchQueue.size,
      cachedComponents: this.loadedComponents.size,
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.loadedComponents.clear();
    this.loadingComponents.clear();
    this.failedComponents.clear();

    if (this.options.debug) {
      logger.info('[ComponentLazyLoader] Cache cleared');
    }
  }

  /**
   * Destroy
   */
  destroy(): void {
    this.clearCache();
    this.prefetchQueue.clear();

    if (this.options.debug) {
      logger.info('[ComponentLazyLoader] Destroyed');
    }
  }
}

// Singleton instance
let loaderInstance: ComponentLazyLoader | null = null;

/**
 * Get or create component lazy loader instance
 */
export function getComponentLazyLoader(
  options?: ComponentLazyLoaderOptions
): ComponentLazyLoader {
  if (!loaderInstance) {
    loaderInstance = new ComponentLazyLoader(options);
  }
  return loaderInstance;
}

/**
 * Convenience function: create lazy component
 */
export function lazyComponent(
  importFn: () => Promise<{ default: Component } | Component>,
  options?: CreateLazyComponentOptions
): Component {
  const loader = getComponentLazyLoader();
  return loader.createLazyComponent(importFn, options);
}

/**
 * Convenience function: create lazy routes
 */
export function lazyRoutes(routes: RouteConfig[]): RouteConfig[] {
  const loader = getComponentLazyLoader();
  return loader.createLazyRoutes(routes);
}

export default ComponentLazyLoader;
