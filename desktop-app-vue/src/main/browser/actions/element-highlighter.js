/**
 * ElementHighlighter - 元素高亮显示
 *
 * 在浏览器页面中高亮显示元素，用于：
 * - 调试自动化脚本
 * - 演示操作目标
 * - 可视化元素定位结果
 *
 * @module browser/actions/element-highlighter
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');

/**
 * 高亮样式预设
 */
const HighlightStyle = {
  DEFAULT: 'default',
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  PULSE: 'pulse',
  OUTLINE: 'outline'
};

/**
 * 样式配置
 */
const STYLE_CONFIG = {
  [HighlightStyle.DEFAULT]: {
    backgroundColor: 'rgba(66, 133, 244, 0.3)',
    border: '2px solid #4285f4',
    boxShadow: '0 0 10px rgba(66, 133, 244, 0.5)'
  },
  [HighlightStyle.SUCCESS]: {
    backgroundColor: 'rgba(52, 168, 83, 0.3)',
    border: '2px solid #34a853',
    boxShadow: '0 0 10px rgba(52, 168, 83, 0.5)'
  },
  [HighlightStyle.ERROR]: {
    backgroundColor: 'rgba(234, 67, 53, 0.3)',
    border: '2px solid #ea4335',
    boxShadow: '0 0 10px rgba(234, 67, 53, 0.5)'
  },
  [HighlightStyle.WARNING]: {
    backgroundColor: 'rgba(251, 188, 4, 0.3)',
    border: '2px solid #fbbc04',
    boxShadow: '0 0 10px rgba(251, 188, 4, 0.5)'
  },
  [HighlightStyle.INFO]: {
    backgroundColor: 'rgba(26, 115, 232, 0.3)',
    border: '2px solid #1a73e8',
    boxShadow: '0 0 10px rgba(26, 115, 232, 0.5)'
  },
  [HighlightStyle.PULSE]: {
    backgroundColor: 'rgba(66, 133, 244, 0.2)',
    border: '2px solid #4285f4',
    animation: 'pulse 1s infinite'
  },
  [HighlightStyle.OUTLINE]: {
    backgroundColor: 'transparent',
    border: '3px dashed #4285f4',
    boxShadow: 'none'
  }
};

class ElementHighlighter extends EventEmitter {
  constructor(browserEngine = null, config = {}) {
    super();

    this.browserEngine = browserEngine;
    this.config = {
      defaultDuration: config.defaultDuration || 3000,
      defaultStyle: config.defaultStyle || HighlightStyle.DEFAULT,
      showLabel: config.showLabel !== false,
      showTooltip: config.showTooltip || false,
      zIndex: config.zIndex || 999999,
      ...config
    };

    // 活跃的高亮
    this.activeHighlights = new Map();
  }

  /**
   * 设置浏览器引擎
   * @param {Object} browserEngine
   */
  setBrowserEngine(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * 高亮元素（通过坐标）
   * @param {string} targetId - 标签页 ID
   * @param {Object} bounds - 元素边界 { x, y, width, height }
   * @param {Object} options - 高亮选项
   * @returns {Promise<Object>}
   */
  async highlightBounds(targetId, bounds, options = {}) {
    if (!this.browserEngine) {
      throw new Error('Browser engine not set');
    }

    const highlightId = `hl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const style = options.style || this.config.defaultStyle;
    const duration = options.duration || this.config.defaultDuration;
    const styleConfig = STYLE_CONFIG[style] || STYLE_CONFIG[HighlightStyle.DEFAULT];

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      throw new Error(`Page not found: ${targetId}`);
    }

    // 注入高亮元素
    await page.evaluate(({ id, bounds, styleConfig, label, showLabel, zIndex }) => {
      // 创建高亮覆盖层
      const overlay = document.createElement('div');
      overlay.id = id;
      overlay.className = 'chainlesschain-highlight';
      overlay.style.cssText = `
        position: fixed;
        left: ${bounds.x}px;
        top: ${bounds.y}px;
        width: ${bounds.width}px;
        height: ${bounds.height}px;
        pointer-events: none;
        z-index: ${zIndex};
        background-color: ${styleConfig.backgroundColor};
        border: ${styleConfig.border};
        box-shadow: ${styleConfig.boxShadow || 'none'};
        border-radius: 4px;
        transition: opacity 0.3s ease;
      `;

      // 添加动画样式
      if (styleConfig.animation) {
        const style = document.createElement('style');
        style.textContent = `
          @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.7; transform: scale(1.02); }
            100% { opacity: 1; transform: scale(1); }
          }
          #${id} {
            animation: ${styleConfig.animation};
          }
        `;
        document.head.appendChild(style);
      }

      // 添加标签
      if (showLabel && label) {
        const labelEl = document.createElement('div');
        labelEl.style.cssText = `
          position: absolute;
          top: -24px;
          left: 0;
          background: #333;
          color: white;
          padding: 2px 8px;
          font-size: 12px;
          border-radius: 4px;
          white-space: nowrap;
        `;
        labelEl.textContent = label;
        overlay.appendChild(labelEl);
      }

      document.body.appendChild(overlay);
    }, {
      id: highlightId,
      bounds,
      styleConfig,
      label: options.label,
      showLabel: this.config.showLabel,
      zIndex: this.config.zIndex
    });

    // 记录活跃高亮
    this.activeHighlights.set(highlightId, {
      id: highlightId,
      targetId,
      bounds,
      style,
      createdAt: Date.now()
    });

    this.emit('highlighted', { id: highlightId, bounds, style });

    // 自动移除
    if (duration > 0) {
      setTimeout(() => {
        this.removeHighlight(targetId, highlightId).catch(() => {});
      }, duration);
    }

    return {
      success: true,
      highlightId,
      bounds,
      duration
    };
  }

  /**
   * 高亮元素（通过选择器）
   * @param {string} targetId - 标签页 ID
   * @param {string} selector - CSS 选择器
   * @param {Object} options - 高亮选项
   * @returns {Promise<Object>}
   */
  async highlightSelector(targetId, selector, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      throw new Error(`Page not found: ${targetId}`);
    }

    // 获取元素边界
    const bounds = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return null;

      const rect = element.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      };
    }, selector);

    if (!bounds) {
      return {
        success: false,
        error: `Element not found: ${selector}`
      };
    }

    return this.highlightBounds(targetId, bounds, {
      ...options,
      label: options.label || selector
    });
  }

  /**
   * 高亮元素（通过快照引用）
   * @param {string} targetId - 标签页 ID
   * @param {string} ref - 元素引用
   * @param {Object} options - 高亮选项
   * @returns {Promise<Object>}
   */
  async highlightRef(targetId, ref, options = {}) {
    const element = this.browserEngine.findElement(targetId, ref);

    if (!element) {
      return {
        success: false,
        error: `Element not found: ${ref}`
      };
    }

    return this.highlightBounds(targetId, element.bounds, {
      ...options,
      label: options.label || `[${ref}] ${element.role || element.tagName}`
    });
  }

  /**
   * 高亮点击位置
   * @param {string} targetId - 标签页 ID
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {Object} options - 高亮选项
   * @returns {Promise<Object>}
   */
  async highlightClick(targetId, x, y, options = {}) {
    const size = options.size || 40;

    return this.highlightBounds(targetId, {
      x: x - size / 2,
      y: y - size / 2,
      width: size,
      height: size
    }, {
      style: HighlightStyle.PULSE,
      duration: options.duration || 1000,
      label: options.label || `Click (${x}, ${y})`,
      ...options
    });
  }

  /**
   * 高亮多个元素
   * @param {string} targetId - 标签页 ID
   * @param {Array} elements - 元素列表
   * @param {Object} options - 高亮选项
   * @returns {Promise<Object>}
   */
  async highlightMultiple(targetId, elements, options = {}) {
    const results = [];

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const style = options.styles?.[i] || options.style;

      try {
        let result;
        if (element.bounds) {
          result = await this.highlightBounds(targetId, element.bounds, {
            ...options,
            style,
            label: element.label || `Element ${i + 1}`
          });
        } else if (element.selector) {
          result = await this.highlightSelector(targetId, element.selector, {
            ...options,
            style
          });
        } else if (element.ref) {
          result = await this.highlightRef(targetId, element.ref, {
            ...options,
            style
          });
        }
        results.push(result);
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }

    return {
      success: true,
      count: results.filter(r => r.success).length,
      results
    };
  }

  /**
   * 显示操作路径
   * @param {string} targetId - 标签页 ID
   * @param {Array} points - 路径点 [{ x, y }]
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async showPath(targetId, points, options = {}) {
    if (points.length < 2) {
      return { success: false, error: 'Need at least 2 points' };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      throw new Error(`Page not found: ${targetId}`);
    }

    const pathId = `path_${Date.now()}`;
    const color = options.color || '#4285f4';
    const duration = options.duration || 3000;

    await page.evaluate(({ id, points, color, zIndex }) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = id;
      svg.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: ${zIndex};
      `;

      // 创建路径
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      path.setAttribute('d', d);
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '3');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.style.strokeDasharray = path.getTotalLength();
      path.style.strokeDashoffset = path.getTotalLength();
      path.style.animation = 'drawPath 1s forwards';

      // 添加动画
      const style = document.createElement('style');
      style.textContent = `
        @keyframes drawPath {
          to { stroke-dashoffset: 0; }
        }
      `;
      document.head.appendChild(style);

      // 添加端点标记
      points.forEach((p, i) => {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', p.x);
        circle.setAttribute('cy', p.y);
        circle.setAttribute('r', i === 0 || i === points.length - 1 ? '8' : '4');
        circle.setAttribute('fill', color);
        svg.appendChild(circle);
      });

      svg.appendChild(path);
      document.body.appendChild(svg);
    }, {
      id: pathId,
      points,
      color,
      zIndex: this.config.zIndex
    });

    // 自动移除
    if (duration > 0) {
      setTimeout(() => {
        this._removePath(targetId, pathId).catch(() => {});
      }, duration);
    }

    return {
      success: true,
      pathId,
      pointCount: points.length
    };
  }

  /**
   * 显示文本标注
   * @param {string} targetId - 标签页 ID
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {string} text - 标注文本
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async showAnnotation(targetId, x, y, text, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      throw new Error(`Page not found: ${targetId}`);
    }

    const annotationId = `ann_${Date.now()}`;
    const duration = options.duration || 5000;
    const backgroundColor = options.backgroundColor || '#333';
    const textColor = options.textColor || '#fff';

    await page.evaluate(({ id, x, y, text, backgroundColor, textColor, zIndex }) => {
      const annotation = document.createElement('div');
      annotation.id = id;
      annotation.className = 'chainlesschain-annotation';
      annotation.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        background: ${backgroundColor};
        color: ${textColor};
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 14px;
        max-width: 300px;
        z-index: ${zIndex};
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        pointer-events: none;
        animation: fadeIn 0.3s ease;
      `;
      annotation.textContent = text;

      // 添加箭头指示器
      const arrow = document.createElement('div');
      arrow.style.cssText = `
        position: absolute;
        bottom: -8px;
        left: 20px;
        width: 0;
        height: 0;
        border-left: 8px solid transparent;
        border-right: 8px solid transparent;
        border-top: 8px solid ${backgroundColor};
      `;
      annotation.appendChild(arrow);

      const style = document.createElement('style');
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `;
      document.head.appendChild(style);

      document.body.appendChild(annotation);
    }, {
      id: annotationId,
      x,
      y: y - 50, // 显示在坐标上方
      text,
      backgroundColor,
      textColor,
      zIndex: this.config.zIndex
    });

    // 自动移除
    if (duration > 0) {
      setTimeout(() => {
        this._removeAnnotation(targetId, annotationId).catch(() => {});
      }, duration);
    }

    return {
      success: true,
      annotationId
    };
  }

  /**
   * 移除高亮
   * @param {string} targetId - 标签页 ID
   * @param {string} highlightId - 高亮 ID
   * @returns {Promise<Object>}
   */
  async removeHighlight(targetId, highlightId) {
    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: 'Page not found' };
    }

    await page.evaluate((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.style.opacity = '0';
        setTimeout(() => element.remove(), 300);
      }
    }, highlightId);

    this.activeHighlights.delete(highlightId);

    this.emit('highlightRemoved', { id: highlightId });

    return { success: true, highlightId };
  }

  /**
   * 移除路径
   * @private
   */
  async _removePath(targetId, pathId) {
    const page = this.browserEngine.getPage(targetId);
    if (!page) return;

    await page.evaluate((id) => {
      const element = document.getElementById(id);
      if (element) element.remove();
    }, pathId);
  }

  /**
   * 移除标注
   * @private
   */
  async _removeAnnotation(targetId, annotationId) {
    const page = this.browserEngine.getPage(targetId);
    if (!page) return;

    await page.evaluate((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.style.opacity = '0';
        setTimeout(() => element.remove(), 300);
      }
    }, annotationId);
  }

  /**
   * 清除所有高亮
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>}
   */
  async clearAll(targetId) {
    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: 'Page not found' };
    }

    await page.evaluate(() => {
      document.querySelectorAll('.chainlesschain-highlight, .chainlesschain-annotation')
        .forEach(el => el.remove());
      document.querySelectorAll('svg[id^="path_"]')
        .forEach(el => el.remove());
    });

    const count = this.activeHighlights.size;
    this.activeHighlights.clear();

    this.emit('cleared', { count });

    return { success: true, cleared: count };
  }

  /**
   * 获取活跃高亮列表
   * @returns {Array}
   */
  getActiveHighlights() {
    return Array.from(this.activeHighlights.values());
  }

  /**
   * 通用执行方法
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>}
   */
  async execute(targetId, options = {}) {
    const { action, ...params } = options;

    switch (action) {
      case 'bounds':
        return this.highlightBounds(targetId, params.bounds, params);

      case 'selector':
        return this.highlightSelector(targetId, params.selector, params);

      case 'ref':
        return this.highlightRef(targetId, params.ref, params);

      case 'click':
        return this.highlightClick(targetId, params.x, params.y, params);

      case 'multiple':
        return this.highlightMultiple(targetId, params.elements, params);

      case 'path':
        return this.showPath(targetId, params.points, params);

      case 'annotation':
        return this.showAnnotation(targetId, params.x, params.y, params.text, params);

      case 'remove':
        return this.removeHighlight(targetId, params.highlightId);

      case 'clear':
        return this.clearAll(targetId);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}

// 单例
let highlighterInstance = null;

function getElementHighlighter(browserEngine, config) {
  if (!highlighterInstance) {
    highlighterInstance = new ElementHighlighter(browserEngine, config);
  } else if (browserEngine) {
    highlighterInstance.setBrowserEngine(browserEngine);
  }
  return highlighterInstance;
}

module.exports = {
  ElementHighlighter,
  HighlightStyle,
  getElementHighlighter
};
