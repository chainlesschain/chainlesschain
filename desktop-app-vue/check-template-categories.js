const Database = require('better-sqlite3');
const db = new Database('../data/chainlesschain.db');

console.log('=== 所有分类统计 ===');
const categories = db.prepare(`
  SELECT category, COUNT(*) as count
  FROM prompt_templates
  GROUP BY category
  ORDER BY category
`).all();

categories.forEach(cat => {
  console.log(`${cat.category}: ${cat.count}个模板`);
});

console.log('\n=== 日常(lifestyle)分类详细列表 ===');
const lifestyle = db.prepare('SELECT id, name, category FROM prompt_templates WHERE category = ?').all('lifestyle');
lifestyle.forEach(t => {
  console.log(`- ${t.name}`);
});

console.log('\n=== 视频(video)分类详细列表 ===');
const video = db.prepare('SELECT id, name, category FROM prompt_templates WHERE category = ?').all('video');
if (video.length > 0) {
  video.forEach(t => {
    console.log(`- ${t.name}`);
  });
} else {
  console.log('未找到视频分类的模板');
}

db.close();
