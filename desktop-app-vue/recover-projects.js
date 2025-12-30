/**
 * 项目恢复命令行工具
 * 用于恢复被同步逻辑错误标记为删除的项目
 *
 * 使用方法:
 *   node recover-projects.js           - 扫描并显示可恢复的项目
 *   node recover-projects.js --auto    - 自动恢复所有可恢复的项目
 *   node recover-projects.js <id>      - 恢复指定ID的项目
 */

const path = require('path');
const Database = require('better-sqlite3');
const ProjectRecovery = require('./src/main/sync/project-recovery');

// 数据库路径
const dbPath = path.join(__dirname, '..', 'data', 'chainlesschain.db');

console.log('ChainlessChain 项目恢复工具');
console.log('============================\n');
console.log('数据库路径:', dbPath);

try {
  // 打开数据库
  const db = new Database(dbPath);

  // 创建一个简单的数据库包装器
  const databaseWrapper = {
    db: db,
    saveToFile: () => {
      // better-sqlite3 会自动保存
    }
  };

  const recovery = new ProjectRecovery(databaseWrapper);

  // 解析命令行参数
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // 扫描模式
    console.log('\n正在扫描可恢复的项目...\n');
    const stats = recovery.getRecoveryStats();

    console.log(`总共删除的项目: ${stats.total}`);
    console.log(`可恢复的项目: ${stats.recoverable}\n`);

    if (stats.recoverable > 0) {
      console.log('可恢复的项目列表:');
      console.log('----------------------------------------');
      stats.details.forEach((p, index) => {
        console.log(`${index + 1}. ${p.name}`);
        console.log(`   ID: ${p.id}`);
        console.log(`   原因: ${p.reason}`);
        console.log(`   创建时间: ${p.createdAt}`);
        console.log('');
      });

      console.log('\n使用方法:');
      console.log('  恢复所有项目: node recover-projects.js --auto');
      console.log('  恢复特定项目: node recover-projects.js <项目ID>');
    } else {
      console.log('没有可恢复的项目。');
    }
  } else if (args[0] === '--auto') {
    // 自动恢复模式
    console.log('\n正在自动恢复所有可恢复的项目...\n');
    const results = recovery.autoRecoverAll();

    console.log(`恢复完成:`);
    console.log(`  成功: ${results.success.length} 个项目`);
    console.log(`  失败: ${results.failed.length} 个项目`);

    if (results.success.length > 0) {
      console.log('\n成功恢复的项目ID:');
      results.success.forEach(id => console.log(`  - ${id}`));
    }

    if (results.failed.length > 0) {
      console.log('\n恢复失败的项目ID:');
      results.failed.forEach(id => console.log(`  - ${id}`));
    }

    console.log('\n请重启应用程序以查看恢复的项目。');
  } else {
    // 恢复特定项目
    const projectId = args[0];
    console.log(`\n正在恢复项目: ${projectId}...\n`);

    const success = recovery.recoverProject(projectId);

    if (success) {
      console.log('✓ 项目恢复成功！');
      console.log('请重启应用程序以查看恢复的项目。');
    } else {
      console.log('✗ 项目恢复失败。');
      console.log('请检查项目ID是否正确。');
    }
  }

  // 关闭数据库
  db.close();
} catch (error) {
  console.error('\n错误:', error.message);
  console.error('\n可能的原因:');
  console.error('  1. 数据库文件不存在或路径错误');
  console.error('  2. 数据库文件已加密，需要先解密');
  console.error('  3. 应用程序正在运行，数据库被锁定');
  console.error('\n建议:');
  console.error('  1. 确认数据库文件位于: ' + dbPath);
  console.error('  2. 关闭正在运行的应用程序');
  console.error('  3. 如果数据库已加密，请通过应用程序UI进行恢复');
  process.exit(1);
}
