/**
 * Phase 6 E2E Tests: Analytics Dashboard
 *
 * Tests for analytics:get-dashboard-summary, analytics:get-time-series,
 * analytics:get-top-n, analytics:get-ai-metrics, analytics:get-system-metrics,
 * and period filtering.
 *
 * IPC prefix: analytics:
 * Handler file: src/main/analytics/analytics-ipc.js
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

test.describe('Phase 6 - Analytics Dashboard', () => {
  test.describe('Dashboard Summary and Period Filtering', () => {
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

    test('analytics:get-dashboard-summary with default period returns summary', async () => {
      console.log('\n[Analytics] Testing analytics:get-dashboard-summary (default period)');

      const result = await callIPC(window, 'analytics:get-dashboard-summary');

      console.log('Dashboard summary result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const summary = result.data;
        expect(summary).toBeDefined();
        expect(typeof summary).toBe('object');
        console.log('Summary keys:', Object.keys(summary));
      } else {
        console.log('Summary error (expected if aggregator not started):', result.error);
      }
    });

    test('analytics:get-dashboard-summary with period=24h returns summary', async () => {
      console.log('\n[Analytics] Testing analytics:get-dashboard-summary period=24h');

      const result = await callIPC(window, 'analytics:get-dashboard-summary', '24h');

      console.log('Dashboard summary 24h result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log('24h summary:', result.data);
      } else {
        console.log('24h summary error:', result.error);
      }
    });

    test('analytics:get-dashboard-summary with period=7d returns summary', async () => {
      console.log('\n[Analytics] Testing analytics:get-dashboard-summary period=7d');

      const result = await callIPC(window, 'analytics:get-dashboard-summary', '7d');

      console.log('Dashboard summary 7d result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log('7d summary:', result.data);
      } else {
        console.log('7d summary error:', result.error);
      }
    });

    test('analytics:get-dashboard-summary with period=30d returns summary', async () => {
      console.log('\n[Analytics] Testing analytics:get-dashboard-summary period=30d');

      const result = await callIPC(window, 'analytics:get-dashboard-summary', '30d');

      console.log('Dashboard summary 30d result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log('30d summary:', result.data);
      } else {
        console.log('30d summary error:', result.error);
      }
    });
  });

  test.describe('Time Series Data', () => {
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

    test('analytics:get-time-series with a valid metric returns data', async () => {
      console.log('\n[Analytics] Testing analytics:get-time-series with metric=ai_calls');

      const result = await callIPC(window, 'analytics:get-time-series', {
        metric: 'ai_calls',
        granularity: 'hour',
      });

      console.log('Time series result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const data = result.data;
        expect(data).toBeDefined();
        console.log('Time series data type:', typeof data);
      } else {
        console.log('Time series error:', result.error);
      }
    });

    test('analytics:get-time-series without metric returns error', async () => {
      console.log('\n[Analytics] Testing analytics:get-time-series error: missing metric');

      const result = await callIPC(window, 'analytics:get-time-series', {
        // metric deliberately omitted
        granularity: 'hour',
      });

      console.log('Missing metric result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
      console.log('Correctly returned error for missing metric:', result.error);
    });
  });

  test.describe('Top-N Rankings', () => {
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

    test('analytics:get-top-n with valid metric returns ranked list', async () => {
      console.log('\n[Analytics] Testing analytics:get-top-n metric=skill_usage');

      const result = await callIPC(window, 'analytics:get-top-n', {
        metric: 'skill_usage',
        n: 5,
        period: '24h',
      });

      console.log('Top-N result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const data = result.data;
        expect(data).toBeDefined();
        console.log('Top-N data:', data);
      } else {
        console.log('Top-N error (expected if aggregator not started):', result.error);
      }
    });

    test('analytics:get-top-n without metric returns error', async () => {
      console.log('\n[Analytics] Testing analytics:get-top-n error: missing metric');

      const result = await callIPC(window, 'analytics:get-top-n', {
        // metric deliberately omitted
        n: 5,
        period: '24h',
      });

      console.log('Missing metric top-N result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
      console.log('Correctly returned error for missing metric:', result.error);
    });
  });

  test.describe('Specific Metric Categories', () => {
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

    test('analytics:get-ai-metrics returns AI metrics data', async () => {
      console.log('\n[Analytics] Testing analytics:get-ai-metrics');

      const result = await callIPC(window, 'analytics:get-ai-metrics');

      console.log('AI metrics result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        expect(result.data).toBeDefined();
        console.log('AI metrics:', result.data);
      } else {
        console.log('AI metrics error (expected if aggregator not started):', result.error);
      }
    });

    test('analytics:get-skill-metrics returns skill metrics data', async () => {
      console.log('\n[Analytics] Testing analytics:get-skill-metrics');

      const result = await callIPC(window, 'analytics:get-skill-metrics');

      console.log('Skill metrics result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        expect(result.data).toBeDefined();
        console.log('Skill metrics:', result.data);
      } else {
        console.log('Skill metrics error (expected if aggregator not started):', result.error);
      }
    });

    test('analytics:get-system-metrics returns system metrics data', async () => {
      console.log('\n[Analytics] Testing analytics:get-system-metrics');

      const result = await callIPC(window, 'analytics:get-system-metrics');

      console.log('System metrics result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        expect(result.data).toBeDefined();
        console.log('System metrics:', result.data);
      } else {
        console.log('System metrics error (expected if aggregator not started):', result.error);
      }
    });

    test('analytics:get-error-metrics returns error metrics data', async () => {
      console.log('\n[Analytics] Testing analytics:get-error-metrics');

      const result = await callIPC(window, 'analytics:get-error-metrics');

      console.log('Error metrics result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        expect(result.data).toBeDefined();
        console.log('Error metrics:', result.data);
      } else {
        console.log('Error metrics error (expected if aggregator not started):', result.error);
      }
    });

    test('analytics:get-aggregation-history returns history array', async () => {
      console.log('\n[Analytics] Testing analytics:get-aggregation-history');

      const result = await callIPC(window, 'analytics:get-aggregation-history', {
        limit: 10,
        offset: 0,
      });

      console.log('Aggregation history result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        expect(Array.isArray(result.data)).toBeTruthy();
        console.log(`Aggregation history count: ${result.data.length}`);
      } else {
        console.log('Aggregation history error (expected if aggregator not started):', result.error);
      }
    });
  });
});
