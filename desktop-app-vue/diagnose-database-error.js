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
  // Find the createTables function and extract its exec() call
  const createTablesMatch = dbFileContent.match(/createTables\(\)\s*\{[\s\S]*?this\.db\.exec\(`([\s\S]*?)`\);/);
  if (!createTablesMatch) {
    console.error('✗ Could not extract SQL from createTables() in database.js');
    console.error('Trying alternative extraction...');

    // Try to find just the first exec call after createTables
    const altMatch = dbFileContent.match(/createTables[\s\S]{0,500}?this\.db\.exec\(`([\s\S]*?)`\);/);
    if (!altMatch) {
      console.error('✗ Could not extract SQL - both methods failed');
      process.exit(1);
    }
    var fullSQL = altMatch[1];
  } else {
    var fullSQL = createTablesMatch[1];
  }
  console.log(`✓ Extracted ${fullSQL.length} characters of SQL\n`);

  // Show first 500 characters
  console.log('First 500 characters of extracted SQL:');
  console.log('-'.repeat(60));
  console.log(fullSQL.substring(0, 500).trim());
  console.log('-'.repeat(60));
  console.log('');

  // Split SQL into individual statements
  // Remove comment lines first, THEN split
  const cleanedSQL = fullSQL
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  const statements = cleanedSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 10); // Ignore very short fragments

  console.log(`✓ Found ${statements.length} SQL statements\n`);

  // Show first 3 statements
  console.log('First 3 statements after splitting:');
  console.log('='.repeat(60));
  for (let i = 0; i < Math.min(3, statements.length); i++) {
    const preview = statements[i].substring(0, 100).replace(/\s+/g, ' ');
    console.log(`[${i + 1}] ${preview}`);
  }
  console.log('='.repeat(60));
  console.log('');

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
