/**
 * BrowserEngine - 浏览器自动化引擎
 * 基于 Playwright 实现，模仿 OpenClaw 的设计理念
 *
 * @module browser/browser-engine
 * @author ChainlessChain Team
 * @since v0.27.0
 */
/* global Notification, window */

// Lazy seam for tests: vi.mock cannot intercept this require() reliably
// across CJS/ESM in Vitest. Tests inject a fake via _setChromiumForTesting.
let _chromium = require("playwright-core").chromium;
const { EventEmitter } = require("events");
const path = require("path");
const fs = require("fs").promises;
const { SnapshotEngine } = require("./snapshot-engine");
const { ElementLocator } = require("./element-locator");
const HISTORY_NAVIGATION_OPERATIONS = new Set(["back", "forward", "refresh"]);

function normalizeAllowedNavigationOrigins(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    throw new TypeError("Allowed navigation origins are invalid");
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || entry.length > 2048) {
      throw new TypeError("Allowed navigation origins are invalid");
    }
    let parsed;
    try {
      parsed = new URL(entry);
    } catch {
      throw new TypeError("Allowed navigation origins are invalid");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      entry !== parsed.origin
    ) {
      throw new TypeError("Allowed navigation origins are invalid");
    }
    return parsed.origin;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError("Allowed navigation origins are invalid");
  }
  return new Set(normalized);
}

function navigationOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function assertAllowedNavigationUrl(url, allowedOrigins) {
  const origin = navigationOrigin(url);
  if (origin === null || !allowedOrigins.has(origin)) {
    throw new Error("Navigation target origin is outside the approved scope");
  }
}

function createNavigationRouteHandler(page, allowedOrigins) {
  return async (route) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      const origin = navigationOrigin(request.url());
      if (origin === null || !allowedOrigins.has(origin)) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
      return;
    }
    if (typeof route.fallback === "function") {
      await route.fallback();
    } else {
      await route.continue();
    }
  };
}

function browserProcessId(browser) {
  if (typeof browser?.process !== "function") return undefined;
  try {
    const pid = Reflect.apply(browser.process, browser, [])?.pid;
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 浏览器引擎类
 * 提供浏览器启动、上下文管理、标签页控制等核心功能
 */
class BrowserEngine extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      headless: config.headless ?? false,
      cdpPort: config.cdpPort ?? 18800,
      profileDir: config.profileDir,
      defaultViewport: config.defaultViewport || { width: 1280, height: 720 },
      ...config,
    };

    this.browser = null;
    this.contexts = new Map(); // profileName => BrowserContext
    this.contextPageGuards = new WeakMap(); // BrowserContext => popup guard state
    this.pages = new Map(); // targetId => Page
    this.nextTargetId = 1;

    // 状态跟踪
    this.isRunning = false;
    this.startTime = null;

    // Phase 2: 快照引擎
    this.snapshotEngine = new SnapshotEngine();
  }

  /**
   * 启动浏览器实例
   * @param {Object} options - 启动选项
   * @returns {Promise<Object>} 启动结果
   */
  async start(options = {}) {
    if (this.isRunning) {
      throw new Error("Browser is already running");
    }

    try {
      const launchOptions = {
        headless: options.headless ?? this.config.headless,
        args: [
          `--remote-debugging-port=${this.config.cdpPort}`,
          "--disable-blink-features=AutomationControlled", // 反检测
          "--disable-features=IsolateOrigins,site-per-process",
          "--no-sandbox", // Windows 需要
          ...(options.args || []),
        ],
        // 使用系统安装的 Chrome/Edge
        channel: options.channel || "chrome",
      };

      this.browser = await _chromium.launch(launchOptions);
      this.isRunning = true;
      this.startTime = Date.now();

      this.emit("browser:started", {
        cdpPort: this.config.cdpPort,
        timestamp: this.startTime,
      });

      console.log(
        `[BrowserEngine] Browser started on CDP port ${this.config.cdpPort}`,
      );

      return {
        success: true,
        cdpPort: this.config.cdpPort,
        pid: browserProcessId(this.browser),
      };
    } catch (error) {
      const launchedBrowser = this.browser;
      this.browser = null;
      this.isRunning = false;
      this.startTime = null;
      if (launchedBrowser) {
        await Promise.resolve()
          .then(() => launchedBrowser.close())
          .catch(() => {});
      }
      this.emit("browser:error", { error: error.message });
      throw new Error(`Failed to start browser: ${error.message}`);
    }
  }

  /**
   * 停止浏览器实例
   * @returns {Promise<Object>} 停止结果
   */
  async stop() {
    if (!this.isRunning) {
      throw new Error("Browser is not running");
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
      this.emit("browser:stopped", { uptime });

      console.log(`[BrowserEngine] Browser stopped after ${uptime}ms`);

      return { success: true, uptime };
    } catch (error) {
      this.emit("browser:error", { error: error.message });
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
      throw new Error("Browser is not running. Call start() first.");
    }

    if (this.contexts.has(profileName)) {
      return {
        success: true,
        profileName,
        exists: true,
      };
    }

    let context = null;
    try {
      const contextOptions = {
        viewport: options.viewport || this.config.defaultViewport,
        userAgent: options.userAgent,
        geolocation: options.geolocation,
        permissions: options.permissions,
        storageState: options.storageState, // 恢复 Cookie/LocalStorage
        ignoreHTTPSErrors: options.ignoreHTTPSErrors ?? true,
        ...options,
        acceptDownloads: false,
      };

      context = await this.browser.newContext(contextOptions);

      // 注入反检测脚本
      await context.addInitScript(() => {
        // 隐藏 webdriver 标识
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });

        // 伪装 Chrome 对象
        window.chrome = {
          runtime: {},
          loadTimes: function () {},
          csi: function () {},
          app: {},
        };

        // 伪装 Permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      });

      await this._installContextPageGuard(context, profileName);

      this.contexts.set(profileName, context);

      this.emit("context:created", { profileName });

      console.log(`[BrowserEngine] Context created: ${profileName}`);

      return {
        success: true,
        profileName,
        exists: false,
      };
    } catch (error) {
      if (context !== null) await context.close().catch(() => {});
      this.emit("context:error", { profileName, error: error.message });
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
   * Deny page-initiated popup navigation at the BrowserContext boundary.
   * Only pages returned by BrowserEngine.openTab() are admitted into the
   * explicit page set. This prevents a governed click or key press from using
   * target=_blank/window.open() to bypass the tab-open action contract.
   *
   * @param {BrowserContext} context - Playwright browser context
   * @param {string} profileName - Context profile name
   * @private
   */
  async _installContextPageGuard(context, profileName) {
    if (
      !context ||
      typeof context.route !== "function" ||
      typeof context.on !== "function"
    ) {
      throw new TypeError("Browser context popup guard is unavailable");
    }
    const approvedPages = new WeakSet();
    const blockedPages = new WeakSet();
    const monitoredPages = new WeakSet();
    const blockedDownloads = new WeakSet();
    const blockPage = async (page, reason) => {
      if (!page || blockedPages.has(page)) return;
      blockedPages.add(page);
      this.emit("tab:popup-blocked", { profileName, reason });
      if (typeof page.close === "function") {
        await page.close().catch(() => {});
      }
    };
    const blockDownload = async (download) => {
      if (!download || blockedDownloads.has(download)) return;
      blockedDownloads.add(download);
      this.emit("tab:download-blocked", { profileName });
      if (typeof download.cancel === "function") {
        await download.cancel().catch(() => {});
      }
      if (typeof download.delete === "function") {
        await download.delete().catch(() => {});
      }
    };
    const installPageBoundary = (page) => {
      if (monitoredPages.has(page)) return;
      if (!page || typeof page.on !== "function") {
        throw new TypeError("Browser page download guard is unavailable");
      }
      monitoredPages.add(page);
      page.on("download", (download) => {
        void blockDownload(download);
      });
    };
    const routeHandler = async (route) => {
      const request = route.request();
      if (request.isNavigationRequest()) {
        let requestPage = null;
        try {
          requestPage = request.frame()?.page?.() ?? null;
        } catch {
          requestPage = null;
        }
        if (requestPage === null || !approvedPages.has(requestPage)) {
          await route.abort("blockedbyclient");
          if (requestPage !== null) {
            await blockPage(requestPage, "unapproved-page-navigation");
          } else {
            this.emit("tab:popup-blocked", {
              profileName,
              reason: "unattributed-page-navigation",
            });
          }
          return;
        }
      }
      if (typeof route.fallback === "function") {
        await route.fallback();
      } else {
        await route.continue();
      }
    };
    await context.route("**/*", routeHandler);
    context.on("page", (page) => {
      void Promise.resolve()
        .then(async () => {
          installPageBoundary(page);
          if (typeof page?.opener !== "function") {
            await blockPage(page, "unattributed-page");
            return;
          }
          const opener = await page.opener();
          if (opener !== null) {
            await blockPage(page, "page-initiated-popup");
          }
        })
        .catch(() => blockPage(page, "popup-attribution-failed"));
    });
    this.contextPageGuards.set(
      context,
      Object.freeze({ approvedPages, installPageBoundary, routeHandler }),
    );
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
    const allowedOrigins =
      options.allowedRedirectOrigins === undefined
        ? null
        : normalizeAllowedNavigationOrigins(options.allowedRedirectOrigins);
    let page = null;
    let targetId = null;
    let routeHandler = null;
    let routeInstalled = false;
    let opened = false;

    try {
      if (url && allowedOrigins !== null) {
        assertAllowedNavigationUrl(url, allowedOrigins);
      }
      page = await context.newPage();
      const contextGuard = this.contextPageGuards.get(context);
      contextGuard?.installPageBoundary(page);
      contextGuard?.approvedPages.add(page);
      targetId = `tab-${this.nextTargetId++}`;

      // 为页面添加 targetId 属性（用于快照引擎）
      page._targetId = targetId;

      // 保存页面映射
      this.pages.set(targetId, page);

      // 设置页面事件监听
      page.on("close", () => {
        this.pages.delete(targetId);
        if (opened) this.emit("tab:closed", { targetId });
      });

      page.on("crash", () => {
        this.emit("tab:crashed", { targetId });
      });

      page.on("console", (msg) => {
        this.emit("tab:console", {
          targetId,
          type: msg.type(),
          text: msg.text(),
        });
      });

      // 导航到 URL
      if (url) {
        if (allowedOrigins !== null) {
          routeHandler = createNavigationRouteHandler(page, allowedOrigins);
          await page.route("**/*", routeHandler);
          routeInstalled = true;
        }
        await page.goto(url, {
          waitUntil: options.waitUntil || "domcontentloaded",
          timeout: options.timeout || 30000,
        });
      }

      const finalUrl = page.url();
      const title = await page.title();
      opened = true;
      this.emit("tab:opened", { targetId, url, profileName });

      console.log(`[BrowserEngine] Tab opened: ${targetId} -> ${url}`);

      return {
        success: true,
        targetId,
        url: finalUrl,
        title,
      };
    } catch (error) {
      if (targetId !== null) this.pages.delete(targetId);
      if (page !== null) await page.close().catch(() => {});
      this.emit("tab:error", { error: error.message });
      throw new Error(`Failed to open tab: ${error.message}`);
    } finally {
      if (routeInstalled && page !== null) {
        await page.unroute("**/*", routeHandler).catch(() => {});
      }
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

      this.emit("tab:focused", { targetId });

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
        profileName: contextName,
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
    const allowedOrigins =
      options.allowedRedirectOrigins === undefined
        ? null
        : normalizeAllowedNavigationOrigins(options.allowedRedirectOrigins);
    const routeHandler =
      allowedOrigins === null
        ? null
        : createNavigationRouteHandler(page, allowedOrigins);
    let routeInstalled = false;

    try {
      if (routeHandler !== null) {
        await page.route("**/*", routeHandler);
        routeInstalled = true;
      }
      await page.goto(url, {
        waitUntil: options.waitUntil || "domcontentloaded",
        timeout: options.timeout || 30000,
      });

      this.emit("tab:navigated", { targetId, url });

      console.log(`[BrowserEngine] Navigated: ${targetId} -> ${url}`);

      return {
        success: true,
        url: page.url(),
        title: await page.title(),
      };
    } catch (error) {
      throw new Error(`Failed to navigate: ${error.message}`);
    } finally {
      if (routeInstalled) {
        await page.unroute("**/*", routeHandler).catch(() => {});
      }
    }
  }

  /**
   * Execute an approved history navigation without trusting a caller-supplied
   * destination. Back/forward targets are read from Chromium history and
   * checked against the approved origin set before the page is mutated.
   *
   * @param {string} targetId - Tab ID
   * @param {"back"|"forward"|"refresh"} operation - History operation
   * @param {Object} options - Navigation and approved-origin options
   * @returns {Promise<Object>} Navigation result
   */
  async navigateHistory(targetId, operation, options = {}) {
    if (!HISTORY_NAVIGATION_OPERATIONS.has(operation)) {
      throw new TypeError("History navigation operation is invalid");
    }
    const page = this.getPage(targetId);
    const allowedOrigins = normalizeAllowedNavigationOrigins(
      options.allowedRedirectOrigins,
    );
    const routeHandler = createNavigationRouteHandler(page, allowedOrigins);
    let routeInstalled = false;
    let cdpSession = null;

    try {
      await page.route("**/*", routeHandler);
      routeInstalled = true;
      if (operation === "refresh") {
        assertAllowedNavigationUrl(page.url(), allowedOrigins);
      } else {
        const context = page.context();
        if (typeof context?.newCDPSession !== "function") {
          throw new Error("Authenticated browser history is unavailable");
        }
        cdpSession = await context.newCDPSession(page);
        const history = await cdpSession.send("Page.getNavigationHistory");
        if (
          !history ||
          !Number.isSafeInteger(history.currentIndex) ||
          !Array.isArray(history.entries)
        ) {
          throw new Error("Authenticated browser history is unavailable");
        }
        const targetIndex =
          history.currentIndex + (operation === "back" ? -1 : 1);
        const entry = history.entries[targetIndex];
        if (
          !entry ||
          !Number.isSafeInteger(entry.id) ||
          typeof entry.url !== "string"
        ) {
          throw new Error(`No ${operation} history entry is available`);
        }
        assertAllowedNavigationUrl(entry.url, allowedOrigins);
      }
      const navigationOptions = {
        waitUntil: options.waitUntil || "domcontentloaded",
        timeout: options.timeout || 30000,
      };
      if (operation === "refresh") {
        await page.reload(navigationOptions);
      } else if (operation === "back") {
        await page.goBack(navigationOptions);
      } else {
        await page.goForward(navigationOptions);
      }
      assertAllowedNavigationUrl(page.url(), allowedOrigins);

      const url = page.url();
      this.emit("tab:navigated", { targetId, url, operation });
      return {
        success: true,
        operation,
        url,
        title: await page.title(),
      };
    } catch (error) {
      throw new Error(`Failed to ${operation}: ${error.message}`);
    } finally {
      if (routeInstalled) {
        await page.unroute("**/*", routeHandler).catch(() => {});
      }
      if (cdpSession && typeof cdpSession.detach === "function") {
        await cdpSession.detach().catch(() => {});
      }
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
        type: options.type || "png",
        fullPage: options.fullPage ?? false,
        quality: options.quality,
        clip: options.clip,
      };

      const buffer = await page.screenshot(screenshotOptions);

      this.emit("tab:screenshot", {
        targetId,
        size: buffer.length,
      });

      console.log(
        `[BrowserEngine] Screenshot taken: ${targetId} (${buffer.length} bytes)`,
      );

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
      pid: browserProcessId(this.browser),
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
        stateFile = path.join(this.config.profileDir, `${profileName}.json`);
      }

      // 确保目录存在
      await fs.mkdir(path.dirname(stateFile), { recursive: true });

      // 保存状态
      await fs.writeFile(stateFile, JSON.stringify(state, null, 2));

      console.log(
        `[BrowserEngine] Session saved: ${profileName} -> ${stateFile}`,
      );

      return {
        success: true,
        stateFile,
        cookiesCount: state.cookies.length,
        originsCount: state.origins.length,
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
      stateFile = path.join(this.config.profileDir, `${profileName}.json`);
    }

    try {
      // 读取状态文件
      const stateData = await fs.readFile(stateFile, "utf-8");
      const state = JSON.parse(stateData);

      // 创建带有恢复状态的上下文
      await this.createContext(profileName, { storageState: state });

      console.log(
        `[BrowserEngine] Session restored: ${profileName} <- ${stateFile}`,
      );

      return {
        success: true,
        profileName,
        cookiesCount: state.cookies.length,
        originsCount: state.origins.length,
      };
    } catch (error) {
      throw new Error(`Failed to restore session: ${error.message}`);
    }
  }

  // ==================== Phase 2: 智能快照和元素操作 ====================

  /**
   * 获取页面快照
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 快照选项
   * @param {boolean} options.interactive - 是否只包含可交互元素
   * @param {boolean} options.visible - 是否只包含可见元素
   * @param {boolean} options.roleRefs - 是否使用角色引用格式
   * @returns {Promise<Object>} 快照对象
   */
  async takeSnapshot(targetId, options = {}) {
    const page = this.getPage(targetId);

    try {
      const snapshot = await this.snapshotEngine.takeSnapshot(page, options);

      this.emit("snapshot:taken", {
        targetId,
        elementsCount: snapshot.elementsCount,
      });

      console.log(
        `[BrowserEngine] Snapshot taken for ${targetId}: ${snapshot.elementsCount} elements`,
      );

      return snapshot;
    } catch (error) {
      this.emit("snapshot:error", { targetId, error: error.message });
      throw new Error(`Failed to take snapshot: ${error.message}`);
    }
  }

  /**
   * 执行元素操作
   * @param {string} targetId - 标签页 ID
   * @param {string} action - 操作类型 (click/type/select/drag/hover)
   * @param {string} ref - 元素引用
   * @param {Object} options - 操作选项
   * @returns {Promise<Object>} 操作结果
   */
  async act(targetId, action, ref, options = {}) {
    const page = this.getPage(targetId);

    try {
      // 从快照中查找元素
      const element = this.snapshotEngine.findElement(targetId, ref);
      if (!element) {
        throw new Error(
          `Element ${ref} not found in snapshot. Run takeSnapshot() first.`,
        );
      }

      // 使用 ElementLocator 定位元素
      const locator = await ElementLocator.locate(page, element);

      // 执行操作
      let result = {};

      switch (action.toLowerCase()) {
        case "click":
          await locator.click({
            button: options.button || "left",
            clickCount: options.double ? 2 : 1,
            delay: options.delay,
          });
          result = { clicked: true };
          break;

        case "type":
          if (!options.text) {
            throw new Error("Text is required for type action");
          }
          await locator.fill(options.text);
          result = { typed: options.text };
          break;

        case "select":
          if (!options.value) {
            throw new Error("Value is required for select action");
          }
          await locator.selectOption(options.value);
          result = { selected: options.value };
          break;

        case "drag": {
          if (!options.target) {
            throw new Error("Target is required for drag action");
          }
          const targetElement = this.snapshotEngine.findElement(
            targetId,
            options.target,
          );
          if (!targetElement) {
            throw new Error(`Target element ${options.target} not found`);
          }
          const targetLocator = await ElementLocator.locate(
            page,
            targetElement,
          );
          await locator.dragTo(targetLocator);
          result = { dragged: true, target: options.target };
          break;
        }

        case "hover":
          await locator.hover();
          result = { hovered: true };
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // 可选的等待
      if (options.waitFor) {
        await page.waitForLoadState(options.waitFor);
      }

      this.emit("element:acted", {
        targetId,
        action,
        ref,
        result,
      });

      console.log(`[BrowserEngine] Action ${action} executed on ${ref}`);

      return {
        success: true,
        action,
        ref,
        ...result,
      };
    } catch (error) {
      this.emit("element:error", {
        targetId,
        action,
        ref,
        error: error.message,
      });
      throw new Error(
        `Failed to execute ${action} on ${ref}: ${error.message}`,
      );
    }
  }

  /**
   * 查找元素
   * @param {string} targetId - 标签页 ID
   * @param {string} ref - 元素引用
   * @returns {Object|null} 元素对象
   */
  findElement(targetId, ref) {
    return this.snapshotEngine.findElement(targetId, ref);
  }

  /**
   * 验证引用是否有效
   * @param {string} targetId - 标签页 ID
   * @param {string} ref - 元素引用
   * @returns {boolean}
   */
  validateRef(targetId, ref) {
    return this.snapshotEngine.validateRef(targetId, ref);
  }

  /**
   * 清除快照缓存
   * @param {string} targetId - 标签页 ID（可选）
   */
  clearSnapshot(targetId = null) {
    this.snapshotEngine.clearSnapshot(targetId);
  }

  /**
   * 获取快照统计
   * @returns {Object}
   */
  getSnapshotStats() {
    return this.snapshotEngine.getStats();
  }

  /**
   * 清理资源
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.isRunning) {
      await this.stop();
    }
    // 清理所有快照
    this.snapshotEngine.clearSnapshot();
  }
}

/**
 * Test seam — swap the playwright-core chromium binding without going through
 * vi.mock (which cannot intercept require() reliably in CJS sources).
 * Pass `null` to restore the real chromium.
 */
function _setChromiumForTesting(chromium) {
  _chromium = chromium ?? require("playwright-core").chromium;
}

module.exports = { BrowserEngine, _setChromiumForTesting };
