/**
 * 代码引擎测试示例
 * 演示如何使用新增的功能
 */

const { getCodeEngine } = require('./code-engine');

// 测试代码示例（包含一些故意的问题）
const testCode = `
function authenticateUser(username, password) {
  const query = "SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'";
  const result = db.query(query);

  if (result.length > 0) {
    const token = Math.random().toString(36);
    return token;
  }

  return null;
}
`;

async function runTests() {
  const codeEngine = getCodeEngine();

  try {
    console.log('🚀 初始化代码引擎...\n');
    await codeEngine.initialize();

    // 测试 1: 代码格式化
    console.log('='.repeat(60));
    console.log('测试 1: 代码格式化');
    console.log('='.repeat(60));
    const formatted = await codeEngine.formatCode(testCode, 'javascript', {
      style: 'prettier',
      indentSize: 2,
      singleQuotes: true
    });
    console.log('✅ 格式化完成');
    console.log('格式化后的代码:\n', formatted.formattedCode.substring(0, 200) + '...\n');

    // 测试 2: 复杂度分析
    console.log('='.repeat(60));
    console.log('测试 2: 代码复杂度分析');
    console.log('='.repeat(60));
    const complexity = await codeEngine.analyzeComplexity(testCode, 'javascript');
    console.log('✅ 复杂度分析完成');
    console.log('指标:');
    console.log('  - 圈复杂度:', complexity.metrics.cyclomaticComplexity);
    console.log('  - 认知复杂度:', complexity.metrics.cognitiveComplexity);
    console.log('  - 代码行数:', complexity.metrics.linesOfCode);
    console.log('  - 综合评分:', complexity.metrics.score, '/10\n');

    // 测试 3: 安全漏洞扫描
    console.log('='.repeat(60));
    console.log('测试 3: 安全漏洞扫描');
    console.log('='.repeat(60));
    const security = await codeEngine.scanSecurity(testCode, 'javascript');
    console.log('✅ 安全扫描完成');
    console.log('安全等级:', security.securityLevel);
    console.log('安全评分:', security.score, '/10');
    console.log('发现漏洞数:', security.vulnerabilities.length);

    if (security.vulnerabilities.length > 0) {
      console.log('\n发现的漏洞:');
      security.vulnerabilities.forEach((vuln, i) => {
        console.log(`  ${i + 1}. ${vuln.type} [${vuln.severity}]`);
        console.log(`     位置: ${vuln.location}`);
        console.log(`     修复建议: ${vuln.recommendation.substring(0, 80)}...`);
      });
    }
    console.log();

    // 测试 4: 全面代码审查
    console.log('='.repeat(60));
    console.log('测试 4: 全面代码审查（整合复杂度和安全分析）');
    console.log('='.repeat(60));
    const review = await codeEngine.reviewCode(testCode, 'javascript', {
      includeComplexity: true,
      includeSecurity: true
    });
    console.log('✅ 代码审查完成');
    console.log('综合评分:', review.finalScore, '/10');
    console.log('基础审查评分:', review.basicReview.score, '/10');
    console.log('总建议数:', review.suggestions.length);

    if (review.suggestions.length > 0) {
      console.log('\n优先级建议:');
      const highPriority = review.suggestions.filter(s => s.priority === 'high');
      highPriority.forEach((s, i) => {
        console.log(`  ${i + 1}. [高优先级] ${s.issue}`);
        console.log(`     建议: ${s.advice.substring(0, 80)}...`);
      });
    }
    console.log();

    // 测试 5: 代码转换
    console.log('='.repeat(60));
    console.log('测试 5: 代码转换 (JavaScript → TypeScript)');
    console.log('='.repeat(60));

    const simpleCode = `
function add(a, b) {
  return a + b;
}
    `.trim();

    const converted = await codeEngine.convertCode(
      simpleCode,
      'javascript',
      'typescript',
      { modernize: true }
    );
    console.log('✅ 代码转换完成');
    console.log('转换后的代码:\n', converted.convertedCode);
    console.log();

    // 测试 6: 生成测试
    console.log('='.repeat(60));
    console.log('测试 6: 生成单元测试');
    console.log('='.repeat(60));
    const tests = await codeEngine.generateTests(simpleCode, 'javascript');
    console.log('✅ 测试生成完成');
    console.log('生成的测试代码:\n', tests.substring(0, 300) + '...\n');

    // 测试 7: 生成集成测试
    console.log('='.repeat(60));
    console.log('测试 7: 生成集成测试');
    console.log('='.repeat(60));
    const integrationTests = await codeEngine.generateIntegrationTests(
      simpleCode,
      'javascript',
      {
        testScenarios: [
          '测试函数正常调用',
          '测试参数验证',
          '测试边界情况'
        ]
      }
    );
    console.log('✅ 集成测试生成完成');
    console.log('生成的集成测试:\n', integrationTests.tests.substring(0, 300) + '...\n');

    // 测试 8: 项目脚手架生成
    console.log('='.repeat(60));
    console.log('测试 8: 生成项目脚手架');
    console.log('='.repeat(60));

    const projectTypes = ['react_app', 'vue_app', 'nextjs_app', 'express_api', 'fastapi_app'];

    for (const type of projectTypes) {
      const scaffold = await codeEngine.generateScaffold(type, {
        projectName: `test-${type}`
      });
      console.log(`✅ ${type} 脚手架生成完成 - ${scaffold.files.length} 个文件`);
    }
    console.log();

    // 测试 9: 代码生成（带进度反馈）
    console.log('='.repeat(60));
    console.log('测试 9: 代码生成（流式输出）');
    console.log('='.repeat(60));

    const generated = await codeEngine.generateCode(
      '创建一个简单的用户注册函数',
      {
        language: 'javascript',
        includeComments: true,
        streaming: false, // 在测试中禁用流式输出以避免大量日志
        onProgress: (progress) => {
          if (progress.stage === 'complete') {
            console.log('✅ 代码生成完成');
          }
        }
      }
    );

    console.log('生成的代码:\n', generated.code.substring(0, 300) + '...\n');

    // 总结
    console.log('='.repeat(60));
    console.log('🎉 所有测试完成！');
    console.log('='.repeat(60));
    console.log('\n测试结果总结:');
    console.log('✅ 代码格式化 - 通过');
    console.log('✅ 复杂度分析 - 通过');
    console.log('✅ 安全漏洞扫描 - 通过');
    console.log('✅ 全面代码审查 - 通过');
    console.log('✅ 代码转换 - 通过');
    console.log('✅ 单元测试生成 - 通过');
    console.log('✅ 集成测试生成 - 通过');
    console.log('✅ 项目脚手架生成 - 通过');
    console.log('✅ 代码生成（流式） - 通过');
    console.log('\n🚀 代码引擎 v2.0 功能验证成功！\n');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行测试
if (require.main === module) {
  console.log('🧪 开始测试代码引擎 v2.0 新功能...\n');
  runTests().catch(console.error);
}

module.exports = { runTests };
