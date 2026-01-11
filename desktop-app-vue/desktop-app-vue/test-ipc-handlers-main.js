#!/usr/bin/env node

/**
 * IPC Handlers 自动化测试脚本
 * 在主进程启动后验证所有关键 IPC handlers 是否正确注册
 *
 * 使用方法:
 *   node test-ipc-handlers-main.js
 */

const { app, ipcMain } = require('electron');
const path = require('path');

// 定义需要测试的 IPC handlers
const HANDLERS_TO_TEST = {
  'Conversation IPC': [
    'conversation:get-by-project',
    'conversation:get-by-id',
    'conversation:create',
    'conversation:update',
    'conversation:delete',
    'conversation:create-message',
    'conversation:update-message',
    'conversation:get-messages',
    'conversation:chat-stream',
    'conversation:stream-pause',
    'conversation:stream-resume',
    'conversation:stream-cancel',
    'conversation:stream-stats',
    'conversation:stream-list',
    'conversation:stream-cleanup',
    'conversation:stream-manager-stats'
  ],
  'Sync IPC': [
    'sync:start',
    'sync:stop',
    'sync:get-status',
    'sync:get-config'
  ],
  'Notification IPC': [
    'notification:get-all',
    'notification:get-unread-count',
    'notification:mark-as-read',
    'notification:mark-all-as-read',
    'notification:delete'
  ],
  'Speech IPC': [
    'speech:transcribe-file',
    'speech:transcribe-stream',
    'speech:get-languages',
    'speech:set-language'
  ]
};

/**
 * 检查 IPC handler 是否已注册
 */
function isHandlerRegistered(channel) {
  try {
    // 检查 ipcMain 的内部事件监听器
    const listeners = ipcMain.listenerCount(channel);
    return listeners > 0;
  } catch (error) {
    console.error(`检查 ${channel} 时出错:`, error.message);
    return false;
  }
}

/**
 * 运行测试
 */
function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('IPC Handlers 注册验证测试');
  console.log('='.repeat(60) + '\n');

  const results = {};
  let totalHandlers = 0;
  let registeredHandlers = 0;
  let failedCategories = [];

  // 测试每个分类
  for (const [category, handlers] of Object.entries(HANDLERS_TO_TEST)) {
    console.log(`📋 ${category}:`);
    results[category] = {
      total: handlers.length,
      registered: 0,
      failed: []
    };

    handlers.forEach(handler => {
      totalHandlers++;
      const isRegistered = isHandlerRegistered(handler);

      if (isRegistered) {
        const listenerCount = ipcMain.listenerCount(handler);
        console.log(`  ✅ ${handler} (${listenerCount} listener${listenerCount > 1 ? 's' : ''})`);
        registeredHandlers++;
        results[category].registered++;
      } else {
        console.log(`  ❌ ${handler} - NOT REGISTERED`);
        results[category].failed.push(handler);
      }
    });

    const categorySuccess = results[category].registered === results[category].total;
    const percentage = ((results[category].registered / results[category].total) * 100).toFixed(1);

    console.log(`  结果: ${results[category].registered}/${results[category].total} (${percentage}%) ${categorySuccess ? '✅' : '❌'}\n`);

    if (!categorySuccess) {
      failedCategories.push(category);
    }
  }

  // 总结
  console.log('='.repeat(60));
  console.log('测试总结');
  console.log('='.repeat(60));
  console.log(`总计: ${registeredHandlers}/${totalHandlers} handlers 已注册`);
  console.log(`成功率: ${((registeredHandlers / totalHandlers) * 100).toFixed(1)}%`);

  if (registeredHandlers === totalHandlers) {
    console.log('\n🎉 所有 IPC handlers 都已正确注册！\n');
    return { success: true, results };
  } else {
    console.log(`\n⚠️  ${totalHandlers - registeredHandlers} 个 handlers 未注册\n`);

    // 列出失败的分类
    if (failedCategories.length > 0) {
      console.log('失败的分类:');
      failedCategories.forEach(category => {
        console.log(`\n${category}:`);
        results[category].failed.forEach(handler => {
          console.log(`  - ${handler}`);
        });
      });
      console.log('');
    }

    return { success: false, results, failedCategories };
  }
}

/**
 * 获取所有已注册的 IPC handlers
 */
function getAllRegisteredHandlers() {
  const allHandlers = [];

  // 获取所有可能的 handler 名称
  const allPossibleHandlers = Object.values(HANDLERS_TO_TEST).flat();

  // 检查每个 handler
  allPossibleHandlers.forEach(handler => {
    if (isHandlerRegistered(handler)) {
      allHandlers.push({
        channel: handler,
        listenerCount: ipcMain.listenerCount(handler)
      });
    }
  });

  return allHandlers;
}

/**
 * 打印所有已注册的 handlers
 */
function printAllRegisteredHandlers() {
  console.log('\n' + '='.repeat(60));
  console.log('所有已注册的 IPC Handlers');
  console.log('='.repeat(60) + '\n');

  const handlers = getAllRegisteredHandlers();

  if (handlers.length === 0) {
    console.log('⚠️  没有找到任何已注册的 handlers\n');
    return;
  }

  handlers.forEach(({ channel, listenerCount }) => {
    console.log(`  ✅ ${channel} (${listenerCount} listener${listenerCount > 1 ? 's' : ''})`);
  });

  console.log(`\n总计: ${handlers.length} 个 handlers 已注册\n`);
}

// 主函数
async function main() {
  console.log('等待 Electron 应用准备就绪...\n');

  // 等待应用准备就绪
  await app.whenReady();

  // 等待一小段时间确保所有 IPC 都已注册
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 运行测试
  const testResults = runTests();

  // 打印所有已注册的 handlers（可选）
  // printAllRegisteredHandlers();

  // 退出
  setTimeout(() => {
    const exitCode = testResults.success ? 0 : 1;
    console.log(`退出代码: ${exitCode}\n`);
    app.quit();
    process.exit(exitCode);
  }, 1000);
}

// 处理应用事件
app.on('window-all-closed', () => {
  // 不做任何事，让测试完成
});

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(error => {
    console.error('测试失败:', error);
    process.exit(1);
  });
}

module.exports = {
  runTests,
  isHandlerRegistered,
  getAllRegisteredHandlers,
  printAllRegisteredHandlers
};
