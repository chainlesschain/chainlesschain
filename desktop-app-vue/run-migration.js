/**
 * Database Migration Runner
 * Executes SQL migration files against the SQLite database
 */

const fs = require('fs');
const path = require('path');

// Use sql.js directly to avoid better-sqlite3 version issues
const initSqlJs = require('sql.js');
console.log('[Migration] Using sql.js');

async function runMigration() {
  try {
    const dbPath = path.join(__dirname, '../data/chainlesschain.db');
    const migrationPath = path.join(__dirname, 'src/main/migrations/002_add_optimization_tables.sql');

    console.log(`[Migration] Database: ${dbPath}`);
    console.log(`[Migration] Migration file: ${migrationPath}`);

    // Read migration SQL
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.log(`[Migration] Read ${migrationSQL.length} characters from migration file`);

    // Use sql.js
    const SQL = await initSqlJs();

    // Read existing database
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    console.log('[Migration] Executing migration...');
    db.run(migrationSQL);

    // Verify tables were created
    const tables = db.exec(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN (
        'slot_filling_history',
        'tool_execution_logs',
        'performance_metrics',
        'intent_recognition_history',
        'task_execution_history',
        'user_preferences',
        'optimization_suggestions'
      )
      ORDER BY name
    `);

    console.log(`\n[Migration] ✅ Migration completed successfully!`);
    if (tables[0]?.values.length > 0) {
      console.log(`[Migration] Created ${tables[0].values.length} tables:`);
      tables[0].values.forEach(row => console.log(`  - ${row[0]}`));
    }

    // Verify views
    const views = db.exec(`
      SELECT name FROM sqlite_master
      WHERE type='view' AND name LIKE 'v_%'
      ORDER BY name
    `);

    if (views[0]?.values.length > 0) {
      console.log(`\n[Migration] Created ${views[0].values.length} views:`);
      views[0].values.forEach(row => console.log(`  - ${row[0]}`));
    }

    // Check version
    const versionResult = db.exec(`
      SELECT version, description, applied_at
      FROM db_version
      WHERE version = '0.16.1'
    `);

    if (versionResult[0]?.values.length > 0) {
      const [version, description, appliedAt] = versionResult[0].values[0];
      console.log(`\n[Migration] Database version: ${version}`);
      console.log(`[Migration] Description: ${description}`);
      console.log(`[Migration] Applied at: ${new Date(appliedAt).toISOString()}`);
    }

    // Write back to file
    const data = db.export();
    fs.writeFileSync(dbPath, data);

    db.close();

    console.log(`\n[Migration] 🎉 All done! Database is ready.`);

  } catch (error) {
    console.error('\n[Migration] ❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
runMigration();
