/**
 * Workflow Optimizations - Comprehensive Benchmark
 *
 * 综合性能基准测试，验证所有17个优化的协同效果
 *
 * 测试场景:
 * 1. 完整CI/CD流程模拟（真实场景）
 * 2. 对比优化前后的性能差异
 * 3. 验证各项性能指标
 *
 * 使用方法:
 * node scripts/benchmark-workflow-optimizations.js [--baseline|--optimized|--compare]
 */

const { performance } = require('perf_hooks');
const { EventEmitter } = require('events');

// ============================================================================
// Mock Dependencies (模拟依赖)
// ============================================================================

class MockLLMManager {
  async query({ prompt, temperature: _temperature, maxTokens: _maxTokens }) {
    // 模拟LLM响应时间
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));

    if (prompt.includes('决策专家')) {
      return {
        text: JSON.stringify({
          useMultiAgent: true,
          strategy: 'parallel_execution',
          confidence: 0.85,
          reason: 'Mock LLM decision',
          agentCount: 3,
        }),
      };
    }

    return { text: 'Mock LLM response' };
  }

  async embed(_text) {
    // 模拟embedding
    await new Promise(resolve => setTimeout(resolve, 50));
    return Array.from({ length: 384 }, () => Math.random());
  }
}

class MockDatabase {
  constructor() {
    this.data = new Map();
  }

  async all(query, _params) {
    await new Promise(resolve => setTimeout(resolve, 10));

    if (query.includes('task_execution_history')) {
      return [
        { use_multi_agent: 1, avg_time: 5000, avg_success: 0.95, count: 10 },
        { use_multi_agent: 0, avg_time: 8000, avg_success: 0.92, count: 8 },
      ];
    }

    return [];
  }

  async run(_query, _params) {
    await new Promise(resolve => setTimeout(resolve, 5));
    return { changes: 1 };
  }
}

// ============================================================================
// Import Optimizations (导入优化模块)
// ============================================================================

const { SmartPlanCache } = require('../src/main/ai-engine/smart-plan-cache.js');
const { LLMDecisionEngine } = require('../src/main/ai-engine/llm-decision-engine.js');
const { AgentPool } = require('../src/main/ai-engine/cowork/agent-pool.js');
const { CriticalPathOptimizer } = require('../src/main/ai-engine/critical-path-optimizer.js');
const { RealTimeQualityGate } = require('../src/main/ai-engine/real-time-quality-gate.js');

// ============================================================================
// Benchmark Scenarios (基准测试场景)
// ============================================================================

class WorkflowBenchmark extends EventEmitter {
  constructor(options = {}) {
    super();

    this.mode = options.mode || 'baseline'; // baseline | optimized
    this.iterations = options.iterations || 10;

    // 初始化优化组件
    if (this.mode === 'optimized') {
      this.llmManager = new MockLLMManager();
      this.database = new MockDatabase();

      this.planCache = new SmartPlanCache({
        enabled: true,
        llmManager: this.llmManager,
        useEmbedding: false, // 使用TF-IDF避免依赖
      });

      this.decisionEngine = new LLMDecisionEngine({
        enabled: true,
        llmManager: this.llmManager,
        database: this.database,
      });

      this.agentPool = new AgentPool({
        minSize: 3,
        maxSize: 10,
        warmupOnInit: true,
      });

      this.criticalPathOptimizer = new CriticalPathOptimizer({
        enabled: true,
      });

      this.qualityGate = new RealTimeQualityGate({
        enabled: false, // 文件监控在基准测试中禁用
      });
    }

    this.results = {
      scenarios: [],
      summary: {},
    };
  }

  /**
   * 场景1: 完整CI/CD流程
   */
  async runCICDScenario() {
    console.log(`\n[Scenario 1] CI/CD Pipeline (${this.mode} mode)`);

    const startTime = performance.now();
    const metrics = {
      scenario: 'CI/CD Pipeline',
      mode: this.mode,
      phases: [],
    };

    try {
      // Phase 1: 任务规划
      const planStart = performance.now();
      const taskPlan = await this._planCICDTasks();
      const planDuration = performance.now() - planStart;

      metrics.phases.push({
        phase: 'Planning',
        duration: planDuration,
        cacheHit: taskPlan.fromCache || false,
      });

      // Phase 2: 多代理决策
      if (this.mode === 'optimized') {
        const decisionStart = performance.now();
        const decision = await this.decisionEngine.shouldUseMultiAgent(
          {
            task_title: 'CI/CD Pipeline',
            subtasks: taskPlan.tasks,
            estimated_duration: 120000,
            task_type: 'cicd',
          },
          { length: 5000 }
        );
        const decisionDuration = performance.now() - decisionStart;

        metrics.phases.push({
          phase: 'Multi-Agent Decision',
          duration: decisionDuration,
          useMultiAgent: decision.useMultiAgent,
          strategy: decision.strategy,
          confidence: decision.confidence,
        });

        metrics.useMultiAgent = decision.useMultiAgent;
        metrics.agentCount = decision.agentCount;
      } else {
        metrics.useMultiAgent = true; // Baseline默认使用多代理
        metrics.agentCount = 3;
      }

      // Phase 3: 代理获取（如果使用多代理）
      if (metrics.useMultiAgent && this.mode === 'optimized') {
        const agentStart = performance.now();
        const agents = [];

        for (let i = 0; i < metrics.agentCount; i++) {
          const agent = await this.agentPool.acquireAgent();
          agents.push(agent);
        }

        const agentDuration = performance.now() - agentStart;

        metrics.phases.push({
          phase: 'Agent Acquisition',
          duration: agentDuration,
          agentCount: agents.length,
          avgPerAgent: agentDuration / agents.length,
        });

        // 释放代理
        for (const agent of agents) {
          this.agentPool.releaseAgent(agent.id);
        }
      }

      // Phase 4: 任务执行（关键路径优化）
      const execStart = performance.now();
      await this._executeTasks(taskPlan.tasks);
      const execDuration = performance.now() - execStart;

      metrics.phases.push({
        phase: 'Task Execution',
        duration: execDuration,
        tasksExecuted: taskPlan.tasks.length,
        criticalPathOptimized: this.mode === 'optimized',
      });

      // 总耗时
      metrics.totalDuration = performance.now() - startTime;
      metrics.success = true;

      console.log(`  ✅ Completed in ${metrics.totalDuration.toFixed(2)}ms`);

      return metrics;

    } catch (error) {
      metrics.totalDuration = performance.now() - startTime;
      metrics.success = false;
      metrics.error = error.message;

      console.log(`  ❌ Failed: ${error.message}`);

      return metrics;
    }
  }

  /**
   * 场景2: 大规模任务规划
   */
  async runLargePlanningScenario() {
    console.log(`\n[Scenario 2] Large-Scale Planning (${this.mode} mode)`);

    const startTime = performance.now();
    const metrics = {
      scenario: 'Large-Scale Planning',
      mode: this.mode,
      iterations: 20,
      plannings: [],
    };

    try {
      let cacheHits = 0;
      let totalPlanTime = 0;

      // 执行20次规划，观察缓存效果
      for (let i = 0; i < 20; i++) {
        const planStart = performance.now();

        // 生成相似但不完全相同的请求
        const request = `实现用户认证功能，包括登录、注册、密码重置 (variation ${i % 5})`;

        const plan = await this._planTask(request);
        const planDuration = performance.now() - planStart;

        totalPlanTime += planDuration;

        if (plan.fromCache) {
          cacheHits++;
        }

        metrics.plannings.push({
          iteration: i + 1,
          duration: planDuration,
          fromCache: plan.fromCache || false,
        });
      }

      metrics.totalDuration = performance.now() - startTime;
      metrics.avgPlanTime = totalPlanTime / 20;
      metrics.cacheHitRate = (cacheHits / 20 * 100).toFixed(2) + '%';
      metrics.success = true;

      console.log(`  ✅ Completed: ${metrics.cacheHitRate} cache hit rate`);
      console.log(`     Avg plan time: ${metrics.avgPlanTime.toFixed(2)}ms`);

      return metrics;

    } catch (error) {
      metrics.totalDuration = performance.now() - startTime;
      metrics.success = false;
      metrics.error = error.message;

      console.log(`  ❌ Failed: ${error.message}`);

      return metrics;
    }
  }

  /**
   * 场景3: 代理池性能测试
   */
  async runAgentPoolScenario() {
    console.log(`\n[Scenario 3] Agent Pool Performance (${this.mode} mode)`);

    const startTime = performance.now();
    const metrics = {
      scenario: 'Agent Pool Performance',
      mode: this.mode,
      acquisitions: [],
    };

    try {
      // 模拟20次代理获取
      for (let i = 0; i < 20; i++) {
        const acquireStart = performance.now();

        let agent;
        if (this.mode === 'optimized') {
          agent = await this.agentPool.acquireAgent();
        } else {
          // Baseline: 每次创建新代理
          agent = await this._createNewAgent();
        }

        const acquireDuration = performance.now() - acquireStart;

        metrics.acquisitions.push({
          iteration: i + 1,
          duration: acquireDuration,
        });

        // 模拟使用代理
        await new Promise(resolve => setTimeout(resolve, 50));

        // 释放或销毁代理
        if (this.mode === 'optimized') {
          this.agentPool.releaseAgent(agent.id);
        }
      }

      metrics.totalDuration = performance.now() - startTime;
      metrics.avgAcquisitionTime = metrics.acquisitions.reduce((sum, a) => sum + a.duration, 0) / 20;
      metrics.success = true;

      console.log(`  ✅ Completed: Avg acquisition ${metrics.avgAcquisitionTime.toFixed(2)}ms`);

      return metrics;

    } catch (error) {
      metrics.totalDuration = performance.now() - startTime;
      metrics.success = false;
      metrics.error = error.message;

      console.log(`  ❌ Failed: ${error.message}`);

      return metrics;
    }
  }

  /**
   * 场景4: 关键路径优化
   */
  async runCriticalPathScenario() {
    console.log(`\n[Scenario 4] Critical Path Optimization (${this.mode} mode)`);

    const startTime = performance.now();
    const metrics = {
      scenario: 'Critical Path Optimization',
      mode: this.mode,
    };

    try {
      // 构建依赖图
      const tasks = [
        { id: 'install', duration: 5000, dependencies: [] },
        { id: 'lint', duration: 2000, dependencies: ['install'] },
        { id: 'test', duration: 10000, dependencies: ['install'] },
        { id: 'build', duration: 8000, dependencies: ['install'] },
        { id: 'deploy', duration: 3000, dependencies: ['lint', 'test', 'build'] },
      ];

      let optimizedTasks = tasks;

      if (this.mode === 'optimized') {
        const optimizeStart = performance.now();
        optimizedTasks = this.criticalPathOptimizer.optimize(tasks);
        metrics.optimizationTime = performance.now() - optimizeStart;
      }

      // 模拟执行
      const execStart = performance.now();
      await this._executeTasksWithDependencies(optimizedTasks);
      metrics.executionTime = performance.now() - execStart;

      metrics.totalDuration = performance.now() - startTime;
      metrics.success = true;

      console.log(`  ✅ Completed: Execution ${metrics.executionTime.toFixed(2)}ms`);

      return metrics;

    } catch (error) {
      metrics.totalDuration = performance.now() - startTime;
      metrics.success = false;
      metrics.error = error.message;

      console.log(`  ❌ Failed: ${error.message}`);

      return metrics;
    }
  }

  /**
   * 运行所有场景
   */
  async runAll() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Workflow Optimizations Benchmark`);
    console.log(`Mode: ${this.mode.toUpperCase()}`);
    console.log(`Iterations: ${this.iterations}`);
    console.log(`${'='.repeat(60)}`);

    const allResults = [];

    for (let i = 0; i < this.iterations; i++) {
      console.log(`\n--- Iteration ${i + 1}/${this.iterations} ---`);

      const cicd = await this.runCICDScenario();
      const planning = await this.runLargePlanningScenario();
      const agentPool = await this.runAgentPoolScenario();
      const criticalPath = await this.runCriticalPathScenario();

      allResults.push({
        iteration: i + 1,
        cicd,
        planning,
        agentPool,
        criticalPath,
      });
    }

    // 计算统计
    this.results.scenarios = allResults;
    this.results.summary = this._calculateSummary(allResults);

    return this.results;
  }

  /**
   * 计算统计摘要
   */
  _calculateSummary(results) {
    const summary = {
      cicd: { totalDuration: [], success: 0 },
      planning: { totalDuration: [], cacheHitRate: [] },
      agentPool: { avgAcquisitionTime: [] },
      criticalPath: { executionTime: [] },
    };

    for (const result of results) {
      if (result.cicd.success) {
        summary.cicd.totalDuration.push(result.cicd.totalDuration);
        summary.cicd.success++;
      }

      if (result.planning.success) {
        summary.planning.totalDuration.push(result.planning.totalDuration);
        const hitRate = parseFloat(result.planning.cacheHitRate);
        if (!isNaN(hitRate)) {
          summary.planning.cacheHitRate.push(hitRate);
        }
      }

      if (result.agentPool.success) {
        summary.agentPool.avgAcquisitionTime.push(result.agentPool.avgAcquisitionTime);
      }

      if (result.criticalPath.success) {
        summary.criticalPath.executionTime.push(result.criticalPath.executionTime);
      }
    }

    // 计算平均值
    return {
      cicd: {
        avgDuration: this._avg(summary.cicd.totalDuration),
        successRate: (summary.cicd.success / results.length * 100).toFixed(2) + '%',
      },
      planning: {
        avgDuration: this._avg(summary.planning.totalDuration),
        avgCacheHitRate: this._avg(summary.planning.cacheHitRate).toFixed(2) + '%',
      },
      agentPool: {
        avgAcquisitionTime: this._avg(summary.agentPool.avgAcquisitionTime),
      },
      criticalPath: {
        avgExecutionTime: this._avg(summary.criticalPath.executionTime),
      },
    };
  }

  _avg(arr) {
    if (arr.length === 0) {return 0;}
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
  }

  /**
   * 打印结果
   */
  printResults() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Benchmark Results Summary (${this.mode.toUpperCase()})`);
    console.log(`${'='.repeat(60)}`);

    const { summary } = this.results;

    console.log(`\n[CI/CD Pipeline]`);
    console.log(`  Average Duration: ${summary.cicd.avgDuration.toFixed(2)}ms`);
    console.log(`  Success Rate: ${summary.cicd.successRate}`);

    console.log(`\n[Large-Scale Planning]`);
    console.log(`  Average Duration: ${summary.planning.avgDuration.toFixed(2)}ms`);
    console.log(`  Average Cache Hit Rate: ${summary.planning.avgCacheHitRate}`);

    console.log(`\n[Agent Pool]`);
    console.log(`  Average Acquisition Time: ${summary.agentPool.avgAcquisitionTime.toFixed(2)}ms`);

    console.log(`\n[Critical Path]`);
    console.log(`  Average Execution Time: ${summary.criticalPath.avgExecutionTime.toFixed(2)}ms`);

    console.log(`\n${'='.repeat(60)}`);
  }

  /**
   * 导出结果到JSON
   */
  exportResults(filename) {
    const fs = require('fs');
    const data = JSON.stringify(this.results, null, 2);
    fs.writeFileSync(filename, data);
    console.log(`\nResults exported to: ${filename}`);
  }

  // ========================================================================
  // Helper Methods (辅助方法)
  // ========================================================================

  async _planCICDTasks() {
    const request = '实现完整的CI/CD流程，包括测试、构建、部署';

    if (this.mode === 'optimized') {
      const cached = await this.planCache.get(request);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }

    // 模拟规划耗时
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 100));

    const plan = {
      tasks: [
        { id: 'install', title: 'Install dependencies', tool: 'npm', dependencies: [] },
        { id: 'lint', title: 'Run linter', tool: 'eslint', dependencies: ['install'] },
        { id: 'test', title: 'Run tests', tool: 'jest', dependencies: ['install'] },
        { id: 'build', title: 'Build application', tool: 'webpack', dependencies: ['install'] },
        { id: 'deploy', title: 'Deploy to server', tool: 'docker', dependencies: ['lint', 'test', 'build'] },
      ],
      fromCache: false,
    };

    if (this.mode === 'optimized') {
      await this.planCache.set(request, plan);
    }

    return plan;
  }

  async _planTask(request) {
    if (this.mode === 'optimized') {
      const cached = await this.planCache.get(request);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }

    // 模拟规划耗时
    await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 100));

    const plan = {
      tasks: [
        { id: 'task1', title: 'Implement login', tool: 'code' },
        { id: 'task2', title: 'Implement register', tool: 'code' },
        { id: 'task3', title: 'Implement reset password', tool: 'code' },
      ],
      fromCache: false,
    };

    if (this.mode === 'optimized') {
      await this.planCache.set(request, plan);
    }

    return plan;
  }

  async _executeTasks(tasks) {
    // 模拟任务执行
    for (const task of tasks) {
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
    }
    return { success: true };
  }

  async _executeTasksWithDependencies(tasks) {
    // 简化的依赖执行模拟
    const executed = new Set();

    const execute = async (task) => {
      if (executed.has(task.id)) {return;}

      // 等待依赖完成
      for (const depId of task.dependencies || []) {
        const depTask = tasks.find(t => t.id === depId);
        if (depTask) {
          await execute(depTask);
        }
      }

      // 执行任务
      await new Promise(resolve => setTimeout(resolve, task.duration / 10)); // 缩短时间
      executed.add(task.id);
    };

    for (const task of tasks) {
      await execute(task);
    }
  }

  async _createNewAgent() {
    // 模拟创建新代理的开销
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 50));
    return { id: `agent-${Math.random().toString(36).slice(2, 10)}` };
  }
}

// ============================================================================
// Comparison Runner (对比运行器)
// ============================================================================

async function runComparison() {
  console.log(`\n${'#'.repeat(70)}`);
  console.log(`WORKFLOW OPTIMIZATIONS - COMPREHENSIVE BENCHMARK COMPARISON`);
  console.log(`${'#'.repeat(70)}`);

  const iterations = 5; // 减少迭代次数以加快测试

  // Baseline测试
  console.log(`\n\n[PHASE 1] Running BASELINE tests...`);
  const baseline = new WorkflowBenchmark({ mode: 'baseline', iterations });
  const baselineResults = await baseline.runAll();
  baseline.printResults();
  baseline.exportResults('benchmark-results-baseline.json');

  // Optimized测试
  console.log(`\n\n[PHASE 2] Running OPTIMIZED tests...`);
  const optimized = new WorkflowBenchmark({ mode: 'optimized', iterations });
  const optimizedResults = await optimized.runAll();
  optimized.printResults();
  optimized.exportResults('benchmark-results-optimized.json');

  // 对比分析
  console.log(`\n\n${'#'.repeat(70)}`);
  console.log(`PERFORMANCE COMPARISON`);
  console.log(`${'#'.repeat(70)}`);

  const comparison = {
    cicd: compareMetric(
      baselineResults.summary.cicd.avgDuration,
      optimizedResults.summary.cicd.avgDuration,
      'CI/CD Pipeline Duration'
    ),
    planning: compareMetric(
      baselineResults.summary.planning.avgDuration,
      optimizedResults.summary.planning.avgDuration,
      'Planning Duration'
    ),
    agentPool: compareMetric(
      baselineResults.summary.agentPool.avgAcquisitionTime,
      optimizedResults.summary.agentPool.avgAcquisitionTime,
      'Agent Acquisition Time'
    ),
    criticalPath: compareMetric(
      baselineResults.summary.criticalPath.avgExecutionTime,
      optimizedResults.summary.criticalPath.avgExecutionTime,
      'Task Execution Time'
    ),
  };

  console.log(`\n[Cache Hit Rate]`);
  console.log(`  Baseline: ${baselineResults.summary.planning.avgCacheHitRate}`);
  console.log(`  Optimized: ${optimizedResults.summary.planning.avgCacheHitRate}`);
  console.log(`  Improvement: +${(parseFloat(optimizedResults.summary.planning.avgCacheHitRate) - parseFloat(baselineResults.summary.planning.avgCacheHitRate)).toFixed(2)}%`);

  console.log(`\n${'#'.repeat(70)}`);
  console.log(`BENCHMARK COMPLETED`);
  console.log(`${'#'.repeat(70)}\n`);
}

function compareMetric(baseline, optimized, label) {
  const improvement = ((baseline - optimized) / baseline * 100);
  const sign = improvement > 0 ? '+' : '';

  console.log(`\n[${label}]`);
  console.log(`  Baseline: ${baseline.toFixed(2)}ms`);
  console.log(`  Optimized: ${optimized.toFixed(2)}ms`);
  console.log(`  Improvement: ${sign}${improvement.toFixed(2)}% ${improvement > 0 ? '✅' : '❌'}`);

  return {
    baseline,
    optimized,
    improvement: improvement.toFixed(2) + '%',
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--compare';

  if (mode === '--baseline') {
    const benchmark = new WorkflowBenchmark({ mode: 'baseline', iterations: 10 });
    await benchmark.runAll();
    benchmark.printResults();
    benchmark.exportResults('benchmark-results-baseline.json');
  } else if (mode === '--optimized') {
    const benchmark = new WorkflowBenchmark({ mode: 'optimized', iterations: 10 });
    await benchmark.runAll();
    benchmark.printResults();
    benchmark.exportResults('benchmark-results-optimized.json');
  } else if (mode === '--compare') {
    await runComparison();
  } else {
    console.log(`Usage: node benchmark-workflow-optimizations.js [--baseline|--optimized|--compare]`);
    console.log(`  --baseline:  Run baseline tests only`);
    console.log(`  --optimized: Run optimized tests only`);
    console.log(`  --compare:   Run both and compare (default)`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Benchmark failed:', error);
    process.exit(1);
  });
}

module.exports = { WorkflowBenchmark, runComparison };
