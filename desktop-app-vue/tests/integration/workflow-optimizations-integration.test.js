/**
 * Workflow Optimizations - Integration Tests
 *
 * 集成测试，验证所有17个优化协同工作
 */

const assert = require('assert');
const { SmartPlanCache } = require('../../src/main/ai-engine/smart-plan-cache.js');
const { LLMDecisionEngine } = require('../../src/main/ai-engine/llm-decision-engine.js');
const { AgentPool } = require('../../src/main/ai-engine/cowork/agent-pool.js');
const { CriticalPathOptimizer } = require('../../src/main/ai-engine/critical-path-optimizer.js');
const { RealTimeQualityGate } = require('../../src/main/ai-engine/real-time-quality-gate.js');

// Mock LLM Manager
class MockLLMManager {
  async query({ prompt }) {
    if (prompt.includes('决策专家')) {
      return {
        text: JSON.stringify({
          useMultiAgent: true,
          strategy: 'parallel_execution',
          confidence: 0.85,
          reason: 'Test decision',
          agentCount: 3,
        }),
      };
    }
    return { text: 'Test response' };
  }

  async embed(text) {
    return Array.from({ length: 384 }, () => Math.random());
  }
}

// Mock Database
class MockDatabase {
  async all(query, params) {
    if (query.includes('task_execution_history')) {
      return [
        { use_multi_agent: 1, avg_time: 5000, avg_success: 0.95, count: 10 },
        { use_multi_agent: 0, avg_time: 8000, avg_success: 0.92, count: 8 },
      ];
    }
    return [];
  }

  async run(query, params) {
    return { changes: 1 };
  }
}

describe('Workflow Optimizations - Integration Tests', () => {
  let llmManager;
  let database;
  let planCache;
  let decisionEngine;
  let agentPool;
  let criticalPathOptimizer;
  let qualityGate;

  before(() => {
    llmManager = new MockLLMManager();
    database = new MockDatabase();
  });

  beforeEach(() => {
    planCache = new SmartPlanCache({
      enabled: true,
      llmManager: llmManager,
      useEmbedding: false, // 使用TF-IDF
    });

    decisionEngine = new LLMDecisionEngine({
      enabled: true,
      llmManager: llmManager,
      database: database,
    });

    agentPool = new AgentPool({
      minSize: 2,
      maxSize: 5,
      warmupOnInit: false,
    });

    criticalPathOptimizer = new CriticalPathOptimizer({
      enabled: true,
    });

    qualityGate = new RealTimeQualityGate({
      enabled: false, // 测试中禁用文件监控
    });
  });

  afterEach(async () => {
    if (agentPool) {
      await agentPool.shutdown();
    }
  });

  describe('端到端工作流', () => {
    it('应该完成完整的CI/CD流程', async function() {
      this.timeout(10000);

      // Step 1: 任务规划（带缓存）
      const request1 = '实现CI/CD流程';
      const plan1 = await planCache.get(request1);
      assert.strictEqual(plan1, null, '首次应该未命中缓存');

      // 模拟规划结果
      const planResult = {
        tasks: [
          { id: 'install', title: 'Install deps', dependencies: [] },
          { id: 'test', title: 'Run tests', dependencies: ['install'] },
          { id: 'build', title: 'Build app', dependencies: ['install'] },
          { id: 'deploy', title: 'Deploy', dependencies: ['test', 'build'] },
        ],
      };

      await planCache.set(request1, planResult);

      // 第二次应该命中缓存
      const plan2 = await planCache.get(request1);
      assert.ok(plan2, '第二次应该命中缓存');
      assert.strictEqual(plan2.tasks.length, 4, '应该返回4个任务');

      // Step 2: 多代理决策
      const decision = await decisionEngine.shouldUseMultiAgent(
        {
          task_title: 'CI/CD Pipeline',
          subtasks: planResult.tasks,
          estimated_duration: 100000,
          task_type: 'cicd',
        },
        { length: 5000 }
      );

      assert.ok(decision, '应该返回决策');
      assert.ok(typeof decision.useMultiAgent === 'boolean', '应该包含useMultiAgent');
      assert.ok(decision.strategy, '应该包含策略');

      // Step 3: 代理池获取（如果使用多代理）
      if (decision.useMultiAgent) {
        const agents = [];

        for (let i = 0; i < decision.agentCount; i++) {
          const agent = await agentPool.acquireAgent();
          agents.push(agent);
          assert.ok(agent.id, '代理应该有ID');
        }

        assert.strictEqual(agents.length, decision.agentCount, '应该获取正确数量的代理');

        // 释放代理
        for (const agent of agents) {
          agentPool.releaseAgent(agent.id);
        }
      }

      // Step 4: 关键路径优化
      const tasksWithDuration = planResult.tasks.map(t => ({
        ...t,
        duration: 5000 + Math.random() * 5000,
      }));

      const optimizedTasks = criticalPathOptimizer.optimize(tasksWithDuration);
      assert.ok(optimizedTasks, '应该返回优化后的任务');
      assert.strictEqual(optimizedTasks.length, tasksWithDuration.length, '任务数量应该一致');

      console.log('  ✅ 完整CI/CD流程测试通过');
    });

    it('应该正确处理缓存和决策的协同', async function() {
      this.timeout(5000);

      // 多次规划相似任务
      const requests = [
        '实现用户登录功能',
        '实现用户登录模块',
        '实现用户登录系统',
      ];

      let cacheHits = 0;

      for (const req of requests) {
        const cached = await planCache.get(req);

        if (cached) {
          cacheHits++;
        } else {
          const plan = {
            tasks: [
              { id: 'task1', title: 'Login UI' },
              { id: 'task2', title: 'Auth API' },
            ],
          };
          await planCache.set(req, plan);
        }

        // 每次都进行决策
        const decision = await decisionEngine.shouldUseMultiAgent(
          {
            task_title: req,
            subtasks: [{ title: 'Login UI' }, { title: 'Auth API' }],
            estimated_duration: 30000,
          },
          { length: 2000 }
        );

        assert.ok(decision, '应该返回决策');
      }

      // TF-IDF应该能识别相似度
      assert.ok(cacheHits > 0, '应该有缓存命中');

      const stats = planCache.getStats();
      console.log(`  ℹ️  缓存统计: ${stats.hits}次命中, ${stats.misses}次未命中`);
    });

    it('应该正确处理代理池和关键路径的协同', async function() {
      this.timeout(5000);

      // 创建复杂任务图
      const tasks = [
        { id: 't1', duration: 1000, dependencies: [] },
        { id: 't2', duration: 2000, dependencies: [] },
        { id: 't3', duration: 1500, dependencies: ['t1'] },
        { id: 't4', duration: 2500, dependencies: ['t1', 't2'] },
        { id: 't5', duration: 1000, dependencies: ['t3', 't4'] },
      ];

      // 优化任务执行顺序
      const optimizedTasks = criticalPathOptimizer.optimize(tasks);

      // 模拟并行执行
      const parallelGroups = [];
      const executed = new Set();

      // 找出可以并行执行的任务组
      while (executed.size < optimizedTasks.length) {
        const ready = optimizedTasks.filter(t =>
          !executed.has(t.id) &&
          t.dependencies.every(depId => executed.has(depId))
        );

        if (ready.length === 0) break;

        parallelGroups.push(ready);

        // 获取代理执行这组任务
        const agents = [];
        for (let i = 0; i < Math.min(ready.length, 3); i++) {
          const agent = await agentPool.acquireAgent();
          agents.push(agent);
        }

        // 标记为已执行
        ready.forEach(t => executed.add(t.id));

        // 释放代理
        agents.forEach(agent => agentPool.releaseAgent(agent.id));
      }

      assert.ok(parallelGroups.length > 0, '应该有并行执行组');
      assert.strictEqual(executed.size, tasks.length, '所有任务应该被执行');

      console.log(`  ℹ️  并行组数量: ${parallelGroups.length}`);
    });
  });

  describe('性能验证', () => {
    it('智能缓存应该显著减少规划时间', async function() {
      this.timeout(5000);

      const request = '实现完整的认证系统';

      // 首次规划（未命中）
      const start1 = Date.now();
      let plan = await planCache.get(request);
      if (!plan) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 模拟规划耗时
        plan = { tasks: [{ id: '1', title: 'Auth' }] };
        await planCache.set(request, plan);
      }
      const duration1 = Date.now() - start1;

      // 第二次规划（命中）
      const start2 = Date.now();
      const cachedPlan = await planCache.get(request);
      const duration2 = Date.now() - start2;

      assert.ok(cachedPlan, '应该命中缓存');
      assert.ok(duration2 < duration1 * 0.5, '缓存命中应该更快');

      console.log(`  ℹ️  首次: ${duration1}ms, 缓存: ${duration2}ms`);
    });

    it('代理池应该显著减少获取时间', async function() {
      this.timeout(5000);

      // 预热池
      await agentPool.warmup(2);

      // 首次获取（池中已有）
      const start1 = Date.now();
      const agent1 = await agentPool.acquireAgent();
      const duration1 = Date.now() - start1;
      agentPool.releaseAgent(agent1.id);

      // 第二次获取（复用）
      const start2 = Date.now();
      const agent2 = await agentPool.acquireAgent();
      const duration2 = Date.now() - start2;
      agentPool.releaseAgent(agent2.id);

      assert.ok(duration1 < 50, '池中获取应该很快');
      assert.ok(duration2 < 50, '复用获取应该很快');

      const stats = agentPool.getStats();
      assert.ok(stats.reused > 0, '应该有复用记录');

      console.log(`  ℹ️  获取时间: ${duration1}ms, ${duration2}ms`);
      console.log(`  ℹ️  复用率: ${stats.reuseRate}`);
    });

    it('关键路径优化应该减少总执行时间', async function() {
      this.timeout(3000);

      const tasks = [
        { id: 'install', duration: 5000, dependencies: [] },
        { id: 'lint', duration: 2000, dependencies: ['install'] },
        { id: 'test', duration: 10000, dependencies: ['install'] },
        { id: 'build', duration: 8000, dependencies: ['install'] },
        { id: 'deploy', duration: 3000, dependencies: ['lint', 'test', 'build'] },
      ];

      // 优化前的估算（串行）
      const sequentialTime = tasks.reduce((sum, t) => sum + t.duration, 0);

      // 优化后
      const optimizedTasks = criticalPathOptimizer.optimize(tasks);

      // 找到关键路径长度
      const criticalPathLength = Math.max(
        ...optimizedTasks.map(t => t.earliestFinish || t.duration)
      );

      assert.ok(criticalPathLength < sequentialTime, '关键路径应该短于串行时间');

      const improvement = ((sequentialTime - criticalPathLength) / sequentialTime * 100).toFixed(2);
      console.log(`  ℹ️  时间减少: ${improvement}%`);
    });

    it('LLM决策引擎应该快速决策', async function() {
      this.timeout(3000);

      const task = {
        task_title: 'Performance Test',
        subtasks: [
          { title: 'Task 1', tool: 'bash' },
          { title: 'Task 2', tool: 'git' },
          { title: 'Task 3', tool: 'npm' },
        ],
        estimated_duration: 40000,
      };

      const start = Date.now();
      const decision = await decisionEngine.shouldUseMultiAgent(task, { length: 3000 });
      const duration = Date.now() - start;

      assert.ok(decision, '应该返回决策');
      assert.ok(duration < 500, '决策应该很快（<500ms）');

      const stats = decisionEngine.getStats();
      console.log(`  ℹ️  决策时间: ${duration}ms`);
      console.log(`  ℹ️  决策统计: ${stats.totalDecisions}次总决策`);
    });
  });

  describe('错误处理和降级', () => {
    it('缓存失效时应该正常工作', async function() {
      this.timeout(3000);

      // 创建一个会失败的LLM管理器
      const failingLLM = {
        async embed() {
          throw new Error('Embedding service unavailable');
        },
      };

      const cacheWithFailing = new SmartPlanCache({
        enabled: true,
        llmManager: failingLLM,
        useEmbedding: true, // 尝试使用embedding但会失败
      });

      const request = '测试请求';
      const plan = { tasks: [{ id: '1', title: 'Test' }] };

      // 应该降级到TF-IDF
      await cacheWithFailing.set(request, plan);
      const cached = await cacheWithFailing.get(request);

      assert.ok(cached, '应该能降级到TF-IDF');
    });

    it('决策引擎LLM失败时应该降级到规则', async function() {
      this.timeout(3000);

      const failingLLM = {
        async query() {
          throw new Error('LLM service unavailable');
        },
      };

      const engineWithFailing = new LLMDecisionEngine({
        enabled: true,
        llmManager: failingLLM,
        highConfidenceThreshold: 0.5, // 降低阈值以触发LLM
      });

      const task = {
        task_title: 'Test Task',
        subtasks: [
          { title: 'Task 1', tool: 'bash' },
          { title: 'Task 2', tool: 'git' },
        ],
        estimated_duration: 25000,
      };

      // 应该降级到基础规则
      const decision = await engineWithFailing.shouldUseMultiAgent(task, { length: 3000 });

      assert.ok(decision, '应该返回决策');
      assert.ok(decision.reason.includes('基础规则'), '应该使用基础规则');
    });

    it('代理池满时应该正确排队', async function() {
      this.timeout(5000);

      const smallPool = new AgentPool({
        minSize: 0,
        maxSize: 2,
        warmupOnInit: false,
      });

      try {
        // 获取2个代理（填满池）
        const agent1 = await smallPool.acquireAgent();
        const agent2 = await smallPool.acquireAgent();

        // 尝试获取第3个（应该排队）
        const acquireStart = Date.now();

        const acquirePromise = smallPool.acquireAgent({ timeout: 2000 });

        // 1秒后释放一个
        setTimeout(() => {
          smallPool.releaseAgent(agent1.id);
        }, 1000);

        const agent3 = await acquirePromise;
        const acquireDuration = Date.now() - acquireStart;

        assert.ok(agent3, '应该最终获取到代理');
        assert.ok(acquireDuration >= 1000, '应该等待释放');
        assert.ok(acquireDuration < 1500, '不应该等太久');

        // 清理
        smallPool.releaseAgent(agent2.id);
        smallPool.releaseAgent(agent3.id);

      } finally {
        await smallPool.shutdown();
      }
    });
  });

  describe('统计和监控', () => {
    it('所有组件应该提供统计信息', async function() {
      this.timeout(3000);

      // 执行一些操作
      await planCache.set('test1', { tasks: [] });
      await planCache.get('test1');

      await decisionEngine.shouldUseMultiAgent(
        { task_title: 'Test', subtasks: [{ title: 'T1' }], estimated_duration: 10000 },
        { length: 1000 }
      );

      const agent = await agentPool.acquireAgent();
      agentPool.releaseAgent(agent.id);

      criticalPathOptimizer.optimize([
        { id: '1', duration: 1000, dependencies: [] },
      ]);

      // 获取统计
      const cacheStats = planCache.getStats();
      const decisionStats = decisionEngine.getStats();
      const poolStats = agentPool.getStats();
      const optimizerStats = criticalPathOptimizer.getStats();

      // 验证统计完整性
      assert.ok(cacheStats.hits !== undefined, '缓存应该有hits统计');
      assert.ok(cacheStats.misses !== undefined, '缓存应该有misses统计');

      assert.ok(decisionStats.totalDecisions !== undefined, '决策应该有总数统计');
      assert.ok(decisionStats.multiAgentRate !== undefined, '决策应该有多代理率');

      assert.ok(poolStats.created !== undefined, '代理池应该有创建统计');
      assert.ok(poolStats.reused !== undefined, '代理池应该有复用统计');

      assert.ok(optimizerStats.totalAnalyses !== undefined, '优化器应该有分析统计');

      console.log('  ✅ 所有组件统计验证通过');
    });
  });
});

// 运行测试（如果直接执行）
if (require.main === module) {
  console.log('请使用测试框架运行此测试文件 (如 npm test)');
}
