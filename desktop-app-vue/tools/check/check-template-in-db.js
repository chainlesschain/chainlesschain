/**
 * 检查数据库中模板的实际内容
 * 用于诊断为什么 prompt_template 字段为空
 */

const path = require('path');
const fs = require('fs');

async function checkTemplateInDatabase() {
  console.log('=== 检查数据库中的模板数据 ===\n');

  try {
    // 动态导入 sql.js
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();

    // 数据库路径
    const dbPath = path.join(
      'C:',
      'code',
      'chainlesschain',
      'data',
      'chainlesschain.db'
    );

    console.log('数据库路径:', dbPath);

    // 检查数据库文件是否存在
    if (!fs.existsSync(dbPath)) {
      console.error('❌ 数据库文件不存在:', dbPath);
      return;
    }

    // 读取数据库文件
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    // 查询模板总数
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM project_templates WHERE deleted = 0');
    const totalCount = countStmt.getAsObject();
    console.log(`✓ 数据库中共有 ${totalCount.count} 个模板\n`);
    countStmt.free();

    // 查询特定模板
    const templateId = 'tpl_lifestyle_wellness_002';
    console.log(`--- 查询模板: ${templateId} ---\n`);

    const stmt = db.prepare(`
      SELECT
        id,
        name,
        display_name,
        category,
        LENGTH(prompt_template) as prompt_length,
        SUBSTR(prompt_template, 1, 200) as prompt_preview,
        LENGTH(variables_schema) as schema_length,
        SUBSTR(variables_schema, 1, 200) as schema_preview
      FROM project_templates
      WHERE id = ? AND deleted = 0
    `);

    const template = stmt.getAsObject([templateId]);
    stmt.free();

    if (!template || !template.id) {
      console.error(`❌ 模板 ${templateId} 不存在\n`);

      // 列出所有模板ID
      console.log('--- 现有模板列表 ---');
      const allStmt = db.prepare('SELECT id, display_name, category FROM project_templates WHERE deleted = 0 LIMIT 10');
      let count = 0;
      while (allStmt.step()) {
        const row = allStmt.getAsObject();
        count++;
        console.log(`${count}. ${row.id} - ${row.display_name} (${row.category})`);
      }
      allStmt.free();
    } else {
      console.log('模板信息:');
      console.log('  ID:', template.id);
      console.log('  名称:', template.display_name || template.name);
      console.log('  分类:', template.category);
      console.log('  prompt_template 长度:', template.prompt_length || 0, '字符');
      console.log('  variables_schema 长度:', template.schema_length || 0, '字符');

      if (template.prompt_length > 0) {
        console.log('\n✓ prompt_template 预览:');
        console.log(template.prompt_preview);
        console.log('...');
      } else {
        console.log('\n❌ prompt_template 为空或NULL');
      }

      if (template.schema_length > 0) {
        console.log('\n✓ variables_schema 预览:');
        console.log(template.schema_preview);
        console.log('...');
      } else {
        console.log('\n❌ variables_schema 为空或NULL');
      }
    }

    // 统计所有模板的 prompt_template 状态
    console.log('\n--- 所有模板的 prompt_template 状态 ---');
    const statsStmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN prompt_template IS NULL OR prompt_template = '' THEN 1 ELSE 0 END) as empty,
        SUM(CASE WHEN LENGTH(prompt_template) > 0 THEN 1 ELSE 0 END) as valid
      FROM project_templates
      WHERE deleted = 0
    `);
    const stats = statsStmt.getAsObject();
    statsStmt.free();

    console.log(`总模板数: ${stats.total}`);
    console.log(`有效模板 (有 prompt_template): ${stats.valid}`);
    console.log(`空模板 (无 prompt_template): ${stats.empty}`);

    if (stats.empty > 0) {
      console.log('\n⚠️ 检测到空模板，列出前5个:');
      const emptyStmt = db.prepare(`
        SELECT id, display_name, category
        FROM project_templates
        WHERE deleted = 0 AND (prompt_template IS NULL OR prompt_template = '')
        LIMIT 5
      `);
      let idx = 0;
      while (emptyStmt.step()) {
        const row = emptyStmt.getAsObject();
        idx++;
        console.log(`  ${idx}. ${row.id} - ${row.display_name} (${row.category})`);
      }
      emptyStmt.free();
    }

    db.close();
    console.log('\n=== 检查完成 ===');

  } catch (error) {
    console.error('\n❌ 检查失败:', error.message);
    console.error(error.stack);
  }
}

// 运行检查
checkTemplateInDatabase().catch(console.error);
