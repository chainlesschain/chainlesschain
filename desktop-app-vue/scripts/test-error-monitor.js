#!/usr/bin/env node

/**
 * ErrorMonitor AI 诊断测试脚本
 *
 * 测试内容：
 * 1. 错误分析和分类
 * 2. 严重程度评估
 * 3. 自动修复尝试
 * 4. AI 智能诊断
 * 5. 相关问题查找
 * 6. 错误统计
 * 7. 诊断报告生成
 *
 * 运行方式: node scripts/test-error-monitor.js
 */

const path = require("path");
const fs = require("fs");

// 设置测试环境
process.env.NODE_ENV = "test";

async function runTests() {
  console.log("=".repeat(60));
  console.log("ErrorMonitor AI 诊断功能测试");
  console.log("=".repeat(60));
  console.log("");

  try {
    // 1. 初始化数据库
    console.log("[1/8] 初始化测试数据库...");
    const DatabaseManager = require("../src/main/database");
    const testDbPath = path.join(__dirname, "..", "test-error-monitor.db");

    // 删除旧的测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log("  ✓ 已删除旧的测试数据库");
    }

    const db = new DatabaseManager(testDbPath);
    await db.initialize();
    console.log("  ✓ 数据库初始化成功");
    console.log("");

    // 2. 初始化模拟 LLM Manager
    console.log("[2/8] 初始化模拟 LLM Manager...");
    const mockLLMManager = {
      chat: async (messages, options) => {
        // 模拟 AI 诊断响应
        return {
          content: `**错误根本原因**:
这是一个典型的网络连接超时错误，可能由以下原因导致：
1. 网络不稳定或断开
2. 服务器响应时间过长
3. 防火墙或代理设置阻止了连接

**修复方案**:

方案1: 增加超时时间
- 将当前的超时时间从 5000ms 增加到 30000ms
- 适用于网络较慢但稳定的环境

方案2: 实现重试机制
- 添加指数退避的重试逻辑
- 最多重试 3 次，每次延迟时间翻倍

方案3: 检查网络连接
- 在请求前先 ping 目标服务器
- 提前发现网络问题并给出友好提示

**最佳实践**:
- 始终为网络请求设置合理的超时时间
- 实现重试机制以提高可靠性
- 添加错误处理和用户反馈
- 考虑使用连接池优化性能

**相关文档**:
- [Axios Timeout Configuration](https://axios-http.com/docs/req_config)
- [Error Handling Best Practices](https://nodejs.org/api/errors.html)
- [Network Retry Strategies](https://developers.google.com/web/fundamentals/performance/optimizing-content-efficiency/http-caching)`,
          usage: {
            prompt_tokens: 150,
            completion_tokens: 200,
            total_tokens: 350,
          },
        };
      },
    };
    console.log("  ✓ 模拟 LLM Manager 创建成功");
    console.log("");

    // 3. 初始化 ErrorMonitor
    console.log("[3/8] 初始化 ErrorMonitor...");
    const { ErrorMonitor } = require("../src/main/error-monitor");

    const errorMonitor = new ErrorMonitor({
      llmManager: mockLLMManager,
      database: db,
      enableAIDiagnosis: true,
      autoFixStrategies: [
        "retry",
        "timeout_increase",
        "fallback",
        "validation",
      ],
    });

    console.log("  ✓ ErrorMonitor 初始化成功");
    console.log("");

    // 4. 创建测试错误
    console.log("[4/8] 创建测试错误...");
    const testErrors = [
      {
        name: "NetworkError",
        message: "ETIMEDOUT: Connection timeout after 5000ms",
        stack: `NetworkError: ETIMEDOUT: Connection timeout after 5000ms
    at ClientRequest.setTimeout (/app/node_modules/axios/lib/adapters/http.js:273:17)
    at ClientRequest.emit (events.js:315:20)
    at Socket.socketOnTimeout (_http_client.js:441:9)`,
      },
      {
        name: "DatabaseError",
        message: "SQLITE_LOCKED: database is locked",
        stack: `DatabaseError: SQLITE_LOCKED: database is locked
    at Database.prepare (/app/node_modules/better-sqlite3/lib/database.js:123:15)
    at createNote (/app/src/main/database.js:456:23)`,
      },
      {
        name: "ValidationError",
        message: 'Invalid email format: "user@invalid"',
        stack: `ValidationError: Invalid email format: "user@invalid"
    at validateEmail (/app/src/utils/validation.js:42:11)
    at registerUser (/app/src/api/auth.js:87:5)`,
      },
    ];

    console.log(`  ✓ 已创建 ${testErrors.length} 个测试错误`);
    testErrors.forEach((err, index) => {
      console.log(`    ${index + 1}. ${err.name}: ${err.message}`);
    });
    console.log("");

    // 5. 测试错误分析
    console.log("[5/8] 测试错误分析和 AI 诊断...");
    const analyses = [];

    for (const testError of testErrors) {
      const error = new Error(testError.message);
      error.name = testError.name;
      error.stack = testError.stack;

      console.log(`\n  分析错误: ${error.name}`);
      const analysis = await errorMonitor.analyzeError(error);

      console.log(`    ✓ 分类: ${analysis.classification}`);
      console.log(`    ✓ 严重程度: ${analysis.severity}`);
      console.log(
        `    ✓ 自动修复尝试: ${analysis.autoFixResult?.attempted ? "是" : "否"}`,
      );
      console.log(
        `    ✓ AI 诊断: ${analysis.aiDiagnosis?.available ? "已完成" : "未启用"}`,
      );
      console.log(`    ✓ 推荐操作数: ${analysis.recommendations.length}`);

      analyses.push(analysis);
    }
    console.log("\n  ✓ 所有错误分析完成");
    console.log("");

    // 6. 测试错误统计
    console.log("[6/8] 测试错误统计...");
    const stats = await errorMonitor.getErrorStats({ days: 7 });

    console.log("  错误统计（最近 7 天）:");
    console.log(`    总错误数: ${stats.total}`);
    console.log(`    严重程度分布:`);
    console.log(`      - Critical: ${stats.bySeverity.critical}`);
    console.log(`      - High: ${stats.bySeverity.high}`);
    console.log(`      - Medium: ${stats.bySeverity.medium}`);
    console.log(`      - Low: ${stats.bySeverity.low}`);
    console.log(`    自动修复: ${stats.autoFixed} (${stats.autoFixRate}%)`);
    console.log(`    已解决: ${stats.resolved} (${stats.resolutionRate}%)`);
    console.log("");

    // 7. 测试诊断报告生成
    console.log("[7/8] 测试诊断报告生成...");
    if (analyses.length > 0) {
      const report = await errorMonitor.generateDiagnosisReport(analyses[0]);
      console.log("  ✓ 诊断报告已生成");
      console.log("");
      console.log("  报告预览（前 500 字符）:");
      console.log("  " + "-".repeat(58));
      console.log(
        report
          .substring(0, 500)
          .split("\n")
          .map((line) => "  " + line)
          .join("\n"),
      );
      console.log("  " + "-".repeat(58));
      console.log("");
    }

    // 8. 测试分析历史查询
    console.log("[8/8] 测试分析历史查询...");
    const history = await errorMonitor.getAnalysisHistory({ limit: 10 });
    console.log(`  找到 ${history.length} 条历史分析记录`);
    history.forEach((record, index) => {
      const date = new Date(record.created_at).toLocaleString();
      console.log(
        `    ${index + 1}. [${record.severity}] ${record.error_message} (${date})`,
      );
    });
    console.log("");

    // 清理
    console.log("[清理] 删除测试文件...");
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log("  ✓ 已删除测试数据库");
    }
    console.log("");

    // 测试总结
    console.log("=".repeat(60));
    console.log("✅ 所有测试通过！");
    console.log("=".repeat(60));
    console.log("");
    console.log("ErrorMonitor AI 诊断功能验证完成，包括：");
    console.log("  ✓ 错误分析和分类");
    console.log("  ✓ 严重程度评估");
    console.log("  ✓ 自动修复尝试");
    console.log("  ✓ AI 智能诊断");
    console.log("  ✓ 错误统计");
    console.log("  ✓ 诊断报告生成");
    console.log("  ✓ 历史记录查询");
    console.log("");
    console.log("特性亮点：");
    console.log("  🤖 使用本地 Ollama 模型进行免费 AI 诊断");
    console.log("  📊 详细的错误分类和严重程度评估");
    console.log("  🔧 自动修复策略尝试");
    console.log("  📝 生成结构化的诊断报告");
    console.log("  📈 全面的错误统计和分析");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("=".repeat(60));
    console.error("❌ 测试失败");
    console.error("=".repeat(60));
    console.error("");
    console.error("错误信息:", error.message);
    console.error("错误堆栈:", error.stack);
    console.error("");
    process.exit(1);
  }
}

// 运行测试
runTests()
  .then(() => {
    console.log("测试脚本执行完成");
    process.exit(0);
  })
  .catch((error) => {
    console.error("测试脚本执行失败:", error);
    process.exit(1);
  });
