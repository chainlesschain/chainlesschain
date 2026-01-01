/**
 * UserProfileManager 测试脚本
 * 验证用户画像系统功能
 */

const Database = require('better-sqlite3');
const path = require('path');
const { UserProfileManager } = require('./src/main/ai-engine/user-profile-manager');
const DataCollector = require('./src/main/ai-engine/data-collector');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      UserProfileManager 功能测试                         ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function runTests() {
  const dbPath = path.join(__dirname, 'data/chainlesschain.db');
  const db = new Database(dbPath);

  const profileManager = new UserProfileManager({
    minDataPoints: 5,
    enableTemporalAnalysis: true
  });
  profileManager.setDatabase(db);

  const dataCollector = new DataCollector();
  dataCollector.setDatabase(db);

  let totalTests = 0;
  let passedTests = 0;

  // 准备测试数据：创建用户并添加历史事件
  console.log('📝 准备测试数据...\n');
  const testUserId = 'test_profile_user_001';

  // 添加20个工具使用事件
  const tools = [
    'codeGeneration', 'codeGeneration', 'codeGeneration', 'fileWrite', 'fileWrite',
    'formatCode', 'debugging', 'testing', 'dataAnalysis', 'documentation',
    'codeGeneration', 'fileWrite', 'formatCode', 'codeGeneration', 'testing',
    'debugging', 'codeGeneration', 'fileWrite', 'formatCode', 'testing'
  ];

  const categories = ['development', 'development', 'data', 'writing'];
  const now = Date.now();

  for (let i = 0; i < tools.length; i++) {
    const hour = 9 + (i % 12); // 9-20点活跃
    const timestamp = new Date(now - (20 - i) * 3600000);
    timestamp.setHours(hour);

    await dataCollector.collectToolUsage({
      userId: testUserId,
      sessionId: `session_${Math.floor(i / 5)}`,
      toolName: tools[i],
      toolCategory: categories[i % 4],
      taskType: 'TEST_TASK',
      executionTime: 1000 + Math.random() * 2000,
      success: Math.random() > 0.2, // 80%成功率
      timestamp: timestamp.toISOString()
    });
  }

  await dataCollector.flush();
  console.log(`  ✓ 创建${tools.length}个测试事件\n`);

  // Test 1: 构建新用户画像
  console.log('[1/8] 测试构建新用户画像...');
  try {
    const profile = await profileManager.buildNewProfile(testUserId);

    totalTests++;
    if (profile && profile.userId === testUserId && profile.skillLevel) {
      console.log(`  ✓ 用户画像构建成功`);
      console.log(`    - 技能水平: ${profile.skillLevel.overall}`);
      console.log(`    - 偏好工具数: ${profile.preferences.preferredTools.length}`);
      console.log(`    - 总任务数: ${profile.statistics.totalTasks}`);
      passedTests++;
    } else {
      console.log('  ✗ 用户画像构建失败');
    }
  } catch (error) {
    console.log('  ✗ 构建用户画像失败:', error.message);
    totalTests++;
  }

  // Test 2: 技能水平评估
  console.log('\n[2/8] 测试技能水平评估...');
  try {
    const profile = await profileManager.getProfile(testUserId);

    totalTests++;
    if (profile.skillLevel && profile.skillLevel.overall) {
      console.log(`  ✓ 技能水平评估成功`);
      console.log(`    - 整体水平: ${profile.skillLevel.overall}`);
      console.log(`    - 领域技能: ${Object.keys(profile.skillLevel.domains).length}个领域`);
      Object.entries(profile.skillLevel.domains).forEach(([domain, score]) => {
        console.log(`      • ${domain}: ${(score * 100).toFixed(1)}%`);
      });
      passedTests++;
    } else {
      console.log('  ✗ 技能水平评估失败');
    }
  } catch (error) {
    console.log('  ✗ 技能水平评估失败:', error.message);
    totalTests++;
  }

  // Test 3: 偏好提取
  console.log('\n[3/8] 测试偏好提取...');
  try {
    const profile = await profileManager.getProfile(testUserId);

    totalTests++;
    if (profile.preferences && profile.preferences.preferredTools.length > 0) {
      console.log(`  ✓ 偏好提取成功`);
      console.log(`    - 偏好工具: ${profile.preferences.preferredTools.slice(0, 3).join(', ')}`);
      console.log(`    - 工作流偏好: ${profile.preferences.preferredWorkflow}`);
      console.log(`    - 响应期望: ${profile.preferences.responseExpectation}`);
      passedTests++;
    } else {
      console.log('  ✗ 偏好提取失败');
    }
  } catch (error) {
    console.log('  ✗ 偏好提取失败:', error.message);
    totalTests++;
  }

  // Test 4: 统计信息计算
  console.log('\n[4/8] 测试统计信息计算...');
  try {
    const profile = await profileManager.getProfile(testUserId);

    totalTests++;
    if (profile.statistics && profile.statistics.totalTasks > 0) {
      console.log(`  ✓ 统计信息计算成功`);
      console.log(`    - 总任务数: ${profile.statistics.totalTasks}`);
      console.log(`    - 成功率: ${(profile.statistics.successRate * 100).toFixed(1)}%`);
      console.log(`    - 平均耗时: ${profile.statistics.avgTaskDuration}ms`);
      console.log(`    - 最常用工具: ${profile.statistics.mostUsedTools.slice(0, 3).map(t => t.tool).join(', ')}`);
      passedTests++;
    } else {
      console.log('  ✗ 统计信息计算失败');
    }
  } catch (error) {
    console.log('  ✗ 统计信息计算失败:', error.message);
    totalTests++;
  }

  // Test 5: 时间模式分析
  console.log('\n[5/8] 测试时间模式分析...');
  try {
    const profile = await profileManager.getProfile(testUserId);

    totalTests++;
    if (profile.temporalPatterns && profile.temporalPatterns.activeHours) {
      console.log(`  ✓ 时间模式分析成功`);
      console.log(`    - 活跃时段: ${profile.temporalPatterns.activeHours.join(', ')}时`);
      if (profile.temporalPatterns.patterns.peakHour !== undefined) {
        console.log(`    - 高峰时段: ${profile.temporalPatterns.patterns.peakHour}时`);
      }
      passedTests++;
    } else {
      console.log('  ✗ 时间模式分析失败');
    }
  } catch (error) {
    console.log('  ✗ 时间模式分析失败:', error.message);
    totalTests++;
  }

  // Test 6: 缓存机制
  console.log('\n[6/8] 测试LRU缓存机制...');
  try {
    // 第一次访问（缓存未命中）
    await profileManager.getProfile(testUserId);
    const statsBefore = profileManager.getStats();

    // 第二次访问（缓存命中）
    await profileManager.getProfile(testUserId);
    const statsAfter = profileManager.getStats();

    totalTests++;
    if (statsAfter.cacheHits > statsBefore.cacheHits) {
      console.log(`  ✓ 缓存机制有效`);
      console.log(`    - 缓存命中率: ${statsAfter.cacheHitRate}`);
      console.log(`    - 缓存大小: ${statsAfter.cacheSize}`);
      passedTests++;
    } else {
      console.log('  ✗ 缓存机制失败');
    }
  } catch (error) {
    console.log('  ✗ 缓存机制失败:', error.message);
    totalTests++;
  }

  // Test 7: 增量更新画像
  console.log('\n[7/8] 测试增量更新画像...');
  try {
    const profileBefore = await profileManager.getProfile(testUserId);
    const tasksBefore = profileBefore.statistics.totalTasks;

    await profileManager.updateProfile(testUserId, {
      taskIncrement: 5,
      successRate: 0.90
    });

    const profileAfter = await profileManager.getProfile(testUserId);

    totalTests++;
    if (profileAfter.statistics.totalTasks === tasksBefore + 5) {
      console.log(`  ✓ 增量更新成功`);
      console.log(`    - 任务数: ${tasksBefore} → ${profileAfter.statistics.totalTasks}`);
      console.log(`    - 成功率: ${(profileAfter.statistics.successRate * 100).toFixed(1)}%`);
      passedTests++;
    } else {
      console.log('  ✗ 增量更新失败');
    }
  } catch (error) {
    console.log('  ✗ 增量更新失败:', error.message);
    totalTests++;
  }

  // Test 8: 重新评估画像
  console.log('\n[8/8] 测试重新评估画像...');
  try {
    // 添加更多事件
    for (let i = 0; i < 10; i++) {
      await dataCollector.collectToolUsage({
        userId: testUserId,
        sessionId: 'session_new',
        toolName: 'advancedTool',
        toolCategory: 'advanced',
        executionTime: 500, // 更快的执行时间
        success: true
      });
    }
    await dataCollector.flush();

    const reassessed = await profileManager.reassessProfile(testUserId);

    totalTests++;
    if (reassessed && reassessed.statistics.totalTasks >= 30) {
      console.log(`  ✓ 重新评估成功`);
      console.log(`    - 新任务数: ${reassessed.statistics.totalTasks}`);
      console.log(`    - 新技能水平: ${reassessed.skillLevel.overall}`);
      passedTests++;
    } else {
      console.log('  ✗ 重新评估失败');
    }
  } catch (error) {
    console.log('  ✗ 重新评估失败:', error.message);
    totalTests++;
  }

  // 显示统计信息
  console.log('\n📊 UserProfileManager 统计信息:');
  const finalStats = profileManager.getStats();
  console.log(`  - 总画像数: ${finalStats.totalProfiles}`);
  console.log(`  - 缓存命中: ${finalStats.cacheHits}`);
  console.log(`  - 缓存未命中: ${finalStats.cacheMisses}`);
  console.log(`  - 缓存命中率: ${finalStats.cacheHitRate}`);
  console.log(`  - 画像创建数: ${finalStats.profilesCreated}`);
  console.log(`  - 画像更新数: ${finalStats.profilesUpdated}`);

  // 清理
  await profileManager.cleanup();
  await dataCollector.cleanup();

  // 清理测试数据
  console.log('\n🧹 清理测试数据...');
  db.prepare('DELETE FROM user_profiles WHERE user_id LIKE ?').run('test_profile_%');
  db.prepare('DELETE FROM tool_usage_events WHERE user_id LIKE ?').run('test_profile_%');
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
