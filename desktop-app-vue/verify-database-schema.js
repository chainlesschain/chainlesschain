#!/usr/bin/env node

/**
 * Verify Database Schema
 * Checks if the actual database file has all required columns
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

async function verifyDatabaseSchema() {
  console.log('='.repeat(60));
  console.log('Database Schema Verification');
  console.log('='.repeat(60));
  console.log('');

  // Find database file
  const dbPath = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'chainlesschain-desktop-vue', 'data', 'chainlesschain.db')
    : path.join(process.env.HOME, '.chainlesschain-desktop-vue', 'data', 'chainlesschain.db');

  console.log('Database path:', dbPath);

  if (!fs.existsSync(dbPath)) {
    console.log('❌ Database file does not exist');
    console.log('');
    console.log('This is OK for a fresh install.');
    console.log('The database will be created on first app startup.');
    return;
  }

  console.log('✓ Database file exists');
  const stats = fs.statSync(dbPath);
  console.log(`  Size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log('');

  // Load database
  const SQL = await initSqlJs({
    locateFile: (file) => {
      const resolved = require.resolve(`sql.js/dist/${file}`);
      return resolved;
    }
  });

  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);

  console.log('✓ Database loaded successfully');
  console.log('');

  // Check project_files table
  console.log('Checking project_files table schema...');
  console.log('-'.repeat(60));

  const stmt = db.prepare('PRAGMA table_info(project_files)');
  const columns = [];
  while (stmt.step()) {
    columns.push(stmt.getAsObject());
  }
  stmt.free();

  console.log(`Found ${columns.length} columns:`);
  columns.forEach(col => {
    console.log(`  - ${col.name} (${col.type}) ${col.pk ? '[PRIMARY KEY]' : ''}`);
  });
  console.log('');

  // Check for is_folder
  const hasIsFolder = columns.some(col => col.name === 'is_folder');
  if (hasIsFolder) {
    console.log('✅ is_folder column EXISTS');
  } else {
    console.log('❌ is_folder column MISSING');
    console.log('');
    console.log('REQUIRED ACTION:');
    console.log('  The database needs migration. Run:');
    console.log('  1. Stop the app');
    console.log('  2. Delete the database file (or backup first):');
    console.log(`     del "${dbPath}"`);
    console.log('  3. Restart the app to recreate the database with correct schema');
  }
  console.log('');

  // Check organization tables
  console.log('Checking organization tables for owner_did...');
  console.log('-'.repeat(60));

  const tables = ['organization_info', 'organization_projects', 'task_boards'];
  let allOk = true;

  for (const table of tables) {
    try {
      const checkStmt = db.prepare(`PRAGMA table_info(${table})`);
      const tableCols = [];
      while (checkStmt.step()) {
        tableCols.push(checkStmt.getAsObject());
      }
      checkStmt.free();

      const hasOwnerDid = tableCols.some(col => col.name === 'owner_did');
      if (hasOwnerDid) {
        console.log(`  ✓ ${table}.owner_did exists`);
      } else {
        console.log(`  ❌ ${table}.owner_did MISSING`);
        allOk = false;
      }
    } catch (error) {
      console.log(`  ⚠️  ${table} table does not exist (${error.message})`);
    }
  }
  console.log('');

  // Summary
  console.log('='.repeat(60));
  if (hasIsFolder && allOk) {
    console.log('✅ Database schema is CORRECT');
    console.log('   All required columns are present.');
  } else {
    console.log('❌ Database schema has ISSUES');
    console.log('   Migration needed or database recreation required.');
  }
  console.log('='.repeat(60));

  db.close();
}

verifyDatabaseSchema().catch(error => {
  console.error('Verification failed:', error);
  process.exit(1);
});
