#!/usr/bin/env node

/**
 * Workflow Optimizations E2E测试运行脚本
 *
 * 使用方式:
 *   node scripts/test-workflow-e2e.js
 *   或
 *   npm run test:workflow-e2e
 */

const { spawn } = require("child_process");
const path = require("path");
const chalk = require("chalk");

console.log(
  chalk.bold.cyan(
    "\n╔════════════════════════════════════════════════════════╗",
  ),
);
console.log(
  chalk.bold.cyan("║   Workflow Optimizations E2E 测试套件                 ║"),
);
console.log(
  chalk.bold.cyan(
    "╚════════════════════════════════════════════════════════╝\n",
  ),
);

console.log(chalk.yellow("📋 测试范围:"));
console.log("  1. 项目配置初始化");
console.log("  2. AI引擎管理器初始化");
console.log("  3. 智能计划缓存");
console.log("  4. LLM决策引擎");
console.log("  5. 代理池管理");
console.log("  6. 关键路径优化");
console.log("  7. 统计数据收集");
console.log("  8. IPC通信集成");
console.log("  9. 性能验证");
console.log("  10. 压力测试\n");

console.log(chalk.blue("🚀 启动测试...\n"));

// 运行测试
const testFile = path.join(
  __dirname,
  "../tests/integration/workflow-optimizations-e2e.test.js",
);

const testProcess = spawn(
  "npx",
  ["vitest", "run", testFile, "--reporter=verbose"],
  {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    shell: true,
  },
);

testProcess.on("close", (code) => {
  console.log("\n");
  if (code === 0) {
    console.log(chalk.bold.green("✅ 所有测试通过！"));
    console.log(chalk.green("\n工作流优化系统已完全集成并正常运行。"));
    console.log(chalk.gray("\n下一步:"));
    console.log(chalk.gray("  • 启动应用: npm run dev"));
    console.log(chalk.gray("  • 访问仪表板: #/workflow/optimizations"));
    console.log(chalk.gray("  • 查看实时统计数据\n"));
  } else {
    console.log(chalk.bold.red(`❌ 测试失败 (退出码: ${code})`));
    console.log(chalk.yellow("\n请检查上述错误信息并修复问题。\n"));
    process.exit(code);
  }
});

testProcess.on("error", (error) => {
  console.error(chalk.red("❌ 启动测试失败:"), error.message);
  console.log(chalk.yellow("\n请确保已安装所有依赖: npm install\n"));
  process.exit(1);
});
