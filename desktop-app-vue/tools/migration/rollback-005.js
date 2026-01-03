/**
 * 模板依赖关系扩展迁移回滚脚本
 * 版本: v0.18.0
 *
 * 功能:
 * - 回滚 005_add_template_dependencies.sql 迁移
 * - 删除所有新增字段、表、视图、索引
 * - 恢复到迁移前状态
 *
 * ⚠️ 警告: 此操作不可逆，会丢失所有依赖关系数据
 *
 * 运行: node rollback-005.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  ⚠️  模板依赖关系扩展迁移回滚 (Rollback 005)            ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function askConfirmation() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('⚠️  确认回滚？此操作将删除所有依赖关系数据 (yes/no): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

async function rollback() {
  try {
    // 确认回滚
    const confirmed = await askConfirmation();
    if (!confirmed) {
      console.log('\n❌ 回滚已取消\n');
      process.exit(0);
    }

    // ========================================
    // 1. 导入sql.js
    // ========================================
    console.log('\n[1/6] 导入sql.js...');
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

    // 备份数据库
    const backupPath = dbPath + '.backup-before-rollback-005';
    console.log(`  📦 创建备份: ${backupPath}`);
    fs.copyFileSync(dbPath, backupPath);

    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);
    console.log(`  ✅ 数据库已加载\n`);

    // ========================================
    // 3. 检查迁移状态
    // ========================================
    console.log('[3/6] 检查迁移状态...');

    const migrationCheck = db.exec(`
      SELECT version FROM schema_migrations WHERE version = 5
    `);

    if (migrationCheck.length === 0 || migrationCheck[0].values.length === 0) {
      console.log('  ⚠️  迁移005未执行，无需回滚\n');
      process.exit(0);
    }

    console.log('  ✅ 发现迁移005记录，继续回滚...\n');

    // ========================================
    // 4. 执行回滚SQL
    // ========================================
    console.log('[4/6] 执行回滚...');

    const rollbackSQL = `
      -- 删除视图
      DROP VIEW IF EXISTS v_template_capability_stats;
      DROP VIEW IF EXISTS v_popular_templates;
      DROP VIEW IF EXISTS v_skill_usage_stats;
      DROP VIEW IF EXISTS v_tool_usage_stats;
      DROP VIEW IF EXISTS v_template_dependencies;
      DROP VIEW IF EXISTS v_templates_missing_dependencies;

      -- 删除触发器
      DROP TRIGGER IF EXISTS update_mapping_timestamp;
      DROP TRIGGER IF EXISTS increment_template_usage;

      -- 删除关联映射表
      DROP TABLE IF EXISTS template_skill_tool_mapping;

      -- 删除索引
      DROP INDEX IF EXISTS idx_templates_category;
      DROP INDEX IF EXISTS idx_templates_difficulty;
      DROP INDEX IF EXISTS idx_templates_engine;
      DROP INDEX IF EXISTS idx_templates_project_type;
      DROP INDEX IF EXISTS idx_templates_enabled;
      DROP INDEX IF EXISTS idx_templates_usage;
      DROP INDEX IF EXISTS idx_templates_last_used;
      DROP INDEX IF EXISTS idx_tools_category;
      DROP INDEX IF EXISTS idx_tools_usage;
      DROP INDEX IF EXISTS idx_tools_enabled;
      DROP INDEX IF EXISTS idx_skills_category;
      DROP INDEX IF EXISTS idx_skills_usage;
      DROP INDEX IF EXISTS idx_skills_enabled;
      DROP INDEX IF EXISTS idx_skills_level;

      -- 删除 project_templates 表的新字段
      -- 注意：SQLite不支持 ALTER TABLE DROP COLUMN
      -- 需要重建表（保留数据）

      -- 创建临时表（只包含原始字段）
      CREATE TABLE project_templates_backup AS
      SELECT
        id, name, display_name, description,
        category, project_type, icon, tags,
        variables, sections, input_schema, output_structure,
        example_output, doc_path,
        enabled, is_builtin,
        created_at, updated_at
      FROM project_templates;

      -- 删除原表
      DROP TABLE project_templates;

      -- 重命名临时表
      ALTER TABLE project_templates_backup RENAME TO project_templates;

      -- 重建原有索引（如果有）
      CREATE INDEX IF NOT EXISTS idx_templates_name ON project_templates(name);

      -- 删除 builtin_tools 表的新字段
      CREATE TABLE builtin_tools_backup AS
      SELECT
        id, name, display_name, description,
        category, tool_type,
        parameters_schema, return_schema,
        examples, required_permissions, risk_level,
        enabled, is_builtin,
        created_at, updated_at
      FROM builtin_tools;

      DROP TABLE builtin_tools;
      ALTER TABLE builtin_tools_backup RENAME TO builtin_tools;

      -- 删除 builtin_skills 表的新字段
      CREATE TABLE builtin_skills_backup AS
      SELECT
        id, name, display_name, description,
        category, icon, tags,
        config, doc_path, tools,
        enabled, is_builtin,
        created_at, updated_at
      FROM builtin_skills;

      DROP TABLE builtin_skills;
      ALTER TABLE builtin_skills_backup RENAME TO builtin_skills;

      -- 删除迁移记录
      DELETE FROM schema_migrations WHERE version = 5;
    `;

    try {
      db.run(rollbackSQL);
      console.log('  ✅ 回滚SQL执行成功\n');
    } catch (error) {
      console.error('  ❌ 回滚执行失败:', error.message);
      throw error;
    }

    // ========================================
    // 5. 验证回滚
    // ========================================
    console.log('[5/6] 验证回滚...');

    // 检查表是否还存在新字段
    const templateColumns = db.exec(`PRAGMA table_info(project_templates)`);
    const columnNames = templateColumns[0].values.map(row => row[1]);

    const removedFields = [
      'required_skills',
      'required_tools',
      'execution_engine',
      'difficulty_level'
    ];

    let allFieldsRemoved = true;

    for (const field of removedFields) {
      if (!columnNames.includes(field)) {
        console.log(`  ✅ ${field} - 已删除`);
      } else {
        console.log(`  ❌ ${field} - 仍存在`);
        allFieldsRemoved = false;
      }
    }

    // 检查映射表是否已删除
    const mappingCheck = db.exec(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='template_skill_tool_mapping'
    `);

    if (mappingCheck.length === 0 || mappingCheck[0].values.length === 0) {
      console.log('  ✅ template_skill_tool_mapping - 已删除');
    } else {
      console.log('  ❌ template_skill_tool_mapping - 仍存在');
      allFieldsRemoved = false;
    }

    if (!allFieldsRemoved) {
      throw new Error('回滚验证失败，部分对象未删除');
    }

    console.log('');

    // ========================================
    // 6. 保存数据库
    // ========================================
    console.log('[6/6] 保存数据库...');

    const data = db.export();
    fs.writeFileSync(dbPath, data);
    console.log(`  ✅ 数据库已保存\n`);

    // ========================================
    // 完成
    // ========================================
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ 迁移005回滚成功！                                   ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    console.log('📊 回滚统计:');
    console.log('  ✅ 已删除 project_templates 扩展字段');
    console.log('  ✅ 已删除 builtin_tools 扩展字段');
    console.log('  ✅ 已删除 builtin_skills 扩展字段');
    console.log('  ✅ 已删除 template_skill_tool_mapping 表');
    console.log('  ✅ 已删除所有新增视图和索引');
    console.log('  ✅ 已删除迁移记录\n');

    console.log('📦 备份文件:');
    console.log(`  ${backupPath}\n`);

    console.log('ℹ️  如需重新执行迁移，请运行: node run-migration-005.js\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 回滚失败:', error.message);
    console.error(error.stack);
    console.error('\n⚠️  请从备份恢复数据库');
    process.exit(1);
  }
}

// 执行回滚
rollback();
