const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'chainlesschain.db');

async function checkAllTables() {
  try {
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    console.log('=== 检查所有表 ===');
    const allTablesResult = db.exec(`
      SELECT name FROM sqlite_master
      WHERE type='table'
      ORDER BY name
    `);

    if (allTablesResult.length > 0) {
      const tableNames = allTablesResult[0].values.map(row => row[0]);
      console.log('数据库中的所有表 (' + tableNames.length + '个):');
      tableNames.forEach(name => console.log('  - ' + name));

      console.log('\n=== 检查技能工具系统相关表 ===');
      const expectedTables = [
        'skills',
        'tools',
        'skill_tools',
        'skill_stats',
        'tool_stats',
        'skill_tool_usage_logs'
      ];

      expectedTables.forEach(tableName => {
        const exists = tableNames.includes(tableName);
        console.log(`  ${exists ? '✅' : '❌'} ${tableName}`);
      });
    }

    db.close();
  } catch (error) {
    console.error('检查失败:', error);
  }
}

checkAllTables();
