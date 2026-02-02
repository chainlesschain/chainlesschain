/**
 * Permission System IPC Handlers
 *
 * Provides 28 IPC handlers for enterprise permission management:
 * - Permission management (8)
 * - Approval workflows (8)
 * - Delegation (4)
 * - Team management (8)
 *
 * @module permission/permission-ipc
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * Register all permission system IPC handlers
 */
function registerPermissionIPC(database) {
  logger.info('[IPC] 注册权限系统IPC处理器 (28个handlers)');

  // ========================================
  // Permission Management (8 handlers)
  // ========================================

  ipcMain.handle('perm:grant-permission', async (_event, params) => {
    try {
      const { getPermissionEngine } = require('./permission-engine');
      const engine = getPermissionEngine(database);
      return await engine.grantPermission(params);
    } catch (error) {
      logger.error('[IPC] perm:grant-permission failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:revoke-permission', async (_event, params) => {
    try {
      const { getPermissionEngine } = require('./permission-engine');
      const engine = getPermissionEngine(database);
      return await engine.revokePermission(params.grantId, params.revokedBy);
    } catch (error) {
      logger.error('[IPC] perm:revoke-permission failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:check-permission', async (_event, params) => {
    try {
      const { getPermissionEngine } = require('./permission-engine');
      const engine = getPermissionEngine(database);
      return await engine.checkPermission(params);
    } catch (error) {
      logger.error('[IPC] perm:check-permission failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:get-user-permissions', async (_event, params) => {
    try {
      const { getPermissionEngine } = require('./permission-engine');
      const engine = getPermissionEngine(database);
      return await engine.getUserPermissions(params.userDid, params.orgId);
    } catch (error) {
      logger.error('[IPC] perm:get-user-permissions failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:get-resource-permissions', async (_event, params) => {
    try {
      const { getPermissionEngine } = require('./permission-engine');
      const engine = getPermissionEngine(database);
      return await engine.getResourcePermissions(params.orgId, params.resourceType, params.resourceId);
    } catch (error) {
      logger.error('[IPC] perm:get-resource-permissions failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:bulk-grant', async (_event, params) => {
    try {
      const { getPermissionEngine } = require('./permission-engine');
      const engine = getPermissionEngine(database);
      return await engine.bulkGrant(params.grants, params.grantedBy);
    } catch (error) {
      logger.error('[IPC] perm:bulk-grant failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:inherit-permissions', async (_event, params) => {
    try {
      const { getPermissionEngine } = require('./permission-engine');
      const engine = getPermissionEngine(database);
      return await engine.inheritPermissions(params);
    } catch (error) {
      logger.error('[IPC] perm:inherit-permissions failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:get-effective-permissions', async (_event, params) => {
    try {
      const { getPermissionEngine } = require('./permission-engine');
      const engine = getPermissionEngine(database);
      return await engine.getEffectivePermissions(params.userDid, params.orgId, params.resourceType, params.resourceId);
    } catch (error) {
      logger.error('[IPC] perm:get-effective-permissions failed:', error);
      throw error;
    }
  });

  // ========================================
  // Approval Workflows (8 handlers)
  // ========================================

  ipcMain.handle('perm:create-workflow', async (_event, params) => {
    try {
      const { getApprovalWorkflowManager } = require('./approval-workflow-manager');
      const manager = getApprovalWorkflowManager(database);
      return await manager.createWorkflow(params);
    } catch (error) {
      logger.error('[IPC] perm:create-workflow failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:update-workflow', async (_event, params) => {
    try {
      const { getApprovalWorkflowManager } = require('./approval-workflow-manager');
      const manager = getApprovalWorkflowManager(database);
      return await manager.updateWorkflow(params.workflowId, params.updates);
    } catch (error) {
      logger.error('[IPC] perm:update-workflow failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:delete-workflow', async (_event, params) => {
    try {
      const { getApprovalWorkflowManager } = require('./approval-workflow-manager');
      const manager = getApprovalWorkflowManager(database);
      return await manager.deleteWorkflow(params.workflowId);
    } catch (error) {
      logger.error('[IPC] perm:delete-workflow failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:submit-approval', async (_event, params) => {
    try {
      const { getApprovalWorkflowManager } = require('./approval-workflow-manager');
      const manager = getApprovalWorkflowManager(database);
      return await manager.submitApproval(params);
    } catch (error) {
      logger.error('[IPC] perm:submit-approval failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:approve-request', async (_event, params) => {
    try {
      const { getApprovalWorkflowManager } = require('./approval-workflow-manager');
      const manager = getApprovalWorkflowManager(database);
      return await manager.approveRequest(params.requestId, params.approverDid, params.comment);
    } catch (error) {
      logger.error('[IPC] perm:approve-request failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:reject-request', async (_event, params) => {
    try {
      const { getApprovalWorkflowManager } = require('./approval-workflow-manager');
      const manager = getApprovalWorkflowManager(database);
      return await manager.rejectRequest(params.requestId, params.approverDid, params.comment);
    } catch (error) {
      logger.error('[IPC] perm:reject-request failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:get-pending-approvals', async (_event, params) => {
    try {
      const { getApprovalWorkflowManager } = require('./approval-workflow-manager');
      const manager = getApprovalWorkflowManager(database);
      return await manager.getPendingApprovals(params.approverDid, params.orgId);
    } catch (error) {
      logger.error('[IPC] perm:get-pending-approvals failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:get-approval-history', async (_event, params) => {
    try {
      const { getApprovalWorkflowManager } = require('./approval-workflow-manager');
      const manager = getApprovalWorkflowManager(database);
      return await manager.getApprovalHistory(params.orgId, params.options || {});
    } catch (error) {
      logger.error('[IPC] perm:get-approval-history failed:', error);
      throw error;
    }
  });

  // ========================================
  // Delegation (4 handlers)
  // ========================================

  ipcMain.handle('perm:delegate-permissions', async (_event, params) => {
    try {
      const { getDelegationManager } = require('./delegation-manager');
      const manager = getDelegationManager(database);
      return await manager.delegatePermissions(params);
    } catch (error) {
      logger.error('[IPC] perm:delegate-permissions failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:revoke-delegation', async (_event, params) => {
    try {
      const { getDelegationManager } = require('./delegation-manager');
      const manager = getDelegationManager(database);
      return await manager.revokeDelegation(params.delegationId, params.revokerDid);
    } catch (error) {
      logger.error('[IPC] perm:revoke-delegation failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:get-delegations', async (_event, params) => {
    try {
      const { getDelegationManager } = require('./delegation-manager');
      const manager = getDelegationManager(database);
      return await manager.getDelegations(params.userDid, params.orgId, params.options || {});
    } catch (error) {
      logger.error('[IPC] perm:get-delegations failed:', error);
      throw error;
    }
  });

  ipcMain.handle('perm:accept-delegation', async (_event, params) => {
    try {
      const { getDelegationManager } = require('./delegation-manager');
      const manager = getDelegationManager(database);
      return await manager.acceptDelegation(params.delegationId, params.delegateDid);
    } catch (error) {
      logger.error('[IPC] perm:accept-delegation failed:', error);
      throw error;
    }
  });

  // ========================================
  // Team Management (8 handlers)
  // ========================================

  ipcMain.handle('team:create-team', async (_event, params) => {
    try {
      const { getTeamManager } = require('./team-manager');
      const manager = getTeamManager(database);
      return await manager.createTeam(params);
    } catch (error) {
      logger.error('[IPC] team:create-team failed:', error);
      throw error;
    }
  });

  ipcMain.handle('team:update-team', async (_event, params) => {
    try {
      const { getTeamManager } = require('./team-manager');
      const manager = getTeamManager(database);
      return await manager.updateTeam(params.teamId, params.updates);
    } catch (error) {
      logger.error('[IPC] team:update-team failed:', error);
      throw error;
    }
  });

  ipcMain.handle('team:delete-team', async (_event, params) => {
    try {
      const { getTeamManager } = require('./team-manager');
      const manager = getTeamManager(database);
      return await manager.deleteTeam(params.teamId);
    } catch (error) {
      logger.error('[IPC] team:delete-team failed:', error);
      throw error;
    }
  });

  ipcMain.handle('team:add-member', async (_event, params) => {
    try {
      const { getTeamManager } = require('./team-manager');
      const manager = getTeamManager(database);
      return await manager.addMember(params.teamId, params.memberDid, params.memberName, params.role, params.invitedBy);
    } catch (error) {
      logger.error('[IPC] team:add-member failed:', error);
      throw error;
    }
  });

  ipcMain.handle('team:remove-member', async (_event, params) => {
    try {
      const { getTeamManager } = require('./team-manager');
      const manager = getTeamManager(database);
      return await manager.removeMember(params.teamId, params.memberDid);
    } catch (error) {
      logger.error('[IPC] team:remove-member failed:', error);
      throw error;
    }
  });

  ipcMain.handle('team:set-lead', async (_event, params) => {
    try {
      const { getTeamManager } = require('./team-manager');
      const manager = getTeamManager(database);
      return await manager.setLead(params.teamId, params.leadDid, params.leadName);
    } catch (error) {
      logger.error('[IPC] team:set-lead failed:', error);
      throw error;
    }
  });

  ipcMain.handle('team:get-teams', async (_event, params) => {
    try {
      const { getTeamManager } = require('./team-manager');
      const manager = getTeamManager(database);
      return await manager.getTeams(params.orgId, params.options || {});
    } catch (error) {
      logger.error('[IPC] team:get-teams failed:', error);
      throw error;
    }
  });

  ipcMain.handle('team:get-team-members', async (_event, params) => {
    try {
      const { getTeamManager } = require('./team-manager');
      const manager = getTeamManager(database);
      return await manager.getTeamMembers(params.teamId);
    } catch (error) {
      logger.error('[IPC] team:get-team-members failed:', error);
      throw error;
    }
  });

  logger.info('[IPC] 权限系统IPC处理器注册完成 (28个handlers)');
}

module.exports = {
  registerPermissionIPC
};
