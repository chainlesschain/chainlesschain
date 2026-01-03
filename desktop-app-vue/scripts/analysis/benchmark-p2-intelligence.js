/**
 * P2智能层性能基准测试
 * 测试大规模数据下的性能表现
 *
 * Version: v0.24.0
 * Date: 2026-01-02
 */

const Database = require('better-sqlite3');
const path = require('path');

// Phase 1-4 模块
const DataCollector = require('./src/main/ai-engine/data-collector');
const { UserProfileManager } = require('./src/main/ai-engine/user-profile-manager');
const HybridRecommender = require('./src/main/ai-engine/hybrid-recommender');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      P2智能层性能基准测试                                ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function runBenchmarks() {
  const dbPath = path.join(__dirname, 'data/chainlesschain.db');
  const db = new Database(dbPath);

  // 初始化模块
  const dataCollector = new DataCollector({
    enableCollection: true,
    batchSize: 100,
    flushInterval: 10000
  });
  dataCollector.setDatabase(db);

  const userProfileManager = new UserProfileManager({
    minDataPoints: 10,
    enableTemporalAnalysis: true,
    cacheSize: 1000
  });
  userProfileManager.setDatabase(db);

  const hybridRecommender = new HybridRecommender({
    topK: 5,
    minConfidence: 0.15,
    weights: { ml: 0.4, collaborative: 0.35, content: 0.25 }
  });
  hybridRecommender.setDatabase(db);

  await hybridRecommender.initialize();

  const benchmarkUserId = 'benchmark_user_001';
  const results = {
    dataCollection: {},
    profileManagement: {},
    recommendation: {},
    endToEnd: {}
  };

  // 清理旧数据
  console.log('🧹 清理基准测试数据...\n');
  db.prepare('DELETE FROM user_profiles WHERE user_id = ?').run(benchmarkUserId);
  db.prepare('DELETE FROM tool_usage_events WHERE user_id = ?').run(benchmarkUserId);
  db.prepare('DELETE FROM tool_recommendations WHERE user_id = ?').run(benchmarkUserId);

  // ========== Benchmark 1: 数据收集性能 ==========
  console.log('📊 [1/5] 数据收集性能测试...');

  await dataCollector.createUserProfile(benchmarkUserId, {
    skillLevel: 'intermediate',
    totalTasks: 100,
    successRate: 0.75
  });

  const tools = [
    'codeGeneration', 'fileWrite', 'fileRead', 'formatCode', 'testing',
    'debugging', 'dataAnalysis', 'chartGeneration', 'documentation', 'markdown'
  ];

  // 测试1: 收集100个事件
  const start100 = Date.now();
  for (let i = 0; i < 100; i++) {
    await dataCollector.collectToolUsage({
      userId: benchmarkUserId,
      sessionId: `benchmark_session_${i % 10}`,
      toolName: tools[i % tools.length],
      toolCategory: i % 3 === 0 ? 'data' : 'development',
      executionTime: 1000 + Math.random() * 2000,
      success: Math.random() > 0.2,
      previousTool: i > 0 ? tools[(i - 1) % tools.length] : null
    });
  }
  await dataCollector.flush();
  const time100 = Date.now() - start100;

  results.dataCollection.events100 = {
    totalTime: time100,
    avgPerEvent: (time100 / 100).toFixed(2),
    eventsPerSecond: (1000 / (time100 / 100)).toFixed(2)
  };

  console.log(`  ✓ 100事件: ${time100}ms (${results.dataCollection.events100.avgPerEvent}ms/事件)`);

  // 测试2: 收集500个事件
  const start500 = Date.now();
  for (let i = 0; i < 500; i++) {
    await dataCollector.collectToolUsage({
      userId: benchmarkUserId,
      sessionId: `benchmark_session_${i % 20}`,
      toolName: tools[i % tools.length],
      toolCategory: i % 3 === 0 ? 'data' : 'development',
      executionTime: 1000 + Math.random() * 2000,
      success: Math.random() > 0.2,
      previousTool: i > 0 ? tools[(i - 1) % tools.length] : null
    });
  }
  await dataCollector.flush();
  const time500 = Date.now() - start500;

  results.dataCollection.events500 = {
    totalTime: time500,
    avgPerEvent: (time500 / 500).toFixed(2),
    eventsPerSecond: (1000 / (time500 / 500)).toFixed(2)
  };

  console.log(`  ✓ 500事件: ${time500}ms (${results.dataCollection.events500.avgPerEvent}ms/事件)`);

  // 测试3: 收集1000个事件
  const start1000 = Date.now();
  for (let i = 0; i < 1000; i++) {
    await dataCollector.collectToolUsage({
      userId: benchmarkUserId,
      sessionId: `benchmark_session_${i % 50}`,
      toolName: tools[i % tools.length],
      toolCategory: i % 3 === 0 ? 'data' : 'development',
      executionTime: 1000 + Math.random() * 2000,
      success: Math.random() > 0.2,
      previousTool: i > 0 ? tools[(i - 1) % tools.length] : null
    });
  }
  await dataCollector.flush();
  const time1000 = Date.now() - start1000;

  results.dataCollection.events1000 = {
    totalTime: time1000,
    avgPerEvent: (time1000 / 1000).toFixed(2),
    eventsPerSecond: (1000 / (time1000 / 1000)).toFixed(2)
  };

  console.log(`  ✓ 1000事件: ${time1000}ms (${results.dataCollection.events1000.avgPerEvent}ms/事件)\n`);

  // ========== Benchmark 2: 用户画像管理性能 ==========
  console.log('📊 [2/5] 用户画像管理性能测试...');

  // 测试1: 首次构建画像
  const startBuild = Date.now();
  await userProfileManager.reassessProfile(benchmarkUserId);
  const timeBuild = Date.now() - startBuild;

  results.profileManagement.buildProfile = {
    time: timeBuild,
    dataPoints: 1600
  };

  console.log(`  ✓ 构建画像: ${timeBuild}ms (1600数据点)`);

  // 测试2: 缓存读取
  const startCacheRead = Date.now();
  for (let i = 0; i < 100; i++) {
    await userProfileManager.getProfile(benchmarkUserId);
  }
  const timeCacheRead = Date.now() - startCacheRead;

  results.profileManagement.cacheRead = {
    totalTime: timeCacheRead,
    avgPerRead: (timeCacheRead / 100).toFixed(2),
    readsPerSecond: (1000 / (timeCacheRead / 100)).toFixed(2)
  };

  console.log(`  ✓ 缓存读取(100次): ${timeCacheRead}ms (${results.profileManagement.cacheRead.avgPerRead}ms/次)`);

  // 测试3: 画像更新
  const startUpdate = Date.now();
  for (let i = 0; i < 50; i++) {
    await userProfileManager.updateProfile(benchmarkUserId, {
      taskIncrement: 1,
      successRate: 0.8
    });
  }
  const timeUpdate = Date.now() - startUpdate;

  results.profileManagement.update = {
    totalTime: timeUpdate,
    avgPerUpdate: (timeUpdate / 50).toFixed(2)
  };

  console.log(`  ✓ 画像更新(50次): ${timeUpdate}ms (${results.profileManagement.update.avgPerUpdate}ms/次)\n`);

  // ========== Benchmark 3: 推荐系统性能 ==========
  console.log('📊 [3/5] 推荐系统性能测试...');

  const task = {
    description: '实现数据分析功能',
    projectType: 'web',
    filePath: 'src/analytics.js',
    sessionId: 'benchmark_session'
  };

  // 测试1: 首次推荐（无缓存）
  const startFirstRec = Date.now();
  await hybridRecommender.recommend(task, benchmarkUserId);
  const timeFirstRec = Date.now() - startFirstRec;

  results.recommendation.firstRecommendation = {
    time: timeFirstRec
  };

  console.log(`  ✓ 首次推荐: ${timeFirstRec}ms`);

  // 测试2: 连续推荐（含缓存）
  const startMultiRec = Date.now();
  for (let i = 0; i < 100; i++) {
    await hybridRecommender.recommend({
      ...task,
      description: `实现功能${i}`
    }, benchmarkUserId);
  }
  const timeMultiRec = Date.now() - startMultiRec;

  results.recommendation.multipleRecommendations = {
    totalTime: timeMultiRec,
    avgPerRec: (timeMultiRec / 100).toFixed(2),
    recsPerSecond: (1000 / (timeMultiRec / 100)).toFixed(2)
  };

  console.log(`  ✓ 连续推荐(100次): ${timeMultiRec}ms (${results.recommendation.multipleRecommendations.avgPerRec}ms/次)\n`);

  // ========== Benchmark 4: 端到端流程性能 ==========
  console.log('📊 [4/5] 端到端流程性能测试...');

  const startE2E = Date.now();

  // 收集新数据
  for (let i = 0; i < 10; i++) {
    await dataCollector.collectToolUsage({
      userId: benchmarkUserId,
      sessionId: 'e2e_session',
      toolName: tools[i % tools.length],
      toolCategory: 'development',
      executionTime: 1500,
      success: true,
      previousTool: i > 0 ? tools[(i - 1) % tools.length] : null
    });
  }
  await dataCollector.flush();

  // 更新画像
  await userProfileManager.reassessProfile(benchmarkUserId);

  // 获取推荐
  const recs = await hybridRecommender.recommend(task, benchmarkUserId);

  const timeE2E = Date.now() - startE2E;

  results.endToEnd.fullPipeline = {
    time: timeE2E,
    steps: '数据收集(10) → 画像更新 → 推荐',
    recommendationCount: recs.length
  };

  console.log(`  ✓ 完整流程: ${timeE2E}ms`);
  console.log(`    - 步骤: 数据收集(10) → 画像更新 → 推荐`);
  console.log(`    - 推荐数: ${recs.length}\n`);

  // ========== Benchmark 5: 并发性能 ==========
  console.log('📊 [5/5] 并发性能测试...');

  const startConcurrent = Date.now();

  // 并发执行10个推荐
  const concurrentPromises = [];
  for (let i = 0; i < 10; i++) {
    concurrentPromises.push(
      hybridRecommender.recommend({
        ...task,
        description: `并发任务${i}`
      }, benchmarkUserId)
    );
  }

  await Promise.all(concurrentPromises);
  const timeConcurrent = Date.now() - startConcurrent;

  results.endToEnd.concurrent = {
    time: timeConcurrent,
    tasks: 10,
    avgPerTask: (timeConcurrent / 10).toFixed(2)
  };

  console.log(`  ✓ 并发推荐(10个): ${timeConcurrent}ms (${results.endToEnd.concurrent.avgPerTask}ms/个)\n`);

  // ========== 性能总结 ==========
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  性能基准测试结果                                        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log('📊 数据收集性能:');
  console.log(`  - 100事件:  ${results.dataCollection.events100.totalTime}ms (${results.dataCollection.events100.eventsPerSecond}事件/秒)`);
  console.log(`  - 500事件:  ${results.dataCollection.events500.totalTime}ms (${results.dataCollection.events500.eventsPerSecond}事件/秒)`);
  console.log(`  - 1000事件: ${results.dataCollection.events1000.totalTime}ms (${results.dataCollection.events1000.eventsPerSecond}事件/秒)`);

  console.log('\n📊 用户画像管理性能:');
  console.log(`  - 构建画像:   ${results.profileManagement.buildProfile.time}ms`);
  console.log(`  - 缓存读取:   ${results.profileManagement.cacheRead.avgPerRead}ms/次 (${results.profileManagement.cacheRead.readsPerSecond}次/秒)`);
  console.log(`  - 画像更新:   ${results.profileManagement.update.avgPerUpdate}ms/次`);

  console.log('\n📊 推荐系统性能:');
  console.log(`  - 首次推荐:   ${results.recommendation.firstRecommendation.time}ms`);
  console.log(`  - 连续推荐:   ${results.recommendation.multipleRecommendations.avgPerRec}ms/次 (${results.recommendation.multipleRecommendations.recsPerSecond}次/秒)`);

  console.log('\n📊 端到端性能:');
  console.log(`  - 完整流程:   ${results.endToEnd.fullPipeline.time}ms`);
  console.log(`  - 并发推荐:   ${results.endToEnd.concurrent.time}ms (10个任务)`);

  // 性能评级
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  性能评级                                                ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const ratings = [];

  // 数据收集评级（目标：<10ms/事件）
  const dcPerf = parseFloat(results.dataCollection.events1000.avgPerEvent);
  if (dcPerf < 5) ratings.push('  ✅ 数据收集: 优秀 (<5ms/事件)');
  else if (dcPerf < 10) ratings.push('  ✅ 数据收集: 良好 (<10ms/事件)');
  else ratings.push('  ⚠️ 数据收集: 需优化 (>10ms/事件)');

  // 推荐系统评级（目标：<100ms）
  const recPerf = parseFloat(results.recommendation.multipleRecommendations.avgPerRec);
  if (recPerf < 50) ratings.push('  ✅ 推荐系统: 优秀 (<50ms)');
  else if (recPerf < 100) ratings.push('  ✅ 推荐系统: 良好 (<100ms)');
  else ratings.push('  ⚠️ 推荐系统: 需优化 (>100ms)');

  // 端到端评级（目标：<500ms）
  const e2ePerf = results.endToEnd.fullPipeline.time;
  if (e2ePerf < 300) ratings.push('  ✅ 端到端: 优秀 (<300ms)');
  else if (e2ePerf < 500) ratings.push('  ✅ 端到端: 良好 (<500ms)');
  else ratings.push('  ⚠️ 端到端: 需优化 (>500ms)');

  ratings.forEach(r => console.log(r));

  // 清理测试数据
  console.log('\n🧹 清理基准测试数据...');
  await dataCollector.cleanup();
  db.prepare('DELETE FROM user_profiles WHERE user_id = ?').run(benchmarkUserId);
  db.prepare('DELETE FROM tool_usage_events WHERE user_id = ?').run(benchmarkUserId);
  db.prepare('DELETE FROM tool_recommendations WHERE user_id = ?').run(benchmarkUserId);
  console.log('  ✓ 基准测试数据已清理');

  db.close();

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  基准测试完成                                            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  return results;
}

runBenchmarks()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ 基准测试失败:', error);
    process.exit(1);
  });
