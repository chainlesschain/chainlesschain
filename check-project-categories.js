const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');

try {
  const db = new Database(dbPath, { readonly: true });

  console.log('=== 检查 project_categories 表 ===\n');

  const categories = db.prepare('SELECT * FROM project_categories ORDER BY sort_order, name').all();

  console.log(`总计: ${categories.length} 条分类记录\n`);

  if (categories.length > 0) {
    console.log('所有分类数据:');
    console.table(categories);

    // 检查是否有is_builtin字段
    const tableInfo = db.prepare('PRAGMA table_info(project_categories)').all();
    console.log('\nproject_categories 表结构:');
    console.table(tableInfo);
  }

  db.close();

} catch (error) {
  console.error('❌ 检查失败:', error.message);
  process.exit(1);
}
