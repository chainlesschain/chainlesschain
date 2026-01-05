/**
 * 后续输入意图分类器 - IPC Handler
 * 提供给渲染进程调用的 IPC 接口
 */

const { ipcMain } = require('electron');
const FollowupIntentClassifier = require('./followup-intent-classifier');
const { getLogger } = require('../logger');
const logger = getLogger('FollowupIntentIPC');

let classifierInstance = null;

/**
 * 初始化分类器
 */
function initializeClassifier(llmService) {
  if (!classifierInstance) {
    classifierInstance = new FollowupIntentClassifier(llmService);
    logger.info('[初始化] 后续输入意图分类器已创建');
  }
  return classifierInstance;
}

/**
 * 注册 IPC 处理器
 */
function registerIPCHandlers(llmService) {
  // 初始化分类器
  const classifier = initializeClassifier(llmService);

  /**
   * 分类单个输入
   * @param {string} input - 用户输入
   * @param {Object} context - 上下文信息
   * @returns {Promise<Object>} 分类结果
   */
  ipcMain.handle('followup-intent:classify', async (event, { input, context = {} }) => {
    try {
      logger.info(`[分类请求] 输入: "${input}"`);

      const result = await classifier.classify(input, context);

      logger.info(`[分类结果] ${result.intent} (confidence: ${result.confidence}, method: ${result.method})`);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      logger.error('[分类失败]', error);
      return {
        success: false,
        error: error.message,
        // 降级：返回默认结果
        data: {
          intent: 'CLARIFICATION',
          confidence: 0.5,
          reason: '分类失败，默认为补充说明',
          method: 'error_fallback'
        }
      };
    }
  });

  /**
   * 批量分类
   */
  ipcMain.handle('followup-intent:classify-batch', async (event, { inputs, context = {} }) => {
    try {
      const results = await classifier.classifyBatch(inputs, context);

      return {
        success: true,
        data: results
      };
    } catch (error) {
      logger.error('[批量分类失败]', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * 获取分类器统计信息
   */
  ipcMain.handle('followup-intent:get-stats', async () => {
    try {
      const stats = classifier.getStats();

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      logger.error('[获取统计失败]', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  logger.info('[IPC注册完成] 后续输入意图分类器 IPC 处理器已注册');
}

/**
 * 获取分类器实例（用于测试）
 */
function getClassifierInstance() {
  return classifierInstance;
}

module.exports = {
  registerIPCHandlers,
  initializeClassifier,
  getClassifierInstance
};
