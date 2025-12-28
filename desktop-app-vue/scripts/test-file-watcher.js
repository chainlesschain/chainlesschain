/**
 * 文件监听功能测试脚本
 *
 * 用法：
 * 1. 启动桌面应用：npm run dev
 * 2. 在应用中打开一个项目
 * 3. 在另一个终端运行此脚本：node scripts/test-file-watcher.js
 */

const fs = require('fs').promises;
const path = require('path');

// 配置测试项目路径（请修改为你的实际项目路径）
const TEST_PROJECT_PATH = 'C:\\code\\chainlesschain\\data\\projects\\test-watch';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testFileWatcher() {
  console.log('='.repeat(60));
  console.log('文件监听功能测试');
  console.log('='.repeat(60));
  console.log();

  try {
    // 确保测试目录存在
    await fs.mkdir(TEST_PROJECT_PATH, { recursive: true });
    console.log(`✓ 测试目录: ${TEST_PROJECT_PATH}`);
    console.log();

    // 测试 1: 创建新文件
    console.log('测试 1: 创建新文件');
    console.log('-'.repeat(60));
    const testFile1 = path.join(TEST_PROJECT_PATH, 'test-created.txt');
    await fs.writeFile(testFile1, 'This is a new file created for testing.', 'utf8');
    console.log(`✓ 创建文件: ${path.basename(testFile1)}`);
    console.log('  → 预期: 应用界面显示新文件，收到通知');
    await sleep(2000);
    console.log();

    // 测试 2: 修改文件内容
    console.log('测试 2: 修改文件内容');
    console.log('-'.repeat(60));
    await fs.writeFile(testFile1, 'This file has been modified!', 'utf8');
    console.log(`✓ 修改文件: ${path.basename(testFile1)}`);
    console.log('  → 预期: 如果文件在编辑器中打开，内容自动更新');
    await sleep(2000);
    console.log();

    // 测试 3: 创建多个文件
    console.log('测试 3: 批量创建文件');
    console.log('-'.repeat(60));
    const files = ['test-1.md', 'test-2.js', 'test-3.txt'];
    for (const fileName of files) {
      const filePath = path.join(TEST_PROJECT_PATH, fileName);
      await fs.writeFile(filePath, `Content of ${fileName}`, 'utf8');
      console.log(`✓ 创建文件: ${fileName}`);
      await sleep(500);
    }
    console.log('  → 预期: 应用界面显示所有新文件');
    await sleep(2000);
    console.log();

    // 测试 4: 修改多个文件
    console.log('测试 4: 批量修改文件');
    console.log('-'.repeat(60));
    for (const fileName of files) {
      const filePath = path.join(TEST_PROJECT_PATH, fileName);
      await fs.writeFile(filePath, `Updated content of ${fileName} at ${new Date().toISOString()}`, 'utf8');
      console.log(`✓ 修改文件: ${fileName}`);
      await sleep(500);
    }
    console.log('  → 预期: 打开的文件内容自动更新');
    await sleep(2000);
    console.log();

    // 测试 5: 删除文件
    console.log('测试 5: 删除文件');
    console.log('-'.repeat(60));
    await fs.unlink(testFile1);
    console.log(`✓ 删除文件: ${path.basename(testFile1)}`);
    console.log('  → 预期: 文件从列表中消失，编辑器关闭（如果正在编辑）');
    await sleep(2000);
    console.log();

    // 测试 6: 创建子目录和文件
    console.log('测试 6: 创建子目录和文件');
    console.log('-'.repeat(60));
    const subDir = path.join(TEST_PROJECT_PATH, 'subdir');
    await fs.mkdir(subDir, { recursive: true });
    const subFile = path.join(subDir, 'nested-file.txt');
    await fs.writeFile(subFile, 'This is a nested file.', 'utf8');
    console.log(`✓ 创建目录: subdir/`);
    console.log(`✓ 创建文件: subdir/nested-file.txt`);
    console.log('  → 预期: 文件树显示新目录和文件');
    await sleep(2000);
    console.log();

    // 测试完成
    console.log('='.repeat(60));
    console.log('✓ 所有测试执行完成！');
    console.log('='.repeat(60));
    console.log();
    console.log('请检查应用界面是否正确响应了所有文件变化。');
    console.log();
    console.log('清理说明：');
    console.log(`- 测试文件已创建在: ${TEST_PROJECT_PATH}`);
    console.log('- 如需清理，请手动删除该目录');
    console.log();

  } catch (error) {
    console.error('✗ 测试失败:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// 主程序
async function main() {
  console.log();
  console.log('准备开始测试...');
  console.log();
  console.log('请确保：');
  console.log('1. 桌面应用已启动 (npm run dev)');
  console.log('2. 已在应用中打开或创建项目');
  console.log(`3. 项目路径为: ${TEST_PROJECT_PATH}`);
  console.log();
  console.log('如果项目路径不正确，请编辑此脚本修改 TEST_PROJECT_PATH 变量');
  console.log();

  // 等待 3 秒让用户准备
  console.log('将在 3 秒后开始测试...');
  await sleep(3000);
  console.log();

  await testFileWatcher();
}

main().catch(error => {
  console.error('执行失败:', error);
  process.exit(1);
});
