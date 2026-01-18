const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'chainlesschain.db');
console.log('数据库路径:', dbPath);

async function checkDatabase() {
  try {
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    console.log('\n=== 检查表是否存在 ===');
    const tablesResult = db.exec(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('skills', 'tools', 'skill_tools', 'tool_usage_stats')
      ORDER BY name
    `);

    if (tablesResult.length === 0 || !tablesResult[0].values || tablesResult[0].values.length === 0) {
      console.log('❌ 未找到技能工具系统表！');
      db.close();
      return;
    }

    const tableNames = tablesResult[0].values.map(row => row[0]);
    console.log('找到的表:', tableNames);

    console.log('\n=== 技能表结构 ===');
    const skillSchema = db.exec("PRAGMA table_info(skills)");
    console.log(JSON.stringify(skillSchema[0], null, 2));

    console.log('\n=== 工具表结构 ===');
    const toolSchema = db.exec("PRAGMA table_info(tools)");
    console.log(JSON.stringify(toolSchema[0], null, 2));

    console.log('\n=== 技能数据统计 ===');
    const skillCountResult = db.exec("SELECT COUNT(*) as count FROM skills");
    const skillCount = skillCountResult[0].values[0][0];
    console.log('技能总数:', skillCount);

    const skillsResult = db.exec("SELECT id, name, display_name, category, enabled FROM skills");
    if (skillsResult.length > 0) {
      console.log('技能列表:');
      skillsResult[0].values.forEach(row => {
        console.log(`  - ${row[1]} (${row[2]}): category=${row[3]}, enabled=${row[4]}`);
      });
    }

    console.log('\n=== 工具数据统计 ===');
    const toolCountResult = db.exec("SELECT COUNT(*) as count FROM tools");
    const toolCount = toolCountResult[0].values[0][0];
    console.log('工具总数:', toolCount);

    const toolsResult = db.exec("SELECT id, name, display_name, category, tool_type, enabled, is_builtin FROM tools LIMIT 5");
    if (toolsResult.length > 0) {
      console.log('工具列表(前5个):');
      toolsResult[0].values.forEach(row => {
        console.log(`  - ${row[1]} (${row[2]}): category=${row[3]}, type=${row[4]}, enabled=${row[5]}, builtin=${row[6]}`);
      });
    }

    console.log('\n=== 技能-工具关联 ===');
    const associationsResult = db.exec(`
      SELECT st.skill_id, s.name as skill_name, st.tool_id, t.name as tool_name
      FROM skill_tools st
      JOIN skills s ON st.skill_id = s.id
      JOIN tools t ON st.tool_id = t.id
      LIMIT 10
    `);
    if (associationsResult.length > 0 && associationsResult[0].values.length > 0) {
      console.log('关联记录:');
      associationsResult[0].values.forEach(row => {
        console.log(`  - 技能 ${row[1]} -> 工具 ${row[3]}`);
      });
    } else {
      console.log('暂无关联记录');
    }

    console.log('\n=== 工具使用统计 ===');
    const usageStatsResult = db.exec("SELECT * FROM tool_usage_stats LIMIT 5");
    if (usageStatsResult.length > 0 && usageStatsResult[0].values.length > 0) {
      console.log('使用统计记录数:', usageStatsResult[0].values.length);
    } else {
      console.log('暂无使用统计');
    }

    db.close();
    console.log('\n✅ 数据库检查完成');
  } catch (error) {
    console.error('❌ 数据库检查失败:', error);
    process.exit(1);
  }
}

checkDatabase();
