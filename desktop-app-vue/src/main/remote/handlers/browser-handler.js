/**
 * 浏览器远程控制处理器
 *
 * 处理来自 Android 端的浏览器自动化命令：
 * - browser.start: 启动浏览器
 * - browser.stop: 关闭浏览器
 * - browser.openUrl: 打开指定 URL（简化接口）
 * - browser.navigate: 导航到 URL
 * - browser.screenshot: 截图
 * - browser.act: 执行操作（点击、输入等）
 * - browser.getStatus: 获取浏览器状态
 * - browser.listTabs: 列出所有标签页
 * - browser.closeTab: 关闭标签页
 * - browser.focusTab: 聚焦标签页
 *
 * @module remote/handlers/browser-handler
 */

const { logger } = require("../../utils/logger");

// Lazy load BrowserEngine to allow dependency injection in tests
let BrowserEngineClass = null;
const getBrowserEngineClass = () => {
  if (!BrowserEngineClass) {
    try {
      BrowserEngineClass =
        require("../../browser/browser-engine").BrowserEngine;
    } catch (e) {
      // BrowserEngine not available (test environment)
      BrowserEngineClass = null;
    }
  }
  return BrowserEngineClass;
};

// 默认配置
const DEFAULT_CONFIG = {
  defaultProfile: "remote-control",
  headless: false,
  defaultTimeout: 30000,
  screenshotFormat: "png",
  screenshotQuality: 80,
};

/**
 * 浏览器远程控制处理器类
 */
class BrowserHandler {
  /**
   * @param {Object} options - Configuration options
   * @param {Object} [dependencies] - Optional dependency injection for testing
   * @param {Function} [dependencies.BrowserEngine] - BrowserEngine class to use
   */
  constructor(options = {}, dependencies = {}) {
    this.options = { ...DEFAULT_CONFIG, ...options };
    this.BrowserEngineClass =
      dependencies.BrowserEngine || getBrowserEngineClass();
    this.engine = null;
    this.initialized = false;

    logger.info("[BrowserHandler] 浏览器远程控制处理器已创建", {
      defaultProfile: this.options.defaultProfile,
      headless: this.options.headless,
    });
  }

  /**
   * 获取或初始化 BrowserEngine
   */
  async getEngine() {
    if (!this.engine) {
      if (!this.BrowserEngineClass) {
        throw new Error("BrowserEngine not available");
      }
      this.engine = new this.BrowserEngineClass({
        headless: this.options.headless,
        profileDir: this.options.profileDir,
        ...this.options.engineOptions,
      });
    }
    return this.engine;
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[BrowserHandler] 处理命令: ${action}`);

    switch (action) {
      case "start":
        return await this.start(params, context);

      case "stop":
        return await this.stop(params, context);

      case "openUrl":
        return await this.openUrl(params, context);

      case "navigate":
        return await this.navigate(params, context);

      case "screenshot":
        return await this.screenshot(params, context);

      case "act":
        return await this.act(params, context);

      case "getStatus":
        return await this.getStatus(params, context);

      case "listTabs":
        return await this.listTabs(params, context);

      case "closeTab":
        return await this.closeTab(params, context);

      case "focusTab":
        return await this.focusTab(params, context);

      case "takeSnapshot":
        return await this.takeSnapshot(params, context);

      case "findElement":
        return await this.findElement(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 启动浏览器
   */
  async start(params = {}, context) {
    logger.info(`[BrowserHandler] 启动浏览器 from ${context?.did || "local"}`);

    const engine = await this.getEngine();

    if (engine.isRunning) {
      return {
        success: true,
        message: "Browser is already running",
        status: engine.getStatus(),
      };
    }

    const result = await engine.start({
      headless: params.headless ?? this.options.headless,
      channel: params.channel,
      args: params.args,
    });

    this.initialized = true;

    return {
      success: true,
      message: "Browser started successfully",
      ...result,
    };
  }

  /**
   * 关闭浏览器
   */
  async stop(params = {}, context) {
    logger.info(`[BrowserHandler] 关闭浏览器 from ${context?.did || "local"}`);

    if (!this.engine || !this.engine.isRunning) {
      return {
        success: true,
        message: "Browser is not running",
      };
    }

    const result = await this.engine.stop();
    this.initialized = false;

    return {
      success: true,
      message: "Browser stopped successfully",
      ...result,
    };
  }

  /**
   * 打开 URL（简化接口）
   *
   * 自动启动浏览器、创建上下文、打开标签页并导航到指定 URL
   *
   * @param {Object} params - 参数
   * @param {string} params.url - 目标 URL
   * @param {string} params.profile - Profile 名称（可选）
   * @param {boolean} params.headless - 是否无头模式（可选）
   */
  async openUrl(params, context) {
    const { url, profile, headless } = params;

    if (!url) {
      throw new Error('Parameter "url" is required');
    }

    // 验证 URL 格式
    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL format: ${url}`);
    }

    logger.info(
      `[BrowserHandler] 打开 URL: ${url} from ${context?.did || "local"}`,
    );

    const engine = await this.getEngine();
    const profileName = profile || this.options.defaultProfile;

    // 1. 确保浏览器已启动
    if (!engine.isRunning) {
      await engine.start({
        headless: headless ?? this.options.headless,
      });
      this.initialized = true;
    }

    // 2. 确保上下文存在
    await engine.createContext(profileName);

    // 3. 打开标签页并导航
    const result = await engine.openTab(profileName, url, {
      timeout: this.options.defaultTimeout,
    });

    logger.info(`[BrowserHandler] URL 已打开: ${url} -> ${result.targetId}`);

    return {
      success: true,
      url: result.url,
      title: result.title,
      targetId: result.targetId,
      profileName,
    };
  }

  /**
   * 导航到 URL
   *
   * @param {Object} params - 参数
   * @param {string} params.targetId - 标签页 ID
   * @param {string} params.url - 目标 URL
   */
  async navigate(params, context) {
    const { targetId, url, waitUntil, timeout } = params;

    if (!targetId) {
      throw new Error('Parameter "targetId" is required');
    }

    if (!url) {
      throw new Error('Parameter "url" is required');
    }

    logger.info(
      `[BrowserHandler] 导航: ${targetId} -> ${url} from ${context?.did || "local"}`,
    );

    const engine = await this.getEngine();

    if (!engine.isRunning) {
      throw new Error("Browser is not running. Call start or openUrl first.");
    }

    const result = await engine.navigate(targetId, url, {
      waitUntil: waitUntil || "domcontentloaded",
      timeout: timeout || this.options.defaultTimeout,
    });

    return {
      success: true,
      ...result,
    };
  }

  /**
   * 截图
   *
   * @param {Object} params - 参数
   * @param {string} params.targetId - 标签页 ID
   * @param {boolean} params.fullPage - 是否全页截图
   * @param {string} params.format - 格式（png/jpeg）
   */
  async screenshot(params, context) {
    const { targetId, fullPage, format, quality, clip } = params;

    if (!targetId) {
      throw new Error('Parameter "targetId" is required');
    }

    logger.info(
      `[BrowserHandler] 截图: ${targetId} from ${context?.did || "local"}`,
    );

    const engine = await this.getEngine();

    if (!engine.isRunning) {
      throw new Error("Browser is not running");
    }

    const buffer = await engine.screenshot(targetId, {
      fullPage: fullPage ?? false,
      type: format || this.options.screenshotFormat,
      quality:
        format === "jpeg"
          ? quality || this.options.screenshotQuality
          : undefined,
      clip,
    });

    // 返回 base64 编码的图片
    return {
      success: true,
      targetId,
      format: format || this.options.screenshotFormat,
      size: buffer.length,
      data: buffer.toString("base64"),
    };
  }

  /**
   * 执行操作（点击、输入等）
   *
   * @param {Object} params - 参数
   * @param {string} params.targetId - 标签页 ID
   * @param {string} params.action - 操作类型（click/type/select/drag/hover）
   * @param {string} params.ref - 元素引用
   * @param {Object} params.options - 操作选项
   */
  async act(params, context) {
    const { targetId, action, ref, options = {} } = params;

    if (!targetId) {
      throw new Error('Parameter "targetId" is required');
    }

    if (!action) {
      throw new Error('Parameter "action" is required');
    }

    if (!ref) {
      throw new Error('Parameter "ref" is required');
    }

    logger.info(
      `[BrowserHandler] 执行操作: ${action} on ${ref} in ${targetId} from ${context?.did || "local"}`,
    );

    const engine = await this.getEngine();

    if (!engine.isRunning) {
      throw new Error("Browser is not running");
    }

    const result = await engine.act(targetId, action, ref, options);

    return {
      success: true,
      ...result,
    };
  }

  /**
   * 获取浏览器状态
   */
  async getStatus(params, context) {
    logger.debug(`[BrowserHandler] 获取状态 from ${context?.did || "local"}`);

    if (!this.engine) {
      return {
        success: true,
        isRunning: false,
        message: "Browser engine not initialized",
      };
    }

    const status = this.engine.getStatus();

    return {
      success: true,
      ...status,
    };
  }

  /**
   * 列出所有标签页
   */
  async listTabs(params = {}, context) {
    logger.debug(`[BrowserHandler] 列出标签页 from ${context?.did || "local"}`);

    const engine = await this.getEngine();

    if (!engine.isRunning) {
      return {
        success: true,
        tabs: [],
        message: "Browser is not running",
      };
    }

    const tabs = await engine.listTabs(params.profileName);

    return {
      success: true,
      tabs,
      total: tabs.length,
    };
  }

  /**
   * 关闭标签页
   */
  async closeTab(params, context) {
    const { targetId } = params;

    if (!targetId) {
      throw new Error('Parameter "targetId" is required');
    }

    logger.info(
      `[BrowserHandler] 关闭标签页: ${targetId} from ${context?.did || "local"}`,
    );

    const engine = await this.getEngine();

    if (!engine.isRunning) {
      throw new Error("Browser is not running");
    }

    const result = await engine.closeTab(targetId);

    return {
      success: true,
      ...result,
    };
  }

  /**
   * 聚焦标签页
   */
  async focusTab(params, context) {
    const { targetId } = params;

    if (!targetId) {
      throw new Error('Parameter "targetId" is required');
    }

    logger.info(
      `[BrowserHandler] 聚焦标签页: ${targetId} from ${context?.did || "local"}`,
    );

    const engine = await this.getEngine();

    if (!engine.isRunning) {
      throw new Error("Browser is not running");
    }

    const result = await engine.focusTab(targetId);

    return {
      success: true,
      ...result,
    };
  }

  /**
   * 获取页面快照
   */
  async takeSnapshot(params, context) {
    const { targetId, interactive, visible, roleRefs } = params;

    if (!targetId) {
      throw new Error('Parameter "targetId" is required');
    }

    logger.info(
      `[BrowserHandler] 获取快照: ${targetId} from ${context?.did || "local"}`,
    );

    const engine = await this.getEngine();

    if (!engine.isRunning) {
      throw new Error("Browser is not running");
    }

    const snapshot = await engine.takeSnapshot(targetId, {
      interactive: interactive ?? true,
      visible: visible ?? true,
      roleRefs: roleRefs ?? true,
    });

    return {
      success: true,
      targetId,
      ...snapshot,
    };
  }

  /**
   * 查找元素
   */
  async findElement(params, context) {
    const { targetId, ref } = params;

    if (!targetId) {
      throw new Error('Parameter "targetId" is required');
    }

    if (!ref) {
      throw new Error('Parameter "ref" is required');
    }

    logger.debug(
      `[BrowserHandler] 查找元素: ${ref} in ${targetId} from ${context?.did || "local"}`,
    );

    const engine = await this.getEngine();

    if (!engine.isRunning) {
      throw new Error("Browser is not running");
    }

    const element = engine.findElement(targetId, ref);

    if (!element) {
      return {
        success: false,
        message: `Element ${ref} not found`,
      };
    }

    return {
      success: true,
      element,
    };
  }

  /**
   * 清理资源
   */
  async cleanup() {
    if (this.engine) {
      await this.engine.cleanup();
      this.engine = null;
      this.initialized = false;
    }

    logger.info("[BrowserHandler] 资源已清理");
  }
}

module.exports = { BrowserHandler };
