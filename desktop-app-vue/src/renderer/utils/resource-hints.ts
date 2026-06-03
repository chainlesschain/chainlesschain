import { logger } from '@/utils/logger';

/**
 * Resource Hints Utility
 * 资源提示工具
 *
 * Features:
 * - DNS Prefetch (DNS预解析)
 * - Preconnect (预连接)
 * - Prefetch (预加载)
 * - Preload (预加载关键资源)
 * - Prerender (预渲染)
 *
 * @see https://www.w3.org/TR/resource-hints/
 */

// ==================== Type Definitions ====================

/**
 * Resource type for preload/prefetch
 */
export type ResourceAsType =
  | 'audio'
  | 'document'
  | 'embed'
  | 'fetch'
  | 'font'
  | 'image'
  | 'object'
  | 'script'
  | 'style'
  | 'track'
  | 'video'
  | 'worker';

/**
 * Hint type for resource hints
 */
export type HintType =
  | 'dns-prefetch'
  | 'preconnect'
  | 'prefetch'
  | 'preload'
  | 'prerender'
  | 'modulepreload';

/**
 * Cross-origin values
 */
export type CrossOriginValue = 'anonymous' | 'use-credentials';

/**
 * Preload options
 */
export interface PreloadOptions {
  crossOrigin?: CrossOriginValue | boolean;
  type?: string;
  media?: string;
  integrity?: string;
}

/**
 * Hint configuration for batch operations
 */
export interface HintConfig {
  type: HintType;
  url: string;
  as?: ResourceAsType | '';
  options?: PreloadOptions & {
    crossOrigin?: boolean;
  };
}

/**
 * Route resources configuration
 */
export interface RouteResources {
  scripts?: string[];
  styles?: string[];
  fonts?: string[];
  images?: string[];
  nextPages?: string[];
}

/**
 * Intelligent prefetcher options
 */
export interface IntelligentPrefetcherOptions {
  hoverDelay?: number;
  viewportThreshold?: number;
  maxConcurrent?: number;
  debug?: boolean;
}

/**
 * Prefetch queue item
 */
export interface PrefetchQueueItem {
  url: string;
  as: ResourceAsType | '';
  priority: PrefetchPriority;
}

/**
 * Prefetch priority
 */
export type PrefetchPriority = 'high' | 'normal' | 'low';

// ==================== Resource Hint Functions ====================

/**
 * Add DNS prefetch hint
 * 添加DNS预解析提示
 *
 * @param domain - Domain to prefetch
 */
export function dnsPrefetch(domain: string): void {
  if (!domain) return;

  const link = document.createElement('link');
  link.rel = 'dns-prefetch';
  link.href = domain;

  document.head.appendChild(link);

  logger.info(`[ResourceHints] DNS prefetch added: ${domain}`);
}

/**
 * Add preconnect hint
 * 添加预连接提示
 *
 * @param url - URL to preconnect
 * @param crossOrigin - Whether cross-origin
 */
export function preconnect(url: string, crossOrigin: boolean = false): void {
  if (!url) return;

  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = url;

  if (crossOrigin) {
    link.crossOrigin = 'anonymous';
  }

  document.head.appendChild(link);

  logger.info(`[ResourceHints] Preconnect added: ${url}`);
}

/**
 * Add prefetch hint
 * 添加预加载提示（低优先级）
 *
 * @param url - URL to prefetch
 * @param as - Resource type
 */
export function prefetch(url: string, as: ResourceAsType | '' = ''): void {
  if (!url) return;

  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = url;

  if (as) {
    link.as = as;
  }

  document.head.appendChild(link);

  logger.info(`[ResourceHints] Prefetch added: ${url} (as: ${as || 'auto'})`);
}

/**
 * Add preload hint
 * 添加预加载提示（高优先级）
 *
 * @param url - URL to preload
 * @param as - Resource type (required)
 * @param options - Additional options
 */
export function preload(url: string, as: ResourceAsType, options: PreloadOptions = {}): void {
  if (!url || !as) {
    logger.warn('[ResourceHints] Preload requires both url and as parameter');
    return;
  }

  const link = document.createElement('link');
  link.rel = 'preload';
  link.href = url;
  link.as = as;

  // Cross-origin
  if (options.crossOrigin) {
    link.crossOrigin = typeof options.crossOrigin === 'string'
      ? options.crossOrigin
      : 'anonymous';
  }

  // Type (for <script> and <style>)
  if (options.type) {
    link.type = options.type;
  }

  // Media query
  if (options.media) {
    link.media = options.media;
  }

  // Integrity
  if (options.integrity) {
    link.integrity = options.integrity;
  }

  document.head.appendChild(link);

  logger.info(`[ResourceHints] Preload added: ${url} (as: ${as})`);
}

/**
 * Add prerender hint
 * 添加预渲染提示
 *
 * @param url - URL to prerender
 */
export function prerender(url: string): void {
  if (!url) return;

  const link = document.createElement('link');
  link.rel = 'prerender';
  link.href = url;

  document.head.appendChild(link);

  logger.info(`[ResourceHints] Prerender added: ${url}`);
}

/**
 * Add modulepreload hint
 * 添加ES模块预加载提示
 *
 * @param url - Module URL to preload
 */
export function modulePreload(url: string): void {
  if (!url) return;

  const link = document.createElement('link');
  link.rel = 'modulepreload';
  link.href = url;

  document.head.appendChild(link);

  logger.info(`[ResourceHints] Module preload added: ${url}`);
}

/**
 * Batch add resource hints
 * 批量添加资源提示
 *
 * @param hints - Array of hint configs
 */
export function batchAddHints(hints: HintConfig[]): void {
  hints.forEach((hint) => {
    const { type, url, as, options } = hint;

    switch (type) {
      case 'dns-prefetch':
        dnsPrefetch(url);
        break;
      case 'preconnect':
        preconnect(url, options?.crossOrigin);
        break;
      case 'prefetch':
        prefetch(url, as);
        break;
      case 'preload':
        preload(url, as as ResourceAsType, options);
        break;
      case 'prerender':
        prerender(url);
        break;
      case 'modulepreload':
        modulePreload(url);
        break;
      default:
        logger.warn(`[ResourceHints] Unknown hint type: ${type}`);
    }
  });
}

/**
 * Remove resource hint
 * 移除资源提示
 *
 * @param rel - Hint type
 * @param href - URL
 */
export function removeHint(rel: HintType, href: string): void {
  const links = document.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"][href="${href}"]`);
  links.forEach((link) => link.remove());

  logger.info(`[ResourceHints] Hint removed: ${rel} ${href}`);
}

/**
 * Clear all hints of a specific type
 * 清除特定类型的所有提示
 *
 * @param rel - Hint type
 */
export function clearHintsByType(rel: HintType): void {
  const links = document.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`);
  links.forEach((link) => link.remove());

  logger.info(`[ResourceHints] Cleared all hints of type: ${rel}`);
}

/**
 * Preload critical resources for route
 * 为路由预加载关键资源
 *
 * @param route - Route path
 * @param resources - Resources to preload
 */
export function preloadRouteResources(route: string, resources: RouteResources = {}): void {
  logger.info(`[ResourceHints] Preloading resources for route: ${route}`);

  // Preload scripts
  if (resources.scripts) {
    resources.scripts.forEach((script) => {
      if (script.endsWith('.mjs') || script.includes('type=module')) {
        modulePreload(script);
      } else {
        preload(script, 'script');
      }
    });
  }

  // Preload styles
  if (resources.styles) {
    resources.styles.forEach((style) => {
      preload(style, 'style');
    });
  }

  // Preload fonts
  if (resources.fonts) {
    resources.fonts.forEach((font) => {
      preload(font, 'font', { crossOrigin: 'anonymous' });
    });
  }

  // Preload images
  if (resources.images) {
    resources.images.forEach((image) => {
      preload(image, 'image');
    });
  }

  // Prefetch next pages
  if (resources.nextPages) {
    resources.nextPages.forEach((page) => {
      prefetch(page, 'document');
    });
  }
}

/**
 * Setup common resource hints
 * 设置常用资源提示
 */
export function setupCommonHints(): void {
  logger.info('[ResourceHints] Setting up common resource hints...');

  // DNS prefetch for common domains
  const commonDomains = [
    '//fonts.googleapis.com',
    '//fonts.gstatic.com',
    '//cdn.jsdelivr.net',
    '//unpkg.com',
  ];

  commonDomains.forEach((domain) => {
    dnsPrefetch(domain);
  });

  // Preconnect to API server (if configured)
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (apiBaseUrl) {
    preconnect(apiBaseUrl, true);
  }

  logger.info('[ResourceHints] Common hints setup complete');
}

// ==================== Intelligent Prefetcher Class ====================

/**
 * Intelligent prefetch based on user behavior
 * 基于用户行为的智能预取
 */
export class IntelligentPrefetcher {
  private options: Required<IntelligentPrefetcherOptions>;
  private queue: PrefetchQueueItem[] = [];
  private inFlight: Set<string> = new Set();
  private observer: IntersectionObserver | null = null;

  constructor(options: IntelligentPrefetcherOptions = {}) {
    this.options = {
      hoverDelay: options.hoverDelay ?? 100,
      viewportThreshold: options.viewportThreshold ?? 0.5,
      maxConcurrent: options.maxConcurrent ?? 3,
      debug: options.debug ?? false,
    };

    this.queue = [];
    this.inFlight = new Set();
    this.observer = null;

    this.init();
  }

  private init(): void {
    // Setup viewport observer
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const target = entry.target as HTMLElement;
            const url = target.dataset.prefetchUrl;
            const as = (target.dataset.prefetchAs || 'fetch') as ResourceAsType | '';

            if (url) {
              this.addToQueue(url, as, 'low');
            }
          }
        });
      },
      {
        threshold: this.options.viewportThreshold,
      }
    );

    if (this.options.debug) {
      logger.info('[IntelligentPrefetcher] Initialized');
    }
  }

  /**
   * Observe element for viewport prefetch
   */
  observe(element: HTMLElement | null, url: string, as: ResourceAsType | '' = 'fetch'): void {
    if (!element) return;

    element.dataset.prefetchUrl = url;
    element.dataset.prefetchAs = as;

    this.observer?.observe(element);
  }

  /**
   * Setup hover prefetch
   */
  onHover(element: HTMLElement | null, url: string, as: ResourceAsType | '' = 'fetch'): void {
    if (!element) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    element.addEventListener('mouseenter', () => {
      timeoutId = setTimeout(() => {
        this.addToQueue(url, as, 'normal');
      }, this.options.hoverDelay);
    });

    element.addEventListener('mouseleave', () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    });
  }

  /**
   * Add to prefetch queue
   */
  addToQueue(url: string, as: ResourceAsType | '', priority: PrefetchPriority = 'low'): void {
    // Skip if already in flight or queued
    if (this.inFlight.has(url) || this.queue.some((item) => item.url === url)) {
      return;
    }

    this.queue.push({ url, as, priority });

    // Sort by priority
    this.queue.sort((a, b) => {
      const priorityMap: Record<PrefetchPriority, number> = { high: 3, normal: 2, low: 1 };
      return priorityMap[b.priority] - priorityMap[a.priority];
    });

    this.processQueue();
  }

  /**
   * Process prefetch queue
   */
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.inFlight.size < this.options.maxConcurrent) {
      const item = this.queue.shift();

      if (!item) continue;

      this.inFlight.add(item.url);

      try {
        prefetch(item.url, item.as);

        if (this.options.debug) {
          logger.info(`[IntelligentPrefetcher] Prefetched: ${item.url}`);
        }
      } catch (error) {
        logger.error('[IntelligentPrefetcher] Prefetch failed:', { error });
      } finally {
        this.inFlight.delete(item.url);
      }
    }
  }

  /**
   * Destroy
   */
  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.queue = [];
    this.inFlight.clear();

    if (this.options.debug) {
      logger.info('[IntelligentPrefetcher] Destroyed');
    }
  }
}

// Export default object
export default {
  dnsPrefetch,
  preconnect,
  prefetch,
  preload,
  prerender,
  modulePreload,
  batchAddHints,
  removeHint,
  clearHintsByType,
  preloadRouteResources,
  setupCommonHints,
  IntelligentPrefetcher,
};
