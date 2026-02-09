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

  logger.info(
    "[Browser IPC] All Browser IPC handlers registered (Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5)",
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
