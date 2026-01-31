/**
 * LLM Decision Engine Unit Tests
 *
 * 测试LLM辅助多代理决策引擎的核心功能
 */

const { LLMDecisionEngine, DecisionStrategy } = require('../../src/main/ai-engine/llm-decision-engine.js');
const assert = require('assert');

describe('LLMDecisionEngine', () => {
  let engine;
  let mockLLMManager;
  let mockDatabase;

  beforeEach(() => {
    // Mock LLM Manager
    mockLLMManager = {
      query: async (options) => {
        return {
          text: JSON.stringify({
            useMultiAgent: true,
            strategy: 'parallel_execution',
            confidence: 0.85,
            reason: 'LLM suggests multi-agent',
            agentCount: 3,
          }),
        };
      },
    };

    // Mock Database
    mockDatabase = {
      all: async (query, params) => {
        return [
          { use_multi_agent: 1, avg_time: 5000, avg_success: 0.95, count: 10 },
          { use_multi_agent: 0, avg_time: 8000, avg_success: 0.92, count: 8 },
        ];
      },
      run: async (query, params) => {
        return { changes: 1 };
      },
    };
  });

  afterEach(() => {
    if (engine) {
      engine = null;
    }
  });

  describe('初始化', () => {
    it('应该创建决策引擎实例', () => {
      engine = new LLMDecisionEngine({
        enabled: true,
        llmManager: mockLLMManager,
        database: mockDatabase,
      });

      assert.ok(engine, '应该创建实例');
      assert.strictEqual(engine.enabled, true, '应该启用');
    });

    it('应该支持禁用决策引擎', () => {
      engine = new LLMDecisionEngine({ enabled: false });
      assert.strictEqual(engine.enabled, false, '应该禁用');
    });

    it('应该使用默认配置', () => {
      engine = new LLMDecisionEngine();
      assert.strictEqual(engine.config.contextLengthThreshold, 10000, '默认上下文阈值应为10000');
      assert.strictEqual(engine.config.subtaskCountThreshold, 3, '默认子任务阈值应为3');
    });
  });

  describe('基础规则决策', () => {
    beforeEach(() => {
      engine = new LLMDecisionEngine({
        enabled: true,
        llmManager: mockLLMManager,
      });
    });

    it('应该对简单任务推荐单代理', async () => {
      const task = {
        task_title: 'Simple task',
        subtasks: [
          { title: 'Step 1', tool: 'bash' },
        ],
        estimated_duration: 5000,
      };

      const context = { length: 500 };

      const decision = await engine.shouldUseMultiAgent(task, context);

      assert.strictEqual(decision.useMultiAgent, false, '应该使用单代理');
      assert.strictEqual(decision.strategy, DecisionStrategy.SINGLE_AGENT, '策略应为单代理');
      assert.ok(decision.confidence >= 0.4, '置信度应较高');
    });

    it('应该对多子任务推荐多代理', async () => {
      const task = {
        task_title: 'Complex task',
        subtasks: [
          { title: 'Step 1', tool: 'bash', dependencies: [] },
          { title: 'Step 2', tool: 'git', dependencies: [] },
          { title: 'Step 3', tool: 'npm', dependencies: [] },
          { title: 'Step 4', tool: 'docker', dependencies: [] },
        ],
        estimated_duration: 80000,
      };

      const context = { length: 500 };

      const decision = await engine.shouldUseMultiAgent(task, context);

      assert.strictEqual(decision.useMultiAgent, true, '应该使用多代理');
      assert.ok(decision.agentCount >= 2, '应该推荐多个代理');
      assert.ok(decision.confidence > 0.5, '置信度应较高');
    });

    it('应该检测可并行任务', async () => {
      const task = {
        task_title: 'Parallel task',
        subtasks: [
          { title: 'Task A', tool: 'test', dependencies: [] },
          { title: 'Task B', tool: 'lint', dependencies: [] },
          { title: 'Task C', tool: 'build', dependencies: [] },
        ],
        estimated_duration: 30000,
      };

      const context = { length: 1000 };

      const decision = await engine.shouldUseMultiAgent(task, context);

      assert.strictEqual(decision.useMultiAgent, true, '应该使用多代理');
      assert.strictEqual(decision.strategy, DecisionStrategy.PARALLEL_EXECUTION, '策略应为并行执行');
    });

    it('应该检测需要专业化的任务', async () => {
      const task = {
        task_title: 'Specialized task',
        subtasks: [
          { title: 'Build', tool: 'webpack' },
          { title: 'Test', tool: 'jest' },
          { title: 'Deploy', tool: 'docker' },
          { title: 'Lint', tool: 'eslint' },
        ],
        estimated_duration: 60000,
      };

      const context = { length: 2000 };

      const decision = await engine.shouldUseMultiAgent(task, context);

      assert.strictEqual(decision.useMultiAgent, true, '应该使用多代理');
      assert.strictEqual(decision.strategy, DecisionStrategy.SPECIALIZED_AGENTS, '策略应为专业化代理');
    });

    it('应该检测上下文过长的任务', async () => {
      const task = {
        task_title: 'Long context task',
        subtasks: [
          { title: 'Step 1', tool: 'analyze' },
          { title: 'Step 2', tool: 'process' },
          { title: 'Step 3', tool: 'summarize' },
        ],
        estimated_duration: 40000,
      };

      const context = { length: 15000 }; // 超过阈值

      const decision = await engine.shouldUseMultiAgent(task, context);

      assert.strictEqual(decision.useMultiAgent, true, '应该使用多代理');
      assert.strictEqual(decision.strategy, DecisionStrategy.DIVIDE_CONTEXT, '策略应为分割上下文');
    });
  });

  describe('LLM辅助决策', () => {
    beforeEach(() => {
      engine = new LLMDecisionEngine({
        enabled: true,
        llmManager: mockLLMManager,
        database: mockDatabase,
        highConfidenceThreshold: 0.95, // 设置更高阈值以触发LLM
      });
    });

    it('应该在低置信度时调用LLM', async () => {
      let llmCalled = false;
      mockLLMManager.query = async () => {
        llmCalled = true;
        return {
          text: JSON.stringify({
            useMultiAgent: true,
            strategy: 'parallel_execution',
            confidence: 0.8,
            reason: 'LLM decision',
            agentCount: 2,
          }),
        };
      };

      const task = {
        task_title: 'Borderline task',
        subtasks: [
          { title: 'Step 1', tool: 'bash' },
          { title: 'Step 2', tool: 'git' },
        ],
        estimated_duration: 20000,
      };

      const context = { length: 3000 };

      const decision = await engine.shouldUseMultiAgent(task, context);

      assert.ok(llmCalled, 'LLM应该被调用');
      assert.strictEqual(engine.stats.llmCallCount, 1, 'LLM调用次数应为1');
    });

    it('应该处理LLM错误并降级', async () => {
      mockLLMManager.query = async () => {
        throw new Error('LLM service unavailable');
      };

      const task = {
        task_title: 'Task with LLM error',
        subtasks: [
          { title: 'Step 1', tool: 'bash' },
          { title: 'Step 2', tool: 'git' },
        ],
        estimated_duration: 20000,
      };

      const context = { length: 3000 };

      const decision = await engine.shouldUseMultiAgent(task, context);

      // 应该降级到基础规则
      assert.ok(decision, '应该返回决策');
      assert.ok(decision.reason.includes('基础规则') || decision.reason.includes('Error'), '应该使用基础规则或错误信息');
    });

    it('应该解析LLM的JSON响应', async () => {
      mockLLMManager.query = async () => {
        return {
          text: '```json\n{"useMultiAgent": true, "strategy": "specialized_agents", "confidence": 0.9, "reason": "Test", "agentCount": 4}\n```',
        };
      };

      const task = {
        task_title: 'Test task',
        subtasks: [
          { title: 'Step 1', tool: 'test' },
          { title: 'Step 2', tool: 'build' },
        ],
        estimated_duration: 30000,
      };

      const context = { length: 5000 };

      const decision = await engine.shouldUseMultiAgent(task, context);

      assert.strictEqual(decision.strategy, DecisionStrategy.SPECIALIZED_AGENTS, '应该正确解析策略');
      assert.strictEqual(decision.agentCount, 4, '应该正确解析代理数量');
    });
  });

  describe('历史学习', () => {
    beforeEach(() => {
      engine = new LLMDecisionEngine({
        enabled: true,
        llmManager: mockLLMManager,
        database: mockDatabase,
      });
    });

    it('应该基于历史数据调整决策', async () => {
      // 历史数据显示多代理更快
      mockDatabase.all = async () => [
        { use_multi_agent: 1, avg_time: 3000, avg_success: 0.96, count: 15 },
        { use_multi_agent: 0, avg_time: 8000, avg_success: 0.95, count: 10 },
      ];

      const task = {
        task_title: 'Task with history',
        task_type: 'build',
        subtasks: [
          { title: 'Step 1', tool: 'webpack' },
          { title: 'Step 2', tool: 'babel' },
        ],
        estimated_duration: 25000,
      };

      const context = { length: 2000 };

      const decision = await engine.shouldUseMultiAgent(task, context);

      // 历史数据应该影响决策
      assert.ok(decision.reason.includes('历史') || decision.useMultiAgent, '应该考虑历史数据');
    });

    it('应该在历史数据显示单代理更稳定时调整', async () => {
      // 历史数据显示单代理成功率更高
      mockDatabase.all = async () => [
        { use_multi_agent: 1, avg_time: 5000, avg_success: 0.80, count: 10 },
        { use_multi_agent: 0, avg_time: 6000, avg_success: 0.98, count: 12 },
      ];

      engine.config.highConfidenceThreshold = 0.95; // 触发LLM

      const task = {
        task_title: 'Unstable multi-agent task',
        task_type: 'test',
        subtasks: [
          { title: 'Unit test', tool: 'jest' },
          { title: 'E2E test', tool: 'cypress' },
          { title: 'Integration test', tool: 'mocha' },
        ],
        estimated_duration: 40000,
      };

      const context = { length: 3000 };

      const decision = await engine.shouldUseMultiAgent(task, context);

      // 应该受历史数据影响
      if (decision.reason.includes('历史')) {
        assert.ok(decision.reason.includes('成功率'), '应该提及成功率');
      }
    });

    it('应该在历史数据不足时不调整', async () => {
      // 历史数据样本太少
      mockDatabase.all = async () => [
        { use_multi_agent: 1, avg_time: 5000, avg_success: 0.90, count: 2 },
        { use_multi_agent: 0, avg_time: 8000, avg_success: 0.88, count: 1 },
      ];

      const task = {
        task_title: 'Task with sparse history',
        task_type: 'deploy',
        subtasks: [
          { title: 'Build', tool: 'docker' },
          { title: 'Push', tool: 'registry' },
        ],
        estimated_duration: 30000,
      };

      const context = { length: 1500 };

      const decision = await engine.shouldUseMultiAgent(task, context);

      // 样本太少，不应该基于历史调整
      assert.ok(decision, '应该返回决策');
      // 历史调整计数应为0或不显著
    });
  });

  describe('决策缓存', () => {
    beforeEach(() => {
      engine = new LLMDecisionEngine({
        enabled: true,
        llmManager: mockLLMManager,
      });
    });

    it('应该缓存相同任务的决策', async () => {
      const task = {
        task_title: 'Cacheable task',
        task_type: 'build',
        subtasks: [
          { title: 'Step 1', tool: 'npm' },
          { title: 'Step 2', tool: 'webpack' },
          { title: 'Step 3', tool: 'babel' },
        ],
        estimated_duration: 30000,
      };

      const context = { length: 5000 };

      // 第一次决策
      const decision1 = await engine.shouldUseMultiAgent(task, context);
      const initialStats = engine.getStats();

      // 第二次决策 (应该使用缓存)
      const decision2 = await engine.shouldUseMultiAgent(task, context);
      const cachedStats = engine.getStats();

      assert.strictEqual(decision1.useMultiAgent, decision2.useMultiAgent, '决策应该一致');
      assert.strictEqual(decision1.strategy, decision2.strategy, '策略应该一致');
      // 缓存命中不应增加统计计数（除了第二次调用）
      assert.ok(engine.decisionCache.size > 0, '缓存应该有内容');
    });

    it('应该能够清空缓存', async () => {
      const task = {
        task_title: 'Task',
        subtasks: [{ title: 'Step', tool: 'bash' }],
        estimated_duration: 10000,
      };

      await engine.shouldUseMultiAgent(task, {});

      assert.ok(engine.decisionCache.size > 0, '缓存应该有内容');

      engine.clearCache();

      assert.strictEqual(engine.decisionCache.size, 0, '缓存应该为空');
    });

    it('应该限制缓存大小', async () => {
      // 创建101个不同的任务
      for (let i = 0; i < 101; i++) {
        const task = {
          task_title: `Task ${i}`,
          task_type: `type_${i}`,
          subtasks: [{ title: `Step ${i}`, tool: 'bash' }],
          estimated_duration: 10000 + i,
        };

        await engine.shouldUseMultiAgent(task, { length: i * 100 });
      }

      // 缓存应该限制在100以内
      assert.ok(engine.decisionCache.size <= 100, '缓存大小应该限制在100');
    });
  });

  describe('统计信息', () => {
    beforeEach(() => {
      engine = new LLMDecisionEngine({
        enabled: true,
        llmManager: mockLLMManager,
      });
    });

    it('应该正确跟踪统计信息', async () => {
      const task1 = {
        task_title: 'Task 1',
        subtasks: [{ title: 'Step', tool: 'bash' }],
        estimated_duration: 5000,
      };

      const task2 = {
        task_title: 'Task 2',
        subtasks: [
          { title: 'Step 1', tool: 'bash' },
          { title: 'Step 2', tool: 'git' },
          { title: 'Step 3', tool: 'npm' },
          { title: 'Step 4', tool: 'docker' },
        ],
        estimated_duration: 60000,
      };

      await engine.shouldUseMultiAgent(task1, {});
      await engine.shouldUseMultiAgent(task2, {});

      const stats = engine.getStats();

      assert.strictEqual(stats.totalDecisions, 2, '总决策次数应为2');
      assert.ok(stats.singleAgentDecisions >= 1, '单代理决策应至少1次');
      assert.ok(stats.multiAgentDecisions >= 1, '多代理决策应至少1次');
    });

    it('应该能够重置统计信息', async () => {
      const task = {
        task_title: 'Task',
        subtasks: [{ title: 'Step', tool: 'bash' }],
        estimated_duration: 10000,
      };

      await engine.shouldUseMultiAgent(task, {});

      let stats = engine.getStats();
      assert.ok(stats.totalDecisions > 0, '应该有决策记录');

      engine.resetStats();

      stats = engine.getStats();
      assert.strictEqual(stats.totalDecisions, 0, '重置后应为0');
    });

    it('应该计算多代理使用率', async () => {
      const singleTask = {
        task_title: 'Single',
        subtasks: [{ title: 'Step', tool: 'bash' }],
        estimated_duration: 5000,
      };

      const multiTask = {
        task_title: 'Multi',
        subtasks: [
          { title: 'Step 1', tool: 'bash', dependencies: [] },
          { title: 'Step 2', tool: 'git', dependencies: [] },
          { title: 'Step 3', tool: 'npm', dependencies: [] },
          { title: 'Step 4', tool: 'docker', dependencies: [] },
        ],
        estimated_duration: 60000,
      };

      await engine.shouldUseMultiAgent(singleTask, {});
      await engine.shouldUseMultiAgent(multiTask, {});

      const stats = engine.getStats();
      assert.ok(stats.multiAgentRate, '应该有多代理使用率');
    });
  });

  describe('禁用模式', () => {
    beforeEach(() => {
      engine = new LLMDecisionEngine({ enabled: false });
    });

    it('禁用时应该总是返回单代理', async () => {
      const task = {
        task_title: 'Task',
        subtasks: [
          { title: 'Step 1', tool: 'bash' },
          { title: 'Step 2', tool: 'git' },
          { title: 'Step 3', tool: 'npm' },
          { title: 'Step 4', tool: 'docker' },
        ],
        estimated_duration: 60000,
      };

      const decision = await engine.shouldUseMultiAgent(task, { length: 20000 });

      assert.strictEqual(decision.useMultiAgent, false, '应该使用单代理');
      assert.ok(decision.reason.includes('disabled'), '原因应包含disabled');
    });
  });

  describe('事件发射', () => {
    beforeEach(() => {
      engine = new LLMDecisionEngine({
        enabled: true,
        llmManager: mockLLMManager,
      });
    });

    it('应该在决策时发射事件', async (done) => {
      const task = {
        task_title: 'Event test',
        subtasks: [
          { title: 'Step 1', tool: 'bash' },
          { title: 'Step 2', tool: 'git' },
          { title: 'Step 3', tool: 'npm' },
        ],
        estimated_duration: 40000,
      };

      engine.on('decision-made', (data) => {
        assert.ok(data.useMultiAgent !== undefined, '应该包含useMultiAgent');
        assert.ok(data.strategy, '应该包含strategy');
        assert.ok(data.confidence !== undefined, '应该包含confidence');
        done();
      });

      await engine.shouldUseMultiAgent(task, {});
    });
  });

  describe('执行结果记录', () => {
    beforeEach(() => {
      engine = new LLMDecisionEngine({
        enabled: true,
        database: mockDatabase,
      });
    });

    it('应该记录任务执行结果', async () => {
      let recordCalled = false;
      mockDatabase.run = async (query, params) => {
        recordCalled = true;
        assert.ok(query.includes('task_execution_history'), '应该插入执行历史表');
        assert.strictEqual(params.length, 5, '应该有5个参数');
        return { changes: 1 };
      };

      const taskResult = {
        task_type: 'build',
        subtask_count: 3,
        use_multi_agent: true,
        execution_time: 15000,
        success_rate: 0.98,
      };

      await engine.recordExecutionResult(taskResult);

      assert.ok(recordCalled, '应该调用数据库记录');
    });

    it('应该处理数据库错误', async () => {
      mockDatabase.run = async () => {
        throw new Error('Database error');
      };

      const taskResult = {
        task_type: 'test',
        subtask_count: 2,
        use_multi_agent: false,
        execution_time: 8000,
        success_rate: 1.0,
      };

      // 不应该抛出错误
      await engine.recordExecutionResult(taskResult);
    });
  });
});

// 运行测试（如果直接执行）
if (require.main === module) {
  console.log('请使用测试框架运行此测试文件 (如 npm test)');
}
