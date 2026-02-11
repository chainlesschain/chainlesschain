/**
 * ScreenAnalyzer - 屏幕分析引擎
 *
 * 高级屏幕分析功能：
 * - 区域检测和分割
 * - UI 元素识别
 * - 布局分析
 * - 变化检测
 *
 * @module browser/actions/screen-analyzer
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');

/**
 * 区域类型
 */
const RegionType = {
  HEADER: 'header',
  FOOTER: 'footer',
  SIDEBAR: 'sidebar',
  CONTENT: 'content',
  NAVIGATION: 'navigation',
  FORM: 'form',
  TABLE: 'table',
  LIST: 'list',
  MODAL: 'modal',
  POPUP: 'popup',
  BUTTON: 'button',
  INPUT: 'input',
  IMAGE: 'image',
  VIDEO: 'video',
  UNKNOWN: 'unknown'
};

/**
 * 分析模式
 */
const AnalysisMode = {
  QUICK: 'quick',           // 快速分析
  STANDARD: 'standard',     // 标准分析
  DETAILED: 'detailed',     // 详细分析
  FULL: 'full'              // 完整分析
};

class ScreenAnalyzer extends EventEmitter {
  constructor(browserEngine = null, config = {}) {
    super();

    this.browserEngine = browserEngine;
    this.config = {
      enableCache: config.enableCache !== false,
      cacheTimeout: config.cacheTimeout || 5000,
      minRegionSize: config.minRegionSize || 50,
      maxRegions: config.maxRegions || 100,
      detectChanges: config.detectChanges !== false,
      ...config
    };

    // 分析缓存
    this.analysisCache = new Map();

    // 上一次分析结果（用于变化检测）
    this.lastAnalysis = new Map();

    // 统计
    this.stats = {
      totalAnalyses: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageTime: 0
    };
  }

  /**
   * 设置浏览器引擎
   * @param {Object} browserEngine
   */
  setBrowserEngine(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * 分析屏幕
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 分析选项
   * @returns {Promise<Object>}
   */
  async analyze(targetId, options = {}) {
    const startTime = Date.now();
    const mode = options.mode || AnalysisMode.STANDARD;

    // 检查缓存
    const cacheKey = `${targetId}_${mode}`;
    if (this.config.enableCache && !options.forceRefresh) {
      const cached = this.analysisCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.config.cacheTimeout) {
        this.stats.cacheHits++;
        return { ...cached.result, fromCache: true };
      }
    }

    this.stats.cacheMisses++;
    this.stats.totalAnalyses++;

    if (!this.browserEngine) {
      throw new Error('Browser engine not set');
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      throw new Error(`Page not found: ${targetId}`);
    }

    try {
      // 执行分析
      const result = await this._analyzeScreen(page, mode, options);

      // 检测变化
      if (this.config.detectChanges) {
        result.changes = this._detectChanges(targetId, result);
        this.lastAnalysis.set(targetId, result);
      }

      // 缓存结果
      if (this.config.enableCache) {
        this.analysisCache.set(cacheKey, {
          result,
          timestamp: Date.now()
        });
      }

      // 更新统计
      const duration = Date.now() - startTime;
      this._updateStats(duration);

      this.emit('analyzed', {
        targetId,
        mode,
        regions: result.regions.length,
        duration
      });

      return {
        success: true,
        ...result,
        duration
      };

    } catch (error) {
      this.emit('error', { targetId, error: error.message });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 执行屏幕分析
   * @private
   */
  async _analyzeScreen(page, mode, options) {
    const analysisScript = `
      (() => {
        const mode = '${mode}';
        const minSize = ${this.config.minRegionSize};
        const maxRegions = ${this.config.maxRegions};

        // 获取视口信息
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          fullWidth: document.documentElement.scrollWidth,
          fullHeight: document.documentElement.scrollHeight
        };

        // 收集区域
        const regions = [];
        const seen = new Set();

        // 分析元素
        function analyzeElement(el, depth = 0) {
          if (regions.length >= maxRegions) return;
          if (depth > 10) return;

          const rect = el.getBoundingClientRect();
          if (rect.width < minSize || rect.height < minSize) return;

          const key = Math.round(rect.x) + '_' + Math.round(rect.y) + '_' +
                      Math.round(rect.width) + '_' + Math.round(rect.height);
          if (seen.has(key)) return;
          seen.add(key);

          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return;

          const region = {
            type: detectRegionType(el),
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            element: {
              tagName: el.tagName.toLowerCase(),
              id: el.id || null,
              className: el.className ? String(el.className).slice(0, 100) : null,
              role: el.getAttribute('role'),
              ariaLabel: el.getAttribute('aria-label')
            }
          };

          if (mode !== 'quick') {
            region.text = el.textContent?.slice(0, 200)?.trim() || null;
            region.interactive = isInteractive(el);
            region.visible = isVisible(el, rect);
          }

          if (mode === 'detailed' || mode === 'full') {
            region.children = el.children.length;
            region.depth = depth;
            region.zIndex = parseInt(style.zIndex) || 0;
          }

          regions.push(region);

          if (mode === 'full' && el.children.length > 0) {
            Array.from(el.children).forEach(child => {
              analyzeElement(child, depth + 1);
            });
          }
        }

        function detectRegionType(el) {
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role');
          const className = (el.className || '').toLowerCase();

          if (tag === 'header' || role === 'banner' || className.includes('header')) {
            return 'header';
          }
          if (tag === 'footer' || role === 'contentinfo' || className.includes('footer')) {
            return 'footer';
          }
          if (tag === 'nav' || role === 'navigation' || className.includes('nav') || className.includes('menu')) {
            return 'navigation';
          }
          if (tag === 'aside' || role === 'complementary' || className.includes('sidebar')) {
            return 'sidebar';
          }
          if (tag === 'main' || role === 'main' || className.includes('content')) {
            return 'content';
          }
          if (tag === 'form' || role === 'form') {
            return 'form';
          }
          if (tag === 'table' || role === 'table' || role === 'grid') {
            return 'table';
          }
          if (tag === 'ul' || tag === 'ol' || role === 'list') {
            return 'list';
          }
          if (role === 'dialog' || className.includes('modal')) {
            return 'modal';
          }
          if (className.includes('popup') || className.includes('dropdown')) {
            return 'popup';
          }
          if (tag === 'button' || role === 'button') {
            return 'button';
          }
          if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            return 'input';
          }
          if (tag === 'img' || tag === 'svg' || tag === 'picture') {
            return 'image';
          }
          if (tag === 'video' || tag === 'iframe') {
            return 'video';
          }

          return 'unknown';
        }

        function isInteractive(el) {
          const tag = el.tagName.toLowerCase();
          if (['a', 'button', 'input', 'select', 'textarea'].includes(tag)) return true;
          if (el.getAttribute('role') === 'button') return true;
          if (el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true;
          const style = window.getComputedStyle(el);
          if (style.cursor === 'pointer') return true;
          return false;
        }

        function isVisible(el, rect) {
          if (rect.width === 0 || rect.height === 0) return false;
          if (rect.bottom < 0 || rect.right < 0) return false;
          if (rect.top > viewport.height || rect.left > viewport.width) return false;
          return true;
        }

        // 分析主要区域
        const mainElements = [
          'header', 'footer', 'nav', 'main', 'aside',
          'form', 'table', '[role="dialog"]', '[role="alert"]'
        ];

        mainElements.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            analyzeElement(el, 0);
          });
        });

        // 如果是详细或完整模式，分析更多元素
        if (mode === 'detailed' || mode === 'full') {
          document.querySelectorAll('section, article, div[class]').forEach(el => {
            if (regions.length < maxRegions) {
              analyzeElement(el, 0);
            }
          });
        }

        // 计算布局信息
        const layout = {
          hasHeader: regions.some(r => r.type === 'header'),
          hasFooter: regions.some(r => r.type === 'footer'),
          hasNavigation: regions.some(r => r.type === 'navigation'),
          hasSidebar: regions.some(r => r.type === 'sidebar'),
          hasModal: regions.some(r => r.type === 'modal'),
          interactiveCount: regions.filter(r => r.interactive).length
        };

        return {
          viewport,
          regions,
          layout,
          url: window.location.href,
          title: document.title
        };
      })()
    `;

    return await page.evaluate(analysisScript);
  }

  /**
   * 检测变化
   * @private
   */
  _detectChanges(targetId, currentResult) {
    const previousResult = this.lastAnalysis.get(targetId);
    if (!previousResult) {
      return { isNew: true };
    }

    const changes = {
      isNew: false,
      urlChanged: previousResult.url !== currentResult.url,
      titleChanged: previousResult.title !== currentResult.title,
      viewportChanged: this._viewportChanged(previousResult.viewport, currentResult.viewport),
      layoutChanged: this._layoutChanged(previousResult.layout, currentResult.layout),
      regionsAdded: [],
      regionsRemoved: [],
      regionsModified: []
    };

    // 比较区域
    const prevRegionMap = new Map();
    for (const region of previousResult.regions || []) {
      const key = this._regionKey(region);
      prevRegionMap.set(key, region);
    }

    const currRegionMap = new Map();
    for (const region of currentResult.regions || []) {
      const key = this._regionKey(region);
      currRegionMap.set(key, region);

      if (!prevRegionMap.has(key)) {
        changes.regionsAdded.push(region);
      } else {
        const prevRegion = prevRegionMap.get(key);
        if (this._regionModified(prevRegion, region)) {
          changes.regionsModified.push({ before: prevRegion, after: region });
        }
      }
    }

    for (const [key, region] of prevRegionMap) {
      if (!currRegionMap.has(key)) {
        changes.regionsRemoved.push(region);
      }
    }

    changes.hasChanges = changes.urlChanged || changes.titleChanged ||
      changes.viewportChanged || changes.layoutChanged ||
      changes.regionsAdded.length > 0 || changes.regionsRemoved.length > 0 ||
      changes.regionsModified.length > 0;

    return changes;
  }

  /**
   * 生成区域键
   * @private
   */
  _regionKey(region) {
    return `${region.type}_${region.bounds.x}_${region.bounds.y}_${region.element?.id || ''}`;
  }

  /**
   * 检查视口是否变化
   * @private
   */
  _viewportChanged(prev, curr) {
    if (!prev || !curr) return true;
    return prev.width !== curr.width ||
           prev.height !== curr.height ||
           prev.scrollX !== curr.scrollX ||
           prev.scrollY !== curr.scrollY;
  }

  /**
   * 检查布局是否变化
   * @private
   */
  _layoutChanged(prev, curr) {
    if (!prev || !curr) return true;
    return JSON.stringify(prev) !== JSON.stringify(curr);
  }

  /**
   * 检查区域是否修改
   * @private
   */
  _regionModified(prev, curr) {
    return prev.bounds.width !== curr.bounds.width ||
           prev.bounds.height !== curr.bounds.height;
  }

  /**
   * 查找区域
   * @param {string} targetId - 标签页 ID
   * @param {Object} criteria - 查找条件
   * @returns {Promise<Object>}
   */
  async findRegions(targetId, criteria = {}) {
    const analysis = await this.analyze(targetId, { mode: AnalysisMode.STANDARD });

    if (!analysis.success) {
      return analysis;
    }

    let regions = analysis.regions;

    // 按类型过滤
    if (criteria.type) {
      regions = regions.filter(r => r.type === criteria.type);
    }

    // 按交互性过滤
    if (criteria.interactive !== undefined) {
      regions = regions.filter(r => r.interactive === criteria.interactive);
    }

    // 按可见性过滤
    if (criteria.visible !== undefined) {
      regions = regions.filter(r => r.visible === criteria.visible);
    }

    // 按位置过滤
    if (criteria.bounds) {
      regions = regions.filter(r => {
        const { x, y, width, height } = criteria.bounds;
        return r.bounds.x >= (x || 0) &&
               r.bounds.y >= (y || 0) &&
               (width === undefined || r.bounds.x + r.bounds.width <= x + width) &&
               (height === undefined || r.bounds.y + r.bounds.height <= y + height);
      });
    }

    // 按文本过滤
    if (criteria.text) {
      const searchText = criteria.text.toLowerCase();
      regions = regions.filter(r =>
        r.text && r.text.toLowerCase().includes(searchText)
      );
    }

    return {
      success: true,
      regions,
      total: regions.length
    };
  }

  /**
   * 获取区域截图
   * @param {string} targetId - 标签页 ID
   * @param {Object} bounds - 区域边界
   * @returns {Promise<Object>}
   */
  async captureRegion(targetId, bounds) {
    if (!this.browserEngine) {
      return { success: false, error: 'Browser engine not set' };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      const screenshot = await page.screenshot({
        clip: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height
        },
        encoding: 'base64'
      });

      return {
        success: true,
        image: screenshot,
        bounds
      };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 比较两次分析
   * @param {Object} before - 之前的分析
   * @param {Object} after - 之后的分析
   * @returns {Object}
   */
  compare(before, after) {
    const diff = {
      urlChanged: before.url !== after.url,
      titleChanged: before.title !== after.title,
      regionsDiff: {
        added: [],
        removed: [],
        modified: []
      }
    };

    const beforeMap = new Map();
    for (const region of before.regions || []) {
      beforeMap.set(this._regionKey(region), region);
    }

    const afterMap = new Map();
    for (const region of after.regions || []) {
      const key = this._regionKey(region);
      afterMap.set(key, region);

      if (!beforeMap.has(key)) {
        diff.regionsDiff.added.push(region);
      }
    }

    for (const [key, region] of beforeMap) {
      if (!afterMap.has(key)) {
        diff.regionsDiff.removed.push(region);
      }
    }

    return diff;
  }

  /**
   * 清除缓存
   * @param {string} targetId - 标签页 ID（可选）
   */
  clearCache(targetId = null) {
    if (targetId) {
      for (const key of this.analysisCache.keys()) {
        if (key.startsWith(targetId)) {
          this.analysisCache.delete(key);
        }
      }
      this.lastAnalysis.delete(targetId);
    } else {
      this.analysisCache.clear();
      this.lastAnalysis.clear();
    }
  }

  /**
   * 更新统计
   * @private
   */
  _updateStats(duration) {
    const totalTime = this.stats.averageTime * (this.stats.totalAnalyses - 1) + duration;
    this.stats.averageTime = totalTime / this.stats.totalAnalyses;
  }

  /**
   * 获取统计
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      cacheHitRate: this.stats.totalAnalyses > 0
        ? ((this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalAnalyses: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageTime: 0
    };
    this.clearCache();

    this.emit('reset');
  }
}

// 单例
let analyzerInstance = null;

function getScreenAnalyzer(browserEngine, config) {
  if (!analyzerInstance) {
    analyzerInstance = new ScreenAnalyzer(browserEngine, config);
  } else if (browserEngine) {
    analyzerInstance.setBrowserEngine(browserEngine);
  }
  return analyzerInstance;
}

module.exports = {
  ScreenAnalyzer,
  RegionType,
  AnalysisMode,
  getScreenAnalyzer
};
