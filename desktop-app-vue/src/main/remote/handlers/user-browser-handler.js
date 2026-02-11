/**
 * 用户浏览器控制处理器
 *
 * 通过 Chrome DevTools Protocol (CDP) 连接和控制用户已安装的真实浏览器
 * 支持 Chrome、Edge、Brave 等基于 Chromium 的浏览器
 *
 * 功能：
 * - userBrowser.connect: 连接到用户浏览器
 * - userBrowser.disconnect: 断开连接
 * - userBrowser.getStatus: 获取连接状态
 * - userBrowser.listTabs: 列出所有标签页
 * - userBrowser.getActiveTab: 获取当前活动标签页
 * - userBrowser.createTab: 创建新标签页
 * - userBrowser.closeTab: 关闭标签页
 * - userBrowser.focusTab: 聚焦标签页
 * - userBrowser.navigate: 导航到 URL
 * - userBrowser.goBack: 后退
 * - userBrowser.goForward: 前进
 * - userBrowser.refresh: 刷新页面
 * - userBrowser.executeScript: 执行 JavaScript
 * - userBrowser.getPageContent: 获取页面内容
 * - userBrowser.screenshot: 截图
 * - userBrowser.getBookmarks: 获取书签
 * - userBrowser.getHistory: 获取历史记录
 * - userBrowser.findBrowsers: 查找可用浏览器
 *
 * @module remote/handlers/user-browser-handler
 */

const { logger } = require("../../utils/logger");
const { EventEmitter } = require("events");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const WebSocket = require("ws");

/**
 * 支持的浏览器配置
 */
const BROWSER_CONFIGS = {
  chrome: {
    name: "Google Chrome",
    executablePaths: {
      win32: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      ],
      darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      ],
      linux: [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/opt/google/chrome/chrome",
      ],
    },
    defaultDebugPort: 9222,
    userDataDir: {
      win32: `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data`,
      darwin: `${os.homedir()}/Library/Application Support/Google/Chrome`,
      linux: `${os.homedir()}/.config/google-chrome`,
    },
  },
  edge: {
    name: "Microsoft Edge",
    executablePaths: {
      win32: [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      ],
      darwin: [
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      ],
      linux: ["/usr/bin/microsoft-edge", "/opt/microsoft/msedge/msedge"],
    },
    defaultDebugPort: 9223,
    userDataDir: {
      win32: `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\User Data`,
      darwin: `${os.homedir()}/Library/Application Support/Microsoft Edge`,
      linux: `${os.homedir()}/.config/microsoft-edge`,
    },
  },
  brave: {
    name: "Brave Browser",
    executablePaths: {
      win32: [
        `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      ],
      darwin: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
      linux: ["/usr/bin/brave-browser", "/opt/brave.com/brave/brave-browser"],
    },
    defaultDebugPort: 9224,
    userDataDir: {
      win32: `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\User Data`,
      darwin: `${os.homedir()}/Library/Application Support/BraveSoftware/Brave-Browser`,
      linux: `${os.homedir()}/.config/BraveSoftware/Brave-Browser`,
    },
  },
};

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  defaultBrowser: "chrome",
  debugPort: 9222,
  connectionTimeout: 10000,
  commandTimeout: 30000,
  maxTabs: 100,
  autoLaunch: true,
  enableBookmarks: true,
  enableHistory: true,
  historyLimit: 100,
};

/**
 * 用户浏览器控制处理器类
 */
class UserBrowserHandler extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = { ...DEFAULT_CONFIG, ...options };

    // 连接状态
    this.connected = false;
    this.browserType = null;
    this.browserProcess = null;
    this.debugPort = null;
    this.wsEndpoint = null;

    // CDP 连接
    this.cdpConnection = null;
    this.cdpSessions = new Map(); // targetId -> CDPSession

    // 标签页缓存
    this.tabs = new Map(); // targetId -> tabInfo

    // 统计信息
    this.stats = {
      connectTime: null,
      commandCount: 0,
      lastCommand: null,
    };

    logger.info("[UserBrowserHandler] 用户浏览器控制处理器已创建");
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[UserBrowserHandler] 处理命令: ${action}`, { params });
    this.stats.commandCount++;
    this.stats.lastCommand = { action, timestamp: Date.now() };

    try {
      switch (action) {
        // 连接管理
        case "connect":
          return await this.connect(params, context);
        case "disconnect":
          return await this.disconnect(params, context);
        case "getStatus":
          return await this.getStatus(params, context);
        case "findBrowsers":
          return await this.findBrowsers(params, context);

        // 标签页管理
        case "listTabs":
          return await this.listTabs(params, context);
        case "getActiveTab":
          return await this.getActiveTab(params, context);
        case "createTab":
          return await this.createTab(params, context);
        case "closeTab":
          return await this.closeTab(params, context);
        case "focusTab":
          return await this.focusTab(params, context);

        // 导航
        case "navigate":
          return await this.navigate(params, context);
        case "goBack":
          return await this.goBack(params, context);
        case "goForward":
          return await this.goForward(params, context);
        case "refresh":
          return await this.refresh(params, context);

        // 页面操作
        case "executeScript":
          return await this.executeScript(params, context);
        case "getPageContent":
          return await this.getPageContent(params, context);
        case "screenshot":
          return await this.screenshot(params, context);

        // 用户数据
        case "getBookmarks":
          return await this.getBookmarks(params, context);
        case "getHistory":
          return await this.getHistory(params, context);

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      logger.error(`[UserBrowserHandler] 命令执行失败: ${action}`, error);
      throw error;
    }
  }

  // ==================== 连接管理 ====================

  /**
   * 查找可用浏览器
   */
  async findBrowsers() {
    logger.info("[UserBrowserHandler] 查找可用浏览器...");
    const browsers = [];
    const platform = process.platform;

    for (const [type, config] of Object.entries(BROWSER_CONFIGS)) {
      const paths = config.executablePaths[platform] || [];

      for (const execPath of paths) {
        try {
          if (fs.existsSync(execPath)) {
            browsers.push({
              type,
              name: config.name,
              executablePath: execPath,
              defaultPort: config.defaultDebugPort,
              userDataDir: config.userDataDir[platform],
            });
            break; // 找到一个即可
          }
        } catch {
          // 忽略访问错误
        }
      }
    }

    logger.info(`[UserBrowserHandler] 找到 ${browsers.length} 个可用浏览器`);
    return { browsers };
  }

  /**
   * 连接到用户浏览器
   */
  async connect(params = {}) {
    const {
      browserType = this.options.defaultBrowser,
      port = null,
      autoLaunch = this.options.autoLaunch,
    } = params;

    logger.info(`[UserBrowserHandler] 连接到 ${browserType} 浏览器...`);

    if (this.connected) {
      logger.info("[UserBrowserHandler] 已连接，先断开现有连接");
      await this.disconnect();
    }

    const config = BROWSER_CONFIGS[browserType];
    if (!config) {
      throw new Error(`不支持的浏览器类型: ${browserType}`);
    }

    this.debugPort = port || config.defaultDebugPort;
    this.browserType = browserType;

    // 尝试连接到已运行的浏览器
    let connected = await this.tryConnect();

    // 如果未连接且允许自动启动，则启动浏览器
    if (!connected && autoLaunch) {
      logger.info("[UserBrowserHandler] 未检测到调试模式的浏览器，尝试启动...");
      await this.launchBrowser(browserType);
      // 等待浏览器启动
      await this.sleep(2000);
      connected = await this.tryConnect();
    }

    if (!connected) {
      throw new Error(
        `无法连接到 ${config.name}。请确保浏览器已以远程调试模式启动：\n` +
          `chrome.exe --remote-debugging-port=${this.debugPort}`,
      );
    }

    this.connected = true;
    this.stats.connectTime = Date.now();

    // 刷新标签页列表
    await this.refreshTabs();

    logger.info(`[UserBrowserHandler] ✅ 已连接到 ${config.name}`);

    return {
      success: true,
      browserType,
      browserName: config.name,
      port: this.debugPort,
      tabCount: this.tabs.size,
    };
  }

  /**
   * 尝试连接到浏览器的 CDP 端点
   */
  async tryConnect() {
    try {
      // 获取浏览器版本信息
      const versionInfo = await this.httpGet(
        `http://127.0.0.1:${this.debugPort}/json/version`,
      );
      const version = JSON.parse(versionInfo);

      this.wsEndpoint = version.webSocketDebuggerUrl;

      logger.info(
        `[UserBrowserHandler] 浏览器版本: ${version.Browser || "Unknown"}`,
      );

      // 建立 WebSocket 连接
      await this.connectWebSocket();

      return true;
    } catch (error) {
      logger.debug(`[UserBrowserHandler] 连接失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 建立 WebSocket 连接
   */
  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsEndpoint);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket 连接超时"));
      }, this.options.connectionTimeout);

      ws.on("open", () => {
        clearTimeout(timeout);
        this.cdpConnection = ws;
        this.setupWebSocketHandlers();
        resolve();
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * 设置 WebSocket 事件处理
   */
  setupWebSocketHandlers() {
    if (!this.cdpConnection) {
      return;
    }

    this.cdpConnection.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleCDPMessage(message);
      } catch (error) {
        logger.error("[UserBrowserHandler] 解析 CDP 消息失败:", error);
      }
    });

    this.cdpConnection.on("close", () => {
      logger.info("[UserBrowserHandler] WebSocket 连接已关闭");
      this.connected = false;
      this.emit("disconnected");
    });

    this.cdpConnection.on("error", (error) => {
      logger.error("[UserBrowserHandler] WebSocket 错误:", error);
    });
  }

  /**
   * 处理 CDP 消息
   */
  handleCDPMessage(message) {
    // 处理事件
    if (message.method) {
      this.emit("cdp:event", message);

      // 标签页事件
      if (message.method === "Target.targetCreated") {
        this.handleTargetCreated(message.params);
      } else if (message.method === "Target.targetDestroyed") {
        this.handleTargetDestroyed(message.params);
      } else if (message.method === "Target.targetInfoChanged") {
        this.handleTargetInfoChanged(message.params);
      }
    }
  }

  /**
   * 启动浏览器（以调试模式）
   */
  async launchBrowser(browserType) {
    const config = BROWSER_CONFIGS[browserType];
    const platform = process.platform;
    const paths = config.executablePaths[platform] || [];

    let execPath = null;
    for (const p of paths) {
      if (fs.existsSync(p)) {
        execPath = p;
        break;
      }
    }

    if (!execPath) {
      throw new Error(`未找到 ${config.name} 可执行文件`);
    }

    const args = [
      `--remote-debugging-port=${this.debugPort}`,
      "--remote-allow-origins=*",
    ];

    logger.info(`[UserBrowserHandler] 启动浏览器: ${execPath}`);

    return new Promise((resolve, reject) => {
      try {
        this.browserProcess = spawn(execPath, args, {
          detached: true,
          stdio: "ignore",
        });

        this.browserProcess.unref();

        // 等待一小段时间确保启动
        setTimeout(resolve, 1000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  async disconnect() {
    logger.info("[UserBrowserHandler] 断开浏览器连接...");

    if (this.cdpConnection) {
      this.cdpConnection.close();
      this.cdpConnection = null;
    }

    // 清理会话
    for (const session of this.cdpSessions.values()) {
      if (session.ws) {
        session.ws.close();
      }
    }
    this.cdpSessions.clear();
    this.tabs.clear();

    this.connected = false;
    this.wsEndpoint = null;

    logger.info("[UserBrowserHandler] ✅ 已断开连接");

    return { success: true };
  }

  /**
   * 获取连接状态
   */
  async getStatus() {
    return {
      connected: this.connected,
      browserType: this.browserType,
      browserName: this.browserType
        ? BROWSER_CONFIGS[this.browserType]?.name
        : null,
      port: this.debugPort,
      tabCount: this.tabs.size,
      uptime: this.stats.connectTime ? Date.now() - this.stats.connectTime : 0,
      stats: this.stats,
    };
  }

  // ==================== 标签页管理 ====================

  /**
   * 刷新标签页列表
   */
  async refreshTabs() {
    try {
      const response = await this.httpGet(
        `http://127.0.0.1:${this.debugPort}/json/list`,
      );
      const targets = JSON.parse(response);

      this.tabs.clear();

      for (const target of targets) {
        if (target.type === "page") {
          this.tabs.set(target.id, {
            id: target.id,
            title: target.title,
            url: target.url,
            favicon: target.faviconUrl,
            webSocketDebuggerUrl: target.webSocketDebuggerUrl,
          });
        }
      }

      return Array.from(this.tabs.values());
    } catch (error) {
      logger.error("[UserBrowserHandler] 刷新标签页列表失败:", error);
      throw error;
    }
  }

  /**
   * 列出所有标签页
   */
  async listTabs() {
    await this.ensureConnected();
    const tabs = await this.refreshTabs();
    return { tabs };
  }

  /**
   * 获取当前活动标签页
   */
  async getActiveTab() {
    await this.ensureConnected();
    await this.refreshTabs();

    // CDP 没有直接的"活动标签"概念，返回第一个
    const tabs = Array.from(this.tabs.values());
    const activeTab = tabs[0] || null;

    return { tab: activeTab };
  }

  /**
   * 创建新标签页
   */
  async createTab(params = {}) {
    await this.ensureConnected();

    const { url = "about:blank" } = params;

    try {
      const response = await this.httpGet(
        `http://127.0.0.1:${this.debugPort}/json/new?${encodeURIComponent(url)}`,
      );
      const target = JSON.parse(response);

      const tab = {
        id: target.id,
        title: target.title,
        url: target.url,
        webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      };

      this.tabs.set(target.id, tab);

      logger.info(`[UserBrowserHandler] 创建新标签页: ${url}`);

      return { tab };
    } catch (error) {
      logger.error("[UserBrowserHandler] 创建标签页失败:", error);
      throw error;
    }
  }

  /**
   * 关闭标签页
   */
  async closeTab(params = {}) {
    await this.ensureConnected();

    const { tabId } = params;
    if (!tabId) {
      throw new Error("tabId is required");
    }

    try {
      await this.httpGet(
        `http://127.0.0.1:${this.debugPort}/json/close/${tabId}`,
      );

      this.tabs.delete(tabId);
      this.cdpSessions.delete(tabId);

      logger.info(`[UserBrowserHandler] 关闭标签页: ${tabId}`);

      return { success: true, tabId };
    } catch (error) {
      logger.error("[UserBrowserHandler] 关闭标签页失败:", error);
      throw error;
    }
  }

  /**
   * 聚焦标签页
   */
  async focusTab(params = {}) {
    await this.ensureConnected();

    const { tabId } = params;
    if (!tabId) {
      throw new Error("tabId is required");
    }

    try {
      await this.httpGet(
        `http://127.0.0.1:${this.debugPort}/json/activate/${tabId}`,
      );

      logger.info(`[UserBrowserHandler] 聚焦标签页: ${tabId}`);

      return { success: true, tabId };
    } catch (error) {
      logger.error("[UserBrowserHandler] 聚焦标签页失败:", error);
      throw error;
    }
  }

  // ==================== 导航 ====================

  /**
   * 导航到 URL
   */
  async navigate(params = {}) {
    await this.ensureConnected();

    const { tabId, url } = params;
    if (!url) {
      throw new Error("url is required");
    }

    const targetId = tabId || this.getFirstTabId();
    if (!targetId) {
      throw new Error("No tab available");
    }

    const session = await this.getTabSession(targetId);
    const result = await session.send("Page.navigate", { url });

    logger.info(`[UserBrowserHandler] 导航到: ${url}`);

    return {
      success: true,
      tabId: targetId,
      url,
      frameId: result.frameId,
    };
  }

  /**
   * 后退
   */
  async goBack(params = {}) {
    await this.ensureConnected();

    const tabId = params.tabId || this.getFirstTabId();
    if (!tabId) {
      throw new Error("No tab available");
    }

    const session = await this.getTabSession(tabId);

    // 获取历史信息
    const history = await session.send("Page.getNavigationHistory");
    if (history.currentIndex > 0) {
      const entry = history.entries[history.currentIndex - 1];
      await session.send("Page.navigateToHistoryEntry", { entryId: entry.id });
    }

    return { success: true, tabId };
  }

  /**
   * 前进
   */
  async goForward(params = {}) {
    await this.ensureConnected();

    const tabId = params.tabId || this.getFirstTabId();
    if (!tabId) {
      throw new Error("No tab available");
    }

    const session = await this.getTabSession(tabId);

    const history = await session.send("Page.getNavigationHistory");
    if (history.currentIndex < history.entries.length - 1) {
      const entry = history.entries[history.currentIndex + 1];
      await session.send("Page.navigateToHistoryEntry", { entryId: entry.id });
    }

    return { success: true, tabId };
  }

  /**
   * 刷新页面
   */
  async refresh(params = {}) {
    await this.ensureConnected();

    const { tabId, ignoreCache = false } = params;
    const targetId = tabId || this.getFirstTabId();
    if (!targetId) {
      throw new Error("No tab available");
    }

    const session = await this.getTabSession(targetId);
    await session.send("Page.reload", { ignoreCache });

    logger.info(`[UserBrowserHandler] 刷新页面: ${targetId}`);

    return { success: true, tabId: targetId };
  }

  // ==================== 页面操作 ====================

  /**
   * 执行 JavaScript
   */
  async executeScript(params = {}) {
    await this.ensureConnected();

    const { tabId, script, awaitPromise = true } = params;
    if (!script) {
      throw new Error("script is required");
    }

    const targetId = tabId || this.getFirstTabId();
    if (!targetId) {
      throw new Error("No tab available");
    }

    const session = await this.getTabSession(targetId);
    const result = await session.send("Runtime.evaluate", {
      expression: script,
      awaitPromise,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          "Script execution failed",
      );
    }

    return {
      success: true,
      tabId: targetId,
      result: result.result?.value,
    };
  }

  /**
   * 获取页面内容
   */
  async getPageContent(params = {}) {
    await this.ensureConnected();

    const { tabId, selector = null } = params;
    const targetId = tabId || this.getFirstTabId();
    if (!targetId) {
      throw new Error("No tab available");
    }

    const session = await this.getTabSession(targetId);

    let script;
    if (selector) {
      script = `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          return el ? el.outerHTML : null;
        })()
      `;
    } else {
      script = "document.documentElement.outerHTML";
    }

    const result = await session.send("Runtime.evaluate", {
      expression: script,
      returnByValue: true,
    });

    return {
      success: true,
      tabId: targetId,
      content: result.result?.value,
    };
  }

  /**
   * 截图
   */
  async screenshot(params = {}) {
    await this.ensureConnected();

    const { tabId, format = "png", quality = 80, fullPage = false } = params;

    const targetId = tabId || this.getFirstTabId();
    if (!targetId) {
      throw new Error("No tab available");
    }

    const session = await this.getTabSession(targetId);

    let clip = null;
    if (fullPage) {
      // 获取页面完整尺寸
      const metrics = await session.send("Page.getLayoutMetrics");
      clip = {
        x: 0,
        y: 0,
        width: metrics.contentSize.width,
        height: metrics.contentSize.height,
        scale: 1,
      };
    }

    const result = await session.send("Page.captureScreenshot", {
      format,
      quality: format === "jpeg" ? quality : undefined,
      clip,
      captureBeyondViewport: fullPage,
    });

    logger.info(`[UserBrowserHandler] 截图完成: ${targetId}`);

    return {
      success: true,
      tabId: targetId,
      format,
      data: result.data, // Base64
    };
  }

  // ==================== 用户数据 ====================

  /**
   * 获取书签
   */
  async getBookmarks(params = {}) {
    if (!this.options.enableBookmarks) {
      throw new Error("Bookmarks access is disabled");
    }

    const { folder = null, limit = 100 } = params;

    // 读取书签文件
    const bookmarksPath = this.getBookmarksPath();
    if (!bookmarksPath || !fs.existsSync(bookmarksPath)) {
      return { bookmarks: [], message: "Bookmarks file not found" };
    }

    try {
      const content = fs.readFileSync(bookmarksPath, "utf-8");
      const data = JSON.parse(content);

      const bookmarks = [];
      this.extractBookmarks(data.roots, bookmarks, folder, limit);

      logger.info(`[UserBrowserHandler] 获取书签: ${bookmarks.length} 条`);

      return { bookmarks };
    } catch (error) {
      logger.error("[UserBrowserHandler] 读取书签失败:", error);
      throw error;
    }
  }

  /**
   * 提取书签
   */
  extractBookmarks(node, result, targetFolder, limit) {
    if (!node || result.length >= limit) {
      return;
    }

    if (node.type === "url") {
      result.push({
        name: node.name,
        url: node.url,
        dateAdded: node.date_added,
        folder: targetFolder,
      });
    } else if (node.type === "folder" || node.children) {
      const children = node.children || [];
      const folderName = node.name || "";

      // 如果指定了文件夹，只处理匹配的
      if (targetFolder && folderName !== targetFolder && node.name) {
        return;
      }

      for (const child of children) {
        this.extractBookmarks(child, result, folderName, limit);
      }
    }

    // 处理 roots 对象
    if (typeof node === "object" && !Array.isArray(node)) {
      for (const key of Object.keys(node)) {
        if (key !== "type" && key !== "name" && key !== "children") {
          this.extractBookmarks(node[key], result, targetFolder, limit);
        }
      }
    }
  }

  /**
   * 获取历史记录
   */
  async getHistory(params = {}) {
    if (!this.options.enableHistory) {
      throw new Error("History access is disabled");
    }

    const { limit = this.options.historyLimit, since = null } = params;

    // Chrome 历史记录存储在 SQLite 数据库中
    // 由于直接读取有锁定问题，我们通过 CDP 获取
    await this.ensureConnected();

    // 使用第一个标签页获取历史
    const tabId = this.getFirstTabId();
    if (!tabId) {
      return { history: [], message: "No tab available to query history" };
    }

    const session = await this.getTabSession(tabId);

    // 通过 JavaScript 获取历史（有限制）
    const script = `
      (async function() {
        if (typeof chrome !== 'undefined' && chrome.history) {
          return new Promise((resolve) => {
            chrome.history.search({
              text: '',
              maxResults: ${limit},
              startTime: ${since || 0}
            }, (results) => {
              resolve(results || []);
            });
          });
        }
        return null;
      })()
    `;

    try {
      const result = await session.send("Runtime.evaluate", {
        expression: script,
        awaitPromise: true,
        returnByValue: true,
      });

      if (result.result?.value) {
        return { history: result.result.value };
      }
    } catch {
      // chrome.history API 可能不可用
    }

    // 备选方案：读取历史数据库文件
    return await this.readHistoryFromFile(limit, since);
  }

  /**
   * 从文件读取历史记录
   */
  async readHistoryFromFile(_limit, _since) {
    const historyPath = this.getHistoryPath();
    if (!historyPath || !fs.existsSync(historyPath)) {
      return { history: [], message: "History file not found" };
    }

    // 注意：直接读取 SQLite 文件需要 better-sqlite3
    // 这里返回提示信息
    return {
      history: [],
      message:
        "Direct history reading requires browser extension. Please install ChainlessChain Browser Extension.",
      historyPath,
    };
  }

  // ==================== CDP 会话管理 ====================

  /**
   * 获取标签页的 CDP 会话
   */
  async getTabSession(tabId) {
    if (this.cdpSessions.has(tabId)) {
      return this.cdpSessions.get(tabId);
    }

    const tab = this.tabs.get(tabId);
    if (!tab || !tab.webSocketDebuggerUrl) {
      throw new Error(`Tab not found: ${tabId}`);
    }

    const session = new CDPSession(tab.webSocketDebuggerUrl);
    await session.connect();

    this.cdpSessions.set(tabId, session);

    return session;
  }

  // ==================== 辅助方法 ====================

  /**
   * 确保已连接
   */
  async ensureConnected() {
    if (!this.connected) {
      throw new Error("Not connected to browser. Call connect() first.");
    }
  }

  /**
   * 获取第一个标签页 ID
   */
  getFirstTabId() {
    const tabs = Array.from(this.tabs.keys());
    return tabs[0] || null;
  }

  /**
   * 获取书签文件路径
   */
  getBookmarksPath() {
    if (!this.browserType) {
      return null;
    }

    const config = BROWSER_CONFIGS[this.browserType];
    const platform = process.platform;
    const userDataDir = config.userDataDir[platform];

    if (!userDataDir) {
      return null;
    }

    return path.join(userDataDir, "Default", "Bookmarks");
  }

  /**
   * 获取历史文件路径
   */
  getHistoryPath() {
    if (!this.browserType) {
      return null;
    }

    const config = BROWSER_CONFIGS[this.browserType];
    const platform = process.platform;
    const userDataDir = config.userDataDir[platform];

    if (!userDataDir) {
      return null;
    }

    return path.join(userDataDir, "Default", "History");
  }

  /**
   * HTTP GET 请求
   */
  httpGet(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https") ? https : http;
      const timeout = setTimeout(() => {
        reject(new Error("HTTP request timeout"));
      }, this.options.connectionTimeout);

      client
        .get(url, (res) => {
          clearTimeout(timeout);
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        })
        .on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  /**
   * 睡眠
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 处理新标签页创建
   */
  handleTargetCreated(params) {
    const { targetInfo } = params;
    if (targetInfo.type === "page") {
      this.tabs.set(targetInfo.targetId, {
        id: targetInfo.targetId,
        title: targetInfo.title,
        url: targetInfo.url,
      });
      this.emit("tab:created", targetInfo);
    }
  }

  /**
   * 处理标签页关闭
   */
  handleTargetDestroyed(params) {
    const { targetId } = params;
    if (this.tabs.has(targetId)) {
      this.tabs.delete(targetId);
      this.cdpSessions.delete(targetId);
      this.emit("tab:closed", { targetId });
    }
  }

  /**
   * 处理标签页信息变化
   */
  handleTargetInfoChanged(params) {
    const { targetInfo } = params;
    if (this.tabs.has(targetInfo.targetId)) {
      this.tabs.set(targetInfo.targetId, {
        id: targetInfo.targetId,
        title: targetInfo.title,
        url: targetInfo.url,
      });
      this.emit("tab:updated", targetInfo);
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    await this.disconnect();
    this.removeAllListeners();
  }
}

/**
 * CDP 会话类
 */
class CDPSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.timeout = 30000;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      const timeout = setTimeout(() => {
        this.ws.close();
        reject(new Error("CDP Session connection timeout"));
      }, 10000);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        this.setupMessageHandler();
        resolve();
      });

      this.ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  setupMessageHandler() {
    this.ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id);
          this.pendingRequests.delete(message.id);

          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message.result);
          }
        }
      } catch (error) {
        logger.error("[CDPSession] Message parse error:", error);
      }
    });
  }

  async send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("CDP Session not connected");
    }

    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, this.timeout);

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingRequests.clear();
  }
}

module.exports = { UserBrowserHandler };
