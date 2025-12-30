/**
 * 检查和修复数据库中的 LLM 配置
 */

const Database = require('./src/main/database.js');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('=== 检查数据库中的 LLM 配置 ===\n');

  // 初始化数据库
  const dbPath = 'C:/code/chainlesschain/data/chainlesschain.db';
  const db = new Database({ dbPath });

  // 初始化数据库连接
  await db.initialize();

  console.log('📋 当前数据库配置:');

  const llmSettings = [
    'llm.provider',
    'llm.customApiKey',
    'llm.customBaseUrl',
    'llm.customModel',
    'llm.volcengineApiKey',
    'llm.volcengineModel',
    'llm.autoSelect',
  ];

  llmSettings.forEach(key => {
    const value = db.getSetting(key);
    if (value !== null && value !== undefined) {
      if (key.includes('ApiKey')) {
        console.log(`  ${key}: ${value.substring(0, 8)}...`);
      } else {
        console.log(`  ${key}: ${value}`);
      }
    } else {
      console.log(`  ${key}: (未设置)`);
    }
  });

  // 读取 llm-config.json
  const configPath = path.join(
    process.env.APPDATA || process.env.HOME,
    'chainlesschain-desktop-vue',
    'llm-config.json'
  );

  if (!fs.existsSync(configPath)) {
    console.error('\n❌ llm-config.json 不存在');
    return;
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('\n📄 llm-config.json 配置:');
  console.log(`  provider: ${config.provider}`);
  console.log(`  custom.apiKey: ${config.custom.apiKey.substring(0, 8)}...`);
  console.log(`  custom.baseURL: ${config.custom.baseURL}`);
  console.log(`  custom.model: ${config.custom.model}`);

  // 检查是否需要同步
  const dbProvider = db.getSetting('llm.provider');
  const dbCustomApiKey = db.getSetting('llm.customApiKey');
  const dbCustomBaseUrl = db.getSetting('llm.customBaseUrl');
  const dbCustomModel = db.getSetting('llm.customModel');

  const needsSync =
    dbProvider !== config.provider ||
    dbCustomApiKey !== config.custom.apiKey ||
    dbCustomBaseUrl !== config.custom.baseURL ||
    dbCustomModel !== config.custom.model;

  if (needsSync) {
    console.log('\n⚠️  数据库配置与 llm-config.json 不一致，需要同步');
    console.log('\n是否要将 llm-config.json 的配置同步到数据库？(y/n)');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('请输入: ', (answer) => {
      if (answer.toLowerCase() === 'y') {
        console.log('\n🔧 正在同步配置...');

        db.saveSetting('llm.provider', config.provider);
        db.saveSetting('llm.customApiKey', config.custom.apiKey);
        db.saveSetting('llm.customBaseUrl', config.custom.baseURL);
        db.saveSetting('llm.customModel', config.custom.model);

        console.log('\n✅ 配置同步完成！');
        console.log('\n📋 更新后的数据库配置:');
        llmSettings.forEach(key => {
          const value = db.getSetting(key);
          if (value !== null && value !== undefined) {
            if (key.includes('ApiKey')) {
              console.log(`  ${key}: ${value.substring(0, 8)}...`);
            } else {
              console.log(`  ${key}: ${value}`);
            }
          }
        });

        console.log('\n✅ 完成！现在请重启应用测试。');
      } else {
        console.log('\n取消同步');
      }

      rl.close();
      db.close();
    });
  } else {
    console.log('\n✅ 数据库配置与 llm-config.json 一致，无需同步');
    db.close();
  }
}

main().catch(error => {
  console.error('错误:', error);
  process.exit(1);
});
