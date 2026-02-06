/**
 * Critical Rendering Path Optimization
 * 关键渲染路径优化
 *
 * Features:
 * - Critical CSS extraction and inlining
 * - Non-critical CSS lazy loading
 * - Font optimization (preload, font-display)
 * - Above-the-fold optimization
 * - Render-blocking resource optimization
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 视口尺寸
 */
export interface ViewportSize {
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}

/**
 * 关键CSS管理器选项
 */
export interface CriticalCSSManagerOptions {
  /** 视口尺寸 */
  viewport?: ViewportSize;
  /** 要内联的CSS */
  inlineCSS?: string[];
  /** 要延迟加载的CSS */
  deferCSS?: string[];
  /** 是否启用调试模式 */
  debug?: boolean;
}

/**
 * CSS规则
 */
export interface CSSRule {
  /** 选择器文本 */
  selectorText: string;
  /** CSS文本 */
  cssText: string;
}

/**
 * 字体配置
 */
export interface FontConfig {
  /** 字体文件URL */
  href: string;
  /** 字体类型 (默认: 'font/woff2') */
  type?: string;
}

/**
 * 字体加载配置
 */
export interface FontLoadConfig {
  /** 字体族名称 */
  family: string;
  /** 字体文件URL */
  url: string;
  /** 字体粗细 */
  weight?: string;
  /** 字体样式 */
  style?: string;
}

/**
 * 字体优化管理器选项
 */
export interface FontOptimizationManagerOptions {
  /** 字体显示策略 (默认: 'swap') */
  fontDisplay?: FontDisplay;
  /** 要预加载的字体 */
  preloadFonts?: FontConfig[];
  /** 是否启用字体子集化 */
  subsetting?: boolean;
  /** 是否启用调试模式 */
  debug?: boolean;
}

/**
 * 字体显示策略
 */
export type FontDisplay = 'auto' | 'block' | 'swap' | 'fallback' | 'optional';

/**
 * 首屏优化器选项
 */
export interface AboveTheFoldOptimizerOptions {
  /** 视口高度倍数 (默认: 1.5) */
  viewportMultiplier?: number;
  /** 是否启用图片懒加载 */
  lazyLoadImages?: boolean;
  /** 是否启用脚本延迟 */
  deferScripts?: boolean;
  /** 是否启用调试模式 */
  debug?: boolean;
}

/**
 * 渲染阻塞优化器选项
 */
export interface RenderBlockingOptimizerOptions {
  /** 是否异步加载CSS */
  asyncCSS?: boolean;
  /** 是否延迟加载脚本 */
  deferScripts?: boolean;
  /** 要预连接的域名 */
  preconnectDomains?: string[];
  /** 是否启用调试模式 */
  debug?: boolean;
}

/**
 * 关键路径初始化选项
 */
export interface CriticalPathOptions {
  /** 要预加载的字体 */
  fonts?: FontConfig[];
  /** 是否启用首屏优化 */
  aboveTheFold?: boolean;
  /** 是否启用渲染阻塞优化 */
  renderBlocking?: boolean;
}

// ==================== CSS解析器 ====================

/**
 * 简单CSS解析器 (用于演示)
 */
class CSSParser {
  /**
   * 解析CSS
   * @param css - CSS文本
   * @returns CSS规则数组
   */
  parse(css: string): CSSRule[] {
    // 非常简化的实现 - 生产环境中使用真正的CSS解析器
    const rules: CSSRule[] = [];
    const ruleRegex = /([^{]+)\{([^}]+)\}/g;
    let match: RegExpExecArray | null;

    while ((match = ruleRegex.exec(css)) !== null) {
      rules.push({
        selectorText: match[1].trim(),
        cssText: match[0],
      });
    }

    return rules;
  }
}

// ==================== 关键CSS管理器 ====================

/**
 * 关键CSS管理器
 */
export class CriticalCSSManager {
  private options: Required<CriticalCSSManagerOptions>;
  private criticalCSS: string = '';
  private deferredCSS: string[] = [];

  constructor(options: CriticalCSSManagerOptions = {}) {
    this.options = {
      viewport: options.viewport ?? { width: 1920, height: 1080 },
      inlineCSS: options.inlineCSS ?? [],
      deferCSS: options.deferCSS ?? [],
      debug: options.debug ?? false,
    };
  }

  /**
   * 提取关键CSS
   * @param html - HTML内容
   * @param css - CSS内容
   * @returns 关键CSS
   */
  extractCriticalCSS(html: string, css: string): string {
    // 这是一个简化版本
    // 生产环境中使用 critical, penthouse, 或 crittr 等工具

    const criticalRules: string[] = [];
    const parser = new CSSParser();

    try {
      const rules = parser.parse(css);

      rules.forEach((rule) => {
        // 检查规则是否适用于首屏内容
        if (this.isAboveTheFold(rule, html)) {
          criticalRules.push(rule.cssText);
        }
      });

      this.criticalCSS = criticalRules.join('\n');

      if (this.options.debug) {
        logger.info(`[CriticalCSS] Extracted ${criticalRules.length} critical rules`);
      }

      return this.criticalCSS;
    } catch (error) {
      logger.error('[CriticalCSS] Extraction failed:', error);
      return '';
    }
  }

  /**
   * 检查规则是否在首屏
   * @param rule - CSS规则
   * @param html - HTML内容
   * @returns 是否在首屏
   */
  private isAboveTheFold(rule: CSSRule, html: string): boolean {
    // 简化检查 - 生产环境中使用适当的视口检测
    // 检查选择器是否存在于HTML中
    return html.includes(rule.selectorText);
  }

  /**
   * 内联关键CSS
   */
  inlineCriticalCSS(): void {
    if (!this.criticalCSS) {
      return;
    }

    const style = document.createElement('style');
    style.textContent = this.criticalCSS;
    style.setAttribute('data-critical', 'true');

    // 插入到head的开头
    const firstLink = document.head.querySelector('link[rel="stylesheet"]');
    if (firstLink) {
      document.head.insertBefore(style, firstLink);
    } else {
      document.head.appendChild(style);
    }

    if (this.options.debug) {
      logger.info('[CriticalCSS] Inlined critical CSS');
    }
  }

  /**
   * 懒加载非关键CSS
   * @param href - CSS文件URL
   */
  loadNonCriticalCSS(href: string): void {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.media = 'print'; // 初始设置为print媒体

    link.onload = (): void => {
      // 加载后切换到all媒体
      link.media = 'all';

      if (this.options.debug) {
        logger.info(`[CriticalCSS] Loaded non-critical CSS: ${href}`);
      }
    };

    document.head.appendChild(link);

    // 对于不支持onload的浏览器的回退
    setTimeout(() => {
      link.media = 'all';
    }, 3000);
  }

  /**
   * 延迟加载所有非关键样式表
   */
  deferNonCriticalCSS(): void {
    const stylesheets = document.querySelectorAll<HTMLLinkElement>(
      'link[rel="stylesheet"]:not([data-critical])'
    );

    stylesheets.forEach((link) => {
      if (link.href) {
        this.loadNonCriticalCSS(link.href);
        link.remove();
      }
    });

    if (this.options.debug) {
      logger.info(`[CriticalCSS] Deferred ${stylesheets.length} stylesheets`);
    }
  }
}

// ==================== 字体优化管理器 ====================

/**
 * 字体优化管理器
 */
export class FontOptimizationManager {
  private options: Required<FontOptimizationManagerOptions>;

  constructor(options: FontOptimizationManagerOptions = {}) {
    this.options = {
      fontDisplay: options.fontDisplay ?? 'swap',
      preloadFonts: options.preloadFonts ?? [],
      subsetting: options.subsetting !== false,
      debug: options.debug ?? false,
    };
  }

  /**
   * 预加载字体
   * @param fonts - 要预加载的字体配置数组
   */
  preloadFonts(fonts: FontConfig[] = this.options.preloadFonts): void {
    fonts.forEach((font) => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'font';
      link.type = font.type ?? 'font/woff2';
      link.href = font.href;
      link.crossOrigin = 'anonymous';

      document.head.appendChild(link);

      if (this.options.debug) {
        logger.info(`[FontOptimization] Preloaded font: ${font.href}`);
      }
    });
  }

  /**
   * 应用font-display到@font-face规则
   */
  applyFontDisplay(): void {
    const styleSheets = document.styleSheets;

    for (let i = 0; i < styleSheets.length; i++) {
      try {
        const rules = styleSheets[i].cssRules || (styleSheets[i] as CSSStyleSheet).rules;

        if (!rules) {
          continue;
        }

        for (let j = 0; j < rules.length; j++) {
          const rule = rules[j];

          if (rule.type === CSSRule.FONT_FACE_RULE) {
            const fontFaceRule = rule as CSSFontFaceRule;
            // 如果不存在则添加font-display
            if (!fontFaceRule.style.fontDisplay) {
              fontFaceRule.style.fontDisplay = this.options.fontDisplay;

              if (this.options.debug) {
                logger.info(
                  `[FontOptimization] Applied font-display: ${this.options.fontDisplay}`
                );
              }
            }
          }
        }
      } catch (error) {
        // 跨域样式表可能会抛出错误
        if (this.options.debug) {
          logger.warn('[FontOptimization] Could not access stylesheet:', error);
        }
      }
    }
  }

  /**
   * 使用系统字体进行初始渲染
   */
  useSystemFonts(): void {
    // 确保document.body存在
    if (!document.body) {
      if (this.options.debug) {
        logger.info(
          '[FontOptimization] document.body not ready, skipping system fonts'
        );
      }
      return;
    }

    const systemFontStack = [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(', ');

    document.body.style.fontFamily = systemFontStack;

    if (this.options.debug) {
      logger.info('[FontOptimization] Using system fonts for initial render');
    }
  }

  /**
   * 检测字体加载API支持
   * @returns 是否支持Font Loading API
   */
  supportsFontLoading(): boolean {
    return 'fonts' in document;
  }

  /**
   * 使用Font Loading API加载字体
   * @param fonts - 字体加载配置数组
   */
  async loadFontsWithAPI(fonts: FontLoadConfig[]): Promise<void> {
    if (!this.supportsFontLoading()) {
      logger.warn('[FontOptimization] Font Loading API not supported');
      return;
    }

    const promises = fonts.map((font) => {
      const fontFace = new FontFace(font.family, `url(${font.url})`, {
        weight: font.weight ?? 'normal',
        style: font.style ?? 'normal',
        display: this.options.fontDisplay,
      });

      return fontFace.load().then((loaded) => {
        document.fonts.add(loaded);

        if (this.options.debug) {
          logger.info(`[FontOptimization] Loaded font: ${font.family}`);
        }

        return loaded;
      });
    });

    try {
      await Promise.all(promises);

      if (this.options.debug) {
        logger.info('[FontOptimization] All fonts loaded');
      }
    } catch (error) {
      logger.error('[FontOptimization] Font loading failed:', error);
    }
  }
}

// ==================== 首屏优化器 ====================

/**
 * 首屏优化器
 */
export class AboveTheFoldOptimizer {
  private options: Required<AboveTheFoldOptimizerOptions>;
  private viewportHeight: number;

  constructor(options: AboveTheFoldOptimizerOptions = {}) {
    this.options = {
      viewportMultiplier: options.viewportMultiplier ?? 1.5,
      lazyLoadImages: options.lazyLoadImages !== false,
      deferScripts: options.deferScripts !== false,
      debug: options.debug ?? false,
    };

    this.viewportHeight = window.innerHeight * this.options.viewportMultiplier;
  }

  /**
   * 检查元素是否在首屏
   * @param element - HTML元素
   * @returns 是否在首屏
   */
  isAboveTheFold(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    return rect.top < this.viewportHeight;
  }

  /**
   * 优化图片
   */
  optimizeImages(): void {
    const images = document.querySelectorAll<HTMLImageElement>('img:not([loading])');

    images.forEach((img) => {
      if (this.isAboveTheFold(img)) {
        // 首屏 - 急切加载
        img.loading = 'eager';

        if (this.options.debug) {
          logger.info('[AboveTheFold] Eager load image:', img.src);
        }
      } else if (this.options.lazyLoadImages) {
        // 非首屏 - 懒加载
        img.loading = 'lazy';

        if (this.options.debug) {
          logger.info('[AboveTheFold] Lazy load image:', img.src);
        }
      }
    });
  }

  /**
   * 优化脚本
   */
  optimizeScripts(): void {
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      'script[src]:not([async]):not([defer])'
    );

    scripts.forEach((script) => {
      // 跳过关键脚本
      if (script.hasAttribute('data-critical')) {
        return;
      }

      if (this.options.deferScripts) {
        script.defer = true;

        if (this.options.debug) {
          logger.info('[AboveTheFold] Deferred script:', script.src);
        }
      }
    });
  }

  /**
   * 运行所有优化
   */
  optimize(): void {
    this.optimizeImages();
    this.optimizeScripts();

    if (this.options.debug) {
      logger.info('[AboveTheFold] Optimization complete');
    }
  }
}

// ==================== 渲染阻塞优化器 ====================

/**
 * 渲染阻塞资源优化器
 */
export class RenderBlockingOptimizer {
  private options: Required<RenderBlockingOptimizerOptions>;

  constructor(options: RenderBlockingOptimizerOptions = {}) {
    this.options = {
      asyncCSS: options.asyncCSS !== false,
      deferScripts: options.deferScripts !== false,
      preconnectDomains: options.preconnectDomains ?? [],
      debug: options.debug ?? false,
    };
  }

  /**
   * 优化样式表
   */
  optimizeStylesheets(): void {
    const links = document.querySelectorAll<HTMLLinkElement>(
      'link[rel="stylesheet"]:not([data-critical])'
    );

    links.forEach((link) => {
      if (this.options.asyncCSS) {
        // 转换为非阻塞
        link.media = 'print';
        link.onload = function (this: HTMLLinkElement): void {
          this.media = 'all';
        };

        if (this.options.debug) {
          logger.info('[RenderBlocking] Made stylesheet async:', link.href);
        }
      }
    });
  }

  /**
   * 优化脚本
   */
  optimizeScripts(): void {
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      'script[src]:not([async]):not([defer]):not([data-critical])'
    );

    scripts.forEach((script) => {
      if (this.options.deferScripts) {
        script.defer = true;

        if (this.options.debug) {
          logger.info('[RenderBlocking] Deferred script:', script.src);
        }
      }
    });
  }

  /**
   * 添加外部域名预连接
   */
  addPreconnects(): void {
    this.options.preconnectDomains.forEach((domain) => {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = domain;
      link.crossOrigin = 'anonymous';

      document.head.appendChild(link);

      if (this.options.debug) {
        logger.info('[RenderBlocking] Added preconnect:', domain);
      }
    });
  }

  /**
   * 运行所有优化
   */
  optimize(): void {
    this.optimizeStylesheets();
    this.optimizeScripts();
    this.addPreconnects();

    if (this.options.debug) {
      logger.info('[RenderBlocking] Optimization complete');
    }
  }
}

// ==================== 全局实例 ====================

/** 关键CSS管理器实例 */
export const criticalCSSManager = new CriticalCSSManager();

/** 字体优化器实例 */
export const fontOptimizer = new FontOptimizationManager();

/** 首屏优化器实例 */
export const aboveTheFoldOptimizer = new AboveTheFoldOptimizer();

/** 渲染阻塞优化器实例 */
export const renderBlockingOptimizer = new RenderBlockingOptimizer();

/**
 * 初始化所有优化
 * @param options - 初始化选项
 */
export function initializeCriticalPath(options: CriticalPathOptions = {}): void {
  logger.info('[CriticalPath] Initializing optimizations...');

  // 字体优化
  if (options.fonts) {
    fontOptimizer.preloadFonts(options.fonts);
    fontOptimizer.applyFontDisplay();
  }

  // 首屏优化
  if (options.aboveTheFold !== false) {
    aboveTheFoldOptimizer.optimize();
  }

  // 渲染阻塞优化
  if (options.renderBlocking !== false) {
    renderBlockingOptimizer.optimize();
  }

  logger.info('[CriticalPath] Optimizations complete');
}

/**
 * 默认导出
 */
export default {
  CriticalCSSManager,
  FontOptimizationManager,
  AboveTheFoldOptimizer,
  RenderBlockingOptimizer,
  criticalCSSManager,
  fontOptimizer,
  aboveTheFoldOptimizer,
  renderBlockingOptimizer,
  initializeCriticalPath,
};
