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
const { registerCoreHandlers } = require("./browser-ipc-core");
const { registerAutomationHandlers } = require("./browser-ipc-automation");
const { registerComputerUseHandlers } = require("./browser-ipc-computer-use");
const { registerWorkflowHandlers } = require("./browser-ipc-workflow");
const { registerEnhancementHandlers } = require("./browser-ipc-enhancement");
const { registerPolicyHandlers } = require("./browser-ipc-policy");
const { registerSystemHandlers } = require("./browser-ipc-system");
const {
  registerSessionConsoleHandlers,
} = require("./browser-ipc-session-console");

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

  const ctx = {
    _ipcMain,
    _getBrowserEngine,
    _getAutomationAgent,
    withErrorHandler,
    getBrowserEngine,
  };

  registerCoreHandlers(ctx);
  registerAutomationHandlers(ctx);
  registerComputerUseHandlers(ctx);
  registerWorkflowHandlers(ctx);
  registerEnhancementHandlers(ctx);
  registerPolicyHandlers(ctx);
  registerSystemHandlers(ctx);
  registerSessionConsoleHandlers(ctx);

  logger.info(
    "[Browser IPC] All Browser IPC handlers registered (Phase 1-13, including Computer Use, Audit, Recording, Replay, SafeMode, Workflow, Highlight, Templates, Metrics, Detection, Recovery, Memory, Policy, Analyzer, Suggestion, Clipboard, Files, Notifications, Session, and Console)",
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
