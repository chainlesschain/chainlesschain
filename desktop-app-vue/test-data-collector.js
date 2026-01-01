/**
 * DataCollector 测试脚本
 * 验证数据收集模块功能
 */

const Database = require('better-sqlite3');
const path = require('path');
const DataCollector = require('./src/main/ai-engine/data-collector');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      DataCollector 功能测试                              ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function runTests() {
  const dbPath = path.join(__dirname, 'data/chainlesschain.db');
  const db = new Database(dbPath);

  const collector = new DataCollector({
    enableCollection: true,
    batchSize: 5,
    flushInterval: 2000,
    enableValidation: true
  });

  collector.setDatabase(db);

  let totalTests = 0;
  let passedTests = 0;

  // Test 1: 创建用户画像
  console.log('[1/5] 测试创建用户画像...');
  try {
    await collector.createUserProfile('test_user_001', {
      skillLevel: 'intermediate',
      preferredWorkflow: 'parallel',
      totalTasks: 0,
      successRate: 0
    });

    const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get('test_user_001');
    totalTests++;
    if (profile && profile.user_id === 'test_user_001') {
      console.log('  ✓ 用户画像创建成功');
      passedTests++;
    } else {
      console.log('  ✗ 用户画像创建失败');
    }
  } catch (error) {
    console.log('  ✗ 创建用户画像失败:', error.message);
    totalTests++;
  }

  // Test 2: 收集工具使用事件
  console.log('\n[2/5] 测试收集工具使用事件...');
  try {
    await collector.collectToolUsage({
      userId: 'test_user_001',
      sessionId: 'session_001',
      toolName: 'codeGeneration',
      toolCategory: 'development',
      taskType: 'CREATE_FUNCTION',
      taskContext: { language: 'JavaScript' },
      executionTime: 1500,
      success: true,
      userFeedback: 'positive'
    });

    // 立即刷新
    await collector.flush();

    const events = db.prepare('SELECT * FROM tool_usage_events WHERE user_id = ?').all('test_user_001');
    totalTests++;
    if (events.length > 0) {
      console.log(`  ✓ 工具使用事件收集成功 (${events.length}条)`);
      passedTests++;
    } else {
      console.log('  ✗ 工具使用事件收集失败');
    }
  } catch (error) {
    console.log('  ✗ 收集工具使用事件失败:', error.message);
    totalTests++;
  }

  // Test 3: 批量收集事件
  console.log('\n[3/5] 测试批量收集事件...');
  try {
    const eventCount = 10;
    for (let i = 0; i < eventCount; i++) {
      await collector.collectToolUsage({
        userId: 'test_user_001',
        sessionId: 'session_002',
        toolName: `tool_${i}`,
        executionTime: Math.random() * 2000,
        success: Math.random() > 0.2
      });
    }

    await collector.flush();

    const events = db.prepare('SELECT COUNT(*) as count FROM tool_usage_events WHERE user_id = ?').get('test_user_001');
    totalTests++;
    if (events.count >= eventCount) {
      console.log(`  ✓ 批量事件收集成功 (${events.count}条)`);
      passedTests++;
    } else {
      console.log('  ✗ 批量事件收集失败');
    }
  } catch (error) {
    console.log('  ✗ 批量收集失败:', error.message);
    totalTests++;
  }

  // Test 4: 收集推荐记录
  console.log('\n[4/5] 测试收集推荐记录...');
  try {
    await collector.collectRecommendation({
      userId: 'test_user_001',
      sessionId: 'session_003',
      taskDescription: '生成登录页面',
      recommendedTools: ['codeGeneration', 'formatCode', 'addTests'],
      recommendationScores: { codeGeneration: 0.95, formatCode: 0.82 },
      algorithmUsed: 'hybrid',
      userAction: 'accepted'
    });

    await collector.flush();

    const recs = db.prepare('SELECT * FROM tool_recommendations WHERE user_id = ?').all('test_user_001');
    totalTests++;
    if (recs.length > 0) {
      console.log(`  ✓ 推荐记录收集成功 (${recs.length}条)`);
      passedTests++;
    } else {
      console.log('  ✗ 推荐记录收集失败');
    }
  } catch (error) {
    console.log('  ✗ 收集推荐记录失败:', error.message);
    totalTests++;
  }

  // Test 5: 更新用户画像
  console.log('\n[5/5] 测试更新用户画像...');
  try {
    await collector.updateUserProfile('test_user_001', {
      taskIncrement: 5,
      successRate: 0.85,
      avgTaskDuration: 2500,
      mostUsedTools: [
        { tool: 'codeGeneration', count: 10 },
        { tool: 'fileWrite', count: 8 }
      ]
    });

    const updated = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get('test_user_001');
    totalTests++;
    if (updated && updated.total_tasks === 5) {
      console.log('  ✓ 用户画像更新成功');
      passedTests++;
    } else {
      console.log('  ✗ 用户画像更新失败');
    }
  } catch (error) {
    console.log('  ✗ 更新用户画像失败:', error.message);
    totalTests++;
  }

  // 显示统计信息
  console.log('\n📊 DataCollector 统计信息:');
  const stats = collector.getStats();
  console.log(`  - 总事件数: ${stats.totalEvents}`);
  console.log(`  - 成功写入: ${stats.successfulWrites}`);
  console.log(`  - 失败写入: ${stats.failedWrites}`);
  console.log(`  - 收集成功率: ${stats.collectionRate}`);
  console.log(`  - 缓冲区大小: ${stats.bufferSize}`);

  // 清理
  await collector.cleanup();

  // 清理测试数据
  console.log('\n🧹 清理测试数据...');
  db.prepare('DELETE FROM user_profiles WHERE user_id LIKE ?').run('test_user_%');
  db.prepare('DELETE FROM tool_usage_events WHERE user_id LIKE ?').run('test_user_%');
  db.prepare('DELETE FROM tool_recommendations WHERE user_id LIKE ?').run('test_user_%');
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
