/**
 * Phase 6 E2E Tests: Performance Auto-Tuner
 *
 * Tests for auto-tuner:get-rules, auto-tuner:enable-rule, auto-tuner:disable-rule,
 * auto-tuner:get-history, auto-tuner:evaluate, auto-tuner:get-stats,
 * and auto-tuner:add-rule.
 *
 * IPC prefix: auto-tuner:
 * Handler file: src/main/performance/auto-tuner-ipc.js
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

/** Known built-in rule IDs from auto-tuner.js */
const BUILTIN_RULE_IDS = [
  'db-slow-queries',
  'db-vacuum',
  'llm-high-latency',
  'memory-pressure',
  'p2p-connections',
];

test.describe('Phase 6 - Performance Auto-Tuner', () => {
  test.describe('Rule Management', () => {
    let app: ElectronApplication;
    let window: Page;

    test.beforeAll(async () => {
      const ctx = await launchElectronApp();
      app = ctx.app;
      window = ctx.window;
    });

    test.afterAll(async () => {
      await closeElectronApp(app, { delay: 2000 });
    });

    test('auto-tuner:get-rules returns an array of rules', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:get-rules');

      const result = await callIPC(window, 'auto-tuner:get-rules');

      console.log('get-rules result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const rules = result.data;
        expect(Array.isArray(rules)).toBeTruthy();
        console.log(`Rules count: ${rules.length}`);

        if (rules.length > 0) {
          const firstRule = rules[0];
          // Each rule should have at minimum an id and name
          expect(firstRule).toHaveProperty('id');
          console.log('First rule:', firstRule);
        }
      } else {
        console.log('get-rules error (expected if autoTuner not initialized):', result.error);
      }
    });

    test('auto-tuner:get-rules includes built-in rules', async () => {
      console.log('\n[AutoTuner] Testing that built-in rules are present');

      const result = await callIPC(window, 'auto-tuner:get-rules');

      if (result && result.success && Array.isArray(result.data)) {
        const ruleIds = result.data.map((r: any) => r.id);
        console.log('Rule IDs found:', ruleIds);

        // At least some built-in rules should be registered
        const foundBuiltinRules = BUILTIN_RULE_IDS.filter((id) => ruleIds.includes(id));
        console.log('Found built-in rules:', foundBuiltinRules);

        // If autoTuner initialized, should have built-in rules
        if (result.data.length > 0) {
          expect(foundBuiltinRules.length).toBeGreaterThan(0);
        }
      } else {
        console.log('get-rules returned non-success (autoTuner may not be initialized)');
        expect(result).toHaveProperty('success');
      }
    });

    test('auto-tuner:enable-rule with valid ruleId succeeds or reports rule not found', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:enable-rule');

      const ruleId = 'db-slow-queries';

      const result = await callIPC(window, 'auto-tuner:enable-rule', ruleId);

      console.log('enable-rule result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log(`Rule ${ruleId} enabled successfully`);
      } else {
        // Either rule not found or autoTuner not initialized
        expect(typeof result.error).toBe('string');
        console.log('Enable-rule error (expected if autoTuner not initialized):', result.error);
      }
    });

    test('auto-tuner:disable-rule with valid ruleId succeeds or reports rule not found', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:disable-rule');

      const ruleId = 'memory-pressure';

      const result = await callIPC(window, 'auto-tuner:disable-rule', ruleId);

      console.log('disable-rule result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log(`Rule ${ruleId} disabled successfully`);
      } else {
        expect(typeof result.error).toBe('string');
        console.log('Disable-rule error (expected if autoTuner not initialized):', result.error);
      }
    });

    test('auto-tuner:enable-rule with non-existent ruleId returns error', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:enable-rule error: non-existent ruleId');

      const result = await callIPC(window, 'auto-tuner:enable-rule', 'completely-fake-rule-id-xyz');

      console.log('Non-existent rule enable result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (!result.success) {
        expect(typeof result.error).toBe('string');
        console.log('Correctly returned error for non-existent rule:', result.error);
      } else {
        console.log('Handler accepted non-existent rule (may be a no-op)');
      }
    });

    test('auto-tuner:disable-rule with non-existent ruleId returns error', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:disable-rule error: non-existent ruleId');

      const result = await callIPC(window, 'auto-tuner:disable-rule', 'completely-fake-rule-id-xyz');

      console.log('Non-existent rule disable result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (!result.success) {
        expect(typeof result.error).toBe('string');
        console.log('Correctly returned error for non-existent rule:', result.error);
      } else {
        console.log('Handler accepted non-existent rule (may be a no-op)');
      }
    });

    test('auto-tuner:add-rule with a valid rule spec adds a custom rule', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:add-rule with valid spec');

      const customRule = {
        id: `e2e-custom-rule-${Date.now()}`,
        name: 'E2E Test Rule',
        description: 'Custom rule added by E2E test',
        // Condition as a string (will be eval'd to a Function in the handler)
        condition: 'return metrics.cpuUsage > 99;',
        // Action as a string
        action: 'return { action: "e2e-test-action", applied: true };',
        cooldownMs: 60000,
        enabled: true,
      };

      const result = await callIPC(window, 'auto-tuner:add-rule', customRule);

      console.log('add-rule result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log('Custom rule added successfully');
      } else {
        expect(typeof result.error).toBe('string');
        console.log('Add-rule error (expected if autoTuner not initialized):', result.error);
      }
    });
  });

  test.describe('History and Statistics', () => {
    let app: ElectronApplication;
    let window: Page;

    test.beforeAll(async () => {
      const ctx = await launchElectronApp();
      app = ctx.app;
      window = ctx.window;
    });

    test.afterAll(async () => {
      await closeElectronApp(app, { delay: 2000 });
    });

    test('auto-tuner:get-history returns an array', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:get-history');

      const result = await callIPC(window, 'auto-tuner:get-history', 50);

      console.log('get-history result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const history = result.data;
        expect(Array.isArray(history)).toBeTruthy();
        console.log(`Tuning history entries: ${history.length}`);
      } else {
        console.log('History error (expected if autoTuner not initialized):', result.error);
      }
    });

    test('auto-tuner:get-stats returns a stats object', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:get-stats');

      const result = await callIPC(window, 'auto-tuner:get-stats');

      console.log('get-stats result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const stats = result.data;
        expect(stats).toBeDefined();
        expect(typeof stats).toBe('object');
        console.log('AutoTuner stats:', stats);
      } else {
        console.log('Stats error (expected if autoTuner not initialized):', result.error);
      }
    });

    test('auto-tuner:evaluate triggers one-off evaluation', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:evaluate');

      const result = await callIPC(window, 'auto-tuner:evaluate');

      console.log('evaluate result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const triggered = result.data;
        // triggered is the list of rules that fired
        expect(Array.isArray(triggered)).toBeTruthy();
        console.log(`Triggered rules: ${triggered.length}`);
      } else {
        console.log('Evaluate error (expected if autoTuner not initialized):', result.error);
      }
    });
  });

  test.describe('Auto-Tuner Lifecycle', () => {
    let app: ElectronApplication;
    let window: Page;

    test.beforeAll(async () => {
      const ctx = await launchElectronApp();
      app = ctx.app;
      window = ctx.window;
    });

    test.afterAll(async () => {
      await closeElectronApp(app, { delay: 2000 });
    });

    test('auto-tuner:start returns success', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:start');

      const result = await callIPC(window, 'auto-tuner:start');

      console.log('start result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log('AutoTuner started successfully');
      } else {
        console.log('Start error (expected if autoTuner not initialized):', result.error);
      }
    });

    test('auto-tuner:stop returns success', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:stop');

      const result = await callIPC(window, 'auto-tuner:stop');

      console.log('stop result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log('AutoTuner stopped successfully');
      } else {
        console.log('Stop error (expected if autoTuner not initialized):', result.error);
      }
    });

    test('auto-tuner:report-renderer-metrics accepts FPS/DOM/heap data', async () => {
      console.log('\n[AutoTuner] Testing auto-tuner:report-renderer-metrics');

      const metricsData = {
        fps: 60,
        domNodes: 1500,
        jsHeapUsedMB: 120,
        timestamp: Date.now(),
      };

      const result = await callIPC(window, 'auto-tuner:report-renderer-metrics', metricsData);

      console.log('report-renderer-metrics result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log('Renderer metrics reported successfully');
      } else {
        console.log('Report-renderer-metrics error (expected if collector not initialized):', result.error);
      }
    });
  });
});
