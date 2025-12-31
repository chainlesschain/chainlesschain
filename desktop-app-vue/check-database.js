/**
 * 检查数据库内容和状态
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');

console.log('=== 数据库诊断工具 ===\n');
console.log('数据库路径:', dbPath);
console.log('文件是否存在:', fs.existsSync(dbPath));

if (!fs.existsSync(dbPath)) {
  console.log('\n❌ 数据库文件不存在！');
  process.exit(1);
}

const stats = fs.statSync(dbPath);
console.log('文件大小:', (stats.size / 1024).toFixed(2), 'KB');
console.log('最后修改时间:', stats.mtime);

try {
  // 尝试以未加密方式打开
  console.log('\n尝试以未加密方式打开数据库...');
  const db = new Database(dbPath, { readonly: true });

  // 检查表是否存在
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    ORDER BY name
  `).all();

  console.log('\n数据库表列表:');
  tables.forEach(table => {
    console.log(`  - ${table.name}`);
  });

  // 检查项目数据
  if (tables.some(t => t.name === 'projects')) {
    const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get();
    console.log(`\n项目数量: ${projectCount.count}`);

    if (projectCount.count > 0) {
      const projects = db.prepare('SELECT id, name, created_at FROM projects LIMIT 5').all();
      console.log('\n最近的项目:');
      projects.forEach(p => {
        console.log(`  - ${p.name} (${new Date(p.created_at).toLocaleDateString()})`);
      });
    }
  }

  // 检查笔记数据
  if (tables.some(t => t.name === 'notes')) {
    const noteCount = db.prepare('SELECT COUNT(*) as count FROM notes').get();
    console.log(`\n笔记数量: ${noteCount.count}`);

    if (noteCount.count > 0) {
      const notes = db.prepare('SELECT id, title, created_at FROM notes LIMIT 5').all();
      console.log('\n最近的笔记:');
      notes.forEach(n => {
        console.log(`  - ${n.title} (${new Date(n.created_at).toLocaleDateString()})`);
      });
    }
  }

  // 检查技能数据
  if (tables.some(t => t.name === 'skills')) {
    const skillCount = db.prepare('SELECT COUNT(*) as count FROM skills').get();
    console.log(`\n技能数量: ${skillCount.count}`);

    if (skillCount.count > 0) {
      const skills = db.prepare('SELECT id, name, level FROM skills LIMIT 5').all();
      console.log('\n已记录的技能:');
      skills.forEach(s => {
        console.log(`  - ${s.name} (等级: ${s.level})`);
      });
    }
  }

  db.close();
  console.log('\n✅ 数据库检查完成（未加密）');

} catch (error) {
  console.error('\n❌ 以未加密方式打开失败:', error.message);
  console.log('\n数据库可能是加密的，或者文件已损坏。');
  console.log('提示: 该数据库使用了 SQLCipher 加密，需要密码才能访问。');
}
