/**
 * Verify Database Migration
 * Check that all tables, indexes, and views were created correctly
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

async function verifyMigration() {
  try {
    const dbPath = path.join(__dirname, '../data/chainlesschain.db');

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║         Database Migration Verification                 ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    // Check all tables
    console.log('📋 Checking Tables...\n');
    const expectedTables = [
      'slot_filling_history',
      'tool_execution_logs',
      'performance_metrics',
      'intent_recognition_history',
      'task_execution_history',
      'user_preferences',
      'optimization_suggestions',
      'db_version'
    ];

    for (const tableName of expectedTables) {
      const result = db.exec(`
        SELECT sql FROM sqlite_master
        WHERE type='table' AND name='${tableName}'
      `);

      if (result[0]?.values.length > 0) {
        console.log(`  ✅ ${tableName}`);
      } else {
        console.log(`  ❌ ${tableName} - NOT FOUND`);
      }
    }

    // Check indexes
    console.log('\n📊 Checking Indexes...\n');
    const indexes = db.exec(`
      SELECT name, tbl_name FROM sqlite_master
      WHERE type='index' AND name LIKE 'idx_%'
      ORDER BY tbl_name, name
    `);

    if (indexes[0]?.values.length > 0) {
      console.log(`  Found ${indexes[0].values.length} indexes:`);
      const groupedIndexes = {};
      indexes[0].values.forEach(([name, tbl]) => {
        if (!groupedIndexes[tbl]) groupedIndexes[tbl] = [];
        groupedIndexes[tbl].push(name);
      });

      Object.entries(groupedIndexes).forEach(([table, idxList]) => {
        console.log(`\n  ${table}:`);
        idxList.forEach(idx => console.log(`    - ${idx}`));
      });
    }

    // Check views
    console.log('\n\n🔍 Checking Views...\n');
    const views = db.exec(`
      SELECT name FROM sqlite_master
      WHERE type='view' AND name LIKE 'v_%'
      ORDER BY name
    `);

    if (views[0]?.values.length > 0) {
      views[0].values.forEach(([name]) => {
        console.log(`  ✅ ${name}`);

        // Test each view
        try {
          const testResult = db.exec(`SELECT * FROM ${name} LIMIT 1`);
          console.log(`     (View is queryable)`);
        } catch (e) {
          console.log(`     ⚠️ Error querying view: ${e.message}`);
        }
      });
    }

    // Check database version
    console.log('\n\n📌 Database Version Info...\n');
    const versionInfo = db.exec(`
      SELECT version, description, applied_at
      FROM db_version
      ORDER BY applied_at DESC
      LIMIT 5
    `);

    if (versionInfo[0]?.values.length > 0) {
      versionInfo[0].values.forEach(([version, description, appliedAt]) => {
        console.log(`  Version: ${version}`);
        console.log(`  Description: ${description}`);
        console.log(`  Applied: ${new Date(appliedAt).toISOString()}\n`);
      });
    }

    // Test inserting and querying data
    console.log('🧪 Testing Data Operations...\n');

    // Test 1: Insert into slot_filling_history
    try {
      db.run(`
        INSERT INTO slot_filling_history (user_id, intent_type, entities, completeness, created_at)
        VALUES ('test_user', 'create_file', '{"fileType":"HTML"}', 100.0, ${Date.now()})
      `);

      const count = db.exec(`SELECT COUNT(*) as cnt FROM slot_filling_history WHERE user_id='test_user'`);
      console.log(`  ✅ slot_filling_history: INSERT and SELECT work (${count[0].values[0][0]} records)`);
    } catch (e) {
      console.log(`  ❌ slot_filling_history: ${e.message}`);
    }

    // Test 2: Insert into performance_metrics
    try {
      db.run(`
        INSERT INTO performance_metrics (phase, duration, metadata, created_at)
        VALUES ('intent_recognition', 150.5, '{"test":true}', ${Date.now()})
      `);

      const count = db.exec(`SELECT COUNT(*) as cnt FROM performance_metrics WHERE phase='intent_recognition'`);
      console.log(`  ✅ performance_metrics: INSERT and SELECT work (${count[0].values[0][0]} records)`);
    } catch (e) {
      console.log(`  ❌ performance_metrics: ${e.message}`);
    }

    // Test 3: Query view
    try {
      const result = db.exec(`SELECT * FROM v_tool_success_rate LIMIT 1`);
      console.log(`  ✅ v_tool_success_rate: View query works`);
    } catch (e) {
      console.log(`  ⚠️ v_tool_success_rate: ${e.message} (expected if no data yet)`);
    }

    db.close();

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ Migration Verification Complete!                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ Verification failed:', error);
    process.exit(1);
  }
}

verifyMigration();
