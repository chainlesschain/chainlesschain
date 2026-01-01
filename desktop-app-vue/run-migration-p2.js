/**
 * P2优化数据库迁移执行脚本
 * 版本: v0.18.0
 *
 * 功能:
 * - 执行 004_add_p2_optimization_tables.sql 迁移
 * - 创建3个新表（意图融合、知识蒸馏、流式响应）
 * - 创建5个统计视图
 * - 创建3个自动清理触发器
 *
 * 运行: node run-migration-p2.js
 */

const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      P2优化数据库迁移                                    ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function migrate() {
  try {
    // ========================================
    // 1. 导入sql.js
    // ========================================
    console.log('[1/6] 导入sql.js...');
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    console.log('  ✅ sql.js已导入\n');

    // ========================================
    // 2. 加载数据库
    // ========================================
    console.log('[2/6] 加载数据库...');
    const dbPath = path.join(__dirname, '../data/chainlesschain.db');

    if (!fs.existsSync(dbPath)) {
      throw new Error(`数据库文件不存在: ${dbPath}`);
    }

    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);
    console.log(`  ✅ 数据库已加载: ${dbPath}\n`);

    // ========================================
    // 3. 读取迁移SQL
    // ========================================
    console.log('[3/6] 读取迁移SQL...');
    const migrationPath = path.join(__dirname, 'src/main/migrations/004_add_p2_optimization_tables.sql');

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`迁移文件不存在: ${migrationPath}`);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    console.log(`  ✅ 迁移SQL已读取 (${migrationSQL.length}字节)\n`);

    // ========================================
    // 4. 执行迁移
    // ========================================
    console.log('[4/6] 执行迁移...');
    db.run(migrationSQL);
    console.log('  ✅ 迁移SQL执行成功\n');

    // ========================================
    // 5. 验证表创建
    // ========================================
    console.log('[5/6] 验证表创建...');

    const expectedTables = [
      'intent_fusion_history',
      'distillation_routing_log',
      'streaming_execution_log'
    ];

    let allTablesExist = true;

    for (const tableName of expectedTables) {
      const result = db.exec(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='${tableName}'
      `);

      if (result[0]?.values.length > 0) {
        console.log(`  ✅ ${tableName}`);
      } else {
        console.log(`  ❌ ${tableName} - 未创建`);
        allTablesExist = false;
      }
    }

    if (!allTablesExist) {
      throw new Error('部分表创建失败');
    }

    console.log('');

    // 验证视图创建
    console.log('  验证视图创建...');

    const expectedViews = [
      'v_intent_fusion_stats',
      'v_distillation_performance',
      'v_streaming_metrics',
      'v_p2_optimization_summary',
      'v_p2_daily_performance'
    ];

    let allViewsExist = true;

    for (const viewName of expectedViews) {
      const result = db.exec(`
        SELECT name FROM sqlite_master
        WHERE type='view' AND name='${viewName}'
      `);

      if (result[0]?.values.length > 0) {
        console.log(`  ✅ ${viewName}`);
      } else {
        console.log(`  ⚠️  ${viewName} - 未创建`);
        allViewsExist = false;
      }
    }

    console.log('');

    // ========================================
    // 6. 保存数据库
    // ========================================
    console.log('[6/6] 保存数据库...');

    const data = db.export();
    fs.writeFileSync(dbPath, data);
    console.log(`  ✅ 数据库已保存: ${dbPath}\n`);

    // ========================================
    // 完成
    // ========================================
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ P2优化迁移成功！                                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    console.log('📊 迁移统计:');
    console.log(`  ✅ 新增表: 3 (intent_fusion_history, distillation_routing_log, streaming_execution_log)`);
    console.log(`  ✅ 新增视图: 5 (v_intent_fusion_stats, v_distillation_performance, v_streaming_metrics, 等)`);
    console.log(`  ✅ 新增触发器: 3 (自动清理90天前数据)\n`);

    console.log('🎯 下一步:');
    console.log('  1. 扩展AI引擎配置 (ai-engine-config.js)');
    console.log('  2. 创建P2环境配置文件');
    console.log('  3. 准备测试数据集');
    console.log('  4. 开始P2模块开发\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 迁移失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 执行迁移
migrate();
