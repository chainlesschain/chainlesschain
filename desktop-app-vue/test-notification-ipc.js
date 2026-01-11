#!/usr/bin/env node

/**
 * 测试notification IPC是否正确注册
 */

console.log('测试 Notification IPC 注册');
console.log('='.repeat(60));

// 模拟IPC注册
const { ipcMain } = require('electron');

// 检查是否有notification:get-all处理器
const handlers = ipcMain._events || {};
console.log('当前注册的IPC处理器:');
console.log(Object.keys(handlers));

// 查找notification相关的处理器
const notificationHandlers = Object.keys(handlers).filter(key =>
  key.includes('notification')
);

console.log('\nNotification相关处理器:');
if (notificationHandlers.length > 0) {
  notificationHandlers.forEach(handler => {
    console.log(`  ✓ ${handler}`);
  });
} else {
  console.log('  ✗ 未找到notification处理器');
}

// 测试注册
console.log('\n测试注册notification:get-all...');
try {
  const { registerNotificationIPC } = require('./src/main/notification/notification-ipc');

  // 模拟数据库对象
  const mockDatabase = {
    db: {
      prepare: (query) => ({
        all: (...params) => {
          console.log('  执行查询:', query);
          console.log('  参数:', params);
          return [];
        }
      })
    }
  };

  registerNotificationIPC({ database: mockDatabase });
  console.log('  ✓ 注册成功');

  // 再次检查
  const handlersAfter = ipcMain._events || {};
  const notificationHandlersAfter = Object.keys(handlersAfter).filter(key =>
    key.includes('notification')
  );

  console.log('\n注册后的Notification处理器:');
  notificationHandlersAfter.forEach(handler => {
    console.log(`  ✓ ${handler}`);
  });

} catch (error) {
  console.error('  ✗ 注册失败:', error.message);
}

console.log('\n' + '='.repeat(60));
