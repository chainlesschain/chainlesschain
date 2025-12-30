// 创建包含视频分类的数据库
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../data/chainlesschain.db');

console.log('🎬 创建新数据库并添加所有分类...\n');

// 确保目录存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库
const db = new Database(dbPath);

try {
  // 创建 project_categories 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_categories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local-user',
      name TEXT NOT NULL,
      parent_id TEXT,
      icon TEXT,
      color TEXT,
      sort_order INTEGER DEFAULT 0,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER DEFAULT 0,
      FOREIGN KEY (parent_id) REFERENCES project_categories(id)
    )
  `);

  console.log('✅ 表结构创建成功\n');

  const now = Date.now();
  const userId = 'local-user';

  // 一级分类
  const categories = [
    { id: uuidv4(), name: '写作', parent_id: null, icon: '✍️', color: '#1890ff', sort_order: 1 },
    { id: uuidv4(), name: '营销', parent_id: null, icon: '📢', color: '#52c41a', sort_order: 2 },
    { id: uuidv4(), name: 'Excel', parent_id: null, icon: '📊', color: '#13c2c2', sort_order: 3 },
    { id: uuidv4(), name: '简历', parent_id: null, icon: '📄', color: '#fa8c16', sort_order: 4 },
    { id: uuidv4(), name: 'PPT', parent_id: null, icon: '📽️', color: '#eb2f96', sort_order: 5 },
    { id: uuidv4(), name: '研究', parent_id: null, icon: '🔬', color: '#722ed1', sort_order: 6 },
    { id: uuidv4(), name: '教育', parent_id: null, icon: '🎓', color: '#fa541c', sort_order: 7 },
    { id: uuidv4(), name: '生活', parent_id: null, icon: '🏠', color: '#fadb14', sort_order: 8 },
    { id: uuidv4(), name: '播客', parent_id: null, icon: '🎙️', color: '#2f54eb', sort_order: 9 },
    { id: uuidv4(), name: '视频', parent_id: null, icon: '🎬', color: '#ff4d4f', sort_order: 10 },
    { id: uuidv4(), name: '设计', parent_id: null, icon: '🎨', color: '#f5222d', sort_order: 11 },
    { id: uuidv4(), name: '网页', parent_id: null, icon: '🌐', color: '#52c41a', sort_order: 12 },
  ];

  // 保存一级分类的ID
  const categoryIds = {};
  categories.forEach(cat => {
    categoryIds[cat.name] = cat.id;
  });

  const insertCategory = db.prepare(`
    INSERT INTO project_categories (
      id, user_id, name, parent_id, icon, color, sort_order, created_at, updated_at, deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  // 插入一级分类
  console.log('📝 添加一级分类:');
  categories.forEach(cat => {
    insertCategory.run(cat.id, userId, cat.name, null, cat.icon, cat.color, cat.sort_order, now, now);
    console.log(`  ✅ ${cat.icon} ${cat.name}`);
  });

  console.log('\n📝 添加视频子分类:');

  // 视频子分类
  const videoSubcategories = [
    { name: '短视频', icon: '📱', sort_order: 1 },
    { name: '长视频', icon: '📺', sort_order: 2 },
    { name: '直播', icon: '📡', sort_order: 3 },
    { name: 'Vlog', icon: '📹', sort_order: 4 },
    { name: '动画', icon: '🎨', sort_order: 5 },
    { name: '测评', icon: '🎮', sort_order: 6 },
  ];

  const videoId = categoryIds['视频'];
  videoSubcategories.forEach(subcat => {
    const subId = uuidv4();
    insertCategory.run(subId, userId, subcat.name, videoId, subcat.icon, '#ff4d4f', subcat.sort_order, now, now);
    console.log(`  ✅ ${subcat.icon} ${subcat.name}`);
  });

  // 其他子分类
  const otherSubcategories = [
    { name: '办公文档', parent_name: '写作', icon: '📝', color: '#1890ff', sort_order: 1 },
    { name: '商业', parent_name: '营销', icon: '💼', color: '#52c41a', sort_order: 1 },
    { name: '技术', parent_name: '网页', icon: '⚙️', color: '#722ed1', sort_order: 1 },
    { name: '活动', parent_name: '营销', icon: '🎉', color: '#fa8c16', sort_order: 2 },
    { name: '财务', parent_name: 'Excel', icon: '💰', color: '#13c2c2', sort_order: 1 },
    { name: '分析', parent_name: 'Excel', icon: '📈', color: '#13c2c2', sort_order: 2 },
    { name: '求职', parent_name: '简历', icon: '🔍', color: '#fa541c', sort_order: 1 },
  ];

  console.log('\n📝 添加其他子分类:');
  otherSubcategories.forEach(subcat => {
    const parentId = categoryIds[subcat.parent_name];
    if (parentId) {
      const subId = uuidv4();
      insertCategory.run(subId, userId, subcat.name, parentId, subcat.icon, subcat.color, subcat.sort_order, now, now);
      console.log(`  ✅ ${subcat.icon} ${subcat.name} (${subcat.parent_name})`);
    }
  });

  console.log('\n🎉 数据库创建成功！');
  console.log('\n📊 所有一级分类:');

  const allCategories = db.prepare(`
    SELECT name, icon FROM project_categories
    WHERE deleted = 0 AND parent_id IS NULL
    ORDER BY sort_order
  `).all();

  allCategories.forEach(cat => {
    console.log(`  ${cat.icon} ${cat.name}`);
  });

  console.log('\n✅ 数据库位置:', dbPath);

} catch (error) {
  console.error('❌ 错误:', error.message);
  process.exit(1);
} finally {
  db.close();
}
