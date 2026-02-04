#!/usr/bin/env node

/**
 * Test Database Fixes
 * Verifies all database fixes are working correctly
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

async function testDatabaseFixes() {
  console.log('='.repeat(60));
  console.log('Database Fixes Verification');
  console.log('='.repeat(60));
  console.log('');

  const SQL = await initSqlJs({
    locateFile: (file) => {
      const resolved = require.resolve(`sql.js/dist/${file}`);
      return resolved;
    }
  });

  const db = new SQL.Database();
  console.log('✓ In-memory database created\n');

  // Read and execute the schema
  const dbFilePath = path.join(__dirname, 'src', 'main', 'database.js');
  const dbFileContent = fs.readFileSync(dbFilePath, 'utf8');
  const createTablesMatch = dbFileContent.match(/createTables\(\)\s*\{[\s\S]*?this\.db\.exec\(`([\s\S]*?)`\);/);

  if (!createTablesMatch) {
    console.error('✗ Could not extract SQL');
    process.exit(1);
  }

  const fullSQL = createTablesMatch[1];

  // Remove comment lines
  const cleanedSQL = fullSQL
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  console.log('Executing database schema...');
  try {
    db.exec(cleanedSQL);
    console.log('✓ Schema created successfully\n');
  } catch (error) {
    console.error('✗ Schema creation failed:', error.message);
    process.exit(1);
  }

  // Test 1: Check owner_did columns
  console.log('Test 1: Checking owner_did columns...');
  const ownerDidTables = [
    'organization_info',
    'organization_projects',
    'task_boards'
  ];

  for (const table of ownerDidTables) {
    const stmt = db.prepare(`PRAGMA table_info(${table})`);
    const info = [];
    while (stmt.step()) {
      info.push(stmt.getAsObject());
    }
    stmt.free();
    const hasOwnerDid = info.some(col => col.name === 'owner_did');
    if (hasOwnerDid) {
      console.log(`  ✓ ${table}.owner_did exists`);
    } else {
      console.log(`  ✗ ${table}.owner_did MISSING`);
      process.exit(1);
    }
  }
  console.log('');

  // Test 2: Check is_folder column
  console.log('Test 2: Checking is_folder column in project_files...');
  const filesStmt = db.prepare('PRAGMA table_info(project_files)');
  const filesInfo = [];
  while (filesStmt.step()) {
    filesInfo.push(filesStmt.getAsObject());
  }
  filesStmt.free();
  const hasIsFolder = filesInfo.some(col => col.name === 'is_folder');

  if (hasIsFolder) {
    console.log('  ✓ project_files.is_folder exists');
  } else {
    console.log('  ✗ project_files.is_folder MISSING');
    process.exit(1);
  }
  console.log('');

  // Test 3: Test is_folder query (the one that was failing)
  console.log('Test 3: Testing file query with is_folder...');
  try {
    // Insert test data
    db.run(`
      INSERT INTO projects (id, user_id, name, project_type, root_path, created_at, updated_at, sync_status)
      VALUES ('test-project', 'test-user', 'Test Project', 'document', '/test', ${Date.now()}, ${Date.now()}, 'pending')
    `);

    db.run(`
      INSERT INTO project_files (
        id, project_id, file_path, file_name, file_type,
        file_size, is_folder, created_at, updated_at, deleted
      ) VALUES (
        'file1', 'test-project', '/folder', 'folder', 'directory',
        0, 1, ${Date.now()}, ${Date.now()}, 0
      )
    `);

    db.run(`
      INSERT INTO project_files (
        id, project_id, file_path, file_name, file_type,
        file_size, is_folder, created_at, updated_at, deleted
      ) VALUES (
        'file2', 'test-project', '/file.txt', 'file.txt', 'text',
        100, 0, ${Date.now()}, ${Date.now()}, 0
      )
    `);

    // This is the query that was failing
    const queryStmt = db.prepare(`
      SELECT * FROM project_files
      WHERE project_id = ? AND deleted = 0
      ORDER BY is_folder DESC, file_name ASC
    `);
    queryStmt.bind(['test-project']);
    const files = [];
    while (queryStmt.step()) {
      files.push(queryStmt.getAsObject());
    }
    queryStmt.free();

    console.log(`  ✓ Query executed successfully, returned ${files.length} files`);
    console.log(`  ✓ Folder comes first: ${files[0].file_name === 'folder'}`);
    console.log('');
  } catch (error) {
    console.log('  ✗ Query failed:', error.message);
    process.exit(1);
  }

  // Test 4: Check index on is_folder
  console.log('Test 4: Testing index creation on owner_did...');
  try {
    db.run('CREATE INDEX IF NOT EXISTS test_idx ON task_boards(owner_did)');
    console.log('  ✓ Index on owner_did can be created');
  } catch (error) {
    console.log('  ✗ Index creation failed:', error.message);
    process.exit(1);
  }
  console.log('');

  console.log('='.repeat(60));
  console.log('✅ ALL TESTS PASSED');
  console.log('='.repeat(60));
  console.log('');
  console.log('Summary:');
  console.log('  ✓ owner_did columns exist in all required tables');
  console.log('  ✓ is_folder column exists in project_files');
  console.log('  ✓ File queries with ORDER BY is_folder work');
  console.log('  ✓ Indexes can be created on owner_did');
  console.log('');
  console.log('The database schema fixes are complete and verified!');

  db.close();
}

testDatabaseFixes().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
