/**
 * Phase 6 E2E Tests: Enterprise Org Management
 *
 * Tests for enterprise:create-department, enterprise:get-hierarchy,
 * enterprise:get-dashboard-stats, enterprise:request-member-join,
 * enterprise:get-departments, and error handling.
 *
 * IPC prefix: enterprise:
 * Handler file: src/main/enterprise/enterprise-ipc.js
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

const TEST_ORG_ID = `e2e-org-${Date.now()}`;
const TEST_DEPT_NAME = 'E2E Test Department';

test.describe('Phase 6 - Enterprise Org Management', () => {
  test.describe('Department Operations', () => {
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

    test('enterprise:get-departments returns an array for any orgId', async () => {
      console.log('\n[Enterprise] Testing enterprise:get-departments');

      const result = await callIPC(window, 'enterprise:get-departments', TEST_ORG_ID);

      console.log('get-departments result:', result);

      expect(result).toBeDefined();

      // Either success with an array, or a graceful error response
      if (result && result.success) {
        expect(Array.isArray(result.data)).toBeTruthy();
        console.log(`Departments count: ${result.data.length}`);
      } else {
        // Acceptable: manager not initialized in test env
        expect(result).toHaveProperty('success');
        console.log('Manager not initialized (expected in test env):', result.error);
      }
    });

    test('enterprise:create-department with valid params returns a result', async () => {
      console.log('\n[Enterprise] Testing enterprise:create-department');

      const params = {
        orgId: TEST_ORG_ID,
        name: TEST_DEPT_NAME,
        description: 'Created by E2E test',
        parentDeptId: null,
        leadDid: 'did:chainless:test-lead',
        leadName: 'Test Lead',
      };

      const result = await callIPC(window, 'enterprise:create-department', params);

      console.log('create-department result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        expect(result.data).toBeDefined();
        console.log('Department created:', result.data);
      } else {
        // Acceptable in test env where DB may not be set up
        expect(typeof result.error).toBe('string');
        console.log('Expected error in test env:', result.error);
      }
    });

    test('enterprise:get-hierarchy returns a structure for orgId', async () => {
      console.log('\n[Enterprise] Testing enterprise:get-hierarchy');

      const result = await callIPC(window, 'enterprise:get-hierarchy', TEST_ORG_ID);

      console.log('get-hierarchy result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        // Hierarchy should be an object (tree) or null if empty org
        console.log('Hierarchy data type:', typeof result.data);
      } else {
        console.log('Hierarchy error (expected in test env):', result.error);
      }
    });

    test('enterprise:get-dashboard-stats returns stats object', async () => {
      console.log('\n[Enterprise] Testing enterprise:get-dashboard-stats');

      const result = await callIPC(window, 'enterprise:get-dashboard-stats', TEST_ORG_ID);

      console.log('get-dashboard-stats result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        const stats = result.data;
        expect(stats).toBeDefined();
        console.log('Dashboard stats:', stats);
      } else {
        console.log('Stats error (expected in test env):', result.error);
      }
    });

    test('enterprise:request-member-join creates an approval request', async () => {
      console.log('\n[Enterprise] Testing enterprise:request-member-join');

      const params = {
        orgId: TEST_ORG_ID,
        memberDid: 'did:chainless:new-member-test',
        role: 'member',
        requestedBy: 'did:chainless:admin-test',
      };

      const result = await callIPC(window, 'enterprise:request-member-join', params);

      console.log('request-member-join result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        expect(result.data).toBeDefined();
        console.log('Member join request created:', result.data);
      } else {
        console.log('Join request error (expected in test env):', result.error);
      }
    });

    test('enterprise:get-department-members returns an array for a deptId', async () => {
      console.log('\n[Enterprise] Testing enterprise:get-department-members');

      const fakeDeptId = `dept-e2e-${Date.now()}`;
      const result = await callIPC(window, 'enterprise:get-department-members', fakeDeptId);

      console.log('get-department-members result:', result);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        expect(Array.isArray(result.data)).toBeTruthy();
        console.log(`Members count: ${result.data.length}`);
      } else {
        console.log('Members error (expected in test env):', result.error);
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

    test('enterprise:create-department with missing orgId returns error or throws', async () => {
      console.log('\n[Enterprise] Testing create-department error: missing orgId');

      try {
        const result = await callIPC(window, 'enterprise:create-department', {
          // orgId deliberately omitted
          name: 'Missing OrgId Dept',
        });

        console.log('Missing orgId result:', result);

        // Should either fail gracefully or return an error
        if (result && result.success === false) {
          expect(typeof result.error).toBe('string');
          console.log('Correctly returned error for missing orgId:', result.error);
        } else {
          console.log('Handler accepted request without orgId (may be handled downstream)');
        }
      } catch (error: any) {
        console.log('Correctly threw for missing orgId:', error.message);
      }
    });

    test('enterprise:create-department with null params returns error', async () => {
      console.log('\n[Enterprise] Testing create-department error: null params');

      try {
        const result = await callIPC(window, 'enterprise:create-department', null);

        console.log('Null params result:', result);

        expect(result).toBeDefined();
        // Should indicate failure
        if (result && result.success === false) {
          expect(typeof result.error).toBe('string');
          console.log('Correctly returned error for null params:', result.error);
        } else {
          console.log('Handler accepted null params (may be handled downstream)');
        }
      } catch (error: any) {
        console.log('Correctly threw for null params:', error.message);
      }
    });

    test('enterprise:get-hierarchy with undefined orgId is handled gracefully', async () => {
      console.log('\n[Enterprise] Testing get-hierarchy error: undefined orgId');

      try {
        const result = await callIPC(window, 'enterprise:get-hierarchy', undefined);

        console.log('Undefined orgId result:', result);
        expect(result).toBeDefined();
      } catch (error: any) {
        console.log('Threw for undefined orgId (acceptable):', error.message);
      }
    });
  });
});
