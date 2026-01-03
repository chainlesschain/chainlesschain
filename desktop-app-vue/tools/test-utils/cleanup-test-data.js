/**
 * Cleanup Test Data
 * Remove test records inserted during verification
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

async function cleanup() {
  try {
    const dbPath = path.join(__dirname, '../data/chainlesschain.db');
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    console.log('[Cleanup] Removing test data...\n');

    // Delete test records
    db.run(`DELETE FROM slot_filling_history WHERE user_id='test_user'`);
    db.run(`DELETE FROM performance_metrics WHERE metadata LIKE '%"test":true%'`);

    console.log('  ✅ Removed test records from slot_filling_history');
    console.log('  ✅ Removed test records from performance_metrics');

    // Save changes
    const data = db.export();
    fs.writeFileSync(dbPath, data);
    db.close();

    console.log('\n[Cleanup] ✅ Test data cleaned up successfully!');

  } catch (error) {
    console.error('[Cleanup] ❌ Failed:', error);
    process.exit(1);
  }
}

cleanup();
