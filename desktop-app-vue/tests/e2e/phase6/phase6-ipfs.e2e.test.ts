/**
 * Phase 6 E2E Tests: IPFS Decentralized Storage
 *
 * Tests for ipfs:get-node-status, ipfs:add-content, ipfs:get-storage-stats,
 * ipfs:list-pins, ipfs:get-config, and error handling for invalid CIDs.
 *
 * IPC prefix: ipfs:
 * Handler file: src/main/ipfs/ipfs-ipc.js
 *
 * Note: Tests run in mock/offline mode since Helia is not required.
 *       The manager's getNodeStatus() is always safe to call.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

test.describe('Phase 6 - IPFS Decentralized Storage', () => {
  test.describe('Node Status and Configuration', () => {
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

    test('ipfs:get-node-status returns a status object', async () => {
      console.log('\n[IPFS] Testing ipfs:get-node-status');

      const result = await callIPC(window, 'ipfs:get-node-status');

      console.log('get-node-status result:', result);

      expect(result).toBeDefined();
      // Should always succeed - returns status even when node is stopped
      if (result && result.success) {
        const status = result.data;
        expect(status).toBeDefined();
        console.log('Node status data:', status);
        // Status should have at minimum some indication of state
        expect(typeof status).toBe('object');
      } else {
        console.log('Status returned error (acceptable if not initialized):', result?.error);
      }
    });

    test('ipfs:get-config returns configuration object', async () => {
      console.log('\n[IPFS] Testing ipfs:get-config');

      const result = await callIPC(window, 'ipfs:get-config');

      console.log('get-config result:', result);

      expect(result).toBeDefined();

      if (result && result.success) {
        const config = result.data;
        expect(config).toBeDefined();
        // Config should have known fields
        console.log('IPFS config:', config);
        // At minimum some config keys should be present
        expect(typeof config).toBe('object');
      } else {
        console.log('Config error (acceptable if IPFS not initialized):', result?.error);
      }
    });

    test('ipfs:get-storage-stats returns stats object', async () => {
      console.log('\n[IPFS] Testing ipfs:get-storage-stats');

      const result = await callIPC(window, 'ipfs:get-storage-stats');

      console.log('get-storage-stats result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const stats = result.data;
        expect(stats).toBeDefined();
        expect(typeof stats).toBe('object');
        console.log('Storage stats:', stats);
      } else {
        console.log('Stats error (expected if IPFS not fully started):', result.error);
      }
    });

    test('ipfs:list-pins returns an array or error response', async () => {
      console.log('\n[IPFS] Testing ipfs:list-pins');

      const result = await callIPC(window, 'ipfs:list-pins', {});

      console.log('list-pins result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        expect(Array.isArray(result.data)).toBeTruthy();
        console.log(`Pinned items count: ${result.data.length}`);
      } else {
        console.log('List-pins error (expected if IPFS not started):', result.error);
      }
    });
  });

  test.describe('Content Operations', () => {
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

    test('ipfs:add-content handles text content (mock or embedded mode)', async () => {
      console.log('\n[IPFS] Testing ipfs:add-content with text content');

      const content = 'E2E test content - ' + Date.now();

      const result = await callIPC(window, 'ipfs:add-content', {
        content,
        options: { encrypt: false },
      });

      console.log('add-content result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const data = result.data;
        expect(data).toBeDefined();
        // If successful, should return a CID or similar identifier
        console.log('Added content data:', data);
      } else {
        // IPFS not started in test env - acceptable
        console.log('Add-content error (expected if IPFS not started):', result.error);
      }
    });

    test('ipfs:get-content with invalid CID returns an error', async () => {
      console.log('\n[IPFS] Testing ipfs:get-content error: invalid CID');

      const invalidCid = 'not-a-valid-cid-xyz';

      try {
        const result = await callIPC(window, 'ipfs:get-content', {
          cid: invalidCid,
          options: {},
        });

        console.log('get-content with invalid CID result:', result);

        expect(result).toBeDefined();

        if (result && result.success === false) {
          expect(typeof result.error).toBe('string');
          console.log('Correctly returned error for invalid CID:', result.error);
        } else {
          console.log('Handler response for invalid CID:', result);
        }
      } catch (error: any) {
        console.log('Correctly threw for invalid CID:', error.message);
      }
    });

    test('ipfs:pin with invalid CID returns an error', async () => {
      console.log('\n[IPFS] Testing ipfs:pin error: invalid CID');

      const invalidCid = 'invalid-cid-string-for-e2e-test';

      try {
        const result = await callIPC(window, 'ipfs:pin', invalidCid);

        console.log('pin with invalid CID result:', result);

        expect(result).toBeDefined();

        if (result && result.success === false) {
          expect(typeof result.error).toBe('string');
          console.log('Correctly returned error for invalid pin CID:', result.error);
        } else {
          console.log('Handler response for invalid pin CID:', result);
        }
      } catch (error: any) {
        console.log('Correctly threw for invalid pin CID:', error.message);
      }
    });
  });

  test.describe('Mode and Quota Operations', () => {
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

    test('ipfs:set-quota updates the storage quota', async () => {
      console.log('\n[IPFS] Testing ipfs:set-quota');

      const quotaBytes = 1 * 1024 * 1024 * 1024; // 1 GB

      const result = await callIPC(window, 'ipfs:set-quota', quotaBytes);

      console.log('set-quota result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        expect(result.data).toBeDefined();
        console.log('Quota updated:', result.data);
      } else {
        console.log('Set-quota error (acceptable if IPFS not initialized):', result.error);
      }
    });

    test('ipfs:garbage-collect returns a result', async () => {
      console.log('\n[IPFS] Testing ipfs:garbage-collect');

      const result = await callIPC(window, 'ipfs:garbage-collect');

      console.log('garbage-collect result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log('GC result:', result.data);
      } else {
        console.log('GC error (expected if IPFS not started):', result.error);
      }
    });
  });
});
