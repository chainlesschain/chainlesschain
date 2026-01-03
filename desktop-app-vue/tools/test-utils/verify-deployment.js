/**
 * P1优化部署验证脚本
 * 自动检查部署是否成功
 *
 * 运行: node verify-deployment.js
 */

const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      P1优化部署验证                                      ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

let passed = 0;
let total = 0;
const issues = [];

function check(name, condition, errorMsg = null) {
  total++;
  if (condition) {
    console.log(`✅ [${total}] ${name}`);
    passed++;
    return true;
  } else {
    console.log(`❌ [${total}] ${name}`);
    if (errorMsg) {
      console.log(`      错误: ${errorMsg}`);
      issues.push({ check: name, error: errorMsg });
    }
    return false;
  }
}

async function verify() {
  console.log('开始验证部署...\n');

  // ========================================
  // 1. 文件检查
  // ========================================
  console.log('[阶段1] 文件完整性检查\n');

  check(
    'P1引擎文件存在',
    fs.existsSync(path.join(__dirname, 'src/main/ai-engine/ai-engine-manager-p1.js')),
    'ai-engine-manager-p1.js 文件不存在'
  );

  check(
    'P1迁移脚本存在',
    fs.existsSync(path.join(__dirname, 'run-migration-p1.js')),
    'run-migration-p1.js 文件不存在'
  );

  check(
    'P1迁移SQL存在',
    fs.existsSync(path.join(__dirname, 'src/main/migrations/003_add_p1_optimization_tables.sql')),
    'P1迁移SQL文件不存在'
  );

  check(
    'P1配置文件存在',
    fs.existsSync(path.join(__dirname, '.env.production')),
    '.env.production 文件不存在'
  );

  check(
    '部署清单存在',
    fs.existsSync(path.join(__dirname, '../DEPLOYMENT_CHECKLIST.md')),
    'DEPLOYMENT_CHECKLIST.md 文件不存在'
  );

  check(
    '回滚脚本存在',
    fs.existsSync(path.join(__dirname, 'rollback-p1.js')),
    'rollback-p1.js 文件不存在'
  );

  // ========================================
  // 2. 代码检查
  // ========================================
  console.log('\n[阶段2] 代码集成检查\n');

  const indexPath = path.join(__dirname, 'src/main/index.js');
  if (fs.existsSync(indexPath)) {
    const indexContent = fs.readFileSync(indexPath, 'utf-8');

    check(
      '主入口使用P1引擎',
      indexContent.includes('AIEngineManagerP1'),
      'index.js 未导入 AIEngineManagerP1'
    );

    check(
      '主入口引用P1模块',
      indexContent.includes('ai-engine-manager-p1'),
      'index.js 未 require P1模块'
    );

    check(
      '别名配置正确',
      indexContent.includes('const AIEngineManager = AIEngineManagerP1'),
      '别名未指向P1引擎'
    );
  } else {
    check('主入口文件存在', false, 'index.js 文件不存在');
  }

  // ========================================
  // 3. 配置检查
  // ========================================
  console.log('\n[阶段3] 配置文件检查\n');

  const configPath = path.join(__dirname, 'src/main/ai-engine/ai-engine-config.js');
  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf-8');

    check(
      '配置包含P1模块开关',
      configContent.includes('enableMultiIntent') &&
      configContent.includes('enableDynamicFewShot') &&
      configContent.includes('enableHierarchicalPlanning'),
      '配置文件缺少P1模块开关'
    );

    check(
      '配置包含P1模块配置',
      configContent.includes('multiIntentConfig') &&
      configContent.includes('fewShotConfig'),
      '配置文件缺少P1模块配置项'
    );
  } else {
    check('配置文件存在', false, 'ai-engine-config.js 文件不存在');
  }

  // ========================================
  // 4. 数据库检查
  // ========================================
  console.log('\n[阶段4] 数据库检查\n');

  const dbPath = path.join(__dirname, '../data/chainlesschain.db');

  check(
    '数据库文件存在',
    fs.existsSync(dbPath),
    'chainlesschain.db 文件不存在'
  );

  if (fs.existsSync(dbPath)) {
    try {
      const DatabaseManager = require('./src/main/database');
      const db = new DatabaseManager(dbPath, { encryptionEnabled: false });
      await db.initialize();
      DatabaseManager.setDatabase(db);

      // 检查P1表
      const tables = db.all(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name IN (
          'multi_intent_history',
          'checkpoint_validations',
          'self_correction_history',
          'hierarchical_planning_history'
        )
      `);

      check(
        'P1数据库表已创建',
        tables.length === 4,
        `只找到 ${tables.length}/4 个P1表`
      );

      // 检查P1视图
      const views = db.all(`
        SELECT name FROM sqlite_master
        WHERE type='view' AND name LIKE 'v_%optimization%'
        OR name LIKE 'v_%intent%'
        OR name LIKE 'v_%checkpoint%'
        OR name LIKE 'v_%correction%'
        OR name LIKE 'v_%planning%'
      `);

      check(
        'P1统计视图已创建',
        views.length >= 5,
        `只找到 ${views.length} 个P1视图`
      );

      // 检查触发器
      const triggers = db.all(`
        SELECT name FROM sqlite_master
        WHERE type='trigger' AND name LIKE 'cleanup_%'
      `);

      check(
        'P1自动清理触发器已创建',
        triggers.length >= 4,
        `只找到 ${triggers.length} 个清理触发器`
      );

    } catch (error) {
      check('数据库初始化', false, error.message);
    }
  }

  // ========================================
  // 5. 模块可用性检查
  // ========================================
  console.log('\n[阶段5] P1模块可用性检查\n');

  try {
    const MultiIntentRecognizer = require('./src/main/ai-engine/multi-intent-recognizer');
    check('多意图识别器模块可加载', true);
  } catch (error) {
    check('多意图识别器模块可加载', false, error.message);
  }

  try {
    const DynamicFewShotLearner = require('./src/main/ai-engine/dynamic-few-shot-learner');
    check('Few-shot学习器模块可加载', true);
  } catch (error) {
    check('Few-shot学习器模块可加载', false, error.message);
  }

  try {
    const HierarchicalTaskPlanner = require('./src/main/ai-engine/hierarchical-task-planner');
    check('分层规划器模块可加载', true);
  } catch (error) {
    check('分层规划器模块可加载', false, error.message);
  }

  try {
    const CheckpointValidator = require('./src/main/ai-engine/checkpoint-validator');
    check('检查点校验器模块可加载', true);
  } catch (error) {
    check('检查点校验器模块可加载', false, error.message);
  }

  try {
    const SelfCorrectionLoop = require('./src/main/ai-engine/self-correction-loop');
    check('自我修正循环模块可加载', true);
  } catch (error) {
    check('自我修正循环模块可加载', false, error.message);
  }

  try {
    const { AIEngineManagerP1 } = require('./src/main/ai-engine/ai-engine-manager-p1');
    check('P1引擎管理器可加载', true);
  } catch (error) {
    check('P1引擎管理器可加载', false, error.message);
  }

  // ========================================
  // 6. 生成报告
  // ========================================
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                   验证报告                               ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`通过检查: ${passed}/${total}`);
  console.log(`成功率: ${((passed / total) * 100).toFixed(1)}%\n`);

  if (passed === total) {
    console.log('🎉 所有检查通过！P1部署验证成功！\n');

    console.log('✅ 部署状态: 就绪');
    console.log('✅ 文件: 完整');
    console.log('✅ 代码集成: 正确');
    console.log('✅ 配置: 正确');
    console.log('✅ 数据库: 已迁移');
    console.log('✅ 模块: 可用\n');

    console.log('🚀 下一步:');
    console.log('  1. 启动应用进行功能测试');
    console.log('  2. 监控性能指标');
    console.log('  3. 检查日志确保无错误\n');

    process.exit(0);
  } else {
    console.log(`⚠️ ${total - passed} 个检查失败\n`);

    if (issues.length > 0) {
      console.log('❌ 发现的问题:\n');
      issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue.check}`);
        console.log(`   错误: ${issue.error}\n`);
      });
    }

    console.log('🔧 建议:');
    console.log('  1. 检查上述失败项');
    console.log('  2. 参考 DEPLOYMENT_CHECKLIST.md');
    console.log('  3. 如需帮助，查看部署文档\n');

    console.log('⚠️ 如果问题严重，可以运行回滚: node rollback-p1.js\n');

    process.exit(1);
  }
}

verify().catch(error => {
  console.error('\n❌ 验证过程出错:', error.message);
  console.error(error.stack);
  process.exit(1);
});
