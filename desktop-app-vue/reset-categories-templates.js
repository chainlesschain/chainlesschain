/**
 * 重置项目分类和模板数据
 * 用于在更新分类配置后，清理旧数据并重新初始化
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data/chainlesschain.db');

console.log('='.repeat(60));
console.log('重置项目分类和模板数据');
console.log('='.repeat(60));
console.log();

if (!fs.existsSync(dbPath)) {
  console.log('❌ 数据库文件不存在:', dbPath);
  console.log('   请先运行应用创建数据库');
  process.exit(1);
}

console.log('📁 数据库路径:', dbPath);
console.log();

const db = new Database(dbPath);

try {
  console.log('1️⃣  清理旧的项目分类数据...');
  const deleteCategories = db.prepare('DELETE FROM project_categories WHERE user_id = ?');
  const deletedCategories = deleteCategories.run('local-user');
  console.log(`   ✓ 删除了 ${deletedCategories.changes} 个旧分类`);
  console.log();

  console.log('2️⃣  清理旧的模板数据...');
  const deleteTemplates = db.prepare('DELETE FROM project_templates');
  const deletedTemplates = deleteTemplates.run();
  console.log(`   ✓ 删除了 ${deletedTemplates.changes} 个旧模板`);
  console.log();

  console.log('3️⃣  清理模板使用历史...');
  const deleteHistory = db.prepare('DELETE FROM template_usage_history');
  const deletedHistory = deleteHistory.run();
  console.log(`   ✓ 删除了 ${deletedHistory.changes} 条历史记录`);
  console.log();

  console.log('4️⃣  清理模板评分数据...');
  const deleteRatings = db.prepare('DELETE FROM template_ratings');
  const deletedRatings = deleteRatings.run();
  console.log(`   ✓ 删除了 ${deletedRatings.changes} 条评分记录`);
  console.log();

  db.close();

  console.log('='.repeat(60));
  console.log('✅ 数据清理完成!');
  console.log('='.repeat(60));
  console.log();
  console.log('下一步操作:');
  console.log('  1. 运行 npm run dev 启动应用');
  console.log('  2. 应用会自动重新初始化分类和模板');
  console.log('  3. 在界面中即可看到所有新增的分类和模板');
  console.log();
} catch (error) {
  console.error('❌ 清理失败:', error);
  db.close();
  process.exit(1);
}
