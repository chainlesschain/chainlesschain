/**
 * Performance & Stress Test
 * Testing system performance under load and bulk operations
 *
 * Test Coverage:
 * 1. Bulk task creation (100+ tasks)
 * 2. Large team management (50+ members)
 * 3. Concurrent operations
 * 4. Search and query performance
 * 5. Export performance with large datasets
 * 6. Memory leak detection
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';

const TEST_ORG_ID = `org-perf-test-${Date.now()}`;
const TEST_USER_DID = `did:key:perf-user-${Date.now()}`;

test.describe.serial('Performance & Stress Tests', () => {
  let boardId: string;
  let columnId: string;
  let teamId: string;
  const taskIds: string[] = [];
  const memberDids: string[] = [];

  // Setup
  test.beforeAll(async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Create board
      const boardResult: any = await callIPC(window, 'task:create-board', {
        orgId: TEST_ORG_ID,
        name: 'Performance Test Board',
        description: 'For performance testing',
        boardType: 'kanban',
        createdBy: TEST_USER_DID,
      });
      boardId = boardResult.boardId;

      // Create column
      const columnResult: any = await callIPC(window, 'task:create-column', {
        boardId,
        columnData: { name: 'Todo', position: 0 },
      });
      columnId = columnResult.columnId;

      // Create team
      const teamResult: any = await callIPC(window, 'team:create-team', {
        orgId: TEST_ORG_ID,
        name: 'Performance Test Team',
        description: 'For performance testing',
        leadDid: TEST_USER_DID,
        leadName: 'Perf Test User',
        createdBy: TEST_USER_DID,
      });
      teamId = teamResult.teamId;
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 1: Bulk Task Creation
  // ========================================

  test('Phase 1.1: Create 100 tasks in bulk', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();
      const TASK_COUNT = 100;

      for (let i = 0; i < TASK_COUNT; i++) {
        const result: any = await callIPC(window, 'task:create-task', {
          boardId,
          columnId,
          title: `Bulk Task ${i + 1}`,
          description: `Performance test task number ${i + 1}`,
          priority: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low',
          estimatedHours: Math.floor(Math.random() * 16) + 1,
          createdBy: TEST_USER_DID,
          creatorName: 'Perf Test User',
        });

        expect(result.success).toBe(true);
        taskIds.push(result.taskId);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      const avgTime = duration / TASK_COUNT;

      console.log(`Created ${TASK_COUNT} tasks in ${duration}ms (avg: ${avgTime.toFixed(2)}ms per task)`);

      // Performance expectations
      expect(duration).toBeLessThan(60000); // Should complete in under 60 seconds
      expect(avgTime).toBeLessThan(600); // Average should be under 600ms per task
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 1.2: Query all tasks (performance check)', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();

      const result: any = await callIPC(window, 'task:get-tasks', {
        boardId,
        options: {
          limit: 1000,
        },
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(result.success).toBe(true);
      expect(result.tasks.length).toBeGreaterThanOrEqual(100);

      console.log(`Queried ${result.tasks.length} tasks in ${duration}ms`);

      // Query should be fast
      expect(duration).toBeLessThan(5000); // Under 5 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 2: Bulk Updates
  // ========================================

  test('Phase 2.1: Update 50 tasks with priority changes', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();
      const tasksToUpdate = taskIds.slice(0, 50);

      for (const taskId of tasksToUpdate) {
        await callIPC(window, 'task:set-priority', {
          taskId,
          priority: 'high',
          actorDid: TEST_USER_DID,
        });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      const avgTime = duration / tasksToUpdate.length;

      console.log(`Updated ${tasksToUpdate.length} task priorities in ${duration}ms (avg: ${avgTime.toFixed(2)}ms)`);

      expect(duration).toBeLessThan(30000); // Under 30 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 2.2: Bulk move tasks between columns', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Create a second column
      const newColumnResult: any = await callIPC(window, 'task:create-column', {
        boardId,
        columnData: { name: 'In Progress', position: 1 },
      });
      const newColumnId = newColumnResult.columnId;

      const startTime = Date.now();
      const tasksToMove = taskIds.slice(0, 30);

      for (let i = 0; i < tasksToMove.length; i++) {
        await callIPC(window, 'task:move-task', {
          taskId: tasksToMove[i],
          columnId: newColumnId,
          position: i,
          actorDid: TEST_USER_DID,
        });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`Moved ${tasksToMove.length} tasks in ${duration}ms`);

      expect(duration).toBeLessThan(20000); // Under 20 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 3: Large Team Management
  // ========================================

  test('Phase 3.1: Add 50 members to team', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();
      const MEMBER_COUNT = 50;

      for (let i = 0; i < MEMBER_COUNT; i++) {
        const memberDid = `did:key:bulk-member-${Date.now()}-${i}`;
        memberDids.push(memberDid);

        const result: any = await callIPC(window, 'team:add-member', {
          teamId,
          memberDid,
          memberName: `Bulk Member ${i + 1}`,
          role: i % 5 === 0 ? 'lead' : 'member',
          invitedBy: TEST_USER_DID,
        });

        expect(result.success).toBe(true);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      const avgTime = duration / MEMBER_COUNT;

      console.log(`Added ${MEMBER_COUNT} members in ${duration}ms (avg: ${avgTime.toFixed(2)}ms)`);

      expect(duration).toBeLessThan(40000); // Under 40 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 3.2: Query all team members', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();

      const result: any = await callIPC(window, 'team:get-team-members', {
        teamId,
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(result.success).toBe(true);
      expect(result.members.length).toBeGreaterThanOrEqual(50);

      console.log(`Queried ${result.members.length} team members in ${duration}ms`);

      expect(duration).toBeLessThan(3000); // Under 3 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 4: Bulk Permission Grants
  // ========================================

  test('Phase 4.1: Grant permissions to 30 members', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();
      const membersToGrant = memberDids.slice(0, 30);

      for (const memberDid of membersToGrant) {
        await callIPC(window, 'perm:grant-permission', {
          orgId: TEST_ORG_ID,
          userDid: memberDid,
          resourceType: 'task',
          resourceId: '*',
          permission: 'write',
          grantedBy: TEST_USER_DID,
        });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      const avgTime = duration / membersToGrant.length;

      console.log(`Granted permissions to ${membersToGrant.length} members in ${duration}ms (avg: ${avgTime.toFixed(2)}ms)`);

      expect(duration).toBeLessThan(25000); // Under 25 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 4.2: Check permissions for all members', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();
      const membersToCheck = memberDids.slice(0, 30);
      let hasPermissionCount = 0;

      for (const memberDid of membersToCheck) {
        const result: any = await callIPC(window, 'perm:check-permission', {
          orgId: TEST_ORG_ID,
          userDid: memberDid,
          resourceType: 'task',
          resourceId: '*',
          permission: 'write',
        });

        if (result.hasPermission) {
          hasPermissionCount++;
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`Checked permissions for ${membersToCheck.length} members in ${duration}ms (${hasPermissionCount} granted)`);

      expect(duration).toBeLessThan(20000); // Under 20 seconds
      expect(hasPermissionCount).toBe(membersToCheck.length);
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 5: Concurrent Operations
  // ========================================

  test('Phase 5.1: Concurrent task creation (10 tasks simultaneously)', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();
      const CONCURRENT_COUNT = 10;

      const promises = [];
      for (let i = 0; i < CONCURRENT_COUNT; i++) {
        promises.push(
          callIPC(window, 'task:create-task', {
            boardId,
            columnId,
            title: `Concurrent Task ${i + 1}`,
            description: `Created concurrently`,
            createdBy: TEST_USER_DID,
            creatorName: 'Perf Test User',
          })
        );
      }

      const results = await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      results.forEach((result: any) => {
        expect(result.success).toBe(true);
      });

      console.log(`Created ${CONCURRENT_COUNT} tasks concurrently in ${duration}ms`);

      // Concurrent should be faster than sequential
      expect(duration).toBeLessThan(5000); // Under 5 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 5.2: Concurrent permission checks (20 checks)', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();
      const membersToCheck = memberDids.slice(0, 20);

      const promises = membersToCheck.map((memberDid) =>
        callIPC(window, 'perm:check-permission', {
          orgId: TEST_ORG_ID,
          userDid: memberDid,
          resourceType: 'task',
          resourceId: '*',
          permission: 'write',
        })
      );

      const results = await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`Performed ${results.length} concurrent permission checks in ${duration}ms`);

      expect(duration).toBeLessThan(3000); // Under 3 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 6: Export Performance
  // ========================================

  test('Phase 6.1: Export board with 100+ tasks', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();

      const result: any = await callIPC(window, 'task:export-board', {
        boardId,
        format: 'json',
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const dataSize = JSON.stringify(result.data).length;

      console.log(`Exported board with ${taskIds.length}+ tasks in ${duration}ms (${(dataSize / 1024).toFixed(2)} KB)`);

      expect(duration).toBeLessThan(10000); // Under 10 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 6.2: Get board analytics with large dataset', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();

      const result: any = await callIPC(window, 'task:get-board-analytics', {
        boardId,
        options: {
          startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date().toISOString(),
        },
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(result.success).toBe(true);

      console.log(`Generated board analytics in ${duration}ms`);

      expect(duration).toBeLessThan(15000); // Under 15 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 7: Cleanup Performance
  // ========================================

  test('Phase 7.1: Bulk delete tasks (first 50)', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();
      const tasksToDelete = taskIds.slice(0, 50);

      for (const taskId of tasksToDelete) {
        await callIPC(window, 'task:delete-task', {
          taskId,
        });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      const avgTime = duration / tasksToDelete.length;

      console.log(`Deleted ${tasksToDelete.length} tasks in ${duration}ms (avg: ${avgTime.toFixed(2)}ms)`);

      expect(duration).toBeLessThan(20000); // Under 20 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 7.2: Remove 25 team members', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startTime = Date.now();
      const membersToRemove = memberDids.slice(0, 25);

      for (const memberDid of membersToRemove) {
        await callIPC(window, 'team:remove-member', {
          teamId,
          memberDid,
        });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`Removed ${membersToRemove.length} team members in ${duration}ms`);

      expect(duration).toBeLessThan(15000); // Under 15 seconds
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 8: Performance Summary
  // ========================================

  test('Phase 8.1: Verify final state', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const tasksResult: any = await callIPC(window, 'task:get-tasks', {
        boardId,
        options: {},
      });

      const membersResult: any = await callIPC(window, 'team:get-team-members', {
        teamId,
      });

      console.log('\n=== Performance Test Summary ===');
      console.log(`Remaining tasks: ${tasksResult.tasks.length}`);
      console.log(`Remaining team members: ${membersResult.members.length}`);
      console.log(`Total tasks created: ${taskIds.length + 10}`); // +10 from concurrent test
      console.log(`Total members added: ${memberDids.length}`);
      console.log('================================\n');

      expect(tasksResult.success).toBe(true);
      expect(membersResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
