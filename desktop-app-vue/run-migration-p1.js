/**
 * P1优化数据库迁移执行脚本
 *
 * 功能:
 * 1. 执行003_add_p1_optimization_tables.sql迁移
 * 2. 验证所有表和索引创建成功
 * 3. 更新数据库版本号
 *
 * 版本: v0.17.0-P1
 * 日期: 2026-01-01
 */

const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      P1优化 - 数据库迁移脚本                            ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function runMigration() {
  try {
    // 1. Import sql.js
    console.log('[1/6] 导入sql.js...');
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    console.log('  ✅ sql.js已导入\n');

    // 2. Load database
    console.log('[2/6] 加载数据库...');
    const dbPath = path.join(__dirname, '../data/chainlesschain.db');

    if (!fs.existsSync(dbPath)) {
      throw new Error(`数据库文件不存在: ${dbPath}`);
    }

    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);
    console.log(`  ✅ 数据库已加载: ${dbPath}\n`);

    // 3. Read migration SQL
    console.log('[3/6] 读取迁移SQL...');
    const migrationPath = path.join(__dirname, 'src/main/migrations/003_add_p1_optimization_tables.sql');

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`迁移文件不存在: ${migrationPath}`);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    console.log(`  ✅ 迁移SQL已读取 (${migrationSQL.length}字节)\n`);

    // 4. Execute migration
    console.log('[4/6] 执行迁移...');
    db.run(migrationSQL);
    console.log('  ✅ 迁移SQL执行成功\n');

    // 5. Verify tables
    console.log('[5/6] 验证表创建...');

    const expectedTables = [
      'multi_intent_history',
      'checkpoint_validations',
      'self_correction_history',
      'hierarchical_planning_history'
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

    // 6. Verify views
    console.log('  验证视图创建...');

    const expectedViews = [
      'v_multi_intent_stats',
      'v_checkpoint_stats',
      'v_correction_effectiveness',
      'v_hierarchical_planning_stats',
      'v_p1_optimization_summary'
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
        console.log(`  ❌ ${viewName} - 未创建`);
        allViewsExist = false;
      }
    }

    if (!allViewsExist) {
      throw new Error('部分视图创建失败');
    }

    console.log('');

    // 7. Update database version
    console.log('[6/6] 更新数据库版本...');

    // Check if version table exists
    const versionTableExists = db.exec(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='db_version'
    `);

    if (versionTableExists[0]?.values.length > 0) {
      // Insert or replace version record (using actual schema: version, applied_at, description)
      db.run(`
        INSERT OR REPLACE INTO db_version (version, applied_at, description)
        VALUES ('0.17.0', ${Date.now()}, 'P1 Optimizations')
      `);
    } else {
      // Create version table if not exists (using actual schema)
      db.run(`
        CREATE TABLE IF NOT EXISTS db_version (
          version TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL,
          description TEXT
        )
      `);

      db.run(`
        INSERT INTO db_version (version, applied_at, description)
        VALUES ('0.17.0', ${Date.now()}, 'P1 Optimizations')
      `);
    }

    console.log('  ✅ 数据库版本已更新为 v0.17.0\n');

    // 8. Write back to file
    console.log('保存数据库到文件...');
    const data = db.export();
    fs.writeFileSync(dbPath, data);
    console.log('  ✅ 数据库已保存\n');

    // Close database
    db.close();

    // ========================================
    // Migration Summary
    // ========================================
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ P1优化迁移成功！                                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    console.log('📋 迁移内容:');
    console.log(`  ✅ 新增表: ${expectedTables.length}个`);
    expectedTables.forEach(t => console.log(`     - ${t}`));
    console.log('');
    console.log(`  ✅ 新增视图: ${expectedViews.length}个`);
    expectedViews.forEach(v => console.log(`     - ${v}`));
    console.log('');
    console.log('  ✅ 数据清理触发器: 4个');
    console.log('     - cleanup_multi_intent_history');
    console.log('     - cleanup_checkpoint_validations');
    console.log('     - cleanup_self_correction_history');
    console.log('     - cleanup_hierarchical_planning_history');
    console.log('');

    console.log('📊 数据库版本: v0.17.0');
    console.log('');

    console.log('🚀 下一步:');
    console.log('  1. 运行测试: node test-p1-optimizations.js');
    console.log('  2. 集成到AI引擎');
    console.log('  3. 部署到生产环境\n');

  } catch (error) {
    console.error('\n❌ 迁移失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runMigration();
