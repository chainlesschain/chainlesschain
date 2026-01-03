const fs = require('fs');
const path = require('path');
const DatabaseManager = require('./desktop-app-vue/src/main/database');

const dbPath = path.join(__dirname, 'data/chainlesschain.db');
const templatePath = path.join(__dirname, 'desktop-app-vue/src/main/templates/writing/business-plan.json');

(async () => {
  const db = new DatabaseManager(dbPath, { encryptionEnabled: false });
  await db.initialize();

  const content = fs.readFileSync(templatePath, 'utf-8');
  const template = JSON.parse(content);

  console.log('模板字段类型检查:');
  Object.keys(template).forEach(key => {
    const value = template[key];
    const type = typeof value;
    const isArray = Array.isArray(value);
    const isNull = value === null;

    console.log(`  ${key.padEnd(20)} ${type.padEnd(10)} ${isArray ? '[Array]' : ''} ${isNull ? '[null]' : ''}`);

    if (type === 'object' && !isNull && !isArray) {
      console.log(`    -> needs JSON.stringify`);
    } else if (isArray) {
      console.log(`    -> needs JSON.stringify`);
    }
  });

  // 测试绑定参数
  console.log('\n准备的参数类型:');
  const vars_schema = typeof template.variables_schema === 'string'
    ? template.variables_schema
    : JSON.stringify(template.variables_schema || {});

  console.log('  variables_schema:', typeof vars_schema, vars_schema.substring(0, 50) + '...');

  db.close();
})().catch(console.error);
