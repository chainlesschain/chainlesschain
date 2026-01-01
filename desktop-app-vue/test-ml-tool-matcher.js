/**
 * ML Tool Matcher 测试脚本
 * 验证Phase 3功能: 特征提取 + ML工具推荐
 */

const Database = require('better-sqlite3');
const path = require('path');
const FeatureExtractor = require('./src/main/ai-engine/feature-extractor');
const MLToolMatcher = require('./src/main/ai-engine/ml-tool-matcher');
const DataCollector = require('./src/main/ai-engine/data-collector');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      ML Tool Matcher 功能测试                            ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function runTests() {
  const dbPath = path.join(__dirname, 'data/chainlesschain.db');
  const db = new Database(dbPath);

  const featureExtractor = new FeatureExtractor();
  featureExtractor.setDatabase(db);

  const mlMatcher = new MLToolMatcher({
    topK: 5,
    minConfidence: 0.1,  // 降低置信度阈值
    scoreWeights: {
      textMatch: 0.25,
      userPreference: 0.30,
      historicalSuccess: 0.30,
      recency: 0.15
    }
  });
  mlMatcher.setDatabase(db);

  const dataCollector = new DataCollector();
  dataCollector.setDatabase(db);

  let totalTests = 0;
  let passedTests = 0;

  // 准备测试数据
  console.log('📝 准备测试数据...\n');
  const testUserId = 'test_ml_user_001';

  // 创建用户画像
  await dataCollector.createUserProfile(testUserId, {
    skillLevel: 'intermediate',
    preferredWorkflow: 'parallel',
    totalTasks: 50,
    successRate: 0.75
  });

  // 添加历史工具使用事件
  const tools = [
    { name: 'codeGeneration', category: 'development', success: true },
    { name: 'codeGeneration', category: 'development', success: true },
    { name: 'fileWrite', category: 'development', success: true },
    { name: 'formatCode', category: 'development', success: false },
    { name: 'testing', category: 'development', success: true },
    { name: 'dataAnalysis', category: 'data', success: true },
    { name: 'debugging', category: 'development', success: false },
    { name: 'documentation', category: 'writing', success: true }
  ];

  for (const tool of tools) {
    await dataCollector.collectToolUsage({
      userId: testUserId,
      sessionId: 'session_ml_001',
      toolName: tool.name,
      toolCategory: tool.category,
      executionTime: 1000 + Math.random() * 2000,
      success: tool.success
    });
  }

  await dataCollector.flush();

  // 更新用户画像统计
  await dataCollector.updateUserProfile(testUserId, {
    taskIncrement: 50,
    successRate: 0.75,
    avgTaskDuration: 2000,
    mostUsedTools: [
      { tool: 'codeGeneration', count: 15 },
      { tool: 'fileWrite', count: 10 },
      { tool: 'testing', count: 8 }
    ]
  });

  console.log(`  ✓ 创建测试用户和${tools.length}个历史事件\n`);

  // Test 1: 文本特征提取
  console.log('[1/10] 测试文本特征提取...');
  try {
    const textFeatures = featureExtractor.extractTextFeatures(
      '生成一个用户登录功能的代码，包括表单验证和错误处理'
    );

    totalTests++;
    if (textFeatures.keywords && textFeatures.keywords.length > 0 &&
        textFeatures.detectedCategory) {
      console.log('  ✓ 文本特征提取成功');
      console.log(`    - 关键词数: ${textFeatures.keywords.length}`);
      console.log(`    - 检测类别: ${textFeatures.detectedCategory}`);
      console.log(`    - 文本复杂度: ${textFeatures.complexity}`);
      passedTests++;
    } else {
      console.log('  ✗ 文本特征提取失败');
    }
  } catch (error) {
    console.log('  ✗ 文本特征提取失败:', error.message);
    totalTests++;
  }

  // Test 2: 上下文特征提取
  console.log('\n[2/10] 测试上下文特征提取...');
  try {
    const task = {
      projectType: 'web',
      filePath: 'src/auth/login.js',
      taskPhase: 'development',
      currentTools: ['codeGeneration']
    };

    const contextFeatures = featureExtractor.extractContextFeatures(task);

    totalTests++;
    if (contextFeatures.fileType && contextFeatures.language) {
      console.log('  ✓ 上下文特征提取成功');
      console.log(`    - 文件类型: ${contextFeatures.fileType}`);
      console.log(`    - 编程语言: ${contextFeatures.language}`);
      console.log(`    - 任务阶段: ${contextFeatures.taskPhase}`);
      passedTests++;
    } else {
      console.log('  ✗ 上下文特征提取失败');
    }
  } catch (error) {
    console.log('  ✗ 上下文特征提取失败:', error.message);
    totalTests++;
  }

  // Test 3: 用户特征提取
  console.log('\n[3/10] 测试用户特征提取...');
  try {
    const userFeatures = await featureExtractor.extractUserFeatures(testUserId);

    totalTests++;
    if (userFeatures.skillLevel && userFeatures.totalTasks > 0) {
      console.log('  ✓ 用户特征提取成功');
      console.log(`    - 技能水平: ${userFeatures.skillLevel}`);
      console.log(`    - 总任务数: ${userFeatures.totalTasks}`);
      console.log(`    - 成功率: ${(userFeatures.successRate * 100).toFixed(1)}%`);
      console.log(`    - 经验等级: ${userFeatures.experience}`);
      passedTests++;
    } else {
      console.log('  ✗ 用户特征提取失败');
    }
  } catch (error) {
    console.log('  ✗ 用户特征提取失败:', error.message);
    totalTests++;
  }

  // Test 4: 完整特征提取
  console.log('\n[4/10] 测试完整特征提取...');
  try {
    const task = {
      description: '创建一个React组件实现用户列表展示',
      projectType: 'web',
      filePath: 'src/components/UserList.jsx',
      taskPhase: 'development'
    };

    const features = await featureExtractor.extractFeatures(task, testUserId);

    totalTests++;
    if (features.text && features.context && features.user && features.vector) {
      console.log('  ✓ 完整特征提取成功');
      console.log(`    - 特征向量维度: ${features.vector.length}`);
      console.log(`    - 检测类别: ${features.text.detectedCategory}`);
      console.log(`    - 文件类型: ${features.context.fileType}`);
      passedTests++;
    } else {
      console.log('  ✗ 完整特征提取失败');
    }
  } catch (error) {
    console.log('  ✗ 完整特征提取失败:', error.message);
    totalTests++;
  }

  // Test 5: 工具推荐 (开发任务)
  console.log('\n[5/10] 测试工具推荐 (开发任务)...');
  try {
    const task = {
      description: '实现用户登录功能，需要表单验证',
      projectType: 'web',
      filePath: 'src/auth/login.js',
      taskPhase: 'development',
      sessionId: 'session_test_001'
    };

    const recommendations = await mlMatcher.recommendTools(task, testUserId);

    totalTests++;
    if (recommendations && recommendations.length > 0) {
      console.log('  ✓ 工具推荐成功');
      console.log(`    - 推荐工具数: ${recommendations.length}`);
      console.log(`    - Top-1: ${recommendations[0].tool} (置信度: ${(recommendations[0].confidence * 100).toFixed(1)}%)`);
      console.log(`    - 推荐理由: ${recommendations[0].reason}`);
      passedTests++;
    } else {
      console.log('  ✗ 工具推荐失败');
    }
  } catch (error) {
    console.log('  ✗ 工具推荐失败:', error.message);
    totalTests++;
  }

  // Test 6: 工具推荐 (数据任务)
  console.log('\n[6/10] 测试工具推荐 (数据任务)...');
  try {
    const task = {
      description: '分析用户行为数据，生成统计图表',
      projectType: 'data',
      filePath: 'analysis/user_behavior.py',
      taskPhase: 'analysis',
      sessionId: 'session_test_002'
    };

    const recommendations = await mlMatcher.recommendTools(task, testUserId);

    totalTests++;
    if (recommendations && recommendations.length > 0) {
      console.log('  ✓ 数据任务推荐成功');
      console.log(`    - Top-3: ${recommendations.slice(0, 3).map(r => r.tool).join(', ')}`);
      passedTests++;
    } else {
      console.log('  ✗ 数据任务推荐失败');
    }
  } catch (error) {
    console.log('  ✗ 数据任务推荐失败:', error.message);
    totalTests++;
  }

  // Test 7: 评分机制验证
  console.log('\n[7/10] 测试评分机制...');
  try {
    const task = {
      description: '生成代码',
      projectType: 'web',
      filePath: 'src/app.js',
      sessionId: 'session_test_003'
    };

    const recommendations = await mlMatcher.recommendTools(task, testUserId);

    totalTests++;
    if (recommendations.length > 0 && recommendations[0].breakdown) {
      const breakdown = recommendations[0].breakdown;
      console.log('  ✓ 评分机制有效');
      console.log(`    - 文本匹配: ${(breakdown.textMatch * 100).toFixed(1)}%`);
      console.log(`    - 用户偏好: ${(breakdown.userPreference * 100).toFixed(1)}%`);
      console.log(`    - 历史成功: ${(breakdown.historicalSuccess * 100).toFixed(1)}%`);
      console.log(`    - 最近使用: ${(breakdown.recency * 100).toFixed(1)}%`);
      passedTests++;
    } else {
      console.log('  ✗ 评分机制失败');
    }
  } catch (error) {
    console.log('  ✗ 评分机制失败:', error.message);
    totalTests++;
  }

  // Test 8: Top-K过滤
  console.log('\n[8/10] 测试Top-K过滤...');
  try {
    const task = {
      description: '完整的Web应用开发任务',
      projectType: 'web',
      sessionId: 'session_test_004'
    };

    const recommendations = await mlMatcher.recommendTools(task, testUserId);

    totalTests++;
    if (recommendations.length <= 5 && recommendations.length > 0) {
      console.log('  ✓ Top-K过滤正常');
      console.log(`    - 返回数量: ${recommendations.length} (≤ 5)`);
      console.log(`    - 最低置信度: ${(recommendations[recommendations.length - 1].confidence * 100).toFixed(1)}%`);
      passedTests++;
    } else {
      console.log('  ✗ Top-K过滤失败');
    }
  } catch (error) {
    console.log('  ✗ Top-K过滤失败:', error.message);
    totalTests++;
  }

  // Test 9: 批量推荐
  console.log('\n[9/10] 测试批量推荐...');
  try {
    const tasks = [
      { description: '代码生成任务', sessionId: 'batch_001' },
      { description: '数据分析任务', sessionId: 'batch_002' },
      { description: '文档编写任务', sessionId: 'batch_003' }
    ];

    const batchResults = await mlMatcher.recommendBatch(tasks, testUserId);

    totalTests++;
    if (batchResults.length === 3 && batchResults.every(r => r.recommendations.length > 0)) {
      console.log('  ✓ 批量推荐成功');
      console.log(`    - 任务数: ${batchResults.length}`);
      console.log(`    - 每个任务推荐数: ${batchResults.map(r => r.recommendations.length).join(', ')}`);
      passedTests++;
    } else {
      console.log('  ✗ 批量推荐失败');
    }
  } catch (error) {
    console.log('  ✗ 批量推荐失败:', error.message);
    totalTests++;
  }

  // Test 10: 推荐反馈
  console.log('\n[10/10] 测试推荐反馈机制...');
  try {
    // 获取最近一条推荐记录
    const lastRec = db.prepare(`
      SELECT id FROM tool_recommendations
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(testUserId);

    if (lastRec) {
      await mlMatcher.feedbackRecommendation(lastRec.id, {
        action: 'accepted',
        actualTools: ['codeGeneration', 'fileWrite'],
        wasHelpful: true
      });

      const updated = db.prepare(`
        SELECT user_action, was_helpful
        FROM tool_recommendations
        WHERE id = ?
      `).get(lastRec.id);

      totalTests++;
      if (updated && updated.user_action === 'accepted' && updated.was_helpful === 1) {
        console.log('  ✓ 推荐反馈成功');
        console.log(`    - 用户行为: ${updated.user_action}`);
        console.log(`    - 是否有帮助: ${updated.was_helpful === 1 ? '是' : '否'}`);
        passedTests++;
      } else {
        console.log('  ✗ 推荐反馈失败');
      }
    } else {
      console.log('  ✗ 未找到推荐记录');
      totalTests++;
    }
  } catch (error) {
    console.log('  ✗ 推荐反馈失败:', error.message);
    totalTests++;
  }

  // 显示统计信息
  console.log('\n📊 ML Tool Matcher 统计信息:');
  const stats = mlMatcher.getStats();
  console.log(`  - 总推荐次数: ${stats.totalRecommendations}`);
  console.log(`  - 接受次数: ${stats.acceptedRecommendations}`);
  console.log(`  - 拒绝次数: ${stats.rejectedRecommendations}`);
  console.log(`  - 接受率: ${stats.acceptanceRate}`);
  console.log(`  - 平均置信度: ${(stats.avgConfidence * 100).toFixed(1)}%`);

  // 清理测试数据
  console.log('\n🧹 清理测试数据...');
  await dataCollector.cleanup();
  db.prepare('DELETE FROM user_profiles WHERE user_id LIKE ?').run('test_ml_%');
  db.prepare('DELETE FROM tool_usage_events WHERE user_id LIKE ?').run('test_ml_%');
  db.prepare('DELETE FROM tool_recommendations WHERE user_id LIKE ?').run('test_ml_%');
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
