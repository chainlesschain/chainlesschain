#!/usr/bin/env node

/**
 * 快速 IPC 状态检查脚本
 * 通过分析应用日志来验证 IPC handlers 注册状态
 */

const fs = require("fs");
const path = require("path");

// 日志文件路径
const LOG_FILE =
  "/tmp/claude/-Users-mac-Documents-code2-chainlesschain/tasks/bc75c13.output";

// 需要检查的 IPC 模块
const IPC_MODULES = [
  "Conversation IPC",
  "Sync IPC",
  "Notification IPC",
  "Speech IPC",
  "LLM IPC",
  "Database IPC",
  "Git IPC",
  "Project Core IPC",
  "File IPC",
];

/**
 * 分析日志文件
 */
function analyzeLogs() {
  console.log("\n" + "=".repeat(60));
  console.log("IPC 注册状态分析");
  console.log("=".repeat(60) + "\n");

  if (!fs.existsSync(LOG_FILE)) {
    console.log("❌ 日志文件不存在:", LOG_FILE);
    console.log("请确保应用正在运行。\n");
    return;
  }

  const logContent = fs.readFileSync(LOG_FILE, "utf-8");
  const lines = logContent.split("\n");

  const results = {
    registered: [],
    failed: [],
    skipped: [],
    notFound: [],
  };

  // 检查每个模块
  IPC_MODULES.forEach((module) => {
    const registeredPattern = new RegExp(
      `\\[IPC Registry\\].*✓.*${module}.*registered`,
      "i",
    );
    const failedPattern = new RegExp(`\\[IPC Registry\\].*❌.*${module}`, "i");
    const skippedPattern = new RegExp(
      `\\[IPC Registry\\].*⚠️.*${module}.*skipped`,
      "i",
    );

    let found = false;

    for (const line of lines) {
      if (registeredPattern.test(line)) {
        // 提取 handler 数量
        const match = line.match(/\((\d+)\s+handlers?\)/);
        const count = match ? match[1] : "?";
        results.registered.push({ module, count, line: line.trim() });
        found = true;
        break;
      } else if (failedPattern.test(line)) {
        results.failed.push({ module, line: line.trim() });
        found = true;
        break;
      } else if (skippedPattern.test(line)) {
        results.skipped.push({ module, line: line.trim() });
        found = true;
        break;
      }
    }

    if (!found) {
      results.notFound.push(module);
    }
  });

  // 打印结果
  if (results.registered.length > 0) {
    console.log("✅ 已注册的模块:");
    results.registered.forEach(({ module, count }) => {
      console.log(`  ✅ ${module} (${count} handlers)`);
    });
    console.log("");
  }

  if (results.skipped.length > 0) {
    console.log("⚠️  跳过的模块:");
    results.skipped.forEach(({ module }) => {
      console.log(`  ⚠️  ${module}`);
    });
    console.log("");
  }

  if (results.failed.length > 0) {
    console.log("❌ 注册失败的模块:");
    results.failed.forEach(({ module, line }) => {
      console.log(`  ❌ ${module}`);
      console.log(`     ${line}`);
    });
    console.log("");
  }

  if (results.notFound.length > 0) {
    console.log("❓ 未找到注册信息的模块:");
    results.notFound.forEach((module) => {
      console.log(`  ❓ ${module}`);
    });
    console.log("");
  }

  // 总结
  console.log("=".repeat(60));
  console.log("总结");
  console.log("=".repeat(60));
  console.log(`已注册: ${results.registered.length}/${IPC_MODULES.length}`);
  console.log(`跳过: ${results.skipped.length}`);
  console.log(`失败: ${results.failed.length}`);
  console.log(`未找到: ${results.notFound.length}`);

  const totalHandlers = results.registered.reduce((sum, { count }) => {
    return sum + (parseInt(count) || 0);
  }, 0);
  console.log(`总 handlers: ${totalHandlers}`);

  if (results.failed.length === 0 && results.notFound.length === 0) {
    console.log("\n🎉 所有模块都已正确注册或跳过！\n");
  } else {
    console.log("\n⚠️  部分模块存在问题，请检查日志。\n");
  }

  // 检查关键模块
  const criticalModules = ["Conversation IPC", "Sync IPC", "Notification IPC"];
  const criticalRegistered = results.registered.filter((r) =>
    criticalModules.includes(r.module),
  );

  console.log("关键模块状态:");
  criticalModules.forEach((module) => {
    const registered = criticalRegistered.find((r) => r.module === module);
    if (registered) {
      console.log(`  ✅ ${module} (${registered.count} handlers)`);
    } else {
      const failed = results.failed.find((r) => r.module === module);
      const skipped = results.skipped.find((r) => r.module === module);
      const notFound = results.notFound.includes(module);

      if (failed) {
        console.log(`  ❌ ${module} - 注册失败`);
      } else if (skipped) {
        console.log(`  ⚠️  ${module} - 已跳过`);
      } else if (notFound) {
        console.log(`  ❓ ${module} - 未找到注册信息`);
      }
    }
  });

  console.log("");

  return results;
}

// 运行分析
if (require.main === module) {
  analyzeLogs();
}

module.exports = { analyzeLogs };
