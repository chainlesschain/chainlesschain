/**
 * 检查数据库中的分类和模板数据
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data/chainlesschain.db');
const db = new Database(dbPath, { readonly: true });

console.log('='.repeat(60));
console.log('数据库数据检查');
console.log('='.repeat(60));
console.log();

try {
  // 检查项目分类
  const categoriesCount = db.prepare('SELECT COUNT(*) as count FROM project_categories WHERE deleted = 0').get();
  console.log(`📋 项目分类总数: ${categoriesCount.count}`);

  if (categoriesCount.count > 0) {
    console.log('\n一级分类列表:');
    const categories = db.prepare('SELECT name, icon FROM project_categories WHERE deleted = 0 AND parent_id IS NULL ORDER BY sort_order').all();
    categories.forEach(cat => {
      console.log(`  ${cat.icon} ${cat.name}`);
    });
  }

  console.log();

  // 检查模板
  const templatesCount = db.prepare('SELECT COUNT(*) as count FROM project_templates WHERE deleted = 0').get();
  console.log(`📝 模板总数: ${templatesCount.count}`);

  if (templatesCount.count > 0) {
    console.log('\n按分类统计:');
    const templatesByCategory = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM project_templates
      WHERE deleted = 0
      GROUP BY category
      ORDER BY count DESC
    `).all();

    templatesByCategory.forEach(({ category, count }) => {
      console.log(`  ${category.padEnd(20)} ${count} 个模板`);
    });
  }

  console.log();
  console.log('='.repeat(60));

  if (categoriesCount.count === 0 || templatesCount.count === 0) {
    console.log('⚠️  数据未初始化，应用可能还在启动中...');
    console.log('   请稍等片刻或重启应用');
  } else {
    console.log('✅ 数据已正确初始化!');
  }

  console.log('='.repeat(60));
} catch (error) {
  console.error('❌ 检查失败:', error);
} finally {
  db.close();
}
