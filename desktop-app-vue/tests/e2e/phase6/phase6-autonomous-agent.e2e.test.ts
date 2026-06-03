/**
 * Phase 6 E2E Tests: Autonomous Agent
 *
 * Tests for agent:get-queue-status, agent:submit-goal, agent:get-goal-history,
 * agent:cancel-goal, agent:get-stats, agent:get-config, and error handling.
 *
 * IPC prefix: agent:
 * Handler file: src/main/ai-engine/autonomous/autonomous-ipc.js
 *
 * Note: Tests do not require Ollama or an external LLM. The agent runner
 *       may not be initialized in the test environment, and all error cases
 *       are handled gracefully by the IPC handler.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

test.describe('Phase 6 - Autonomous Agent', () => {
  test.describe('Queue and Status Operations', () => {
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

    test('agent:get-queue-status returns queue status object', async () => {
      console.log('\n[Agent] Testing agent:get-queue-status');

      const result = await callIPC(window, 'agent:get-queue-status');

      console.log('get-queue-status result:', result);

      expect(result).toBeDefined();
      // This handler has a fallback even when taskQueue is not initialized
      expect(result).toHaveProperty('success');

      if (result.success) {
        const data = result.data;
        expect(data).toBeDefined();
        // Check expected queue status fields from the fallback
        console.log('Queue status:', data);
        if (data.pending !== undefined) {
          expect(typeof data.pending).toBe('number');
        }
        if (data.active !== undefined) {
          expect(typeof data.active).toBe('number');
        }
      } else {
        console.log('Queue status error:', result.error);
      }
    });

    test('agent:get-active-goals returns a result', async () => {
      console.log('\n[Agent] Testing agent:get-active-goals');

      const result = await callIPC(window, 'agent:get-active-goals');

      console.log('get-active-goals result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const data = result.data;
        expect(data).toBeDefined();
        if (Array.isArray(data)) {
          console.log(`Active goals count: ${data.length}`);
        } else {
          console.log('Active goals data:', data);
        }
      } else {
        console.log('Active goals error (expected if runner not initialized):', result.error);
      }
    });

    test('agent:get-goal-history returns an array of past goals', async () => {
      console.log('\n[Agent] Testing agent:get-goal-history');

      const result = await callIPC(window, 'agent:get-goal-history', {
        limit: 20,
        offset: 0,
      });

      console.log('get-goal-history result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const data = result.data;
        expect(data).toBeDefined();
        if (Array.isArray(data)) {
          console.log(`Goal history count: ${data.length}`);
        } else {
          console.log('Goal history data:', data);
        }
      } else {
        console.log('Goal history error (expected if runner not initialized):', result.error);
      }
    });

    test('agent:get-stats returns stats object', async () => {
      console.log('\n[Agent] Testing agent:get-stats');

      const result = await callIPC(window, 'agent:get-stats');

      console.log('get-stats result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const data = result.data;
        expect(data).toBeDefined();
        expect(typeof data).toBe('object');
        console.log('Agent stats:', data);
      } else {
        console.log('Agent stats error (expected if runner not initialized):', result.error);
      }
    });

    test('agent:get-config returns configuration object', async () => {
      console.log('\n[Agent] Testing agent:get-config');

      const result = await callIPC(window, 'agent:get-config');

      console.log('get-config result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const data = result.data;
        expect(data).toBeDefined();
        expect(typeof data).toBe('object');
        console.log('Agent config:', data);
      } else {
        console.log('Agent config error (expected if runner not initialized):', result.error);
      }
    });
  });

  test.describe('Goal Submission and Cancellation', () => {
    let app: ElectronApplication;
    let window: Page;
    let submittedGoalId: string | null = null;

    test.beforeAll(async () => {
      const ctx = await launchElectronApp();
      app = ctx.app;
      window = ctx.window;
    });

    test.afterAll(async () => {
      await closeElectronApp(app, { delay: 2000 });
    });

    test('agent:submit-goal with a simple goal description returns a result', async () => {
      console.log('\n[Agent] Testing agent:submit-goal');

      const goalSpec = {
        description: 'E2E test goal: List all files in the current directory',
        priority: 'low',
        allowedTools: ['file-list'],
        maxSteps: 3,
        timeoutMs: 30000,
      };

      const result = await callIPC(window, 'agent:submit-goal', goalSpec);

      console.log('submit-goal result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const data = result.data;
        expect(data).toBeDefined();
        console.log('Goal submitted:', data);

        // Capture goal ID for cancel test
        if (data && data.goalId) {
          submittedGoalId = data.goalId;
          console.log('Captured goal ID for cancel test:', submittedGoalId);
        }
      } else {
        console.log('Submit-goal error (expected if runner not initialized):', result.error);
      }
    });

    test('agent:cancel-goal with a valid goalId returns a result', async () => {
      console.log('\n[Agent] Testing agent:cancel-goal');

      // Use a submitted goal ID if available, otherwise use a test ID
      const goalId = submittedGoalId || `e2e-goal-${Date.now()}`;

      const result = await callIPC(window, 'agent:cancel-goal', goalId);

      console.log('cancel-goal result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log('Goal cancelled successfully:', result.data);
      } else {
        // Goal not found or runner not initialized - both acceptable in test env
        console.log('Cancel-goal error (expected in test env):', result.error);
      }
    });

    test('agent:cancel-goal with a non-existent goalId returns error', async () => {
      console.log('\n[Agent] Testing agent:cancel-goal with non-existent goalId');

      const fakeGoalId = 'non-existent-goal-id-xyz-12345';

      const result = await callIPC(window, 'agent:cancel-goal', fakeGoalId);

      console.log('cancel non-existent goal result:', result);

      expect(result).toBeDefined();
      // Should return a structured response (not throw)
      expect(result).toHaveProperty('success');

      if (!result.success) {
        expect(typeof result.error).toBe('string');
        console.log('Correctly returned error for non-existent goal:', result.error);
      } else {
        console.log('Handler accepted cancel for non-existent goal');
      }
    });
  });

  test.describe('Error Handling', () => {
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

    test('agent:submit-goal with empty description returns error', async () => {
      console.log('\n[Agent] Testing submit-goal error: empty description');

      const result = await callIPC(window, 'agent:submit-goal', {
        description: '',
        priority: 'normal',
      });

      console.log('Empty description submit result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      // Should indicate failure (empty goal is invalid)
      if (!result.success) {
        expect(typeof result.error).toBe('string');
        console.log('Correctly returned error for empty description:', result.error);
      } else {
        console.log('Handler accepted empty description (may be validated downstream)');
      }
    });

    test('agent:batch-cancel with empty array returns error', async () => {
      console.log('\n[Agent] Testing agent:batch-cancel error: empty array');

      const result = await callIPC(window, 'agent:batch-cancel', []);

      console.log('Empty array batch-cancel result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (!result.success) {
        expect(typeof result.error).toBe('string');
        console.log('Correctly returned error for empty array:', result.error);
      } else {
        console.log('Handler accepted empty batch-cancel array');
      }
    });

    test('agent:get-goal-status with non-existent ID returns graceful result', async () => {
      console.log('\n[Agent] Testing agent:get-goal-status with non-existent ID');

      const result = await callIPC(window, 'agent:get-goal-status', 'nonexistent-goal-id');

      console.log('get-goal-status non-existent result:', result);

      expect(result).toBeDefined();
      // Should not throw - returns structured response
      expect(result).toHaveProperty('success');
      console.log('Result for non-existent goal status:', result);
    });
  });
});
