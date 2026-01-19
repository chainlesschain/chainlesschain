/**
 * 多 Agent 系统
 *
 * 基于 OpenManus 架构的多 Agent 协作系统。
 *
 * @module multi-agent
 */

const { logger, createLogger } = require('../../utils/logger.js');
const { AgentOrchestrator } = require("./agent-orchestrator");
const { SpecializedAgent } = require("./specialized-agent");
const { CodeGenerationAgent } = require("./agents/code-generation-agent");
const { DataAnalysisAgent } = require("./agents/data-analysis-agent");
const { DocumentAgent } = require("./agents/document-agent");

// 单例
let orchestratorInstance = null;

/**
 * 获取 Agent 协调器单例
 * @param {Object} options - 配置选项
 * @returns {AgentOrchestrator}
 */
function getAgentOrchestrator(options = {}) {
  if (!orchestratorInstance) {
    orchestratorInstance = new AgentOrchestrator(options);
  }
  return orchestratorInstance;
}

/**
 * 创建新的 Agent 协调器（非单例）
 * @param {Object} options - 配置选项
 * @returns {AgentOrchestrator}
 */
function createAgentOrchestrator(options = {}) {
  return new AgentOrchestrator(options);
}

/**
 * 初始化默认 Agent
 * @param {AgentOrchestrator} orchestrator - 协调器实例
 * @param {Object} options - 初始化选项
 */
function initializeDefaultAgents(orchestrator, options = {}) {
  const { llmManager, functionCaller } = options;

  // 创建默认 Agent
  const codeAgent = new CodeGenerationAgent();
  const dataAgent = new DataAnalysisAgent();
  const docAgent = new DocumentAgent();

  // 设置依赖
  if (llmManager) {
    codeAgent.setLLMManager(llmManager);
    dataAgent.setLLMManager(llmManager);
    docAgent.setLLMManager(llmManager);
  }

  if (functionCaller) {
    codeAgent.setFunctionCaller(functionCaller);
    dataAgent.setFunctionCaller(functionCaller);
    docAgent.setFunctionCaller(functionCaller);
  }

  // 注册到协调器
  orchestrator.registerAgents([codeAgent, dataAgent, docAgent]);

  logger.info("[MultiAgent] 默认 Agent 已初始化");

  return {
    codeAgent,
    dataAgent,
    docAgent,
  };
}

/**
 * 快速创建并初始化多 Agent 系统
 * @param {Object} options - 配置选项
 * @returns {Object} { orchestrator, agents }
 */
function createMultiAgentSystem(options = {}) {
  const orchestrator = createAgentOrchestrator(options);
  const agents = initializeDefaultAgents(orchestrator, options);

  return {
    orchestrator,
    agents,
  };
}

module.exports = {
  // 核心类
  AgentOrchestrator,
  SpecializedAgent,

  // 专用 Agent
  CodeGenerationAgent,
  DataAnalysisAgent,
  DocumentAgent,

  // 工厂函数
  getAgentOrchestrator,
  createAgentOrchestrator,
  initializeDefaultAgents,
  createMultiAgentSystem,
};
