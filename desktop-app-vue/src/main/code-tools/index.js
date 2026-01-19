/**
 * Code Tools Module Index
 * 代码工具模块入口文件
 *
 * This module exports all IPC handler registration functions for code tools
 * and review system functionality.
 */

const { logger, createLogger } = require('../utils/logger.js');
const { registerCodeIPC } = require('./code-ipc');
const { registerReviewIPC } = require('./review-ipc');

/**
 * Register all code-tools related IPC handlers
 * @param {Object} context - Context object with required managers
 * @param {Object} context.llmManager - LLM manager instance for code operations
 * @param {Object} context.reviewManager - Review manager instance for review operations
 */
function registerAllCodeToolsIPC(context) {
  registerCodeIPC({
    llmManager: context.llmManager
  });

  registerReviewIPC({
    reviewManager: context.reviewManager
  });

  logger.info('[IPC] All code-tools IPC handlers registered (20 total)');
}

module.exports = {
  registerCodeIPC,
  registerReviewIPC,
  registerAllCodeToolsIPC
};
