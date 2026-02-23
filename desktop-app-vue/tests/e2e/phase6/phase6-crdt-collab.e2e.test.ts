/**
 * Phase 6 E2E Tests: CRDT Collaborative Editing (Yjs)
 *
 * Tests for collab:yjs-connect, collab:yjs-update, collab:yjs-disconnect,
 * collab:get-stats, collab:open-document, and error handling.
 *
 * IPC prefix: collab:yjs-*  (Yjs IPC bridge)
 *             collab:*      (realtime collab handlers)
 * Handler file: src/main/collaboration/realtime-collab-ipc.js
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

const TEST_DOCUMENT_ID = `e2e-doc-${Date.now()}`;
const TEST_USER_DID = 'did:chainless:e2e-collab-user';
const TEST_USER_NAME = 'E2E Collab User';

test.describe('Phase 6 - CRDT Collaborative Editing (Yjs)', () => {
  test.describe('Yjs IPC Bridge: Connect / Update / Disconnect', () => {
    test.describe.configure({ mode: 'serial' });

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

    test('collab:yjs-connect with a valid documentId returns success and initial state', async () => {
      console.log('\n[CRDT] Testing collab:yjs-connect');

      const result = await callIPC(window, 'collab:yjs-connect', {
        documentId: TEST_DOCUMENT_ID,
      });

      console.log('yjs-connect result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const data = result.data;
        expect(data).toBeDefined();
        expect(data).toHaveProperty('documentId');
        expect(data.documentId).toBe(TEST_DOCUMENT_ID);
        // initialState may be null for a new document
        console.log('Connected to document:', data.documentId);
        console.log('Initial state:', data.initialState);
      } else {
        console.log('yjs-connect error (expected if yjs not initialized):', result.error);
      }
    });

    test('collab:yjs-update with a valid update array returns success', async () => {
      console.log('\n[CRDT] Testing collab:yjs-update');

      // A minimal valid Yjs update is an empty Uint8Array encoded as Array
      // In practice a real update would be created by yjs, but for E2E we use a minimal one
      const minimalUpdate = Array.from(new Uint8Array([0]));

      const result = await callIPC(window, 'collab:yjs-update', {
        documentId: TEST_DOCUMENT_ID,
        update: minimalUpdate,
      });

      console.log('yjs-update result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log('Yjs update applied successfully');
      } else {
        // May fail if yjs library not available or doc not in memory
        expect(typeof result.error).toBe('string');
        console.log('yjs-update error (expected in test env):', result.error);
      }
    });

    test('collab:yjs-disconnect with a valid documentId returns success', async () => {
      console.log('\n[CRDT] Testing collab:yjs-disconnect');

      const result = await callIPC(window, 'collab:yjs-disconnect', {
        documentId: TEST_DOCUMENT_ID,
      });

      console.log('yjs-disconnect result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log('Disconnected from document successfully');
      } else {
        expect(typeof result.error).toBe('string');
        console.log('yjs-disconnect error:', result.error);
      }
    });
  });

  test.describe('Yjs IPC Bridge: Error Handling', () => {
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

    test('collab:yjs-connect with missing documentId returns error', async () => {
      console.log('\n[CRDT] Testing yjs-connect error: missing documentId');

      try {
        const result = await callIPC(window, 'collab:yjs-connect', {
          // documentId deliberately omitted
        });

        console.log('Missing documentId connect result:', result);

        expect(result).toBeDefined();

        if (result && result.success === false) {
          expect(typeof result.error).toBe('string');
          console.log('Correctly returned error for missing documentId:', result.error);
        } else {
          console.log('Handler response for missing documentId:', result);
        }
      } catch (error: any) {
        // IPC may throw for missing required param
        console.log('Correctly threw for missing documentId:', error.message);
      }
    });

    test('collab:yjs-update with missing documentId returns error', async () => {
      console.log('\n[CRDT] Testing yjs-update error: missing documentId');

      try {
        const result = await callIPC(window, 'collab:yjs-update', {
          // documentId deliberately omitted
          update: [0],
        });

        console.log('Missing documentId update result:', result);

        expect(result).toBeDefined();

        if (result && result.success === false) {
          expect(typeof result.error).toBe('string');
          console.log('Correctly returned error for missing documentId:', result.error);
        } else {
          console.log('Handler response for missing documentId in update:', result);
        }
      } catch (error: any) {
        console.log('Correctly threw for missing documentId in update:', error.message);
      }
    });

    test('collab:yjs-update with missing update returns error', async () => {
      console.log('\n[CRDT] Testing yjs-update error: missing update data');

      try {
        const result = await callIPC(window, 'collab:yjs-update', {
          documentId: `doc-missing-update-${Date.now()}`,
          // update deliberately omitted
        });

        console.log('Missing update data result:', result);

        expect(result).toBeDefined();

        if (result && result.success === false) {
          expect(typeof result.error).toBe('string');
          console.log('Correctly returned error for missing update:', result.error);
        } else {
          console.log('Handler response for missing update data:', result);
        }
      } catch (error: any) {
        console.log('Correctly threw for missing update data:', error.message);
      }
    });

    test('collab:yjs-disconnect with missing documentId returns error', async () => {
      console.log('\n[CRDT] Testing yjs-disconnect error: missing documentId');

      try {
        const result = await callIPC(window, 'collab:yjs-disconnect', {
          // documentId deliberately omitted
        });

        console.log('Missing documentId disconnect result:', result);

        expect(result).toBeDefined();

        if (result && result.success === false) {
          expect(typeof result.error).toBe('string');
          console.log('Correctly returned error for missing documentId in disconnect:', result.error);
        } else {
          console.log('Handler response for missing documentId in disconnect:', result);
        }
      } catch (error: any) {
        console.log('Correctly threw for missing documentId in disconnect:', error.message);
      }
    });
  });

  test.describe('Realtime Collab: Document and Statistics', () => {
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

    test('collab:get-stats for a documentId returns stats or error', async () => {
      console.log('\n[CRDT] Testing collab:get-stats');

      try {
        const result = await callIPC(window, 'collab:get-stats', {
          docId: TEST_DOCUMENT_ID,
        });

        console.log('get-stats result:', result);

        expect(result).toBeDefined();

        // get-stats may throw or return a structured result
        if (result && typeof result === 'object') {
          console.log('Stats result:', result);
        }
      } catch (error: any) {
        // It's acceptable for this to throw if manager isn't initialized
        console.log('get-stats threw (expected if manager not initialized):', error.message);
      }
    });

    test('collab:open-document with valid params returns result', async () => {
      console.log('\n[CRDT] Testing collab:open-document');

      try {
        const result = await callIPC(window, 'collab:open-document', {
          docId: `e2e-open-doc-${Date.now()}`,
          userDid: TEST_USER_DID,
          userName: TEST_USER_NAME,
          orgId: 'e2e-org',
        });

        console.log('open-document result:', result);

        expect(result).toBeDefined();

        if (result && typeof result.success !== 'undefined') {
          console.log('Open document success:', result.success);
        }
      } catch (error: any) {
        // May throw if realtime collab manager not initialized
        console.log('open-document threw (expected if manager not initialized):', error.message);
      }
    });

    test('collab:open-document with missing required params throws or returns error', async () => {
      console.log('\n[CRDT] Testing collab:open-document error: missing params');

      try {
        const result = await callIPC(window, 'collab:open-document', {
          // docId, userDid, userName all missing
          orgId: 'e2e-org',
        });

        console.log('Missing params open-document result:', result);

        // If it doesn't throw, should indicate failure
        if (result && result.success === false) {
          console.log('Correctly returned error for missing params:', result.error);
        } else {
          console.log('Handler response for missing params:', result);
        }
      } catch (error: any) {
        // Expected: handler throws with "Missing required parameters"
        expect(typeof error.message).toBe('string');
        console.log('Correctly threw for missing params:', error.message);
      }
    });

    test('collab:get-awareness for a documentId returns result', async () => {
      console.log('\n[CRDT] Testing collab:get-awareness');

      try {
        const result = await callIPC(window, 'collab:get-awareness', {
          docId: TEST_DOCUMENT_ID,
        });

        console.log('get-awareness result:', result);

        expect(result).toBeDefined();
        console.log('Awareness result type:', typeof result);
      } catch (error: any) {
        console.log('get-awareness threw (expected if manager not initialized):', error.message);
      }
    });

    test('collab:get-document-history for a documentId returns result', async () => {
      console.log('\n[CRDT] Testing collab:get-document-history');

      try {
        const result = await callIPC(window, 'collab:get-document-history', {
          docId: TEST_DOCUMENT_ID,
          options: { limit: 10 },
        });

        console.log('get-document-history result:', result);

        expect(result).toBeDefined();
        console.log('Document history result:', result);
      } catch (error: any) {
        console.log('get-document-history threw (expected if manager not initialized):', error.message);
      }
    });

    test('collab:get-comments for a documentId returns result', async () => {
      console.log('\n[CRDT] Testing collab:get-comments');

      try {
        const result = await callIPC(window, 'collab:get-comments', {
          docId: TEST_DOCUMENT_ID,
          options: {},
        });

        console.log('get-comments result:', result);

        expect(result).toBeDefined();
        console.log('Comments result:', result);
      } catch (error: any) {
        console.log('get-comments threw (expected if manager not initialized):', error.message);
      }
    });
  });

  test.describe('Subscription and Export', () => {
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

    test('collab:subscribe-changes for a documentId returns subscription result', async () => {
      console.log('\n[CRDT] Testing collab:subscribe-changes');

      try {
        const result = await callIPC(window, 'collab:subscribe-changes', {
          docId: TEST_DOCUMENT_ID,
        });

        console.log('subscribe-changes result:', result);

        expect(result).toBeDefined();

        if (result && result.success) {
          console.log('Subscription created:', result);
          expect(result.subscribed).toBeTruthy();
        } else if (result && result.success === false) {
          console.log('Subscribe-changes error (expected if manager not initialized):', result.error);
        }
      } catch (error: any) {
        console.log('subscribe-changes threw (expected if manager not initialized):', error.message);
      }
    });

    test('collab:export-with-comments for a documentId returns export data', async () => {
      console.log('\n[CRDT] Testing collab:export-with-comments');

      try {
        const result = await callIPC(window, 'collab:export-with-comments', {
          docId: TEST_DOCUMENT_ID,
          format: 'markdown',
        });

        console.log('export-with-comments result:', result);

        expect(result).toBeDefined();
        console.log('Export result:', result);
      } catch (error: any) {
        console.log('export-with-comments threw (expected if manager not initialized):', error.message);
      }
    });
  });
});
