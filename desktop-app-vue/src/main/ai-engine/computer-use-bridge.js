/**
 * Computer Use 桥接模块
 * 连接浏览器引擎和 AI 引擎
 *
 * @module ai-engine/computer-use-bridge
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { logger } = require('../utils/logger');
const { setBrowserEngine, setLLMService, setCurrentTarget, getToolExecutor } = require('./extended-tools-computeruse');

let initialized = false;

/**
 * 初始化 Computer Use 桥接
 * 连接浏览器引擎和 LLM 服务到工具执行器
 */
async function initializeComputerUseBridge() {
  if (initialized) {
    return;
  }

  try {
    // 尝试获取浏览器引擎
    try {
      const { getBrowserEngine } = require('../browser/browser-ipc');
      const browserEngine = getBrowserEngine();
      if (browserEngine) {
        setBrowserEngine(browserEngine);
        logger.info('[ComputerUseBridge] 浏览器引擎已连接');
      }
    } catch (e) {
      logger.warn('[ComputerUseBridge] 浏览器引擎不可用:', e.message);
    }

    // 尝试获取 LLM 服务
    try {
      const { getLLMManager } = require('../llm/llm-manager');
      const llmManager = getLLMManager();
      if (llmManager) {
        setLLMService(llmManager);
        logger.info('[ComputerUseBridge] LLM 服务已连接');
      }
    } catch (e) {
      logger.warn('[ComputerUseBridge] LLM 服务不可用:', e.message);
    }

    initialized = true;
    logger.info('[ComputerUseBridge] 初始化完成');
  } catch (error) {
    logger.error('[ComputerUseBridge] 初始化失败:', error);
  }
}

/**
 * 更新当前操作的标签页
 * @param {string} targetId - 标签页 ID
 */
function updateCurrentTarget(targetId) {
  setCurrentTarget(targetId);
  logger.debug('[ComputerUseBridge] 当前标签页已更新:', targetId);
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
    currentTargetId: executor.currentTargetId
  };
}

module.exports = {
  initializeComputerUseBridge,
  updateCurrentTarget,
  getExecutor,
  getStatus
};
