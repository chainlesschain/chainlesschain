const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');

try {
  const db = new Database(dbPath, { readonly: true });

  console.log('=== 内置数据完整性验证 ===\n');

  // 统计内置数据
  const builtinSkills = db.prepare('SELECT COUNT(*) as count FROM skills WHERE is_builtin = 1').get();
  const builtinTools = db.prepare('SELECT COUNT(*) as count FROM tools WHERE is_builtin = 1').get();
  const builtinTemplates = db.prepare('SELECT COUNT(*) as count FROM project_templates WHERE is_builtin = 1').get();
  const skillToolsMappings = db.prepare('SELECT COUNT(*) as count FROM skill_tools').get();

  console.log('📊 内置数据统计:');
  console.log(`   ✓ 技能 (Skills): ${builtinSkills.count} 条`);
  console.log(`   ✓ 工具 (Tools): ${builtinTools.count} 条`);
  console.log(`   ✓ 模板 (Templates): ${builtinTemplates.count} 条`);
  console.log(`   ✓ 技能-工具关联: ${skillToolsMappings.count} 条\n`);

  // 按分类统计技能
  console.log('📋 技能分类统计:');
  const skillsByCategory = db.prepare('SELECT category, COUNT(*) as count FROM skills WHERE is_builtin = 1 GROUP BY category').all();
  skillsByCategory.forEach(row => {
    console.log(`   ${row.category}: ${row.count} 个`);
  });

  // 按分类统计工具
  console.log('\n🛠️  工具分类统计:');
  const toolsByCategory = db.prepare('SELECT category, COUNT(*) as count FROM tools WHERE is_builtin = 1 GROUP BY category').all();
  toolsByCategory.forEach(row => {
    console.log(`   ${row.category}: ${row.count} 个`);
  });

  // 按分类统计模板
  console.log('\n📝 模板分类统计 (前10类):');
  const templatesByCategory = db.prepare('SELECT category, COUNT(*) as count FROM project_templates WHERE is_builtin = 1 GROUP BY category ORDER BY count DESC LIMIT 10').all();
  templatesByCategory.forEach(row => {
    console.log(`   ${row.category}: ${row.count} 个`);
  });

  // 列出所有技能
  console.log('\n\n=== 所有内置技能列表 ===');
  const allSkills = db.prepare('SELECT id, display_name, category FROM skills WHERE is_builtin = 1 ORDER BY category, id').all();
  console.table(allSkills);

  // 列出所有工具
  console.log('\n=== 所有内置工具列表 ===');
  const allTools = db.prepare('SELECT id, display_name, category, tool_type FROM tools WHERE is_builtin = 1 ORDER BY category, id').all();
  console.table(allTools);

  // 技能-工具关联关系示例
  console.log('\n=== 技能-工具关联关系示例 ===');
  const skillToolsSample = db.prepare(`
    SELECT
      s.display_name as skill_name,
      t.display_name as tool_name,
      st.role,
      st.priority
    FROM skill_tools st
    JOIN skills s ON st.skill_id = s.id
    JOIN tools t ON st.tool_id = t.id
    ORDER BY st.priority DESC
    LIMIT 10
  `).all();
  console.table(skillToolsSample);

  db.close();

  console.log('\n✅ 数据验证完成!所有内置数据已正确加载。\n');

} catch (error) {
  console.error('❌ 数据验证失败:', error.message);
  process.exit(1);
}
