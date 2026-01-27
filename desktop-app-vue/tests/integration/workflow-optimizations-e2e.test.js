/**
 * Workflow Optimizations - 端到端集成测试
 *
 * 测试完整流程：项目创建 → 模块初始化 → LLM调用 → 统计收集
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Workflow Optimizations - E2E Tests", () => {
  let testDir;
  let configPath;
  let mockLLMManager;
  let mockDatabase;
  let mockProjectConfig;

  beforeAll(() => {
    // 创建测试目录
    testDir = path.join(os.tmpdir(), `workflow-e2e-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(path.join(testDir, ".chainlesschain"), { recursive: true });
    configPath = path.join(testDir, ".chainlesschain", "config.json");

    console.log(`\n📁 测试目录: ${testDir}\n`);

    // Mock process.cwd
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterAll(() => {
    // 清理测试目录
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error("清理测试目录失败:", error.message);
    }

    vi.restoreAllMocks();
  });

  beforeEach(() => {
    // 创建Mock对象
    mockLLMManager = {
      isInitialized: true,
      async initialize() {
        return true;
      },
      async query({ prompt }) {
        console.log(`  🤖 LLM Query: ${prompt.substring(0, 50)}...`);

        // 模拟LLM决策响应
        if (prompt.includes("决策专家") || prompt.includes("多代理")) {
          return {
            text: JSON.stringify({
              useMultiAgent: true,
              strategy: "parallel_execution",
              confidence: 0.92,
              reason: "任务具有多个独立子任务，适合并行处理",
              agentCount: 3,
            }),
          };
        }

        return { text: "Mock LLM response" };
      },
      async embed() {
        return Array.from({ length: 384 }, () => Math.random() * 2 - 1);
      },
    };

    mockDatabase = {
      async all(query) {
        if (query.includes("task_execution_history")) {
          return [
            {
              use_multi_agent: 1,
              avg_time: 8500,
              avg_success: 0.95,
              count: 15,
            },
          ];
        }
        return [];
      },
      async run() {
        return { changes: 1 };
      },
      async get() {
        return null;
      },
    };

    mockProjectConfig = {
      getProjectRoot() {
        return testDir;
      },
      getConfig() {
        return {
          workflow: {
            optimizations: {
              enabled: true,
            },
          },
        };
      },
    };
  });

  describe("完整E2E流程", () => {
    it("应该完成项目初始化到统计收集的完整流程", async () => {
      console.log("\n🚀 开始E2E测试流程\n");

      // ========== Phase 1: 项目配置初始化 ==========
      console.log("📝 Phase 1: 创建项目配置文件");
      const config = {
        workflow: {
          optimizations: {
            enabled: true,
            phase3: {
              planCache: {
                enabled: true,
                similarityThreshold: 0.75,
                useEmbedding: false,
              },
              llmDecision: {
                enabled: true,
                highConfidenceThreshold: 0.9,
              },
              agentPool: {
                enabled: true,
                minSize: 2,
                maxSize: 8,
                warmupOnInit: false,
              },
              criticalPath: {
                enabled: true,
                priorityBoost: 2.0,
              },
            },
          },
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      expect(fs.existsSync(configPath)).toBe(true);
      console.log("  ✅ 配置文件已创建");

      // ========== Phase 2: 测试智能计划缓存 ==========
      console.log("\n💾 Phase 2: 测试智能计划缓存");

      // 动态导入SmartPlanCache
      const SmartPlanCacheModule =
        await import("../../src/main/ai-engine/smart-plan-cache.js");
      const { SmartPlanCache } = SmartPlanCacheModule;

      const planCache = new SmartPlanCache({
        enabled: true,
        llmManager: mockLLMManager,
        useEmbedding: false,
      });

      const taskRequest = "实现用户认证功能模块";

      // 首次查询（未命中）
      const cachedPlan1 = await planCache.get(taskRequest);
      expect(cachedPlan1).toBeNull();
      console.log("  ✅ 首次查询: 未命中缓存");

      // 存储计划
      const mockPlan = {
        tasks: [
          { id: "auth-1", title: "设计认证数据库schema" },
          { id: "auth-2", title: "实现JWT生成和验证" },
          { id: "auth-3", title: "实现登录API" },
        ],
      };
      await planCache.set(taskRequest, mockPlan);
      console.log("  ✅ 计划已缓存");

      // 第二次查询（命中）
      const cachedPlan2 = await planCache.get(taskRequest);
      expect(cachedPlan2).toBeDefined();
      expect(cachedPlan2.tasks.length).toBe(3);
      console.log("  ✅ 第二次查询: 命中缓存");

      // ========== Phase 3: 测试LLM决策引擎 ==========
      console.log("\n🧠 Phase 3: 测试LLM决策引擎");

      const LLMDecisionEngineModule =
        await import("../../src/main/ai-engine/llm-decision-engine.js");
      const { LLMDecisionEngine } = LLMDecisionEngineModule;

      const decisionEngine = new LLMDecisionEngine({
        enabled: true,
        llmManager: mockLLMManager,
        database: mockDatabase,
      });

      const taskContext = {
        task_title: "实现完整的CI/CD流水线",
        subtasks: [
          { title: "配置GitHub Actions" },
          { title: "编写构建脚本" },
          { title: "配置测试环境" },
        ],
        estimated_duration: 26000,
      };

      const decision = await decisionEngine.shouldUseMultiAgent(taskContext, {
        length: 5000,
      });

      expect(decision).toBeDefined();
      expect(decision.useMultiAgent).toBeDefined();
      console.log("  ✅ LLM决策完成");
      console.log(`    - 使用多代理: ${decision.useMultiAgent}`);
      console.log(`    - 策略: ${decision.strategy}`);
      console.log(`    - 置信度: ${decision.confidence}`);

      // ========== Phase 4: 测试代理池 ==========
      console.log("\n👥 Phase 4: 测试代理池");

      const AgentPoolModule =
        await import("../../src/main/ai-engine/cowork/agent-pool.js");
      const { AgentPool } = AgentPoolModule;

      const agentPool = new AgentPool({
        minSize: 2,
        maxSize: 5,
        warmupOnInit: false,
      });

      const agent1 = await agentPool.acquireAgent();
      expect(agent1).toBeDefined();
      expect(agent1.id).toBeDefined();
      console.log(`  ✅ 获取代理1: ${agent1.id}`);

      const agent2 = await agentPool.acquireAgent();
      expect(agent2).toBeDefined();
      console.log(`  ✅ 获取代理2: ${agent2.id}`);

      agentPool.releaseAgent(agent1.id);
      console.log(`  ✅ 释放代理1`);

      agentPool.releaseAgent(agent2.id);
      console.log(`  ✅ 释放代理2`);

      // 验证复用
      const agent3 = await agentPool.acquireAgent();
      expect([agent1.id, agent2.id].includes(agent3.id)).toBe(true);
      console.log(`  ✅ 代理复用验证`);
      agentPool.releaseAgent(agent3.id);

      // ========== Phase 5: 测试关键路径优化 ==========
      console.log("\n🎯 Phase 5: 测试关键路径优化");

      const CriticalPathOptimizerModule =
        await import("../../src/main/ai-engine/critical-path-optimizer.js");
      const { CriticalPathOptimizer } = CriticalPathOptimizerModule;

      const criticalPathOptimizer = new CriticalPathOptimizer({
        enabled: true,
      });

      const tasks = [
        { id: "t1", title: "Install", duration: 5000, dependencies: [] },
        { id: "t2", title: "Lint", duration: 3000, dependencies: ["t1"] },
        { id: "t3", title: "Test", duration: 12000, dependencies: ["t1"] },
        { id: "t4", title: "Build", duration: 8000, dependencies: ["t1"] },
        {
          id: "t5",
          title: "Deploy",
          duration: 4000,
          dependencies: ["t2", "t3", "t4"],
        },
      ];

      const optimizedTasks = criticalPathOptimizer.optimize(tasks);
      expect(optimizedTasks).toBeDefined();
      expect(optimizedTasks.length).toBe(tasks.length);

      const criticalPath = optimizedTasks.filter((t) => t.isCritical);
      console.log(`  ✅ 关键路径长度: ${criticalPath.length} 个任务`);

      // ========== Phase 6: 统计数据收集 ==========
      console.log("\n📊 Phase 6: 收集统计数据");

      const cacheStats = planCache.getStats();
      const decisionStats = decisionEngine.getStats();
      const poolStats = agentPool.getStats();
      const optimizerStats = criticalPathOptimizer.getStats();

      expect(cacheStats).toBeDefined();
      expect(decisionStats).toBeDefined();
      expect(poolStats).toBeDefined();
      expect(optimizerStats).toBeDefined();

      console.log("  ✅ Plan Cache统计:");
      console.log(`    - 缓存大小: ${cacheStats.cacheSize}`);
      console.log(`    - 命中率: ${cacheStats.hitRate}`);

      console.log("  ✅ Decision Engine统计:");
      console.log(`    - 总决策次数: ${decisionStats.totalDecisions}`);

      console.log("  ✅ Agent Pool统计:");
      console.log(`    - 创建数量: ${poolStats.created}`);
      console.log(`    - 复用率: ${poolStats.reuseRate}%`);

      console.log("  ✅ Critical Path统计:");
      console.log(`    - 分析次数: ${optimizerStats.totalAnalyses}`);

      // ========== Phase 7: 性能验证 ==========
      console.log("\n⚡ Phase 7: 性能验证");

      // 缓存性能
      const cacheStart = Date.now();
      await planCache.get(taskRequest);
      const cacheDuration = Date.now() - cacheStart;
      expect(cacheDuration).toBeLessThan(50);
      console.log(`  ✅ 缓存查询性能: ${cacheDuration}ms (< 50ms)`);

      // 决策性能
      const decisionStart = Date.now();
      await decisionEngine.shouldUseMultiAgent(taskContext, { length: 5000 });
      const decisionDuration = Date.now() - decisionStart;
      expect(decisionDuration).toBeLessThan(2000);
      console.log(`  ✅ LLM决策性能: ${decisionDuration}ms (< 2000ms)`);

      // ========== 清理 ==========
      console.log("\n🧹 Phase 8: 清理资源");
      await agentPool.clear();
      console.log("  ✅ Agent Pool已关闭");

      console.log("\n✅ E2E测试完成！所有阶段通过\n");
    }, 60000); // 60秒超时

    it("应该正确处理LLM调用失败的降级策略", async () => {
      console.log("\n🛡️ 测试LLM失败降级\n");

      // 创建会失败的LLM Manager
      const failingLLM = {
        isInitialized: true,
        async initialize() {
          return true;
        },
        async query() {
          throw new Error("LLM服务不可用");
        },
      };

      const LLMDecisionEngineModule =
        await import("../../src/main/ai-engine/llm-decision-engine.js");
      const { LLMDecisionEngine } = LLMDecisionEngineModule;

      const decisionEngine = new LLMDecisionEngine({
        enabled: true,
        llmManager: failingLLM,
        database: mockDatabase,
      });

      const decision = await decisionEngine.shouldUseMultiAgent(
        {
          task_title: "Test Task",
          subtasks: [{ title: "T1" }, { title: "T2" }, { title: "T3" }],
          estimated_duration: 30000,
        },
        { length: 3000 },
      );

      expect(decision).toBeDefined();
      expect(decision.reason).toContain("基础规则");
      console.log("  ✅ LLM失败时正确降级到基础规则");
      console.log(`    - 决策依据: ${decision.reason}`);
    }, 10000);
  });

  describe("压力测试", () => {
    it("应该能处理大量并发任务", async () => {
      console.log("\n💪 压力测试: 100个并发任务\n");

      const SmartPlanCacheModule =
        await import("../../src/main/ai-engine/smart-plan-cache.js");
      const { SmartPlanCache } = SmartPlanCacheModule;

      const planCache = new SmartPlanCache({
        enabled: true,
        llmManager: mockLLMManager,
        useEmbedding: false,
      });

      const writeTasks = [];

      // 创建100个并发任务
      for (let i = 0; i < 100; i++) {
        writeTasks.push(
          planCache.set(`task-${i}`, {
            tasks: [{ id: `t${i}`, title: `Task ${i}` }],
          }),
        );
      }

      const start = Date.now();
      await Promise.all(writeTasks);
      const duration = Date.now() - start;

      console.log(`  ✅ 100个任务写入完成: ${duration}ms`);
      expect(duration).toBeLessThan(5000);

      // 验证缓存命中
      const queries = [];
      for (let i = 0; i < 100; i++) {
        queries.push(planCache.get(`task-${i}`));
      }

      const queryStart = Date.now();
      const results = await Promise.all(queries);
      const queryDuration = Date.now() - queryStart;

      const hits = results.filter((r) => r !== null).length;
      console.log(`  ✅ 100个查询完成: ${queryDuration}ms`);
      console.log(`  ✅ 缓存命中率: ${((hits / 100) * 100).toFixed(2)}%`);

      expect(hits).toBeGreaterThan(90);

      console.log("\n✅ 压力测试完成！\n");
    }, 20000);
  });
});
