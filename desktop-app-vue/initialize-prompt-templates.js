/**
 * 手动初始化prompt_templates表并插入职业专用模板
 */

const path = require('path');
const Database = require('better-sqlite3');

console.log('\n========================================');
console.log('初始化Prompt模板表');
console.log('========================================\n');

// 使用应用实际的数据库路径
const dbPath = path.join(
  require('os').homedir(),
  'Library/Application Support/chainlesschain-desktop-vue/data/chainlesschain.db'
);
console.log('数据库路径:', dbPath);

try {
  const db = new Database(dbPath);

  console.log('\n【1】创建prompt_templates表...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      template TEXT NOT NULL,
      variables TEXT,
      category TEXT DEFAULT 'general',
      is_system INTEGER DEFAULT 0,
      usage_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  console.log('✓ 表创建成功\n');

  // 加载职业专用模板
  console.log('【2】加载职业专用模板...');

  // 需要先引入PromptTemplateManager来获取内置模板
  const PromptTemplateManagerModule = require('./src/main/prompt/prompt-template-manager.js');

  // 创建一个临时的数据库管理器包装
  const dbWrapper = {
    run: (sql, params) => {
      const stmt = db.prepare(sql);
      return stmt.run(...(params || []));
    },
    get: (sql, params) => {
      const stmt = db.prepare(sql);
      return stmt.get(...(params || []));
    },
    all: (sql, params) => {
      const stmt = db.prepare(sql);
      return stmt.all(...(params || []));
    }
  };

  const manager = new PromptTemplateManagerModule(dbWrapper);

  // 直接调用insertBuiltInTemplates方法
  console.log('正在插入内置模板...');

  manager.insertBuiltInTemplates().then(() => {
    console.log('✓ 内置模板插入成功\n');

    // 验证插入结果
    console.log('【3】验证插入结果...\n');

    const totalCount = db.prepare('SELECT COUNT(*) as count FROM prompt_templates').get();
    console.log(`📊 模板总数: ${totalCount.count}个\n`);

    // 按分类统计
    console.log('📋 按分类统计:');
    const categoryCounts = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM prompt_templates
      GROUP BY category
      ORDER BY count DESC
    `).all();

    categoryCounts.forEach(row => {
      console.log(`  ${row.category}: ${row.count}个`);
    });

    // 职业专用模板统计
    console.log('\n🎯 职业专用模板详情:\n');
    const professionalCategories = ['medical', 'legal', 'education', 'research'];

    professionalCategories.forEach(category => {
      const templates = db.prepare(`
        SELECT id, name
        FROM prompt_templates
        WHERE category = ?
        ORDER BY id
      `).all(category);

      const emoji = category === 'medical' ? '🏥' :
                    category === 'legal' ? '⚖️' :
                    category === 'education' ? '👨‍🏫' : '🔬';

      console.log(`${emoji} ${category}: ${templates.length}个模板`);
      templates.forEach(t => {
        console.log(`  - ${t.name}`);
      });
      console.log('');
    });

    db.close();

    console.log('========================================');
    console.log('✓ 初始化完成！');
    console.log('现在可以重新启动应用，模板应该能正常显示了。');
    console.log('========================================\n');
  }).catch(error => {
    console.error('✗ 插入模板失败:', error);
    db.close();
    process.exit(1);
  });

} catch (error) {
  console.error('✗ 初始化失败:', error);
  process.exit(1);
}
