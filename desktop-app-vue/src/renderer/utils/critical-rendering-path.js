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

/**
 * Critical CSS Manager
 * 关键CSS管理器
 */
export class CriticalCSSManager {
  constructor(options = {}) {
    this.options = {
      // Viewport size for critical CSS
      viewport: options.viewport || { width: 1920, height: 1080 },

      // CSS to inline
      inlineCSS: options.inlineCSS || [],

      // CSS to defer
      deferCSS: options.deferCSS || [],

      // Debug mode
      debug: options.debug || false,
    };

    this.criticalCSS = "";
    this.deferredCSS = [];
  }

  /**
   * Extract critical CSS
   */
  extractCriticalCSS(html, css) {
    // This is a simplified version
    // In production, use tools like critical, penthouse, or crittr

    const criticalRules = [];
    const parser = new CSSParser();

    try {
      const rules = parser.parse(css);

      rules.forEach((rule) => {
        // Check if rule applies to above-the-fold content
        if (this.isAboveTheFold(rule, html)) {
          criticalRules.push(rule.cssText);
        }
      });

      this.criticalCSS = criticalRules.join("\n");

      if (this.options.debug) {
        console.log(
          `[CriticalCSS] Extracted ${criticalRules.length} critical rules`,
        );
      }

      return this.criticalCSS;
    } catch (error) {
      console.error("[CriticalCSS] Extraction failed:", error);
      return "";
    }
  }

  /**
   * Check if rule is above the fold
   */
  isAboveTheFold(rule, html) {
    // Simplified check - in production use proper viewport detection
    // Check if selector exists in HTML
    return html.includes(rule.selectorText);
  }

  /**
   * Inline critical CSS
   */
  inlineCriticalCSS() {
    if (!this.criticalCSS) {return;}

    const style = document.createElement("style");
    style.textContent = this.criticalCSS;
    style.setAttribute("data-critical", "true");

    // Insert at the beginning of head
    const firstLink = document.head.querySelector('link[rel="stylesheet"]');
    if (firstLink) {
      document.head.insertBefore(style, firstLink);
    } else {
      document.head.appendChild(style);
    }

    if (this.options.debug) {
      console.log("[CriticalCSS] Inlined critical CSS");
    }
  }

  /**
   * Lazy load non-critical CSS
   */
  loadNonCriticalCSS(href) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.media = "print"; // Initially set to print media

    link.onload = () => {
      // Once loaded, switch to all media
      link.media = "all";

      if (this.options.debug) {
        console.log(`[CriticalCSS] Loaded non-critical CSS: ${href}`);
      }
    };

    document.head.appendChild(link);

    // Fallback for browsers without onload support
    setTimeout(() => {
      link.media = "all";
    }, 3000);
  }

  /**
   * Defer all non-critical stylesheets
   */
  deferNonCriticalCSS() {
    const stylesheets = document.querySelectorAll(
      'link[rel="stylesheet"]:not([data-critical])',
    );

    stylesheets.forEach((link) => {
      if (link.href) {
        this.loadNonCriticalCSS(link.href);
        link.remove();
      }
    });

    if (this.options.debug) {
      console.log(`[CriticalCSS] Deferred ${stylesheets.length} stylesheets`);
    }
  }
}

/**
 * Font Optimization Manager
 * 字体优化管理器
 */
export class FontOptimizationManager {
  constructor(options = {}) {
    this.options = {
      // Font display strategy
      fontDisplay: options.fontDisplay || "swap",

      // Fonts to preload
      preloadFonts: options.preloadFonts || [],

      // Enable font subsetting
      subsetting: options.subsetting !== false,

      // Debug mode
      debug: options.debug || false,
    };
  }

  /**
   * Preload fonts
   */
  preloadFonts(fonts = this.options.preloadFonts) {
    fonts.forEach((font) => {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "font";
      link.type = font.type || "font/woff2";
      link.href = font.href;
      link.crossOrigin = "anonymous";

      document.head.appendChild(link);

      if (this.options.debug) {
        console.log(`[FontOptimization] Preloaded font: ${font.href}`);
      }
    });
  }

  /**
   * Apply font-display to @font-face rules
   */
  applyFontDisplay() {
    const styleSheets = document.styleSheets;

    for (let i = 0; i < styleSheets.length; i++) {
      try {
        const rules = styleSheets[i].cssRules || styleSheets[i].rules;

        if (!rules) {continue;}

        for (let j = 0; j < rules.length; j++) {
          const rule = rules[j];

          if (rule.type === CSSRule.FONT_FACE_RULE) {
            // Add font-display if not present
            if (!rule.style.fontDisplay) {
              rule.style.fontDisplay = this.options.fontDisplay;

              if (this.options.debug) {
                console.log(
                  `[FontOptimization] Applied font-display: ${this.options.fontDisplay}`,
                );
              }
            }
          }
        }
      } catch (error) {
        // Cross-origin stylesheets might throw errors
        if (this.options.debug) {
          console.warn(
            "[FontOptimization] Could not access stylesheet:",
            error,
          );
        }
      }
    }
  }

  /**
   * Use system fonts for initial render
   */
  useSystemFonts() {
    // 确保 document.body 存在
    if (!document.body) {
      if (this.options.debug) {
        console.log(
          "[FontOptimization] document.body not ready, skipping system fonts",
        );
      }
      return;
    }

    const systemFontStack = [
      "-apple-system",
      "BlinkMacSystemFont",
      '"Segoe UI"',
      "Roboto",
      '"Helvetica Neue"',
      "Arial",
      "sans-serif",
    ].join(", ");

    document.body.style.fontFamily = systemFontStack;

    if (this.options.debug) {
      console.log("[FontOptimization] Using system fonts for initial render");
    }
  }

  /**
   * Detect font loading support
   */
  supportsFontLoading() {
    return "fonts" in document;
  }

  /**
   * Load fonts using Font Loading API
   */
  async loadFontsWithAPI(fonts) {
    if (!this.supportsFontLoading()) {
      console.warn("[FontOptimization] Font Loading API not supported");
      return;
    }

    const promises = fonts.map((font) => {
      const fontFace = new FontFace(font.family, `url(${font.url})`, {
        weight: font.weight || "normal",
        style: font.style || "normal",
        display: this.options.fontDisplay,
      });

      return fontFace.load().then((loaded) => {
        document.fonts.add(loaded);

        if (this.options.debug) {
          console.log(`[FontOptimization] Loaded font: ${font.family}`);
        }

        return loaded;
      });
    });

    try {
      await Promise.all(promises);

      if (this.options.debug) {
        console.log("[FontOptimization] All fonts loaded");
      }
    } catch (error) {
      console.error("[FontOptimization] Font loading failed:", error);
    }
  }
}

/**
 * Above-the-Fold Optimizer
 * 首屏优化器
 */
export class AboveTheFoldOptimizer {
  constructor(options = {}) {
    this.options = {
      // Viewport height multiplier
      viewportMultiplier: options.viewportMultiplier || 1.5,

      // Enable lazy loading for below-the-fold images
      lazyLoadImages: options.lazyLoadImages !== false,

      // Enable defer for below-the-fold scripts
      deferScripts: options.deferScripts !== false,

      // Debug mode
      debug: options.debug || false,
    };

    this.viewportHeight = window.innerHeight * this.options.viewportMultiplier;
  }

  /**
   * Check if element is above the fold
   */
  isAboveTheFold(element) {
    const rect = element.getBoundingClientRect();
    return rect.top < this.viewportHeight;
  }

  /**
   * Optimize images
   */
  optimizeImages() {
    const images = document.querySelectorAll("img:not([loading])");

    images.forEach((img) => {
      if (this.isAboveTheFold(img)) {
        // Above the fold - eager loading
        img.loading = "eager";

        if (this.options.debug) {
          console.log("[AboveTheFold] Eager load image:", img.src);
        }
      } else if (this.options.lazyLoadImages) {
        // Below the fold - lazy loading
        img.loading = "lazy";

        if (this.options.debug) {
          console.log("[AboveTheFold] Lazy load image:", img.src);
        }
      }
    });
  }

  /**
   * Optimize scripts
   */
  optimizeScripts() {
    const scripts = document.querySelectorAll(
      "script[src]:not([async]):not([defer])",
    );

    scripts.forEach((script) => {
      // Skip critical scripts
      if (script.hasAttribute("data-critical")) {
        return;
      }

      if (this.options.deferScripts) {
        script.defer = true;

        if (this.options.debug) {
          console.log("[AboveTheFold] Deferred script:", script.src);
        }
      }
    });
  }

  /**
   * Run all optimizations
   */
  optimize() {
    this.optimizeImages();
    this.optimizeScripts();

    if (this.options.debug) {
      console.log("[AboveTheFold] Optimization complete");
    }
  }
}

/**
 * Render Blocking Resource Optimizer
 * 渲染阻塞资源优化器
 */
export class RenderBlockingOptimizer {
  constructor(options = {}) {
    this.options = {
      // Async load external stylesheets
      asyncCSS: options.asyncCSS !== false,

      // Defer non-critical scripts
      deferScripts: options.deferScripts !== false,

      // Preconnect to external domains
      preconnectDomains: options.preconnectDomains || [],

      // Debug mode
      debug: options.debug || false,
    };
  }

  /**
   * Optimize stylesheets
   */
  optimizeStylesheets() {
    const links = document.querySelectorAll(
      'link[rel="stylesheet"]:not([data-critical])',
    );

    links.forEach((link) => {
      if (this.options.asyncCSS) {
        // Convert to non-blocking
        link.media = "print";
        link.onload = function () {
          this.media = "all";
        };

        if (this.options.debug) {
          console.log("[RenderBlocking] Made stylesheet async:", link.href);
        }
      }
    });
  }

  /**
   * Optimize scripts
   */
  optimizeScripts() {
    const scripts = document.querySelectorAll(
      "script[src]:not([async]):not([defer]):not([data-critical])",
    );

    scripts.forEach((script) => {
      if (this.options.deferScripts) {
        script.defer = true;

        if (this.options.debug) {
          console.log("[RenderBlocking] Deferred script:", script.src);
        }
      }
    });
  }

  /**
   * Add preconnect for external domains
   */
  addPreconnects() {
    this.options.preconnectDomains.forEach((domain) => {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = domain;
      link.crossOrigin = "anonymous";

      document.head.appendChild(link);

      if (this.options.debug) {
        console.log("[RenderBlocking] Added preconnect:", domain);
      }
    });
  }

  /**
   * Run all optimizations
   */
  optimize() {
    this.optimizeStylesheets();
    this.optimizeScripts();
    this.addPreconnects();

    if (this.options.debug) {
      console.log("[RenderBlocking] Optimization complete");
    }
  }
}

// Simple CSS Parser (for demonstration)
class CSSParser {
  parse(css) {
    // Very simplified - in production use a real CSS parser
    const rules = [];
    const ruleRegex = /([^{]+)\{([^}]+)\}/g;
    let match;

    while ((match = ruleRegex.exec(css)) !== null) {
      rules.push({
        selectorText: match[1].trim(),
        cssText: match[0],
      });
    }

    return rules;
  }
}

// Global instances
export const criticalCSSManager = new CriticalCSSManager();
export const fontOptimizer = new FontOptimizationManager();
export const aboveTheFoldOptimizer = new AboveTheFoldOptimizer();
export const renderBlockingOptimizer = new RenderBlockingOptimizer();

/**
 * Initialize all optimizations
 */
export function initializeCriticalPath(options = {}) {
  console.log("[CriticalPath] Initializing optimizations...");

  // Font optimization
  if (options.fonts) {
    fontOptimizer.preloadFonts(options.fonts);
    fontOptimizer.applyFontDisplay();
  }

  // Above the fold optimization
  if (options.aboveTheFold !== false) {
    aboveTheFoldOptimizer.optimize();
  }

  // Render blocking optimization
  if (options.renderBlocking !== false) {
    renderBlockingOptimizer.optimize();
  }

  console.log("[CriticalPath] Optimizations complete");
}

/**
 * Export default object
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
