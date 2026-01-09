/**
 * 检查数据库中的所有表
 */

const path = require('path');
const Database = require('better-sqlite3');

console.log('\n========================================');
console.log('检查数据库表结构');
console.log('========================================\n');

const dbPath = path.join(__dirname, 'data/chainlesschain.db');
console.log('数据库路径:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });

  // 查询所有表
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    ORDER BY name
  `).all();

  console.log(`\n📊 数据库中共有 ${tables.length} 个表:\n`);

  tables.forEach((table, index) => {
    console.log(`  ${index + 1}. ${table.name}`);
  });

  db.close();

  console.log('\n========================================');
  console.log('检查完成');
  console.log('========================================\n');

} catch (error) {
  console.error('检查失败:', error.message);
  process.exit(1);
}
