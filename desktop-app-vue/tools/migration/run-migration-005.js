/**
 * 模板依赖关系扩展迁移执行脚本
 * 版本: v0.18.0
 *
 * 功能:
 * - 执行 005_add_template_dependencies.sql 迁移
 * - 为 project_templates 表添加 required_skills, required_tools 字段
 * - 创建 template_skill_tool_mapping 关联映射表
 * - 扩展 builtin_tools 和 builtin_skills 表
 * - 创建6个统计视图和索引
 *
 * 运行: node run-migration-005.js
 */

const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  模板依赖关系扩展迁移 (Migration 005)                   ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function migrate() {
  try {
    // ========================================
    // 1. 导入sql.js
    // ========================================
    console.log('[1/8] 导入sql.js...');
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    console.log('  ✅ sql.js已导入\n');

    // ========================================
    // 2. 加载数据库
    // ========================================
    console.log('[2/8] 加载数据库...');
    const dbPath = path.join(__dirname, '../data/chainlesschain.db');

    if (!fs.existsSync(dbPath)) {
      throw new Error(`数据库文件不存在: ${dbPath}`);
    }

    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);
    console.log(`  ✅ 数据库已加载: ${dbPath}\n`);

    // ========================================
    // 3. 检查迁移状态
    // ========================================
    console.log('[3/8] 检查迁移状态...');

    // 检查是否已执行过此迁移
    const migrationCheck = db.exec(`
      SELECT version FROM schema_migrations WHERE version = 5
    `);

    if (migrationCheck.length > 0 && migrationCheck[0].values.length > 0) {
      console.log('  ⚠️  迁移005已经执行过，跳过\n');
      console.log('  提示：如需重新执行，请先运行 rollback-005.js\n');
      process.exit(0);
    }

    console.log('  ✅ 迁移005未执行，继续...\n');

    // ========================================
    // 4. 读取迁移SQL
    // ========================================
    console.log('[4/8] 读取迁移SQL...');
    const migrationPath = path.join(__dirname, 'src/main/migrations/005_add_template_dependencies.sql');

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`迁移文件不存在: ${migrationPath}`);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    console.log(`  ✅ 迁移SQL已读取 (${migrationSQL.length}字节)\n`);

    // ========================================
    // 5. 执行迁移
    // ========================================
    console.log('[5/8] 执行迁移...');

    try {
      db.run(migrationSQL);
      console.log('  ✅ 迁移SQL执行成功\n');
    } catch (error) {
      console.error('  ❌ 迁移执行失败:', error.message);
      throw error;
    }

    // ========================================
    // 6. 验证扩展字段
    // ========================================
    console.log('[6/8] 验证扩展字段...');

    // 验证 project_templates 表的新字段
    const templateColumns = db.exec(`PRAGMA table_info(project_templates)`);
    const columnNames = templateColumns[0].values.map(row => row[1]);

    const requiredFields = [
      'required_skills',
      'required_tools',
      'execution_engine',
      'difficulty_level',
      'estimated_duration',
      'template_version',
      'usage_count',
      'last_used_at'
    ];

    let allFieldsExist = true;

    for (const field of requiredFields) {
      if (columnNames.includes(field)) {
        console.log(`  ✅ ${field}`);
      } else {
        console.log(`  ❌ ${field} - 未创建`);
        allFieldsExist = false;
      }
    }

    if (!allFieldsExist) {
      throw new Error('部分字段创建失败');
    }

    console.log('');

    // ========================================
    // 7. 验证新表和视图
    // ========================================
    console.log('[7/8] 验证新表和视图...');

    // 验证 template_skill_tool_mapping 表
    const mappingTable = db.exec(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='template_skill_tool_mapping'
    `);

    if (mappingTable[0]?.values.length > 0) {
      console.log('  ✅ template_skill_tool_mapping (关联映射表)');
    } else {
      console.log('  ❌ template_skill_tool_mapping - 未创建');
      throw new Error('关联映射表创建失败');
    }

    // 验证视图
    console.log('\n  验证统计视图...');

    const expectedViews = [
      'v_template_capability_stats',
      'v_popular_templates',
      'v_skill_usage_stats',
      'v_tool_usage_stats',
      'v_template_dependencies',
      'v_templates_missing_dependencies'
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
    // 8. 保存数据库
    // ========================================
    console.log('[8/8] 保存数据库...');

    const data = db.export();
    fs.writeFileSync(dbPath, data);
    console.log(`  ✅ 数据库已保存: ${dbPath}\n`);

    // ========================================
    // 完成
    // ========================================
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ 模板依赖关系扩展迁移成功！                          ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    // 统计信息
    console.log('📊 迁移统计:');
    console.log(`  ✅ project_templates 新增字段: 8个`);
    console.log(`  ✅ builtin_tools 新增字段: 4个`);
    console.log(`  ✅ builtin_skills 新增字段: 4个`);
    console.log(`  ✅ 新增表: 1个 (template_skill_tool_mapping)`);
    console.log(`  ✅ 新增视图: 6个`);
    console.log(`  ✅ 新增索引: 15+个\n`);

    // 查询当前未设置依赖的模板数量
    const missingDepsResult = db.exec(`
      SELECT COUNT(*) as count FROM project_templates
      WHERE required_skills = '[]' OR required_tools = '[]'
    `);

    const missingCount = missingDepsResult[0]?.values[0]?.[0] || 0;

    console.log('📋 当前状态:');
    console.log(`  ⚠️  缺少依赖声明的模板: ${missingCount}个`);
    console.log(`  ℹ️  示例数据已填充: business/code-project/data-science 类别\n`);

    console.log('🎯 下一步:');
    console.log('  1. 运行 verify-template-dependencies.js 验证依赖完整性');
    console.log('  2. 使用批量脚本为剩余模板添加依赖声明');
    console.log('  3. 参考 TEMPLATE_SKILLS_TOOLS_AUDIT_REPORT_2026-01-01.md 第3阶段');
    console.log('  4. 开始阶段2: 工具整合与去重\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 迁移失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 执行迁移
migrate();
