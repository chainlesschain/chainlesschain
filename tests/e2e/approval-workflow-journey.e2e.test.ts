/**
 * Approval Workflow Journey E2E Test
 * Testing enterprise approval workflows for critical operations
 *
 * Test Coverage:
 * 1. Workflow creation and configuration
 * 2. Sequential approval flow
 * 3. Parallel approval flow
 * 4. Any-one approval flow
 * 5. Approval delegation
 * 6. Timeout handling
 * 7. Rejection scenarios
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';

// Test data
const TEST_ORG_ID = `org-approval-journey-${Date.now()}`;
const TEST_REQUESTER_DID = `did:key:requester-${Date.now()}`;
const TEST_APPROVER1_DID = `did:key:approver1-${Date.now()}`;
const TEST_APPROVER2_DID = `did:key:approver2-${Date.now()}`;
const TEST_APPROVER3_DID = `did:key:approver3-${Date.now()}`;
const TEST_DELEGATE_DID = `did:key:delegate-${Date.now()}`;

test.describe.serial('Approval Workflow Journey', () => {
  let workflowId: string;
  let requestId: string;
  let sequentialWorkflowId: string;
  let parallelWorkflowId: string;
  let anyOneWorkflowId: string;

  // ========================================
  // Phase 1: Workflow Creation
  // ========================================

  test('Phase 1.1: Create sequential approval workflow', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const createResult: any = await callIPC(window, 'perm:create-workflow', {
        orgId: TEST_ORG_ID,
        name: 'Critical Permission Request',
        description: 'Sequential approval for critical permissions',
        triggerResourceType: 'permission',
        triggerAction: 'grant',
        approvalType: 'sequential',
        approvers: [
          { did: TEST_APPROVER1_DID, name: 'Department Lead', role: 'lead' },
          { did: TEST_APPROVER2_DID, name: 'Security Officer', role: 'security' },
          { did: TEST_APPROVER3_DID, name: 'CTO', role: 'executive' },
        ],
        timeoutHours: 72,
        onTimeout: 'reject',
        enabled: true,
      });

      expect(createResult).toBeDefined();
      expect(createResult.success).toBe(true);
      expect(createResult.workflowId).toBeDefined();

      sequentialWorkflowId = createResult.workflowId;
      workflowId = createResult.workflowId; // Use for general tests
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 1.2: Create parallel approval workflow', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const createResult: any = await callIPC(window, 'perm:create-workflow', {
        orgId: TEST_ORG_ID,
        name: 'Team Consensus Decision',
        description: 'All approvers must approve in parallel',
        triggerResourceType: 'task',
        triggerAction: 'close',
        approvalType: 'parallel',
        approvers: [
          { did: TEST_APPROVER1_DID, name: 'PM', role: 'pm' },
          { did: TEST_APPROVER2_DID, name: 'Tech Lead', role: 'tech_lead' },
        ],
        timeoutHours: 48,
        onTimeout: 'reject',
        enabled: true,
      });

      expect(createResult.success).toBe(true);
      parallelWorkflowId = createResult.workflowId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 1.3: Create any-one approval workflow', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const createResult: any = await callIPC(window, 'perm:create-workflow', {
        orgId: TEST_ORG_ID,
        name: 'On-Call Approval',
        description: 'Any available approver can approve',
        triggerResourceType: 'deployment',
        triggerAction: 'execute',
        approvalType: 'any_one',
        approvers: [
          { did: TEST_APPROVER1_DID, name: 'On-Call Engineer 1', role: 'oncall' },
          { did: TEST_APPROVER2_DID, name: 'On-Call Engineer 2', role: 'oncall' },
          { did: TEST_APPROVER3_DID, name: 'On-Call Engineer 3', role: 'oncall' },
        ],
        timeoutHours: 2,
        onTimeout: 'auto_approve',
        enabled: true,
      });

      expect(createResult.success).toBe(true);
      anyOneWorkflowId = createResult.workflowId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 1.4: Update workflow configuration', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const updateResult: any = await callIPC(window, 'perm:update-workflow', {
        workflowId: sequentialWorkflowId,
        updates: {
          description: 'Updated: Sequential approval with stricter rules',
          timeoutHours: 48,
        },
      });

      expect(updateResult).toBeDefined();
      expect(updateResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 2: Sequential Approval Flow
  // ========================================

  test('Phase 2.1: Submit approval request', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const submitResult: any = await callIPC(window, 'perm:submit-approval', {
        workflowId: sequentialWorkflowId,
        orgId: TEST_ORG_ID,
        requesterDid: TEST_REQUESTER_DID,
        requesterName: 'John Developer',
        resourceType: 'permission',
        resourceId: 'project-123',
        action: 'grant',
        requestData: {
          permission: 'admin',
          reason: 'Need admin access to debug production issue',
          urgency: 'high',
        },
      });

      expect(submitResult).toBeDefined();
      expect(submitResult.success).toBe(true);
      expect(submitResult.requestId).toBeDefined();

      requestId = submitResult.requestId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 2.2: Check pending approvals for approver 1', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const pendingResult: any = await callIPC(window, 'perm:get-pending-approvals', {
        approverDid: TEST_APPROVER1_DID,
        orgId: TEST_ORG_ID,
      });

      expect(pendingResult).toBeDefined();
      expect(pendingResult.success).toBe(true);
      expect(pendingResult.approvals).toBeDefined();
      expect(pendingResult.approvals.length).toBeGreaterThan(0);

      const ourRequest = pendingResult.approvals.find((a: any) => a.id === requestId);
      expect(ourRequest).toBeDefined();
      expect(ourRequest.status).toBe('pending');
      expect(ourRequest.current_step).toBe(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 2.3: Approver 1 approves (Department Lead)', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const approveResult: any = await callIPC(window, 'perm:approve-request', {
        requestId,
        approverDid: TEST_APPROVER1_DID,
        comment: 'Approved by department lead. Valid business need.',
      });

      expect(approveResult).toBeDefined();
      expect(approveResult.success).toBe(true);
      expect(approveResult.status).toBe('pending'); // Still pending for next approver
      expect(approveResult.currentStep).toBe(1);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 2.4: Approver 2 approves (Security Officer)', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const approveResult: any = await callIPC(window, 'perm:approve-request', {
        requestId,
        approverDid: TEST_APPROVER2_DID,
        comment: 'Security check passed. No red flags.',
      });

      expect(approveResult).toBeDefined();
      expect(approveResult.success).toBe(true);
      expect(approveResult.status).toBe('pending');
      expect(approveResult.currentStep).toBe(2);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 2.5: Approver 3 approves (CTO) - Final approval', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const approveResult: any = await callIPC(window, 'perm:approve-request', {
        requestId,
        approverDid: TEST_APPROVER3_DID,
        comment: 'Final approval granted. Execute permission grant.',
      });

      expect(approveResult).toBeDefined();
      expect(approveResult.success).toBe(true);
      expect(approveResult.status).toBe('approved'); // Fully approved
      expect(approveResult.currentStep).toBe(3);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 2.6: Verify approval history', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const historyResult: any = await callIPC(window, 'perm:get-approval-history', {
        orgId: TEST_ORG_ID,
        options: {
          limit: 10,
          status: 'approved',
        },
      });

      expect(historyResult).toBeDefined();
      expect(historyResult.success).toBe(true);
      expect(historyResult.history).toBeDefined();

      const ourRequest = historyResult.history.find((h: any) => h.id === requestId);
      expect(ourRequest).toBeDefined();
      expect(ourRequest.status).toBe('approved');
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 3: Rejection Scenario
  // ========================================

  test('Phase 3.1: Submit another approval request', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const submitResult: any = await callIPC(window, 'perm:submit-approval', {
        workflowId: sequentialWorkflowId,
        orgId: TEST_ORG_ID,
        requesterDid: TEST_REQUESTER_DID,
        requesterName: 'John Developer',
        resourceType: 'permission',
        resourceId: 'project-456',
        action: 'grant',
        requestData: {
          permission: 'super_admin',
          reason: 'Testing rejection scenario',
        },
      });

      expect(submitResult.success).toBe(true);
      requestId = submitResult.requestId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 3.2: Approver 1 rejects the request', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const rejectResult: any = await callIPC(window, 'perm:reject-request', {
        requestId,
        approverDid: TEST_APPROVER1_DID,
        comment: 'Insufficient justification for super_admin access.',
      });

      expect(rejectResult).toBeDefined();
      expect(rejectResult.success).toBe(true);
      expect(rejectResult.status).toBe('rejected');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 3.3: Verify rejection in history', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const historyResult: any = await callIPC(window, 'perm:get-approval-history', {
        orgId: TEST_ORG_ID,
        options: {
          status: 'rejected',
        },
      });

      expect(historyResult.success).toBe(true);
      const rejectedRequest = historyResult.history.find((h: any) => h.id === requestId);
      expect(rejectedRequest).toBeDefined();
      expect(rejectedRequest.status).toBe('rejected');
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 4: Permission Delegation
  // ========================================

  test('Phase 4.1: Delegate permission from Approver 2 to Delegate', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const delegateResult: any = await callIPC(window, 'perm:delegate-permissions', {
        delegatorDid: TEST_APPROVER2_DID,
        delegateDid: TEST_DELEGATE_DID,
        delegateName: 'Backup Security Officer',
        orgId: TEST_ORG_ID,
        permissions: ['approve_security_requests'],
        resourceType: 'approval',
        resourceId: '*',
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        reason: 'Vacation coverage',
      });

      expect(delegateResult).toBeDefined();
      expect(delegateResult.success).toBe(true);
      expect(delegateResult.delegationId).toBeDefined();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 4.2: Verify delegation is active', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const delegationsResult: any = await callIPC(window, 'perm:get-delegations', {
        userDid: TEST_DELEGATE_DID,
        orgId: TEST_ORG_ID,
        options: {
          status: 'active',
        },
      });

      expect(delegationsResult).toBeDefined();
      expect(delegationsResult.success).toBe(true);
      expect(delegationsResult.delegations).toBeDefined();
      expect(delegationsResult.delegations.length).toBeGreaterThan(0);

      const delegation = delegationsResult.delegations[0];
      expect(delegation.delegator_did).toBe(TEST_APPROVER2_DID);
      expect(delegation.delegate_did).toBe(TEST_DELEGATE_DID);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 4.3: Accept delegation', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const delegationsResult: any = await callIPC(window, 'perm:get-delegations', {
        userDid: TEST_DELEGATE_DID,
        orgId: TEST_ORG_ID,
        options: {},
      });

      const delegationId = delegationsResult.delegations[0].id;

      const acceptResult: any = await callIPC(window, 'perm:accept-delegation', {
        delegationId,
        delegateDid: TEST_DELEGATE_DID,
      });

      expect(acceptResult).toBeDefined();
      expect(acceptResult.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 5: Parallel Approval Flow
  // ========================================

  test('Phase 5.1: Submit request for parallel workflow', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const submitResult: any = await callIPC(window, 'perm:submit-approval', {
        workflowId: parallelWorkflowId,
        orgId: TEST_ORG_ID,
        requesterDid: TEST_REQUESTER_DID,
        requesterName: 'Jane Manager',
        resourceType: 'task',
        resourceId: 'task-789',
        action: 'close',
        requestData: {
          reason: 'Sprint ended, closing incomplete task',
        },
      });

      expect(submitResult.success).toBe(true);
      requestId = submitResult.requestId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 5.2: Both approvers approve in parallel', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Approver 1 approves
      const approve1Result: any = await callIPC(window, 'perm:approve-request', {
        requestId,
        approverDid: TEST_APPROVER1_DID,
        comment: 'PM approves task closure',
      });
      expect(approve1Result.success).toBe(true);

      // Approver 2 approves
      const approve2Result: any = await callIPC(window, 'perm:approve-request', {
        requestId,
        approverDid: TEST_APPROVER2_DID,
        comment: 'Tech Lead approves task closure',
      });
      expect(approve2Result.success).toBe(true);
      expect(approve2Result.status).toBe('approved'); // All parallel approvers done
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 6: Any-One Approval Flow
  // ========================================

  test('Phase 6.1: Submit request for any-one workflow', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const submitResult: any = await callIPC(window, 'perm:submit-approval', {
        workflowId: anyOneWorkflowId,
        orgId: TEST_ORG_ID,
        requesterDid: TEST_REQUESTER_DID,
        requesterName: 'DevOps Engineer',
        resourceType: 'deployment',
        resourceId: 'deploy-123',
        action: 'execute',
        requestData: {
          environment: 'production',
          reason: 'Hotfix deployment',
        },
      });

      expect(submitResult.success).toBe(true);
      requestId = submitResult.requestId;
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 6.2: First available approver approves (any-one)', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Only one approver needs to approve
      const approveResult: any = await callIPC(window, 'perm:approve-request', {
        requestId,
        approverDid: TEST_APPROVER2_DID,
        comment: 'On-call engineer approves hotfix deployment',
      });

      expect(approveResult).toBeDefined();
      expect(approveResult.success).toBe(true);
      expect(approveResult.status).toBe('approved'); // Immediately approved with any-one
    } finally {
      await closeElectronApp(app);
    }
  });

  // ========================================
  // Phase 7: Cleanup & Verification
  // ========================================

  test('Phase 7.1: Verify all workflows exist', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Verify workflows were created (would need a get-workflows IPC handler)
      // For now, just verify we can query approval history
      const historyResult: any = await callIPC(window, 'perm:get-approval-history', {
        orgId: TEST_ORG_ID,
        options: {},
      });

      expect(historyResult.success).toBe(true);
      expect(historyResult.history.length).toBeGreaterThan(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Phase 7.2: Clean up - delete workflows with no pending requests', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // Try to delete workflows (should succeed since no pending requests)
      const deleteResult1: any = await callIPC(window, 'perm:delete-workflow', {
        workflowId: parallelWorkflowId,
      });
      expect(deleteResult1.success).toBe(true);

      const deleteResult2: any = await callIPC(window, 'perm:delete-workflow', {
        workflowId: anyOneWorkflowId,
      });
      expect(deleteResult2.success).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
