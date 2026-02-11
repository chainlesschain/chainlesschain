/**
 * Browser IPC 接口
 * 为渲染进程提供浏览器控制功能
 *
 * @module browser/browser-ipc
 * @author ChainlessChain Team
 * @since v0.27.0
 */

const { ipcMain, app } = require("electron");
const path = require("path");
const { BrowserEngine } = require("./browser-engine");
const { BrowserAutomationAgent } = require("./browser-automation-agent");
const { logger } = require("../utils/logger");

/**
 * 创建 IPC 错误处理包装器
 * @param {string} prefix - 日志前缀
 * @returns {Function} 高阶函数，用于包装 IPC 处理器
 */
function createIPCErrorHandler(prefix) {
  return (handler) =>
    async (event, ...args) => {
      try {
        return await handler(event, ...args);
      } catch (error) {
        logger.error(`[${prefix}] IPC Error:`, error.message);
        throw error;
      }
    };
}

// 创建浏览器引擎实例
let browserEngine = null;
let automationAgent = null;

/**
 * 获取浏览器引擎实例
 * @returns {BrowserEngine}
 */
function getBrowserEngine() {
  if (!browserEngine) {
    const profileDir = path.join(app.getPath("userData"), ".browser-profiles");

    browserEngine = new BrowserEngine({
      headless: false,
      cdpPort: 18800,
      profileDir,
    });

    // 监听事件并记录日志
    browserEngine.on("browser:started", (data) => {
      logger.info("[Browser] Browser started", data);
    });

    browserEngine.on("browser:stopped", (data) => {
      logger.info("[Browser] Browser stopped", data);
    });

    browserEngine.on("browser:error", (data) => {
      logger.error("[Browser] Browser error", data);
    });

    browserEngine.on("tab:opened", (data) => {
      logger.info("[Browser] Tab opened", data);
    });

    browserEngine.on("tab:closed", (data) => {
      logger.info("[Browser] Tab closed", data);
    });
  }

  return browserEngine;
}

/**
 * 获取 AI 自动化代理实例
 * @returns {BrowserAutomationAgent}
 */
function getAutomationAgent() {
  if (!automationAgent) {
    const engine = getBrowserEngine();

    // 获取 LLM 服务（延迟加载）
    let llmService = null;
    try {
      const { getLLMService } = require("../llm/llm-service");
      llmService = getLLMService();
    } catch (error) {
      logger.warn("[Browser] LLM Service not available, AI features disabled");
    }

    automationAgent = new BrowserAutomationAgent(llmService, engine);

    // 监听事件
    automationAgent.on("execution:started", (data) => {
      logger.info("[Browser AI] Execution started", data);
    });

    automationAgent.on("execution:completed", (data) => {
      logger.info("[Browser AI] Execution completed", data);
    });

    automationAgent.on("execution:failed", (data) => {
      logger.error("[Browser AI] Execution failed", data);
    });
  }

  return automationAgent;
}

/**
 * 注册所有 Browser IPC 处理器
 * @param {Object} [deps] - Optional dependency injection (used in tests)
 * @param {Object} [deps.ipcMain] - Electron ipcMain override
 * @param {Function} [deps.createIPCErrorHandler] - createIPCErrorHandler override
 * @param {Function} [deps.getBrowserEngine] - getBrowserEngine override
 * @param {Function} [deps.getAutomationAgent] - getAutomationAgent override
 */
function registerBrowserIPC(deps = {}) {
  const _ipcMain = deps.ipcMain || ipcMain;
  const _getBrowserEngineRaw = deps.getBrowserEngine || getBrowserEngine;
  // Cache the engine so cleanupBrowser() can find it
  const _getBrowserEngine = () => {
    const engine = _getBrowserEngineRaw();
    if (engine) {
      browserEngine = engine;
    }
    return engine;
  };
  const _getAutomationAgent = deps.getAutomationAgent || getAutomationAgent;
  const withErrorHandler = (
    deps.createIPCErrorHandler || createIPCErrorHandler
  )("browser");

  // ==================== 浏览器生命周期 ====================

  /**
   * 启动浏览器
   * @param {Object} options - 启动选项
   * @param {boolean} options.headless - 是否无头模式
   * @param {string} options.channel - 浏览器渠道 (chrome/msedge)
   * @returns {Promise<Object>} { success, cdpPort, pid }
   */
  _ipcMain.handle(
    "browser:start",
    withErrorHandler(async (event, options = {}) => {
      const engine = _getBrowserEngine();
      const result = await engine.start(options);

      logger.info("[Browser IPC] Browser started", {
        cdpPort: result.cdpPort,
        pid: result.pid,
      });

      return result;
    }),
  );

  /**
   * 停止浏览器
   * @returns {Promise<Object>} { success, uptime }
   */
  _ipcMain.handle(
    "browser:stop",
    withErrorHandler(async (event) => {
      const engine = _getBrowserEngine();
      const result = await engine.stop();

      logger.info("[Browser IPC] Browser stopped", {
        uptime: result.uptime,
      });

      return result;
    }),
  );

  /**
   * 获取浏览器状态
   * @returns {Promise<Object>} 状态信息
   */
  _ipcMain.handle(
    "browser:getStatus",
    withErrorHandler(async (event) => {
      const engine = _getBrowserEngine();
      return engine.getStatus();
    }),
  );

  // ==================== 上下文（Profile）管理 ====================

  /**
   * 创建浏览器上下文
   * @param {string} profileName - Profile 名称
   * @param {Object} options - 上下文选项
   * @returns {Promise<Object>} { success, profileName, exists }
   */
  _ipcMain.handle(
    "browser:createContext",
    withErrorHandler(async (event, profileName, options = {}) => {
      const engine = _getBrowserEngine();
      const result = await engine.createContext(profileName, options);

      logger.info("[Browser IPC] Context created", {
        profileName,
        exists: result.exists,
      });

      return result;
    }),
  );

  // ==================== 标签页管理 ====================

  /**
   * 打开新标签页
   * @param {string} profileName - Profile 名称
   * @param {string} url - 目标 URL
   * @param {Object} options - 打开选项
   * @returns {Promise<Object>} { success, targetId, url, title }
   */
  _ipcMain.handle(
    "browser:openTab",
    withErrorHandler(async (event, profileName, url, options = {}) => {
      const engine = _getBrowserEngine();
      const result = await engine.openTab(profileName, url, options);

      logger.info("[Browser IPC] Tab opened", {
        targetId: result.targetId,
        url: result.url,
        profileName,
      });

      return result;
    }),
  );

  /**
   * 关闭标签页
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>} { success, targetId }
   */
  _ipcMain.handle(
    "browser:closeTab",
    withErrorHandler(async (event, targetId) => {
      const engine = _getBrowserEngine();
      const result = await engine.closeTab(targetId);

      logger.info("[Browser IPC] Tab closed", { targetId });

      return result;
    }),
  );

  /**
   * 聚焦标签页
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>} { success, targetId }
   */
  _ipcMain.handle(
    "browser:focusTab",
    withErrorHandler(async (event, targetId) => {
      const engine = _getBrowserEngine();
      const result = await engine.focusTab(targetId);

      logger.info("[Browser IPC] Tab focused", { targetId });

      return result;
    }),
  );

  /**
   * 列出所有标签页
   * @param {string} profileName - Profile 名称（可选）
   * @returns {Promise<Array>} 标签页列表
   */
  _ipcMain.handle(
    "browser:listTabs",
    withErrorHandler(async (event, profileName = null) => {
      const engine = _getBrowserEngine();
      const tabs = await engine.listTabs(profileName);

      logger.debug("[Browser IPC] List tabs", {
        profileName,
        count: tabs.length,
      });

      return tabs;
    }),
  );

  // ==================== 页面操作 ====================

  /**
   * 导航到指定 URL
   * @param {string} targetId - 标签页 ID
   * @param {string} url - 目标 URL
   * @param {Object} options - 导航选项
   * @returns {Promise<Object>} { success, url, title }
   */
  _ipcMain.handle(
    "browser:navigate",
    withErrorHandler(async (event, targetId, url, options = {}) => {
      const engine = _getBrowserEngine();
      const result = await engine.navigate(targetId, url, options);

      logger.info("[Browser IPC] Navigated", {
        targetId,
        url: result.url,
      });

      return result;
    }),
  );

  /**
   * 截图
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 截图选项
   * @returns {Promise<Object>} { screenshot: base64 }
   */
  _ipcMain.handle(
    "browser:screenshot",
    withErrorHandler(async (event, targetId, options = {}) => {
      const engine = _getBrowserEngine();
      const buffer = await engine.screenshot(targetId, options);

      logger.info("[Browser IPC] Screenshot taken", {
        targetId,
        size: buffer.length,
      });

      // 返回 base64 编码的截图
      return {
        screenshot: buffer.toString("base64"),
        type: options.type || "png",
      };
    }),
  );

  // ==================== 会话管理 ====================

  /**
   * 保存会话状态
   * @param {string} profileName - Profile 名称
   * @param {string} stateFile - 状态文件路径（可选）
   * @returns {Promise<Object>} { success, stateFile, cookiesCount, originsCount }
   */
  _ipcMain.handle(
    "browser:saveSession",
    withErrorHandler(async (event, profileName, stateFile = null) => {
      const engine = _getBrowserEngine();
      const result = await engine.saveSession(profileName, stateFile);

      logger.info("[Browser IPC] Session saved", {
        profileName,
        stateFile: result.stateFile,
        cookiesCount: result.cookiesCount,
      });

      return result;
    }),
  );

  /**
   * 恢复会话状态
   * @param {string} profileName - Profile 名称
   * @param {string} stateFile - 状态文件路径（可选）
   * @returns {Promise<Object>} { success, profileName, cookiesCount, originsCount }
   */
  _ipcMain.handle(
    "browser:restoreSession",
    withErrorHandler(async (event, profileName, stateFile = null) => {
      const engine = _getBrowserEngine();
      const result = await engine.restoreSession(profileName, stateFile);

      logger.info("[Browser IPC] Session restored", {
        profileName,
        cookiesCount: result.cookiesCount,
      });

      return result;
    }),
  );

  // ==================== Phase 2: 智能快照和元素操作 ====================

  /**
   * 获取页面快照
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 快照选项
   * @returns {Promise<Object>} 快照对象
   */
  _ipcMain.handle(
    "browser:snapshot",
    withErrorHandler(async (event, targetId, options = {}) => {
      const engine = _getBrowserEngine();
      const snapshot = await engine.takeSnapshot(targetId, options);

      logger.info("[Browser IPC] Snapshot taken", {
        targetId,
        elementsCount: snapshot.elementsCount,
      });

      return snapshot;
    }),
  );

  /**
   * 执行元素操作
   * @param {string} targetId - 标签页 ID
   * @param {string} action - 操作类型 (click/type/select/drag/hover)
   * @param {string} ref - 元素引用
   * @param {Object} options - 操作选项
   * @returns {Promise<Object>} 操作结果
   */
  _ipcMain.handle(
    "browser:act",
    withErrorHandler(async (event, targetId, action, ref, options = {}) => {
      const engine = _getBrowserEngine();
      const result = await engine.act(targetId, action, ref, options);

      logger.info("[Browser IPC] Element action executed", {
        targetId,
        action,
        ref,
      });

      return result;
    }),
  );

  /**
   * 查找元素
   * @param {string} targetId - 标签页 ID
   * @param {string} ref - 元素引用
   * @returns {Promise<Object>} 元素对象
   */
  _ipcMain.handle(
    "browser:findElement",
    withErrorHandler(async (event, targetId, ref) => {
      const engine = _getBrowserEngine();
      const element = engine.findElement(targetId, ref);

      if (!element) {
        throw new Error(`Element ${ref} not found`);
      }

      logger.debug("[Browser IPC] Element found", { targetId, ref });

      return element;
    }),
  );

  /**
   * 验证引用是否有效
   * @param {string} targetId - 标签页 ID
   * @param {string} ref - 元素引用
   * @returns {Promise<boolean>}
   */
  _ipcMain.handle(
    "browser:validateRef",
    withErrorHandler(async (event, targetId, ref) => {
      const engine = _getBrowserEngine();
      const isValid = engine.validateRef(targetId, ref);

      logger.debug("[Browser IPC] Reference validated", {
        targetId,
        ref,
        isValid,
      });

      return isValid;
    }),
  );

  /**
   * 清除快照缓存
   * @param {string} targetId - 标签页 ID（可选）
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clearSnapshot",
    withErrorHandler(async (event, targetId = null) => {
      const engine = _getBrowserEngine();
      engine.clearSnapshot(targetId);

      logger.info("[Browser IPC] Snapshot cleared", { targetId });

      return { success: true };
    }),
  );

  /**
   * 获取快照统计
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:getSnapshotStats",
    withErrorHandler(async (event) => {
      const engine = _getBrowserEngine();
      const stats = engine.getSnapshotStats();

      logger.debug("[Browser IPC] Snapshot stats retrieved", {
        totalSnapshots: stats.totalSnapshots,
      });

      return stats;
    }),
  );

  // ==================== Phase 3: AI 自然语言控制 ====================

  /**
   * 执行 AI 指令
   * @param {string} targetId - 标签页 ID
   * @param {string} prompt - 自然语言指令
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>} 执行结果
   */
  _ipcMain.handle(
    "browser:aiExecute",
    withErrorHandler(async (event, targetId, prompt, options = {}) => {
      const agent = _getAutomationAgent();

      if (!agent.llmService) {
        throw new Error(
          "LLM Service not available. Please configure LLM settings.",
        );
      }

      const result = await agent.execute(targetId, prompt, options);

      logger.info("[Browser IPC] AI command executed", {
        targetId,
        prompt,
        stepsCount: result.steps.length,
      });

      return result;
    }),
  );

  /**
   * 解析 AI 指令（仅解析，不执行）
   * @param {string} targetId - 标签页 ID
   * @param {string} prompt - 自然语言指令
   * @returns {Promise<Array>} 操作步骤
   */
  _ipcMain.handle(
    "browser:aiParse",
    withErrorHandler(async (event, targetId, prompt) => {
      const agent = _getAutomationAgent();

      if (!agent.llmService) {
        throw new Error(
          "LLM Service not available. Please configure LLM settings.",
        );
      }

      const engine = _getBrowserEngine();
      const snapshot = await engine.takeSnapshot(targetId, {
        interactive: true,
        visible: true,
        roleRefs: true,
      });

      const steps = await agent.parseCommand(prompt, snapshot);

      logger.info("[Browser IPC] AI command parsed", {
        targetId,
        prompt,
        stepsCount: steps.length,
      });

      return { steps, snapshot };
    }),
  );

  /**
   * 获取 AI 执行历史
   * @param {number} limit - 返回数量限制
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:aiGetHistory",
    withErrorHandler(async (event, limit = 10) => {
      const agent = _getAutomationAgent();
      const history = agent.getHistory(limit);

      logger.debug("[Browser IPC] AI history retrieved", {
        count: history.length,
      });

      return history;
    }),
  );

  /**
   * 清除 AI 执行历史
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:aiClearHistory",
    withErrorHandler(async (event) => {
      const agent = _getAutomationAgent();
      agent.clearHistory();

      logger.info("[Browser IPC] AI history cleared");

      return { success: true };
    }),
  );

  // ==================== Phase 4: Extended Actions ====================

  /**
   * Execute scroll action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Scroll options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:scroll",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { ScrollAction } = require("./actions");
      const engine = _getBrowserEngine();
      const scrollAction = new ScrollAction(engine);
      return scrollAction.execute(targetId, options);
    }),
  );

  /**
   * Execute keyboard action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Keyboard options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:keyboard",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { KeyboardAction } = require("./actions");
      const engine = _getBrowserEngine();
      const keyboardAction = new KeyboardAction(engine);
      return keyboardAction.execute(targetId, options);
    }),
  );

  /**
   * Execute file upload action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Upload options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:upload",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { UploadAction } = require("./actions");
      const engine = _getBrowserEngine();
      const uploadAction = new UploadAction(engine);
      return uploadAction.execute(targetId, options);
    }),
  );

  /**
   * Execute multi-tab action
   * @param {string} targetId - Primary tab ID
   * @param {Object} options - Multi-tab options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:multiTab",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { MultiTabAction } = require("./actions");
      const engine = _getBrowserEngine();
      const multiTabAction = new MultiTabAction(engine);
      return multiTabAction.execute(targetId, options);
    }),
  );

  // ==================== Phase 4: Advanced Scanning ====================

  /**
   * Advanced page scan (Shadow DOM + iframes)
   * @param {string} targetId - Tab ID
   * @param {Object} options - Scan options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:scan:advanced",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { ShadowDOMScanner, IframeScanner } = require("./advanced");
      const engine = _getBrowserEngine();

      const result = {
        shadowDOM: null,
        iframes: null,
      };

      if (options.scanShadowDOM !== false) {
        const shadowScanner = new ShadowDOMScanner(engine);
        result.shadowDOM = await shadowScanner.scan(
          targetId,
          options.shadowOptions,
        );
      }

      if (options.scanIframes !== false) {
        const iframeScanner = new IframeScanner(engine);
        result.iframes = await iframeScanner.scan(
          targetId,
          options.iframeOptions,
        );
      }

      return result;
    }),
  );

  // ==================== Phase 5: OCR ====================

  /**
   * OCR recognize text
   * @param {string} targetId - Tab ID
   * @param {Object} options - OCR options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:ocr:recognize",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { OCREngine } = require("./diagnostics");
      const engine = _getBrowserEngine();
      const page = engine.getPage(targetId);
      const ocr = new OCREngine(options);
      return ocr.recognizeFromPage(page, options);
    }),
  );

  // ==================== Phase 5: Screenshot Comparison ====================

  /**
   * Compare screenshots
   * @param {Buffer|string} baseline - Baseline screenshot
   * @param {Buffer|string} current - Current screenshot
   * @param {Object} options - Compare options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:screenshot:compare",
    withErrorHandler(async (event, baseline, current, options = {}) => {
      const { ScreenshotDiff } = require("./diagnostics");
      const diff = new ScreenshotDiff(options);
      return diff.compare(
        Buffer.isBuffer(baseline) ? baseline : Buffer.from(baseline, "base64"),
        Buffer.isBuffer(current) ? current : Buffer.from(current, "base64"),
        options,
      );
    }),
  );

  // ==================== Phase 6: Computer Use Capabilities (v0.33.0) ====================

  /**
   * Execute coordinate-level mouse action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Coordinate action options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:coordinate",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { CoordinateAction } = require("./actions");
      const engine = _getBrowserEngine();
      const coordinateAction = new CoordinateAction(engine);
      return coordinateAction.execute(targetId, options);
    }),
  );

  /**
   * Execute vision AI action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Vision action options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:vision",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { VisionAction } = require("./actions");
      const engine = _getBrowserEngine();

      // 获取 LLM 服务
      let llmService = null;
      try {
        const { getLLMService } = require("../llm/llm-service");
        llmService = getLLMService();
      } catch (e) {
        logger.warn("[Browser IPC] LLM Service not available for vision");
      }

      const visionAction = new VisionAction(engine, llmService);
      return visionAction.execute(targetId, options);
    }),
  );

  /**
   * Visual click - find element by description and click
   * @param {string} targetId - Tab ID
   * @param {string} description - Element description
   * @param {Object} options - Click options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:visualClick",
    withErrorHandler(async (event, targetId, description, options = {}) => {
      const { VisionAction } = require("./actions");
      const engine = _getBrowserEngine();

      let llmService = null;
      try {
        const { getLLMService } = require("../llm/llm-service");
        llmService = getLLMService();
      } catch (e) {
        throw new Error("LLM Service required for visual click");
      }

      const visionAction = new VisionAction(engine, llmService);
      return visionAction.visualClick(targetId, description, options);
    }),
  );

  /**
   * Execute network interceptor action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Network action options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:network",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { NetworkInterceptor } = require("./actions");
      const engine = _getBrowserEngine();

      // 使用单例模式
      if (!engine._networkInterceptor) {
        engine._networkInterceptor = new NetworkInterceptor(engine);
      }

      return engine._networkInterceptor.execute(targetId, options);
    }),
  );

  /**
   * Execute desktop-level action
   * @param {Object} options - Desktop action options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:desktop",
    withErrorHandler(async (event, options = {}) => {
      const { DesktopAction } = require("./actions");

      // 使用单例
      if (!global._desktopAction) {
        global._desktopAction = new DesktopAction();
      }

      return global._desktopAction.execute(options);
    }),
  );

  /**
   * Capture desktop screen
   * @param {Object} options - Capture options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:desktop:capture",
    withErrorHandler(async (event, options = {}) => {
      const { DesktopAction } = require("./actions");

      if (!global._desktopAction) {
        global._desktopAction = new DesktopAction();
      }

      return global._desktopAction.captureScreen(options);
    }),
  );

  /**
   * Desktop click at coordinates
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {Object} options - Click options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:desktop:click",
    withErrorHandler(async (event, x, y, options = {}) => {
      const { DesktopAction } = require("./actions");

      if (!global._desktopAction) {
        global._desktopAction = new DesktopAction();
      }

      return global._desktopAction.click(x, y, options);
    }),
  );

  /**
   * Desktop type text
   * @param {string} text - Text to type
   * @param {Object} options - Type options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:desktop:type",
    withErrorHandler(async (event, text, options = {}) => {
      const { DesktopAction } = require("./actions");

      if (!global._desktopAction) {
        global._desktopAction = new DesktopAction();
      }

      return global._desktopAction.typeText(text, options);
    }),
  );

  /**
   * Desktop press key
   * @param {string} key - Key to press
   * @param {Array<string>} modifiers - Modifier keys
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:desktop:key",
    withErrorHandler(async (event, key, modifiers = []) => {
      const { DesktopAction } = require("./actions");

      if (!global._desktopAction) {
        global._desktopAction = new DesktopAction();
      }

      return global._desktopAction.pressKey(key, modifiers);
    }),
  );

  // ==================== Phase 6: Audit Logging (v0.33.0) ====================

  /**
   * Log operation to audit log
   * @param {Object} data - Operation data
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:audit:log",
    withErrorHandler(async (event, data) => {
      const { getAuditLogger } = require("./actions");
      const auditLogger = getAuditLogger();
      return auditLogger.log(data);
    }),
  );

  /**
   * Query audit logs
   * @param {Object} filter - Query filter
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:audit:query",
    withErrorHandler(async (event, filter = {}) => {
      const { getAuditLogger } = require("./actions");
      const auditLogger = getAuditLogger();
      return auditLogger.query(filter);
    }),
  );

  /**
   * Get audit statistics
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:audit:stats",
    withErrorHandler(async (event) => {
      const { getAuditLogger } = require("./actions");
      const auditLogger = getAuditLogger();
      return auditLogger.getStats();
    }),
  );

  /**
   * Get high risk operations
   * @param {number} limit - Limit count
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:audit:highRisk",
    withErrorHandler(async (event, limit = 50) => {
      const { getAuditLogger } = require("./actions");
      const auditLogger = getAuditLogger();
      return auditLogger.getHighRiskOperations(limit);
    }),
  );

  /**
   * Export audit logs
   * @param {string} format - Export format (json/csv)
   * @param {Object} filter - Query filter
   * @returns {Promise<string>}
   */
  _ipcMain.handle(
    "browser:audit:export",
    withErrorHandler(async (event, format = "json", filter = {}) => {
      const { getAuditLogger } = require("./actions");
      const auditLogger = getAuditLogger();
      return auditLogger.export(format, filter);
    }),
  );

  // ==================== Phase 6: Screen Recording (v0.33.0) ====================

  /**
   * Start screen recording
   * @param {string} targetId - Tab ID (null for desktop)
   * @param {Object} options - Recording options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recording:start",
    withErrorHandler(async (event, targetId = null, options = {}) => {
      const { getScreenRecorder } = require("./actions");
      const engine = _getBrowserEngine();
      const recorder = getScreenRecorder(engine, options);
      return recorder.startRecording(targetId, options);
    }),
  );

  /**
   * Pause screen recording
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recording:pause",
    withErrorHandler(async (event) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.pauseRecording();
    }),
  );

  /**
   * Resume screen recording
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recording:resume",
    withErrorHandler(async (event) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.resumeRecording();
    }),
  );

  /**
   * Stop screen recording
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recording:stop",
    withErrorHandler(async (event) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.stopRecording();
    }),
  );

  /**
   * Get recording status
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recording:status",
    withErrorHandler(async (event) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.getStatus();
    }),
  );

  /**
   * List all recordings
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:recording:list",
    withErrorHandler(async (event) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.listRecordings();
    }),
  );

  /**
   * Get recording details
   * @param {string} recordingId - Recording ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recording:get",
    withErrorHandler(async (event, recordingId) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.getRecording(recordingId);
    }),
  );

  /**
   * Delete recording
   * @param {string} recordingId - Recording ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recording:delete",
    withErrorHandler(async (event, recordingId) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.deleteRecording(recordingId);
    }),
  );

  /**
   * Export recording as GIF data
   * @param {string} recordingId - Recording ID
   * @param {Object} options - Export options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recording:exportGif",
    withErrorHandler(async (event, recordingId, options = {}) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.exportToGif(recordingId, options);
    }),
  );

  /**
   * Get single frame from recording
   * @param {string} recordingId - Recording ID
   * @param {number} frameIndex - Frame index
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recording:frame",
    withErrorHandler(async (event, recordingId, frameIndex) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.getFrame(recordingId, frameIndex);
    }),
  );

  // ==================== Phase 7: Action Replay (v0.33.0) ====================

  /**
   * Load actions for replay
   * @param {Array} actions - Actions to load
   * @param {Object} options - Load options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:load",
    withErrorHandler(async (event, actions, options = {}) => {
      const { getActionReplay } = require("./actions");
      const engine = _getBrowserEngine();
      const replay = getActionReplay(engine);
      return replay.load(actions, options);
    }),
  );

  /**
   * Start action replay
   * @param {Object} options - Replay options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:play",
    withErrorHandler(async (event, options = {}) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.play(options);
    }),
  );

  /**
   * Pause action replay
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:pause",
    withErrorHandler(async (event) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.pause();
    }),
  );

  /**
   * Resume action replay
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:resume",
    withErrorHandler(async (event) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.resume();
    }),
  );

  /**
   * Step through action replay
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:step",
    withErrorHandler(async (event) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.step();
    }),
  );

  /**
   * Stop action replay
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:stop",
    withErrorHandler(async (event) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.stop();
    }),
  );

  /**
   * Get replay status
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:status",
    withErrorHandler(async (event) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.getStatus();
    }),
  );

  /**
   * Set replay speed
   * @param {number} speed - Speed multiplier
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:setSpeed",
    withErrorHandler(async (event, speed) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      replay.setSpeed(speed);
      return { success: true, speed };
    }),
  );

  // ==================== Phase 7: Safe Mode (v0.33.0) ====================

  /**
   * Check permission for action
   * @param {string} actionType - Action type
   * @param {Object} params - Action params
   * @param {Object} context - Context info
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:checkPermission",
    withErrorHandler(async (event, actionType, params = {}, context = {}) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      return safeMode.checkPermission(actionType, params, context);
    }),
  );

  /**
   * Set safe mode level
   * @param {string} level - Safety level
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:setLevel",
    withErrorHandler(async (event, level) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      safeMode.setLevel(level);
      return { success: true, level };
    }),
  );

  /**
   * Enable/disable safe mode
   * @param {boolean} enabled
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:setEnabled",
    withErrorHandler(async (event, enabled) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      safeMode.setEnabled(enabled);
      return { success: true, enabled };
    }),
  );

  /**
   * Get safe mode config
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:getConfig",
    withErrorHandler(async (event) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      return safeMode.getConfig();
    }),
  );

  /**
   * Update safe mode config
   * @param {Object} updates - Config updates
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:updateConfig",
    withErrorHandler(async (event, updates) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      safeMode.updateConfig(updates);
      return safeMode.getConfig();
    }),
  );

  /**
   * Respond to confirmation request
   * @param {string} confirmationId - Confirmation ID
   * @param {boolean} approved - Whether approved
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:respond",
    withErrorHandler(async (event, confirmationId, approved) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      return safeMode.respondToConfirmation(confirmationId, approved);
    }),
  );

  /**
   * Get pending confirmations
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:safeMode:getPending",
    withErrorHandler(async (event) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      return safeMode.getPendingConfirmations();
    }),
  );

  // ==================== Phase 7: Workflow Engine (v0.33.0) ====================

  /**
   * Create workflow
   * @param {Object} definition - Workflow definition
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:workflow:create",
    withErrorHandler(async (event, definition) => {
      const { getWorkflowEngine } = require("./actions");
      const engine = _getBrowserEngine();
      const workflow = getWorkflowEngine(engine);
      return workflow.createWorkflow(definition);
    }),
  );

  /**
   * Execute workflow
   * @param {string} workflowId - Workflow ID
   * @param {Object} options - Execution options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:workflow:execute",
    withErrorHandler(async (event, workflowId, options = {}) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.execute(workflowId, options);
    }),
  );

  /**
   * Pause workflow
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:workflow:pause",
    withErrorHandler(async (event) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.pause();
    }),
  );

  /**
   * Resume workflow
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:workflow:resume",
    withErrorHandler(async (event) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.resume();
    }),
  );

  /**
   * Cancel workflow
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:workflow:cancel",
    withErrorHandler(async (event) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.cancel();
    }),
  );

  /**
   * Get workflow status
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:workflow:status",
    withErrorHandler(async (event) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.getStatus();
    }),
  );

  /**
   * List workflows
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:workflow:list",
    withErrorHandler(async (event) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.listWorkflows();
    }),
  );

  /**
   * Get workflow details
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:workflow:get",
    withErrorHandler(async (event, workflowId) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.getWorkflow(workflowId);
    }),
  );

  /**
   * Delete workflow
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:workflow:delete",
    withErrorHandler(async (event, workflowId) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.deleteWorkflow(workflowId);
    }),
  );

  /**
   * Save workflow to file
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:workflow:save",
    withErrorHandler(async (event, workflowId) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.saveWorkflow(workflowId);
    }),
  );

  /**
   * Load workflow from file
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:workflow:load",
    withErrorHandler(async (event, workflowId) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.loadWorkflow(workflowId);
    }),
  );

  // ==================== Phase 8: Element Highlighter (v0.33.0) ====================

  /**
   * Highlight element by bounds
   * @param {string} targetId - Tab ID
   * @param {Object} bounds - Element bounds { x, y, width, height }
   * @param {Object} options - Highlight options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:bounds",
    withErrorHandler(async (event, targetId, bounds, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.highlightBounds(targetId, bounds, options);
    }),
  );

  /**
   * Highlight element by selector
   * @param {string} targetId - Tab ID
   * @param {string} selector - CSS selector
   * @param {Object} options - Highlight options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:selector",
    withErrorHandler(async (event, targetId, selector, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.highlightSelector(targetId, selector, options);
    }),
  );

  /**
   * Highlight element by ref
   * @param {string} targetId - Tab ID
   * @param {string} ref - Element ref
   * @param {Object} options - Highlight options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:ref",
    withErrorHandler(async (event, targetId, ref, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.highlightRef(targetId, ref, options);
    }),
  );

  /**
   * Show click highlight
   * @param {string} targetId - Tab ID
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {Object} options - Highlight options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:click",
    withErrorHandler(async (event, targetId, x, y, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.showClickHighlight(targetId, x, y, options);
    }),
  );

  /**
   * Draw path on page
   * @param {string} targetId - Tab ID
   * @param {Array} points - Path points [{ x, y }, ...]
   * @param {Object} options - Draw options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:path",
    withErrorHandler(async (event, targetId, points, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.drawPath(targetId, points, options);
    }),
  );

  /**
   * Show annotation
   * @param {string} targetId - Tab ID
   * @param {string} text - Annotation text
   * @param {Object} position - Position { x, y }
   * @param {Object} options - Annotation options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:annotate",
    withErrorHandler(async (event, targetId, text, position, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.showAnnotation(targetId, text, position, options);
    }),
  );

  /**
   * Clear all highlights
   * @param {string} targetId - Tab ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:clear",
    withErrorHandler(async (event, targetId) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.clearHighlights(targetId);
    }),
  );

  /**
   * Get active highlights
   * @param {string} targetId - Tab ID
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:highlight:list",
    withErrorHandler(async (event, targetId) => {
      const { getElementHighlighter } = require("./actions");
      const highlighter = getElementHighlighter();
      return highlighter.getActiveHighlights(targetId);
    }),
  );

  // ==================== Phase 8: Template Actions (v0.33.0) ====================

  /**
   * List available templates
   * @param {string} category - Template category (optional)
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:template:list",
    withErrorHandler(async (event, category = null) => {
      const { getTemplateActions } = require("./actions");
      const engine = _getBrowserEngine();
      const templates = getTemplateActions(engine);
      return templates.listTemplates(category);
    }),
  );

  /**
   * Get template details
   * @param {string} templateId - Template ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:template:get",
    withErrorHandler(async (event, templateId) => {
      const { getTemplateActions } = require("./actions");
      const templates = getTemplateActions();
      return templates.getTemplate(templateId);
    }),
  );

  /**
   * Execute template
   * @param {string} targetId - Tab ID
   * @param {string} templateId - Template ID
   * @param {Object} params - Template parameters
   * @param {Object} options - Execution options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:template:execute",
    withErrorHandler(
      async (event, targetId, templateId, params = {}, options = {}) => {
        const { getTemplateActions } = require("./actions");
        const engine = _getBrowserEngine();
        const templates = getTemplateActions(engine);
        return templates.executeTemplate(targetId, templateId, params, options);
      },
    ),
  );

  /**
   * Register custom template
   * @param {Object} template - Template definition
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:template:register",
    withErrorHandler(async (event, template) => {
      const { getTemplateActions } = require("./actions");
      const templates = getTemplateActions();
      return templates.registerTemplate(template);
    }),
  );

  /**
   * Unregister template
   * @param {string} templateId - Template ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:template:unregister",
    withErrorHandler(async (event, templateId) => {
      const { getTemplateActions } = require("./actions");
      const templates = getTemplateActions();
      return templates.unregisterTemplate(templateId);
    }),
  );

  /**
   * Validate template parameters
   * @param {string} templateId - Template ID
   * @param {Object} params - Parameters to validate
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:template:validate",
    withErrorHandler(async (event, templateId, params) => {
      const { getTemplateActions } = require("./actions");
      const templates = getTemplateActions();
      return templates.validateParams(templateId, params);
    }),
  );

  /**
   * Get template categories
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:template:categories",
    withErrorHandler(async (event) => {
      const { getTemplateActions, TemplateCategory } = require("./actions");
      return Object.values(TemplateCategory);
    }),
  );

  // ==================== Phase 8: Metrics Collection (v0.33.0) ====================

  /**
   * Record operation metric
   * @param {Object} data - Operation data
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:record",
    withErrorHandler(async (event, data) => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.recordOperation(data);
    }),
  );

  /**
   * Get session statistics
   * @param {string} sessionId - Session ID (optional)
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:sessionStats",
    withErrorHandler(async (event, sessionId = null) => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.getSessionStats(sessionId);
    }),
  );

  /**
   * Get operation type statistics
   * @param {string} timeRange - Time range (hour/day/week/month/all)
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:typeStats",
    withErrorHandler(async (event, timeRange = "day") => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.getTypeStats(timeRange);
    }),
  );

  /**
   * Get error statistics
   * @param {string} timeRange - Time range
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:errorStats",
    withErrorHandler(async (event, timeRange = "day") => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.getErrorStats(timeRange);
    }),
  );

  /**
   * Get performance metrics
   * @param {string} timeRange - Time range
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:performance",
    withErrorHandler(async (event, timeRange = "day") => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.getPerformanceMetrics(timeRange);
    }),
  );

  /**
   * Get time series data
   * @param {string} metricName - Metric name
   * @param {string} timeRange - Time range
   * @param {string} granularity - Data granularity (minute/hour/day)
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:metrics:timeSeries",
    withErrorHandler(
      async (event, metricName, timeRange = "day", granularity = "hour") => {
        const { getComputerUseMetrics } = require("./actions");
        const metrics = getComputerUseMetrics();
        return metrics.getTimeSeries(metricName, timeRange, granularity);
      },
    ),
  );

  /**
   * Get overall summary
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:summary",
    withErrorHandler(async (event) => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.getSummary();
    }),
  );

  /**
   * Export metrics
   * @param {string} format - Export format (json/csv)
   * @param {Object} options - Export options
   * @returns {Promise<string>}
   */
  _ipcMain.handle(
    "browser:metrics:export",
    withErrorHandler(async (event, format = "json", options = {}) => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.export(format, options);
    }),
  );

  /**
   * Reset metrics
   * @param {boolean} confirm - Confirmation flag
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:reset",
    withErrorHandler(async (event, confirm = false) => {
      if (!confirm) {
        return {
          success: false,
          message: "Confirmation required to reset metrics",
        };
      }
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.reset();
    }),
  );

  // ==================== Phase 9: Smart Element Detection (v0.33.0) ====================

  /**
   * Detect element using smart strategies
   * @param {string} targetId - Tab ID
   * @param {Object} query - Element query
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:detect:element",
    withErrorHandler(async (event, targetId, query) => {
      const { getSmartElementDetector } = require("./actions");
      const engine = _getBrowserEngine();
      const detector = getSmartElementDetector(engine);
      return detector.detect(targetId, query);
    }),
  );

  /**
   * Detect multiple elements
   * @param {string} targetId - Tab ID
   * @param {Array} queries - Element queries
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:detect:multiple",
    withErrorHandler(async (event, targetId, queries) => {
      const { getSmartElementDetector } = require("./actions");
      const engine = _getBrowserEngine();
      const detector = getSmartElementDetector(engine);
      return detector.detectMultiple(targetId, queries);
    }),
  );

  /**
   * Wait for element to appear
   * @param {string} targetId - Tab ID
   * @param {Object} query - Element query
   * @param {Object} options - Wait options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:detect:waitFor",
    withErrorHandler(async (event, targetId, query, options = {}) => {
      const { getSmartElementDetector } = require("./actions");
      const engine = _getBrowserEngine();
      const detector = getSmartElementDetector(engine);
      return detector.waitFor(targetId, query, options);
    }),
  );

  /**
   * Get detector statistics
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:detect:stats",
    withErrorHandler(async (event) => {
      const { getSmartElementDetector } = require("./actions");
      const detector = getSmartElementDetector();
      return detector.getStats();
    }),
  );

  /**
   * Clear detector cache
   * @param {string} targetId - Tab ID (optional)
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:detect:clearCache",
    withErrorHandler(async (event, targetId = null) => {
      const { getSmartElementDetector } = require("./actions");
      const detector = getSmartElementDetector();
      detector.clearCache(targetId);
      return { success: true };
    }),
  );

  // ==================== Phase 9: Error Recovery (v0.33.0) ====================

  /**
   * Execute operation with auto recovery
   * @param {string} targetId - Tab ID
   * @param {Object} operation - Operation config
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recovery:execute",
    withErrorHandler(async (event, targetId, operation) => {
      const { getErrorRecoveryManager } = require("./actions");
      const engine = _getBrowserEngine();
      const recovery = getErrorRecoveryManager(engine);

      // Create operation function based on config
      const operationFn = async () => {
        // This would be replaced with actual operation logic
        return engine.act(
          targetId,
          operation.action,
          operation.ref,
          operation.options,
        );
      };

      return recovery.executeWithRecovery(operationFn, [], {
        targetId,
        ...operation,
      });
    }),
  );

  /**
   * Manual recovery action
   * @param {string} targetId - Tab ID
   * @param {string} strategy - Recovery strategy
   * @param {Object} context - Context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recovery:manual",
    withErrorHandler(async (event, targetId, strategy, context = {}) => {
      const { getErrorRecoveryManager } = require("./actions");
      const engine = _getBrowserEngine();
      const recovery = getErrorRecoveryManager(engine);
      return recovery.manualRecover(targetId, strategy, context);
    }),
  );

  /**
   * Get recovery statistics
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recovery:stats",
    withErrorHandler(async (event) => {
      const { getErrorRecoveryManager } = require("./actions");
      const recovery = getErrorRecoveryManager();
      return recovery.getStats();
    }),
  );

  /**
   * Get recovery history
   * @param {number} limit - History limit
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:recovery:history",
    withErrorHandler(async (event, limit = 50) => {
      const { getErrorRecoveryManager } = require("./actions");
      const recovery = getErrorRecoveryManager();
      return recovery.getHistory(limit);
    }),
  );

  /**
   * Set recovery strategies for error type
   * @param {string} errorType - Error type
   * @param {Array} strategies - Strategies
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recovery:setStrategies",
    withErrorHandler(async (event, errorType, strategies) => {
      const { getErrorRecoveryManager } = require("./actions");
      const recovery = getErrorRecoveryManager();
      recovery.setStrategies(errorType, strategies);
      return { success: true };
    }),
  );

  // ==================== Phase 9: Context Memory (v0.33.0) ====================

  /**
   * Save page state
   * @param {string} url - Page URL
   * @param {Object} state - Page state
   * @param {Object} options - Options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:savePageState",
    withErrorHandler(async (event, url, state, options = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.savePageState(url, state, options);
    }),
  );

  /**
   * Get page state
   * @param {string} key - Page key
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:getPageState",
    withErrorHandler(async (event, key) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.getPageState(key);
    }),
  );

  /**
   * Save element location
   * @param {Object} query - Element query
   * @param {Object} location - Location info
   * @param {Object} context - Context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:saveElement",
    withErrorHandler(async (event, query, location, context = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.saveElementLocation(query, location, context);
    }),
  );

  /**
   * Get element location
   * @param {Object} query - Element query
   * @param {Object} context - Context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:getElement",
    withErrorHandler(async (event, query, context = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.getElementLocation(query, context);
    }),
  );

  /**
   * Record operation
   * @param {string} contextKey - Context key
   * @param {Object} operation - Operation
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:recordOperation",
    withErrorHandler(async (event, contextKey, operation) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.recordOperation(contextKey, operation);
    }),
  );

  /**
   * Get operation sequence
   * @param {string} contextKey - Context key
   * @param {Object} options - Options
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:memory:getOperations",
    withErrorHandler(async (event, contextKey, options = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.getOperationSequence(contextKey, options);
    }),
  );

  /**
   * Save form data
   * @param {string} formId - Form ID
   * @param {Object} data - Form data
   * @param {Object} context - Context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:saveForm",
    withErrorHandler(async (event, formId, data, context = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.saveFormData(formId, data, context);
    }),
  );

  /**
   * Get form data
   * @param {string} formId - Form ID
   * @param {Object} context - Context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:getForm",
    withErrorHandler(async (event, formId, context = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.getFormData(formId, context);
    }),
  );

  /**
   * Get memory statistics
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:stats",
    withErrorHandler(async (event) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.getStats();
    }),
  );

  /**
   * Cleanup expired entries
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:cleanup",
    withErrorHandler(async (event) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.cleanup();
    }),
  );

  /**
   * Clear all memory
   * @param {boolean} confirm - Confirmation flag
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:clear",
    withErrorHandler(async (event, confirm = false) => {
      if (!confirm) {
        return {
          success: false,
          message: "Confirmation required to clear memory",
        };
      }
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      memory.clear();
      return { success: true };
    }),
  );

  /**
   * Export memory data
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:export",
    withErrorHandler(async (event) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.export();
    }),
  );

  /**
   * Import memory data
   * @param {Object} data - Data to import
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:import",
    withErrorHandler(async (event, data) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      memory.import(data);
      return { success: true };
    }),
  );

  // ============================================
  // Phase 10: AutomationPolicy IPC Handlers
  // ============================================

  /**
   * Check if action is allowed by policy
   * @param {Object} context - Action context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:check",
    withErrorHandler(async (event, context) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return await policy.check(context);
    }),
  );

  /**
   * Add a policy
   * @param {Object} policyConfig - Policy configuration
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:add",
    withErrorHandler(async (event, policyConfig) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.addPolicy(policyConfig);
    }),
  );

  /**
   * Remove a policy
   * @param {string} policyId - Policy ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:remove",
    withErrorHandler(async (event, policyId) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.removePolicy(policyId);
    }),
  );

  /**
   * Update a policy
   * @param {string} policyId - Policy ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:update",
    withErrorHandler(async (event, policyId, updates) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.updatePolicy(policyId, updates);
    }),
  );

  /**
   * List all policies
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:policy:list",
    withErrorHandler(async () => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.list();
    }),
  );

  /**
   * Get policy by ID
   * @param {string} policyId - Policy ID
   * @returns {Promise<Object|null>}
   */
  _ipcMain.handle(
    "browser:policy:get",
    withErrorHandler(async (event, policyId) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.get(policyId);
    }),
  );

  /**
   * Get policy violations
   * @param {number} limit - Maximum number of violations
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:policy:violations",
    withErrorHandler(async (event, limit = 50) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.getViolations(limit);
    }),
  );

  /**
   * Get policy stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:stats",
    withErrorHandler(async () => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.getStats();
    }),
  );

  /**
   * Export policies
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:export",
    withErrorHandler(async () => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.export();
    }),
  );

  /**
   * Import policies
   * @param {Object} data - Import data
   * @param {boolean} merge - Whether to merge with existing
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:import",
    withErrorHandler(async (event, data, merge = false) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.import(data, merge);
    }),
  );

  // ============================================
  // Phase 10: ScreenAnalyzer IPC Handlers
  // ============================================

  /**
   * Analyze screen
   * @param {string} targetId - Tab ID
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:analyze",
    withErrorHandler(async (event, targetId, options = {}) => {
      const engine = getBrowserEngine();
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer(engine);
      return await analyzer.analyze(targetId, options);
    }),
  );

  /**
   * Find regions matching criteria
   * @param {string} targetId - Tab ID
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:findRegions",
    withErrorHandler(async (event, targetId, criteria = {}) => {
      const engine = getBrowserEngine();
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer(engine);
      return await analyzer.findRegions(targetId, criteria);
    }),
  );

  /**
   * Capture a region screenshot
   * @param {string} targetId - Tab ID
   * @param {Object} bounds - Region bounds
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:captureRegion",
    withErrorHandler(async (event, targetId, bounds) => {
      const engine = getBrowserEngine();
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer(engine);
      return await analyzer.captureRegion(targetId, bounds);
    }),
  );

  /**
   * Compare two analyses
   * @param {Object} before - Previous analysis
   * @param {Object} after - Current analysis
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:compare",
    withErrorHandler(async (event, before, after) => {
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer();
      return analyzer.compare(before, after);
    }),
  );

  /**
   * Clear analyzer cache
   * @param {string} targetId - Tab ID (optional)
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:clearCache",
    withErrorHandler(async (event, targetId = null) => {
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer();
      analyzer.clearCache(targetId);
      return { success: true };
    }),
  );

  /**
   * Get analyzer stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:stats",
    withErrorHandler(async () => {
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer();
      return analyzer.getStats();
    }),
  );

  // ============================================
  // Phase 10: ActionSuggestion IPC Handlers
  // ============================================

  /**
   * Get action suggestions
   * @param {Object} context - Current context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:suggest",
    withErrorHandler(async (event, context) => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      return await suggestion.suggest(context);
    }),
  );

  /**
   * Record an action
   * @param {Object} action - Action to record
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:recordAction",
    withErrorHandler(async (event, action) => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      suggestion.recordAction(action);
      return { success: true };
    }),
  );

  /**
   * Provide feedback on a suggestion
   * @param {Object} suggestionData - Suggestion that was used
   * @param {boolean} accepted - Whether it was accepted
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:feedback",
    withErrorHandler(async (event, suggestionData, accepted) => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      suggestion.feedback(suggestionData, accepted);
      return { success: true };
    }),
  );

  /**
   * Get suggestion history
   * @param {number} limit - Maximum items
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:suggestion:history",
    withErrorHandler(async (event, limit = 20) => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      return suggestion.getHistory(limit);
    }),
  );

  /**
   * Get suggestion stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:stats",
    withErrorHandler(async () => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      return suggestion.getStats();
    }),
  );

  /**
   * Clear suggestion history
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:clearHistory",
    withErrorHandler(async () => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      suggestion.clearHistory();
      return { success: true };
    }),
  );

  /**
   * Clear learned patterns
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:clearPatterns",
    withErrorHandler(async () => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      suggestion.clearLearnedPatterns();
      return { success: true };
    }),
  );

  /**
   * Export suggestion data
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:export",
    withErrorHandler(async () => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      return suggestion.export();
    }),
  );

  /**
   * Import suggestion data
   * @param {Object} data - Data to import
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:import",
    withErrorHandler(async (event, data) => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      return suggestion.import(data);
    }),
  );

  // ============================================
  // Phase 11: ClipboardManager IPC Handlers
  // ============================================

  /**
   * Copy text to clipboard
   * @param {string} text - Text to copy
   * @param {Object} options - Copy options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:copyText",
    withErrorHandler(async (event, text, options = {}) => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return clipboard.copyText(text, options);
    }),
  );

  /**
   * Copy HTML to clipboard
   * @param {string} html - HTML content
   * @param {string} fallbackText - Fallback text
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:copyHTML",
    withErrorHandler(async (event, html, fallbackText = "") => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return clipboard.copyHTML(html, fallbackText);
    }),
  );

  /**
   * Copy image to clipboard
   * @param {string|Buffer} imageData - Image data
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:copyImage",
    withErrorHandler(async (event, imageData) => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return clipboard.copyImage(imageData);
    }),
  );

  /**
   * Copy from page element
   * @param {string} targetId - Tab ID
   * @param {string} selector - Element selector
   * @param {Object} options - Options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:copyFromElement",
    withErrorHandler(async (event, targetId, selector, options = {}) => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return await clipboard.copyFromElement(targetId, selector, options);
    }),
  );

  /**
   * Read clipboard content
   * @param {string} type - Content type
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:read",
    withErrorHandler(async (event, type = null) => {
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager();
      return clipboard.read(type);
    }),
  );

  /**
   * Paste to page element
   * @param {string} targetId - Tab ID
   * @param {string} selector - Element selector
   * @param {Object} options - Options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:pasteToElement",
    withErrorHandler(async (event, targetId, selector, options = {}) => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return await clipboard.pasteToElement(targetId, selector, options);
    }),
  );

  /**
   * Simulate keyboard paste
   * @param {string} targetId - Tab ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:simulatePaste",
    withErrorHandler(async (event, targetId) => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return await clipboard.simulatePaste(targetId);
    }),
  );

  /**
   * Clear clipboard
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:clear",
    withErrorHandler(async () => {
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager();
      return clipboard.clear();
    }),
  );

  /**
   * Get clipboard history
   * @param {number} limit - Maximum items
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:clipboard:history",
    withErrorHandler(async (event, limit = 20) => {
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager();
      return clipboard.getHistory(limit);
    }),
  );

  /**
   * Get clipboard stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:stats",
    withErrorHandler(async () => {
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager();
      return clipboard.getStats();
    }),
  );

  // ============================================
  // Phase 11: FileHandler IPC Handlers
  // ============================================

  /**
   * Start a download
   * @param {string} targetId - Tab ID
   * @param {string} url - Download URL
   * @param {Object} options - Download options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:download",
    withErrorHandler(async (event, targetId, url, options = {}) => {
      const engine = getBrowserEngine();
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler(engine);
      return await handler.startDownload(targetId, url, options);
    }),
  );

  /**
   * Cancel a download
   * @param {string} downloadId - Download ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:cancelDownload",
    withErrorHandler(async (event, downloadId) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.cancelDownload(downloadId);
    }),
  );

  /**
   * Get download status
   * @param {string} downloadId - Download ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:getDownload",
    withErrorHandler(async (event, downloadId) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.getDownload(downloadId);
    }),
  );

  /**
   * List downloads
   * @param {Object} filter - Filter options
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:file:listDownloads",
    withErrorHandler(async (event, filter = {}) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.listDownloads(filter);
    }),
  );

  /**
   * Record an upload
   * @param {string} targetId - Tab ID
   * @param {string} selector - Upload element selector
   * @param {Array} files - File info list
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:recordUpload",
    withErrorHandler(async (event, targetId, selector, files) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.recordUpload(targetId, selector, files);
    }),
  );

  /**
   * Get upload history
   * @param {number} limit - Maximum items
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:file:getUploads",
    withErrorHandler(async (event, limit = 20) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.getUploads(limit);
    }),
  );

  /**
   * Validate a file
   * @param {string} filePath - File path
   * @param {Object} rules - Validation rules
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:validate",
    withErrorHandler(async (event, filePath, rules = {}) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.validateFile(filePath, rules);
    }),
  );

  /**
   * Get file info
   * @param {string} filePath - File path
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:info",
    withErrorHandler(async (event, filePath) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.getFileInfo(filePath);
    }),
  );

  /**
   * Get file handler stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:stats",
    withErrorHandler(async () => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.getStats();
    }),
  );

  /**
   * Set download directory
   * @param {string} dir - Directory path
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:setDownloadDir",
    withErrorHandler(async (event, dir) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.setDownloadDir(dir);
    }),
  );

  // ============================================
  // Phase 11: NotificationManager IPC Handlers
  // ============================================

  /**
   * Send a notification
   * @param {Object} options - Notification options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:notify",
    withErrorHandler(async (event, options) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.notify(options);
    }),
  );

  /**
   * Send notification from template
   * @param {string} templateId - Template ID
   * @param {Object} data - Data for template
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:fromTemplate",
    withErrorHandler(async (event, templateId, data = {}) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.notifyFromTemplate(templateId, data);
    }),
  );

  /**
   * Dismiss a notification
   * @param {string} notificationId - Notification ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:dismiss",
    withErrorHandler(async (event, notificationId) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.dismiss(notificationId);
    }),
  );

  /**
   * Dismiss all notifications
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:dismissAll",
    withErrorHandler(async () => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.dismissAll();
    }),
  );

  /**
   * Mark notification as read
   * @param {string} notificationId - Notification ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:markRead",
    withErrorHandler(async (event, notificationId) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.markAsRead(notificationId);
    }),
  );

  /**
   * Mark all notifications as read
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:markAllRead",
    withErrorHandler(async () => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.markAllAsRead();
    }),
  );

  /**
   * Get notification history
   * @param {Object} filter - Filter options
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:notification:history",
    withErrorHandler(async (event, filter = {}) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.getHistory(filter);
    }),
  );

  /**
   * Get unread count
   * @returns {Promise<number>}
   */
  _ipcMain.handle(
    "browser:notification:unreadCount",
    withErrorHandler(async () => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.getUnreadCount();
    }),
  );

  /**
   * Get notification templates
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:templates",
    withErrorHandler(async () => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.getTemplates();
    }),
  );

  /**
   * Register a notification template
   * @param {string} templateId - Template ID
   * @param {Object} template - Template config
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:registerTemplate",
    withErrorHandler(async (event, templateId, template) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.registerTemplate(templateId, template);
    }),
  );

  /**
   * Set quiet hours
   * @param {number} start - Start hour
   * @param {number} end - End hour
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:setQuietHours",
    withErrorHandler(async (event, start, end) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.setQuietHours(start, end);
    }),
  );

  /**
   * Get notification stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:stats",
    withErrorHandler(async () => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.getStats();
    }),
  );

  logger.info(
    "[Browser IPC] All Browser IPC handlers registered (Phase 1-11, including Computer Use, Audit, Recording, Replay, SafeMode, Workflow, Highlight, Templates, Metrics, Detection, Recovery, Memory, Policy, Analyzer, Suggestion, Clipboard, Files, and Notifications)",
  );
}

/**
 * 清理资源
 */
async function cleanupBrowser() {
  if (browserEngine) {
    try {
      await browserEngine.cleanup();
      logger.info("[Browser] Cleanup completed");
    } catch (error) {
      logger.error("[Browser] Cleanup error", { error: error.message });
    }
  }

  // Cleanup workflow and recording systems
  try {
    const { cleanupWorkflowSystem } = require("./workflow");
    cleanupWorkflowSystem();
  } catch (e) {
    /* Workflow module may not be loaded */
  }

  try {
    const { cleanupRecordingSystem } = require("./recording");
    cleanupRecordingSystem();
  } catch (e) {
    /* Recording module may not be loaded */
  }
}

module.exports = {
  registerBrowserIPC,
  getBrowserEngine,
  cleanupBrowser,
};
