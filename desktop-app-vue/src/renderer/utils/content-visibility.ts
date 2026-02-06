import { logger } from '@/utils/logger';
import type { ObjectDirective, DirectiveBinding, VNode } from 'vue';

/**
 * Content Visibility Lazy Rendering Utilities
 * Content-Visibility 懒渲染工具
 *
 * 使用 CSS content-visibility 属性优化渲染性能
 * 不在视口中的元素跳过渲染，大幅提升初始加载速度
 *
 * Features:
 * - Auto content-visibility directive
 * - Lazy render component wrapper
 * - Render budget management
 * - Performance tracking
 */

/**
 * Render priority level
 */
export type RenderPriority = 'high' | 'normal' | 'low';

/**
 * Options for content visibility directive
 */
export interface ContentVisibilityOptions {
  /** Estimated height when not rendered (px, default: 500) */
  height?: number;
  /** Whether to use auto mode (default: true) */
  auto?: boolean;
  /** Minimum size for contain-intrinsic-size (default: 100) */
  minHeight?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Extended HTMLElement with content visibility options
 */
interface ContentVisibilityElement extends HTMLElement {
  __contentVisibilityOptions__?: ContentVisibilityOptions;
}

/**
 * Content visibility auto state change event
 */
interface ContentVisibilityAutoStateChangeEvent extends Event {
  skipped: boolean;
}

/**
 * Props for LazyRender component
 */
export interface LazyRenderProps {
  /** Estimated height (px, default: 500) */
  height?: number;
  /** Minimum height (px, default: 100) */
  minHeight?: number;
  /** Auto mode (default: true) */
  auto?: boolean;
  /** Tag name (default: 'div') */
  tag?: string;
  /** Enable debug (default: false) */
  debug?: boolean;
  /** Defer rendering until visible (default: false) */
  deferRender?: boolean;
  /** Intersection observer threshold (default: 0) */
  threshold?: number;
}

/**
 * Data for LazyRender component
 */
export interface LazyRenderData {
  isVisible: boolean;
  observer: IntersectionObserver | null;
}

/**
 * Options for RenderBudgetManager
 */
export interface RenderBudgetManagerOptions {
  /** Maximum renders per frame (default: 3) */
  maxRendersPerFrame?: number;
  /** Frame budget in ms (default: 16 for 60fps) */
  frameBudget?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Render task in queue
 */
export interface RenderTask {
  /** The render function to execute */
  renderFn: () => void;
  /** Priority value (higher = more important) */
  priority: number;
  /** Timestamp when task was added */
  addedAt: number;
}

/**
 * Status of render budget manager
 */
export interface RenderBudgetStatus {
  /** Number of tasks in queue */
  queueLength: number;
  /** Whether currently rendering */
  rendering: boolean;
  /** Number of renders completed this frame */
  rendersThisFrame: number;
}

/**
 * Content visibility stats
 */
export interface ContentVisibilityStats {
  /** Total elements with content-visibility */
  total: number;
  /** Whether content-visibility is supported */
  supported: boolean;
  /** Render budget queue status */
  renderBudgetQueue: RenderBudgetStatus;
}

/**
 * Options for applying content visibility
 */
export interface ApplyContentVisibilityOptions {
  /** Height estimate (default: 500) */
  height?: number;
  /** Auto mode (default: true) */
  auto?: boolean;
}

/**
 * Content Visibility Directive
 * v-content-visibility
 *
 * Usage:
 * <div v-content-visibility>...</div>
 * <div v-content-visibility="{ height: 500 }">...</div>
 */
export const contentVisibilityDirective: ObjectDirective<ContentVisibilityElement, ContentVisibilityOptions> = {
  mounted(el: ContentVisibilityElement, binding: DirectiveBinding<ContentVisibilityOptions>) {
    const options = binding.value || {};

    const {
      height = 500,
      auto = true,
      minHeight = 100,
      debug = false,
    } = options;

    // Apply content-visibility
    if (auto) {
      el.style.contentVisibility = 'auto';
    } else {
      el.style.contentVisibility = 'hidden';
    }

    // Set contain-intrinsic-size for placeholder
    el.style.containIntrinsicSize = `auto ${Math.max(height, minHeight)}px`;

    // Track render state
    if (debug && 'oncontentvisibilityautostatechange' in el) {
      el.addEventListener('contentvisibilityautostatechange', ((event: ContentVisibilityAutoStateChangeEvent) => {
        logger.info('[ContentVisibility]', {
          element: el.tagName,
          skipped: event.skipped,
          time: Date.now(),
        });
      }) as EventListener);
    }

    // Store options for cleanup
    el.__contentVisibilityOptions__ = options;

    if (debug) {
      logger.info(`[ContentVisibility] Applied to: ${el.tagName}`, { height, auto });
    }
  },

  unmounted(el: ContentVisibilityElement) {
    // Cleanup
    delete el.__contentVisibilityOptions__;
  },
};

/**
 * Create content-visibility directive
 * 创建指令
 */
export function createContentVisibilityDirective(): ObjectDirective<ContentVisibilityElement, ContentVisibilityOptions> {
  return contentVisibilityDirective;
}

/**
 * LazyRender component wrapper
 * 懒渲染组件包装器
 *
 * Usage:
 * <LazyRender :height="500">
 *   <ExpensiveComponent />
 * </LazyRender>
 */
export const LazyRenderComponent = {
  name: 'LazyRender',

  props: {
    // Estimated height (px)
    height: {
      type: Number,
      default: 500,
    },

    // Minimum height (px)
    minHeight: {
      type: Number,
      default: 100,
    },

    // Auto mode
    auto: {
      type: Boolean,
      default: true,
    },

    // Tag name
    tag: {
      type: String,
      default: 'div',
    },

    // Enable debug
    debug: {
      type: Boolean,
      default: false,
    },

    // Defer rendering until visible
    deferRender: {
      type: Boolean,
      default: false,
    },

    // Intersection observer threshold
    threshold: {
      type: Number,
      default: 0,
    },
  },

  data(): LazyRenderData {
    return {
      isVisible: !this.deferRender,
      observer: null,
    };
  },

  mounted() {
    if (this.deferRender) {
      this.setupObserver();
    }
  },

  unmounted() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  },

  methods: {
    setupObserver(this: { observer: IntersectionObserver | null; isVisible: boolean; debug: boolean; threshold: number; $el: HTMLElement }) {
      this.observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !this.isVisible) {
              this.isVisible = true;

              if (this.debug) {
                logger.info('[LazyRender] Element became visible, rendering content');
              }

              // Disconnect after first render
              this.observer?.disconnect();
              this.observer = null;
            }
          });
        },
        {
          threshold: this.threshold,
          rootMargin: '50px', // Start rendering 50px before visible
        }
      );

      this.observer.observe(this.$el);
    },
  },

  render(this: { $createElement?: typeof import('vue').h; tag: string; auto: boolean; height: number; minHeight: number; isVisible: boolean; $slots: { default?: () => VNode[] } }) {
    const h = this.$createElement || (window as unknown as { h: typeof import('vue').h }).h;

    const style = {
      contentVisibility: this.auto ? 'auto' : 'hidden',
      containIntrinsicSize: `auto ${Math.max(this.height, this.minHeight)}px`,
    };

    return h(
      this.tag,
      {
        style,
        class: 'lazy-render-container',
      },
      this.isVisible ? this.$slots.default?.() : null
    );
  },
};

/**
 * Render Budget Manager
 * 渲染预算管理器
 *
 * Limits the number of expensive renders per frame
 */
export class RenderBudgetManager {
  private options: Required<RenderBudgetManagerOptions>;
  private queue: RenderTask[] = [];
  private rendering: boolean = false;
  private rendersThisFrame: number = 0;
  private frameStartTime: number = 0;

  constructor(options: RenderBudgetManagerOptions = {}) {
    this.options = {
      maxRendersPerFrame: options.maxRendersPerFrame || 3,
      frameBudget: options.frameBudget || 16,
      debug: options.debug || false,
    };
  }

  /**
   * Add render task to queue
   */
  schedule(renderFn: () => void, priority: RenderPriority = 'normal'): void {
    const priorityMap: Record<RenderPriority, number> = { high: 3, normal: 2, low: 1 };

    this.queue.push({
      renderFn,
      priority: priorityMap[priority] || 2,
      addedAt: performance.now(),
    });

    // Sort by priority
    this.queue.sort((a, b) => b.priority - a.priority);

    if (!this.rendering) {
      this.processQueue();
    }
  }

  /**
   * Process render queue
   */
  private processQueue(): void {
    if (this.queue.length === 0) {
      this.rendering = false;
      return;
    }

    this.rendering = true;

    requestAnimationFrame(() => {
      this.frameStartTime = performance.now();
      this.rendersThisFrame = 0;

      while (this.queue.length > 0 && this.shouldRenderMore()) {
        const task = this.queue.shift()!;

        if (this.options.debug) {
          const waitTime = performance.now() - task.addedAt;
          logger.info(`[RenderBudget] Rendering task (waited ${waitTime.toFixed(2)}ms)`);
        }

        try {
          task.renderFn();
          this.rendersThisFrame++;
        } catch (error) {
          logger.error('[RenderBudget] Render error:', error);
        }
      }

      const frameTime = performance.now() - this.frameStartTime;

      if (this.options.debug) {
        logger.info(`[RenderBudget] Frame complete: ${this.rendersThisFrame} renders in ${frameTime.toFixed(2)}ms`);
      }

      // Continue in next frame
      this.processQueue();
    });
  }

  /**
   * Check if we should render more in this frame
   */
  private shouldRenderMore(): boolean {
    const frameTime = performance.now() - this.frameStartTime;

    return (
      this.rendersThisFrame < this.options.maxRendersPerFrame &&
      frameTime < this.options.frameBudget
    );
  }

  /**
   * Clear queue
   */
  clear(): void {
    this.queue = [];
    this.rendering = false;
  }

  /**
   * Get queue status
   */
  getStatus(): RenderBudgetStatus {
    return {
      queueLength: this.queue.length,
      rendering: this.rendering,
      rendersThisFrame: this.rendersThisFrame,
    };
  }
}

// Global render budget manager instance
export const renderBudgetManager = new RenderBudgetManager();

/**
 * Apply content-visibility to element
 * 应用 content-visibility 到元素
 *
 * @param element - Target element
 * @param options - Options
 */
export function applyContentVisibility(element: HTMLElement | null, options: ApplyContentVisibilityOptions = {}): void {
  const { height = 500, auto = true } = options;

  if (!element) {
    return;
  }

  element.style.contentVisibility = auto ? 'auto' : 'hidden';
  element.style.containIntrinsicSize = `auto ${height}px`;
}

/**
 * Batch apply content-visibility to multiple elements
 * 批量应用到多个元素
 *
 * @param selector - CSS selector
 * @param options - Options
 */
export function batchApplyContentVisibility(selector: string, options: ApplyContentVisibilityOptions = {}): void {
  const elements = document.querySelectorAll<HTMLElement>(selector);

  elements.forEach((element) => {
    applyContentVisibility(element, options);
  });

  logger.info(`[ContentVisibility] Applied to ${elements.length} elements matching "${selector}"`);
}

/**
 * Check browser support for content-visibility
 * 检查浏览器支持
 *
 * @returns Whether content-visibility is supported
 */
export function isContentVisibilitySupported(): boolean {
  if (typeof CSS === 'undefined' || !CSS.supports) {
    return false;
  }

  return CSS.supports('content-visibility', 'auto');
}

/**
 * Get content-visibility stats
 * 获取统计信息
 *
 * @returns Content visibility statistics
 */
export function getContentVisibilityStats(): ContentVisibilityStats {
  const elements = document.querySelectorAll('[style*="content-visibility"]');

  return {
    total: elements.length,
    supported: isContentVisibilitySupported(),
    renderBudgetQueue: renderBudgetManager.getStatus(),
  };
}

/**
 * Export default object
 */
export default {
  directive: contentVisibilityDirective,
  createDirective: createContentVisibilityDirective,
  LazyRender: LazyRenderComponent,
  RenderBudgetManager,
  renderBudgetManager,
  applyContentVisibility,
  batchApplyContentVisibility,
  isContentVisibilitySupported,
  getContentVisibilityStats,
};
