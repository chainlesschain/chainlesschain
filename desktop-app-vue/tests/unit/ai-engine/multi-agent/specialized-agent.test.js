/**
 * SpecializedAgent 基类单元测试
 *
 * 测试覆盖：
 * - 构造函数和配置
 * - 能力评估 (canHandle)
 * - 任务执行和重试机制
 * - LLM 和工具调用
 * - Agent 间消息传递
 * - 状态和统计管理
 * - 资源清理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SpecializedAgent } from '../../../../src/main/ai-engine/multi-agent/specialized-agent.js';

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

// 创建测试用 Agent 子类
class TestAgent extends SpecializedAgent {
  constructor(agentId, options = {}) {
    super(agentId, options);
    this.executionResult = options.executionResult || { success: true };
    this.shouldFail = options.shouldFail || false;
    this.executionDelay = options.executionDelay || 0;
  }

  async execute(task) {
    if (this.executionDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.executionDelay));
    }

    if (this.shouldFail) {
      throw new Error('Execution failed');
    }

    return {
      ...this.executionResult,
      taskType: task.type,
      taskInput: task.input
    };
  }
}

describe('SpecializedAgent', () => {
  let agent;
  let mockLLMManager;
  let mockFunctionCaller;

  beforeEach(() => {
    // Mock LLM Manager
    mockLLMManager = {
      chat: vi.fn().mockResolvedValue('LLM response')
    };

    // Mock Function Caller
    mockFunctionCaller = {
      call: vi.fn().mockResolvedValue({ tool: 'result' })
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    if (agent) {
      agent.destroy();
    }
  });

  describe('Constructor', () => {
    it('should initialize with basic options', () => {
      agent = new TestAgent('test-agent', {
        capabilities: ['code-generation', 'code-review'],
        description: 'Test Agent',
        priority: 5
      });

      expect(agent.agentId).toBe('test-agent');
      expect(agent.capabilities).toEqual(['code-generation', 'code-review']);
      expect(agent.description).toBe('Test Agent');
      expect(agent.priority).toBe(5);
    });

    it('should use default values when options not provided', () => {
      agent = new TestAgent('minimal-agent');

      expect(agent.capabilities).toEqual([]);
      expect(agent.description).toBe('');
      expect(agent.priority).toBe(0);
    });

    it('should initialize state correctly', () => {
      agent = new TestAgent('state-agent');

      expect(agent.state.isActive).toBe(false);
      expect(agent.state.currentTask).toBeNull();
      expect(agent.state.lastExecutionTime).toBeNull();
    });

    it('should initialize config with defaults', () => {
      agent = new TestAgent('config-agent');

      expect(agent.config.maxRetries).toBe(3);
      expect(agent.config.retryDelay).toBe(1000);
      expect(agent.config.timeout).toBe(60000);
    });

    it('should allow custom config values', () => {
      agent = new TestAgent('custom-config-agent', {
        maxRetries: 5,
        retryDelay: 2000,
        timeout: 120000,
        config: {
          customOption: 'value'
        }
      });

      expect(agent.config.maxRetries).toBe(5);
      expect(agent.config.retryDelay).toBe(2000);
      expect(agent.config.timeout).toBe(120000);
      expect(agent.config.customOption).toBe('value');
    });

    it('should initialize stats to zero', () => {
      agent = new TestAgent('stats-agent');

      expect(agent.stats.totalExecutions).toBe(0);
      expect(agent.stats.successfulExecutions).toBe(0);
      expect(agent.stats.failedExecutions).toBe(0);
      expect(agent.stats.totalTime).toBe(0);
    });

    it('should initialize LLM and FunctionCaller as null', () => {
      agent = new TestAgent('deps-agent');

      expect(agent.llmManager).toBeNull();
      expect(agent.functionCaller).toBeNull();
    });
  });

  describe('Dependency Injection', () => {
    beforeEach(() => {
      agent = new TestAgent('di-agent');
    });

    it('should set LLM manager', () => {
      agent.setLLMManager(mockLLMManager);

      expect(agent.llmManager).toBe(mockLLMManager);
    });

    it('should set function caller', () => {
      agent.setFunctionCaller(mockFunctionCaller);

      expect(agent.functionCaller).toBe(mockFunctionCaller);
    });
  });

  describe('canHandle', () => {
    beforeEach(() => {
      agent = new TestAgent('capability-agent', {
        capabilities: ['code-generation', 'code-review', 'refactoring']
      });
    });

    it('should return 1.0 for exact capability match', () => {
      const task = { type: 'code-generation', input: 'generate function' };
      const score = agent.canHandle(task);

      expect(score).toBe(1.0);
    });

    it('should return 1.0 for multiple exact matches', () => {
      const task1 = { type: 'code-review', input: 'review code' };
      const task2 = { type: 'refactoring', input: 'refactor module' };

      expect(agent.canHandle(task1)).toBe(1.0);
      expect(agent.canHandle(task2)).toBe(1.0);
    });

    it('should return 0.5 for partial capability match (task contains capability)', () => {
      const task = { type: 'code-generation-advanced', input: 'advanced generation' };
      const score = agent.canHandle(task);

      expect(score).toBe(0.5);
    });

    it('should return 0.5 for partial capability match (capability contains task)', () => {
      const task = { type: 'code', input: 'code task' };
      const score = agent.canHandle(task);

      expect(score).toBe(0.5);
    });

    it('should return 0 for no capability match', () => {
      const task = { type: 'image-generation', input: 'generate image' };
      const score = agent.canHandle(task);

      expect(score).toBe(0);
    });

    it('should return 0 for null task', () => {
      const score = agent.canHandle(null);

      expect(score).toBe(0);
    });

    it('should return 0 for task without type', () => {
      const task = { input: 'no type' };
      const score = agent.canHandle(task);

      expect(score).toBe(0);
    });
  });

  describe('execute', () => {
    it('should throw error if not implemented by subclass', async () => {
      agent = new SpecializedAgent('base-agent');

      await expect(agent.execute({ type: 'test' })).rejects.toThrow('子类必须实现 execute 方法');
    });

    it('should execute task in subclass implementation', async () => {
      agent = new TestAgent('exec-agent', {
        executionResult: { code: 'function test() {}' }
      });

      const task = { type: 'code-generation', input: 'generate test function' };
      const result = await agent.execute(task);

      expect(result.code).toBe('function test() {}');
      expect(result.taskType).toBe('code-generation');
      expect(result.taskInput).toBe('generate test function');
    });
  });

  describe('executeWithRetry', () => {
    it('should execute task successfully on first attempt', async () => {
      agent = new TestAgent('retry-agent', {
        executionResult: { success: true, data: 'result' }
      });

      const task = { type: 'test-task', input: 'test input' };
      const result = await agent.executeWithRetry(task);

      expect(result.success).toBe(true);
      expect(result.data).toBe('result');
      expect(agent.stats.totalExecutions).toBe(1);
      expect(agent.stats.successfulExecutions).toBe(1);
      expect(agent.stats.failedExecutions).toBe(0);
    });

    it('should update state during execution', async () => {
      agent = new TestAgent('state-agent', {
        executionDelay: 50
      });

      const task = { type: 'test-task', input: 'test' };

      const executionPromise = agent.executeWithRetry(task);

      // 在执行期间检查状态
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(agent.state.isActive).toBe(true);
      expect(agent.state.currentTask).toEqual(task);

      await executionPromise;

      // 执行完成后检查状态
      expect(agent.state.isActive).toBe(false);
      expect(agent.state.currentTask).toBeNull();
      expect(agent.state.lastExecutionTime).toBeGreaterThan(0);
    });

    it('should update stats on successful execution', async () => {
      agent = new TestAgent('stats-agent');

      await agent.executeWithRetry({ type: 'test', input: 'test' });

      expect(agent.stats.totalExecutions).toBe(1);
      expect(agent.stats.successfulExecutions).toBe(1);
      expect(agent.stats.failedExecutions).toBe(0);
      expect(agent.stats.totalTime).toBeGreaterThan(0);
    });

    it('should retry on failure up to maxRetries', async () => {
      let attemptCount = 0;

      class FailingAgent extends SpecializedAgent {
        async execute() {
          attemptCount++;
          throw new Error('Execution failed');
        }
      }

      agent = new FailingAgent('failing-agent', {
        maxRetries: 3,
        retryDelay: 10
      });

      await expect(agent.executeWithRetry({ type: 'test' })).rejects.toThrow('Execution failed');

      expect(attemptCount).toBe(3);
      expect(agent.stats.totalExecutions).toBe(1);
      expect(agent.stats.successfulExecutions).toBe(0);
      expect(agent.stats.failedExecutions).toBe(1);
    });

    it('should succeed on retry after initial failures', async () => {
      let attemptCount = 0;

      class RetrySuccessAgent extends SpecializedAgent {
        async execute() {
          attemptCount++;
          if (attemptCount < 2) {
            throw new Error('Temporary failure');
          }
          return { success: true };
        }
      }

      agent = new RetrySuccessAgent('retry-success-agent', {
        maxRetries: 3,
        retryDelay: 10
      });

      const result = await agent.executeWithRetry({ type: 'test' });

      expect(attemptCount).toBe(2);
      expect(result.success).toBe(true);
      expect(agent.stats.successfulExecutions).toBe(1);
      expect(agent.stats.failedExecutions).toBe(0);
    });

    it('should apply exponential backoff on retries', async () => {
      const delays = [];
      let attemptCount = 0;

      class DelayTrackingAgent extends SpecializedAgent {
        async execute() {
          attemptCount++;
          throw new Error('Failure');
        }

        _delay(ms) {
          delays.push(ms);
          return super._delay(ms);
        }
      }

      agent = new DelayTrackingAgent('backoff-agent', {
        maxRetries: 3,
        retryDelay: 100
      });

      await expect(agent.executeWithRetry({ type: 'test' })).rejects.toThrow('Failure');

      // 第一次重试: 100ms, 第二次重试: 200ms
      expect(delays.length).toBe(2);
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);
    });

    it('should reset state after failure', async () => {
      agent = new TestAgent('state-reset-agent', {
        shouldFail: true,
        maxRetries: 1,
        retryDelay: 10
      });

      await expect(agent.executeWithRetry({ type: 'test' })).rejects.toThrow('Execution failed');

      expect(agent.state.isActive).toBe(false);
      expect(agent.state.currentTask).toBeNull();
    });
  });

  describe('receiveMessage', () => {
    beforeEach(() => {
      agent = new TestAgent('message-agent');
    });

    it('should receive message with default implementation', async () => {
      const message = { type: 'info', content: 'Hello' };
      const metadata = { from: 'sender-agent', timestamp: Date.now() };

      const response = await agent.receiveMessage(message, metadata);

      expect(response.received).toBe(true);
      expect(response.agentId).toBe('message-agent');
    });

    it('should log received messages', async () => {
      const { logger } = await import('../../../../src/main/utils/logger.js');

      const message = { type: 'request', data: 'data' };
      const metadata = { from: 'other-agent' };

      await agent.receiveMessage(message, metadata);

      expect(logger.info).toHaveBeenCalled();
    });

    it('should allow custom message handling in subclass', async () => {
      class CustomMessageAgent extends SpecializedAgent {
        async receiveMessage(message, metadata) {
          return {
            processed: true,
            messageType: message.type,
            sender: metadata.from
          };
        }

        async execute() {}
      }

      agent = new CustomMessageAgent('custom-msg-agent');

      const message = { type: 'custom', payload: { value: 42 } };
      const metadata = { from: 'sender' };

      const response = await agent.receiveMessage(message, metadata);

      expect(response.processed).toBe(true);
      expect(response.messageType).toBe('custom');
      expect(response.sender).toBe('sender');
    });
  });

  describe('callLLM', () => {
    beforeEach(() => {
      agent = new TestAgent('llm-agent');
    });

    it('should call LLM manager with options', async () => {
      agent.setLLMManager(mockLLMManager);

      const options = {
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are a helpful assistant',
        temperature: 0.7
      };

      const response = await agent.callLLM(options);

      expect(mockLLMManager.chat).toHaveBeenCalledWith({
        messages: options.messages,
        systemPrompt: options.systemPrompt,
        temperature: 0.7
      });
      expect(response).toBe('LLM response');
    });

    it('should throw error if LLM manager not set', async () => {
      const options = {
        messages: [{ role: 'user', content: 'Hello' }]
      };

      await expect(agent.callLLM(options)).rejects.toThrow('LLM 管理器未设置');
    });

    it('should pass all options to LLM manager', async () => {
      agent.setLLMManager(mockLLMManager);

      await agent.callLLM({
        messages: [{ role: 'user', content: 'Test' }],
        systemPrompt: 'System',
        temperature: 0.5,
        maxTokens: 1000,
        stream: false
      });

      expect(mockLLMManager.chat).toHaveBeenCalledWith({
        messages: [{ role: 'user', content: 'Test' }],
        systemPrompt: 'System',
        temperature: 0.5,
        maxTokens: 1000,
        stream: false
      });
    });
  });

  describe('callTool', () => {
    beforeEach(() => {
      agent = new TestAgent('tool-agent');
    });

    it('should call tool with params', async () => {
      agent.setFunctionCaller(mockFunctionCaller);

      const result = await agent.callTool('readFile', { path: '/test/file.txt' });

      expect(mockFunctionCaller.call).toHaveBeenCalledWith(
        'readFile',
        { path: '/test/file.txt' },
        {}
      );
      expect(result).toEqual({ tool: 'result' });
    });

    it('should pass context to tool call', async () => {
      agent.setFunctionCaller(mockFunctionCaller);

      const context = { userId: 'user123', sessionId: 'session456' };

      await agent.callTool('writeFile', { path: '/test/output.txt', content: 'test' }, context);

      expect(mockFunctionCaller.call).toHaveBeenCalledWith(
        'writeFile',
        { path: '/test/output.txt', content: 'test' },
        context
      );
    });

    it('should throw error if FunctionCaller not set', async () => {
      await expect(agent.callTool('readFile', { path: '/test' })).rejects.toThrow('FunctionCaller 未设置');
    });
  });

  describe('getState', () => {
    beforeEach(() => {
      agent = new TestAgent('state-agent');
    });

    it('should return current state', () => {
      const state = agent.getState();

      expect(state.isActive).toBe(false);
      expect(state.currentTask).toBeNull();
      expect(state.lastExecutionTime).toBeNull();
    });

    it('should return copy of state, not reference', () => {
      const state1 = agent.getState();
      state1.isActive = true;

      const state2 = agent.getState();

      expect(state2.isActive).toBe(false);
    });

    it('should reflect state changes after execution', async () => {
      await agent.executeWithRetry({ type: 'test', input: 'test' });

      const state = agent.getState();

      expect(state.isActive).toBe(false);
      expect(state.lastExecutionTime).toBeGreaterThan(0);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      agent = new TestAgent('stats-agent');
    });

    it('should return initial stats with N/A values', () => {
      const stats = agent.getStats();

      expect(stats.totalExecutions).toBe(0);
      expect(stats.successfulExecutions).toBe(0);
      expect(stats.failedExecutions).toBe(0);
      expect(stats.totalTime).toBe(0);
      expect(stats.averageTime).toBe(0);
      expect(stats.successRate).toBe('N/A');
    });

    it('should calculate average time after executions', async () => {
      await agent.executeWithRetry({ type: 'test1' });
      await agent.executeWithRetry({ type: 'test2' });

      const stats = agent.getStats();

      expect(stats.totalExecutions).toBe(2);
      expect(stats.averageTime).toBeGreaterThan(0);
      expect(stats.totalTime).toBeGreaterThan(0);
    });

    it('should calculate success rate', async () => {
      await agent.executeWithRetry({ type: 'test1' });
      await agent.executeWithRetry({ type: 'test2' });

      const stats = agent.getStats();

      expect(stats.successRate).toBe('100.00%');
    });

    it('should track failed executions', async () => {
      agent = new TestAgent('fail-stats-agent', {
        shouldFail: true,
        maxRetries: 1,
        retryDelay: 10
      });

      await expect(agent.executeWithRetry({ type: 'test' })).rejects.toThrow();

      const stats = agent.getStats();

      expect(stats.totalExecutions).toBe(1);
      expect(stats.failedExecutions).toBe(1);
      expect(stats.successfulExecutions).toBe(0);
      expect(stats.successRate).toBe('0.00%');
    });

    it('should calculate mixed success rate', async () => {
      let shouldFail = false;

      class MixedAgent extends SpecializedAgent {
        async execute() {
          if (shouldFail) {
            throw new Error('Failed');
          }
          return { success: true };
        }
      }

      agent = new MixedAgent('mixed-agent', { maxRetries: 1, retryDelay: 10 });

      // 2 successes
      await agent.executeWithRetry({ type: 'test1' });
      await agent.executeWithRetry({ type: 'test2' });

      // 1 failure
      shouldFail = true;
      await expect(agent.executeWithRetry({ type: 'test3' })).rejects.toThrow();

      const stats = agent.getStats();

      expect(stats.totalExecutions).toBe(3);
      expect(stats.successfulExecutions).toBe(2);
      expect(stats.failedExecutions).toBe(1);
      expect(stats.successRate).toBe('66.67%');
    });
  });

  describe('getInfo', () => {
    beforeEach(() => {
      agent = new TestAgent('info-agent', {
        capabilities: ['code-generation'],
        description: 'Test Agent for Info',
        priority: 7
      });
    });

    it('should return complete agent information', () => {
      const info = agent.getInfo();

      expect(info.agentId).toBe('info-agent');
      expect(info.description).toBe('Test Agent for Info');
      expect(info.capabilities).toEqual(['code-generation']);
      expect(info.priority).toBe(7);
      expect(info.state).toBeDefined();
      expect(info.stats).toBeDefined();
    });

    it('should include current state in info', () => {
      const info = agent.getInfo();

      expect(info.state.isActive).toBe(false);
      expect(info.state.currentTask).toBeNull();
    });

    it('should include stats in info', () => {
      const info = agent.getInfo();

      expect(info.stats.totalExecutions).toBe(0);
      expect(info.stats.successRate).toBe('N/A');
    });

    it('should reflect updated stats after execution', async () => {
      await agent.executeWithRetry({ type: 'test' });

      const info = agent.getInfo();

      expect(info.stats.totalExecutions).toBe(1);
      expect(info.stats.successfulExecutions).toBe(1);
      expect(info.state.lastExecutionTime).toBeGreaterThan(0);
    });
  });

  describe('destroy', () => {
    beforeEach(() => {
      agent = new TestAgent('destroy-agent');
    });

    it('should remove all event listeners', () => {
      agent.on('test-event', () => {});
      agent.on('another-event', () => {});

      expect(agent.listenerCount('test-event')).toBe(1);
      expect(agent.listenerCount('another-event')).toBe(1);

      agent.destroy();

      expect(agent.listenerCount('test-event')).toBe(0);
      expect(agent.listenerCount('another-event')).toBe(0);
    });

    it('should clear LLM manager reference', () => {
      agent.setLLMManager(mockLLMManager);
      expect(agent.llmManager).not.toBeNull();

      agent.destroy();

      expect(agent.llmManager).toBeNull();
    });

    it('should clear FunctionCaller reference', () => {
      agent.setFunctionCaller(mockFunctionCaller);
      expect(agent.functionCaller).not.toBeNull();

      agent.destroy();

      expect(agent.functionCaller).toBeNull();
    });

    it('should allow multiple destroy calls', () => {
      agent.destroy();
      agent.destroy();

      expect(agent.llmManager).toBeNull();
      expect(agent.functionCaller).toBeNull();
    });
  });

  describe('EventEmitter Integration', () => {
    beforeEach(() => {
      agent = new TestAgent('event-agent');
    });

    it('should inherit from EventEmitter', () => {
      expect(agent.on).toBeDefined();
      expect(agent.emit).toBeDefined();
      expect(agent.removeListener).toBeDefined();
    });

    it('should emit and handle custom events', () => {
      const handler = vi.fn();
      agent.on('custom-event', handler);

      agent.emit('custom-event', { data: 'test' });

      expect(handler).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should allow multiple event listeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      agent.on('event', handler1);
      agent.on('event', handler2);

      agent.emit('event', 'data');

      expect(handler1).toHaveBeenCalledWith('data');
      expect(handler2).toHaveBeenCalledWith('data');
    });
  });
});
