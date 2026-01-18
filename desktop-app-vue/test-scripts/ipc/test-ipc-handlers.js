/**
 * IPC Handlers 测试脚本
 * 测试 conversation 和 notification IPC handlers 是否正确注册
 */

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// 等待应用准备就绪
app.whenReady().then(async () => {
  console.log("\n========== IPC Handlers 测试 ==========\n");

  // 测试 conversation IPC handlers
  const conversationHandlers = [
    "conversation:get-by-project",
    "conversation:get-by-id",
    "conversation:create",
    "conversation:update",
    "conversation:delete",
    "conversation:create-message",
    "conversation:update-message",
    "conversation:get-messages",
    "conversation:chat-stream",
    "conversation:stream-pause",
    "conversation:stream-resume",
    "conversation:stream-cancel",
    "conversation:stream-stats",
    "conversation:stream-list",
    "conversation:stream-cleanup",
    "conversation:stream-manager-stats",
  ];

  // 测试 sync IPC handlers
  const syncHandlers = [
    "sync:start",
    "sync:stop",
    "sync:get-status",
    "sync:get-config",
  ];

  // 测试 notification IPC handlers
  const notificationHandlers = [
    "notification:get-all",
    "notification:get-unread-count",
    "notification:mark-as-read",
    "notification:mark-all-as-read",
    "notification:delete",
  ];

  console.log("📋 测试 Conversation IPC Handlers:");
  let conversationPassed = 0;
  conversationHandlers.forEach((handler) => {
    const listeners = ipcMain.listenerCount(handler);
    const status = listeners > 0 ? "✅" : "❌";
    console.log(`  ${status} ${handler} (${listeners} listeners)`);
    if (listeners > 0) conversationPassed++;
  });
  console.log(
    `  结果: ${conversationPassed}/${conversationHandlers.length} 通过\n`,
  );

  console.log("📋 测试 Sync IPC Handlers:");
  let syncPassed = 0;
  syncHandlers.forEach((handler) => {
    const listeners = ipcMain.listenerCount(handler);
    const status = listeners > 0 ? "✅" : "❌";
    console.log(`  ${status} ${handler} (${listeners} listeners)`);
    if (listeners > 0) syncPassed++;
  });
  console.log(`  结果: ${syncPassed}/${syncHandlers.length} 通过\n`);

  console.log("📋 测试 Notification IPC Handlers:");
  let notificationPassed = 0;
  notificationHandlers.forEach((handler) => {
    const listeners = ipcMain.listenerCount(handler);
    const status = listeners > 0 ? "✅" : "❌";
    console.log(`  ${status} ${handler} (${listeners} listeners)`);
    if (listeners > 0) notificationPassed++;
  });
  console.log(
    `  结果: ${notificationPassed}/${notificationHandlers.length} 通过\n`,
  );

  // 总结
  const totalHandlers =
    conversationHandlers.length +
    syncHandlers.length +
    notificationHandlers.length;
  const totalPassed = conversationPassed + syncPassed + notificationPassed;

  console.log("========== 测试总结 ==========");
  console.log(`总计: ${totalPassed}/${totalHandlers} handlers 已注册`);
  console.log(`成功率: ${((totalPassed / totalHandlers) * 100).toFixed(1)}%`);

  if (totalPassed === totalHandlers) {
    console.log("\n🎉 所有 IPC handlers 都已正确注册！\n");
  } else {
    console.log("\n⚠️  部分 IPC handlers 未注册，请检查日志。\n");
  }

  // 退出应用
  setTimeout(() => {
    app.quit();
  }, 1000);
});

app.on("window-all-closed", () => {
  app.quit();
});
