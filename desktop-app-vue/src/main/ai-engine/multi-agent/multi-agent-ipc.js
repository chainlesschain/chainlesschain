/**
 * 多 Agent 系统 IPC 处理器
 *
 * 提供前端访问多 Agent 系统的接口
 */

const { logger, createLogger } = require('../../utils/logger.js');
const { ipcMain } = require("electron");
const {
  getAgentOrchestrator,
  initializeDefaultAgents,
} = require("./index");

/**
 * 注册多 Agent 系统 IPC 处理器
 * @param {Object} options - 配置选项
 */
function registerMultiAgentIPC(options = {}) {
  logger.info("[MultiAgentIPC] 注册多 Agent IPC 处理器...");

  const { llmManager, functionCaller } = options;

  // 获取或创建协调器
  let orchestrator = null;
  let initialized = false;

  const ensureInitialized = () => {
    if (!initialized) {
      orchestrator = getAgentOrchestrator();
      initializeDefaultAgents(orchestrator, { llmManager, functionCaller });
      initialized = true;
    }
    return orchestrator;
  };

  // ==========================================
  // Agent 管理 API
  // ==========================================

  /**
   * 获取所有注册的 Agent
   */
  ipcMain.handle("agent:list", async (event) => {
    try {
      const orch = ensureInitialized();
      const agents = orch.getAllAgents().map((agent) => agent.getInfo());
      return { success: true, agents };
    } catch (error) {
      logger.error("[MultiAgentIPC] 获取 Agent 列表失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取特定 Agent 信息
   */
  ipcMain.handle("agent:get", async (event, { agentId }) => {
    try {
      const orch = ensureInitialized();
      const agent = orch.getAgent(agentId);

      if (!agent) {
        return { success: false, error: `Agent 不存在: ${agentId}` };
      }

      return { success: true, agent: agent.getInfo() };
    } catch (error) {
      logger.error("[MultiAgentIPC] 获取 Agent 失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // 任务执行 API
  // ==========================================

  /**
   * 分发任务到合适的 Agent
   */
  ipcMain.handle("agent:dispatch", async (event, task) => {
    try {
      const orch = ensureInitialized();
      const result = await orch.dispatch(task);
      return { success: true, result };
    } catch (error) {
      logger.error("[MultiAgentIPC] 任务分发失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 并行执行多个任务
   */
  ipcMain.handle("agent:execute-parallel", async (event, { tasks, options = {} }) => {
    try {
      const orch = ensureInitialized();
      const results = await orch.executeParallel(tasks, options);
      return { success: true, results };
    } catch (error) {
      logger.error("[MultiAgentIPC] 并行执行失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 链式执行任务
   */
  ipcMain.handle("agent:execute-chain", async (event, { tasks }) => {
    try {
      const orch = ensureInitialized();
      const result = await orch.executeChain(tasks);
      return { success: true, result };
    } catch (error) {
      logger.error("[MultiAgentIPC] 链式执行失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取能处理特定任务的 Agent
   */
  ipcMain.handle("agent:get-capable", async (event, task) => {
    try {
      const orch = ensureInitialized();
      const capable = orch.getCapableAgents(task);
      return {
        success: true,
        agents: capable.map((c) => ({
          agentId: c.agentId,
          score: c.score,
          info: c.agent.getInfo(),
        })),
      };
    } catch (error) {
      logger.error("[MultiAgentIPC] 获取可用 Agent 失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Agent 间通信 API
  // ==========================================

  /**
   * 发送消息给特定 Agent
   */
  ipcMain.handle("agent:send-message", async (event, { fromAgent, toAgent, message }) => {
    try {
      const orch = ensureInitialized();
      const response = await orch.sendMessage(fromAgent, toAgent, message);
      return { success: true, response };
    } catch (error) {
      logger.error("[MultiAgentIPC] 发送消息失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 广播消息给所有 Agent
   */
  ipcMain.handle("agent:broadcast", async (event, { fromAgent, message }) => {
    try {
      const orch = ensureInitialized();
      const results = await orch.broadcast(fromAgent, message);
      return { success: true, results };
    } catch (error) {
      logger.error("[MultiAgentIPC] 广播失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取消息历史
   */
  ipcMain.handle("agent:get-messages", async (event, { agentId = null, limit = 50 }) => {
    try {
      const orch = ensureInitialized();
      const messages = orch.getMessageHistory(agentId, limit);
      return { success: true, messages };
    } catch (error) {
      logger.error("[MultiAgentIPC] 获取消息历史失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // 统计和调试 API
  // ==========================================

  /**
   * 获取统计信息
   */
  ipcMain.handle("agent:get-stats", async (event) => {
    try {
      const orch = ensureInitialized();
      const stats = orch.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error("[MultiAgentIPC] 获取统计失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取执行历史
   */
  ipcMain.handle("agent:get-history", async (event, { limit = 20 }) => {
    try {
      const orch = ensureInitialized();
      const history = orch.getExecutionHistory(limit);
      return { success: true, history };
    } catch (error) {
      logger.error("[MultiAgentIPC] 获取历史失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 重置统计
   */
  ipcMain.handle("agent:reset-stats", async (event) => {
    try {
      const orch = ensureInitialized();
      orch.resetStats();
      return { success: true };
    } catch (error) {
      logger.error("[MultiAgentIPC] 重置统计失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 导出调试信息
   */
  ipcMain.handle("agent:export-debug", async (event) => {
    try {
      const orch = ensureInitialized();
      const debugInfo = orch.exportDebugInfo();
      return { success: true, debugInfo };
    } catch (error) {
      logger.error("[MultiAgentIPC] 导出调试信息失败:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[MultiAgentIPC] 多 Agent IPC 处理器注册完成");
}

module.exports = { registerMultiAgentIPC };
