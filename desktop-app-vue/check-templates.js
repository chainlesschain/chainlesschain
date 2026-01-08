/**
 * 检查数据库中的Prompt模板
 */

const path = require('path');
const Database = require('better-sqlite3');

console.log('\n========================================');
console.log('检查数据库中的Prompt模板');
console.log('========================================\n');

const dbPath = path.join(__dirname, 'data/chainlesschain.db');
console.log('数据库路径:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });

  // 检查模板总数
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM prompt_templates').get();
  console.log(`\n📊 模板总数: ${totalCount.count}个\n`);

  // 按分类统计
  console.log('📋 按分类统计:');
  const categoryCounts = db.prepare(`
    SELECT category, COUNT(*) as count
    FROM prompt_templates
    GROUP BY category
    ORDER BY count DESC
  `).all();

  categoryCounts.forEach(row => {
    console.log(`  ${row.category}: ${row.count}个`);
  });

  // 详细列出所有模板
  console.log('\n\n📝 所有模板详情:\n');
  const allTemplates = db.prepare(`
    SELECT id, name, category, description
    FROM prompt_templates
    ORDER BY category, id
  `).all();

  let currentCategory = '';
  allTemplates.forEach(template => {
    if (template.category !== currentCategory) {
      currentCategory = template.category;
      console.log(`\n【${currentCategory}】`);
    }
    console.log(`  - ${template.name} (${template.id})`);
    if (template.description) {
      console.log(`    ${template.description.substring(0, 50)}...`);
    }
  });

  // 检查职业专用模板
  console.log('\n\n🎯 职业专用模板统计:\n');
  const professionalCategories = ['medical', 'legal', 'education', 'research'];

  professionalCategories.forEach(category => {
    const templates = db.prepare(`
      SELECT id, name
      FROM prompt_templates
      WHERE category = ?
      ORDER BY id
    `).all(category);

    const emoji = category === 'medical' ? '🏥' :
                  category === 'legal' ? '⚖️' :
                  category === 'education' ? '👨‍🏫' : '🔬';

    console.log(`${emoji} ${category}: ${templates.length}个模板`);
    templates.forEach(t => {
      console.log(`  - ${t.name}`);
    });
    console.log('');
  });

  db.close();

  console.log('========================================');
  console.log('检查完成');
  console.log('========================================\n');

} catch (error) {
  console.error('检查失败:', error.message);
  process.exit(1);
}
