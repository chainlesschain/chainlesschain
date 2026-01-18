/**
 * Test script to diagnose quick project creation issue
 */

const Database = require('./src/main/database.js');
const path = require('path');
const crypto = require('crypto');

async function testQuickCreate() {
  console.log('=== Testing Quick Project Creation ===\n');

  // Initialize database
  const dbPath = path.join(__dirname, '..', 'data', 'chainlesschain.db');
  console.log('Database path:', dbPath);

  const database = new Database(dbPath, {
    password: null,
    encryptionEnabled: false  // Disable encryption for testing
  });
  await database.initialize();

  console.log('\nDatabase initialized successfully\n');

  // Test data matching what the frontend sends
  const projectId = crypto.randomUUID();
  const timestamp = Date.now();

  const testProject = {
    id: projectId,
    name: 'Test Quick Project',
    description: 'Testing quick project creation',
    project_type: 'document',
    user_id: 'test-user',
    root_path: path.join(__dirname, '..', 'data', 'projects', projectId),
    created_at: timestamp,
    updated_at: timestamp,
    sync_status: 'pending',
    file_count: 1,
    metadata: JSON.stringify({
      created_by: 'quick-create-test',
      created_at: new Date().toISOString(),
    }),
  };

  console.log('Test project data:');
  console.log(JSON.stringify(testProject, null, 2));
  console.log('\n');

  try {
    // Test saveProject
    console.log('Step 1: Testing saveProject...');
    await database.saveProject(testProject);
    console.log('✓ saveProject succeeded\n');

    // Test saveProjectFiles
    console.log('Step 2: Testing saveProjectFiles...');
    const testFile = {
      project_id: projectId,
      file_name: 'README.md',
      file_path: 'README.md',
      file_type: 'markdown',
      content: '# Test Project\n\nThis is a test.',
      created_at: timestamp,
      updated_at: timestamp,
    };

    console.log('Test file data:');
    console.log(JSON.stringify(testFile, null, 2));
    console.log('\n');

    await database.saveProjectFiles(projectId, [testFile]);
    console.log('✓ saveProjectFiles succeeded\n');

    // Verify the data was saved
    console.log('Step 3: Verifying saved data...');
    const savedProject = await database.getProject(projectId);
    console.log('Saved project:', savedProject);

    console.log('\n=== All tests passed! ===');
  } catch (error) {
    console.error('\n=== TEST FAILED ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testQuickCreate().catch(console.error);
