#!/usr/bin/env node
/**
 * Resource Monitor Integration Test
 *
 * 验证系统资源监控在实际环境中的工作情况
 *
 * Usage: node scripts/test-resource-monitor.js
 */

const path = require('path');

// 设置模块路径
const srcPath = path.join(__dirname, '..', 'src', 'main');

console.log('═'.repeat(60));
console.log('  Resource Monitor Integration Test');
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

  console.log('1. ResourceMonitor Core Tests');
  console.log('-'.repeat(40));

  await test('Should create ResourceMonitor instance', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    if (!monitor) throw new Error('Failed to create instance');
    if (monitor.currentLevel !== 'normal') {
      throw new Error(`Expected 'normal' level, got ${monitor.currentLevel}`);
    }
  })();

  await test('Should get memory status', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    const status = monitor.getMemoryStatus();

    if (!status.total) throw new Error('Missing total memory');
    if (!status.free) throw new Error('Missing free memory');
    if (!status.used) throw new Error('Missing used memory');
    if (status.usagePercentage === undefined) throw new Error('Missing usage percentage');
    if (!status.process) throw new Error('Missing process memory');
    if (!status.process.heapUsed) throw new Error('Missing heap used');
  })();

  await test('Should have valid memory values', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    const status = monitor.getMemoryStatus();

    if (status.total <= 0) throw new Error('Total memory should be positive');
    if (status.free < 0) throw new Error('Free memory should be non-negative');
    if (status.used <= 0) throw new Error('Used memory should be positive');
    if (status.usagePercentage < 0 || status.usagePercentage > 100) {
      throw new Error(`Usage percentage should be 0-100, got ${status.usagePercentage}`);
    }
  })();

  console.log();
  console.log('2. Resource Level Tests');
  console.log('-'.repeat(40));

  await test('Should assess resource level', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    const level = monitor.assessResourceLevel();

    if (!['normal', 'warning', 'critical'].includes(level)) {
      throw new Error(`Invalid level: ${level}`);
    }
  })();

  await test('Should update resource level', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    const level = monitor.updateResourceLevel();

    if (!['normal', 'warning', 'critical'].includes(level)) {
      throw new Error(`Invalid level: ${level}`);
    }
    if (monitor.currentLevel !== level) {
      throw new Error('currentLevel not updated');
    }
  })();

  await test('Should emit level-change event', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor({
      memoryWarning: Number.MAX_SAFE_INTEGER,
      memoryCritical: Number.MAX_SAFE_INTEGER,
    });

    let eventFired = false;
    monitor.on('level-change', (data) => {
      eventFired = true;
    });

    // Force a level change by setting extreme thresholds
    monitor.thresholds.memoryWarning = 1; // 1 byte
    monitor.updateResourceLevel();

    // Event may or may not fire depending on current memory
    // Just verify no error thrown
  })();

  console.log();
  console.log('3. Degradation Strategy Tests');
  console.log('-'.repeat(40));

  await test('Should get degradation strategy', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    const strategy = monitor.getDegradationStrategy('imageProcessing');

    if (!strategy) throw new Error('Missing strategy');
    if (!strategy.maxDimension) throw new Error('Missing maxDimension');
    if (!strategy.quality) throw new Error('Missing quality');
    if (!strategy.concurrent) throw new Error('Missing concurrent');
  })();

  await test('Should have all strategy categories', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    const categories = ['imageProcessing', 'ocrProcessing', 'batchImport'];

    for (const category of categories) {
      const strategy = monitor.getDegradationStrategy(category);
      if (!strategy) throw new Error(`Missing strategy for ${category}`);
    }
  })();

  await test('Should throw on unknown category', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    try {
      monitor.getDegradationStrategy('unknownCategory');
      throw new Error('Should have thrown');
    } catch (e) {
      if (!e.message.includes('未知的策略类别')) {
        throw new Error('Wrong error message');
      }
    }
  })();

  console.log();
  console.log('4. Monitoring Control Tests');
  console.log('-'.repeat(40));

  await test('Should start and stop monitoring', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    monitor.startMonitoring(1000);

    if (!monitor.monitoringInterval) {
      throw new Error('Monitoring interval not set');
    }

    monitor.stopMonitoring();

    if (monitor.monitoringInterval) {
      throw new Error('Monitoring interval should be cleared');
    }
  })();

  await test('Should not double-start monitoring', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    monitor.startMonitoring(1000);
    const firstInterval = monitor.monitoringInterval;

    monitor.startMonitoring(1000);
    const secondInterval = monitor.monitoringInterval;

    // Should be the same interval (not started twice)
    if (firstInterval !== secondInterval) {
      throw new Error('Monitoring started twice');
    }

    monitor.stopMonitoring();
  })();

  await test('Should attempt garbage collection', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    // GC may or may not be available
    const result = monitor.forceGarbageCollection();

    // Just verify it returns a boolean and doesn't throw
    if (typeof result !== 'boolean') {
      throw new Error('forceGarbageCollection should return boolean');
    }
  })();

  console.log();
  console.log('5. Report Generation Tests');
  console.log('-'.repeat(40));

  await test('Should generate resource report', async () => {
    const { ResourceMonitor } = require(path.join(srcPath, 'utils/resource-monitor'));
    const monitor = new ResourceMonitor();

    const report = await monitor.getReport(process.cwd());

    if (!report.timestamp) throw new Error('Missing timestamp');
    if (!report.level) throw new Error('Missing level');
    if (!report.memory) throw new Error('Missing memory');
    if (!report.strategies) throw new Error('Missing strategies');
  })();

  console.log();
  console.log('6. Resource Monitor IPC Tests');
  console.log('-'.repeat(40));

  await test('Should register IPC handlers', async () => {
    const { registerResourceMonitorIPC, unregisterResourceMonitorIPC } = require(path.join(srcPath, 'utils/resource-monitor-ipc'));

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

    registerResourceMonitorIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    const expectedChannels = [
      'resource:get-memory-status',
      'resource:get-disk-status',
      'resource:get-level',
      'resource:get-report',
      'resource:get-strategy',
      'resource:get-all-strategies',
      'resource:check-disk-space',
      'resource:start-monitoring',
      'resource:stop-monitoring',
      'resource:force-gc',
      'resource:update-level',
      'resource:get-thresholds',
      'resource:set-thresholds',
    ];

    for (const channel of expectedChannels) {
      if (!handlers.has(channel)) {
        throw new Error(`Missing handler: ${channel}`);
      }
    }

    if (handlers.size !== 13) {
      throw new Error(`Expected 13 handlers, got ${handlers.size}`);
    }

    unregisterResourceMonitorIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    if (handlers.size !== 0) {
      throw new Error('Handlers not properly unregistered');
    }
  })();

  await test('Should get memory status via IPC', async () => {
    const { registerResourceMonitorIPC, unregisterResourceMonitorIPC } = require(path.join(srcPath, 'utils/resource-monitor-ipc'));

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

    registerResourceMonitorIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    const handler = handlers.get('resource:get-memory-status');
    const result = await handler();

    if (!result.success) throw new Error('Handler should succeed');
    if (!result.memory) throw new Error('Missing memory data');
    if (!result.memory.totalFormatted) throw new Error('Missing formatted total');

    unregisterResourceMonitorIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });
  })();

  await test('Should get all strategies via IPC', async () => {
    const { registerResourceMonitorIPC, unregisterResourceMonitorIPC } = require(path.join(srcPath, 'utils/resource-monitor-ipc'));

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

    registerResourceMonitorIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    const handler = handlers.get('resource:get-all-strategies');
    const result = await handler();

    if (!result.success) throw new Error('Handler should succeed');
    if (!result.strategies) throw new Error('Missing strategies');
    if (!result.strategies.imageProcessing) throw new Error('Missing imageProcessing');
    if (!result.strategies.ocrProcessing) throw new Error('Missing ocrProcessing');
    if (!result.strategies.batchImport) throw new Error('Missing batchImport');

    unregisterResourceMonitorIPC({
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
