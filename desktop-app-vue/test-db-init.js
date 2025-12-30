const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, '../data/chainlesschain.db');

console.log('数据库路径:', dbPath);
console.log('数据库是否存在:', fs.existsSync(dbPath));

// 删除旧数据库
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('已删除旧数据库');
}

// 创建新数据库
const db = new Database(dbPath);
console.log('数据库创建成功');

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS project_categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    icon TEXT,
    color TEXT,
    sort_order INTEGER DEFAULT 0,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER DEFAULT 0,
    FOREIGN KEY (parent_id) REFERENCES project_categories(id) ON DELETE CASCADE
  );
`);

console.log('表创建成功');

// 插入测试数据
const now = Date.now();
const userId = 'local-user';

const categories = [
  { id: uuidv4(), name: '视频', icon: '🎬', color: '#ff4d4f', sort_order: 1 },
  { id: uuidv4(), name: '学习', icon: '📚', color: '#40a9ff', sort_order: 2 },
  { id: uuidv4(), name: '健康', icon: '💪', color: '#73d13d', sort_order: 3 },
];

const stmt = db.prepare(`
  INSERT INTO project_categories (
    id, user_id, name, parent_id, icon, color, sort_order, description, created_at, updated_at, deleted
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

categories.forEach(cat => {
  stmt.run(cat.id, userId, cat.name, null, cat.icon, cat.color, cat.sort_order, null, now, now, 0);
  console.log(`插入分类: ${cat.name}`);
});

// 查询验证
const result = db.prepare('SELECT * FROM project_categories').all();
console.log(`\n共插入 ${result.length} 条记录:`);
result.forEach(r => {
  console.log(`- ${r.name} (${r.icon})`);
});

// 关闭数据库
db.close();

// 检查文件大小
const stats = fs.statSync(dbPath);
console.log(`\n数据库文件大小: ${stats.size} 字节`);
console.log('✅ 测试完成！');
