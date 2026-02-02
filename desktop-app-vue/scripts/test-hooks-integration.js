#!/usr/bin/env node
/**
 * Hooks System Integration Test
 *
 * 验证 Hooks 系统在实际环境中的工作情况
 *
 * Usage: node scripts/test-hooks-integration.js
 */

const path = require('path');

// 设置模块路径
const srcPath = path.join(__dirname, '..', 'src', 'main');

console.log('═'.repeat(60));
console.log('  Hooks System Integration Test');
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

  console.log('1. HookSystem Initialization');
  console.log('-'.repeat(40));

  await test('Should initialize HookSystem', async () => {
    const { initializeHookSystem, destroyHookSystem } = require(path.join(srcPath, 'hooks'));
    const hookSystem = await initializeHookSystem({ autoLoadConfig: false });

    if (!hookSystem) throw new Error('HookSystem is null');
    if (!hookSystem.initialized) throw new Error('HookSystem not initialized');

    destroyHookSystem();
  })();

  await test('Should get singleton instance', async () => {
    const { getHookSystem, destroyHookSystem } = require(path.join(srcPath, 'hooks'));
    const hookSystem1 = getHookSystem();
    const hookSystem2 = getHookSystem();

    if (hookSystem1 !== hookSystem2) throw new Error('Not singleton');

    destroyHookSystem();
  })();

  console.log();
  console.log('2. Hook Registration & Triggering');
  console.log('-'.repeat(40));

  await test('Should register and trigger async hook', async () => {
    const { HookSystem, HookResult } = require(path.join(srcPath, 'hooks'));
    const hookSystem = new HookSystem({ autoLoadConfig: false });
    await hookSystem.initialize();

    let triggered = false;

    hookSystem.register({
      event: 'PreToolUse',
      name: 'test-async-hook',
      handler: async ({ data }) => {
        triggered = true;
        return { result: HookResult.CONTINUE };
      },
    });

    const result = await hookSystem.trigger('PreToolUse', { toolName: 'test' });

    if (!triggered) throw new Error('Hook not triggered');
    if (result.result !== HookResult.CONTINUE) throw new Error('Wrong result');

    hookSystem.clear();
  })();

  await test('Should prevent operation with hook', async () => {
    const { HookSystem, HookResult } = require(path.join(srcPath, 'hooks'));
    const hookSystem = new HookSystem({ autoLoadConfig: false });
    await hookSystem.initialize();

    hookSystem.register({
      event: 'PreToolUse',
      name: 'blocking-hook',
      handler: async () => ({
        result: HookResult.PREVENT,
        reason: 'Blocked for testing',
      }),
    });

    const result = await hookSystem.trigger('PreToolUse', { toolName: 'test' });

    if (!result.prevented) throw new Error('Should be prevented');
    if (result.preventReason !== 'Blocked for testing') throw new Error('Wrong reason');

    hookSystem.clear();
  })();

  await test('Should modify data with hook', async () => {
    const { HookSystem, HookResult } = require(path.join(srcPath, 'hooks'));
    const hookSystem = new HookSystem({ autoLoadConfig: false });
    await hookSystem.initialize();

    hookSystem.register({
      event: 'PreToolUse',
      name: 'modify-hook',
      handler: async ({ data }) => ({
        result: HookResult.MODIFY,
        data: { ...data, modified: true },
      }),
    });

    const result = await hookSystem.trigger('PreToolUse', { toolName: 'test' });

    if (!result.data.modified) throw new Error('Data not modified');

    hookSystem.clear();
  })();

  console.log();
  console.log('3. Priority System');
  console.log('-'.repeat(40));

  await test('Should execute hooks in priority order', async () => {
    const { HookSystem, HookPriority, HookResult } = require(path.join(srcPath, 'hooks'));
    const hookSystem = new HookSystem({ autoLoadConfig: false });
    await hookSystem.initialize();

    const order = [];

    hookSystem.register({
      event: 'PreToolUse',
      name: 'low-priority',
      priority: HookPriority.LOW,
      handler: async () => {
        order.push('low');
        return { result: HookResult.CONTINUE };
      },
    });

    hookSystem.register({
      event: 'PreToolUse',
      name: 'high-priority',
      priority: HookPriority.HIGH,
      handler: async () => {
        order.push('high');
        return { result: HookResult.CONTINUE };
      },
    });

    hookSystem.register({
      event: 'PreToolUse',
      name: 'normal-priority',
      priority: HookPriority.NORMAL,
      handler: async () => {
        order.push('normal');
        return { result: HookResult.CONTINUE };
      },
    });

    await hookSystem.trigger('PreToolUse', { toolName: 'test' });

    const expected = ['high', 'normal', 'low'];
    if (JSON.stringify(order) !== JSON.stringify(expected)) {
      throw new Error(`Wrong order: ${order.join(', ')} (expected: ${expected.join(', ')})`);
    }

    hookSystem.clear();
  })();

  console.log();
  console.log('4. Matcher System');
  console.log('-'.repeat(40));

  await test('Should match with wildcard pattern', async () => {
    const { HookSystem, HookResult } = require(path.join(srcPath, 'hooks'));
    const hookSystem = new HookSystem({ autoLoadConfig: false });
    await hookSystem.initialize();

    let matched = false;

    hookSystem.register({
      event: 'PreToolUse',
      name: 'wildcard-hook',
      matcher: 'tool_file_*',
      handler: async () => {
        matched = true;
        return { result: HookResult.CONTINUE };
      },
    });

    // Should match
    await hookSystem.trigger('PreToolUse', { toolName: 'tool_file_read' });
    if (!matched) throw new Error('Should match tool_file_read');

    matched = false;

    // Should not match
    await hookSystem.trigger('PreToolUse', { toolName: 'tool_exec_run' });
    if (matched) throw new Error('Should not match tool_exec_run');

    hookSystem.clear();
  })();

  await test('Should match with pipe pattern', async () => {
    const { HookSystem, HookResult } = require(path.join(srcPath, 'hooks'));
    const hookSystem = new HookSystem({ autoLoadConfig: false });
    await hookSystem.initialize();

    let matchCount = 0;

    hookSystem.register({
      event: 'PreToolUse',
      name: 'pipe-hook',
      matcher: 'Edit|Write|Read',
      handler: async () => {
        matchCount++;
        return { result: HookResult.CONTINUE };
      },
    });

    await hookSystem.trigger('PreToolUse', { toolName: 'Edit' });
    await hookSystem.trigger('PreToolUse', { toolName: 'Write' });
    await hookSystem.trigger('PreToolUse', { toolName: 'Delete' }); // Should not match

    if (matchCount !== 2) throw new Error(`Expected 2 matches, got ${matchCount}`);

    hookSystem.clear();
  })();

  console.log();
  console.log('5. Middleware Integration');
  console.log('-'.repeat(40));

  await test('Should create tool middleware', async () => {
    const { HookSystem, createToolHookMiddleware, HookResult } = require(path.join(srcPath, 'hooks'));
    const hookSystem = new HookSystem({ autoLoadConfig: false });
    await hookSystem.initialize();

    let preHookCalled = false;
    let postHookCalled = false;

    hookSystem.register({
      event: 'PreToolUse',
      name: 'pre-hook',
      handler: async () => {
        preHookCalled = true;
        return { result: HookResult.CONTINUE };
      },
    });

    hookSystem.register({
      event: 'PostToolUse',
      name: 'post-hook',
      handler: async () => {
        postHookCalled = true;
        return { result: HookResult.CONTINUE };
      },
    });

    const middleware = createToolHookMiddleware(hookSystem);

    const originalHandler = async (params) => ({ success: true, data: params });
    const wrappedHandler = middleware.wrap('test_tool', originalHandler);

    const result = await wrappedHandler({ input: 'test' }, {});

    if (!preHookCalled) throw new Error('PreToolUse hook not called');
    if (!postHookCalled) throw new Error('PostToolUse hook not called');
    if (!result.success) throw new Error('Original handler failed');

    hookSystem.clear();
  })();

  console.log();
  console.log('6. Statistics');
  console.log('-'.repeat(40));

  await test('Should track execution statistics', async () => {
    const { HookSystem, HookResult } = require(path.join(srcPath, 'hooks'));
    const hookSystem = new HookSystem({ autoLoadConfig: false });
    await hookSystem.initialize();

    hookSystem.register({
      event: 'PreToolUse',
      name: 'stats-hook',
      handler: async () => ({ result: HookResult.CONTINUE }),
    });

    await hookSystem.trigger('PreToolUse', { toolName: 'test1' });
    await hookSystem.trigger('PreToolUse', { toolName: 'test2' });
    await hookSystem.trigger('PreToolUse', { toolName: 'test3' });

    const stats = hookSystem.getStats();

    // 内置钩子 + 我们注册的钩子
    if (stats.totalExecutions < 3) throw new Error(`Expected at least 3 executions, got ${stats.totalExecutions}`);

    hookSystem.clear();
  })();

  console.log();
  console.log('7. Event Types');
  console.log('-'.repeat(40));

  await test('Should support all 21 event types', async () => {
    const { HookSystem } = require(path.join(srcPath, 'hooks'));
    const hookSystem = new HookSystem({ autoLoadConfig: false });

    const eventTypes = hookSystem.getEventTypes();

    const expectedEvents = [
      'PreIPCCall', 'PostIPCCall', 'IPCError',
      'PreToolUse', 'PostToolUse', 'ToolError',
      'SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact',
      'UserPromptSubmit', 'AssistantResponse',
      'AgentStart', 'AgentStop', 'TaskAssigned', 'TaskCompleted',
      'PreFileAccess', 'PostFileAccess', 'FileModified',
      'MemorySave', 'MemoryLoad',
    ];

    for (const event of expectedEvents) {
      if (!eventTypes.includes(event)) {
        throw new Error(`Missing event type: ${event}`);
      }
    }

    if (eventTypes.length !== 21) {
      throw new Error(`Expected 21 event types, got ${eventTypes.length}`);
    }
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
