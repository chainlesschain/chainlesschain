#!/usr/bin/env node
/**
 * Message Aggregator Integration Test
 *
 * 验证消息批量聚合系统在实际环境中的工作情况
 *
 * Usage: node scripts/test-message-aggregator.js
 */

const path = require('path');

// 设置模块路径
const srcPath = path.join(__dirname, '..', 'src', 'main');

console.log('═'.repeat(60));
console.log('  Message Aggregator Integration Test');
console.log('═'.repeat(60));
console.log();

async function runTests() {
  const results = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  function test(name, fn) {
    return async () => {
      try {
        await fn();
        results.passed++;
        results.tests.push({ name, status: 'passed' });
        console.log(`  ✓ ${name}`);
      } catch (error) {
        results.failed++;
        results.tests.push({ name, status: 'failed', error: error.message });
        console.log(`  ✗ ${name}`);
        console.log(`    Error: ${error.message}`);
      }
    };
  }

  // ==================== Test Cases ====================

  console.log('1. MessageAggregator Core Tests');
  console.log('-'.repeat(40));

  await test('Should create MessageAggregator instance', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));
    const aggregator = new MessageAggregator();

    if (!aggregator) throw new Error('Failed to create instance');
    if (aggregator.batchInterval !== 100) {
      throw new Error(`Expected batchInterval 100, got ${aggregator.batchInterval}`);
    }
    if (aggregator.maxBatchSize !== 100) {
      throw new Error(`Expected maxBatchSize 100, got ${aggregator.maxBatchSize}`);
    }
  })();

  await test('Should accept custom options', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));
    const aggregator = new MessageAggregator({
      batchInterval: 200,
      maxBatchSize: 50,
    });

    if (aggregator.batchInterval !== 200) {
      throw new Error(`Expected batchInterval 200, got ${aggregator.batchInterval}`);
    }
    if (aggregator.maxBatchSize !== 50) {
      throw new Error(`Expected maxBatchSize 50, got ${aggregator.maxBatchSize}`);
    }
  })();

  console.log();
  console.log('2. Message Queue Tests');
  console.log('-'.repeat(40));

  await test('Should push messages to queue', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));
    const aggregator = new MessageAggregator({ batchInterval: 10000 }); // Long interval to prevent auto-flush

    aggregator.push('test-event', { data: 'test1' });
    aggregator.push('test-event', { data: 'test2' });

    if (aggregator.messageQueue.length !== 2) {
      throw new Error(`Expected 2 messages, got ${aggregator.messageQueue.length}`);
    }

    // Clean up timer
    if (aggregator.timer) {
      clearTimeout(aggregator.timer);
      aggregator.timer = null;
    }
  })();

  await test('Should track message statistics', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));
    const aggregator = new MessageAggregator({ batchInterval: 10000 });

    aggregator.push('event1', { data: 'test1' });
    aggregator.push('event2', { data: 'test2' });
    aggregator.push('event1', { data: 'test3' });

    if (aggregator.stats.totalMessages !== 3) {
      throw new Error(`Expected 3 total messages, got ${aggregator.stats.totalMessages}`);
    }

    // Clean up
    if (aggregator.timer) {
      clearTimeout(aggregator.timer);
      aggregator.timer = null;
    }
  })();

  await test('Should flush queue on max batch size', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));

    // Mock window to capture sent messages
    const sentMessages = [];
    const mockWindow = {
      isDestroyed: () => false,
      webContents: {
        send: (channel, data) => {
          sentMessages.push({ channel, data });
        },
      },
    };

    const aggregator = new MessageAggregator({
      window: mockWindow,
      batchInterval: 10000,
      maxBatchSize: 3, // Small max batch for testing
    });

    aggregator.push('test', { id: 1 });
    aggregator.push('test', { id: 2 });
    aggregator.push('test', { id: 3 }); // This should trigger flush

    // Queue should be empty after auto-flush
    if (aggregator.messageQueue.length !== 0) {
      throw new Error(`Queue should be empty, got ${aggregator.messageQueue.length}`);
    }

    if (sentMessages.length !== 1) {
      throw new Error(`Expected 1 batch sent, got ${sentMessages.length}`);
    }

    if (sentMessages[0].channel !== 'batch:test') {
      throw new Error(`Wrong channel: ${sentMessages[0].channel}`);
    }
  })();

  console.log();
  console.log('3. Flush Tests');
  console.log('-'.repeat(40));

  await test('Should flush messages immediately', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));

    const sentMessages = [];
    const mockWindow = {
      isDestroyed: () => false,
      webContents: {
        send: (channel, data) => {
          sentMessages.push({ channel, data });
        },
      },
    };

    const aggregator = new MessageAggregator({
      window: mockWindow,
      batchInterval: 10000,
    });

    aggregator.push('event-a', { data: 1 });
    aggregator.push('event-b', { data: 2 });
    aggregator.flushNow();

    if (aggregator.messageQueue.length !== 0) {
      throw new Error('Queue should be empty after flush');
    }

    if (sentMessages.length !== 2) {
      throw new Error(`Expected 2 batches (2 event types), got ${sentMessages.length}`);
    }
  })();

  await test('Should group messages by event type', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));

    const sentMessages = [];
    const mockWindow = {
      isDestroyed: () => false,
      webContents: {
        send: (channel, data) => {
          sentMessages.push({ channel, data });
        },
      },
    };

    const aggregator = new MessageAggregator({
      window: mockWindow,
      batchInterval: 10000,
    });

    aggregator.push('type-a', { id: 1 });
    aggregator.push('type-a', { id: 2 });
    aggregator.push('type-b', { id: 3 });
    aggregator.flushNow();

    // Should have 2 batches (type-a and type-b)
    if (sentMessages.length !== 2) {
      throw new Error(`Expected 2 batches, got ${sentMessages.length}`);
    }

    const typeA = sentMessages.find(m => m.channel === 'batch:type-a');
    const typeB = sentMessages.find(m => m.channel === 'batch:type-b');

    if (!typeA || typeA.data.length !== 2) {
      throw new Error('type-a batch should have 2 messages');
    }
    if (!typeB || typeB.data.length !== 1) {
      throw new Error('type-b batch should have 1 message');
    }
  })();

  await test('Should handle destroyed window gracefully', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));

    const mockWindow = {
      isDestroyed: () => true, // Window is destroyed
      webContents: {
        send: () => { throw new Error('Should not be called'); },
      },
    };

    const aggregator = new MessageAggregator({
      window: mockWindow,
      batchInterval: 10000,
    });

    aggregator.push('test', { data: 1 });
    aggregator.flushNow();

    // Queue should be cleared without error
    if (aggregator.messageQueue.length !== 0) {
      throw new Error('Queue should be empty');
    }
  })();

  console.log();
  console.log('4. Statistics Tests');
  console.log('-'.repeat(40));

  await test('Should track batch statistics', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));

    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: () => {} },
    };

    const aggregator = new MessageAggregator({
      window: mockWindow,
      batchInterval: 10000,
    });

    aggregator.push('test', { id: 1 });
    aggregator.push('test', { id: 2 });
    aggregator.push('test', { id: 3 });
    aggregator.flushNow();

    const stats = aggregator.getStats();

    if (stats.totalMessages !== 3) {
      throw new Error(`Expected 3 total messages, got ${stats.totalMessages}`);
    }
    if (stats.totalBatches !== 1) {
      throw new Error(`Expected 1 batch, got ${stats.totalBatches}`);
    }
    if (stats.avgBatchSize !== 3) {
      throw new Error(`Expected avg batch size 3, got ${stats.avgBatchSize}`);
    }
  })();

  await test('Should reset statistics', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));

    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: () => {} },
    };

    const aggregator = new MessageAggregator({
      window: mockWindow,
      batchInterval: 10000,
    });

    aggregator.push('test', { data: 1 });
    aggregator.flushNow();
    aggregator.resetStats();

    const stats = aggregator.getStats();

    if (stats.totalMessages !== 0) throw new Error('totalMessages should be 0');
    if (stats.totalBatches !== 0) throw new Error('totalBatches should be 0');
    if (stats.avgBatchSize !== 0) throw new Error('avgBatchSize should be 0');
  })();

  console.log();
  console.log('5. Lifecycle Tests');
  console.log('-'.repeat(40));

  await test('Should set window after creation', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));
    const aggregator = new MessageAggregator();

    if (aggregator.window) {
      throw new Error('Window should be null initially');
    }

    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: () => {} },
    };

    aggregator.setWindow(mockWindow);

    if (aggregator.window !== mockWindow) {
      throw new Error('Window not set correctly');
    }
  })();

  await test('Should destroy aggregator', async () => {
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));

    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: () => {} },
    };

    const aggregator = new MessageAggregator({
      window: mockWindow,
      batchInterval: 10000,
    });

    aggregator.push('test', { data: 1 });
    aggregator.destroy();

    if (aggregator.window !== null) {
      throw new Error('Window should be null after destroy');
    }
    if (aggregator.messageQueue.length !== 0) {
      throw new Error('Queue should be empty after destroy');
    }
    if (aggregator.timer !== null) {
      throw new Error('Timer should be null after destroy');
    }
  })();

  console.log();
  console.log('6. Message Aggregator IPC Tests');
  console.log('-'.repeat(40));

  await test('Should register IPC handlers', async () => {
    const { registerMessageAggregatorIPC, unregisterMessageAggregatorIPC } = require(path.join(srcPath, 'utils/message-aggregator-ipc'));

    const handlers = new Map();
    const mockIpcMain = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
    };

    const registeredModules = new Set();
    const mockIpcGuard = {
      isModuleRegistered: (name) => registeredModules.has(name),
      markModuleRegistered: (name) => registeredModules.add(name),
      unmarkModuleRegistered: (name) => registeredModules.delete(name),
    };

    registerMessageAggregatorIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    const expectedChannels = [
      'aggregator:push',
      'aggregator:push-batch',
      'aggregator:flush',
      'aggregator:get-stats',
      'aggregator:reset-stats',
      'aggregator:get-config',
      'aggregator:set-config',
      'aggregator:get-queue-status',
      'aggregator:set-window',
      'aggregator:destroy',
    ];

    for (const channel of expectedChannels) {
      if (!handlers.has(channel)) {
        throw new Error(`Missing handler: ${channel}`);
      }
    }

    if (handlers.size !== 10) {
      throw new Error(`Expected 10 handlers, got ${handlers.size}`);
    }

    unregisterMessageAggregatorIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    if (handlers.size !== 0) {
      throw new Error('Handlers not properly unregistered');
    }
  })();

  await test('Should get stats via IPC', async () => {
    const { registerMessageAggregatorIPC, unregisterMessageAggregatorIPC, setMessageAggregatorInstance } = require(path.join(srcPath, 'utils/message-aggregator-ipc'));
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));

    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: () => {} },
    };

    const aggregator = new MessageAggregator({ window: mockWindow });
    setMessageAggregatorInstance(aggregator);

    const handlers = new Map();
    const mockIpcMain = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
    };

    const registeredModules = new Set();
    const mockIpcGuard = {
      isModuleRegistered: (name) => registeredModules.has(name),
      markModuleRegistered: (name) => registeredModules.add(name),
      unmarkModuleRegistered: (name) => registeredModules.delete(name),
    };

    registerMessageAggregatorIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
      messageAggregator: aggregator,
    });

    const handler = handlers.get('aggregator:get-stats');
    const result = await handler();

    if (!result.success) throw new Error('Handler should succeed');
    if (!result.stats) throw new Error('Missing stats');
    if (result.stats.efficiency === undefined) throw new Error('Missing efficiency');

    unregisterMessageAggregatorIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });
  })();

  await test('Should get queue status via IPC', async () => {
    const { registerMessageAggregatorIPC, unregisterMessageAggregatorIPC, setMessageAggregatorInstance } = require(path.join(srcPath, 'utils/message-aggregator-ipc'));
    const { MessageAggregator } = require(path.join(srcPath, 'utils/message-aggregator'));

    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: () => {} },
    };

    const aggregator = new MessageAggregator({
      window: mockWindow,
      batchInterval: 10000,
    });
    setMessageAggregatorInstance(aggregator);

    const handlers = new Map();
    const mockIpcMain = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
    };

    const registeredModules = new Set();
    const mockIpcGuard = {
      isModuleRegistered: (name) => registeredModules.has(name),
      markModuleRegistered: (name) => registeredModules.add(name),
      unmarkModuleRegistered: (name) => registeredModules.delete(name),
    };

    registerMessageAggregatorIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
      messageAggregator: aggregator,
    });

    // Push some messages
    aggregator.push('test-event', { data: 1 });
    aggregator.push('test-event', { data: 2 });

    const handler = handlers.get('aggregator:get-queue-status');
    const result = await handler();

    if (!result.success) throw new Error('Handler should succeed');
    if (result.queue.size !== 2) throw new Error(`Expected queue size 2, got ${result.queue.size}`);
    if (!result.queue.eventCounts['test-event']) throw new Error('Missing event count');

    // Clean up
    if (aggregator.timer) {
      clearTimeout(aggregator.timer);
    }

    unregisterMessageAggregatorIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });
  })();

  // ==================== Summary ====================

  console.log();
  console.log('═'.repeat(60));
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('═'.repeat(60));

  if (results.failed > 0) {
    console.log();
    console.log('Failed tests:');
    results.tests
      .filter((t) => t.status === 'failed')
      .forEach((t) => {
        console.log(`  - ${t.name}: ${t.error}`);
      });
    process.exit(1);
  }

  console.log();
  console.log('✅ All integration tests passed!');
  console.log();
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
