/**
 * 测试Word引擎的目录自动创建功能
 */

const wordEngine = require('./src/main/engines/word-engine');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

async function testAutoMkdir() {
  console.log('\n========== 测试Word引擎目录自动创建 ==========\n');

  // 测试1: 不存在的深层目录
  const testPath1 = path.join(__dirname, 'test-auto-mkdir', 'level1', 'level2', 'level3');
  const testFile1 = path.join(testPath1, 'test-deep.docx');

  console.log('【测试1】深层不存在的目录');
  console.log('目标路径:', testFile1);

  // 确保测试目录不存在
  try {
    await fs.rm(path.join(__dirname, 'test-auto-mkdir'), { recursive: true, force: true });
    console.log('✓ 已清理旧测试目录');
  } catch (err) {
    // 忽略
  }

  // 模拟AI任务调用
  const mockLLM = { isInitialized: false };

  try {
    const result = await wordEngine.handleProjectTask({
      description: '测试目录自动创建',
      projectPath: testPath1,
      llmManager: mockLLM,
      action: 'create_document'
    });

    console.log('✓ 任务执行成功');
    console.log('  返回路径:', result.filePath);
    console.log('  文件大小:', result.fileSize, 'bytes');

    // 验证文件存在
    if (fsSync.existsSync(result.filePath)) {
      console.log('✅ 文件已生成:', result.filePath);

      // 验证目录结构
      const stats = await fs.stat(result.filePath);
      console.log('✅ 文件大小:', stats.size, 'bytes');

      // 列出生成的目录结构
      console.log('\n生成的目录结构:');
      const listDir = async (dir, prefix = '') => {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory()) {
            console.log(`${prefix}📁 ${item.name}/`);
            await listDir(path.join(dir, item.name), prefix + '  ');
          } else {
            console.log(`${prefix}📄 ${item.name}`);
          }
        }
      };
      await listDir(path.join(__dirname, 'test-auto-mkdir'));

    } else {
      console.log('❌ 文件未生成!');
    }
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error('堆栈:', error.stack);
  }

  console.log('\n========== 测试完成 ==========\n');
}

testAutoMkdir().catch(err => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
