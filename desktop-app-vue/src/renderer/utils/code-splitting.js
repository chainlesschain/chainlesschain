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

import { defineAsyncComponent, h } from 'vue';
import { prefetch } from './resource-hints';

/**
 * Create a lazy-loaded component with advanced features
 * 创建具有高级功能的懒加载组件
 *
 * @param {Function} loader - Component loader function
 * @param {Object} options - Options
 * @returns {Component}
 */
export function lazyLoad(loader, options = {}) {
  const {
    // Loading component
    loadingComponent = null,

    // Error component
    errorComponent = null,

    // Delay before showing loading component (ms)
    delay = 200,

    // Timeout for loading (ms)
    timeout = 30000,

    // Retry attempts on failure
    retryAttempts = 3,

    // Retry delay (ms)
    retryDelay = 1000,

    // Chunk name for debugging
    chunkName = 'async-component',

    // Enable prefetch on hover
    prefetchOnHover = false,

    // Enable prefetch on viewport
    prefetchOnViewport = false,

    // Callback when loaded
    onLoaded = null,

    // Callback on error
    onError = null,
  } = options;

  let retryCount = 0;

  // Wrap loader with retry logic
  const loaderWithRetry = async () => {
    try {
      const component = await loader();

      if (onLoaded) {
        onLoaded(component);
      }

      console.log(`[CodeSplitting] ✓ Component loaded: ${chunkName}`);
      return component;
    } catch (error) {
      console.error(`[CodeSplitting] ✗ Load failed (attempt ${retryCount + 1}/${retryAttempts}):`, chunkName, error);

      if (retryCount < retryAttempts - 1) {
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, retryDelay * retryCount));
        return loaderWithRetry();
      }

      if (onError) {
        onError(error);
      }

      throw error;
    }
  };

  // Create async component
  const asyncComponent = defineAsyncComponent({
    loader: loaderWithRetry,
    loadingComponent,
    errorComponent,
    delay,
    timeout,

    // Handle loading errors
    onError(error, retry, fail, attempts) {
      console.error(`[CodeSplitting] Error loading ${chunkName} (attempt ${attempts}):`, error);

      if (attempts <= retryAttempts) {
        console.log(`[CodeSplitting] Retrying... (${attempts}/${retryAttempts})`);
        setTimeout(() => retry(), retryDelay * attempts);
      } else {
        console.error(`[CodeSplitting] Failed to load ${chunkName} after ${retryAttempts} attempts`);
        fail();
      }
    },
  });

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
 * @param {Function} loader - Component loader
 * @param {Object} options - Options
 * @returns {Component}
 */
export function lazyRoute(loader, options = {}) {
  const {
    chunkName,
    loadingComponent = () => h('div', { class: 'route-loading' }, 'Loading...'),
    errorComponent = () => h('div', { class: 'route-error' }, 'Failed to load page'),
    ...restOptions
  } = options;

  return lazyLoad(loader, {
    chunkName: chunkName || 'route',
    loadingComponent,
    errorComponent,
    delay: 0, // Show loading immediately for routes
    timeout: 15000, // 15s timeout for routes
    retryAttempts: 3,
    ...restOptions,
  });
}

/**
 * Prefetch component
 * 预取组件
 *
 * @param {Function} loader - Component loader
 * @param {string} chunkName - Chunk name
 */
export function prefetchComponent(loader, chunkName = 'component') {
  console.log(`[CodeSplitting] Prefetching: ${chunkName}`);

  // Trigger loader to prefetch chunk
  loader().catch(error => {
    console.warn(`[CodeSplitting] Prefetch failed for ${chunkName}:`, error);
  });
}

/**
 * Create route group with shared chunk
 * 创建共享chunk的路由组
 *
 * @param {string} groupName - Group name
 * @param {Object} routes - Routes in group
 * @returns {Object}
 */
export function createRouteGroup(groupName, routes) {
  const groupedRoutes = {};

  Object.keys(routes).forEach(key => {
    const route = routes[key];
    const loader = route.loader || route;

    groupedRoutes[key] = lazyRoute(loader, {
      chunkName: `${groupName}-${key}`,
      ...route.options,
    });
  });

  return groupedRoutes;
}

/**
 * Analyze bundle size (development only)
 * 分析bundle大小（仅开发环境）
 *
 * @param {string} chunkName - Chunk name
 * @param {number} size - Size in bytes
 */
export function trackBundleSize(chunkName, size) {
  if (import.meta.env.DEV) {
    const sizeKB = (size / 1024).toFixed(2);
    const sizeColor = size > 100 * 1024 ? 'red' : size > 50 * 1024 ? 'orange' : 'green';

    console.log(
      `%c[BundleSize] ${chunkName}: ${sizeKB} KB`,
      `color: ${sizeColor}; font-weight: bold`
    );

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
 * @returns {Object}
 */
export function getBundleSizeReport() {
  if (!window.__BUNDLE_SIZE_TRACKER__) {
    return { chunks: {}, total: 0 };
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
 * @param {Function} loader - Component loader
 * @param {Object} options - Options
 * @returns {Object}
 */
export function smartLoad(loader, options = {}) {
  const {
    prefetchDelay = 100,
    chunkName = 'smart-component',
  } = options;

  let prefetched = false;
  let hoverTimeout = null;

  const component = lazyLoad(loader, {
    ...options,
    chunkName,
  });

  // Add prefetch methods
  component.prefetchOnHover = (element) => {
    if (!element) {return;}

    element.addEventListener('mouseenter', () => {
      if (prefetched) {return;}

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

  component.prefetchOnVisible = (element) => {
    if (!element || prefetched) {return;}

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !prefetched) {
          prefetchComponent(loader, chunkName);
          prefetched = true;
          observer.disconnect();
        }
      });
    }, {
      threshold: 0.1,
    });

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
  constructor() {
    this.queue = [];
    this.loading = false;
    this.loaded = new Set();
  }

  /**
   * Add component to load queue
   */
  add(loader, priority = 'normal', chunkName = 'component') {
    const priorityMap = { high: 3, normal: 2, low: 1 };

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
  async processQueue() {
    if (this.queue.length === 0) {
      this.loading = false;
      return;
    }

    this.loading = true;
    const item = this.queue.shift();

    if (this.loaded.has(item.chunkName)) {
      return this.processQueue();
    }

    try {
      console.log(`[ProgressiveLoader] Loading: ${item.chunkName} (priority: ${item.priority})`);
      await item.loader();
      this.loaded.add(item.chunkName);
      console.log(`[ProgressiveLoader] ✓ Loaded: ${item.chunkName}`);
    } catch (error) {
      console.error(`[ProgressiveLoader] ✗ Failed: ${item.chunkName}`, error);
    }

    // Continue with next item
    setTimeout(() => this.processQueue(), 0);
  }

  /**
   * Clear queue
   */
  clear() {
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
