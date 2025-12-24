/**
 * 检查数据库表结构
 */

const path = require('path');
const fs = require('fs');

(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  const appDataPath = process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming');
  const dbPath = path.join(appDataPath, 'chainlesschain-desktop-vue', 'data', 'chainlesschain.db');

  if (!fs.existsSync(dbPath)) {
    console.error('数据库文件不存在:', dbPath);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);

  console.log('📊 数据库表列表:\n');

  // 获取所有表
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");

  if (tables.length === 0 || !tables[0].values) {
    console.log('没有找到表');
    process.exit(0);
  }

  const tableNames = tables[0].values.map(row => row[0]);

  // 检查每个表的结构
  for (const tableName of tableNames) {
    console.log(`\n📋 ${tableName}:`);

    const columns = db.exec(`PRAGMA table_info(${tableName})`);
    if (columns.length > 0 && columns[0].values) {
      const columnNames = columns[0].values.map(col => col[1]);
      const hasSyncStatus = columnNames.includes('sync_status');
      const hasSyncedAt = columnNames.includes('synced_at');
      const hasDeleted = columnNames.includes('deleted');

      console.log(`  列: ${columnNames.join(', ')}`);
      console.log(`  同步字段: sync_status=${hasSyncStatus ? '✓' : '✗'}, synced_at=${hasSyncedAt ? '✓' : '✗'}, deleted=${hasDeleted ? '✓' : '✗'}`);
    }
  }

  db.close();
  console.log('\n');
})().catch(console.error);
