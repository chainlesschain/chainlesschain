const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');

try {
  const db = new Database(dbPath, { readonly: true });

  console.log('=== 检查所有可能包含内置数据的表 ===\n');

  // 获取所有表
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();

  console.log('📋 数据库中的所有表:');
  tables.forEach((table, index) => {
    const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get();
    console.log(`   ${index + 1}. ${table.name}: ${count.count} 条记录`);
  });

  console.log('\n=== 检查是否有is_builtin字段的表 ===\n');

  // 检查每个表是否有is_builtin字段
  for (const table of tables) {
    try {
      const hasBuiltin = db.prepare(`PRAGMA table_info(${table.name})`).all()
        .some(col => col.name === 'is_builtin');

      if (hasBuiltin) {
        const total = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get();
        const builtin = db.prepare(`SELECT COUNT(*) as count FROM ${table.name} WHERE is_builtin = 1`).get();
        console.log(`📊 ${table.name}:`);
        console.log(`   总数: ${total.count}, 内置: ${builtin.count}, 用户创建: ${total.count - builtin.count}`);

        // 如果有内置数据，显示部分示例
        if (builtin.count > 0) {
          const samples = db.prepare(`SELECT * FROM ${table.name} WHERE is_builtin = 1 LIMIT 3`).all();
          console.log(`   示例数据 (前3条):`);
          samples.forEach(sample => {
            console.log(`     - ${sample.name || sample.id}: ${sample.display_name || sample.description || ''}`);
          });
        }
        console.log('');
      }
    } catch (e) {
      // 跳过没有权限或其他错误的表
    }
  }

  // 特别检查plugins表
  console.log('=== 检查插件系统表 ===\n');
  try {
    const pluginCount = db.prepare('SELECT COUNT(*) as count FROM plugins').get();
    console.log(`插件表记录数: ${pluginCount.count}`);

    if (pluginCount.count > 0) {
      const plugins = db.prepare('SELECT id, name, enabled, is_builtin FROM plugins').all();
      console.table(plugins);
    } else {
      console.log('⚠️  插件表为空\n');
    }
  } catch (e) {
    console.log('插件表不存在或无法访问\n');
  }

  // 检查模板相关的表
  console.log('=== 检查模板相关表详细信息 ===\n');

  const templateCount = db.prepare('SELECT COUNT(*) as count FROM project_templates WHERE is_builtin = 1').get();
  console.log(`内置模板数量: ${templateCount.count}`);

  // 按分类统计模板
  const templatesByCategory = db.prepare(`
    SELECT category, COUNT(*) as count
    FROM project_templates
    WHERE is_builtin = 1
    GROUP BY category
    ORDER BY count DESC
  `).all();

  console.log('\n模板分类分布:');
  console.table(templatesByCategory);

  // 检查技能和工具的详细信息
  console.log('\n=== 技能详细信息 ===\n');
  const skills = db.prepare('SELECT id, name, display_name, category, enabled FROM skills WHERE is_builtin = 1').all();
  console.table(skills);

  console.log('\n=== 工具详细信息 ===\n');
  const tools = db.prepare('SELECT id, name, display_name, category, tool_type, enabled FROM tools WHERE is_builtin = 1').all();
  console.table(tools);

  // 检查关联关系
  console.log('\n=== 技能-工具关联关系统计 ===\n');
  const relationStats = db.prepare(`
    SELECT
      s.display_name as skill_name,
      COUNT(st.tool_id) as tool_count
    FROM skills s
    LEFT JOIN skill_tools st ON s.id = st.skill_id
    WHERE s.is_builtin = 1
    GROUP BY s.id
    ORDER BY tool_count DESC
  `).all();
  console.table(relationStats);

  db.close();

} catch (error) {
  console.error('❌ 检查失败:', error.message);
  console.error(error.stack);
  process.exit(1);
}
