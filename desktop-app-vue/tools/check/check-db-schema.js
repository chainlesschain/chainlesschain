/**
 * Check database schema for project_files table
 */

const Database = require('./src/main/database.js');
const path = require('path');

async function checkSchema() {
  console.log('=== Checking Database Schema ===\n');

  const dbPath = path.join(__dirname, '..', 'data', 'chainlesschain.db');
  console.log('Database path:', dbPath);

  const database = new Database(dbPath, {
    password: null,
    encryptionEnabled: false
  });
  await database.initialize();

  console.log('\n✓ Database initialized\n');

  try {
    // Check project_files table structure
    const projectFilesInfo = database.db.prepare("PRAGMA table_info(project_files)").all();

    console.log('project_files table structure:');
    console.log('Columns:', projectFilesInfo.length);
    projectFilesInfo.forEach((col, idx) => {
      console.log(`  [${idx}] ${col.name} (${col.type})${col.notnull ? ' NOT NULL' : ''}${col.pk ? ' PRIMARY KEY' : ''}`);
    });

    console.log('\n');

    // Check projects table structure
    const projectsInfo = database.db.prepare("PRAGMA table_info(projects)").all();

    console.log('projects table structure:');
    console.log('Columns:', projectsInfo.length);
    projectsInfo.forEach((col, idx) => {
      console.log(`  [${idx}] ${col.name} (${col.type})${col.notnull ? ' NOT NULL' : ''}${col.pk ? ' PRIMARY KEY' : ''}`);
    });

    console.log('\n');

    // Check if there are any existing projects
    const projectCount = database.db.prepare("SELECT COUNT(*) as count FROM projects").get();
    console.log('Total projects in database:', projectCount.count);

    const fileCount = database.db.prepare("SELECT COUNT(*) as count FROM project_files").get();
    console.log('Total files in database:', fileCount.count);

  } catch (error) {
    console.error('Error checking schema:', error);
    throw error;
  }
}

checkSchema().catch(console.error);
