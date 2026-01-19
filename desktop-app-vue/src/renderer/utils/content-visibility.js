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
 * Content Visibility 指令
 * v-content-visibility
 *
 * Usage:
 * <div v-content-visibility>...</div>
 * <div v-content-visibility="{ height: 500 }">...</div>
 */
export const contentVisibilityDirective = {
  mounted(el, binding) {
    const options = binding.value || {};

    const {
      // Estimated height when not rendered (px)
      height = 500,

      // Whether to use auto mode (default: true)
      auto = true,

      // Minimum size for contain-intrinsic-size
      minHeight = 100,

      // Enable debug logging
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
      el.addEventListener('contentvisibilityautostatechange', (event) => {
        console.log('[ContentVisibility]', {
          element: el.tagName,
          skipped: event.skipped,
          time: Date.now(),
        });
      });
    }

    // Store options for cleanup
    el.__contentVisibilityOptions__ = options;

    if (debug) {
      console.log('[ContentVisibility] Applied to:', el.tagName, {
        height,
        auto,
      });
    }
  },

  unmounted(el) {
    // Cleanup
    delete el.__contentVisibilityOptions__;
  },
};

/**
 * Create content-visibility directive
 * 创建指令
 */
export function createContentVisibilityDirective() {
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

  data() {
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
    setupObserver() {
      this.observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !this.isVisible) {
              this.isVisible = true;

              if (this.debug) {
                console.log('[LazyRender] Element became visible, rendering content');
              }

              // Disconnect after first render
              this.observer.disconnect();
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

  render() {
    const h = this.$createElement || window.h;

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
  constructor(options = {}) {
    this.options = {
      // Maximum renders per frame
      maxRendersPerFrame: options.maxRendersPerFrame || 3,

      // Frame budget in ms (default: 16ms for 60fps)
      frameBudget: options.frameBudget || 16,

      // Enable debug logging
      debug: options.debug || false,
    };

    this.queue = [];
    this.rendering = false;
    this.currentFrame = 0;
    this.rendersThisFrame = 0;
    this.frameStartTime = 0;
  }

  /**
   * Add render task to queue
   */
  schedule(renderFn, priority = 'normal') {
    const priorityMap = { high: 3, normal: 2, low: 1 };

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
  processQueue() {
    if (this.queue.length === 0) {
      this.rendering = false;
      return;
    }

    this.rendering = true;

    requestAnimationFrame(() => {
      this.frameStartTime = performance.now();
      this.rendersThisFrame = 0;

      while (this.queue.length > 0 && this.shouldRenderMore()) {
        const task = this.queue.shift();

        if (this.options.debug) {
          const waitTime = performance.now() - task.addedAt;
          console.log(`[RenderBudget] Rendering task (waited ${waitTime.toFixed(2)}ms)`);
        }

        try {
          task.renderFn();
          this.rendersThisFrame++;
        } catch (error) {
          console.error('[RenderBudget] Render error:', error);
        }
      }

      const frameTime = performance.now() - this.frameStartTime;

      if (this.options.debug) {
        console.log(`[RenderBudget] Frame complete: ${this.rendersThisFrame} renders in ${frameTime.toFixed(2)}ms`);
      }

      // Continue in next frame
      this.processQueue();
    });
  }

  /**
   * Check if we should render more in this frame
   */
  shouldRenderMore() {
    const frameTime = performance.now() - this.frameStartTime;

    return (
      this.rendersThisFrame < this.options.maxRendersPerFrame &&
      frameTime < this.options.frameBudget
    );
  }

  /**
   * Clear queue
   */
  clear() {
    this.queue = [];
    this.rendering = false;
  }

  /**
   * Get queue status
   */
  getStatus() {
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
 * @param {HTMLElement} element - Target element
 * @param {Object} options - Options
 */
export function applyContentVisibility(element, options = {}) {
  const {
    height = 500,
    auto = true,
  } = options;

  if (!element) {return;}

  element.style.contentVisibility = auto ? 'auto' : 'hidden';
  element.style.containIntrinsicSize = `auto ${height}px`;
}

/**
 * Batch apply content-visibility to multiple elements
 * 批量应用到多个元素
 *
 * @param {string} selector - CSS selector
 * @param {Object} options - Options
 */
export function batchApplyContentVisibility(selector, options = {}) {
  const elements = document.querySelectorAll(selector);

  elements.forEach(element => {
    applyContentVisibility(element, options);
  });

  console.log(`[ContentVisibility] Applied to ${elements.length} elements matching "${selector}"`);
}

/**
 * Check browser support for content-visibility
 * 检查浏览器支持
 *
 * @returns {boolean}
 */
export function isContentVisibilitySupported() {
  if (typeof CSS === 'undefined' || !CSS.supports) {
    return false;
  }

  return CSS.supports('content-visibility', 'auto');
}

/**
 * Get content-visibility stats
 * 获取统计信息
 *
 * @returns {Object}
 */
export function getContentVisibilityStats() {
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
