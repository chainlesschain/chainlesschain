/**
 * Hybrid Recommender 测试脚本
 * 验证Phase 4功能: 协同过滤 + 内容推荐 + 混合推荐
 */

const Database = require('better-sqlite3');
const path = require('path');
const CollaborativeFilter = require('./src/main/ai-engine/collaborative-filter');
const ContentRecommender = require('./src/main/ai-engine/content-recommender');
const HybridRecommender = require('./src/main/ai-engine/hybrid-recommender');
const DataCollector = require('./src/main/ai-engine/data-collector');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      Hybrid Recommender 功能测试                         ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function runTests() {
  const dbPath = path.join(__dirname, 'data/chainlesschain.db');
  const db = new Database(dbPath);

  const collaborativeFilter = new CollaborativeFilter();
  collaborativeFilter.setDatabase(db);

  const contentRecommender = new ContentRecommender();
  contentRecommender.setDatabase(db);

  const hybridRecommender = new HybridRecommender({
    topK: 5,
    minConfidence: 0.1,
    weights: { ml: 0.4, collaborative: 0.35, content: 0.25 }
  });
  hybridRecommender.setDatabase(db);

  const dataCollector = new DataCollector();
  dataCollector.setDatabase(db);

  let totalTests = 0;
  let passedTests = 0;

  // 准备测试数据
  console.log('📝 准备测试数据...\n');

  // 创建3个测试用户
  const users = ['test_hybrid_user_001', 'test_hybrid_user_002', 'test_hybrid_user_003'];

  for (const userId of users) {
    await dataCollector.createUserProfile(userId, {
      skillLevel: 'intermediate',
      totalTasks: 30,
      successRate: 0.75
    });
  }

  // 模拟用户工具使用（创建相似用户）
  const userToolPatterns = {
    test_hybrid_user_001: [
      { name: 'codeGeneration', count: 10 },
      { name: 'fileWrite', count: 8 },
      { name: 'formatCode', count: 6 },
      { name: 'testing', count: 5 }
    ],
    test_hybrid_user_002: [
      { name: 'codeGeneration', count: 9 },
      { name: 'fileWrite', count: 7 },
      { name: 'debugging', count: 5 },
      { name: 'testing', count: 4 }
    ],
    test_hybrid_user_003: [
      { name: 'dataAnalysis', count: 8 },
      { name: 'chartGeneration', count: 6 },
      { name: 'documentation', count: 4 }
    ]
  };

  for (const [userId, tools] of Object.entries(userToolPatterns)) {
    for (const { name, count } of tools) {
      for (let i = 0; i < count; i++) {
        await dataCollector.collectToolUsage({
          userId,
          sessionId: `session_${userId}_${i}`,
          toolName: name,
          toolCategory: name.includes('data') || name.includes('chart') ? 'data' : 'development',
          executionTime: 1000 + Math.random() * 2000,
          success: Math.random() > 0.2,
          previousTool: i > 0 ? tools[Math.max(0, Math.floor(i / count * tools.length) - 1)].name : null
        });
      }
    }
  }

  await dataCollector.flush();
  console.log(`  ✓ 创建${users.length}个测试用户和使用记录\n`);

  // Test 1: 构建用户-工具矩阵
  console.log('[1/12] 测试构建用户-工具矩阵...');
  try {
    const matrix = await collaborativeFilter.buildUserToolMatrix();

    totalTests++;
    if (matrix.size >= 3) {
      console.log('  ✓ 用户-工具矩阵构建成功');
      console.log(`    - 用户数: ${matrix.size}`);
      console.log(`    - 矩阵统计: ${JSON.stringify(collaborativeFilter.getMatrixStats())}`);
      passedTests++;
    } else {
      console.log('  ✗ 用户-工具矩阵构建失败');
    }
  } catch (error) {
    console.log('  ✗ 构建用户-工具矩阵失败:', error.message);
    totalTests++;
  }

  // Test 2: 计算用户相似度
  console.log('\n[2/12] 测试计算用户相似度...');
  try {
    const similarity = collaborativeFilter.calculateUserSimilarity(
      'test_hybrid_user_001',
      'test_hybrid_user_002'
    );

    totalTests++;
    if (similarity > 0) {
      console.log('  ✓ 用户相似度计算成功');
      console.log(`    - 相似度: ${(similarity * 100).toFixed(1)}%`);
      passedTests++;
    } else {
      console.log('  ✗ 用户相似度计算失败');
    }
  } catch (error) {
    console.log('  ✗ 计算用户相似度失败:', error.message);
    totalTests++;
  }

  // Test 3: 查找相似用户
  console.log('\n[3/12] 测试查找相似用户...');
  try {
    const similarUsers = await collaborativeFilter.findSimilarUsers('test_hybrid_user_001');

    totalTests++;
    if (similarUsers && similarUsers.length > 0) {
      console.log('  ✓ 查找相似用户成功');
      console.log(`    - 相似用户数: ${similarUsers.length}`);
      console.log(`    - Top-1: ${similarUsers[0].userId} (${(similarUsers[0].similarity * 100).toFixed(1)}%)`);
      passedTests++;
    } else {
      console.log('  ✗ 查找相似用户失败');
    }
  } catch (error) {
    console.log('  ✗ 查找相似用户失败:', error.message);
    totalTests++;
  }

  // Test 4: 协同过滤推荐
  console.log('\n[4/12] 测试协同过滤推荐...');
  try {
    const cfRecs = await collaborativeFilter.recommendTools('test_hybrid_user_001', 5);

    totalTests++;
    if (cfRecs && cfRecs.length > 0) {
      console.log('  ✓ 协同过滤推荐成功');
      console.log(`    - 推荐工具数: ${cfRecs.length}`);
      console.log(`    - Top-1: ${cfRecs[0].tool} (评分: ${cfRecs[0].score.toFixed(2)})`);
      console.log(`    - 理由: ${cfRecs[0].reason}`);
      passedTests++;
    } else {
      console.log('  ✗ 协同过滤推荐失败');
    }
  } catch (error) {
    console.log('  ✗ 协同过滤推荐失败:', error.message);
    totalTests++;
  }

  // Test 5: 构建工具特征
  console.log('\n[5/12] 测试构建工具特征...');
  try {
    const features = await contentRecommender.buildToolFeatures();

    totalTests++;
    if (features && features.size > 0) {
      console.log('  ✓ 工具特征构建成功');
      console.log(`    - 工具数: ${features.size}`);
      passedTests++;
    } else {
      console.log('  ✗ 工具特征构建失败');
    }
  } catch (error) {
    console.log('  ✗ 构建工具特征失败:', error.message);
    totalTests++;
  }

  // Test 6: 计算工具相似度
  console.log('\n[6/12] 测试计算工具相似度...');
  try {
    const similarity = contentRecommender.calculateToolSimilarity(
      'codeGeneration',
      'fileWrite'
    );

    totalTests++;
    if (similarity >= 0) {
      console.log('  ✓ 工具相似度计算成功');
      console.log(`    - 相似度: ${(similarity * 100).toFixed(1)}%`);
      passedTests++;
    } else {
      console.log('  ✗ 工具相似度计算失败');
    }
  } catch (error) {
    console.log('  ✗ 计算工具相似度失败:', error.message);
    totalTests++;
  }

  // Test 7: 查找相似工具
  console.log('\n[7/12] 测试查找相似工具...');
  try {
    const similarTools = contentRecommender.findSimilarTools('codeGeneration');

    totalTests++;
    if (similarTools && similarTools.length > 0) {
      console.log('  ✓ 查找相似工具成功');
      console.log(`    - 相似工具数: ${similarTools.length}`);
      console.log(`    - Top-3: ${similarTools.slice(0, 3).map(t => t.tool).join(', ')}`);
      passedTests++;
    } else {
      console.log('  ✗ 查找相似工具失败');
    }
  } catch (error) {
    console.log('  ✗ 查找相似工具失败:', error.message);
    totalTests++;
  }

  // Test 8: 内容推荐
  console.log('\n[8/12] 测试内容推荐...');
  try {
    const cbRecs = await contentRecommender.recommendTools('test_hybrid_user_001', 5);

    totalTests++;
    if (cbRecs && cbRecs.length > 0) {
      console.log('  ✓ 内容推荐成功');
      console.log(`    - 推荐工具数: ${cbRecs.length}`);
      console.log(`    - Top-1: ${cbRecs[0].tool} (评分: ${cbRecs[0].score.toFixed(2)})`);
      passedTests++;
    } else {
      console.log('  ✗ 内容推荐失败');
    }
  } catch (error) {
    console.log('  ✗ 内容推荐失败:', error.message);
    totalTests++;
  }

  // Test 9: 工具链推荐
  console.log('\n[9/12] 测试工具链推荐...');
  try {
    await contentRecommender.buildToolChains();
    const chainRecs = await contentRecommender.recommendNextTools('codeGeneration', 3);

    totalTests++;
    if (chainRecs !== null) { // 允许空数组
      console.log('  ✓ 工具链推荐成功');
      console.log(`    - 推荐数: ${chainRecs.length}`);
      if (chainRecs.length > 0) {
        console.log(`    - Top-1: ${chainRecs[0].tool} (概率: ${(chainRecs[0].score * 100).toFixed(1)}%)`);
      }
      passedTests++;
    } else {
      console.log('  ✗ 工具链推荐失败');
    }
  } catch (error) {
    console.log('  ✗ 工具链推荐失败:', error.message);
    totalTests++;
  }

  // Test 10: 混合推荐初始化
  console.log('\n[10/12] 测试混合推荐初始化...');
  try {
    await hybridRecommender.initialize();

    totalTests++;
    console.log('  ✓ 混合推荐初始化成功');
    passedTests++;
  } catch (error) {
    console.log('  ✗ 混合推荐初始化失败:', error.message);
    totalTests++;
  }

  // Test 11: 混合推荐
  console.log('\n[11/12] 测试混合推荐...');
  try {
    const task = {
      description: '实现用户认证功能',
      projectType: 'web',
      filePath: 'src/auth.js',
      sessionId: 'test_hybrid_session'
    };

    const hybridRecs = await hybridRecommender.recommend(task, 'test_hybrid_user_001');

    totalTests++;
    if (hybridRecs && hybridRecs.length > 0) {
      console.log('  ✓ 混合推荐成功');
      console.log(`    - 推荐工具数: ${hybridRecs.length}`);
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
    console.log('  ✗ 混合推荐失败:', error.message);
    totalTests++;
  }

  // Test 12: 多样性优化
  console.log('\n[12/12] 测试多样性优化...');
  try {
    const stats = hybridRecommender.getStats();

    totalTests++;
    if (stats && stats.diversityScore) {
      console.log('  ✓ 多样性优化有效');
      console.log(`    - 多样性分数: ${stats.diversityScore}`);
      passedTests++;
    } else {
      console.log('  ✗ 多样性优化失败');
    }
  } catch (error) {
    console.log('  ✗ 多样性优化失败:', error.message);
    totalTests++;
  }

  // 显示统计信息
  console.log('\n📊 Hybrid Recommender 统计信息:');
  const hybridStats = hybridRecommender.getStats();
  console.log(`  - 总推荐次数: ${hybridStats.totalRecommendations}`);
  console.log(`  - 平均置信度: ${hybridStats.avgConfidence}`);
  console.log(`  - 多样性分数: ${hybridStats.diversityScore}`);
  if (hybridStats.algorithmDistribution) {
    console.log(`  - 算法分布: ML=${hybridStats.algorithmDistribution.ml}, CF=${hybridStats.algorithmDistribution.collaborative}, CB=${hybridStats.algorithmDistribution.content}`);
  }

  console.log('\n📊 Collaborative Filter 统计信息:');
  const cfStats = collaborativeFilter.getStats();
  console.log(`  - 推荐次数: ${cfStats.totalRecommendations}`);
  console.log(`  - 缓存命中率: ${cfStats.cacheHitRate}`);
  console.log(`  - 平均相似度: ${cfStats.avgSimilarity}`);

  console.log('\n📊 Content Recommender 统计信息:');
  const cbStats = contentRecommender.getStats();
  console.log(`  - 推荐次数: ${cbStats.totalRecommendations}`);
  console.log(`  - 工具数: ${cbStats.toolCount}`);
  console.log(`  - 工具链数: ${cbStats.toolChainCount}`);
  console.log(`  - 平均相似度: ${cbStats.avgSimilarity}`);

  // 清理测试数据
  console.log('\n🧹 清理测试数据...');
  await dataCollector.cleanup();
  db.prepare('DELETE FROM user_profiles WHERE user_id LIKE ?').run('test_hybrid_%');
  db.prepare('DELETE FROM tool_usage_events WHERE user_id LIKE ?').run('test_hybrid_%');
  db.prepare('DELETE FROM tool_recommendations WHERE user_id LIKE ?').run('test_hybrid_%');
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
