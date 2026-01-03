/**
 * P2智能层端到端测试
 * 测试Phase 1-4集成后的完整流程
 *
 * Phase 1: 数据收集 (DataCollector)
 * Phase 2: 用户画像 (UserProfileManager)
 * Phase 3: ML推荐 (FeatureExtractor + MLToolMatcher)
 * Phase 4: 混合推荐 (CollaborativeFilter + ContentRecommender + HybridRecommender)
 *
 * Version: v0.24.0
 * Date: 2026-01-02
 */

const Database = require('better-sqlite3');
const path = require('path');

// Phase 1
const DataCollector = require('./src/main/ai-engine/data-collector');

// Phase 2
const { UserProfileManager } = require('./src/main/ai-engine/user-profile-manager');

// Phase 3
const FeatureExtractor = require('./src/main/ai-engine/feature-extractor');
const MLToolMatcher = require('./src/main/ai-engine/ml-tool-matcher');

// Phase 4
const CollaborativeFilter = require('./src/main/ai-engine/collaborative-filter');
const ContentRecommender = require('./src/main/ai-engine/content-recommender');
const HybridRecommender = require('./src/main/ai-engine/hybrid-recommender');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      P2智能层端到端测试 (Phase 1-4)                     ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function runTests() {
  const dbPath = path.join(__dirname, 'data/chainlesschain.db');
  const db = new Database(dbPath);

  // 初始化所有模块
  const dataCollector = new DataCollector({
    enableCollection: true,
    batchSize: 50,
    flushInterval: 5000
  });
  dataCollector.setDatabase(db);

  const userProfileManager = new UserProfileManager({
    minDataPoints: 5,
    enableTemporalAnalysis: true
  });
  userProfileManager.setDatabase(db);

  const featureExtractor = new FeatureExtractor();
  featureExtractor.setDatabase(db);

  const mlToolMatcher = new MLToolMatcher({
    topK: 5,
    minConfidence: 0.1
  });
  mlToolMatcher.setDatabase(db);

  const collaborativeFilter = new CollaborativeFilter({
    minSimilarity: 0.1,
    topKUsers: 10
  });
  collaborativeFilter.setDatabase(db);

  const contentRecommender = new ContentRecommender({
    minSimilarity: 0.2,
    topKSimilar: 5
  });
  contentRecommender.setDatabase(db);

  const hybridRecommender = new HybridRecommender({
    topK: 5,
    minConfidence: 0.15,
    weights: { ml: 0.4, collaborative: 0.35, content: 0.25 }
  });
  hybridRecommender.setDatabase(db);

  let totalTests = 0;
  let passedTests = 0;

  const testUserId = 'test_e2e_user_001';
  const testSessionId = 'test_e2e_session_001';

  // 清理旧数据
  console.log('🧹 清理旧测试数据...\n');
  db.prepare('DELETE FROM user_profiles WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM tool_usage_events WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM tool_recommendations WHERE user_id = ?').run(testUserId);

  // Test 1: Phase 1 - 数据收集
  console.log('[1/6] 测试Phase 1: 数据收集...');
  try {
    // 创建用户画像
    await dataCollector.createUserProfile(testUserId, {
      skillLevel: 'intermediate',
      totalTasks: 50,
      successRate: 0.8
    });

    // 收集20个工具使用事件
    const tools = [
      'codeGeneration', 'fileWrite', 'formatCode', 'testing', 'debugging',
      'codeGeneration', 'fileRead', 'formatCode', 'testing', 'fileWrite',
      'codeGeneration', 'debugging', 'testing', 'formatCode', 'fileWrite',
      'dataAnalysis', 'chartGeneration', 'codeGeneration', 'testing', 'fileWrite'
    ];

    for (let i = 0; i < tools.length; i++) {
      await dataCollector.collectToolUsage({
        userId: testUserId,
        sessionId: testSessionId,
        toolName: tools[i],
        toolCategory: tools[i].includes('data') || tools[i].includes('chart') ? 'data' : 'development',
        executionTime: 1000 + Math.random() * 2000,
        success: Math.random() > 0.15,
        previousTool: i > 0 ? tools[i - 1] : null
      });
    }

    await dataCollector.flush();

    const eventCount = db.prepare(
      'SELECT COUNT(*) as count FROM tool_usage_events WHERE user_id = ?'
    ).get(testUserId).count;

    totalTests++;
    if (eventCount === 20) {
      console.log('  ✓ 数据收集成功');
      console.log(`    - 事件数: ${eventCount}`);
      passedTests++;
    } else {
      console.log(`  ✗ 数据收集失败 (预期20个事件，实际${eventCount}个)`);
    }
  } catch (error) {
    console.log('  ✗ Phase 1测试失败:', error.message);
    totalTests++;
  }

  // Test 2: Phase 2 - 用户画像构建
  console.log('\n[2/6] 测试Phase 2: 用户画像构建...');
  try {
    // 重新评估画像（基于已收集的20个事件）
    await userProfileManager.reassessProfile(testUserId);
    const profile = await userProfileManager.getProfile(testUserId);

    totalTests++;
    if (profile && profile.preferences && profile.preferences.preferredTools && profile.preferences.preferredTools.length > 0) {
      console.log('  ✓ 用户画像构建成功');
      console.log(`    - 工具偏好数: ${profile.preferences.preferredTools.length}`);
      console.log(`    - Top-1: ${profile.preferences.preferredTools[0]}`);
      console.log(`    - 技能等级: ${profile.skillLevel.overall}`);
      passedTests++;
    } else {
      console.log('  ✗ 用户画像构建失败');
    }
  } catch (error) {
    console.log('  ✗ Phase 2测试失败:', error.message);
    totalTests++;
  }

  // Test 3: Phase 3 - ML工具推荐
  console.log('\n[3/6] 测试Phase 3: ML工具推荐...');
  try {
    const task = {
      description: '编写单元测试代码',
      projectType: 'web',
      filePath: 'src/test.js',
      sessionId: testSessionId
    };

    const mlRecs = await mlToolMatcher.recommendTools(task, testUserId);

    totalTests++;
    if (mlRecs && mlRecs.length > 0) {
      console.log('  ✓ ML工具推荐成功');
      console.log(`    - 推荐数: ${mlRecs.length}`);
      console.log(`    - Top-1: ${mlRecs[0].tool} (置信度: ${(mlRecs[0].confidence * 100).toFixed(1)}%)`);
      console.log(`    - 理由: ${mlRecs[0].reason}`);
      passedTests++;
    } else {
      console.log('  ✗ ML工具推荐失败');
    }
  } catch (error) {
    console.log('  ✗ Phase 3测试失败:', error.message);
    totalTests++;
  }

  // Test 4: Phase 4 - 混合推荐系统初始化
  console.log('\n[4/6] 测试Phase 4: 混合推荐系统初始化...');
  try {
    await hybridRecommender.initialize();

    totalTests++;
    console.log('  ✓ 混合推荐系统初始化成功');
    passedTests++;
  } catch (error) {
    console.log('  ✗ Phase 4初始化失败:', error.message);
    totalTests++;
  }

  // Test 5: Phase 4 - 混合推荐
  console.log('\n[5/6] 测试Phase 4: 混合推荐...');
  try {
    const task = {
      description: '实现文件读写功能',
      projectType: 'web',
      filePath: 'src/file-handler.js',
      sessionId: testSessionId
    };

    const hybridRecs = await hybridRecommender.recommend(task, testUserId);

    totalTests++;
    if (hybridRecs && hybridRecs.length > 0) {
      console.log('  ✓ 混合推荐成功');
      console.log(`    - 推荐数: ${hybridRecs.length}`);
      console.log(`    - Top-1: ${hybridRecs[0].tool}`);
      console.log(`      评分: ${hybridRecs[0].finalScore.toFixed(3)}`);
      console.log(`      置信度: ${(hybridRecs[0].confidence * 100).toFixed(1)}%`);
      console.log(`      算法数: ${hybridRecs[0].algorithmCount}`);
      console.log(`      理由: ${hybridRecs[0].reason}`);
      passedTests++;
    } else {
      console.log('  ✗ 混合推荐失败');
    }
  } catch (error) {
    console.log('  ✗ Phase 4推荐失败:', error.message);
    totalTests++;
  }

  // Test 6: 完整流程 - 新数据 → 画像更新 → 推荐
  console.log('\n[6/6] 测试完整流程: 数据收集 → 画像更新 → 推荐...');
  try {
    // 1. 收集新数据
    for (let i = 0; i < 5; i++) {
      await dataCollector.collectToolUsage({
        userId: testUserId,
        sessionId: testSessionId + '_flow',
        toolName: 'dataAnalysis',
        toolCategory: 'data',
        executionTime: 1500,
        success: true,
        previousTool: i > 0 ? 'chartGeneration' : 'codeGeneration'
      });

      await dataCollector.collectToolUsage({
        userId: testUserId,
        sessionId: testSessionId + '_flow',
        toolName: 'chartGeneration',
        toolCategory: 'data',
        executionTime: 1200,
        success: true,
        previousTool: 'dataAnalysis'
      });
    }

    await dataCollector.flush();

    // 2. 更新用户画像
    const updatedProfile = await userProfileManager.getProfile(testUserId);

    // 3. 获取新推荐
    const task = {
      description: '分析销售数据并生成图表',
      projectType: 'data',
      filePath: 'src/analytics.js',
      sessionId: testSessionId + '_flow'
    };

    const finalRecs = await hybridRecommender.recommend(task, testUserId);

    totalTests++;
    if (finalRecs && finalRecs.length > 0 && updatedProfile && updatedProfile.preferences) {
      console.log('  ✓ 完整流程测试成功');
      console.log(`    - 新事件数: 10`);
      console.log(`    - 画像偏好数: ${updatedProfile.preferences.preferredTools.length}`);
      console.log(`    - 推荐数: ${finalRecs.length}`);
      console.log(`    - Top-1推荐: ${finalRecs[0].tool} (${(finalRecs[0].confidence * 100).toFixed(1)}%)`);
      passedTests++;
    } else {
      console.log('  ✗ 完整流程测试失败');
    }
  } catch (error) {
    console.log('  ✗ 完整流程测试失败:', error.message);
    totalTests++;
  }

  // 显示统计信息
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  Phase 1-4 统计信息                                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  console.log('\n📊 Phase 1 - 数据收集器:');
  const dcStats = dataCollector.getStats();
  console.log(`  - 总事件数: ${dcStats.totalEvents}`);
  console.log(`  - 缓冲大小: ${dcStats.bufferSize}`);
  console.log(`  - 收集率: ${dcStats.collectionRate}`);

  console.log('\n📊 Phase 2 - 用户画像管理器:');
  const upmStats = userProfileManager.getStats();
  console.log(`  - 画像数: ${upmStats.totalProfiles}`);
  console.log(`  - 缓存命中率: ${upmStats.cacheHitRate}`);

  console.log('\n📊 Phase 3 - ML工具匹配器:');
  const mlStats = mlToolMatcher.getStats();
  console.log(`  - 推荐次数: ${mlStats.totalRecommendations}`);
  console.log(`  - 平均置信度: ${mlStats.avgConfidence}`);

  console.log('\n📊 Phase 4 - 混合推荐系统:');
  const hybridStats = hybridRecommender.getStats();
  console.log(`  - 推荐次数: ${hybridStats.totalRecommendations}`);
  console.log(`  - 平均置信度: ${hybridStats.avgConfidence}`);
  console.log(`  - 多样性分数: ${hybridStats.diversityScore}`);
  if (hybridStats.algorithmDistribution) {
    console.log(`  - 算法分布: ML=${hybridStats.algorithmDistribution.ml}, CF=${hybridStats.algorithmDistribution.collaborative}, CB=${hybridStats.algorithmDistribution.content}`);
  }

  // 清理测试数据
  console.log('\n🧹 清理测试数据...');
  await dataCollector.cleanup();
  db.prepare('DELETE FROM user_profiles WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM tool_usage_events WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM tool_recommendations WHERE user_id = ?').run(testUserId);
  console.log('  ✓ 测试数据已清理');

  db.close();

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  测试结果: ${passedTests}/${totalTests} 通过 (${(passedTests/totalTests*100).toFixed(1)}%)${' '.repeat(39 - passedTests.toString().length - totalTests.toString().length)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  return passedTests === totalTests ? 0 : 1;
}

runTests()
  .then(exitCode => process.exit(exitCode))
  .catch(error => {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  });
