#!/usr/bin/env node
/**
 * Stream Controller Integration Test
 *
 * 验证流式输出控制系统在实际环境中的工作情况
 *
 * Usage: node scripts/test-stream-controller.js
 */

const path = require('path');

// 设置模块路径
const srcPath = path.join(__dirname, '..', 'src', 'main');

console.log('═'.repeat(60));
console.log('  Stream Controller Integration Test');
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

  console.log('1. StreamController Core Tests');
  console.log('-'.repeat(40));

  await test('Should create StreamController instance', async () => {
    const { StreamController, StreamStatus } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    if (!controller) throw new Error('Failed to create instance');
    if (controller.status !== StreamStatus.IDLE) {
      throw new Error(`Expected IDLE status, got ${controller.status}`);
    }
  })();

  await test('Should have AbortSignal', async () => {
    const { StreamController } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    if (!controller.signal) throw new Error('Missing AbortSignal');
    if (controller.signal.aborted) throw new Error('Signal should not be aborted initially');
  })();

  await test('Should start stream', async () => {
    const { StreamController, StreamStatus } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    controller.start();

    if (controller.status !== StreamStatus.RUNNING) {
      throw new Error(`Expected RUNNING status, got ${controller.status}`);
    }
    if (!controller.startTime) throw new Error('Missing startTime');
  })();

  await test('Should not allow starting twice', async () => {
    const { StreamController } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    controller.start();

    try {
      controller.start();
      throw new Error('Should have thrown');
    } catch (e) {
      if (!e.message.includes('无法开始')) {
        throw new Error('Wrong error message');
      }
    }
  })();

  console.log();
  console.log('2. Stream Control Tests');
  console.log('-'.repeat(40));

  await test('Should pause running stream', async () => {
    const { StreamController, StreamStatus } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    controller.start();
    controller.pause();

    if (controller.status !== StreamStatus.PAUSED) {
      throw new Error(`Expected PAUSED status, got ${controller.status}`);
    }
    if (!controller.isPaused) throw new Error('isPaused should be true');
  })();

  await test('Should resume paused stream', async () => {
    const { StreamController, StreamStatus } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    controller.start();
    controller.pause();
    controller.resume();

    if (controller.status !== StreamStatus.RUNNING) {
      throw new Error(`Expected RUNNING status, got ${controller.status}`);
    }
    if (controller.isPaused) throw new Error('isPaused should be false');
  })();

  await test('Should cancel stream', async () => {
    const { StreamController, StreamStatus } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    controller.start();
    controller.cancel('Test cancellation');

    if (controller.status !== StreamStatus.CANCELLED) {
      throw new Error(`Expected CANCELLED status, got ${controller.status}`);
    }
    if (!controller.signal.aborted) throw new Error('Signal should be aborted');
  })();

  await test('Should complete stream', async () => {
    const { StreamController, StreamStatus } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    controller.start();
    controller.complete({ message: 'Done' });

    if (controller.status !== StreamStatus.COMPLETED) {
      throw new Error(`Expected COMPLETED status, got ${controller.status}`);
    }
    if (!controller.endTime) throw new Error('Missing endTime');
  })();

  console.log();
  console.log('3. Chunk Processing Tests');
  console.log('-'.repeat(40));

  await test('Should process chunks', async () => {
    const { StreamController } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    controller.start();

    const result1 = await controller.processChunk({ text: 'Hello' });
    const result2 = await controller.processChunk({ text: 'World' });

    if (!result1) throw new Error('First chunk should be processed');
    if (!result2) throw new Error('Second chunk should be processed');
    if (controller.processedChunks !== 2) {
      throw new Error(`Expected 2 chunks, got ${controller.processedChunks}`);
    }
  })();

  await test('Should stop processing when cancelled', async () => {
    const { StreamController } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    controller.start();
    await controller.processChunk({ text: 'First' });
    controller.cancel();

    const result = await controller.processChunk({ text: 'Second' });

    if (result !== false) throw new Error('Should not process chunk after cancel');
  })();

  await test('Should buffer chunks when enabled', async () => {
    const { StreamController } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController({ enableBuffering: true });

    controller.start();
    await controller.processChunk({ text: 'Hello' });
    await controller.processChunk({ text: 'World' });

    const buffer = controller.getBuffer();

    if (buffer.length !== 2) {
      throw new Error(`Expected 2 items in buffer, got ${buffer.length}`);
    }
    if (buffer[0].text !== 'Hello') throw new Error('Wrong first item');
    if (buffer[1].text !== 'World') throw new Error('Wrong second item');
  })();

  await test('Should clear buffer', async () => {
    const { StreamController } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController({ enableBuffering: true });

    controller.start();
    await controller.processChunk({ text: 'Hello' });
    controller.clearBuffer();

    const buffer = controller.getBuffer();

    if (buffer.length !== 0) {
      throw new Error(`Expected empty buffer, got ${buffer.length}`);
    }
  })();

  console.log();
  console.log('4. Statistics Tests');
  console.log('-'.repeat(40));

  await test('Should track statistics', async () => {
    const { StreamController } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    controller.start();
    await controller.processChunk({ text: 'A' });
    await controller.processChunk({ text: 'B' });
    await controller.processChunk({ text: 'C' });
    controller.complete();

    const stats = controller.getStats();

    if (stats.totalChunks !== 3) throw new Error(`Expected 3 total chunks, got ${stats.totalChunks}`);
    if (stats.processedChunks !== 3) throw new Error(`Expected 3 processed chunks, got ${stats.processedChunks}`);
    if (stats.duration < 0) throw new Error('Duration should be non-negative');
    if (!stats.startTime) throw new Error('Missing startTime');
    if (!stats.endTime) throw new Error('Missing endTime');
  })();

  await test('Should reset controller', async () => {
    const { StreamController, StreamStatus } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    controller.start();
    await controller.processChunk({ text: 'Test' });
    controller.complete();

    controller.reset();

    if (controller.status !== StreamStatus.IDLE) {
      throw new Error(`Expected IDLE status after reset, got ${controller.status}`);
    }
    if (controller.processedChunks !== 0) throw new Error('Chunks should be reset to 0');
    if (controller.startTime !== null) throw new Error('startTime should be null');
  })();

  console.log();
  console.log('5. Event Tests');
  console.log('-'.repeat(40));

  await test('Should emit start event', async () => {
    const { StreamController } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    let eventFired = false;
    controller.on('start', () => { eventFired = true; });

    controller.start();

    if (!eventFired) throw new Error('Start event not fired');
  })();

  await test('Should emit chunk event', async () => {
    const { StreamController } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    let chunkData = null;
    controller.on('chunk', (data) => { chunkData = data; });

    controller.start();
    await controller.processChunk({ text: 'Test' });

    if (!chunkData) throw new Error('Chunk event not fired');
    if (chunkData.chunk.text !== 'Test') throw new Error('Wrong chunk data');
  })();

  await test('Should emit cancel event', async () => {
    const { StreamController } = require(path.join(srcPath, 'llm/stream-controller'));
    const controller = new StreamController();

    let cancelData = null;
    controller.on('cancel', (data) => { cancelData = data; });

    controller.start();
    controller.cancel('Test reason');

    if (!cancelData) throw new Error('Cancel event not fired');
    if (cancelData.reason !== 'Test reason') throw new Error('Wrong cancel reason');
  })();

  console.log();
  console.log('6. Stream Controller IPC Tests');
  console.log('-'.repeat(40));

  await test('Should register IPC handlers', async () => {
    const { registerStreamControllerIPC, unregisterStreamControllerIPC } = require(path.join(srcPath, 'llm/stream-controller-ipc'));

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

    registerStreamControllerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    const expectedChannels = [
      'stream:create',
      'stream:start',
      'stream:complete',
      'stream:destroy',
      'stream:pause',
      'stream:resume',
      'stream:cancel',
      'stream:get-status',
      'stream:get-stats',
      'stream:list-active',
      'stream:get-buffer',
      'stream:clear-buffer',
    ];

    for (const channel of expectedChannels) {
      if (!handlers.has(channel)) {
        throw new Error(`Missing handler: ${channel}`);
      }
    }

    if (handlers.size !== 12) {
      throw new Error(`Expected 12 handlers, got ${handlers.size}`);
    }

    unregisterStreamControllerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    if (handlers.size !== 0) {
      throw new Error('Handlers not properly unregistered');
    }
  })();

  await test('Should create stream via IPC', async () => {
    const { registerStreamControllerIPC, unregisterStreamControllerIPC, getActiveControllerCount } = require(path.join(srcPath, 'llm/stream-controller-ipc'));

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

    registerStreamControllerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    const createHandler = handlers.get('stream:create');
    const result = await createHandler(null, { streamId: 'test_stream_1' });

    if (!result.success) throw new Error('Create should succeed');
    if (result.streamId !== 'test_stream_1') throw new Error('Wrong streamId');

    // Clean up
    const destroyHandler = handlers.get('stream:destroy');
    await destroyHandler(null, 'test_stream_1');

    unregisterStreamControllerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });
  })();

  await test('Should control stream via IPC', async () => {
    const { registerStreamControllerIPC, unregisterStreamControllerIPC } = require(path.join(srcPath, 'llm/stream-controller-ipc'));
    const { StreamStatus } = require(path.join(srcPath, 'llm/stream-controller'));

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

    registerStreamControllerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    // Create
    const createHandler = handlers.get('stream:create');
    await createHandler(null, { streamId: 'test_stream_2' });

    // Start
    const startHandler = handlers.get('stream:start');
    const startResult = await startHandler(null, 'test_stream_2');
    if (startResult.status !== StreamStatus.RUNNING) {
      throw new Error('Stream should be running');
    }

    // Pause
    const pauseHandler = handlers.get('stream:pause');
    const pauseResult = await pauseHandler(null, 'test_stream_2');
    if (pauseResult.status !== StreamStatus.PAUSED) {
      throw new Error('Stream should be paused');
    }

    // Resume
    const resumeHandler = handlers.get('stream:resume');
    const resumeResult = await resumeHandler(null, 'test_stream_2');
    if (resumeResult.status !== StreamStatus.RUNNING) {
      throw new Error('Stream should be running again');
    }

    // Cancel
    const cancelHandler = handlers.get('stream:cancel');
    const cancelResult = await cancelHandler(null, 'test_stream_2', 'Test cancel');
    if (cancelResult.status !== StreamStatus.CANCELLED) {
      throw new Error('Stream should be cancelled');
    }

    // Clean up
    const destroyHandler = handlers.get('stream:destroy');
    await destroyHandler(null, 'test_stream_2');

    unregisterStreamControllerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });
  })();

  await test('Should list active streams via IPC', async () => {
    const { registerStreamControllerIPC, unregisterStreamControllerIPC } = require(path.join(srcPath, 'llm/stream-controller-ipc'));

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

    registerStreamControllerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    // Create multiple streams
    const createHandler = handlers.get('stream:create');
    await createHandler(null, { streamId: 'stream_a' });
    await createHandler(null, { streamId: 'stream_b' });

    // List
    const listHandler = handlers.get('stream:list-active');
    const result = await listHandler();

    if (!result.success) throw new Error('List should succeed');
    if (result.count < 2) throw new Error(`Expected at least 2 streams, got ${result.count}`);

    // Clean up
    const destroyHandler = handlers.get('stream:destroy');
    await destroyHandler(null, 'stream_a');
    await destroyHandler(null, 'stream_b');

    unregisterStreamControllerIPC({
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
