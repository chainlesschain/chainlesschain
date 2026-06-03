/**
 * ApprovalWorkflowManager 单元测试
 *
 * 测试内容：
 * - ApprovalWorkflowManager 构造函数
 * - createWorkflow 创建工作流
 * - updateWorkflow 更新工作流
 * - deleteWorkflow 删除工作流
 * - submitApproval 提交审批
 * - approveRequest 批准请求
 * - rejectRequest 拒绝请求
 * - _processDecision 处理决策
 * - getPendingApprovals 获取待审批
 * - getApprovalHistory 获取审批历史
 * - _isAuthorizedApprover 授权检查
 * - _getApproverCount 审批人计数
 * - _handleTimeout 超时处理
 * - getApprovalWorkflowManager 单例
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

const { ApprovalWorkflowManager, getApprovalWorkflowManager } = require('../approval-workflow-manager');

// Helper to create mock database
function createMockDatabase() {
  const mockPrepare = vi.fn();
  const mockDb = {
    getDatabase: vi.fn(() => ({
      prepare: mockPrepare,
    })),
  };
  return { mockDb, mockPrepare };
}

describe('ApprovalWorkflowManager', () => {
  let manager;
  let mockDb;
  let mockPrepare;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const mocks = createMockDatabase();
    mockDb = mocks.mockDb;
    mockPrepare = mocks.mockPrepare;
    manager = new ApprovalWorkflowManager(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with database', () => {
      expect(manager.database).toBe(mockDb);
    });

    it('should initialize empty timeout timers', () => {
      expect(manager.timeoutTimers).toBeInstanceOf(Map);
      expect(manager.timeoutTimers.size).toBe(0);
    });

    it('should be an EventEmitter', () => {
      expect(typeof manager.on).toBe('function');
      expect(typeof manager.emit).toBe('function');
    });
  });

  describe('createWorkflow', () => {
    it('should create a workflow', async () => {
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ run: runMock });

      const result = await manager.createWorkflow({
        orgId: 'org1',
        name: 'Test Workflow',
        description: 'A test workflow',
        triggerResourceType: 'document',
        triggerAction: 'delete',
        approvers: [['admin1'], ['manager1']],
      });

      expect(result.success).toBe(true);
      expect(result.workflowId).toBeDefined();
      expect(runMock).toHaveBeenCalled();
    });

    it('should use default values', async () => {
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ run: runMock });

      await manager.createWorkflow({
        orgId: 'org1',
        name: 'Test',
        approvers: [['admin1']],
      });

      // Check that run was called with default values
      const callArgs = runMock.mock.calls[0];
      expect(callArgs).toContainEqual('sequential'); // approvalType default
      expect(callArgs).toContain(72); // timeoutHours default
      expect(callArgs).toContainEqual('reject'); // onTimeout default
      expect(callArgs).toContain(1); // enabled default
    });

    it('should throw on database error', async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(manager.createWorkflow({
        orgId: 'org1',
        name: 'Test',
        approvers: [],
      })).rejects.toThrow('Database error');
    });
  });

  describe('updateWorkflow', () => {
    it('should update allowed fields', async () => {
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ run: runMock });

      const result = await manager.updateWorkflow('wf1', {
        name: 'Updated Name',
        description: 'Updated Description',
        enabled: false,
      });

      expect(result.success).toBe(true);
      expect(runMock).toHaveBeenCalled();
    });

    it('should return success for empty updates', async () => {
      const result = await manager.updateWorkflow('wf1', {});

      expect(result.success).toBe(true);
      expect(mockPrepare).not.toHaveBeenCalled();
    });

    it('should convert camelCase to snake_case', async () => {
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ run: runMock });

      await manager.updateWorkflow('wf1', {
        timeoutHours: 48,
        onTimeout: 'approve',
      });

      // The query should use snake_case
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('timeout_hours')
      );
    });

    it('should throw on database error', async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error('Update failed');
      });

      await expect(manager.updateWorkflow('wf1', { name: 'New' })).rejects.toThrow('Update failed');
    });
  });

  describe('deleteWorkflow', () => {
    it('should delete workflow when no pending requests', async () => {
      const getMock = vi.fn().mockReturnValue({ count: 0 });
      const runMock = vi.fn();
      mockPrepare.mockReturnValueOnce({ get: getMock }).mockReturnValueOnce({ run: runMock });

      const result = await manager.deleteWorkflow('wf1');

      expect(result.success).toBe(true);
      expect(runMock).toHaveBeenCalled();
    });

    it('should fail when pending requests exist', async () => {
      const getMock = vi.fn().mockReturnValue({ count: 3 });
      mockPrepare.mockReturnValue({ get: getMock });

      const result = await manager.deleteWorkflow('wf1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('HAS_PENDING_REQUESTS');
    });

    it('should throw on database error', async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error('Delete failed');
      });

      await expect(manager.deleteWorkflow('wf1')).rejects.toThrow('Delete failed');
    });
  });

  describe('submitApproval', () => {
    it('should submit approval request', async () => {
      const getMock = vi.fn().mockReturnValue({
        id: 'wf1',
        org_id: 'org1',
        approvers: JSON.stringify([['admin1']]),
        timeout_hours: 72,
        on_timeout: 'reject',
        enabled: 1,
      });
      const runMock = vi.fn();
      mockPrepare.mockReturnValueOnce({ get: getMock }).mockReturnValueOnce({ run: runMock });

      const eventHandler = vi.fn();
      manager.on('approval-requested', eventHandler);

      const result = await manager.submitApproval({
        workflowId: 'wf1',
        requesterDid: 'did:user1',
        requesterName: 'User 1',
        resourceType: 'document',
        resourceId: 'doc1',
        action: 'delete',
      });

      expect(result.success).toBe(true);
      expect(result.requestId).toBeDefined();
      expect(eventHandler).toHaveBeenCalled();
    });

    it('should return error when workflow not found', async () => {
      const getMock = vi.fn().mockReturnValue(null);
      mockPrepare.mockReturnValue({ get: getMock });

      const result = await manager.submitApproval({ workflowId: 'unknown' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('WORKFLOW_NOT_FOUND');
    });

    it('should set timeout timer', async () => {
      const getMock = vi.fn().mockReturnValue({
        approvers: JSON.stringify([['admin1']]),
        timeout_hours: 1,
        on_timeout: 'reject',
      });
      const runMock = vi.fn();
      mockPrepare.mockReturnValueOnce({ get: getMock }).mockReturnValueOnce({ run: runMock });

      await manager.submitApproval({ workflowId: 'wf1' });

      expect(manager.timeoutTimers.size).toBe(1);
    });
  });

  describe('approveRequest', () => {
    it('should call _processDecision with approve', async () => {
      const spy = vi.spyOn(manager, '_processDecision').mockResolvedValue({ success: true });

      await manager.approveRequest('req1', 'did:approver', 'LGTM');

      expect(spy).toHaveBeenCalledWith('req1', 'did:approver', 'approve', 'LGTM');
    });
  });

  describe('rejectRequest', () => {
    it('should call _processDecision with reject', async () => {
      const spy = vi.spyOn(manager, '_processDecision').mockResolvedValue({ success: true });

      await manager.rejectRequest('req1', 'did:approver', 'Not approved');

      expect(spy).toHaveBeenCalledWith('req1', 'did:approver', 'reject', 'Not approved');
    });
  });

  describe('_processDecision', () => {
    it('should return error when request not found', async () => {
      const getMock = vi.fn().mockReturnValue(null);
      mockPrepare.mockReturnValue({ get: getMock });

      const result = await manager._processDecision('req1', 'did:approver', 'approve', null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('REQUEST_NOT_FOUND');
    });

    it('should return error when approver not authorized', async () => {
      const getMock = vi.fn().mockReturnValue({
        approvers: JSON.stringify([['admin1']]),
        current_step: 0,
        approval_type: 'sequential',
      });
      mockPrepare.mockReturnValue({ get: getMock });

      const result = await manager._processDecision('req1', 'did:unauthorized', 'approve', null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_AUTHORIZED');
    });

    it('should reject and complete request', async () => {
      const getMock = vi.fn().mockReturnValue({
        id: 'req1',
        approvers: JSON.stringify([['did:approver']]),
        current_step: 0,
        total_steps: 1,
        approval_type: 'sequential',
      });
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ get: getMock, run: runMock });

      const eventHandler = vi.fn();
      manager.on('approval-rejected', eventHandler);

      const result = await manager._processDecision('req1', 'did:approver', 'reject', 'Denied');

      expect(result.success).toBe(true);
      expect(result.finalStatus).toBe('rejected');
      expect(eventHandler).toHaveBeenCalled();
    });

    it('should complete request when last step approved', async () => {
      const getMock = vi.fn().mockReturnValue({
        id: 'req1',
        approvers: JSON.stringify([['did:approver']]),
        current_step: 0,
        total_steps: 1,
        approval_type: 'sequential',
      });
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ get: getMock, run: runMock });

      const eventHandler = vi.fn();
      manager.on('approval-approved', eventHandler);

      const result = await manager._processDecision('req1', 'did:approver', 'approve', null);

      expect(result.success).toBe(true);
      expect(result.finalStatus).toBe('approved');
      expect(eventHandler).toHaveBeenCalled();
    });

    it('should advance to next step for sequential approval', async () => {
      const getMock = vi.fn().mockReturnValue({
        id: 'req1',
        approvers: JSON.stringify([['did:approver1'], ['did:approver2']]),
        current_step: 0,
        total_steps: 2,
        approval_type: 'sequential',
      });
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ get: getMock, run: runMock });

      const eventHandler = vi.fn();
      manager.on('approval-next-step', eventHandler);

      const result = await manager._processDecision('req1', 'did:approver1', 'approve', null);

      expect(result.success).toBe(true);
      expect(result.currentStep).toBe(1);
      expect(eventHandler).toHaveBeenCalled();
    });

    it('should handle any_one approval type', async () => {
      const getMock = vi.fn().mockReturnValue({
        id: 'req1',
        approvers: JSON.stringify([['did:a', 'did:b'], ['did:c']]),
        current_step: 0,
        total_steps: 2,
        approval_type: 'any_one',
      });
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ get: getMock, run: runMock });

      const result = await manager._processDecision('req1', 'did:a', 'approve', null);

      expect(result.success).toBe(true);
      expect(result.currentStep).toBe(1);
    });

    it('should handle parallel approval type', async () => {
      const countMock = vi.fn().mockReturnValue({ count: 2 });
      const getMock = vi.fn().mockReturnValue({
        id: 'req1',
        approvers: JSON.stringify([['did:a', 'did:b']]),
        current_step: 0,
        total_steps: 1,
        approval_type: 'parallel',
      });
      const runMock = vi.fn();
      mockPrepare
        .mockReturnValueOnce({ get: getMock })
        .mockReturnValueOnce({ run: runMock })
        .mockReturnValueOnce({ get: countMock })
        .mockReturnValueOnce({ run: runMock });

      const result = await manager._processDecision('req1', 'did:a', 'approve', null);

      expect(result.success).toBe(true);
    });
  });

  describe('getPendingApprovals', () => {
    it('should return pending approvals for user', async () => {
      const allMock = vi.fn().mockReturnValue([
        {
          id: 'req1',
          workflow_id: 'wf1',
          workflow_name: 'Workflow 1',
          requester_did: 'did:user',
          requester_name: 'User',
          resource_type: 'doc',
          resource_id: 'doc1',
          action: 'delete',
          request_data: null,
          current_step: 0,
          total_steps: 1,
          created_at: Date.now(),
          approvers: JSON.stringify([['did:approver']]),
        },
      ]);
      mockPrepare.mockReturnValue({ all: allMock });

      const result = await manager.getPendingApprovals('did:approver', 'org1');

      expect(result.success).toBe(true);
      expect(result.requests).toHaveLength(1);
      expect(result.requests[0].id).toBe('req1');
    });

    it('should filter out requests where user is not approver', async () => {
      const allMock = vi.fn().mockReturnValue([
        {
          id: 'req1',
          approvers: JSON.stringify([['did:other']]),
          current_step: 0,
        },
      ]);
      mockPrepare.mockReturnValue({ all: allMock });

      const result = await manager.getPendingApprovals('did:approver', 'org1');

      expect(result.success).toBe(true);
      expect(result.requests).toHaveLength(0);
    });
  });

  describe('getApprovalHistory', () => {
    it('should return approval history', async () => {
      const allMock = vi.fn().mockReturnValue([
        {
          id: 'req1',
          workflow_id: 'wf1',
          workflow_name: 'Workflow 1',
          requester_did: 'did:user',
          requester_name: 'User',
          resource_type: 'doc',
          resource_id: 'doc1',
          action: 'delete',
          status: 'approved',
          current_step: 1,
          total_steps: 1,
          created_at: Date.now(),
          completed_at: Date.now(),
        },
      ]);
      mockPrepare.mockReturnValue({ all: allMock });

      const result = await manager.getApprovalHistory('org1');

      expect(result.success).toBe(true);
      expect(result.requests).toHaveLength(1);
    });

    it('should filter by status', async () => {
      const allMock = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: allMock });

      await manager.getApprovalHistory('org1', { status: 'approved' });

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ar.status = ?')
      );
    });

    it('should filter by requesterDid', async () => {
      const allMock = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: allMock });

      await manager.getApprovalHistory('org1', { requesterDid: 'did:user' });

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ar.requester_did = ?')
      );
    });

    it('should apply limit', async () => {
      const allMock = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: allMock });

      await manager.getApprovalHistory('org1', { limit: 10 });

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?')
      );
    });
  });

  describe('_isAuthorizedApprover', () => {
    it('should return true for matching string approver', () => {
      expect(manager._isAuthorizedApprover('did:user', 'did:user')).toBe(true);
    });

    it('should return false for non-matching string approver', () => {
      expect(manager._isAuthorizedApprover('did:user', 'did:other')).toBe(false);
    });

    it('should return true when approver is in array', () => {
      expect(manager._isAuthorizedApprover('did:user', ['did:user', 'did:other'])).toBe(true);
    });

    it('should return false when approver not in array', () => {
      expect(manager._isAuthorizedApprover('did:user', ['did:admin', 'did:other'])).toBe(false);
    });

    it('should return false for null approvers', () => {
      expect(manager._isAuthorizedApprover('did:user', null)).toBe(false);
    });

    it('should return false for other types', () => {
      expect(manager._isAuthorizedApprover('did:user', { role: 'admin' })).toBe(false);
    });
  });

  describe('_getApproverCount', () => {
    it('should return 1 for string approver', () => {
      expect(manager._getApproverCount('did:user')).toBe(1);
    });

    it('should return array length for array approvers', () => {
      expect(manager._getApproverCount(['did:a', 'did:b', 'did:c'])).toBe(3);
    });

    it('should return 1 for other types', () => {
      expect(manager._getApproverCount({ role: 'admin' })).toBe(1);
    });
  });

  describe('_handleTimeout', () => {
    it('should update request to expired on timeout', async () => {
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ run: runMock });

      const eventHandler = vi.fn();
      manager.on('approval-timeout', eventHandler);

      await manager._handleTimeout('req1', 'expire');

      expect(runMock).toHaveBeenCalled();
      expect(eventHandler).toHaveBeenCalledWith({
        requestId: 'req1',
        action: 'expired',
      });
    });

    it('should auto-approve on timeout when configured', async () => {
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ run: runMock });

      const eventHandler = vi.fn();
      manager.on('approval-timeout', eventHandler);

      await manager._handleTimeout('req1', 'approve');

      expect(eventHandler).toHaveBeenCalledWith({
        requestId: 'req1',
        action: 'approved',
      });
    });

    it('should auto-reject on timeout when configured', async () => {
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ run: runMock });

      const eventHandler = vi.fn();
      manager.on('approval-timeout', eventHandler);

      await manager._handleTimeout('req1', 'reject');

      expect(eventHandler).toHaveBeenCalledWith({
        requestId: 'req1',
        action: 'rejected',
      });
    });

    it('should delete timer after timeout', async () => {
      const runMock = vi.fn();
      mockPrepare.mockReturnValue({ run: runMock });

      manager.timeoutTimers.set('req1', setTimeout(() => {}, 1000));

      await manager._handleTimeout('req1', 'expire');

      expect(manager.timeoutTimers.has('req1')).toBe(false);
    });
  });

  describe('_clearTimeout', () => {
    it('should clear timeout timer', () => {
      const timer = setTimeout(() => {}, 10000);
      manager.timeoutTimers.set('req1', timer);

      manager._clearTimeout('req1');

      expect(manager.timeoutTimers.has('req1')).toBe(false);
    });

    it('should handle non-existent timer gracefully', () => {
      // Should not throw
      manager._clearTimeout('unknown');
    });
  });
});

describe('getApprovalWorkflowManager', () => {
  it('should return manager instance', () => {
    const mockDb = { getDatabase: vi.fn() };
    const manager = getApprovalWorkflowManager(mockDb);

    expect(manager).toBeInstanceOf(ApprovalWorkflowManager);
  });

  it('should return same instance on subsequent calls', () => {
    const mockDb = { getDatabase: vi.fn() };
    const manager1 = getApprovalWorkflowManager(mockDb);
    const manager2 = getApprovalWorkflowManager(mockDb);

    expect(manager1).toBe(manager2);
  });
});
