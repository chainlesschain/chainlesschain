/**
 * Word导出功能完整测试和诊断脚本
 * 一键运行，全面检查Word生成功能
 */

const wordEngine = require('./src/main/engines/word-engine');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(color, ...args) {
  console.log(colors[color], ...args, colors.reset);
}

async function testWordGeneration() {
  log('cyan', '\n========================================');
  log('cyan', '  Word导出功能完整测试');
  log('cyan', '========================================\n');

  const testDir = path.join(__dirname, 'test-word-fix-output');
  let allTestsPassed = true;

  // 1. 创建测试目录
  try {
    await fs.mkdir(testDir, { recursive: true });
    log('green', '✓ 测试目录已创建:', testDir);
  } catch (error) {
    log('red', '✗ 创建测试目录失败:', error.message);
    return false;
  }

  // 2. 测试 markdownToWord
  log('blue', '\n【测试1】Markdown转Word');
  log('blue', '='.repeat(50));
  try {
    const testMarkdown = `# 测试文档

这是一个测试文档，用于验证Markdown到Word的转换功能。

## 主要功能

- 支持标题（H1-H6）
- 支持**粗体**和*斜体*
- 支持段落

## 代码示例

这是一段普通文本。`;

    const outputPath1 = path.join(testDir, 'test-markdown.docx');
    log('yellow', '  输入:', testMarkdown.substring(0, 50) + '...');
    log('yellow', '  输出路径:', outputPath1);

    const result1 = await wordEngine.markdownToWord(testMarkdown, outputPath1, {
      title: '测试Markdown文档'
    });

    // 验证文件存在
    const exists1 = fsSync.existsSync(outputPath1);
    if (exists1) {
      const stats1 = await fs.stat(outputPath1);
      log('green', '  ✓ 文件已生成:', outputPath1);
      log('green', '  ✓ 文件大小:', stats1.size, 'bytes');
      log('green', '  ✓ 返回结果:', JSON.stringify(result1, null, 2));
    } else {
      log('red', '  ✗ 文件未生成!');
      log('red', '  ✗ 预期路径:', outputPath1);
      allTestsPassed = false;
    }
  } catch (error) {
    log('red', '  ✗ 测试失败:', error.message);
    log('red', '  ✗ 堆栈:', error.stack);
    allTestsPassed = false;
  }

  // 3. 测试 htmlToWord
  log('blue', '\n【测试2】HTML转Word');
  log('blue', '='.repeat(50));
  try {
    const testHTML = `
      <h1>测试HTML文档</h1>
      <p>这是一个测试文档，用于验证HTML到Word的转换功能。</p>
      <h2>主要功能</h2>
      <p>支持HTML标签转换</p>
      <p><strong>粗体文本</strong>和<em>斜体文本</em></p>
    `;

    const outputPath2 = path.join(testDir, 'test-html.docx');
    log('yellow', '  输入:', testHTML.substring(0, 50) + '...');
    log('yellow', '  输出路径:', outputPath2);

    const result2 = await wordEngine.htmlToWord(testHTML, outputPath2, {
      title: '测试HTML文档'
    });

    // 验证文件存在
    const exists2 = fsSync.existsSync(outputPath2);
    if (exists2) {
      const stats2 = await fs.stat(outputPath2);
      log('green', '  ✓ 文件已生成:', outputPath2);
      log('green', '  ✓ 文件大小:', stats2.size, 'bytes');
      log('green', '  ✓ 返回结果:', JSON.stringify(result2, null, 2));
    } else {
      log('red', '  ✗ 文件未生成!');
      log('red', '  ✗ 预期路径:', outputPath2);
      allTestsPassed = false;
    }
  } catch (error) {
    log('red', '  ✗ 测试失败:', error.message);
    log('red', '  ✗ 堆栈:', error.stack);
    allTestsPassed = false;
  }

  // 4. 测试 handleProjectTask (AI集成)
  log('blue', '\n【测试3】AI任务集成测试');
  log('blue', '='.repeat(50));
  try {
    // 模拟LLM返回
    const mockLLMManager = {
      isInitialized: false // 使用降级方案
    };

    const description = '生成一个项目总结文档';
    const projectPath = testDir;

    log('yellow', '  描述:', description);
    log('yellow', '  项目路径:', projectPath);

    const result3 = await wordEngine.handleProjectTask({
      description,
      projectPath,
      llmManager: mockLLMManager,
      action: 'create_document'
    });

    log('green', '  ✓ 任务执行完成');
    log('green', '  ✓ 返回结果:', JSON.stringify(result3, null, 2));

    // 验证文件
    if (result3.filePath) {
      const exists3 = fsSync.existsSync(result3.filePath);
      if (exists3) {
        const stats3 = await fs.stat(result3.filePath);
        log('green', '  ✓ 文件已生成:', result3.filePath);
        log('green', '  ✓ 文件大小:', stats3.size, 'bytes');
      } else {
        log('red', '  ✗ 文件未生成!');
        log('red', '  ✗ 预期路径:', result3.filePath);
        allTestsPassed = false;
      }
    } else {
      log('red', '  ✗ 返回结果中没有filePath!');
      allTestsPassed = false;
    }
  } catch (error) {
    log('red', '  ✗ 测试失败:', error.message);
    log('red', '  ✗ 堆栈:', error.stack);
    allTestsPassed = false;
  }

  // 5. 测试文件名包含特殊字符
  log('blue', '\n【测试4】特殊字符文件名测试');
  log('blue', '='.repeat(50));
  try {
    const specialTitleMarkdown = `# 测试:特殊/字符\\文件名?`;
    const outputPath4 = path.join(testDir, 'test-special-chars.docx');

    log('yellow', '  包含特殊字符的标题');
    log('yellow', '  输出路径:', outputPath4);

    const result4 = await wordEngine.markdownToWord(specialTitleMarkdown, outputPath4, {
      title: '测试特殊字符'
    });

    const exists4 = fsSync.existsSync(outputPath4);
    if (exists4) {
      log('green', '  ✓ 特殊字符处理正常');
    } else {
      log('yellow', '  ⚠ 特殊字符可能导致问题');
      // 不标记为失败，因为这是预期的边界情况
    }
  } catch (error) {
    log('yellow', '  ⚠ 特殊字符测试出现异常（这可能是正常的）');
    log('yellow', '  错误:', error.message);
  }

  // 6. 总结
  log('cyan', '\n========================================');
  log('cyan', '  测试总结');
  log('cyan', '========================================\n');

  if (allTestsPassed) {
    log('green', '✓ 所有核心测试通过！');
    log('green', '\n生成的文件位于:', testDir);
    log('green', '\n请检查以下文件：');

    try {
      const files = await fs.readdir(testDir);
      files.forEach(file => {
        if (file.endsWith('.docx')) {
          const filePath = path.join(testDir, file);
          const stats = fsSync.statSync(filePath);
          log('green', `  - ${file} (${stats.size} bytes)`);
        }
      });
    } catch (err) {
      log('yellow', '无法列出生成的文件');
    }

    log('cyan', '\n✓ Word导出功能工作正常！');
    log('cyan', '\n如果应用中还是没有生成文件，问题可能在于：');
    log('cyan', '  1. 项目路径不正确');
    log('cyan', '  2. 没有写入权限');
    log('cyan', '  3. LLM生成的标题包含非法字符');
    log('cyan', '\n请运行应用并查看终端日志中的：');
    log('cyan', '  [WordEngine] 项目路径: ...');
    log('cyan', '  [WordEngine] 完整路径: ...');
  } else {
    log('red', '✗ 某些测试失败，Word引擎可能有问题');
    log('red', '\n请检查上面的错误信息');
  }

  log('cyan', '\n========================================\n');

  return allTestsPassed;
}

// 运行测试
testWordGeneration().catch(error => {
  log('red', '\n测试执行失败:', error);
  process.exit(1);
});
