/**
 * Agent Orchestrator 单元测试
 *
 * 测试覆盖：
 * - Agent注册和管理
 * - 任务分发和路由
 * - 并行执行协调
 * - Agent间通信
 * - 统计和调试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('AgentOrchestrator', () => {
  let AgentOrchestrator;
  let orchestrator;
  let mockAgent1;
  let mockAgent2;
  let mockAgent3;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Import module
    const module = await import('../../../../src/main/ai-engine/multi-agent/agent-orchestrator.js');
    AgentOrchestrator = module.AgentOrchestrator;

    orchestrator = new AgentOrchestrator();

    // Create mock agents
    mockAgent1 = {
      agentId: 'agent1',
      capabilities: ['code-generation', 'code-review'],
      description: 'Code agent',
      canHandle: vi.fn((task) => task.type === 'code-generation' ? 0.9 : 0),
      execute: vi.fn().mockResolvedValue({ code: 'function test() {}' }),
      receiveMessage: vi.fn().mockResolvedValue({ acknowledged: true })
    };

    mockAgent2 = {
      agentId: 'agent2',
      capabilities: ['data-analysis'],
      description: 'Data agent',
      canHandle: vi.fn((task) => task.type === 'data-analysis' ? 0.8 : 0),
      execute: vi.fn().mockResolvedValue({ analysis: 'Data processed' })
    };

    mockAgent3 = {
      agentId: 'agent3',
      capabilities: ['code-generation'],
      description: 'Alternative code agent',
      canHandle: vi.fn((task) => task.type === 'code-generation' ? 0.7 : 0),
      execute: vi.fn().mockResolvedValue({ code: 'function alt() {}' })
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with default configuration', () => {
      expect(orchestrator.agents).toBeInstanceOf(Map);
      expect(orchestrator.agents.size).toBe(0);
      expect(orchestrator.messageQueue).toEqual([]);
      expect(orchestrator.executionHistory).toEqual([]);
      expect(orchestrator.activeExecutions).toBeInstanceOf(Map);
    });

    it('should accept custom configuration', () => {
      const custom = new AgentOrchestrator({
        maxParallelAgents: 5,
        agentTimeout: 30000,
        enableLogging: false,
        maxHistory: 200
      });

      expect(custom.config.maxParallelAgents).toBe(5);
      expect(custom.config.agentTimeout).toBe(30000);
      expect(custom.config.enableLogging).toBe(false);
      expect(custom.config.maxHistory).toBe(200);
    });

    it('should initialize statistics', () => {
      expect(orchestrator.stats.totalTasks).toBe(0);
      expect(orchestrator.stats.completedTasks).toBe(0);
      expect(orchestrator.stats.failedTasks).toBe(0);
      expect(orchestrator.stats.agentUsage).toEqual({});
    });

    it('should extend EventEmitter', () => {
      expect(typeof orchestrator.on).toBe('function');
      expect(typeof orchestrator.emit).toBe('function');
    });
  });

  describe('Agent Registration', () => {
    describe('registerAgent', () => {
      it('should register an agent', () => {
        orchestrator.registerAgent(mockAgent1);

        expect(orchestrator.agents.has('agent1')).toBe(true);
        expect(orchestrator.agents.get('agent1')).toBe(mockAgent1);
      });

      it('should initialize agent usage statistics', () => {
        orchestrator.registerAgent(mockAgent1);

        expect(orchestrator.stats.agentUsage['agent1']).toBeDefined();
        expect(orchestrator.stats.agentUsage['agent1'].invocations).toBe(0);
        expect(orchestrator.stats.agentUsage['agent1'].successes).toBe(0);
        expect(orchestrator.stats.agentUsage['agent1'].failures).toBe(0);
        expect(orchestrator.stats.agentUsage['agent1'].totalTime).toBe(0);
      });

      it('should emit agent-registered event', () => {
        const listener = vi.fn();
        orchestrator.on('agent-registered', listener);

        orchestrator.registerAgent(mockAgent1);

        expect(listener).toHaveBeenCalledWith({
          agentId: 'agent1',
          agent: mockAgent1
        });
      });

      it('should throw error if agent has no agentId', () => {
        const invalidAgent = { capabilities: [] };

        expect(() => orchestrator.registerAgent(invalidAgent))
          .toThrow('Agent must have an agentId');
      });

      it('should overwrite existing agent with same ID', () => {
        const agent1v1 = { ...mockAgent1, version: 1 };
        const agent1v2 = { ...mockAgent1, version: 2 };

        orchestrator.registerAgent(agent1v1);
        orchestrator.registerAgent(agent1v2);

        expect(orchestrator.agents.get('agent1').version).toBe(2);
      });
    });

    describe('registerAgents', () => {
      it('should register multiple agents', () => {
        orchestrator.registerAgents([mockAgent1, mockAgent2, mockAgent3]);

        expect(orchestrator.agents.size).toBe(3);
        expect(orchestrator.agents.has('agent1')).toBe(true);
        expect(orchestrator.agents.has('agent2')).toBe(true);
        expect(orchestrator.agents.has('agent3')).toBe(true);
      });

      it('should handle empty array', () => {
        orchestrator.registerAgents([]);

        expect(orchestrator.agents.size).toBe(0);
      });
    });

    describe('unregisterAgent', () => {
      it('should unregister an agent', () => {
        orchestrator.registerAgent(mockAgent1);
        orchestrator.unregisterAgent('agent1');

        expect(orchestrator.agents.has('agent1')).toBe(false);
      });

      it('should emit agent-unregistered event', () => {
        const listener = vi.fn();
        orchestrator.on('agent-unregistered', listener);

        orchestrator.registerAgent(mockAgent1);
        orchestrator.unregisterAgent('agent1');

        expect(listener).toHaveBeenCalledWith({ agentId: 'agent1' });
      });

      it('should handle unregistering non-existent agent', () => {
        expect(() => orchestrator.unregisterAgent('nonexistent')).not.toThrow();
      });
    });

    describe('getAgent', () => {
      it('should get registered agent', () => {
        orchestrator.registerAgent(mockAgent1);

        const agent = orchestrator.getAgent('agent1');

        expect(agent).toBe(mockAgent1);
      });

      it('should return undefined for non-existent agent', () => {
        expect(orchestrator.getAgent('nonexistent')).toBeUndefined();
      });
    });

    describe('getAllAgents', () => {
      it('should return all registered agents', () => {
        orchestrator.registerAgents([mockAgent1, mockAgent2]);

        const agents = orchestrator.getAllAgents();

        expect(agents).toHaveLength(2);
        expect(agents).toContain(mockAgent1);
        expect(agents).toContain(mockAgent2);
      });

      it('should return empty array when no agents registered', () => {
        expect(orchestrator.getAllAgents()).toEqual([]);
      });
    });
  });

  describe('Task Dispatching', () => {
    beforeEach(() => {
      orchestrator.registerAgents([mockAgent1, mockAgent2, mockAgent3]);
    });

    describe('selectAgent', () => {
      it('should select agent with highest score', () => {
        const task = { type: 'code-generation', input: 'generate code' };

        const agentId = orchestrator.selectAgent(task);

        expect(agentId).toBe('agent1'); // Highest score (0.9)
        expect(mockAgent1.canHandle).toHaveBeenCalledWith(task);
      });

      it('should return null if no agent can handle task', () => {
        const task = { type: 'unknown-task', input: 'test' };

        const agentId = orchestrator.selectAgent(task);

        expect(agentId).toBeNull();
      });

      it('should handle multiple agents with same capabilities', () => {
        const task = { type: 'code-generation', input: 'test' };

        const agentId = orchestrator.selectAgent(task);

        // Should select agent1 (highest score)
        expect(agentId).toBe('agent1');
      });
    });

    describe('getCapableAgents', () => {
      it('should return all capable agents sorted by score', () => {
        const task = { type: 'code-generation', input: 'test' };

        const capable = orchestrator.getCapableAgents(task);

        expect(capable).toHaveLength(2);
        expect(capable[0].agentId).toBe('agent1'); // Highest score
        expect(capable[1].agentId).toBe('agent3'); // Lower score
        expect(capable[0].score).toBeGreaterThan(capable[1].score);
      });

      it('should return empty array if no capable agents', () => {
        const task = { type: 'unknown-task', input: 'test' };

        const capable = orchestrator.getCapableAgents(task);

        expect(capable).toEqual([]);
      });
    });

    describe('dispatch', () => {
      it('should dispatch task to selected agent', async () => {
        const task = { type: 'code-generation', input: 'generate function' };

        const result = await orchestrator.dispatch(task);

        expect(mockAgent1.execute).toHaveBeenCalledWith(task);
        expect(result).toEqual({ code: 'function test() {}' });
      });

      it('should throw error if no agent can handle task', async () => {
        const task = { type: 'unknown-task', input: 'test' };

        await expect(orchestrator.dispatch(task))
          .rejects.toThrow('没有 Agent 能处理任务类型: unknown-task');
      });

      it('should update statistics on success', async () => {
        const task = { type: 'code-generation', input: 'test' };

        await orchestrator.dispatch(task);

        expect(orchestrator.stats.totalTasks).toBe(1);
        expect(orchestrator.stats.completedTasks).toBe(1);
        expect(orchestrator.stats.agentUsage['agent1'].invocations).toBe(1);
        expect(orchestrator.stats.agentUsage['agent1'].successes).toBe(1);
      });

      it('should update statistics on failure', async () => {
        const task = { type: 'code-generation', input: 'test' };
        mockAgent1.execute.mockRejectedValue(new Error('Execution failed'));

        await expect(orchestrator.dispatch(task)).rejects.toThrow('Execution failed');

        expect(orchestrator.stats.totalTasks).toBe(1);
        expect(orchestrator.stats.failedTasks).toBe(1);
        expect(orchestrator.stats.agentUsage['agent1'].failures).toBe(1);
      });

      it('should record execution history', async () => {
        const task = { type: 'code-generation', input: 'test' };

        await orchestrator.dispatch(task);

        expect(orchestrator.executionHistory).toHaveLength(1);
        expect(orchestrator.executionHistory[0].task.type).toBe('code-generation');
        expect(orchestrator.executionHistory[0].agentId).toBe('agent1');
      });

      it('should emit task-completed event', async () => {
        const listener = vi.fn();
        orchestrator.on('task-completed', listener);

        const task = { type: 'code-generation', input: 'test' };
        await orchestrator.dispatch(task);

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            task,
            agentId: 'agent1',
            result: { code: 'function test() {}' }
          })
        );
      });

      it('should emit task-failed event on error', async () => {
        const listener = vi.fn();
        orchestrator.on('task-failed', listener);

        const task = { type: 'code-generation', input: 'test' };
        mockAgent1.execute.mockRejectedValue(new Error('Failed'));

        await expect(orchestrator.dispatch(task)).rejects.toThrow();

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            task,
            error: expect.any(Error)
          })
        );
      });

      it('should handle timeout', async () => {
        const shortTimeout = new AgentOrchestrator({ agentTimeout: 100 });
        shortTimeout.registerAgent(mockAgent1);

        // Make execute take longer than timeout
        mockAgent1.execute.mockImplementation(() =>
          new Promise((resolve) => setTimeout(resolve, 200))
        );

        const task = { type: 'code-generation', input: 'test' };

        await expect(shortTimeout.dispatch(task))
          .rejects.toThrow('执行超时');
      });

      it('should clean up active executions after completion', async () => {
        const task = { type: 'code-generation', input: 'test' };

        await orchestrator.dispatch(task);

        expect(orchestrator.activeExecutions.size).toBe(0);
      });
    });
  });

  describe('Parallel Execution', () => {
    beforeEach(() => {
      orchestrator.registerAgents([mockAgent1, mockAgent2]);
    });

    describe('executeParallel', () => {
      it('should execute multiple tasks in parallel', async () => {
        const tasks = [
          { type: 'code-generation', input: 'task1' },
          { type: 'data-analysis', input: 'task2' }
        ];

        const results = await orchestrator.executeParallel(tasks);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(true);
        expect(mockAgent1.execute).toHaveBeenCalled();
        expect(mockAgent2.execute).toHaveBeenCalled();
      });

      it('should respect maxConcurrency limit', async () => {
        const tasks = Array(5).fill({ type: 'code-generation', input: 'test' });

        let activeCount = 0;
        let maxActive = 0;

        mockAgent1.execute.mockImplementation(async () => {
          activeCount++;
          maxActive = Math.max(maxActive, activeCount);
          await new Promise(resolve => setTimeout(resolve, 50));
          activeCount--;
          return { code: 'test' };
        });

        await orchestrator.executeParallel(tasks, { maxConcurrency: 2 });

        expect(maxActive).toBeLessThanOrEqual(2);
      });

      it('should handle errors gracefully', async () => {
        const tasks = [
          { type: 'code-generation', input: 'task1' },
          { type: 'data-analysis', input: 'task2' }
        ];

        mockAgent1.execute.mockRejectedValue(new Error('Task 1 failed'));

        const results = await orchestrator.executeParallel(tasks);

        expect(results[0].success).toBe(false);
        expect(results[0].error).toBe('Task 1 failed');
        expect(results[1].success).toBe(true);
      });

      it('should stop on error if stopOnError is true', async () => {
        const tasks = [
          { type: 'code-generation', input: 'task1' },
          { type: 'data-analysis', input: 'task2' }
        ];

        mockAgent1.execute.mockRejectedValue(new Error('Task failed'));

        await expect(orchestrator.executeParallel(tasks, { stopOnError: true }))
          .rejects.toThrow('Task failed');
      });

      it('should handle empty task array', async () => {
        const results = await orchestrator.executeParallel([]);

        expect(results).toEqual([]);
      });
    });

    describe('executeChain', () => {
      it('should execute tasks in chain', async () => {
        const tasks = [
          { type: 'data-analysis', input: 'step1' },
          { type: 'code-generation', input: 'step2' }
        ];

        mockAgent2.execute.mockResolvedValue({ data: 'analyzed' });

        const result = await orchestrator.executeChain(tasks);

        expect(mockAgent2.execute).toHaveBeenCalled();
        expect(mockAgent1.execute).toHaveBeenCalled();
        expect(result).toEqual({ code: 'function test() {}' });
      });

      it('should pass previous result to next task', async () => {
        const tasks = [
          { type: 'data-analysis', input: 'step1' },
          { type: 'code-generation', input: 'step2' }
        ];

        mockAgent2.execute.mockResolvedValue({ data: 'result1' });

        await orchestrator.executeChain(tasks);

        // Check that second task received previousResult in context
        const secondCallArgs = mockAgent1.execute.mock.calls[0][0];
        expect(secondCallArgs.context.previousResult).toEqual({ data: 'result1' });
      });

      it('should include chain index in context', async () => {
        const tasks = [
          { type: 'data-analysis', input: 'step1' },
          { type: 'code-generation', input: 'step2' }
        ];

        await orchestrator.executeChain(tasks);

        const secondCallArgs = mockAgent1.execute.mock.calls[0][0];
        expect(secondCallArgs.context.chainIndex).toBe(1);
      });

      it('should handle single task chain', async () => {
        const tasks = [{ type: 'code-generation', input: 'test' }];

        const result = await orchestrator.executeChain(tasks);

        expect(result).toEqual({ code: 'function test() {}' });
      });

      it('should stop on error', async () => {
        const tasks = [
          { type: 'data-analysis', input: 'step1' },
          { type: 'code-generation', input: 'step2' }
        ];

        mockAgent2.execute.mockRejectedValue(new Error('Step 1 failed'));

        await expect(orchestrator.executeChain(tasks))
          .rejects.toThrow('Step 1 failed');

        expect(mockAgent1.execute).not.toHaveBeenCalled();
      });
    });
  });

  describe('Agent Communication', () => {
    beforeEach(() => {
      orchestrator.registerAgents([mockAgent1, mockAgent2]);
    });

    describe('sendMessage', () => {
      it('should send message to target agent', async () => {
        const message = { content: 'test message' };

        const response = await orchestrator.sendMessage('agent1', 'agent2', message);

        expect(mockAgent1.receiveMessage).toHaveBeenCalledWith(
          message,
          { from: 'agent1' }
        );
      });

      it('should throw error if target agent does not exist', async () => {
        await expect(orchestrator.sendMessage('agent1', 'nonexistent', {}))
          .rejects.toThrow('目标 Agent 不存在: nonexistent');
      });

      it('should record message in queue', async () => {
        await orchestrator.sendMessage('agent1', 'agent2', { test: 'msg' });

        expect(orchestrator.messageQueue).toHaveLength(1);
        expect(orchestrator.messageQueue[0].from).toBe('agent1');
        expect(orchestrator.messageQueue[0].to).toBe('agent2');
        expect(orchestrator.messageQueue[0].message).toEqual({ test: 'msg' });
      });

      it('should limit message queue size', async () => {
        // Fill queue beyond limit
        for (let i = 0; i < 1200; i++) {
          orchestrator.messageQueue.push({ id: i });
        }

        await orchestrator.sendMessage('agent1', 'agent2', {});

        expect(orchestrator.messageQueue.length).toBeLessThanOrEqual(500);
      });

      it('should return null if agent has no receiveMessage method', async () => {
        delete mockAgent2.receiveMessage;

        const response = await orchestrator.sendMessage('agent1', 'agent2', {});

        expect(response).toBeNull();
      });
    });

    describe('broadcast', () => {
      it('should send message to all agents except sender', async () => {
        orchestrator.registerAgent(mockAgent3);

        const message = { content: 'broadcast' };
        const results = await orchestrator.broadcast('agent1', message);

        expect(results).toHaveLength(1); // Only agent2 has receiveMessage
        expect(mockAgent1.receiveMessage).not.toHaveBeenCalled(); // Sender excluded
      });

      it('should handle errors from individual agents', async () => {
        mockAgent1.receiveMessage.mockRejectedValue(new Error('Agent error'));

        const results = await orchestrator.broadcast('agent2', {});

        expect(results[0].error).toBe('Agent error');
      });

      it('should skip agents without receiveMessage method', async () => {
        delete mockAgent2.receiveMessage;

        const results = await orchestrator.broadcast('agent1', {});

        expect(results).toHaveLength(0);
      });
    });

    describe('getMessageHistory', () => {
      beforeEach(async () => {
        await orchestrator.sendMessage('agent1', 'agent2', { msg: 1 });
        await orchestrator.sendMessage('agent2', 'agent1', { msg: 2 });
        await orchestrator.sendMessage('agent1', 'agent2', { msg: 3 });
      });

      it('should get all message history', () => {
        const history = orchestrator.getMessageHistory();

        expect(history).toHaveLength(3);
      });

      it('should filter by agent ID', () => {
        const history = orchestrator.getMessageHistory('agent1');

        expect(history).toHaveLength(3); // All messages involve agent1
      });

      it('should apply limit', () => {
        const history = orchestrator.getMessageHistory(null, 2);

        expect(history).toHaveLength(2);
      });
    });
  });

  describe('Statistics and Debugging', () => {
    beforeEach(() => {
      orchestrator.registerAgent(mockAgent1);
    });

    describe('getStats', () => {
      it('should return statistics', async () => {
        await orchestrator.dispatch({ type: 'code-generation', input: 'test' });

        const stats = orchestrator.getStats();

        expect(stats.totalTasks).toBe(1);
        expect(stats.completedTasks).toBe(1);
        expect(stats.failedTasks).toBe(0);
        expect(stats.registeredAgents).toBe(1);
        expect(stats.activeExecutions).toBe(0);
        expect(stats.successRate).toBe('100.00%');
      });

      it('should calculate success rate correctly', async () => {
        await orchestrator.dispatch({ type: 'code-generation', input: 'test' });

        mockAgent1.execute.mockRejectedValue(new Error('Failed'));
        await expect(orchestrator.dispatch({ type: 'code-generation', input: 'test' }))
          .rejects.toThrow();

        const stats = orchestrator.getStats();

        expect(stats.successRate).toBe('50.00%');
      });

      it('should show N/A for success rate when no tasks', () => {
        const stats = orchestrator.getStats();

        expect(stats.successRate).toBe('N/A');
      });
    });

    describe('getExecutionHistory', () => {
      it('should return execution history', async () => {
        await orchestrator.dispatch({ type: 'code-generation', input: 'test1' });
        await orchestrator.dispatch({ type: 'code-generation', input: 'test2' });

        const history = orchestrator.getExecutionHistory();

        expect(history).toHaveLength(2);
        expect(history[0].task.type).toBe('code-generation');
      });

      it('should limit history size', async () => {
        for (let i = 0; i < 30; i++) {
          await orchestrator.dispatch({ type: 'code-generation', input: `test${i}` });
        }

        const history = orchestrator.getExecutionHistory(10);

        expect(history).toHaveLength(10);
      });

      it('should respect maxHistory config', async () => {
        const limited = new AgentOrchestrator({ maxHistory: 5 });
        limited.registerAgent(mockAgent1);

        for (let i = 0; i < 10; i++) {
          await limited.dispatch({ type: 'code-generation', input: `test${i}` });
        }

        expect(limited.executionHistory.length).toBeLessThanOrEqual(5);
      });
    });

    describe('resetStats', () => {
      it('should reset all statistics', async () => {
        await orchestrator.dispatch({ type: 'code-generation', input: 'test' });

        orchestrator.resetStats();

        expect(orchestrator.stats.totalTasks).toBe(0);
        expect(orchestrator.stats.completedTasks).toBe(0);
        expect(orchestrator.stats.failedTasks).toBe(0);
        expect(orchestrator.stats.agentUsage['agent1'].invocations).toBe(0);
      });

      it('should preserve agent usage structure', () => {
        orchestrator.resetStats();

        expect(orchestrator.stats.agentUsage['agent1']).toBeDefined();
        expect(orchestrator.stats.agentUsage['agent1']).toEqual({
          invocations: 0,
          successes: 0,
          failures: 0,
          totalTime: 0
        });
      });
    });

    describe('exportDebugInfo', () => {
      it('should export debug information', async () => {
        await orchestrator.dispatch({ type: 'code-generation', input: 'test' });

        const debugInfo = orchestrator.exportDebugInfo();

        expect(debugInfo.agents).toHaveLength(1);
        expect(debugInfo.agents[0].id).toBe('agent1');
        expect(debugInfo.stats).toBeDefined();
        expect(debugInfo.recentHistory).toBeDefined();
        expect(debugInfo.activeExecutions).toBeDefined();
      });

      it('should include agent capabilities', () => {
        const debugInfo = orchestrator.exportDebugInfo();

        expect(debugInfo.agents[0].capabilities).toEqual(['code-generation', 'code-review']);
        expect(debugInfo.agents[0].description).toBe('Code agent');
      });
    });
  });
});
