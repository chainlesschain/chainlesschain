/**
 * LLM服务 IPC 处理器
 * 负责处理 LLM 相关的前后端通信
 *
 * @module llm-ipc
 * @description 提供 LLM 服务的所有 IPC 接口，包括聊天、查询、配置管理、智能选择等
 */

const defaultIpcGuard = require("../ipc/ipc-guard");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");

/**
 * 🔥 检测任务类型（用于 Multi-Agent 路由）
 * @param {string} content - 用户消息内容
 * @returns {string} 任务类型
 */
function detectTaskType(content) {
  if (!content || typeof content !== "string") {
    return "general";
  }

  // 代码相关任务
  if (
    /写代码|编写|实现|代码|函数|class|function|重构|优化代码|bug|修复|调试/i.test(
      content,
    ) ||
    /```|代码块/.test(content)
  ) {
    return "code_generation";
  }

  // 数据分析任务
  if (
    /分析数据|统计|图表|可视化|趋势|预测|数据集|excel|csv|json.*数据/i.test(
      content,
    )
  ) {
    return "data_analysis";
  }

  // 文档相关任务
  if (/写文档|文档|翻译|摘要|总结|格式化|markdown|报告|文章/i.test(content)) {
    return "document";
  }

  // 知识问答
  if (/什么是|如何|怎么|为什么|解释|介绍|告诉我/i.test(content)) {
    return "knowledge_qa";
  }

  return "general";
}

/**
 * 注册所有 LLM IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.llmManager - LLM 管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} [dependencies.ragManager] - RAG 管理器（可选，用于RAG增强）
 * @param {Object} [dependencies.promptTemplateManager] - 提示词模板管理器（可选）
 * @param {Object} [dependencies.llmSelector] - LLM 智能选择器（可选）
 * @param {Object} [dependencies.database] - 数据库实例（可选）
 * @param {Object} [dependencies.app] - App 实例（可选，用于更新 llmManager 引用）
 * @param {Object} [dependencies.tokenTracker] - Token 追踪器（可选）
 * @param {Object} [dependencies.promptCompressor] - Prompt 压缩器（可选）
 * @param {Object} [dependencies.responseCache] - 响应缓存（可选）
 * @param {Object} [dependencies.ipcMain] - IPC主进程对象（可选，用于测试注入）
 * @param {Object} [dependencies.mcpClientManager] - MCP 客户端管理器（可选，用于MCP工具调用）
 * @param {Object} [dependencies.mcpToolAdapter] - MCP 工具适配器（可选，用于MCP工具调用）
 * @param {Object} [dependencies.sessionManager] - 会话管理器（可选，用于自动会话追踪）
 * @param {Object} [dependencies.agentOrchestrator] - Agent 协调器（可选，用于Multi-Agent路由）
 * @param {Object} [dependencies.errorMonitor] - 错误监控器（可选，用于AI诊断）
 */
const { registerCoreHandlers } = require("./llm-ipc-core");
const { registerSelectorHandlers } = require("./llm-ipc-selector");
const { registerStreamHandlers } = require("./llm-ipc-stream");
const { registerTokenHandlers } = require("./llm-ipc-token");
const { registerAlertHandlers } = require("./llm-ipc-alert");
const { registerBudgetHandlers } = require("./llm-ipc-budgets");
const { registerRetentionHandlers } = require("./llm-ipc-retention");
const { registerTestDataHandlers } = require("./llm-ipc-test-data");

function registerLLMIPC({
  llmManager,
  mainWindow,
  ragManager,
  promptTemplateManager,
  llmSelector,
  database,
  app,
  tokenTracker,
  promptCompressor,
  responseCache,
  ipcMain: injectedIpcMain,
  mcpClientManager,
  mcpToolAdapter,
  // 🔥 新增：高级特性依赖
  sessionManager,
  agentOrchestrator,
  errorMonitor,
  // 依赖注入支持（用于测试）
  ipcGuard: injectedIpcGuard,
}) {
  // 支持依赖注入，用于测试
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;
  const privacy = createLlmIpcPrivacy("bootstrap");

  // 防止重复注册
  if (ipcGuard.isModuleRegistered("llm-ipc")) {
    privacy.event("handlers-already-registered");
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  privacy.event("handlers-registering");

  // 🔥 在测试模式下，如果 llmManager 为 null，创建 Mock LLM 服务
  let effectiveManager = llmManager;
  const isTestMode =
    process.env.NODE_ENV === "test" && process.env.MOCK_LLM === "true";

  if (isTestMode && !effectiveManager) {
    privacy.event("mock-service-create-started");
    try {
      const { getTestModeConfig } = require("../config/test-mode-config");
      const testModeConfig = getTestModeConfig();
      effectiveManager = testModeConfig.getMockLLMService();
      privacy.event("mock-service-created");
    } catch {
      privacy.event("mock-service-create-failed");
    }
  }

  // 创建一个可变的引用容器
  const managerRef = { current: effectiveManager };

  const ctx = {
    ipcMain,
    managerRef,
    detectTaskType,
    isTestMode,
    llmManager,
    mainWindow,
    ragManager,
    promptTemplateManager,
    llmSelector,
    database,
    app,
    tokenTracker,
    promptCompressor,
    responseCache,
    mcpClientManager,
    mcpToolAdapter,
    sessionManager,
    agentOrchestrator,
    errorMonitor,
  };

  registerCoreHandlers(ctx);
  registerSelectorHandlers(ctx);
  registerStreamHandlers(ctx);
  registerTokenHandlers(ctx);
  registerAlertHandlers(ctx);
  registerBudgetHandlers(ctx);
  registerRetentionHandlers(ctx);
  registerTestDataHandlers(ctx);

  // 标记模块为已注册
  ipcGuard.markModuleRegistered("llm-ipc");

  privacy.event("handlers-registered");
}

module.exports = {
  registerLLMIPC,
};
