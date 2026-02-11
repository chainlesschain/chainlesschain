/**
 * SmartElementDetector - 智能元素检测
 *
 * 使用多种策略检测和定位页面元素：
 * - 基于 DOM 的精确定位
 * - 视觉 AI 辅助定位
 * - 模糊匹配和相似度搜索
 * - 历史缓存加速
 *
 * @module browser/actions/smart-element-detector
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');

/**
 * 检测策略
 */
const DetectionStrategy = {
  EXACT: 'exact',           // 精确匹配（ID, 唯一选择器）
  FUZZY: 'fuzzy',           // 模糊匹配（文本相似度）
  VISUAL: 'visual',         // 视觉检测（AI）
  ACCESSIBILITY: 'accessibility', // 无障碍 API
  HEURISTIC: 'heuristic',   // 启发式规则
  CACHED: 'cached'          // 缓存命中
};

/**
 * 元素类型
 */
const ElementType = {
  BUTTON: 'button',
  LINK: 'link',
  INPUT: 'input',
  SELECT: 'select',
  CHECKBOX: 'checkbox',
  RADIO: 'radio',
  IMAGE: 'image',
  TEXT: 'text',
  CONTAINER: 'container',
  UNKNOWN: 'unknown'
};

/**
 * 匹配置信度阈值
 */
const CONFIDENCE_THRESHOLD = {
  HIGH: 0.9,
  MEDIUM: 0.7,
  LOW: 0.5
};

class SmartElementDetector extends EventEmitter {
  constructor(browserEngine = null, config = {}) {
    super();

    this.browserEngine = browserEngine;
    this.config = {
      enableCache: config.enableCache !== false,
      cacheMaxSize: config.cacheMaxSize || 1000,
      cacheTTL: config.cacheTTL || 300000, // 5 minutes
      enableVisualFallback: config.enableVisualFallback || false,
      confidenceThreshold: config.confidenceThreshold || CONFIDENCE_THRESHOLD.MEDIUM,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 500,
      ...config
    };

    // 元素缓存
    this.elementCache = new Map();

    // 页面指纹缓存
    this.pageFingerprints = new Map();

    // 检测统计
    this.stats = {
      totalDetections: 0,
      cacheHits: 0,
      exactMatches: 0,
      fuzzyMatches: 0,
      visualMatches: 0,
      failures: 0
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
   * 检测元素
   * @param {string} targetId - 标签页 ID
   * @param {Object} query - 查询条件
   * @returns {Promise<Object>}
   */
  async detect(targetId, query) {
    if (!this.browserEngine) {
      throw new Error('Browser engine not set');
    }

    this.stats.totalDetections++;
    const startTime = Date.now();

    // 规范化查询
    const normalizedQuery = this._normalizeQuery(query);

    // 检查缓存
    if (this.config.enableCache) {
      const cached = this._checkCache(targetId, normalizedQuery);
      if (cached) {
        this.stats.cacheHits++;
        this.emit('detected', {
          strategy: DetectionStrategy.CACHED,
          element: cached,
          duration: Date.now() - startTime
        });
        return {
          success: true,
          element: cached,
          strategy: DetectionStrategy.CACHED,
          confidence: 1.0
        };
      }
    }

    // 尝试各种检测策略
    const strategies = [
      () => this._detectExact(targetId, normalizedQuery),
      () => this._detectByAccessibility(targetId, normalizedQuery),
      () => this._detectFuzzy(targetId, normalizedQuery),
      () => this._detectHeuristic(targetId, normalizedQuery)
    ];

    // 如果启用了视觉回退
    if (this.config.enableVisualFallback) {
      strategies.push(() => this._detectVisual(targetId, normalizedQuery));
    }

    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result && result.confidence >= this.config.confidenceThreshold) {
          // 缓存结果
          if (this.config.enableCache) {
            this._cacheElement(targetId, normalizedQuery, result.element);
          }

          this.emit('detected', {
            strategy: result.strategy,
            element: result.element,
            confidence: result.confidence,
            duration: Date.now() - startTime
          });

          return {
            success: true,
            ...result,
            duration: Date.now() - startTime
          };
        }
      } catch (error) {
        // 继续尝试下一个策略
        this.emit('strategyFailed', {
          strategy: strategy.name,
          error: error.message
        });
      }
    }

    this.stats.failures++;

    return {
      success: false,
      error: 'Element not found with any strategy',
      query: normalizedQuery,
      duration: Date.now() - startTime
    };
  }

  /**
   * 规范化查询
   * @private
   */
  _normalizeQuery(query) {
    if (typeof query === 'string') {
      return {
        text: query,
        type: null,
        selector: null,
        role: null
      };
    }
    return {
      text: query.text || query.label || query.name,
      type: query.type || null,
      selector: query.selector || null,
      role: query.role || null,
      attributes: query.attributes || {},
      near: query.near || null,
      index: query.index || 0
    };
  }

  /**
   * 精确检测
   * @private
   */
  async _detectExact(targetId, query) {
    const page = this.browserEngine.getPage(targetId);
    if (!page) return null;

    // 如果有选择器，直接使用
    if (query.selector) {
      const element = await page.$(query.selector);
      if (element) {
        const info = await this._getElementInfo(page, element);
        this.stats.exactMatches++;
        return {
          strategy: DetectionStrategy.EXACT,
          element: info,
          confidence: 1.0
        };
      }
    }

    // 根据 ID 查找
    if (query.text) {
      const byId = await page.$(`#${CSS.escape(query.text)}`);
      if (byId) {
        const info = await this._getElementInfo(page, byId);
        this.stats.exactMatches++;
        return {
          strategy: DetectionStrategy.EXACT,
          element: info,
          confidence: 1.0
        };
      }
    }

    return null;
  }

  /**
   * 无障碍 API 检测
   * @private
   */
  async _detectByAccessibility(targetId, query) {
    const page = this.browserEngine.getPage(targetId);
    if (!page) return null;

    const result = await page.evaluate((q) => {
      const elements = [];

      // 获取所有可交互元素
      const interactiveSelectors = [
        'button', 'a', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="textbox"]',
        '[tabindex]', '[onclick]'
      ];

      const allElements = document.querySelectorAll(interactiveSelectors.join(','));

      for (const el of allElements) {
        const ariaLabel = el.getAttribute('aria-label');
        const ariaLabelledBy = el.getAttribute('aria-labelledby');
        const title = el.getAttribute('title');
        const placeholder = el.getAttribute('placeholder');
        const name = el.getAttribute('name');
        const id = el.id;
        const textContent = el.textContent?.trim()?.substring(0, 100);
        const role = el.getAttribute('role') || el.tagName.toLowerCase();

        // 构建可搜索的标签集合
        const labels = [ariaLabel, title, placeholder, name, id, textContent]
          .filter(Boolean)
          .map(s => s.toLowerCase());

        // 检查是否匹配
        const queryText = q.text?.toLowerCase();
        const queryRole = q.role?.toLowerCase();

        let match = false;
        let confidence = 0;

        if (queryText) {
          for (const label of labels) {
            if (label === queryText) {
              match = true;
              confidence = 1.0;
              break;
            } else if (label.includes(queryText)) {
              match = true;
              confidence = Math.max(confidence, 0.8);
            }
          }
        }

        if (queryRole && role === queryRole) {
          match = match || true;
          confidence = Math.max(confidence, 0.9);
        }

        if (match) {
          const rect = el.getBoundingClientRect();
          elements.push({
            tagName: el.tagName.toLowerCase(),
            role,
            labels,
            confidence,
            bounds: {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height
            },
            attributes: {
              id: el.id,
              class: el.className,
              name: el.name
            }
          });
        }
      }

      // 按置信度排序
      return elements.sort((a, b) => b.confidence - a.confidence);
    }, query);

    if (result && result.length > 0) {
      const index = query.index || 0;
      const match = result[index];
      if (match) {
        return {
          strategy: DetectionStrategy.ACCESSIBILITY,
          element: match,
          confidence: match.confidence
        };
      }
    }

    return null;
  }

  /**
   * 模糊检测
   * @private
   */
  async _detectFuzzy(targetId, query) {
    if (!query.text) return null;

    const page = this.browserEngine.getPage(targetId);
    if (!page) return null;

    const result = await page.evaluate((q) => {
      // 简单的 Levenshtein 距离计算
      function levenshtein(a, b) {
        const matrix = [];
        for (let i = 0; i <= b.length; i++) {
          matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
          matrix[0][j] = j;
        }
        for (let i = 1; i <= b.length; i++) {
          for (let j = 1; j <= a.length; j++) {
            if (b[i - 1] === a[j - 1]) {
              matrix[i][j] = matrix[i - 1][j - 1];
            } else {
              matrix[i][j] = Math.min(
                matrix[i - 1][j - 1] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j] + 1
              );
            }
          }
        }
        return matrix[b.length][a.length];
      }

      function similarity(s1, s2) {
        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;
        if (longer.length === 0) return 1.0;
        return (longer.length - levenshtein(longer, shorter)) / longer.length;
      }

      const queryText = q.text.toLowerCase();
      const candidates = [];

      // 搜索所有文本元素
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        null,
        false
      );

      while (walker.nextNode()) {
        const el = walker.currentNode;
        const text = el.textContent?.trim()?.substring(0, 200)?.toLowerCase();

        if (text && text.length > 0 && text.length < 100) {
          const sim = similarity(queryText, text);
          if (sim > 0.5) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              candidates.push({
                tagName: el.tagName.toLowerCase(),
                text: text.substring(0, 50),
                confidence: sim,
                bounds: {
                  x: rect.left,
                  y: rect.top,
                  width: rect.width,
                  height: rect.height
                }
              });
            }
          }
        }
      }

      return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    }, query);

    if (result && result.length > 0) {
      const index = query.index || 0;
      const match = result[index];
      if (match && match.confidence >= 0.6) {
        this.stats.fuzzyMatches++;
        return {
          strategy: DetectionStrategy.FUZZY,
          element: match,
          confidence: match.confidence
        };
      }
    }

    return null;
  }

  /**
   * 启发式检测
   * @private
   */
  async _detectHeuristic(targetId, query) {
    const page = this.browserEngine.getPage(targetId);
    if (!page) return null;

    // 基于类型的启发式规则
    const typeSelectors = {
      [ElementType.BUTTON]: 'button, [role="button"], input[type="submit"], input[type="button"], .btn, .button',
      [ElementType.LINK]: 'a[href], [role="link"]',
      [ElementType.INPUT]: 'input[type="text"], input[type="email"], input[type="password"], input:not([type]), textarea, [role="textbox"]',
      [ElementType.SELECT]: 'select, [role="listbox"], [role="combobox"]',
      [ElementType.CHECKBOX]: 'input[type="checkbox"], [role="checkbox"]',
      [ElementType.RADIO]: 'input[type="radio"], [role="radio"]',
      [ElementType.IMAGE]: 'img, [role="img"], svg'
    };

    const selector = query.type ? typeSelectors[query.type] : Object.values(typeSelectors).join(',');

    const result = await page.evaluate((sel, q) => {
      const elements = document.querySelectorAll(sel);
      const candidates = [];

      for (const el of elements) {
        const text = el.textContent?.trim()?.toLowerCase() || '';
        const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
        const placeholder = el.getAttribute('placeholder')?.toLowerCase() || '';
        const value = el.value?.toLowerCase() || '';

        const allText = `${text} ${ariaLabel} ${placeholder} ${value}`;
        const queryText = q.text?.toLowerCase() || '';

        let score = 0;
        if (queryText && allText.includes(queryText)) {
          score = queryText.length / Math.max(allText.length, 1);
        }

        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && score > 0) {
          candidates.push({
            tagName: el.tagName.toLowerCase(),
            text: text.substring(0, 50),
            confidence: Math.min(score + 0.3, 0.9), // 启发式最高 0.9
            bounds: {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height
            }
          });
        }
      }

      return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    }, selector, query);

    if (result && result.length > 0) {
      const index = query.index || 0;
      const match = result[index];
      if (match) {
        return {
          strategy: DetectionStrategy.HEURISTIC,
          element: match,
          confidence: match.confidence
        };
      }
    }

    return null;
  }

  /**
   * 视觉检测（需要 Vision AI）
   * @private
   */
  async _detectVisual(targetId, query) {
    // 需要 VisionAction 支持
    // 这里只是占位，实际实现需要集成 Vision AI
    this.emit('visualDetectionAttempted', { query });
    return null;
  }

  /**
   * 获取元素信息
   * @private
   */
  async _getElementInfo(page, element) {
    return page.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return {
        tagName: el.tagName.toLowerCase(),
        text: el.textContent?.trim()?.substring(0, 100),
        bounds: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        },
        attributes: {
          id: el.id,
          class: el.className,
          name: el.name,
          type: el.type,
          role: el.getAttribute('role')
        }
      };
    }, element);
  }

  /**
   * 检查缓存
   * @private
   */
  _checkCache(targetId, query) {
    const key = this._getCacheKey(targetId, query);
    const cached = this.elementCache.get(key);

    if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
      return cached.element;
    }

    return null;
  }

  /**
   * 缓存元素
   * @private
   */
  _cacheElement(targetId, query, element) {
    const key = this._getCacheKey(targetId, query);

    // 检查缓存大小
    if (this.elementCache.size >= this.config.cacheMaxSize) {
      // 删除最老的条目
      const oldestKey = this.elementCache.keys().next().value;
      this.elementCache.delete(oldestKey);
    }

    this.elementCache.set(key, {
      element,
      timestamp: Date.now()
    });
  }

  /**
   * 生成缓存键
   * @private
   */
  _getCacheKey(targetId, query) {
    return `${targetId}:${JSON.stringify(query)}`;
  }

  /**
   * 清除缓存
   * @param {string} targetId - 可选，只清除特定标签页的缓存
   */
  clearCache(targetId = null) {
    if (targetId) {
      for (const key of this.elementCache.keys()) {
        if (key.startsWith(`${targetId}:`)) {
          this.elementCache.delete(key);
        }
      }
    } else {
      this.elementCache.clear();
    }

    this.emit('cacheCleared', { targetId });
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.elementCache.size,
      cacheHitRate: this.stats.totalDetections > 0
        ? (this.stats.cacheHits / this.stats.totalDetections * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalDetections: 0,
      cacheHits: 0,
      exactMatches: 0,
      fuzzyMatches: 0,
      visualMatches: 0,
      failures: 0
    };
  }

  /**
   * 批量检测
   * @param {string} targetId - 标签页 ID
   * @param {Array} queries - 查询列表
   * @returns {Promise<Array>}
   */
  async detectMultiple(targetId, queries) {
    const results = [];

    for (const query of queries) {
      const result = await this.detect(targetId, query);
      results.push(result);
    }

    return {
      success: results.every(r => r.success),
      found: results.filter(r => r.success).length,
      total: queries.length,
      results
    };
  }

  /**
   * 等待元素出现
   * @param {string} targetId - 标签页 ID
   * @param {Object} query - 查询条件
   * @param {Object} options - 等待选项
   * @returns {Promise<Object>}
   */
  async waitFor(targetId, query, options = {}) {
    const timeout = options.timeout || 30000;
    const interval = options.interval || 500;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.detect(targetId, query);
      if (result.success) {
        return result;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    return {
      success: false,
      error: 'Timeout waiting for element',
      query,
      timeout
    };
  }
}

// 单例
let detectorInstance = null;

function getSmartElementDetector(browserEngine, config) {
  if (!detectorInstance) {
    detectorInstance = new SmartElementDetector(browserEngine, config);
  } else if (browserEngine) {
    detectorInstance.setBrowserEngine(browserEngine);
  }
  return detectorInstance;
}

module.exports = {
  SmartElementDetector,
  DetectionStrategy,
  ElementType,
  CONFIDENCE_THRESHOLD,
  getSmartElementDetector
};
