#!/usr/bin/env node
/**
 * Progress Emitter Integration Test
 *
 * 验证统一进度通知系统在实际环境中的工作情况
 *
 * Usage: node scripts/test-progress-emitter.js
 */

const path = require('path');

// 设置模块路径
const srcPath = path.join(__dirname, '..', 'src', 'main');

console.log('═'.repeat(60));
console.log('  Progress Emitter Integration Test');
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

  console.log('1. ProgressEmitter Core Tests');
  console.log('-'.repeat(40));

  await test('Should create ProgressEmitter instance', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    if (!emitter) throw new Error('Failed to create instance');
    if (typeof emitter.createTracker !== 'function') {
      throw new Error('Missing createTracker method');
    }
  })();

  await test('Should have ProgressStage enum', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));

    const stages = ProgressEmitter.Stage;
    if (!stages) throw new Error('Missing Stage enum');

    const expectedStages = ['PENDING', 'PREPARING', 'PROCESSING', 'FINALIZING', 'COMPLETED', 'FAILED', 'CANCELLED'];

    for (const stage of expectedStages) {
      if (!stages[stage]) {
        throw new Error(`Missing stage: ${stage}`);
      }
    }
  })();

  await test('Should use default config', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    if (emitter.config.autoForwardToIPC !== true) {
      throw new Error('autoForwardToIPC should be true');
    }
    if (emitter.config.throttleInterval !== 100) {
      throw new Error(`throttleInterval should be 100, got ${emitter.config.throttleInterval}`);
    }
  })();

  console.log();
  console.log('2. Task Tracker Tests');
  console.log('-'.repeat(40));

  await test('Should create task tracker', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    const tracker = emitter.createTracker('test-task-1', {
      title: 'Test Task',
      totalSteps: 10,
    });

    if (!tracker) throw new Error('Failed to create tracker');
    if (typeof tracker.step !== 'function') throw new Error('Missing step method');
    if (typeof tracker.setPercent !== 'function') throw new Error('Missing setPercent method');
    if (typeof tracker.complete !== 'function') throw new Error('Missing complete method');

    emitter.clearAll();
  })();

  await test('Should update progress via step', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    const tracker = emitter.createTracker('test-task-2', {
      title: 'Step Test',
      totalSteps: 10,
    });

    tracker.step('Step 1', 1);
    let info = tracker.getInfo();
    if (info.currentStep !== 1) throw new Error(`Expected step 1, got ${info.currentStep}`);
    if (info.percent !== 10) throw new Error(`Expected 10%, got ${info.percent}%`);

    tracker.step('Step 2-4', 3);
    info = tracker.getInfo();
    if (info.currentStep !== 4) throw new Error(`Expected step 4, got ${info.currentStep}`);
    if (info.percent !== 40) throw new Error(`Expected 40%, got ${info.percent}%`);

    emitter.clearAll();
  })();

  await test('Should update progress via setPercent', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    const tracker = emitter.createTracker('test-task-3', {
      title: 'Percent Test',
      totalSteps: 100,
    });

    tracker.setPercent(50, 'Half done');
    let info = tracker.getInfo();
    if (info.percent !== 50) throw new Error(`Expected 50%, got ${info.percent}%`);

    // Should clamp to 100
    tracker.setPercent(150, 'Overflow');
    info = tracker.getInfo();
    if (info.percent !== 100) throw new Error(`Expected 100% (clamped), got ${info.percent}%`);

    emitter.clearAll();
  })();

  await test('Should set stage', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    const tracker = emitter.createTracker('test-task-4', {
      title: 'Stage Test',
    });

    tracker.setStage(ProgressEmitter.Stage.PROCESSING, 'Processing...');
    let info = tracker.getInfo();
    if (info.stage !== 'processing') throw new Error(`Expected 'processing', got ${info.stage}`);

    tracker.setStage(ProgressEmitter.Stage.FINALIZING, 'Finalizing...');
    info = tracker.getInfo();
    if (info.stage !== 'finalizing') throw new Error(`Expected 'finalizing', got ${info.stage}`);

    emitter.clearAll();
  })();

  console.log();
  console.log('3. Task Completion Tests');
  console.log('-'.repeat(40));

  await test('Should complete task', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    const tracker = emitter.createTracker('test-task-5', {
      title: 'Complete Test',
    });

    tracker.complete({ message: 'Done!' });
    const info = tracker.getInfo();

    if (info.stage !== 'completed') throw new Error(`Expected 'completed', got ${info.stage}`);
    if (info.percent !== 100) throw new Error(`Expected 100%, got ${info.percent}%`);
    if (info.duration < 0) throw new Error(`Duration should be non-negative`);

    emitter.clearAll();
  })();

  await test('Should mark task as failed', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    const tracker = emitter.createTracker('test-task-6', {
      title: 'Error Test',
    });

    tracker.error('Something went wrong');
    const info = tracker.getInfo();

    if (info.stage !== 'failed') throw new Error(`Expected 'failed', got ${info.stage}`);
    if (!info.error) throw new Error('Missing error message');
    if (info.error !== 'Something went wrong') throw new Error(`Wrong error: ${info.error}`);

    emitter.clearAll();
  })();

  await test('Should cancel task', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    const tracker = emitter.createTracker('test-task-7', {
      title: 'Cancel Test',
    });

    tracker.cancel('User requested');
    const info = tracker.getInfo();

    if (info.stage !== 'cancelled') throw new Error(`Expected 'cancelled', got ${info.stage}`);

    emitter.clearAll();
  })();

  console.log();
  console.log('4. Task Management Tests');
  console.log('-'.repeat(40));

  await test('Should get active tasks', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    emitter.createTracker('task-a', { title: 'Task A' });
    emitter.createTracker('task-b', { title: 'Task B' });
    emitter.createTracker('task-c', { title: 'Task C' });

    const tasks = emitter.getActiveTasks();
    if (tasks.length !== 3) throw new Error(`Expected 3 tasks, got ${tasks.length}`);

    emitter.clearAll();
  })();

  await test('Should get single task', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    emitter.createTracker('task-x', { title: 'Task X', description: 'Test task' });

    const task = emitter.getTask('task-x');
    if (!task) throw new Error('Task not found');
    if (task.title !== 'Task X') throw new Error(`Wrong title: ${task.title}`);

    const notFound = emitter.getTask('non-existent');
    if (notFound !== null) throw new Error('Should return null for non-existent task');

    emitter.clearAll();
  })();

  await test('Should remove task', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    emitter.createTracker('task-to-remove', { title: 'Remove Me' });
    if (!emitter.getTask('task-to-remove')) throw new Error('Task should exist');

    emitter.removeTask('task-to-remove');
    if (emitter.getTask('task-to-remove')) throw new Error('Task should be removed');

    emitter.clearAll();
  })();

  await test('Should clear all tasks', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter();

    emitter.createTracker('task-1', { title: 'Task 1' });
    emitter.createTracker('task-2', { title: 'Task 2' });

    emitter.clearAll();

    const tasks = emitter.getActiveTasks();
    if (tasks.length !== 0) throw new Error(`Expected 0 tasks after clear, got ${tasks.length}`);
  })();

  console.log();
  console.log('5. Event Emission Tests');
  console.log('-'.repeat(40));

  await test('Should emit progress events', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter({ throttleInterval: 0 }); // Disable throttle

    let progressEvents = [];
    emitter.on('progress', (data) => {
      progressEvents.push(data);
    });

    const tracker = emitter.createTracker('event-task', { title: 'Event Test', totalSteps: 10 });
    tracker.step('Step 1', 1);
    tracker.complete({ message: 'Done' });

    if (progressEvents.length < 2) {
      throw new Error(`Expected at least 2 events, got ${progressEvents.length}`);
    }

    emitter.clearAll();
  })();

  await test('Should emit task-specific events', async () => {
    const ProgressEmitter = require(path.join(srcPath, 'utils/progress-emitter'));
    const emitter = new ProgressEmitter({ throttleInterval: 0 });

    let taskEvents = [];
    emitter.on('progress:specific-task', (data) => {
      taskEvents.push(data);
    });

    const tracker = emitter.createTracker('specific-task', { title: 'Specific' });
    tracker.step('Update', 1);

    if (taskEvents.length === 0) {
      throw new Error('Should have received task-specific events');
    }

    emitter.clearAll();
  })();

  console.log();
  console.log('6. Progress Emitter IPC Tests');
  console.log('-'.repeat(40));

  await test('Should register IPC handlers', async () => {
    const { registerProgressEmitterIPC, unregisterProgressEmitterIPC } = require(
      path.join(srcPath, 'utils/progress-emitter-ipc')
    );

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

    registerProgressEmitterIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    const expectedChannels = [
      'progress:create-task',
      'progress:get-task',
      'progress:get-active-tasks',
      'progress:remove-task',
      'progress:step',
      'progress:set-percent',
      'progress:set-stage',
      'progress:complete',
      'progress:error',
      'progress:cancel',
      'progress:clear-all',
      'progress:get-config',
    ];

    for (const channel of expectedChannels) {
      if (!handlers.has(channel)) {
        throw new Error(`Missing handler: ${channel}`);
      }
    }

    if (handlers.size !== 12) {
      throw new Error(`Expected 12 handlers, got ${handlers.size}`);
    }

    unregisterProgressEmitterIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    if (handlers.size !== 0) {
      throw new Error('Handlers not properly unregistered');
    }
  })();

  await test('Should create task via IPC', async () => {
    const { registerProgressEmitterIPC, unregisterProgressEmitterIPC } = require(
      path.join(srcPath, 'utils/progress-emitter-ipc')
    );

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

    registerProgressEmitterIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    const createHandler = handlers.get('progress:create-task');
    const result = await createHandler(null, 'ipc-test-task', {
      title: 'IPC Test Task',
      totalSteps: 50,
    });

    if (!result.success) throw new Error('Create task should succeed');
    if (!result.taskInfo) throw new Error('Missing taskInfo');
    if (result.taskInfo.taskId !== 'ipc-test-task') throw new Error('Wrong taskId');
    if (result.taskInfo.title !== 'IPC Test Task') throw new Error('Wrong title');

    unregisterProgressEmitterIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });
  })();

  await test('Should update step via IPC', async () => {
    const { registerProgressEmitterIPC, unregisterProgressEmitterIPC } = require(
      path.join(srcPath, 'utils/progress-emitter-ipc')
    );

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

    registerProgressEmitterIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    // Create task first
    const createHandler = handlers.get('progress:create-task');
    await createHandler(null, 'step-test-task', { totalSteps: 10 });

    // Update step
    const stepHandler = handlers.get('progress:step');
    const result = await stepHandler(null, 'step-test-task', 'Progress', 5);

    if (!result.success) throw new Error('Step update should succeed');
    if (result.percent !== 50) throw new Error(`Expected 50%, got ${result.percent}%`);

    unregisterProgressEmitterIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });
  })();

  await test('Should complete task via IPC', async () => {
    const { registerProgressEmitterIPC, unregisterProgressEmitterIPC } = require(
      path.join(srcPath, 'utils/progress-emitter-ipc')
    );

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

    registerProgressEmitterIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    // Create task
    const createHandler = handlers.get('progress:create-task');
    await createHandler(null, 'complete-test-task', { title: 'Complete Test' });

    // Complete task
    const completeHandler = handlers.get('progress:complete');
    const result = await completeHandler(null, 'complete-test-task', { message: 'Finished!' });

    if (!result.success) throw new Error('Complete should succeed');
    if (result.stage !== 'completed') throw new Error(`Expected 'completed', got ${result.stage}`);

    unregisterProgressEmitterIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });
  })();

  await test('Should get config via IPC', async () => {
    const { registerProgressEmitterIPC, unregisterProgressEmitterIPC } = require(
      path.join(srcPath, 'utils/progress-emitter-ipc')
    );

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

    registerProgressEmitterIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    const configHandler = handlers.get('progress:get-config');
    const result = await configHandler();

    if (!result.success) throw new Error('Get config should succeed');
    if (!result.config) throw new Error('Missing config');
    if (!result.stages) throw new Error('Missing stages');
    if (!result.stages.PENDING) throw new Error('Missing PENDING stage');

    unregisterProgressEmitterIPC({
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
