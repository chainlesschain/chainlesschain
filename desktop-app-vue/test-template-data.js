/**
 * 测试脚本：检查数据库中的模板数据
 * 用于诊断为什么模板的 prompt_template 字段为空
 */

const path = require('path');
const fs = require('fs');

async function checkTemplateData() {
  console.log('=== 检查模板数据 ===\n');

  // 动态导入 sql.js
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  // 数据库路径
  const dbPath = path.join(__dirname, '../data/chainlesschain.db');

  // 检查数据库文件是否存在
  if (!fs.existsSync(dbPath)) {
    console.error('❌ 数据库文件不存在:', dbPath);
    console.log('\n建议：');
    console.log('1. 先运行应用，让数据库初始化');
    console.log('2. 确认数据库路径是否正确');
    return;
  }

  try {
    // 读取数据库文件
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    // 查询所有模板
    const allTemplatesStmt = db.prepare('SELECT COUNT(*) as count FROM project_templates WHERE deleted = 0');
    const totalCount = allTemplatesStmt.getAsObject();
    console.log(`✓ 数据库中共有 ${totalCount.count} 个模板\n`);
    allTemplatesStmt.free();

    // 查询缺少 prompt_template 的模板
    const missingPromptStmt = db.prepare(`
      SELECT id, name, display_name, category, project_type,
             LENGTH(prompt_template) as template_length,
             prompt_template
      FROM project_templates
      WHERE deleted = 0
      AND (prompt_template IS NULL OR prompt_template = '')
    `);

    console.log('--- 检查缺少 prompt_template 的模板 ---');
    let missingCount = 0;
    while (missingPromptStmt.step()) {
      const row = missingPromptStmt.getAsObject();
      missingCount++;
      console.log(`\n❌ 模板 #${missingCount}:`);
      console.log(`   ID: ${row.id}`);
      console.log(`   名称: ${row.display_name || row.name}`);
      console.log(`   分类: ${row.category} / ${row.project_type}`);
      console.log(`   prompt_template 长度: ${row.template_length || 0}`);
      console.log(`   prompt_template 值: ${row.prompt_template ? `"${row.prompt_template.substring(0, 50)}..."` : 'NULL'}`);
    }
    missingPromptStmt.free();

    if (missingCount === 0) {
      console.log('✓ 所有模板都有 prompt_template\n');
    } else {
      console.log(`\n⚠️  发现 ${missingCount} 个模板缺少 prompt_template`);
      console.log('\n建议修复方法：');
      console.log('1. 检查模板 JSON 文件是否包含 prompt_template 字段');
      console.log('2. 重新初始化模板管理器，加载模板数据');
      console.log('3. 手动更新数据库中缺失的模板数据\n');
    }

    // 显示一些正常模板的示例
    console.log('--- 查看正常模板示例（前3个）---');
    const validTemplatesStmt = db.prepare(`
      SELECT id, name, display_name, category,
             LENGTH(prompt_template) as template_length,
             SUBSTR(prompt_template, 1, 100) as template_preview
      FROM project_templates
      WHERE deleted = 0
      AND prompt_template IS NOT NULL
      AND prompt_template != ''
      LIMIT 3
    `);

    let validCount = 0;
    while (validTemplatesStmt.step()) {
      const row = validTemplatesStmt.getAsObject();
      validCount++;
      console.log(`\n✓ 模板 #${validCount}:`);
      console.log(`   ID: ${row.id}`);
      console.log(`   名称: ${row.display_name || row.name}`);
      console.log(`   分类: ${row.category}`);
      console.log(`   prompt_template 长度: ${row.template_length} 字符`);
      console.log(`   预览: ${row.template_preview}...`);
    }
    validTemplatesStmt.free();

    // 关闭数据库
    db.close();

    console.log('\n=== 检查完成 ===');

  } catch (error) {
    console.error('❌ 检查失败:', error.message);
    console.error(error.stack);
  }
}

// 运行检查
checkTemplateData().catch(console.error);
