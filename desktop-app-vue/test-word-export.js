/**
 * 测试Word导出功能
 * 用于验证markdownToWord和htmlToWord是否能正确生成文件
 */

const wordEngine = require('./src/main/engines/word-engine');
const fs = require('fs').promises;
const path = require('path');

async function testWordExport() {
  console.log('=== 开始测试Word导出功能 ===\n');

  const testOutputDir = path.join(__dirname, 'test-output');

  // 创建测试输出目录
  try {
    await fs.mkdir(testOutputDir, { recursive: true });
    console.log('✓ 测试输出目录已创建:', testOutputDir, '\n');
  } catch (error) {
    console.error('✗ 创建测试目录失败:', error.message);
    return;
  }

  // 测试1: Markdown转Word
  console.log('--- 测试1: Markdown转Word ---');
  try {
    const testMarkdown = `# 测试文档

这是一个测试文档，用于验证Markdown到Word的转换功能。

## 主要功能

- 支持标题（H1-H6）
- 支持**粗体**和*斜体*
- 支持段落

## 代码示例

这是一段普通文本。

### 子标题

测试内容完成。
`;

    const outputPath1 = path.join(testOutputDir, 'test-markdown.docx');
    console.log('输入Markdown长度:', testMarkdown.length, '字符');
    console.log('输出路径:', outputPath1);

    const result1 = await wordEngine.markdownToWord(testMarkdown, outputPath1, {
      title: '测试Markdown文档'
    });

    console.log('✓ Markdown转Word成功!');
    console.log('  - 文件路径:', result1.filePath);
    console.log('  - 文件大小:', (result1.fileSize / 1024).toFixed(2), 'KB');

    // 验证文件是否存在
    const stats1 = await fs.stat(outputPath1);
    console.log('✓ 文件已生成，大小:', stats1.size, 'bytes\n');

  } catch (error) {
    console.error('✗ Markdown转Word失败:', error.message);
    console.error('  错误堆栈:', error.stack, '\n');
  }

  // 测试2: HTML转Word
  console.log('--- 测试2: HTML转Word ---');
  try {
    const testHTML = `
      <h1>测试HTML文档</h1>
      <p>这是一个测试文档，用于验证HTML到Word的转换功能。</p>
      <h2>主要功能</h2>
      <p>支持HTML标签转换</p>
      <p><strong>粗体文本</strong>和<em>斜体文本</em></p>
      <h3>子标题</h3>
      <p>测试内容完成。</p>
    `;

    const outputPath2 = path.join(testOutputDir, 'test-html.docx');
    console.log('输入HTML长度:', testHTML.length, '字符');
    console.log('输出路径:', outputPath2);

    const result2 = await wordEngine.htmlToWord(testHTML, outputPath2, {
      title: '测试HTML文档'
    });

    console.log('✓ HTML转Word成功!');
    console.log('  - 文件路径:', result2.filePath);
    console.log('  - 文件大小:', (result2.fileSize / 1024).toFixed(2), 'KB');

    // 验证文件是否存在
    const stats2 = await fs.stat(outputPath2);
    console.log('✓ 文件已生成，大小:', stats2.size, 'bytes\n');

  } catch (error) {
    console.error('✗ HTML转Word失败:', error.message);
    console.error('  错误堆栈:', error.stack, '\n');
  }

  // 测试3: 空内容测试
  console.log('--- 测试3: 空内容测试 ---');
  try {
    const emptyMarkdown = '';
    const outputPath3 = path.join(testOutputDir, 'test-empty.docx');

    const result3 = await wordEngine.markdownToWord(emptyMarkdown, outputPath3, {
      title: '空文档'
    });

    console.log('✓ 空内容转Word成功!');
    console.log('  - 文件路径:', result3.filePath);
    console.log('  - 文件大小:', (result3.fileSize / 1024).toFixed(2), 'KB\n');

  } catch (error) {
    console.error('✗ 空内容转Word失败:', error.message, '\n');
  }

  console.log('=== 测试完成 ===');
  console.log('请检查以下目录中的生成文件:');
  console.log(testOutputDir);
}

// 运行测试
testWordExport().catch(error => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
