const DatabaseManager = require('./desktop-app-vue/src/main/database');
const path = require('path');

const dbPath = path.join(__dirname, 'data/chainlesschain.db');

(async () => {
  const db = new DatabaseManager(dbPath, { encryptionEnabled: false });
  await db.initialize();

  const columns = db.prepare('PRAGMA table_info(project_templates)').all();
  console.log('\nproject_templates 表字段:');
  console.log('='.repeat(60));
  columns.forEach(col => {
    console.log(`  ${col.cid}. ${col.name.padEnd(20)} ${col.type.padEnd(10)} ${col.dflt_value || ''}`);
  });

  const hasSkills = columns.find(c => c.name === 'required_skills');
  const hasTools = columns.find(c => c.name === 'required_tools');
  const hasEngine = columns.find(c => c.name === 'execution_engine');

  console.log('\n字段检查:');
  console.log('  required_skills:', hasSkills ? '✓ 存在' : '✗ 不存在');
  console.log('  required_tools:', hasTools ? '✓ 存在' : '✗ 不存在');
  console.log('  execution_engine:', hasEngine ? '✓ 存在' : '✗ 不存在');

  db.close();
})().catch(console.error);
