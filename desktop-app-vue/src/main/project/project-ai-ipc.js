/**
 * Project AI IPC 处理器
 * 负责项目 AI 功能的前后端通信
 *
 * @module project-ai-ipc
 * @description 提供 AI 对话、任务规划、代码助手、内容处理等 IPC 接口
 */
const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

const { registerChatHandlers } = require("./project-ai-ipc-chat");
const { registerPlanningHandlers } = require("./project-ai-ipc-planning");
const { registerContentHandlers } = require("./project-ai-ipc-content");
const { registerCodeHandlers } = require("./project-ai-ipc-code");
const { registerIntentHandlers } = require("./project-ai-ipc-intent");

/**
 * 注册所有 Project AI IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} dependencies.llmManager - LLM 管理器
 * @param {Object} dependencies.aiEngineManager - AI 引擎管理器
 * @param {Object} dependencies.chatSkillBridge - 聊天技能桥接器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Function} dependencies.scanAndRegisterProjectFiles - 扫描注册文件函数
 * @param {Object} [dependencies.mcpClientManager] - MCP 客户端管理器（可选，用于MCP工具调用）
 * @param {Object} [dependencies.mcpToolAdapter] - MCP 工具适配器（可选，用于MCP工具调用）
 */
function registerProjectAIIPC({
  database,
  llmManager,
  aiEngineManager,
  chatSkillBridge,
  mainWindow,
  scanAndRegisterProjectFiles,
  mcpClientManager,
  mcpToolAdapter,
}) {
  logger.info("[Project AI IPC] Registering Project AI IPC handlers...");

  const ctx = {
    ipcMain,
    database,
    llmManager,
    aiEngineManager,
    chatSkillBridge,
    mainWindow,
    scanAndRegisterProjectFiles,
    mcpClientManager,
    mcpToolAdapter,
  };

  registerChatHandlers(ctx);
  registerPlanningHandlers(ctx);
  registerContentHandlers(ctx);
  registerCodeHandlers(ctx);
  registerIntentHandlers(ctx);

  logger.info(
    "[Project AI IPC] ✓ All Project AI IPC handlers registered successfully (17 handlers)",
  );
}

module.exports = {
  registerProjectAIIPC,
};
