/**
 * ClipboardManager - 剪贴板管理器
 *
 * 高级剪贴板操作：
 * - 文本/图片/HTML 复制粘贴
 * - 剪贴板历史记录
 * - 跨标签页剪贴板同步
 * - 敏感内容过滤
 *
 * @module browser/actions/clipboard-manager
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require("events");

// Lazy load electron modules to allow dependency injection in tests
let electronClipboard = null;
let electronNativeImage = null;
const getElectronModules = () => {
  if (!electronClipboard) {
    try {
      const electron = require("electron");
      electronClipboard = electron.clipboard;
      electronNativeImage = electron.nativeImage;
    } catch (e) {
      // Electron not available (test environment)
      electronClipboard = null;
      electronNativeImage = null;
    }
  }
  return { clipboard: electronClipboard, nativeImage: electronNativeImage };
};

/**
 * 剪贴板内容类型
 */
const ClipboardType = {
  TEXT: "text",
  HTML: "html",
  IMAGE: "image",
  RTF: "rtf",
  FILES: "files",
  UNKNOWN: "unknown",
};

/**
 * 敏感内容模式
 */
const SENSITIVE_PATTERNS = [
  /\b\d{16}\b/, // 信用卡号
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
  /password\s*[:=]\s*\S+/i, // 密码
  /api[_-]?key\s*[:=]\s*\S+/i, // API Key
  /secret\s*[:=]\s*\S+/i, // Secret
  /token\s*[:=]\s*\S+/i, // Token
];

class ClipboardManager extends EventEmitter {
  /**
   * @param {Object} browserEngine - Browser engine instance
   * @param {Object} config - Configuration options
   * @param {Object} [dependencies] - Optional dependency injection for testing
   */
  constructor(browserEngine = null, config = {}, dependencies = {}) {
    super();

    // Dependency injection for testing
    const electronModules =
      dependencies.electronModules || getElectronModules();
    this.clipboard = electronModules.clipboard;
    this.nativeImage = electronModules.nativeImage;

    this.browserEngine = browserEngine;
    this.config = {
      enableHistory: config.enableHistory !== false,
      maxHistorySize: config.maxHistorySize || 50,
      filterSensitive: config.filterSensitive !== false,
      sensitivePatterns: config.sensitivePatterns || SENSITIVE_PATTERNS,
      syncInterval: config.syncInterval || 1000,
      enableSync: config.enableSync || false,
      ...config,
    };

    // 剪贴板历史
    this.history = [];

    // 当前内容
    this.currentContent = null;

    // 同步定时器
    this.syncTimer = null;

    // 统计
    this.stats = {
      totalCopies: 0,
      totalPastes: 0,
      sensitiveBlocked: 0,
      byType: {},
    };

    // 启动同步
    if (this.config.enableSync) {
      this._startSync();
    }
  }

  /**
   * 设置浏览器引擎
   * @param {Object} browserEngine
   */
  setBrowserEngine(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * 复制文本到剪贴板
   * @param {string} text - 文本内容
   * @param {Object} options - 选项
   * @returns {Object}
   */
  copyText(text, options = {}) {
    try {
      // 检查敏感内容
      if (this.config.filterSensitive && !options.allowSensitive) {
        const sensitiveCheck = this._checkSensitive(text);
        if (sensitiveCheck.hasSensitive) {
          this.stats.sensitiveBlocked++;
          this.emit("sensitiveBlocked", sensitiveCheck);

          if (!options.forceCopy) {
            return {
              success: false,
              blocked: true,
              reason: "Sensitive content detected",
              matches: sensitiveCheck.matches,
            };
          }
        }
      }

      this.clipboard.writeText(text);

      this._recordHistory({
        type: ClipboardType.TEXT,
        content: text,
        timestamp: Date.now(),
        source: options.source || "manual",
      });

      this._updateStats(ClipboardType.TEXT, "copy");

      this.emit("copied", { type: ClipboardType.TEXT, length: text.length });

      return { success: true, type: ClipboardType.TEXT };
    } catch (error) {
      this.emit("error", { action: "copyText", error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 复制 HTML 到剪贴板
   * @param {string} html - HTML 内容
   * @param {string} fallbackText - 纯文本回退
   * @returns {Object}
   */
  copyHTML(html, fallbackText = "") {
    try {
      this.clipboard.write({
        html: html,
        text: fallbackText || this._stripHTML(html),
      });

      this._recordHistory({
        type: ClipboardType.HTML,
        content: html,
        fallback: fallbackText,
        timestamp: Date.now(),
      });

      this._updateStats(ClipboardType.HTML, "copy");

      this.emit("copied", { type: ClipboardType.HTML, length: html.length });

      return { success: true, type: ClipboardType.HTML };
    } catch (error) {
      this.emit("error", { action: "copyHTML", error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 复制图片到剪贴板
   * @param {string|Buffer} imageData - 图片数据（base64 或 Buffer）
   * @returns {Object}
   */
  copyImage(imageData) {
    try {
      let image;

      if (typeof imageData === "string") {
        // Base64 字符串
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
        image = this.nativeImage.createFromBuffer(
          Buffer.from(base64Data, "base64"),
        );
      } else if (Buffer.isBuffer(imageData)) {
        image = this.nativeImage.createFromBuffer(imageData);
      } else {
        return { success: false, error: "Invalid image data" };
      }

      if (image.isEmpty()) {
        return { success: false, error: "Failed to create image" };
      }

      this.clipboard.writeImage(image);

      this._recordHistory({
        type: ClipboardType.IMAGE,
        size: image.getSize(),
        timestamp: Date.now(),
      });

      this._updateStats(ClipboardType.IMAGE, "copy");

      this.emit("copied", { type: ClipboardType.IMAGE, size: image.getSize() });

      return {
        success: true,
        type: ClipboardType.IMAGE,
        size: image.getSize(),
      };
    } catch (error) {
      this.emit("error", { action: "copyImage", error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 从页面元素复制
   * @param {string} targetId - 标签页 ID
   * @param {string} selector - 元素选择器
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async copyFromElement(targetId, selector, options = {}) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      const content = await page.evaluate(
        (sel, opts) => {
          const element = document.querySelector(sel);
          if (!element) {
            return null;
          }

          if (opts.html) {
            return {
              type: "html",
              content: element.innerHTML,
              text: element.textContent,
            };
          }
          return {
            type: "text",
            content: element.textContent || element.value || "",
          };
        },
        selector,
        options,
      );

      if (!content) {
        return { success: false, error: "Element not found" };
      }

      if (content.type === "html") {
        return this.copyHTML(content.content, content.text);
      }

      return this.copyText(content.content, { source: "element" });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 读取剪贴板内容
   * @param {string} type - 内容类型
   * @returns {Object}
   */
  read(type = null) {
    try {
      const formats = this.clipboard.availableFormats();

      if (
        type === ClipboardType.TEXT ||
        (!type && formats.includes("text/plain"))
      ) {
        const text = this.clipboard.readText();
        return { success: true, type: ClipboardType.TEXT, content: text };
      }

      if (
        type === ClipboardType.HTML ||
        (!type && formats.includes("text/html"))
      ) {
        const html = this.clipboard.readHTML();
        const text = this.clipboard.readText();
        return { success: true, type: ClipboardType.HTML, content: html, text };
      }

      if (
        type === ClipboardType.IMAGE ||
        (!type && formats.some((f) => f.startsWith("image/")))
      ) {
        const image = this.clipboard.readImage();
        if (!image.isEmpty()) {
          return {
            success: true,
            type: ClipboardType.IMAGE,
            content: image.toDataURL(),
            size: image.getSize(),
          };
        }
      }

      if (type === ClipboardType.RTF || formats.includes("text/rtf")) {
        const rtf = this.clipboard.readRTF();
        return { success: true, type: ClipboardType.RTF, content: rtf };
      }

      return { success: true, type: ClipboardType.UNKNOWN, formats };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 粘贴到页面元素
   * @param {string} targetId - 标签页 ID
   * @param {string} selector - 元素选择器
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async pasteToElement(targetId, selector, options = {}) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      const content = this.read(options.type || ClipboardType.TEXT);
      if (!content.success) {
        return content;
      }

      const text =
        content.type === ClipboardType.HTML ? content.text : content.content;

      await page.evaluate(
        (sel, value) => {
          const element = document.querySelector(sel);
          if (!element) {
            throw new Error("Element not found");
          }

          if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
            element.value = value;
            element.dispatchEvent(new Event("input", { bubbles: true }));
          } else if (element.isContentEditable) {
            element.textContent = value;
            element.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            throw new Error("Element is not editable");
          }
        },
        selector,
        text,
      );

      this._updateStats(content.type, "paste");

      this.emit("pasted", { type: content.type, selector });

      return { success: true, type: content.type };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 模拟键盘粘贴
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>}
   */
  async simulatePaste(targetId) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      await page.keyboard.down("Control");
      await page.keyboard.press("v");
      await page.keyboard.up("Control");

      this._updateStats(ClipboardType.TEXT, "paste");

      this.emit("pasted", { type: "keyboard", targetId });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 清空剪贴板
   * @returns {Object}
   */
  clear() {
    try {
      this.clipboard.clear();

      this.emit("cleared");

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取可用格式
   * @returns {Array}
   */
  getFormats() {
    return this.clipboard.availableFormats();
  }

  /**
   * 获取历史记录
   * @param {number} limit - 返回数量
   * @returns {Array}
   */
  getHistory(limit = 20) {
    return this.history.slice(-limit).reverse();
  }

  /**
   * 从历史记录恢复
   * @param {number} index - 历史索引
   * @returns {Object}
   */
  restoreFromHistory(index) {
    const reversedHistory = [...this.history].reverse();
    const entry = reversedHistory[index];

    if (!entry) {
      return { success: false, error: "History entry not found" };
    }

    switch (entry.type) {
      case ClipboardType.TEXT:
        return this.copyText(entry.content, { source: "history" });
      case ClipboardType.HTML:
        return this.copyHTML(entry.content, entry.fallback);
      default:
        return { success: false, error: "Cannot restore this type" };
    }
  }

  /**
   * 清除历史
   */
  clearHistory() {
    this.history = [];
    this.emit("historyCleared");
  }

  /**
   * 检查敏感内容
   * @private
   */
  _checkSensitive(text) {
    const matches = [];

    for (const pattern of this.config.sensitivePatterns) {
      if (pattern.test(text)) {
        matches.push(pattern.source);
      }
    }

    return {
      hasSensitive: matches.length > 0,
      matches,
    };
  }

  /**
   * 去除 HTML 标签
   * @private
   */
  _stripHTML(html) {
    return html.replace(/<[^>]*>/g, "").trim();
  }

  /**
   * 记录历史
   * @private
   */
  _recordHistory(entry) {
    if (!this.config.enableHistory) {
      return;
    }

    this.history.push(entry);

    if (this.history.length > this.config.maxHistorySize) {
      this.history = this.history.slice(-this.config.maxHistorySize / 2);
    }
  }

  /**
   * 更新统计
   * @private
   */
  _updateStats(type, action) {
    if (action === "copy") {
      this.stats.totalCopies++;
    } else {
      this.stats.totalPastes++;
    }

    if (!this.stats.byType[type]) {
      this.stats.byType[type] = { copies: 0, pastes: 0 };
    }

    if (action === "copy") {
      this.stats.byType[type].copies++;
    } else {
      this.stats.byType[type].pastes++;
    }
  }

  /**
   * 启动同步
   * @private
   */
  _startSync() {
    let lastContent = "";

    this.syncTimer = setInterval(() => {
      const current = this.clipboard.readText();
      if (current !== lastContent) {
        lastContent = current;
        this.emit("externalChange", {
          type: ClipboardType.TEXT,
          content: current,
        });
      }
    }, this.config.syncInterval);
  }

  /**
   * 停止同步
   */
  stopSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * 获取统计
   * @returns {Object}
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalCopies: 0,
      totalPastes: 0,
      sensitiveBlocked: 0,
      byType: {},
    };
    this.emit("statsReset");
  }

  /**
   * 清理
   */
  cleanup() {
    this.stopSync();
  }
}

// 单例
let clipboardInstance = null;

function getClipboardManager(browserEngine, config) {
  if (!clipboardInstance) {
    clipboardInstance = new ClipboardManager(browserEngine, config);
  } else if (browserEngine) {
    clipboardInstance.setBrowserEngine(browserEngine);
  }
  return clipboardInstance;
}

module.exports = {
  ClipboardManager,
  ClipboardType,
  getClipboardManager,
};
