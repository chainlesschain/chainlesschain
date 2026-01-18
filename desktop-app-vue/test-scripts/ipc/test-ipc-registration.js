/**
 * IPC Handlers 注册验证脚本
 * 用于测试关键 IPC handlers 是否正确注册
 */

const { ipcRenderer } = require("electron");

// 定义需要测试的 IPC handlers
const handlersToTest = {
  conversation: [
    "conversation:get-by-project",
    "conversation:get-by-id",
    "conversation:create",
    "conversation:update",
    "conversation:delete",
    "conversation:create-message",
    "conversation:update-message",
    "conversation:get-messages",
    "conversation:chat-stream",
  ],
  sync: ["sync:start", "sync:stop", "sync:get-status", "sync:get-config"],
  notification: [
    "notification:get-all",
    "notification:get-unread-count",
    "notification:mark-as-read",
    "notification:mark-all-as-read",
    "notification:delete",
  ],
};

/**
 * 测试单个 IPC handler 是否可用
 */
async function testHandler(channel) {
  try {
    // 尝试调用 handler（使用无效参数，只是测试是否注册）
    await ipcRenderer.invoke(channel, null);
    return { success: true, error: null };
  } catch (error) {
    // 如果错误不是 "No handler registered"，说明 handler 已注册
    if (!error.message.includes("No handler registered")) {
      return { success: true, error: null };
    }
    return { success: false, error: error.message };
  }
}

/**
 * 运行所有测试
 */
async function runTests() {
  console.log("\n========== IPC Handlers 注册验证 ==========\n");

  const results = {};
  let totalHandlers = 0;
  let registeredHandlers = 0;

  for (const [category, handlers] of Object.entries(handlersToTest)) {
    console.log(`📋 测试 ${category.toUpperCase()} IPC Handlers:`);
    results[category] = [];

    for (const handler of handlers) {
      totalHandlers++;
      const result = await testHandler(handler);

      if (result.success) {
        console.log(`  ✅ ${handler}`);
        registeredHandlers++;
        results[category].push({ handler, registered: true });
      } else {
        console.log(`  ❌ ${handler} - ${result.error}`);
        results[category].push({
          handler,
          registered: false,
          error: result.error,
        });
      }
    }

    const categoryRegistered = results[category].filter(
      (r) => r.registered,
    ).length;
    console.log(`  结果: ${categoryRegistered}/${handlers.length} 已注册\n`);
  }

  // 总结
  console.log("========== 测试总结 ==========");
  console.log(`总计: ${registeredHandlers}/${totalHandlers} handlers 已注册`);
  console.log(
    `成功率: ${((registeredHandlers / totalHandlers) * 100).toFixed(1)}%`,
  );

  if (registeredHandlers === totalHandlers) {
    console.log("\n🎉 所有关键 IPC handlers 都已正确注册！\n");
  } else {
    console.log("\n⚠️  部分 IPC handlers 未注册，请检查日志。\n");

    // 列出未注册的 handlers
    console.log("未注册的 handlers:");
    for (const [category, categoryResults] of Object.entries(results)) {
      const unregistered = categoryResults.filter((r) => !r.registered);
      if (unregistered.length > 0) {
        console.log(`\n${category.toUpperCase()}:`);
        unregistered.forEach((r) => {
          console.log(`  - ${r.handler}`);
        });
      }
    }
  }

  return results;
}

// 如果在渲染进程中运行
if (typeof window !== "undefined") {
  window.testIPCRegistration = runTests;
  console.log("IPC 测试函数已加载。在控制台运行: testIPCRegistration()");
}

// 如果直接运行
if (require.main === module) {
  runTests()
    .then(() => {
      console.log("\n测试完成。");
    })
    .catch((error) => {
      console.error("测试失败:", error);
    });
}

module.exports = { runTests, testHandler };
