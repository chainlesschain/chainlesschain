/**
 * Computer Use 桥接模块
 * 连接浏览器引擎和 AI 引擎
 *
 * @module ai-engine/computer-use-bridge
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { logger } = require("../utils/logger");
const {
  setBrowserEngine,
  setLLMService,
  setCurrentTarget,
  getToolExecutor,
} = require("./extended-tools-computeruse");

let initialized = false;

// Lazy accessors behind a _deps seam so initialization is unit-testable
// (override _deps.getBrowserEngine / _deps.getLLMManager in tests).
const _deps = {
  getBrowserEngine() {
    return require("../browser/browser-ipc").getBrowserEngine();
  },
  getLLMManager() {
    return require("../llm/llm-manager").getLLMManager();
  },
};

/**
 * 初始化 Computer Use 桥接
 * 连接浏览器引擎和 LLM 服务到工具执行器
 */
async function initializeComputerUseBridge() {
  if (initialized) {
    return;
  }

  try {
    let connected = false;

    // 尝试获取浏览器引擎
    try {
      const browserEngine = _deps.getBrowserEngine();
      if (browserEngine) {
        setBrowserEngine(browserEngine);
        connected = true;
        logger.info("[ComputerUseBridge] 浏览器引擎已连接");
      }
    } catch (e) {
      logger.warn("[ComputerUseBridge] 浏览器引擎不可用:", e.message);
    }

    // 尝试获取 LLM 服务
    try {
      const llmManager = _deps.getLLMManager();
      if (llmManager) {
        setLLMService(llmManager);
        connected = true;
        logger.info("[ComputerUseBridge] LLM 服务已连接");
      }
    } catch (e) {
      logger.warn("[ComputerUseBridge] LLM 服务不可用:", e.message);
    }

    // 仅在至少连接到一个组件时标记为已初始化；否则保持 false，使后续调用可在
    // 浏览器/LLM 就绪后重试，而不是被开头的 `if (initialized) return` 永久跳过
    // （早于组件就绪的一次失败调用会导致桥接永不连接）。
    if (connected) {
      initialized = true;
      logger.info("[ComputerUseBridge] 初始化完成");
    } else {
      logger.warn("[ComputerUseBridge] 无可用组件，保持未初始化以便后续重试");
    }
  } catch (error) {
    logger.error("[ComputerUseBridge] 初始化失败:", error);
  }
}

/**
 * 更新当前操作的标签页
 * @param {string} targetId - 标签页 ID
 */
function updateCurrentTarget(targetId) {
  setCurrentTarget(targetId);
  logger.debug("[ComputerUseBridge] 当前标签页已更新:", targetId);
}

/**
 * 获取工具执行器
 * @returns {Object}
 */
function getExecutor() {
  return getToolExecutor();
}

/**
 * 检查 Computer Use 是否可用
 * @returns {Object}
 */
function getStatus() {
  const executor = getToolExecutor();
  return {
    initialized,
    hasBrowserEngine: !!executor.browserEngine,
    hasLLMService: !!executor.llmService,
    currentTargetId: executor.currentTargetId,
  };
}

module.exports = {
  initializeComputerUseBridge,
  updateCurrentTarget,
  getExecutor,
  getStatus,
  _deps,
};
