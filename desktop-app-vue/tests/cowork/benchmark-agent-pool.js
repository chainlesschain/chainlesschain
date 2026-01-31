/**
 * Agent Pool Performance Benchmark
 *
 * 验证代理池的性能提升和复用率
 */

const { AgentPool } = require("../../src/main/ai-engine/cowork/agent-pool.js");

/**
 * 模拟任务执行（使用代理）
 */
async function simulateTaskWithAgent(agent, taskId, duration = 100) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        taskId,
        agentId: agent.id,
        duration,
        reuseCount: agent.reuseCount,
      });
    }, duration);
  });
}

/**
 * Benchmark 1: 高频短任务（测试复用率）
 */
async function benchmark1_HighFrequencyShortTasks() {
  console.log("\n=== Benchmark 1: 高频短任务 (100个任务) ===\n");

  const pool = new AgentPool({
    minSize: 3,
    maxSize: 5,
    idleTimeout: 60000,
    warmupOnInit: true,
  });

  await pool.initialize();
  console.log("✅ 代理池初始化完成");

  const startTime = Date.now();
  const results = [];

  // 执行100个短任务
  for (let i = 0; i < 100; i++) {
    const agent = await pool.acquireAgent({ role: "worker" });
    const result = await simulateTaskWithAgent(agent, `task_${i}`, 10); // 10ms per task
    results.push(result);
    pool.releaseAgent(agent.id);
  }

  const totalTime = Date.now() - startTime;
  const stats = pool.getStats();

  console.log("📊 结果统计:");
  console.log(`  总耗时: ${totalTime}ms`);
  console.log(`  平均每任务: ${(totalTime / 100).toFixed(2)}ms`);
  console.log(`  代理创建: ${stats.created}`);
  console.log(`  代理复用: ${stats.reused}`);
  console.log(`  复用率: ${stats.reuseRate}%`);
  console.log(`  平均复用次数: ${stats.avgReuseCount}`);

  await pool.clear();

  return {
    totalTime,
    stats,
    expectedReuseRate: 95, // 期望复用率 >95%
    passed: parseFloat(stats.reuseRate) > 95,
  };
}

/**
 * Benchmark 2: 并发任务（测试等待队列）
 */
async function benchmark2_ConcurrentTasks() {
  console.log("\n=== Benchmark 2: 并发任务 (20个并发) ===\n");

  const pool = new AgentPool({
    minSize: 2,
    maxSize: 5, // 限制最大5个，测试等待队列
    idleTimeout: 60000,
    warmupOnInit: true,
  });

  await pool.initialize();

  const startTime = Date.now();
  const tasks = [];

  // 同时启动20个任务
  for (let i = 0; i < 20; i++) {
    const task = (async () => {
      const agent = await pool.acquireAgent({ role: "worker" }, 10000); // 10s timeout
      await new Promise((resolve) => setTimeout(resolve, 100)); // 模拟任务执行
      const result = { taskId: `task_${i}`, agentId: agent.id };
      pool.releaseAgent(agent.id);
      return result;
    })();

    tasks.push(task);
  }

  const results = await Promise.all(tasks);
  const totalTime = Date.now() - startTime;
  const stats = pool.getStats();
  const poolStatus = pool.getStatus();

  console.log("📊 结果统计:");
  console.log(`  总耗时: ${totalTime}ms`);
  console.log(`  并发处理: ${results.length} 个任务`);
  console.log(`  代理创建: ${stats.created} (最大=${poolStatus.maxSize})`);
  console.log(`  等待超时: ${stats.waitTimeouts}`);
  console.log(`  复用率: ${stats.reuseRate}%`);

  await pool.clear();

  return {
    totalTime,
    stats,
    expectedMaxCreated: 5,
    passed: stats.created <= 5 && stats.waitTimeouts === 0,
  };
}

/**
 * Benchmark 3: 空闲超时（测试自动缩容）
 */
async function benchmark3_IdleTimeout() {
  console.log("\n=== Benchmark 3: 空闲超时 (自动缩容) ===\n");

  const pool = new AgentPool({
    minSize: 2,
    maxSize: 10,
    idleTimeout: 2000, // 2秒空闲超时
    warmupOnInit: true,
    enableAutoScaling: true,
  });

  await pool.initialize();
  console.log(`✅ 初始池大小: ${pool.getStatus().available}`);

  // 快速创建10个代理
  const agents = [];
  for (let i = 0; i < 8; i++) {
    const agent = await pool.acquireAgent({ role: "worker" });
    agents.push(agent);
  }

  console.log(
    `⚡ 池扩展后: 忙碌=${pool.getStatus().busy}, 总计=${pool.getStatus().total}`,
  );

  // 释放所有代理
  for (const agent of agents) {
    pool.releaseAgent(agent.id);
  }

  console.log(`↩️  释放后: 可用=${pool.getStatus().available}`);
  console.log("⏱️  等待2秒，触发空闲超时...");

  // 等待空闲超时
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const finalStatus = pool.getStatus();
  const stats = pool.getStats();

  console.log("📊 结果统计:");
  console.log(
    `  最终池大小: ${finalStatus.available} (期望=${pool.options.minSize})`,
  );
  console.log(`  代理销毁: ${stats.destroyed}`);
  console.log(`  自动缩容: ${stats.destroyed > 0 ? "✅ 成功" : "❌ 失败"}`);

  await pool.clear();

  return {
    finalPoolSize: finalStatus.available,
    destroyed: stats.destroyed,
    passed:
      finalStatus.available === pool.options.minSize && stats.destroyed > 0,
  };
}

/**
 * Benchmark 4: 性能对比（有池 vs 无池）
 */
async function benchmark4_PerformanceComparison() {
  console.log("\n=== Benchmark 4: 性能对比 (有池 vs 无池) ===\n");

  const taskCount = 50;
  const agentCreationTime = 50; // 模拟代理创建耗时50ms
  const agentReuseTime = 5; // 模拟代理复用耗时5ms

  // 无池模式（传统方式）
  console.log("🔴 无池模式:");
  const nopoolStart = Date.now();
  for (let i = 0; i < taskCount; i++) {
    await new Promise((resolve) => setTimeout(resolve, agentCreationTime)); // 创建代理
    await new Promise((resolve) => setTimeout(resolve, 10)); // 执行任务
    await new Promise((resolve) => setTimeout(resolve, 20)); // 销毁代理
  }
  const nopoolTime = Date.now() - nopoolStart;
  console.log(`  总耗时: ${nopoolTime}ms`);
  console.log(`  平均每任务: ${(nopoolTime / taskCount).toFixed(2)}ms`);

  // 有池模式
  console.log("\n🟢 有池模式:");
  const pool = new AgentPool({
    minSize: 3,
    maxSize: 5,
    warmupOnInit: true,
  });
  await pool.initialize();

  const poolStart = Date.now();
  for (let i = 0; i < taskCount; i++) {
    const agent = await pool.acquireAgent({ role: "worker" });
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        agent.reuseCount > 0 ? agentReuseTime : agentCreationTime,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 10)); // 执行任务
    pool.releaseAgent(agent.id);
  }
  const poolTime = Date.now() - poolStart;
  const stats = pool.getStats();

  console.log(`  总耗时: ${poolTime}ms`);
  console.log(`  平均每任务: ${(poolTime / taskCount).toFixed(2)}ms`);
  console.log(`  复用率: ${stats.reuseRate}%`);

  await pool.clear();

  const improvement = (((nopoolTime - poolTime) / nopoolTime) * 100).toFixed(2);
  console.log(
    `\n📈 性能提升: ${improvement}% (${nopoolTime}ms → ${poolTime}ms)`,
  );

  return {
    nopoolTime,
    poolTime,
    improvement: parseFloat(improvement),
    passed: poolTime < nopoolTime * 0.5, // 期望至少50%提升
  };
}

/**
 * 运行所有benchmarks
 */
async function runAllBenchmarks() {
  console.log(
    "\n╔════════════════════════════════════════════════════════════╗",
  );
  console.log("║          Agent Pool Performance Benchmark Suite          ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  const results = [];

  try {
    results.push({
      name: "Benchmark 1",
      result: await benchmark1_HighFrequencyShortTasks(),
    });
    results.push({
      name: "Benchmark 2",
      result: await benchmark2_ConcurrentTasks(),
    });
    results.push({
      name: "Benchmark 3",
      result: await benchmark3_IdleTimeout(),
    });
    results.push({
      name: "Benchmark 4",
      result: await benchmark4_PerformanceComparison(),
    });
  } catch (error) {
    console.error("\n❌ Benchmark 失败:", error.message);
    console.error(error.stack);
    process.exit(1);
  }

  // 汇总结果
  console.log(
    "\n\n╔════════════════════════════════════════════════════════════╗",
  );
  console.log("║                    Benchmark Summary                      ║");
  console.log(
    "╚════════════════════════════════════════════════════════════╝\n",
  );

  let allPassed = true;
  results.forEach(({ name, result }) => {
    const status = result.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} - ${name}`);
    allPassed = allPassed && result.passed;
  });

  console.log("\n" + "=".repeat(60));
  if (allPassed) {
    console.log("🎉 所有Benchmarks通过！代理池性能符合预期。");
    process.exit(0);
  } else {
    console.log("⚠️  部分Benchmarks未通过，请检查实现。");
    process.exit(1);
  }
}

// 运行benchmarks
if (require.main === module) {
  runAllBenchmarks().catch((error) => {
    console.error("Benchmark运行失败:", error);
    process.exit(1);
  });
}

module.exports = {
  benchmark1_HighFrequencyShortTasks,
  benchmark2_ConcurrentTasks,
  benchmark3_IdleTimeout,
  benchmark4_PerformanceComparison,
  runAllBenchmarks,
};
