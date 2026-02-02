#!/usr/bin/env node
/**
 * Plan Mode Integration Test
 *
 * 验证 Plan Mode 系统在实际环境中的工作情况
 *
 * Usage: node scripts/test-plan-mode.js
 */

const path = require('path');

// 设置模块路径
const srcPath = path.join(__dirname, '..', 'src', 'main');

console.log('═'.repeat(60));
console.log('  Plan Mode Integration Test');
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

  console.log('1. PlanModeManager Initialization');
  console.log('-'.repeat(40));

  await test('Should initialize PlanModeManager', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    if (!manager) throw new Error('Manager is null');
    if (manager.isActive()) throw new Error('Should not be active initially');

    manager.destroy();
  })();

  await test('Should use singleton pattern', async () => {
    const { getPlanModeManager, destroyPlanModeManager } = require(path.join(
      srcPath,
      'ai-engine/plan-mode'
    ));
    const manager1 = getPlanModeManager();
    const manager2 = getPlanModeManager();

    if (manager1 !== manager2) throw new Error('Not singleton');

    destroyPlanModeManager();
  })();

  console.log();
  console.log('2. Plan Mode Lifecycle');
  console.log('-'.repeat(40));

  await test('Should enter and exit plan mode', async () => {
    const { PlanModeManager, PlanModeState } = require(path.join(
      srcPath,
      'ai-engine/plan-mode'
    ));
    const manager = new PlanModeManager();

    // Enter
    const plan = manager.enterPlanMode({ title: 'Test Plan', goal: 'Test lifecycle' });
    if (!manager.isActive()) throw new Error('Should be active after enter');
    if (manager.getState() !== PlanModeState.ANALYZING) {
      throw new Error(`Wrong state: ${manager.getState()}`);
    }

    // Exit
    const result = manager.exitPlanMode();
    if (!result.success) throw new Error('Exit failed');
    if (manager.isActive()) throw new Error('Should not be active after exit');

    manager.destroy();
  })();

  await test('Should create plan with items', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    manager.enterPlanMode({ title: 'Item Test' });
    manager.addPlanItem({ title: 'Step 1', tool: 'Read' });
    manager.addPlanItem({ title: 'Step 2', tool: 'Grep' });
    manager.addPlanItem({ title: 'Step 3', tool: 'Write' });

    const plan = manager.getCurrentPlan();
    if (plan.items.length !== 3) throw new Error(`Wrong item count: ${plan.items.length}`);
    if (plan.items[0].order !== 0) throw new Error('Wrong first item order');
    if (plan.items[2].order !== 2) throw new Error('Wrong last item order');

    manager.destroy();
  })();

  console.log();
  console.log('3. Approval Workflow');
  console.log('-'.repeat(40));

  await test('Should complete approval workflow', async () => {
    const { PlanModeManager, PlanModeState } = require(path.join(
      srcPath,
      'ai-engine/plan-mode'
    ));
    const manager = new PlanModeManager();

    // Enter and add items
    manager.enterPlanMode({ title: 'Approval Test' });
    manager.addPlanItem({ title: 'Step 1' });

    // Mark ready
    const readyResult = manager.markPlanReady();
    if (!readyResult.success) throw new Error('Mark ready failed');
    if (manager.getState() !== PlanModeState.PLAN_READY) {
      throw new Error(`Wrong state after ready: ${manager.getState()}`);
    }

    // Approve
    const approveResult = manager.approvePlan({ approvedBy: 'tester' });
    if (!approveResult.success) throw new Error('Approve failed');
    if (manager.getState() !== PlanModeState.APPROVED) {
      throw new Error(`Wrong state after approve: ${manager.getState()}`);
    }

    manager.destroy();
  })();

  await test('Should handle rejection', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    manager.enterPlanMode({ title: 'Rejection Test' });
    manager.addPlanItem({ title: 'Step 1' });
    manager.markPlanReady();

    const result = manager.rejectPlan({ reason: 'Not acceptable' });
    if (!result.success) throw new Error('Reject failed');
    if (manager.isActive()) throw new Error('Should exit after rejection');

    manager.destroy();
  })();

  console.log();
  console.log('4. Tool Permissions');
  console.log('-'.repeat(40));

  await test('Should allow read tools in plan mode', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    const readTools = ['Read', 'file_reader', 'WebFetch', 'get_project_structure'];
    for (const tool of readTools) {
      if (!manager.isToolAllowedInPlanMode(tool)) {
        throw new Error(`Read tool ${tool} should be allowed`);
      }
    }

    manager.destroy();
  })();

  await test('Should allow search tools in plan mode', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    const searchTools = ['Glob', 'Grep', 'search', 'WebSearch'];
    for (const tool of searchTools) {
      if (!manager.isToolAllowedInPlanMode(tool)) {
        throw new Error(`Search tool ${tool} should be allowed`);
      }
    }

    manager.destroy();
  })();

  await test('Should block write tools in plan mode', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    const writeTools = ['Write', 'Edit', 'file_writer', 'NotebookEdit'];
    for (const tool of writeTools) {
      if (manager.isToolAllowedInPlanMode(tool)) {
        throw new Error(`Write tool ${tool} should be blocked`);
      }
    }

    manager.destroy();
  })();

  await test('Should block execute tools in plan mode', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    const execTools = ['Bash', 'execute_command', 'run_script', 'deploy'];
    for (const tool of execTools) {
      if (manager.isToolAllowedInPlanMode(tool)) {
        throw new Error(`Execute tool ${tool} should be blocked`);
      }
    }

    manager.destroy();
  })();

  await test('Should block delete tools in plan mode', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    const deleteTools = ['delete_file', 'remove_directory'];
    for (const tool of deleteTools) {
      if (manager.isToolAllowedInPlanMode(tool)) {
        throw new Error(`Delete tool ${tool} should be blocked`);
      }
    }

    manager.destroy();
  })();

  console.log();
  console.log('5. Hook System Integration');
  console.log('-'.repeat(40));

  await test('Should integrate with hook system', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const { HookSystem, HookResult } = require(path.join(srcPath, 'hooks'));

    const hookSystem = new HookSystem({ autoLoadConfig: false });
    await hookSystem.initialize();

    const manager = new PlanModeManager();
    manager.setHookSystem(hookSystem);

    // Enter plan mode
    manager.enterPlanMode({ title: 'Hook Test' });

    // Trigger PreToolUse for a blocked tool
    const writeResult = await hookSystem.trigger('PreToolUse', { toolName: 'Write' });
    if (!writeResult.prevented) {
      throw new Error('Write should be prevented in plan mode');
    }

    // Trigger PreToolUse for an allowed tool
    const readResult = await hookSystem.trigger('PreToolUse', { toolName: 'Read' });
    if (readResult.prevented) {
      throw new Error('Read should be allowed in plan mode');
    }

    // Check that blocked operation was recorded
    const plan = manager.getCurrentPlan();
    const blockedItem = plan.items.find((i) => i.title.includes('Write'));
    if (!blockedItem) {
      throw new Error('Blocked operation should be recorded in plan');
    }

    manager.destroy();
    hookSystem.clear();
  })();

  await test('Should not block tools when not in plan mode', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const { HookSystem } = require(path.join(srcPath, 'hooks'));

    const hookSystem = new HookSystem({ autoLoadConfig: false });
    await hookSystem.initialize();

    const manager = new PlanModeManager();
    manager.setHookSystem(hookSystem);

    // Don't enter plan mode

    // Trigger PreToolUse for a write tool
    const result = await hookSystem.trigger('PreToolUse', { toolName: 'Write' });
    if (result.prevented) {
      throw new Error('Write should be allowed when not in plan mode');
    }

    manager.destroy();
    hookSystem.clear();
  })();

  console.log();
  console.log('6. Statistics and History');
  console.log('-'.repeat(40));

  await test('Should track statistics', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    // Create and approve a plan
    manager.enterPlanMode({ title: 'Stats Test 1' });
    manager.addPlanItem({ title: 'Step' });
    manager.markPlanReady();
    manager.approvePlan();
    manager.exitPlanMode();

    // Create and reject a plan
    manager.enterPlanMode({ title: 'Stats Test 2' });
    manager.addPlanItem({ title: 'Step' });
    manager.markPlanReady();
    manager.rejectPlan();

    const stats = manager.getStats();
    if (stats.plansCreated !== 2) throw new Error(`Wrong plansCreated: ${stats.plansCreated}`);
    if (stats.plansApproved !== 1) throw new Error(`Wrong plansApproved: ${stats.plansApproved}`);
    if (stats.plansRejected !== 1) throw new Error(`Wrong plansRejected: ${stats.plansRejected}`);

    manager.destroy();
  })();

  await test('Should maintain history', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    for (let i = 0; i < 3; i++) {
      manager.enterPlanMode({ title: `History Plan ${i}` });
      manager.addPlanItem({ title: `Step ${i}` });
      manager.exitPlanMode();
    }

    const history = manager.getPlansHistory({ limit: 10 });
    if (history.length !== 3) throw new Error(`Wrong history length: ${history.length}`);

    // Most recent first
    if (history[0].title !== 'History Plan 2') {
      throw new Error(`Wrong order: ${history[0].title}`);
    }

    manager.destroy();
  })();

  await test('Should generate plan summary', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    manager.enterPlanMode({ title: 'Summary Test', goal: 'Generate a nice summary' });
    manager.addPlanItem({ title: 'Read files', tool: 'Read' });
    manager.addPlanItem({ title: 'Search code', tool: 'Grep' });

    const summary = manager.generatePlanSummary();

    if (!summary.includes('Summary Test')) throw new Error('Missing title');
    if (!summary.includes('Generate a nice summary')) throw new Error('Missing goal');
    if (!summary.includes('Read files')) throw new Error('Missing step 1');
    if (!summary.includes('Search code')) throw new Error('Missing step 2');

    manager.destroy();
  })();

  console.log();
  console.log('7. Events');
  console.log('-'.repeat(40));

  await test('Should emit lifecycle events', async () => {
    const { PlanModeManager } = require(path.join(srcPath, 'ai-engine/plan-mode'));
    const manager = new PlanModeManager();

    const events = [];

    manager.on('enter', () => events.push('enter'));
    manager.on('item-added', () => events.push('item-added'));
    manager.on('plan-ready', () => events.push('plan-ready'));
    manager.on('plan-approved', () => events.push('plan-approved'));
    manager.on('exit', () => events.push('exit'));

    manager.enterPlanMode({ title: 'Event Test' });
    manager.addPlanItem({ title: 'Step' });
    manager.markPlanReady();
    manager.approvePlan();
    manager.exitPlanMode();

    const expected = ['enter', 'item-added', 'plan-ready', 'plan-approved', 'exit'];
    if (JSON.stringify(events) !== JSON.stringify(expected)) {
      throw new Error(`Wrong events: ${events.join(', ')} (expected: ${expected.join(', ')})`);
    }

    manager.destroy();
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
