#!/usr/bin/env node

/**
 * Database SQL Diagnosis Script
 * Finds the exact SQL statement causing "no such column: owner_did" error
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

async function diagnose() {
  console.log('='.repeat(60));
  console.log('Database SQL Diagnosis Tool');
  console.log('='.repeat(60));
  console.log('');

  // Initialize sql.js
  const SQL = await initSqlJs({
    locateFile: (file) => {
      const resolved = require.resolve(`sql.js/dist/${file}`);
      if (fs.existsSync(resolved)) {
        console.log(`✓ Found ${file}:`, resolved);
        return resolved;
      }
      throw new Error(`Could not find ${file}`);
    }
  });

  console.log('✓ sql.js initialized\n');

  // Create in-memory database
  const db = new SQL.Database();
  console.log('✓ In-memory database created\n');

  // Read the database.js file
  const dbFilePath = path.join(__dirname, 'src', 'main', 'database.js');
  const dbFileContent = fs.readFileSync(dbFilePath, 'utf8');

  // Extract the SQL from createTables() method
  const sqlMatch = dbFileContent.match(/this\.db\.exec\(`\s*([\s\S]*?)\s*`\);/);
  if (!sqlMatch) {
    console.error('✗ Could not extract SQL from database.js');
    process.exit(1);
  }

  const fullSQL = sqlMatch[1];
  console.log(`✓ Extracted ${fullSQL.length} characters of SQL\n`);

  // Split SQL into individual statements
  const statements = fullSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`✓ Found ${statements.length} SQL statements\n`);
  console.log('='.repeat(60));
  console.log('Testing each statement...');
  console.log('='.repeat(60));
  console.log('');

  let failedStatement = null;
  let failedIndex = -1;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i] + ';';
    const preview = stmt.substring(0, 80).replace(/\s+/g, ' ');

    try {
      db.exec(stmt);
      console.log(`✓ [${i + 1}/${statements.length}] ${preview}`);
    } catch (error) {
      console.log(`✗ [${i + 1}/${statements.length}] FAILED: ${preview}`);
      console.log('');
      console.error('Error:', error.message);
      console.log('');
      console.log('Full statement:');
      console.log(stmt);
      console.log('');
      failedStatement = stmt;
      failedIndex = i;
      break;
    }
  }

  console.log('');
  console.log('='.repeat(60));

  if (failedStatement) {
    console.log('DIAGNOSIS RESULT:');
    console.log(`Failed at statement ${failedIndex + 1} of ${statements.length}`);
    console.log('');
    console.log('Failed SQL:');
    console.log(failedStatement);
    console.log('');

    // Try to identify the table being created
    const tableMatch = failedStatement.match(/CREATE TABLE[^(]*\(([^)]+)\)/i);
    if (tableMatch) {
      console.log('Columns being created:');
      tableMatch[1].split(',').forEach(col => {
        console.log('  -', col.trim().substring(0, 60));
      });
    }
  } else {
    console.log('✅ SUCCESS: All SQL statements executed without errors!');
    console.log('');
    console.log('This suggests the issue may be:');
    console.log('1. An existing corrupted database file');
    console.log('2. A migration script issue (runs after createTables)');
    console.log('3. A race condition or timing issue');
  }

  console.log('='.repeat(60));

  db.close();
}

diagnose().catch(error => {
  console.error('Diagnosis failed:', error);
  process.exit(1);
});
