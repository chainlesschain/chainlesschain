#!/usr/bin/env node

/**
 * 调试E2E测试 - 运行单个测试并显示详细错误
 */

const { execSync } = require("child_process");
const path = require("path");

console.log("=".repeat(80));
console.log("E2E测试调试");
console.log("=".repeat(80));
console.log("");

const testPath = "tests/e2e/settings/general-settings.e2e.test.ts";
const cwd = path.join(__dirname, "..", "..");

console.log(`测试文件: ${testPath}`);
console.log(`工作目录: ${cwd}`);
console.log("");
console.log("开始运行测试...");
console.log("-".repeat(80));

try {
  const output = execSync(
    `npx playwright test ${testPath} --timeout=120000 --reporter=list`,
    {
      encoding: "utf8",
      stdio: "inherit", // 直接输出到控制台
      timeout: 180000,
      cwd: cwd,
    },
  );

  console.log("");
  console.log("=".repeat(80));
  console.log("✅ 测试通过");
  console.log("=".repeat(80));
} catch (error) {
  console.log("");
  console.log("=".repeat(80));
  console.log("❌ 测试失败");
  console.log("=".repeat(80));
  console.log("");
  console.log("错误信息:");
  console.log(error.message);

  if (error.stdout) {
    console.log("");
    console.log("标准输出:");
    console.log(error.stdout.toString());
  }

  if (error.stderr) {
    console.log("");
    console.log("标准错误:");
    console.log(error.stderr.toString());
  }

  process.exit(1);
}
