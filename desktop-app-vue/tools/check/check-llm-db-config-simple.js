/**
 * 简单检查数据库中的 LLM 配置（使用 sql.js）
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('=== 检查数据库中的 LLM 配置 ===\n');

  // 初始化 sql.js
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, '../node_modules/sql.js/dist', file)
  });

  // 读取数据库文件
  const dbPath = 'C:/code/chainlesschain/data/chainlesschain.db';
  if (!fs.existsSync(dbPath)) {
    console.error('❌ 数据库文件不存在:', dbPath);
    return;
  }

  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);

  // 查询 LLM 相关配置
  console.log('📋 数据库中的 LLM 配置:\n');

  const llmSettings = [
    'llm.provider',
    'llm.customApiKey',
    'llm.customBaseUrl',
    'llm.customModel',
    'llm.volcengineApiKey',
    'llm.volcengineModel',
  ];

  const stmt = db.prepare('SELECT key, value, type FROM system_settings WHERE key LIKE ?');
  stmt.bind(['llm.%']);

  const foundSettings = new Map();
  while (stmt.step()) {
    const row = stmt.getAsObject();
    foundSettings.set(row.key, row.value);

    if (row.key.includes('ApiKey')) {
      console.log(`  ${row.key}: ${row.value.substring(0, 8)}...`);
    } else {
      console.log(`  ${row.key}: ${row.value}`);
    }
  }
  stmt.free();

  // 读取 llm-config.json
  const configPath = path.join(
    process.env.APPDATA || process.env.HOME,
    'chainlesschain-desktop-vue',
    'llm-config.json'
  );

  if (!fs.existsSync(configPath)) {
    console.error('\n❌ llm-config.json 不存在');
    db.close();
    return;
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('\n📄 llm-config.json 配置:');
  console.log(`  provider: ${config.provider}`);
  console.log(`  custom.apiKey: ${config.custom.apiKey.substring(0, 8)}...`);
  console.log(`  custom.baseURL: ${config.custom.baseURL}`);
  console.log(`  custom.model: ${config.custom.model}`);

  // 比较配置
  console.log('\n🔍 配置对比:');
  const dbProvider = foundSettings.get('llm.provider') || '(未设置)';
  const dbCustomApiKey = foundSettings.get('llm.customApiKey') || '(未设置)';
  const dbCustomBaseUrl = foundSettings.get('llm.customBaseUrl') || '(未设置)';
  const dbCustomModel = foundSettings.get('llm.customModel') || '(未设置)';

  console.log(`\n  Provider:`);
  console.log(`    数据库: ${dbProvider}`);
  console.log(`    配置文件: ${config.provider}`);
  console.log(`    ${dbProvider === config.provider ? '✅' : '❌'} 一致`);

  console.log(`\n  Custom API Key:`);
  console.log(`    数据库: ${dbCustomApiKey !== '(未设置)' ? dbCustomApiKey.substring(0, 8) + '...' : dbCustomApiKey}`);
  console.log(`    配置文件: ${config.custom.apiKey.substring(0, 8)}...`);
  console.log(`    ${dbCustomApiKey === config.custom.apiKey ? '✅' : '❌'} 一致`);

  console.log(`\n  Custom Base URL:`);
  console.log(`    数据库: ${dbCustomBaseUrl}`);
  console.log(`    配置文件: ${config.custom.baseURL}`);
  console.log(`    ${dbCustomBaseUrl === config.custom.baseURL ? '✅' : '❌'} 一致`);

  console.log(`\n  Custom Model:`);
  console.log(`    数据库: ${dbCustomModel}`);
  console.log(`    配置文件: ${config.custom.model}`);
  console.log(`    ${dbCustomModel === config.custom.model ? '✅' : '❌'} 一致`);

  const needsUpdate =
    dbProvider !== config.provider ||
    dbCustomApiKey !== config.custom.apiKey ||
    dbCustomBaseUrl !== config.custom.baseURL ||
    dbCustomModel !== config.custom.model;

  if (needsUpdate) {
    console.log('\n⚠️  需要更新数据库配置！');
    console.log('\n正在更新...');

    // 更新配置
    const updateOrInsert = (key, value, type = 'string') => {
      const existing = db.exec(`SELECT key FROM system_settings WHERE key = '${key}'`);
      if (existing.length > 0 && existing[0].values.length > 0) {
        db.run(`UPDATE system_settings SET value = ?, type = ?, updated_at = datetime('now') WHERE key = ?`,
          [value, type, key]);
      } else {
        db.run(`INSERT INTO system_settings (key, value, type, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
          [key, value, type]);
      }
    };

    updateOrInsert('llm.provider', config.provider);
    updateOrInsert('llm.customApiKey', config.custom.apiKey);
    updateOrInsert('llm.customBaseUrl', config.custom.baseURL);
    updateOrInsert('llm.customModel', config.custom.model);

    // 保存到文件
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);

    console.log('✅ 数据库配置已更新');
  } else {
    console.log('\n✅ 配置一致，无需更新');
  }

  db.close();
}

main().catch(error => {
  console.error('错误:', error);
  process.exit(1);
});
