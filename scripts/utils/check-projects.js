const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join('C:', 'code', 'chainlesschain', 'data', 'chainlesschain.db');
console.log('数据库路径:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });

  // 查询所有项目
  const allProjects = db.prepare(`
    SELECT id, name, deleted, sync_status, created_at, updated_at
    FROM projects
    ORDER BY created_at DESC
    LIMIT 20
  `).all();

  console.log('\n=== 所有项目（包括已删除） ===');
  console.log('总数:', allProjects.length);
  allProjects.forEach(p => {
    console.log(`ID: ${p.id}`);
    console.log(`  名称: ${p.name}`);
    console.log(`  删除状态: ${p.deleted === 1 ? '已删除' : '正常'}`);
    console.log(`  同步状态: ${p.sync_status}`);
    console.log(`  创建时间: ${new Date(p.created_at).toLocaleString('zh-CN')}`);
    console.log(`  更新时间: ${new Date(p.updated_at).toLocaleString('zh-CN')}`);
    console.log('---');
  });

  // 统计
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN deleted = 0 THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) as deleted
    FROM projects
  `).get();

  console.log('\n=== 统计信息 ===');
  console.log('总项目数:', stats.total);
  console.log('活跃项目:', stats.active);
  console.log('已删除项目:', stats.deleted);

  db.close();
} catch (error) {
  console.error('错误:', error.message);
}
