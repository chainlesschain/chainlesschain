/**
 * Project Management User Journey E2E
 * Full project lifecycle: Team setup -> Task management -> Sprint execution -> Delivery
 *
 * Test Coverage:
 * 1. Organization & Team setup (create team, add members, set permissions)
 * 2. Project creation and configuration
 * 3. Task board creation & management
 * 4. Task lifecycle (create, assign, update, complete)
 * 5. Sprint planning & execution
 * 6. Team collaboration (comments, checklists, attachments)
 * 7. Reports & analytics
 * 8. Project delivery (export, share, archive)
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';
import path from 'path';
import os from 'os';

// Test data
const TEST_ORG_ID = `org-pm-journey-${Date.now()}`;
const TEST_USER_DID = `did:key:pm-journey-user-${Date.now()}`;
const TEST_USER_NAME = 'PM Journey User';
const TEST_MEMBER_DID = `did:key:pm-journey-member-${Date.now()}`;
const TEST_MEMBER_NAME = 'PM Journey Member';
const TEST_PROJECT_NAME = 'PM Journey Delivery Project';

test.describe.serial('Project Management Journey (Full Lifecycle)', () => {
  let projectId: string;
  let projectRootPath: string | undefined;
  let teamId: string;
  let boardId: string;
  let columnIds: { todo: string; inProgress: string; done: string } = {
    todo: '',
    inProgress: '',
    done: ''
  };
  let taskId: string;
  let sprintId: string;
  let checklistId: string;

  // ========================================
  // Phase 1: Organization & Team Setup
  // ========================================

  test('Phase 1.1: Create team', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const createResult: any = await callIPC(window, 'team:create-team', {
        orgId: TEST_ORG_ID,
        name: 'Engineering Team',
        description: 'Core engineering team for PM journey test',
        leadDid: TEST_USER_DID,
        leadName: TEST_USER_NAME,
        createdBy: TEST_USER_DID,
      });

      expect(createResult).toBeDefined();
      expect(createResult.success).toBe(true);
      expect(createResult.teamId).toBeDefined();

      teamId = createResult.teamId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 1.2: Add team member', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const addResult: any = await callIPC(window, 'team:add-member', {
        teamId,
        memberDid: TEST_MEMBER_DID,
        memberName: TEST_MEMBER_NAME,
        role: 'member',
        invitedBy: TEST_USER_DID,
      });

      expect(addResult).toBeDefined();
      expect(addResult.success).toBe(true);
      expect(addResult.memberId).toBeDefined();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 1.3: Verify team members', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const membersResult: any = await callIPC(window, 'team:get-team-members', {
        teamId,
      });

      expect(membersResult).toBeDefined();
      expect(membersResult.success).toBe(true);
      expect(membersResult.members).toBeDefined();
      expect(membersResult.members.length).toBeGreaterThanOrEqual(2); // Lead + Member
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 1.4: Grant project permissions to member', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const grantResult: any = await callIPC(window, 'perm:grant-permission', {
        orgId: TEST_ORG_ID,
        userDid: TEST_MEMBER_DID,
        resourceType: 'project',
        resourceId: '*',
        permission: 'write',
        grantedBy: TEST_USER_DID,
      });

      expect(grantResult).toBeDefined();
      expect(grantResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 2: Project Creation
  // ========================================

  test('Phase 2.1: Create project', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const createResult: any = await callIPC(window, 'project:create-quick', {
        name: TEST_PROJECT_NAME,
        description: 'E2E project management journey test',
        projectType: 'document',
        userId: TEST_USER_DID,
      });

      expect(createResult).toBeDefined();
      expect(createResult.id).toBeDefined();
      expect(createResult.name).toBe(TEST_PROJECT_NAME);

      projectId = createResult.id;
      projectRootPath = createResult.root_path || createResult.rootPath;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 2.2: Update project metadata', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const updates = {
        description: 'Updated: Full lifecycle E2E test',
        status: 'planning',
        tags: JSON.stringify(['e2e', 'journey', 'pm', 'sprint']),
      };

      const updateResult: any = await callIPC(window, 'project:update', projectId, updates);
      expect(updateResult).toBeDefined();

      const project: any = await callIPC(window, 'project:get', projectId);
      expect(project).toBeDefined();
      expect(project.status).toBe('planning');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 2.3: Add deliverable files', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const files = [
        {
          id: `pm-file-${Date.now()}-1`,
          projectId,
          filePath: '/docs/requirements.md',
          fileName: 'requirements.md',
          fileType: 'markdown',
          content: '# Requirements\n\n- User authentication\n- Task management\n- Sprint planning\n',
          fileSize: 128,
        },
        {
          id: `pm-file-${Date.now()}-2`,
          projectId,
          filePath: '/docs/architecture.md',
          fileName: 'architecture.md',
          fileType: 'markdown',
          content: '# Architecture\n\n- Frontend: Vue3\n- Backend: Electron\n- Database: SQLite\n',
          fileSize: 128,
        },
      ];

      const saveResult: any = await callIPC(window, 'project:save-files', projectId, files);
      expect(saveResult).toBeDefined();
      expect(saveResult.success).toBeTruthy();
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 3: Task Board Creation
  // ========================================

  test('Phase 3.1: Create task board', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const createResult: any = await callIPC(window, 'task:create-board', {
        orgId: TEST_ORG_ID,
        name: 'Sprint Board',
        description: 'Main task board for project execution',
        boardType: 'scrum',
        createdBy: TEST_USER_DID,
      });

      expect(createResult).toBeDefined();
      expect(createResult.success).toBe(true);
      expect(createResult.boardId).toBeDefined();

      boardId = createResult.boardId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 3.2: Create board columns', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Create Todo column
      const todoResult: any = await callIPC(window, 'task:create-column', {
        boardId,
        columnData: {
          name: 'To Do',
          position: 0,
          wipLimit: 10,
        },
      });
      expect(todoResult.success).toBe(true);
      columnIds.todo = todoResult.columnId;

      // Create In Progress column
      const inProgressResult: any = await callIPC(window, 'task:create-column', {
        boardId,
        columnData: {
          name: 'In Progress',
          position: 1,
          wipLimit: 3,
        },
      });
      expect(inProgressResult.success).toBe(true);
      columnIds.inProgress = inProgressResult.columnId;

      // Create Done column
      const doneResult: any = await callIPC(window, 'task:create-column', {
        boardId,
        columnData: {
          name: 'Done',
          position: 2,
          wipLimit: null,
        },
      });
      expect(doneResult.success).toBe(true);
      columnIds.done = doneResult.columnId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 3.3: Create labels', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const labels = [
        { name: 'bug', color: '#ff0000' },
        { name: 'feature', color: '#00ff00' },
        { name: 'urgent', color: '#ff6600' },
      ];

      for (const label of labels) {
        const result: any = await callIPC(window, 'task:create-label', {
          orgId: TEST_ORG_ID,
          name: label.name,
          color: label.color,
        });
        expect(result.success).toBe(true);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 4: Task Management
  // ========================================

  test('Phase 4.1: Create task', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const createResult: any = await callIPC(window, 'task:create-task', {
        boardId,
        columnId: columnIds.todo,
        title: 'Implement user authentication',
        description: 'Add login/logout functionality with JWT tokens',
        priority: 'high',
        estimatedHours: 8,
        createdBy: TEST_USER_DID,
        creatorName: TEST_USER_NAME,
      });

      expect(createResult).toBeDefined();
      expect(createResult.success).toBe(true);
      expect(createResult.taskId).toBeDefined();

      taskId = createResult.taskId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 4.2: Assign task to team member', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const assignResult: any = await callIPC(window, 'task:assign-task', {
        taskId,
        userDid: TEST_MEMBER_DID,
        role: 'assignee',
        assignedBy: TEST_USER_DID,
      });

      expect(assignResult).toBeDefined();
      expect(assignResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 4.3: Set task due date and priority', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7); // Due in 7 days

      const dueDateResult: any = await callIPC(window, 'task:set-due-date', {
        taskId,
        dueDate: dueDate.toISOString(),
        actorDid: TEST_USER_DID,
      });
      expect(dueDateResult.success).toBe(true);

      const priorityResult: any = await callIPC(window, 'task:set-priority', {
        taskId,
        priority: 'high',
        actorDid: TEST_USER_DID,
      });
      expect(priorityResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 4.4: Add task checklist', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Create checklist
      const checklistResult: any = await callIPC(window, 'task:create-checklist', {
        taskId,
        title: 'Implementation Steps',
      });
      expect(checklistResult.success).toBe(true);
      checklistId = checklistResult.checklistId;

      // Add checklist items
      const items = [
        'Design authentication flow',
        'Implement JWT token generation',
        'Create login API endpoint',
        'Add logout functionality',
        'Write unit tests',
      ];

      for (const item of items) {
        const itemResult: any = await callIPC(window, 'task:add-checklist-item', {
          checklistId,
          content: item,
          assigneeDid: TEST_MEMBER_DID,
        });
        expect(itemResult.success).toBe(true);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 4.5: Add task comment', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const commentResult: any = await callIPC(window, 'task:add-comment', {
        taskId,
        comment: {
          authorDid: TEST_USER_DID,
          authorName: TEST_USER_NAME,
          content: 'Please make sure to follow security best practices for password hashing.',
        },
      });

      expect(commentResult).toBeDefined();
      expect(commentResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 4.6: Move task to In Progress', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const moveResult: any = await callIPC(window, 'task:move-task', {
        taskId,
        columnId: columnIds.inProgress,
        position: 0,
        actorDid: TEST_MEMBER_DID,
      });

      expect(moveResult).toBeDefined();
      expect(moveResult.success).toBe(true);

      // Update project status to active
      await callIPC(window, 'project:update', projectId, { status: 'active' });
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 5: Sprint Management
  // ========================================

  test('Phase 5.1: Create sprint', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 14); // 2-week sprint

      const createResult: any = await callIPC(window, 'task:create-sprint', {
        boardId,
        sprintData: {
          name: 'Sprint 1',
          goal: 'Complete user authentication and basic task management',
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      });

      expect(createResult).toBeDefined();
      expect(createResult.success).toBe(true);
      expect(createResult.sprintId).toBeDefined();

      sprintId = createResult.sprintId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 5.2: Move task to sprint', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const moveResult: any = await callIPC(window, 'task:move-to-sprint', {
        taskIds: [taskId],
        sprintId,
      });

      expect(moveResult).toBeDefined();
      expect(moveResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 5.3: Start sprint', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const startResult: any = await callIPC(window, 'task:start-sprint', {
        sprintId,
      });

      expect(startResult).toBeDefined();
      expect(startResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 5.4: Complete task and move to Done', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Update task status to completed
      const updateResult: any = await callIPC(window, 'task:update-task', {
        taskId,
        updates: {
          status: 'completed',
          actualHours: 7,
        },
        actorDid: TEST_MEMBER_DID,
      });
      expect(updateResult.success).toBe(true);

      // Move to Done column
      const moveResult: any = await callIPC(window, 'task:move-task', {
        taskId,
        columnId: columnIds.done,
        position: 0,
        actorDid: TEST_MEMBER_DID,
      });
      expect(moveResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 5.5: Get sprint statistics', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const statsResult: any = await callIPC(window, 'task:get-sprint-stats', {
        sprintId,
      });

      expect(statsResult).toBeDefined();
      expect(statsResult.success).toBe(true);
      expect(statsResult.stats).toBeDefined();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 5.6: Complete sprint', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const completeResult: any = await callIPC(window, 'task:complete-sprint', {
        sprintId,
      });

      expect(completeResult).toBeDefined();
      expect(completeResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 6: Reports & Analytics
  // ========================================

  test('Phase 6.1: Create team report', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const reportResult: any = await callIPC(window, 'task:create-report', {
        orgId: TEST_ORG_ID,
        teamId,
        reportType: 'weekly',
        title: 'Sprint 1 Weekly Report',
        content: 'Completed user authentication feature',
        authorDid: TEST_USER_DID,
        authorName: TEST_USER_NAME,
      });

      expect(reportResult).toBeDefined();
      expect(reportResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 6.2: Get board analytics', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const analyticsResult: any = await callIPC(window, 'task:get-board-analytics', {
        boardId,
        options: {
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // Last 30 days
          endDate: new Date().toISOString(),
        },
      });

      expect(analyticsResult).toBeDefined();
      expect(analyticsResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 6.3: Export board data', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const exportResult: any = await callIPC(window, 'task:export-board', {
        boardId,
        format: 'json',
      });

      expect(exportResult).toBeDefined();
      expect(exportResult.success).toBe(true);
      expect(exportResult.data).toBeDefined();
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 7: Project Delivery
  // ========================================

  test('Phase 7.1: Track project stats', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project: any = await callIPC(window, 'project:get', projectId);
      projectRootPath = projectRootPath || project.root_path || project.rootPath;

      const startResult: any = await callIPC(
        window,
        'project:stats:start',
        projectId,
        projectRootPath
      );
      expect(startResult).toBeDefined();

      const updateResult: any = await callIPC(window, 'project:stats:update', projectId);
      expect(updateResult).toBeDefined();

      const statsResult: any = await callIPC(window, 'project:stats:get', projectId);
      expect(statsResult).toBeDefined();

      const stopResult: any = await callIPC(window, 'project:stats:stop', projectId);
      expect(stopResult).toBeDefined();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 7.2: Export project files', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const exportTargetPath = path.join(
        os.tmpdir(),
        `pm-journey-${projectId}-README.md`
      );

      const exportResult: any = await callIPC(window, 'project:export-file', {
        projectId,
        projectPath: 'README.md',
        targetPath: exportTargetPath,
        isDirectory: false,
      });

      expect(exportResult).toBeDefined();
      expect(exportResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 7.3: Share project', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const shareResult: any = await callIPC(window, 'project:shareProject', {
        projectId,
        shareMode: 'public',
        expiresInDays: 7,
        regenerateToken: true,
      });

      expect(shareResult).toBeDefined();
      expect(shareResult.success).toBe(true);
      expect(shareResult.shareToken).toBeDefined();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 7.4: Mark project as delivered', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const deliveredAt = new Date().toISOString();
      const updateResult: any = await callIPC(window, 'project:update', projectId, {
        status: 'delivered',
        delivered_at: deliveredAt,
      });

      expect(updateResult).toBeDefined();

      const project: any = await callIPC(window, 'project:get', projectId);
      expect(project).toBeDefined();
      expect(project.status).toBe('delivered');
      expect(project.delivered_at).toBeDefined();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 7.5: Archive board', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const archiveResult: any = await callIPC(window, 'task:archive-board', {
        boardId,
      });

      expect(archiveResult).toBeDefined();
      expect(archiveResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 8: Cleanup & Verification
  // ========================================

  test('Phase 8.1: Verify final project state', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const project: any = await callIPC(window, 'project:get', projectId);

      expect(project).toBeDefined();
      expect(project.id).toBe(projectId);
      expect(project.status).toBe('delivered');
      expect(project.name).toBe(TEST_PROJECT_NAME);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 8.2: Verify team and members', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const teamsResult: any = await callIPC(window, 'team:get-teams', {
        orgId: TEST_ORG_ID,
        options: {},
      });

      expect(teamsResult).toBeDefined();
      expect(teamsResult.success).toBe(true);
      expect(teamsResult.teams).toBeDefined();
      expect(teamsResult.teams.length).toBeGreaterThan(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 8.3: Verify task completion', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const taskResult: any = await callIPC(window, 'task:get-task', {
        taskId,
      });

      expect(taskResult).toBeDefined();
      expect(taskResult.success).toBe(true);
      expect(taskResult.task).toBeDefined();
      expect(taskResult.task.status).toBe('completed');
    } finally {
      await closeElectronApp(app);
    }
  });
});
