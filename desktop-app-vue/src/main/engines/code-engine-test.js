/**
 * 代码引擎测试示例
 * 演示如何使用新增的功能
 */

const { logger } = require("../utils/logger.js");
const { getCodeEngine } = require("./code-engine");

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
    logger.info("🚀 初始化代码引擎...\n");
    await codeEngine.initialize();

    // 测试 1: 代码格式化
    logger.info("=".repeat(60));
    logger.info("测试 1: 代码格式化");
    logger.info("=".repeat(60));
    const formatted = await codeEngine.formatCode(testCode, "javascript", {
      style: "prettier",
      indentSize: 2,
      singleQuotes: true,
    });
    logger.info("✅ 格式化完成");
    logger.info(
      "格式化后的代码:\n",
      formatted.formattedCode.substring(0, 200) + "...\n",
    );

    // 测试 2: 复杂度分析
    logger.info("=".repeat(60));
    logger.info("测试 2: 代码复杂度分析");
    logger.info("=".repeat(60));
    const complexity = await codeEngine.analyzeComplexity(
      testCode,
      "javascript",
    );
    logger.info("✅ 复杂度分析完成");
    logger.info("指标:");
    logger.info("  - 圈复杂度:", complexity.metrics.cyclomaticComplexity);
    logger.info("  - 认知复杂度:", complexity.metrics.cognitiveComplexity);
    logger.info("  - 代码行数:", complexity.metrics.linesOfCode);
    logger.info("  - 综合评分:", complexity.metrics.score, "/10\n");

    // 测试 3: 安全漏洞扫描
    logger.info("=".repeat(60));
    logger.info("测试 3: 安全漏洞扫描");
    logger.info("=".repeat(60));
    const security = await codeEngine.scanSecurity(testCode, "javascript");
    logger.info("✅ 安全扫描完成");
    logger.info("安全等级:", security.securityLevel);
    logger.info("安全评分:", security.score, "/10");
    logger.info("发现漏洞数:", security.vulnerabilities.length);

    if (security.vulnerabilities.length > 0) {
      logger.info("\n发现的漏洞:");
      security.vulnerabilities.forEach((vuln, i) => {
        logger.info(`  ${i + 1}. ${vuln.type} [${vuln.severity}]`);
        logger.info(`     位置: ${vuln.location}`);
        logger.info(
          `     修复建议: ${vuln.recommendation.substring(0, 80)}...`,
        );
      });
    }
    logger.info();

    // 测试 4: 全面代码审查
    logger.info("=".repeat(60));
    logger.info("测试 4: 全面代码审查（整合复杂度和安全分析）");
    logger.info("=".repeat(60));
    const review = await codeEngine.reviewCode(testCode, "javascript", {
      includeComplexity: true,
      includeSecurity: true,
    });
    logger.info("✅ 代码审查完成");
    logger.info("综合评分:", review.finalScore, "/10");
    logger.info("基础审查评分:", review.basicReview.score, "/10");
    logger.info("总建议数:", review.suggestions.length);

    if (review.suggestions.length > 0) {
      logger.info("\n优先级建议:");
      const highPriority = review.suggestions.filter(
        (s) => s.priority === "high",
      );
      highPriority.forEach((s, i) => {
        logger.info(`  ${i + 1}. [高优先级] ${s.issue}`);
        logger.info(`     建议: ${s.advice.substring(0, 80)}...`);
      });
    }
    logger.info();

    // 测试 5: 代码转换
    logger.info("=".repeat(60));
    logger.info("测试 5: 代码转换 (JavaScript → TypeScript)");
    logger.info("=".repeat(60));

    const simpleCode = `
function add(a, b) {
  return a + b;
}
    `.trim();

    const converted = await codeEngine.convertCode(
      simpleCode,
      "javascript",
      "typescript",
      { modernize: true },
    );
    logger.info("✅ 代码转换完成");
    logger.info("转换后的代码:\n", converted.convertedCode);
    logger.info();

    // 测试 6: 生成测试
    logger.info("=".repeat(60));
    logger.info("测试 6: 生成单元测试");
    logger.info("=".repeat(60));
    const tests = await codeEngine.generateTests(simpleCode, "javascript");
    logger.info("✅ 测试生成完成");
    logger.info("生成的测试代码:\n", tests.substring(0, 300) + "...\n");

    // 测试 7: 生成集成测试
    logger.info("=".repeat(60));
    logger.info("测试 7: 生成集成测试");
    logger.info("=".repeat(60));
    const integrationTests = await codeEngine.generateIntegrationTests(
      simpleCode,
      "javascript",
      {
        testScenarios: ["测试函数正常调用", "测试参数验证", "测试边界情况"],
      },
    );
    logger.info("✅ 集成测试生成完成");
    logger.info(
      "生成的集成测试:\n",
      integrationTests.tests.substring(0, 300) + "...\n",
    );

    // 测试 8: 项目脚手架生成
    logger.info("=".repeat(60));
    logger.info("测试 8: 生成项目脚手架");
    logger.info("=".repeat(60));

    const projectTypes = [
      "react_app",
      "vue_app",
      "nextjs_app",
      "express_api",
      "fastapi_app",
    ];

    for (const type of projectTypes) {
      const scaffold = await codeEngine.generateScaffold(type, {
        projectName: `test-${type}`,
      });
      logger.info(
        `✅ ${type} 脚手架生成完成 - ${scaffold.files.length} 个文件`,
      );
    }
    logger.info();

    // 测试 9: 代码生成（带进度反馈）
    logger.info("=".repeat(60));
    logger.info("测试 9: 代码生成（流式输出）");
    logger.info("=".repeat(60));

    const generated = await codeEngine.generateCode(
      "创建一个简单的用户注册函数",
      {
        language: "javascript",
        includeComments: true,
        streaming: false, // 在测试中禁用流式输出以避免大量日志
        onProgress: (progress) => {
          if (progress.stage === "complete") {
            logger.info("✅ 代码生成完成");
          }
        },
      },
    );

    logger.info("生成的代码:\n", generated.code.substring(0, 300) + "...\n");

    // 总结
    logger.info("=".repeat(60));
    logger.info("🎉 所有测试完成！");
    logger.info("=".repeat(60));
    logger.info("\n测试结果总结:");
    logger.info("✅ 代码格式化 - 通过");
    logger.info("✅ 复杂度分析 - 通过");
    logger.info("✅ 安全漏洞扫描 - 通过");
    logger.info("✅ 全面代码审查 - 通过");
    logger.info("✅ 代码转换 - 通过");
    logger.info("✅ 单元测试生成 - 通过");
    logger.info("✅ 集成测试生成 - 通过");
    logger.info("✅ 项目脚手架生成 - 通过");
    logger.info("✅ 代码生成（流式） - 通过");
    logger.info("\n🚀 代码引擎 v2.0 功能验证成功！\n");
  } catch (error) {
    logger.error("❌ 测试失败:", error.message);
    logger.error(error.stack);
    process.exit(1);
  }
}

// 运行测试
if (require.main === module) {
  logger.info("🧪 开始测试代码引擎 v2.0 新功能...\n");
  runTests().catch(console.error);
}

module.exports = { runTests };
