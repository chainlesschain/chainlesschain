/**
 * Cross-Organization Collaboration E2E Test
 * Testing resource sharing and collaboration between multiple organizations
 *
 * Test Coverage:
 * 1. Multi-organization setup
 * 2. Resource sharing (projects, tasks, boards)
 * 3. Cross-org team collaboration
 * 4. Cross-org permissions and access control
 * 5. Shared workflows and approvals
 * 6. Resource synchronization
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';
import { generateTestData, TestDataGenerator } from './utils/test-data-generator';

const generator = new TestDataGenerator();

// Organization A data
const ORG_A_ID = generator.generateOrgID('acme-corp');
const ORG_A_ADMIN = generateTestData.user('admin');
const ORG_A_MEMBERS = generateTestData.users(3, 'member');

// Organization B data
const ORG_B_ID = generator.generateOrgID('beta-tech');
const ORG_B_ADMIN = generateTestData.user('admin');
const ORG_B_MEMBERS = generateTestData.users(3, 'member');

// Shared resources
let sharedProjectId: string;
let sharedBoardId: string;
let sharedTaskId: string;

test.describe.serial('Cross-Organization Collaboration', () => {
  let orgATeamId: string;
  let orgBTeamId: string;
  let sharedWorkflowId: string;

  // ========================================
  // Phase 1: Multi-Organization Setup
  // ========================================

  test('Phase 1.1: Create Organization A with team', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Create team for Org A
      const teamResult: any = await callIPC(window, 'team:create-team', {
        orgId: ORG_A_ID,
        name: 'Acme Engineering',
        description: 'Engineering team at Acme Corp',
        leadDid: ORG_A_ADMIN.did,
        leadName: ORG_A_ADMIN.name,
        createdBy: ORG_A_ADMIN.did,
      });

      expect(teamResult.success).toBe(true);
      orgATeamId = teamResult.teamId;

      // Add members to Org A
      for (const member of ORG_A_MEMBERS) {
        const memberResult: any = await callIPC(window, 'team:add-member', {
          teamId: orgATeamId,
          memberDid: member.did,
          memberName: member.name,
          role: 'member',
          invitedBy: ORG_A_ADMIN.did,
        });
        expect(memberResult.success).toBe(true);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 1.2: Create Organization B with team', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Create team for Org B
      const teamResult: any = await callIPC(window, 'team:create-team', {
        orgId: ORG_B_ID,
        name: 'Beta Development',
        description: 'Development team at Beta Tech',
        leadDid: ORG_B_ADMIN.did,
        leadName: ORG_B_ADMIN.name,
        createdBy: ORG_B_ADMIN.did,
      });

      expect(teamResult.success).toBe(true);
      orgBTeamId = teamResult.teamId;

      // Add members to Org B
      for (const member of ORG_B_MEMBERS) {
        const memberResult: any = await callIPC(window, 'team:add-member', {
          teamId: orgBTeamId,
          memberDid: member.did,
          memberName: member.name,
          role: 'member',
          invitedBy: ORG_B_ADMIN.did,
        });
        expect(memberResult.success).toBe(true);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 2: Shared Project Creation
  // ========================================

  test('Phase 2.1: Org A creates a project', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const projectResult: any = await callIPC(window, 'project:create-quick', {
        name: 'Cross-Org Collaboration Project',
        description: 'Shared project between Acme and Beta',
        projectType: 'web',
        userId: ORG_A_ADMIN.did,
      });

      expect(projectResult).toBeDefined();
      expect(projectResult.id).toBeDefined();

      sharedProjectId = projectResult.id;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 2.2: Grant Org B members access to shared project', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Grant read permission to Org B admin
      const grantResult1: any = await callIPC(window, 'perm:grant-permission', {
        orgId: ORG_A_ID,
        userDid: ORG_B_ADMIN.did,
        resourceType: 'project',
        resourceId: sharedProjectId,
        permission: 'write',
        grantedBy: ORG_A_ADMIN.did,
      });
      expect(grantResult1.success).toBe(true);

      // Grant read permission to Org B members
      for (const member of ORG_B_MEMBERS) {
        const grantResult: any = await callIPC(window, 'perm:grant-permission', {
          orgId: ORG_A_ID,
          userDid: member.did,
          resourceType: 'project',
          resourceId: sharedProjectId,
          permission: 'read',
          grantedBy: ORG_A_ADMIN.did,
        });
        expect(grantResult.success).toBe(true);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 2.3: Verify Org B admin can access shared project', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const checkResult: any = await callIPC(window, 'perm:check-permission', {
        orgId: ORG_A_ID,
        userDid: ORG_B_ADMIN.did,
        resourceType: 'project',
        resourceId: sharedProjectId,
        permission: 'write',
      });

      expect(checkResult).toBeDefined();
      expect(checkResult.hasPermission).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 3: Shared Task Board
  // ========================================

  test('Phase 3.1: Create shared task board', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const boardResult: any = await callIPC(window, 'task:create-board', {
        orgId: ORG_A_ID,
        name: 'Cross-Org Sprint Board',
        description: 'Shared board for cross-org collaboration',
        boardType: 'scrum',
        createdBy: ORG_A_ADMIN.did,
      });

      expect(boardResult.success).toBe(true);
      sharedBoardId = boardResult.boardId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 3.2: Grant Org B access to shared board', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Grant write access to Org B admin
      const grantResult: any = await callIPC(window, 'perm:grant-permission', {
        orgId: ORG_A_ID,
        userDid: ORG_B_ADMIN.did,
        resourceType: 'board',
        resourceId: sharedBoardId,
        permission: 'write',
        grantedBy: ORG_A_ADMIN.did,
      });
      expect(grantResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 3.3: Create columns on shared board', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const columns = ['Backlog', 'In Progress', 'Review', 'Done'];

      for (let i = 0; i < columns.length; i++) {
        const columnResult: any = await callIPC(window, 'task:create-column', {
          boardId: sharedBoardId,
          columnData: {
            name: columns[i],
            position: i,
            wipLimit: i === 1 ? 5 : null, // WIP limit on "In Progress"
          },
        });
        expect(columnResult.success).toBe(true);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 4: Cross-Org Task Assignment
  // ========================================

  test('Phase 4.1: Org A creates task on shared board', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Get columns
      const boardResult: any = await callIPC(window, 'task:get-board', {
        boardId: sharedBoardId,
      });
      const columns = boardResult.board.columns || [];
      const backlogColumn = columns.find((c: any) => c.name === 'Backlog');

      // Create task
      const taskResult: any = await callIPC(window, 'task:create-task', {
        boardId: sharedBoardId,
        columnId: backlogColumn.id,
        title: 'Implement cross-org authentication',
        description: 'Enable SSO between Acme and Beta organizations',
        priority: 'high',
        estimatedHours: 16,
        createdBy: ORG_A_ADMIN.did,
        creatorName: ORG_A_ADMIN.name,
      });

      expect(taskResult.success).toBe(true);
      sharedTaskId = taskResult.taskId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 4.2: Assign task to Org B member', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Assign to first Org B member
      const assignResult: any = await callIPC(window, 'task:assign-task', {
        taskId: sharedTaskId,
        userDid: ORG_B_MEMBERS[0].did,
        role: 'assignee',
        assignedBy: ORG_A_ADMIN.did,
      });

      expect(assignResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 4.3: Org B member adds comment to task', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const commentResult: any = await callIPC(window, 'task:add-comment', {
        taskId: sharedTaskId,
        comment: {
          authorDid: ORG_B_MEMBERS[0].did,
          authorName: ORG_B_MEMBERS[0].name,
          content: 'Working on OAuth2 integration. Will update progress soon.',
        },
      });

      expect(commentResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 4.4: Org A member adds to task checklist', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Create checklist
      const checklistResult: any = await callIPC(window, 'task:create-checklist', {
        taskId: sharedTaskId,
        title: 'Implementation Steps',
      });
      expect(checklistResult.success).toBe(true);

      const checklistId = checklistResult.checklistId;

      // Add checklist items
      const items = [
        'Set up OAuth2 provider',
        'Configure SAML integration',
        'Implement token exchange',
        'Add user mapping logic',
        'Write integration tests',
      ];

      for (const item of items) {
        const itemResult: any = await callIPC(window, 'task:add-checklist-item', {
          checklistId,
          content: item,
          assigneeDid: ORG_B_MEMBERS[0].did,
        });
        expect(itemResult.success).toBe(true);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 5: Cross-Org Approval Workflow
  // ========================================

  test('Phase 5.1: Create cross-org approval workflow', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Create workflow requiring approval from both orgs
      const workflowResult: any = await callIPC(window, 'perm:create-workflow', {
        orgId: ORG_A_ID,
        name: 'Cross-Org Resource Sharing',
        description: 'Approval required from both Acme and Beta admins',
        triggerResourceType: 'permission',
        triggerAction: 'grant',
        approvalType: 'parallel',
        approvers: [
          { did: ORG_A_ADMIN.did, name: ORG_A_ADMIN.name, role: 'org_a_admin' },
          { did: ORG_B_ADMIN.did, name: ORG_B_ADMIN.name, role: 'org_b_admin' },
        ],
        timeoutHours: 48,
        onTimeout: 'reject',
        enabled: true,
      });

      expect(workflowResult.success).toBe(true);
      sharedWorkflowId = workflowResult.workflowId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 5.2: Submit approval request for sensitive resource', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const submitResult: any = await callIPC(window, 'perm:submit-approval', {
        workflowId: sharedWorkflowId,
        orgId: ORG_A_ID,
        requesterDid: ORG_A_MEMBERS[0].did,
        requesterName: ORG_A_MEMBERS[0].name,
        resourceType: 'permission',
        resourceId: sharedProjectId,
        action: 'grant',
        requestData: {
          permission: 'admin',
          reason: 'Need admin access for cross-org integration',
          targetUser: ORG_B_MEMBERS[1].did,
        },
      });

      expect(submitResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 5.3: Both org admins approve the request', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Get pending approvals
      const pendingResult: any = await callIPC(window, 'perm:get-pending-approvals', {
        approverDid: ORG_A_ADMIN.did,
        orgId: ORG_A_ID,
      });

      const requestId = pendingResult.approvals[0].id;

      // Org A admin approves
      const approve1: any = await callIPC(window, 'perm:approve-request', {
        requestId,
        approverDid: ORG_A_ADMIN.did,
        comment: 'Approved by Acme Corp admin',
      });
      expect(approve1.success).toBe(true);

      // Org B admin approves
      const approve2: any = await callIPC(window, 'perm:approve-request', {
        requestId,
        approverDid: ORG_B_ADMIN.did,
        comment: 'Approved by Beta Tech admin',
      });
      expect(approve2.success).toBe(true);
      expect(approve2.status).toBe('approved');
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 6: Resource Sharing Statistics
  // ========================================

  test('Phase 6.1: Get shared project statistics', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project: any = await callIPC(window, 'project:get', sharedProjectId);

      expect(project).toBeDefined();
      expect(project.id).toBe(sharedProjectId);

      // Verify project is accessible
      const permCheckOrgA: any = await callIPC(window, 'perm:check-permission', {
        orgId: ORG_A_ID,
        userDid: ORG_A_ADMIN.did,
        resourceType: 'project',
        resourceId: sharedProjectId,
        permission: 'write',
      });
      expect(permCheckOrgA.hasPermission).toBeTruthy();

      const permCheckOrgB: any = await callIPC(window, 'perm:check-permission', {
        orgId: ORG_A_ID,
        userDid: ORG_B_ADMIN.did,
        resourceType: 'project',
        resourceId: sharedProjectId,
        permission: 'write',
      });
      expect(permCheckOrgB.hasPermission).toBeTruthy();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 6.2: Get cross-org task activity', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const activityResult: any = await callIPC(window, 'task:get-activity', {
        taskId: sharedTaskId,
        options: {},
      });

      expect(activityResult.success).toBe(true);
      expect(activityResult.activities).toBeDefined();

      // Should have activities from both orgs
      const orgAActivities = activityResult.activities.filter((a: any) =>
        a.actor_did?.includes(ORG_A_ADMIN.did) || ORG_A_MEMBERS.some(m => a.actor_did?.includes(m.did))
      );

      const orgBActivities = activityResult.activities.filter((a: any) =>
        ORG_B_MEMBERS.some(m => a.actor_did?.includes(m.did))
      );

      expect(orgAActivities.length).toBeGreaterThan(0);
      expect(orgBActivities.length).toBeGreaterThan(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 6.3: Get board analytics with cross-org data', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const analyticsResult: any = await callIPC(window, 'task:get-board-analytics', {
        boardId: sharedBoardId,
        options: {
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date().toISOString(),
        },
      });

      expect(analyticsResult.success).toBe(true);
      expect(analyticsResult.analytics).toBeDefined();
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 7: Permission Management
  // ========================================

  test('Phase 7.1: List all permissions for shared resources', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Get permissions for Org B admin
      const permissionsResult: any = await callIPC(window, 'perm:get-user-permissions', {
        userDid: ORG_B_ADMIN.did,
        orgId: ORG_A_ID,
      });

      expect(permissionsResult.success).toBe(true);
      expect(permissionsResult.permissions).toBeDefined();
      expect(permissionsResult.permissions.length).toBeGreaterThan(0);

      // Should have permissions for project and board
      const hasProjectPerm = permissionsResult.permissions.some(
        (p: any) => p.resource_type === 'project' && p.resource_id === sharedProjectId
      );
      const hasBoardPerm = permissionsResult.permissions.some(
        (p: any) => p.resource_type === 'board' && p.resource_id === sharedBoardId
      );

      expect(hasProjectPerm).toBe(true);
      expect(hasBoardPerm).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 7.2: Revoke specific cross-org permission', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Get permissions for Org B member
      const permissionsResult: any = await callIPC(window, 'perm:get-user-permissions', {
        userDid: ORG_B_MEMBERS[2].did,
        orgId: ORG_A_ID,
      });

      if (permissionsResult.permissions && permissionsResult.permissions.length > 0) {
        const grantId = permissionsResult.permissions[0].id;

        // Revoke permission
        const revokeResult: any = await callIPC(window, 'perm:revoke-permission', {
          grantId,
          revokedBy: ORG_A_ADMIN.did,
        });

        expect(revokeResult.success).toBe(true);

        // Verify permission revoked
        const checkResult: any = await callIPC(window, 'perm:check-permission', {
          orgId: ORG_A_ID,
          userDid: ORG_B_MEMBERS[2].did,
          resourceType: permissionsResult.permissions[0].resource_type,
          resourceId: permissionsResult.permissions[0].resource_id,
          permission: permissionsResult.permissions[0].permission,
        });

        expect(checkResult.hasPermission).toBe(false);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 8: Cleanup & Verification
  // ========================================

  test('Phase 8.1: Verify cross-org collaboration summary', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Verify Org A team
      const orgATeamResult: any = await callIPC(window, 'team:get-team-members', {
        teamId: orgATeamId,
      });
      expect(orgATeamResult.success).toBe(true);
      expect(orgATeamResult.members.length).toBeGreaterThanOrEqual(4); // Admin + 3 members

      // Verify Org B team
      const orgBTeamResult: any = await callIPC(window, 'team:get-team-members', {
        teamId: orgBTeamId,
      });
      expect(orgBTeamResult.success).toBe(true);
      expect(orgBTeamResult.members.length).toBeGreaterThanOrEqual(4);

      // Verify shared task
      const taskResult: any = await callIPC(window, 'task:get-task', {
        taskId: sharedTaskId,
      });
      expect(taskResult.success).toBe(true);
      expect(taskResult.task).toBeDefined();

      console.log('\n=== Cross-Org Collaboration Summary ===');
      console.log(`Org A (${ORG_A_ID}): ${orgATeamResult.members.length} members`);
      console.log(`Org B (${ORG_B_ID}): ${orgBTeamResult.members.length} members`);
      console.log(`Shared Project ID: ${sharedProjectId}`);
      console.log(`Shared Board ID: ${sharedBoardId}`);
      console.log(`Shared Task ID: ${sharedTaskId}`);
      console.log(`Cross-Org Workflow ID: ${sharedWorkflowId}`);
      console.log('=====================================\n');
    } finally {
      await closeElectronApp(app);
    }
  });
});
