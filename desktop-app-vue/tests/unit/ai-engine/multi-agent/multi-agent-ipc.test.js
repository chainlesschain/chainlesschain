/**
 * Multi-Agent IPC 处理器单元测试
 *
 * 测试覆盖：
 * - IPC 处理器注册
 * - Agent 管理 API (list, get)
 * - 任务执行 API (dispatch, parallel, chain)
 * - Agent 间通信 API (message, broadcast)
 * - 统计和调试 API (stats, history, debug)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock electron
const mockIpcHandlers = new Map();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel, handler) => {
      mockIpcHandlers.set(channel, handler);
    })
  }
}));

// Mock logger
vi.mock('../../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}));

// Mock multi-agent index
const mockOrchestrator = {
  getAllAgents: vi.fn(),
  getAgent: vi.fn(),
  dispatch: vi.fn(),
  executeParallel: vi.fn(),
  executeChain: vi.fn(),
  getCapableAgents: vi.fn(),
  sendMessage: vi.fn(),
  broadcast: vi.fn(),
  getMessageHistory: vi.fn(),
  getStats: vi.fn(),
  getExecutionHistory: vi.fn(),
  resetStats: vi.fn(),
  exportDebugInfo: vi.fn()
};

vi.mock('../../../../src/main/ai-engine/multi-agent/index.js', () => ({
  getAgentOrchestrator: vi.fn(() => mockOrchestrator),
  initializeDefaultAgents: vi.fn()
}));

describe('Multi-Agent IPC Handler', () => {
  let registerMultiAgentIPC;
  let mockLLMManager;
  let mockFunctionCaller;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIpcHandlers.clear();

    mockLLMManager = {
      chat: vi.fn().mockResolvedValue('LLM response')
    };

    mockFunctionCaller = {
      call: vi.fn().mockResolvedValue({ tool: 'result' })
    };

    // Import module
    const module = await import('../../../../src/main/ai-engine/multi-agent/multi-agent-ipc.js');
    registerMultiAgentIPC = module.registerMultiAgentIPC;
  });

  describe('Registration', () => {
    it('should register all IPC handlers', () => {
      const { ipcMain } = require('electron');

      registerMultiAgentIPC();

      expect(ipcMain.handle).toHaveBeenCalledTimes(13);
      expect(mockIpcHandlers.has('agent:list')).toBe(true);
      expect(mockIpcHandlers.has('agent:get')).toBe(true);
      expect(mockIpcHandlers.has('agent:dispatch')).toBe(true);
      expect(mockIpcHandlers.has('agent:execute-parallel')).toBe(true);
      expect(mockIpcHandlers.has('agent:execute-chain')).toBe(true);
      expect(mockIpcHandlers.has('agent:get-capable')).toBe(true);
      expect(mockIpcHandlers.has('agent:send-message')).toBe(true);
      expect(mockIpcHandlers.has('agent:broadcast')).toBe(true);
      expect(mockIpcHandlers.has('agent:get-messages')).toBe(true);
      expect(mockIpcHandlers.has('agent:get-stats')).toBe(true);
      expect(mockIpcHandlers.has('agent:get-history')).toBe(true);
      expect(mockIpcHandlers.has('agent:reset-stats')).toBe(true);
      expect(mockIpcHandlers.has('agent:export-debug')).toBe(true);
    });

    it('should log registration completion', () => {
      const { logger } = require('../../../../src/main/utils/logger.js');

      registerMultiAgentIPC();

      expect(logger.info).toHaveBeenCalledWith('[MultiAgentIPC] 注册多 Agent IPC 处理器...');
      expect(logger.info).toHaveBeenCalledWith('[MultiAgentIPC] 多 Agent IPC 处理器注册完成');
    });

    it('should accept options', () => {
      const options = {
        llmManager: mockLLMManager,
        functionCaller: mockFunctionCaller
      };

      expect(() => registerMultiAgentIPC(options)).not.toThrow();
    });
  });

  describe('agent:list', () => {
    beforeEach(() => {
      registerMultiAgentIPC({ llmManager: mockLLMManager, functionCaller: mockFunctionCaller });
    });

    it('should return list of all agents', async () => {
      const mockAgents = [
        { agentId: 'agent1', getInfo: () => ({ agentId: 'agent1', capabilities: ['code'] }) },
        { agentId: 'agent2', getInfo: () => ({ agentId: 'agent2', capabilities: ['data'] }) }
      ];

      mockOrchestrator.getAllAgents.mockReturnValue(mockAgents);

      const handler = mockIpcHandlers.get('agent:list');
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.agents).toHaveLength(2);
      expect(result.agents[0].agentId).toBe('agent1');
      expect(result.agents[1].agentId).toBe('agent2');
    });

    it('should handle errors', async () => {
      mockOrchestrator.getAllAgents.mockImplementation(() => {
        throw new Error('Database error');
      });

      const handler = mockIpcHandlers.get('agent:list');
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });

    it('should initialize orchestrator lazily', async () => {
      const { getAgentOrchestrator, initializeDefaultAgents } = require('../../../../src/main/ai-engine/multi-agent/index.js');

      mockOrchestrator.getAllAgents.mockReturnValue([]);

      const handler = mockIpcHandlers.get('agent:list');
      await handler({});

      expect(getAgentOrchestrator).toHaveBeenCalled();
      expect(initializeDefaultAgents).toHaveBeenCalled();
    });
  });

  describe('agent:get', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should return specific agent info', async () => {
      const mockAgent = {
        agentId: 'code-agent',
        getInfo: () => ({ agentId: 'code-agent', capabilities: ['code-generation'] })
      };

      mockOrchestrator.getAgent.mockReturnValue(mockAgent);

      const handler = mockIpcHandlers.get('agent:get');
      const result = await handler({}, { agentId: 'code-agent' });

      expect(result.success).toBe(true);
      expect(result.agent.agentId).toBe('code-agent');
      expect(mockOrchestrator.getAgent).toHaveBeenCalledWith('code-agent');
    });

    it('should return error if agent not found', async () => {
      mockOrchestrator.getAgent.mockReturnValue(null);

      const handler = mockIpcHandlers.get('agent:get');
      const result = await handler({}, { agentId: 'non-existent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent 不存在');
    });

    it('should handle errors', async () => {
      mockOrchestrator.getAgent.mockImplementation(() => {
        throw new Error('Internal error');
      });

      const handler = mockIpcHandlers.get('agent:get');
      const result = await handler({}, { agentId: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal error');
    });
  });

  describe('agent:dispatch', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should dispatch task to orchestrator', async () => {
      const task = { type: 'code-generation', input: 'generate function' };
      const mockResult = { code: 'function test() {}' };

      mockOrchestrator.dispatch.mockResolvedValue(mockResult);

      const handler = mockIpcHandlers.get('agent:dispatch');
      const result = await handler({}, task);

      expect(result.success).toBe(true);
      expect(result.result).toEqual(mockResult);
      expect(mockOrchestrator.dispatch).toHaveBeenCalledWith(task);
    });

    it('should handle dispatch errors', async () => {
      const task = { type: 'invalid', input: 'test' };
      mockOrchestrator.dispatch.mockRejectedValue(new Error('No capable agent'));

      const handler = mockIpcHandlers.get('agent:dispatch');
      const result = await handler({}, task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No capable agent');
    });
  });

  describe('agent:execute-parallel', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should execute tasks in parallel', async () => {
      const tasks = [
        { type: 'task1', input: 'input1' },
        { type: 'task2', input: 'input2' }
      ];
      const mockResults = [{ result: 'result1' }, { result: 'result2' }];

      mockOrchestrator.executeParallel.mockResolvedValue(mockResults);

      const handler = mockIpcHandlers.get('agent:execute-parallel');
      const result = await handler({}, { tasks, options: { maxConcurrent: 2 } });

      expect(result.success).toBe(true);
      expect(result.results).toEqual(mockResults);
      expect(mockOrchestrator.executeParallel).toHaveBeenCalledWith(tasks, { maxConcurrent: 2 });
    });

    it('should use default options if not provided', async () => {
      const tasks = [{ type: 'test' }];
      mockOrchestrator.executeParallel.mockResolvedValue([{ result: 'ok' }]);

      const handler = mockIpcHandlers.get('agent:execute-parallel');
      const result = await handler({}, { tasks });

      expect(result.success).toBe(true);
      expect(mockOrchestrator.executeParallel).toHaveBeenCalledWith(tasks, {});
    });

    it('should handle parallel execution errors', async () => {
      mockOrchestrator.executeParallel.mockRejectedValue(new Error('Parallel execution failed'));

      const handler = mockIpcHandlers.get('agent:execute-parallel');
      const result = await handler({}, { tasks: [] });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Parallel execution failed');
    });
  });

  describe('agent:execute-chain', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should execute tasks in chain', async () => {
      const tasks = [
        { type: 'task1', input: 'input1' },
        { type: 'task2', input: 'input2' }
      ];
      const mockResult = { finalOutput: 'chained result' };

      mockOrchestrator.executeChain.mockResolvedValue(mockResult);

      const handler = mockIpcHandlers.get('agent:execute-chain');
      const result = await handler({}, { tasks });

      expect(result.success).toBe(true);
      expect(result.result).toEqual(mockResult);
      expect(mockOrchestrator.executeChain).toHaveBeenCalledWith(tasks);
    });

    it('should handle chain execution errors', async () => {
      mockOrchestrator.executeChain.mockRejectedValue(new Error('Chain execution failed'));

      const handler = mockIpcHandlers.get('agent:execute-chain');
      const result = await handler({}, { tasks: [] });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Chain execution failed');
    });
  });

  describe('agent:get-capable', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should return capable agents with scores', async () => {
      const task = { type: 'code-generation' };
      const mockCapable = [
        {
          agentId: 'code-agent',
          score: 1.0,
          agent: { getInfo: () => ({ agentId: 'code-agent' }) }
        },
        {
          agentId: 'doc-agent',
          score: 0.5,
          agent: { getInfo: () => ({ agentId: 'doc-agent' }) }
        }
      ];

      mockOrchestrator.getCapableAgents.mockReturnValue(mockCapable);

      const handler = mockIpcHandlers.get('agent:get-capable');
      const result = await handler({}, task);

      expect(result.success).toBe(true);
      expect(result.agents).toHaveLength(2);
      expect(result.agents[0].agentId).toBe('code-agent');
      expect(result.agents[0].score).toBe(1.0);
      expect(result.agents[1].score).toBe(0.5);
    });

    it('should handle errors', async () => {
      mockOrchestrator.getCapableAgents.mockImplementation(() => {
        throw new Error('Error finding capable agents');
      });

      const handler = mockIpcHandlers.get('agent:get-capable');
      const result = await handler({}, { type: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error finding capable agents');
    });
  });

  describe('agent:send-message', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should send message between agents', async () => {
      const mockResponse = { received: true, agentId: 'target-agent' };
      mockOrchestrator.sendMessage.mockResolvedValue(mockResponse);

      const handler = mockIpcHandlers.get('agent:send-message');
      const result = await handler({}, {
        fromAgent: 'sender-agent',
        toAgent: 'target-agent',
        message: { type: 'request', data: 'test' }
      });

      expect(result.success).toBe(true);
      expect(result.response).toEqual(mockResponse);
      expect(mockOrchestrator.sendMessage).toHaveBeenCalledWith(
        'sender-agent',
        'target-agent',
        { type: 'request', data: 'test' }
      );
    });

    it('should handle message sending errors', async () => {
      mockOrchestrator.sendMessage.mockRejectedValue(new Error('Message sending failed'));

      const handler = mockIpcHandlers.get('agent:send-message');
      const result = await handler({}, {
        fromAgent: 'sender',
        toAgent: 'receiver',
        message: {}
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Message sending failed');
    });
  });

  describe('agent:broadcast', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should broadcast message to all agents', async () => {
      const mockResults = [
        { agentId: 'agent1', received: true },
        { agentId: 'agent2', received: true }
      ];

      mockOrchestrator.broadcast.mockResolvedValue(mockResults);

      const handler = mockIpcHandlers.get('agent:broadcast');
      const result = await handler({}, {
        fromAgent: 'broadcaster',
        message: { type: 'announcement', data: 'important' }
      });

      expect(result.success).toBe(true);
      expect(result.results).toEqual(mockResults);
      expect(mockOrchestrator.broadcast).toHaveBeenCalledWith(
        'broadcaster',
        { type: 'announcement', data: 'important' }
      );
    });

    it('should handle broadcast errors', async () => {
      mockOrchestrator.broadcast.mockRejectedValue(new Error('Broadcast failed'));

      const handler = mockIpcHandlers.get('agent:broadcast');
      const result = await handler({}, { fromAgent: 'sender', message: {} });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Broadcast failed');
    });
  });

  describe('agent:get-messages', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should get message history with default limit', async () => {
      const mockMessages = [
        { from: 'agent1', to: 'agent2', message: 'Hello', timestamp: Date.now() },
        { from: 'agent2', to: 'agent1', message: 'Hi', timestamp: Date.now() }
      ];

      mockOrchestrator.getMessageHistory.mockReturnValue(mockMessages);

      const handler = mockIpcHandlers.get('agent:get-messages');
      const result = await handler({}, {});

      expect(result.success).toBe(true);
      expect(result.messages).toEqual(mockMessages);
      expect(mockOrchestrator.getMessageHistory).toHaveBeenCalledWith(null, 50);
    });

    it('should get messages for specific agent', async () => {
      const mockMessages = [{ from: 'agent1', message: 'Test' }];
      mockOrchestrator.getMessageHistory.mockReturnValue(mockMessages);

      const handler = mockIpcHandlers.get('agent:get-messages');
      const result = await handler({}, { agentId: 'agent1', limit: 20 });

      expect(result.success).toBe(true);
      expect(mockOrchestrator.getMessageHistory).toHaveBeenCalledWith('agent1', 20);
    });

    it('should handle errors', async () => {
      mockOrchestrator.getMessageHistory.mockImplementation(() => {
        throw new Error('History retrieval failed');
      });

      const handler = mockIpcHandlers.get('agent:get-messages');
      const result = await handler({}, {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('History retrieval failed');
    });
  });

  describe('agent:get-stats', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should return statistics', async () => {
      const mockStats = {
        totalTasks: 100,
        completedTasks: 95,
        failedTasks: 5,
        agentUsage: { 'agent1': { invocations: 50 } }
      };

      mockOrchestrator.getStats.mockReturnValue(mockStats);

      const handler = mockIpcHandlers.get('agent:get-stats');
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.stats).toEqual(mockStats);
    });

    it('should handle errors', async () => {
      mockOrchestrator.getStats.mockImplementation(() => {
        throw new Error('Stats error');
      });

      const handler = mockIpcHandlers.get('agent:get-stats');
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stats error');
    });
  });

  describe('agent:get-history', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should return execution history with default limit', async () => {
      const mockHistory = [
        { taskId: 'task1', status: 'completed', timestamp: Date.now() },
        { taskId: 'task2', status: 'completed', timestamp: Date.now() }
      ];

      mockOrchestrator.getExecutionHistory.mockReturnValue(mockHistory);

      const handler = mockIpcHandlers.get('agent:get-history');
      const result = await handler({}, {});

      expect(result.success).toBe(true);
      expect(result.history).toEqual(mockHistory);
      expect(mockOrchestrator.getExecutionHistory).toHaveBeenCalledWith(20);
    });

    it('should use custom limit', async () => {
      mockOrchestrator.getExecutionHistory.mockReturnValue([]);

      const handler = mockIpcHandlers.get('agent:get-history');
      const result = await handler({}, { limit: 50 });

      expect(mockOrchestrator.getExecutionHistory).toHaveBeenCalledWith(50);
    });

    it('should handle errors', async () => {
      mockOrchestrator.getExecutionHistory.mockImplementation(() => {
        throw new Error('History error');
      });

      const handler = mockIpcHandlers.get('agent:get-history');
      const result = await handler({}, {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('History error');
    });
  });

  describe('agent:reset-stats', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should reset statistics', async () => {
      const handler = mockIpcHandlers.get('agent:reset-stats');
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(mockOrchestrator.resetStats).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      mockOrchestrator.resetStats.mockImplementation(() => {
        throw new Error('Reset failed');
      });

      const handler = mockIpcHandlers.get('agent:reset-stats');
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Reset failed');
    });
  });

  describe('agent:export-debug', () => {
    beforeEach(() => {
      registerMultiAgentIPC();
    });

    it('should export debug information', async () => {
      const mockDebugInfo = {
        agents: [],
        stats: {},
        history: [],
        messages: []
      };

      mockOrchestrator.exportDebugInfo.mockReturnValue(mockDebugInfo);

      const handler = mockIpcHandlers.get('agent:export-debug');
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.debugInfo).toEqual(mockDebugInfo);
    });

    it('should handle errors', async () => {
      mockOrchestrator.exportDebugInfo.mockImplementation(() => {
        throw new Error('Export failed');
      });

      const handler = mockIpcHandlers.get('agent:export-debug');
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Export failed');
    });
  });
});
