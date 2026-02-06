/**
 * Project Detail Page Optimizations Integration
 *
 * This file provides integration utilities for the advanced optimizations:
 * - Performance monitoring
 * - Service worker for offline functionality
 * - Progressive file tree loading
 * - Editor instance pooling
 */

import { logger } from '@/utils/logger';
import performanceTracker from '@/utils/performance-tracker';
import serviceWorkerManager from '@/utils/service-worker-manager';
import { createEditorPoolManager, createMonacoEditorFactory } from '@/utils/editor-pool';
import type { Component, AsyncComponentLoader } from 'vue';

// ==================== 类型定义 ====================

/**
 * 初始化选项
 */
export interface InitializationOptions {
  enableOffline?: boolean;
  enableEditorPool?: boolean;
}

/**
 * 初始化结果
 */
export interface InitializationResults {
  performanceTracker: boolean;
  serviceWorker: boolean;
  editorPool: boolean;
}

/**
 * 文件信息
 */
export interface FileInfo {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: number;
}

/**
 * 文件树优化选项
 */
export interface FileTreeOptimizationOptions {
  batchSize?: number;
  priorityPaths?: string[];
}

/**
 * 懒加载器选项
 */
export interface LazyLoaderOptions {
  delay?: number;
  timeout?: number;
  errorComponent?: Component | null;
  loadingComponent?: Component | null;
}

/**
 * 懒加载器配置
 */
export interface LazyLoaderConfig extends LazyLoaderOptions {
  loader: AsyncComponentLoader;
}

/**
 * 内存使用信息
 */
export interface MemoryInfo {
  used: number;
  total: number;
  limit: number;
}

/**
 * 性能事件监听器
 */
export type PerformanceEventListener = (event: string, data: any) => void;

/**
 * 在线状态回调
 */
export type OnlineStatusCallback = (isOnline: boolean, data?: any) => void;

/**
 * 内存使用回调
 */
export type MemoryUsageCallback = (memory: MemoryInfo) => void;

/**
 * 编辑器池管理器类型
 */
export interface EditorPoolManager {
  getPool: (type: string) => any;
  acquire: (containerId: string, options: any) => Promise<any>;
  release: (containerId: string, type: string) => boolean;
  clearAll: () => void;
  pruneAll: (maxAge?: number) => void;
  getAllStats: () => Record<string, any>;
  resizeAll: () => void;
  setTheme: (theme: string) => void;
}

/**
 * Monaco 编辑器接口
 */
export interface MonacoNamespace {
  editor: {
    create: (container: HTMLElement, options: any) => any;
  };
}

/**
 * Electron IPC 接口
 */
interface ElectronAPI {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
}

// ==================== 扩展全局类型 ====================

declare global {
  interface Window {
    electron?: ElectronAPI;
  }

  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }
}

// ==================== 函数实现 ====================

/**
 * Initialize all optimizations
 */
export async function initializeOptimizations(
  options: InitializationOptions = {}
): Promise<InitializationResults> {
  const results: InitializationResults = {
    performanceTracker: false,
    serviceWorker: false,
    editorPool: false,
  };

  try {
    // Initialize performance tracker
    logger.info('[Optimizations] Initializing performance tracker...');
    results.performanceTracker = true;

    // Register service worker for offline functionality
    if (options.enableOffline !== false) {
      logger.info('[Optimizations] Registering service worker...');
      results.serviceWorker = await serviceWorkerManager.register();

      if (results.serviceWorker) {
        logger.info('[Optimizations] Service worker registered successfully');
      } else {
        logger.warn('[Optimizations] Service worker registration failed');
      }
    }

    // Initialize editor pool
    if (options.enableEditorPool !== false) {
      logger.info('[Optimizations] Initializing editor pool...');
      results.editorPool = true;
    }

    logger.info('[Optimizations] Initialization complete:', results);
    return results;
  } catch (error) {
    logger.error('[Optimizations] Initialization failed:', error);
    return results;
  }
}

/**
 * Create editor pool manager with Monaco factory
 */
export function createEditorPool(monaco: MonacoNamespace): EditorPoolManager {
  return createEditorPoolManager({
    maxPoolSize: 10,
    editorFactory: createMonacoEditorFactory(monaco),
  });
}

/**
 * Setup performance monitoring for file operations
 */
export function setupFileOperationTracking(): () => void {
  // Track file reads
  const originalInvoke = window.electron?.invoke;

  if (originalInvoke && window.electron) {
    window.electron.invoke = async function (
      channel: string,
      ...args: any[]
    ): Promise<any> {
      if (channel === 'read-file' || channel === 'get-file-content') {
        const startTime = performance.now();
        try {
          const result = await originalInvoke.call(this, channel, ...args);
          performanceTracker.trackFileOperation(
            'read-file',
            (args[0] as any)?.path || 'unknown',
            startTime
          );
          return result;
        } catch (error) {
          performanceTracker.trackFileOperation(
            'read-file-error',
            (args[0] as any)?.path || 'unknown',
            startTime
          );
          throw error;
        }
      }

      return originalInvoke.call(this, channel, ...args);
    };
  }

  return () => {
    // Cleanup function
    if (originalInvoke && window.electron) {
      window.electron.invoke = originalInvoke;
    }
  };
}

/**
 * Setup performance monitoring for AI responses
 */
export function setupAiResponseTracking(_conversationStore?: any): () => void {
  const unsubscribe = performanceTracker.addListener(
    (event: string, data: any) => {
      if (event === 'aiResponse') {
        logger.info('[AI Response]', data);
      }
    }
  );

  return unsubscribe;
}

/**
 * Prefetch project data for offline access
 */
export async function prefetchProjectForOffline(
  projectId: string
): Promise<boolean> {
  try {
    const success = await serviceWorkerManager.prefetchProject(projectId);

    if (success) {
      logger.info(`[Offline] Project ${projectId} prefetched successfully`);
      return true;
    } else {
      logger.warn(`[Offline] Failed to prefetch project ${projectId}`);
      return false;
    }
  } catch (error) {
    logger.error('[Offline] Prefetch error:', error);
    return false;
  }
}

/**
 * Check if project is available offline
 */
export async function isProjectAvailableOffline(
  projectId: string
): Promise<boolean> {
  try {
    return await serviceWorkerManager.isProjectCached(projectId);
  } catch (error) {
    logger.error('[Offline] Cache check error:', error);
    return false;
  }
}

/**
 * Get performance metrics
 */
export function getPerformanceMetrics(): ReturnType<typeof performanceTracker.getAllMetrics> {
  return performanceTracker.getAllMetrics();
}

/**
 * Get cache statistics
 */
export async function getCacheStatistics(): Promise<{
  size: number;
  entries: number;
} | null> {
  try {
    const cacheSize = await serviceWorkerManager.getCacheSize();
    return cacheSize.data || null;
  } catch (error) {
    logger.error('[Cache] Failed to get statistics:', error);
    return null;
  }
}

/**
 * Clear all caches
 */
export async function clearAllCaches(): Promise<boolean> {
  try {
    await serviceWorkerManager.clearCache();
    logger.info('[Cache] All caches cleared');
    return true;
  } catch (error) {
    logger.error('[Cache] Failed to clear caches:', error);
    return false;
  }
}

/**
 * Monitor online/offline status
 */
export function setupOnlineStatusMonitoring(
  callback: OnlineStatusCallback
): () => void {
  const unsubscribe = serviceWorkerManager.addListener(
    (event: string, data?: any) => {
      if (event === 'online' || event === 'offline') {
        callback(event === 'online', data);
      }
    }
  );

  // Initial status
  callback(serviceWorkerManager.checkOnline());

  return unsubscribe;
}

/**
 * Optimize file tree loading
 */
export function optimizeFileTreeLoading(
  files: FileInfo[],
  options: FileTreeOptimizationOptions = {}
): FileInfo[][] {
  const { batchSize = 50, priorityPaths = [] } = options;

  // Sort files: priority paths first, then by depth, then alphabetically
  const sortedFiles = [...files].sort((a, b) => {
    // Check priority
    const aPriority = priorityPaths.some((path) => a.path.startsWith(path));
    const bPriority = priorityPaths.some((path) => b.path.startsWith(path));

    if (aPriority && !bPriority) {
      return -1;
    }
    if (!aPriority && bPriority) {
      return 1;
    }

    // Sort by depth (shallower first)
    const aDepth = a.path.split('/').length;
    const bDepth = b.path.split('/').length;

    if (aDepth !== bDepth) {
      return aDepth - bDepth;
    }

    // Sort alphabetically
    return a.path.localeCompare(b.path);
  });

  // Split into batches
  const batches: FileInfo[][] = [];
  for (let i = 0; i < sortedFiles.length; i += batchSize) {
    batches.push(sortedFiles.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Debounce function for performance
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return function (this: any, ...args: Parameters<T>): void {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle function for performance
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return function (this: any, ...args: Parameters<T>): void {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Measure component render time
 */
export function measureRenderTime(componentName: string): () => void {
  const startMark = `${componentName}-render-start`;
  const endMark = `${componentName}-render-end`;
  const measureName = `${componentName}-render`;

  performance.mark(startMark);

  return (): void => {
    performance.mark(endMark);
    try {
      performance.measure(measureName, startMark, endMark);
      const measure = performance.getEntriesByName(measureName)[0];
      logger.info(`[Render] ${componentName}: ${Math.round(measure.duration)}ms`);

      // Clean up
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
      performance.clearMeasures(measureName);
    } catch (error) {
      logger.error('[Render] Measurement failed:', error);
    }
  };
}

/**
 * Create lazy loader for heavy components
 */
export function createLazyLoader(
  loader: AsyncComponentLoader,
  options: LazyLoaderOptions = {}
): LazyLoaderConfig {
  const {
    delay = 200,
    timeout = 10000,
    errorComponent = null,
    loadingComponent = null,
  } = options;

  return {
    loader,
    delay,
    timeout,
    errorComponent,
    loadingComponent,
  };
}

/**
 * Optimize image loading
 */
export function optimizeImageLoading(images: HTMLImageElement[]): () => void {
  // Use Intersection Observer for lazy loading
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          const src = img.dataset.src;

          if (src) {
            img.src = src;
            img.removeAttribute('data-src');
            observer.unobserve(img);
          }
        }
      });
    },
    {
      rootMargin: '50px',
    }
  );

  images.forEach((img) => observer.observe(img));

  return () => observer.disconnect();
}

/**
 * Batch DOM updates
 */
export function batchDOMUpdates(updates: Array<() => void>): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      updates.forEach((update) => update());
      resolve();
    });
  });
}

/**
 * Memory usage monitor
 */
export function monitorMemoryUsage(
  callback: MemoryUsageCallback,
  interval: number = 5000
): () => void {
  if (!performance.memory) {
    logger.warn('[Memory] Performance.memory not available');
    return () => {};
  }

  const intervalId = setInterval(() => {
    const memory: MemoryInfo = {
      used: Math.round(performance.memory!.usedJSHeapSize / 1024 / 1024),
      total: Math.round(performance.memory!.totalJSHeapSize / 1024 / 1024),
      limit: Math.round(performance.memory!.jsHeapSizeLimit / 1024 / 1024),
    };

    callback(memory);
  }, interval);

  return () => clearInterval(intervalId);
}

// ==================== 默认导出 ====================

export default {
  initializeOptimizations,
  createEditorPool,
  setupFileOperationTracking,
  setupAiResponseTracking,
  prefetchProjectForOffline,
  isProjectAvailableOffline,
  getPerformanceMetrics,
  getCacheStatistics,
  clearAllCaches,
  setupOnlineStatusMonitoring,
  optimizeFileTreeLoading,
  debounce,
  throttle,
  measureRenderTime,
  createLazyLoader,
  optimizeImageLoading,
  batchDOMUpdates,
  monitorMemoryUsage,
};
