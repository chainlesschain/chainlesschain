// 更新数据库，添加视频分类
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../data/chainlesschain.db');

console.log('🎬 添加视频分类到数据库...\n');

if (!fs.existsSync(dbPath)) {
  console.log('❌ 数据库文件不存在:', dbPath);
  console.log('💡 首次启动应用时会自动创建，包含视频分类');
  process.exit(0);
}

const db = new Database(dbPath);

try {
  // 检查是否已经有视频分类
  const existingVideo = db.prepare(
    "SELECT * FROM project_categories WHERE name = '视频' AND deleted = 0"
  ).get();

  if (existingVideo) {
    console.log('✅ 视频分类已存在，无需添加');
    process.exit(0);
  }

  console.log('📝 添加视频分类和子分类...\n');

  const now = Date.now();
  const userId = 'local-user';

  // 创建视频一级分类
  const videoId = uuidv4();
  const insertCategory = db.prepare(`
    INSERT INTO project_categories (
      id, user_id, name, parent_id, icon, color, sort_order, created_at, updated_at, deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  insertCategory.run(videoId, userId, '视频', null, '🎬', '#ff4d4f', 10, now, now);
  console.log('✅ 添加一级分类: 🎬 视频');

  // 添加视频子分类
  const subcategories = [
    { name: '短视频', icon: '📱', sort_order: 1 },
    { name: '长视频', icon: '📺', sort_order: 2 },
    { name: '直播', icon: '📡', sort_order: 3 },
    { name: 'Vlog', icon: '📹', sort_order: 4 },
    { name: '动画', icon: '🎨', sort_order: 5 },
    { name: '测评', icon: '🎮', sort_order: 6 },
  ];

  subcategories.forEach(subcat => {
    const subId = uuidv4();
    insertCategory.run(subId, userId, subcat.name, videoId, subcat.icon, '#ff4d4f', subcat.sort_order, now, now);
    console.log(`  ✅ 添加子分类: ${subcat.icon} ${subcat.name}`);
  });

  console.log('\n🎉 视频分类添加成功！');
  console.log('\n📊 当前所有分类:');

  const allCategories = db.prepare(`
    SELECT name, icon, parent_id FROM project_categories
    WHERE deleted = 0 AND parent_id IS NULL
    ORDER BY sort_order
  `).all();

  allCategories.forEach(cat => {
    console.log(`  ${cat.icon} ${cat.name}`);
  });

  console.log('\n✅ 完成！现在可以启动应用查看视频分类了。');

} catch (error) {
  console.error('❌ 错误:', error.message);
  process.exit(1);
} finally {
  db.close();
}
