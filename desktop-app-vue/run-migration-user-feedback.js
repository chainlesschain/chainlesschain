/**
 * 用户反馈系统数据库迁移脚本
 * 创建用户反馈收集相关的表
 */

const path = require('path');
const fs = require('fs');

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function logSuccess(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function logError(msg) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function logInfo(msg) {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║     用户反馈系统数据库迁移                               ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function main() {
  try {
    // 读取迁移SQL文件
    const migrationPath = path.join(__dirname, 'src/main/migrations/006_add_user_feedback.sql');
    logInfo(`读取迁移文件: ${migrationPath}`);

    if (!fs.existsSync(migrationPath)) {
      logError('迁移文件不存在！');
      process.exit(1);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    logSuccess('迁移文件读取成功');

    // 连接数据库
    const DatabaseManager = require('./src/main/database');
    const dbPath = path.join(__dirname, 'data/chainlesschain.db');
    logInfo(`连接数据库: ${dbPath}`);

    const db = new DatabaseManager(dbPath, { encryptionEnabled: false });
    await db.initialize();
    logSuccess('数据库连接成功');

    // 执行迁移
    logInfo('开始执行迁移...');
    db.db.exec(migrationSQL);
    logSuccess('迁移执行成功');

    // 验证表是否创建
    logInfo('验证表创建...');
    const tables = db.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN (
        'user_feedback',
        'satisfaction_surveys',
        'feature_usage_tracking',
        'performance_issues'
      )
      ORDER BY name
    `).all();

    console.log(`\n创建的表 (${tables.length}/4):`);
    tables.forEach(table => {
      console.log(`  ${colors.green}✓${colors.reset} ${table.name}`);
    });

    if (tables.length === 4) {
      logSuccess('\n所有表创建成功！');
    } else {
      logError(`\n表创建不完整 (${tables.length}/4)`);
      process.exit(1);
    }

    // 验证视图创建
    const views = db.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='view' AND name LIKE 'v_%feedback%' OR name LIKE 'v_%satisfaction%' OR name LIKE 'v_%feature%' OR name LIKE 'v_%performance%'
      ORDER BY name
    `).all();

    console.log(`\n创建的视图 (${views.length}/4):`);
    views.forEach(view => {
      console.log(`  ${colors.blue}ℹ${colors.reset} ${view.name}`);
    });

    // 验证索引创建
    const indexes = db.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='index' AND name LIKE 'idx_feedback%' OR name LIKE 'idx_survey%' OR name LIKE 'idx_usage%' OR name LIKE 'idx_perf%'
    `).all();

    console.log(`\n创建的索引: ${indexes.length} 个`);

    // 验证触发器创建
    const triggers = db.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='trigger' AND name LIKE 'cleanup_%'
    `).all();

    console.log(`创建的触发器 (${triggers.length}/4):`);
    triggers.forEach(trigger => {
      console.log(`  ${colors.yellow}⚡${colors.reset} ${trigger.name}`);
    });

    db.close();

    console.log('\n' + '='.repeat(70));
    console.log('✅ 用户反馈系统迁移完成！');
    console.log('='.repeat(70));
    console.log('\n📋 创建的功能:');
    console.log('   1. 用户反馈表 (user_feedback) - 收集Bug、功能请求、体验反馈');
    console.log('   2. 满意度调查表 (satisfaction_surveys) - 定期用户满意度调查');
    console.log('   3. 功能使用追踪表 (feature_usage_tracking) - 自动追踪功能使用情况');
    console.log('   4. 性能问题表 (performance_issues) - 自动记录性能异常');
    console.log('\n🔧 使用方法:');
    console.log('   - 在主进程中引入: const FeedbackCollector = require(\'./feedback/feedback-collector\');');
    console.log('   - 初始化: const collector = new FeedbackCollector(database);');
    console.log('   - 提交反馈: await collector.submitFeedback({...});');
    console.log('   - 提交调查: await collector.submitSatisfactionSurvey({...});');
    console.log('   - 追踪使用: await collector.trackFeatureUsage(\'feature_name\', {...});');
    console.log('\n📊 查看统计:');
    console.log('   - 反馈统计: SELECT * FROM v_feedback_stats;');
    console.log('   - 满意度趋势: SELECT * FROM v_satisfaction_trends;');
    console.log('   - 功能热度: SELECT * FROM v_feature_popularity;');
    console.log('   - 性能热点: SELECT * FROM v_performance_hotspots;\n');

    process.exit(0);

  } catch (error) {
    logError(`迁移失败: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
