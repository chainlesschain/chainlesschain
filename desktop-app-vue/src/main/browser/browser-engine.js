/**
 * BrowserEngine - 浏览器自动化引擎
 * 基于 Playwright 实现，模仿 OpenClaw 的设计理念
 *
 * @module browser/browser-engine
 * @author ChainlessChain Team
 * @since v0.27.0
 */

const { chromium } = require('playwright-core');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs').promises;

/**
 * 浏览器引擎类
 * 提供浏览器启动、上下文管理、标签页控制等核心功能
 */
class BrowserEngine extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      headless: config.headless || false,
      cdpPort: config.cdpPort || 18800,
      profileDir: config.profileDir,
      defaultViewport: config.defaultViewport || { width: 1280, height: 720 },
      ...config
    };

    this.browser = null;
    this.contexts = new Map(); // profileName => BrowserContext
    this.pages = new Map(); // targetId => Page
    this.nextTargetId = 1;

    // 状态跟踪
    this.isRunning = false;
    this.startTime = null;
  }

  /**
   * 启动浏览器实例
   * @param {Object} options - 启动选项
   * @returns {Promise<Object>} 启动结果
   */
  async start(options = {}) {
    if (this.isRunning) {
      throw new Error('Browser is already running');
    }

    try {
      const launchOptions = {
        headless: options.headless ?? this.config.headless,
        args: [
          `--remote-debugging-port=${this.config.cdpPort}`,
          '--disable-blink-features=AutomationControlled', // 反检测
          '--disable-features=IsolateOrigins,site-per-process',
          '--no-sandbox', // Windows 需要
          ...(options.args || [])
        ],
        // 使用系统安装的 Chrome/Edge
        channel: options.channel || 'chrome'
      };

      this.browser = await chromium.launch(launchOptions);
      this.isRunning = true;
      this.startTime = Date.now();

      this.emit('browser:started', {
        cdpPort: this.config.cdpPort,
        timestamp: this.startTime
      });

      console.log(`[BrowserEngine] Browser started on CDP port ${this.config.cdpPort}`);

      return {
        success: true,
        cdpPort: this.config.cdpPort,
        pid: this.browser.process()?.pid
      };
    } catch (error) {
      this.isRunning = false;
      this.emit('browser:error', { error: error.message });
      throw new Error(`Failed to start browser: ${error.message}`);
    }
  }

  /**
   * 停止浏览器实例
   * @returns {Promise<Object>} 停止结果
   */
  async stop() {
    if (!this.isRunning) {
      throw new Error('Browser is not running');
    }

    try {
      // 关闭所有页面
      for (const page of this.pages.values()) {
        await page.close().catch(() => {});
      }
      this.pages.clear();

      // 关闭所有上下文
      for (const context of this.contexts.values()) {
        await context.close().catch(() => {});
      }
      this.contexts.clear();

      // 关闭浏览器
      await this.browser.close();
      this.browser = null;
      this.isRunning = false;

      const uptime = Date.now() - this.startTime;
      this.emit('browser:stopped', { uptime });

      console.log(`[BrowserEngine] Browser stopped after ${uptime}ms`);

      return { success: true, uptime };
    } catch (error) {
      this.emit('browser:error', { error: error.message });
      throw new Error(`Failed to stop browser: ${error.message}`);
    }
  }

  /**
   * 创建浏览器上下文（Profile）
   * @param {string} profileName - Profile 名称
   * @param {Object} options - 上下文选项
   * @returns {Promise<Object>} 创建结果
   */
  async createContext(profileName, options = {}) {
    if (!this.isRunning) {
      throw new Error('Browser is not running. Call start() first.');
    }

    if (this.contexts.has(profileName)) {
      return {
        success: true,
        profileName,
        exists: true
      };
    }

    try {
      const contextOptions = {
        viewport: options.viewport || this.config.defaultViewport,
        userAgent: options.userAgent,
        geolocation: options.geolocation,
        permissions: options.permissions,
        storageState: options.storageState, // 恢复 Cookie/LocalStorage
        ignoreHTTPSErrors: options.ignoreHTTPSErrors ?? true,
        ...options
      };

      const context = await this.browser.newContext(contextOptions);

      // 注入反检测脚本
      await context.addInitScript(() => {
        // 隐藏 webdriver 标识
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
        });

        // 伪装 Chrome 对象
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };

        // 伪装 Permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      });

      this.contexts.set(profileName, context);

      this.emit('context:created', { profileName });

      console.log(`[BrowserEngine] Context created: ${profileName}`);

      return {
        success: true,
        profileName,
        exists: false
      };
    } catch (error) {
      this.emit('context:error', { profileName, error: error.message });
      throw new Error(`Failed to create context: ${error.message}`);
    }
  }

  /**
   * 获取上下文
   * @param {string} profileName - Profile 名称
   * @returns {BrowserContext} 浏览器上下文
   */
  getContext(profileName) {
    const context = this.contexts.get(profileName);
    if (!context) {
      throw new Error(`Context '${profileName}' not found`);
    }
    return context;
  }

  /**
   * 打开新标签页
   * @param {string} profileName - Profile 名称
   * @param {string} url - 目标 URL
   * @param {Object} options - 打开选项
   * @returns {Promise<Object>} 标签页信息
   */
  async openTab(profileName, url, options = {}) {
    const context = this.getContext(profileName);

    try {
      const page = await context.newPage();
      const targetId = `tab-${this.nextTargetId++}`;

      // 保存页面映射
      this.pages.set(targetId, page);

      // 设置页面事件监听
      page.on('close', () => {
        this.pages.delete(targetId);
        this.emit('tab:closed', { targetId });
      });

      page.on('crash', () => {
        this.emit('tab:crashed', { targetId });
      });

      page.on('console', (msg) => {
        this.emit('tab:console', {
          targetId,
          type: msg.type(),
          text: msg.text()
        });
      });

      // 导航到 URL
      if (url) {
        await page.goto(url, {
          waitUntil: options.waitUntil || 'domcontentloaded',
          timeout: options.timeout || 30000
        });
      }

      this.emit('tab:opened', { targetId, url, profileName });

      console.log(`[BrowserEngine] Tab opened: ${targetId} -> ${url}`);

      return {
        success: true,
        targetId,
        url: page.url(),
        title: await page.title()
      };
    } catch (error) {
      this.emit('tab:error', { error: error.message });
      throw new Error(`Failed to open tab: ${error.message}`);
    }
  }

  /**
   * 关闭标签页
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>} 关闭结果
   */
  async closeTab(targetId) {
    const page = this.getPage(targetId);

    try {
      await page.close();
      this.pages.delete(targetId);

      console.log(`[BrowserEngine] Tab closed: ${targetId}`);

      return { success: true, targetId };
    } catch (error) {
      throw new Error(`Failed to close tab: ${error.message}`);
    }
  }

  /**
   * 聚焦标签页
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>} 聚焦结果
   */
  async focusTab(targetId) {
    const page = this.getPage(targetId);

    try {
      await page.bringToFront();

      this.emit('tab:focused', { targetId });

      console.log(`[BrowserEngine] Tab focused: ${targetId}`);

      return { success: true, targetId };
    } catch (error) {
      throw new Error(`Failed to focus tab: ${error.message}`);
    }
  }

  /**
   * 列出所有标签页
   * @param {string} profileName - Profile 名称（可选）
   * @returns {Promise<Array>} 标签页列表
   */
  async listTabs(profileName = null) {
    const tabs = [];

    for (const [targetId, page] of this.pages.entries()) {
      // 获取页面所属的 context
      const pageContext = page.context();

      // 如果指定了 profileName，则过滤
      let contextName = null;
      for (const [name, ctx] of this.contexts.entries()) {
        if (ctx === pageContext) {
          contextName = name;
          break;
        }
      }

      if (profileName && contextName !== profileName) {
        continue;
      }

      tabs.push({
        targetId,
        url: page.url(),
        title: await page.title(),
        profileName: contextName
      });
    }

    return tabs;
  }

  /**
   * 导航到指定 URL
   * @param {string} targetId - 标签页 ID
   * @param {string} url - 目标 URL
   * @param {Object} options - 导航选项
   * @returns {Promise<Object>} 导航结果
   */
  async navigate(targetId, url, options = {}) {
    const page = this.getPage(targetId);

    try {
      await page.goto(url, {
        waitUntil: options.waitUntil || 'domcontentloaded',
        timeout: options.timeout || 30000
      });

      this.emit('tab:navigated', { targetId, url });

      console.log(`[BrowserEngine] Navigated: ${targetId} -> ${url}`);

      return {
        success: true,
        url: page.url(),
        title: await page.title()
      };
    } catch (error) {
      throw new Error(`Failed to navigate: ${error.message}`);
    }
  }

  /**
   * 截图
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 截图选项
   * @returns {Promise<Buffer>} 截图数据
   */
  async screenshot(targetId, options = {}) {
    const page = this.getPage(targetId);

    try {
      const screenshotOptions = {
        type: options.type || 'png',
        fullPage: options.fullPage ?? false,
        quality: options.quality,
        clip: options.clip
      };

      const buffer = await page.screenshot(screenshotOptions);

      this.emit('tab:screenshot', {
        targetId,
        size: buffer.length
      });

      console.log(`[BrowserEngine] Screenshot taken: ${targetId} (${buffer.length} bytes)`);

      return buffer;
    } catch (error) {
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }

  /**
   * 获取浏览器状态
   * @returns {Object} 状态信息
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      cdpPort: this.config.cdpPort,
      contextsCount: this.contexts.size,
      tabsCount: this.pages.size,
      pid: this.browser?.process()?.pid
    };
  }

  /**
   * 获取页面对象
   * @param {string} targetId - 标签页 ID
   * @returns {Page} Playwright Page 对象
   * @private
   */
  getPage(targetId) {
    const page = this.pages.get(targetId);
    if (!page) {
      throw new Error(`Tab '${targetId}' not found`);
    }
    return page;
  }

  /**
   * 保存会话状态
   * @param {string} profileName - Profile 名称
   * @param {string} stateFile - 状态文件路径
   * @returns {Promise<Object>} 保存结果
   */
  async saveSession(profileName, stateFile = null) {
    const context = this.getContext(profileName);

    try {
      const state = await context.storageState();

      // 如果未指定文件路径，使用默认路径
      if (!stateFile) {
        stateFile = path.join(
          this.config.profileDir,
          `${profileName}.json`
        );
      }

      // 确保目录存在
      await fs.mkdir(path.dirname(stateFile), { recursive: true });

      // 保存状态
      await fs.writeFile(stateFile, JSON.stringify(state, null, 2));

      console.log(`[BrowserEngine] Session saved: ${profileName} -> ${stateFile}`);

      return {
        success: true,
        stateFile,
        cookiesCount: state.cookies.length,
        originsCount: state.origins.length
      };
    } catch (error) {
      throw new Error(`Failed to save session: ${error.message}`);
    }
  }

  /**
   * 恢复会话状态
   * @param {string} profileName - Profile 名称
   * @param {string} stateFile - 状态文件路径
   * @returns {Promise<Object>} 恢复结果
   */
  async restoreSession(profileName, stateFile = null) {
    // 如果未指定文件路径，使用默认路径
    if (!stateFile) {
      stateFile = path.join(
        this.config.profileDir,
        `${profileName}.json`
      );
    }

    try {
      // 读取状态文件
      const stateData = await fs.readFile(stateFile, 'utf-8');
      const state = JSON.parse(stateData);

      // 创建带有恢复状态的上下文
      await this.createContext(profileName, { storageState: state });

      console.log(`[BrowserEngine] Session restored: ${profileName} <- ${stateFile}`);

      return {
        success: true,
        profileName,
        cookiesCount: state.cookies.length,
        originsCount: state.origins.length
      };
    } catch (error) {
      throw new Error(`Failed to restore session: ${error.message}`);
    }
  }

  /**
   * 清理资源
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.isRunning) {
      await this.stop();
    }
  }
}

module.exports = { BrowserEngine };
