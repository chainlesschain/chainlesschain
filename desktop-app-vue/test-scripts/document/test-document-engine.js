/**
 * Document Engine 测试脚本
 * 测试修复后的功能
 */

const DocumentEngine = require('./src/main/engines/document-engine');
const fs = require('fs').promises;
const path = require('path');

// 测试用的Markdown内容
const testMarkdown = `# 测试文档标题

## 简介

这是一个**测试文档**，用于验证Document Engine的功能。

### 功能列表

以下是支持的功能：

- 无序列表项1
- 无序列表项2
- 无序列表项3

### 有序列表测试

1. 第一步操作
2. 第二步操作
3. 第三步操作

## 代码示例

这是行内代码：\`console.log('Hello')\`

代码块示例：

\`\`\`javascript
function hello() {
  console.log('Hello World');
}
\`\`\`

## 格式测试

这段文本包含**粗体**和*斜体*格式。

---

以上是分隔线。

## 链接测试

访问 [ChainlessChain](https://github.com/chainlesschain) 了解更多。
`;

async function runTests() {
  console.log('========================================');
  console.log('Document Engine 测试开始');
  console.log('========================================\n');

  const engine = new DocumentEngine();
  const testDir = path.join(__dirname, 'test-output');

  try {
    // 创建测试目录
    await fs.mkdir(testDir, { recursive: true });
    console.log('✓ 测试目录创建成功:', testDir);

    // 测试1: 生成Markdown文档
    console.log('\n--- 测试1: 生成Markdown文档 ---');
    const mdResult = await engine.generateDocument({
      template: 'business_report',
      title: '测试商务报告',
      author: '测试用户',
      format: 'markdown',
      projectPath: testDir,
      content: {
        summary: '这是测试摘要',
        background: '这是测试背景',
        analysis: '这是测试分析',
        conclusion: '这是测试结论',
        recommendations: '这是测试建议'
      }
    });
    console.log('✓ Markdown文档生成成功:', mdResult.filePath);

    // 测试2: Markdown转HTML
    console.log('\n--- 测试2: Markdown转HTML ---');
    const testMdPath = path.join(testDir, 'test-markdown.md');
    await fs.writeFile(testMdPath, testMarkdown, 'utf-8');
    console.log('✓ 测试Markdown文件创建:', testMdPath);

    const htmlResult = await engine.exportTo(testMdPath, 'html');
    console.log('✓ HTML导出成功:', htmlResult.path);

    // 读取并验证HTML内容
    const htmlContent = await fs.readFile(htmlResult.path, 'utf-8');
    const validations = [
      { check: htmlContent.includes('<h1>测试文档标题</h1>'), name: 'H1标题' },
      { check: htmlContent.includes('<h2>简介</h2>'), name: 'H2标题' },
      { check: htmlContent.includes('<h3>功能列表</h3>'), name: 'H3标题' },
      { check: htmlContent.includes('<ul>'), name: '无序列表' },
      { check: htmlContent.includes('<ol>'), name: '有序列表' },
      { check: htmlContent.includes('<strong>粗体</strong>'), name: '粗体格式' },
      { check: htmlContent.includes('<em>斜体</em>'), name: '斜体格式' },
      { check: htmlContent.includes('<code>console.log'), name: '行内代码' },
      { check: htmlContent.includes('<pre><code>'), name: '代码块' },
      { check: htmlContent.includes('<hr>'), name: '分隔线' },
      { check: htmlContent.includes('<a href="https://github.com/chainlesschain">'), name: '链接' }
    ];

    console.log('\nHTML内容验证:');
    let passedCount = 0;
    for (const validation of validations) {
      if (validation.check) {
        console.log(`  ✓ ${validation.name}`);
        passedCount++;
      } else {
        console.log(`  ✗ ${validation.name}`);
      }
    }
    console.log(`\n验证通过: ${passedCount}/${validations.length}`);

    // 测试3: 导出为TXT
    console.log('\n--- 测试3: 导出为TXT ---');
    const txtResult = await engine.exportTo(testMdPath, 'txt');
    console.log('✓ TXT导出成功:', txtResult.path);

    // 测试4: PDF导出（会生成HTML作为替代）
    console.log('\n--- 测试4: PDF导出测试 ---');
    try {
      const pdfResult = await engine.exportTo(testMdPath, 'pdf');
      if (pdfResult.alternative) {
        console.log('✓ PDF导出降级到HTML:', pdfResult.path);
        console.log('  提示:', pdfResult.message);
      } else {
        console.log('✓ PDF导出成功:', pdfResult.path);
      }
    } catch (pdfError) {
      console.log('✗ PDF导出失败:', pdfError.message);
    }

    // 测试5: Word导出
    console.log('\n--- 测试5: Word导出测试 ---');
    try {
      const docxResult = await engine.exportTo(testMdPath, 'docx');
      if (docxResult.alternative) {
        console.log('✓ Word导出降级到HTML:', docxResult.path);
        console.log('  提示:', docxResult.message);
      } else {
        console.log('✓ Word导出成功:', docxResult.path);
      }
    } catch (docxError) {
      console.log('✗ Word导出失败:', docxError.message);
    }

    // 测试6: 获取模板列表
    console.log('\n--- 测试6: 模板列表 ---');
    const templates = engine.getTemplates();
    console.log('可用模板:');
    for (const [key, template] of Object.entries(templates)) {
      console.log(`  - ${key}: ${template.name} - ${template.description}`);
    }

    console.log('\n========================================');
    console.log('所有测试完成！');
    console.log('========================================');
    console.log('\n测试文件位置:', testDir);
    console.log('请检查生成的文件以验证输出质量。\n');

  } catch (error) {
    console.error('\n✗ 测试失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行测试
runTests().catch(console.error);
