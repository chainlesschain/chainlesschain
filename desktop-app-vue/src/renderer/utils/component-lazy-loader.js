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

import { defineAsyncComponent } from "vue";
import { createLogger } from "@/utils/logger";

const logger = createLogger("component-lazy-loader");

class ComponentLazyLoader {
  constructor(options = {}) {
    // Configuration
    this.options = {
      delay: options.delay || 200, // ms - delay before showing loading component
      timeout: options.timeout || 30000, // ms - timeout for loading
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000, // ms
      enablePrefetch: options.enablePrefetch !== false,
      prefetchDelay: options.prefetchDelay || 2000, // ms - delay before prefetching
      debug: options.debug || false,
    };

    // State
    this.loadedComponents = new Map(); // path -> component
    this.loadingComponents = new Map(); // path -> Promise
    this.failedComponents = new Map(); // path -> retry count
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
      logger.info("[ComponentLazyLoader] Initialized");
    }
  }

  /**
   * Create lazy component with retry logic
   * @param {Function} importFn - Dynamic import function
   * @param {Object} options - Component options
   * @returns {Component} Vue async component
   */
  createLazyComponent(importFn, options = {}) {
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
            logger.info(
              `[ComponentLazyLoader] Loaded component (${Math.round(loadTime)}ms)`,
            );
          }

          return component;
        } catch (error) {
          this.stats.failedComponents++;

          if (onError) {
            onError(error);
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
  async loadWithRetry(importFn, retryCount = 0) {
    try {
      return await importFn();
    } catch (error) {
      if (retryCount < this.options.maxRetries) {
        if (this.options.debug) {
          logger.info(
            `[ComponentLazyLoader] Retry ${retryCount + 1}/${this.options.maxRetries}`,
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
   * @param {Function} importFn - Dynamic import function
   */
  async prefetch(importFn) {
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
      const loadingPromise = importFn();
      this.loadingComponents.set(key, loadingPromise);

      const component = await loadingPromise;

      this.loadedComponents.set(key, component);
      this.stats.prefetchedComponents++;

      if (this.options.debug) {
        logger.info("[ComponentLazyLoader] Prefetched component");
      }
    } catch (error) {
      logger.error("[ComponentLazyLoader] Prefetch failed:", error);
    } finally {
      this.loadingComponents.delete(key);
      this.prefetchQueue.delete(key);
    }
  }

  /**
   * Prefetch on hover
   * @param {Function} importFn - Dynamic import function
   * @returns {Object} Event handlers
   */
  prefetchOnHover(importFn) {
    let prefetchTimer = null;

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
   * @param {HTMLElement} element - Element to observe
   * @param {Function} importFn - Dynamic import function
   */
  prefetchOnVisible(element, importFn) {
    if (!("IntersectionObserver" in window)) {
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
        rootMargin: "50px",
      },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }

  /**
   * Create route-level lazy components
   * @param {Array} routes - Route configurations
   * @returns {Array} Routes with lazy components
   */
  createLazyRoutes(routes) {
    return routes.map((route) => {
      if (route.component && typeof route.component === "function") {
        return {
          ...route,
          component: this.createLazyComponent(route.component, {
            loadingComponent: route.loadingComponent,
            errorComponent: route.errorComponent,
          }),
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
   * @param {Array} routePaths - Route paths to preload
   */
  preloadRoutes(routePaths) {
    if (this.options.debug) {
      logger.info(
        `[ComponentLazyLoader] Preloading ${routePaths.length} routes`,
      );
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
  getDefaultLoadingComponent() {
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
  getDefaultErrorComponent() {
    return {
      template: `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 200px; color: #ff4d4f;">
          <div style="text-align: center;">
            <div style="font-size: 48px; margin-bottom: 12px;">⚠️</div>
            <div style="font-size: 14px; margin-bottom: 12px;">Failed to load component</div>
            <button @click="retry" style="padding: 6px 16px; cursor: pointer;">Retry</button>
          </div>
        </div>
      `,
      methods: {
        retry() {
          window.location.reload();
        },
      },
    };
  }

  /**
   * Update average load time
   */
  updateAverageLoadTime(newTime) {
    const count = this.stats.loadedComponents;
    this.stats.averageLoadTime =
      (this.stats.averageLoadTime * (count - 1) + newTime) / count;
  }

  /**
   * Delay utility
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get statistics
   */
  getStats() {
    const totalLoaded =
      this.stats.loadedComponents + this.stats.prefetchedComponents;
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
  clearCache() {
    this.loadedComponents.clear();
    this.loadingComponents.clear();
    this.failedComponents.clear();

    if (this.options.debug) {
      logger.info("[ComponentLazyLoader] Cache cleared");
    }
  }

  /**
   * Destroy
   */
  destroy() {
    this.clearCache();
    this.prefetchQueue.clear();

    if (this.options.debug) {
      logger.info("[ComponentLazyLoader] Destroyed");
    }
  }
}

// Singleton instance
let loaderInstance = null;

/**
 * Get or create component lazy loader instance
 */
export function getComponentLazyLoader(options) {
  if (!loaderInstance) {
    loaderInstance = new ComponentLazyLoader(options);
  }
  return loaderInstance;
}

/**
 * Convenience function: create lazy component
 */
export function lazyComponent(importFn, options) {
  const loader = getComponentLazyLoader();
  return loader.createLazyComponent(importFn, options);
}

/**
 * Convenience function: create lazy routes
 */
export function lazyRoutes(routes) {
  const loader = getComponentLazyLoader();
  return loader.createLazyRoutes(routes);
}

export default ComponentLazyLoader;
