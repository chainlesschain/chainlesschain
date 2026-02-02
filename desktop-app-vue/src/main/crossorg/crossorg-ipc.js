/**
 * Cross-Organization IPC Handlers
 *
 * Provides 35 IPC handlers for cross-organization collaboration:
 * - Partnership management (8)
 * - Shared workspaces (10)
 * - Resource sharing (8)
 * - B2B data exchange (6)
 * - Discovery (3)
 *
 * @module crossorg/crossorg-ipc
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * Register all cross-organization IPC handlers
 */
function registerCrossOrgIPC(database) {
  logger.info('[IPC] 注册跨组织协作IPC处理器 (35个handlers)');

  // ========================================
  // Partnership Management (8 handlers)
  // ========================================

  ipcMain.handle('crossorg:create-partnership', async (_event, params) => {
    try {
      const { getPartnershipManager } = require('./partnership-manager');
      const manager = getPartnershipManager(database);
      return await manager.createPartnership(params);
    } catch (error) {
      logger.error('[IPC] crossorg:create-partnership failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:accept-partnership', async (_event, params) => {
    try {
      const { getPartnershipManager } = require('./partnership-manager');
      const manager = getPartnershipManager(database);
      return await manager.acceptPartnership(params.partnershipId, params.acceptedByDid);
    } catch (error) {
      logger.error('[IPC] crossorg:accept-partnership failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:reject-partnership', async (_event, params) => {
    try {
      const { getPartnershipManager } = require('./partnership-manager');
      const manager = getPartnershipManager(database);
      return await manager.rejectPartnership(params.partnershipId, params.rejectedByDid, params.reason);
    } catch (error) {
      logger.error('[IPC] crossorg:reject-partnership failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:update-partnership', async (_event, params) => {
    try {
      const { getPartnershipManager } = require('./partnership-manager');
      const manager = getPartnershipManager(database);
      return await manager.updatePartnership(params.partnershipId, params.updates);
    } catch (error) {
      logger.error('[IPC] crossorg:update-partnership failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:terminate-partnership', async (_event, params) => {
    try {
      const { getPartnershipManager } = require('./partnership-manager');
      const manager = getPartnershipManager(database);
      return await manager.terminatePartnership(params.partnershipId, params.terminatedByDid, params.reason);
    } catch (error) {
      logger.error('[IPC] crossorg:terminate-partnership failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:get-partnerships', async (_event, params) => {
    try {
      const { getPartnershipManager } = require('./partnership-manager');
      const manager = getPartnershipManager(database);
      return await manager.getPartnerships(params.orgId, params.options || {});
    } catch (error) {
      logger.error('[IPC] crossorg:get-partnerships failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:get-partner-orgs', async (_event, params) => {
    try {
      const { getPartnershipManager } = require('./partnership-manager');
      const manager = getPartnershipManager(database);
      return await manager.getPartnerOrgs(params.orgId);
    } catch (error) {
      logger.error('[IPC] crossorg:get-partner-orgs failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:update-trust-level', async (_event, params) => {
    try {
      const { getPartnershipManager } = require('./partnership-manager');
      const manager = getPartnershipManager(database);
      return await manager.updateTrustLevel(params.partnershipId, params.trustLevel, params.updatedByDid);
    } catch (error) {
      logger.error('[IPC] crossorg:update-trust-level failed:', error);
      throw error;
    }
  });

  // ========================================
  // Shared Workspaces (10 handlers)
  // ========================================

  ipcMain.handle('crossorg:create-workspace', async (_event, params) => {
    try {
      const { getSharedWorkspaceManager } = require('./shared-workspace-manager');
      const manager = getSharedWorkspaceManager(database);
      return await manager.createWorkspace(params);
    } catch (error) {
      logger.error('[IPC] crossorg:create-workspace failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:update-workspace', async (_event, params) => {
    try {
      const { getSharedWorkspaceManager } = require('./shared-workspace-manager');
      const manager = getSharedWorkspaceManager(database);
      return await manager.updateWorkspace(params.workspaceId, params.updates);
    } catch (error) {
      logger.error('[IPC] crossorg:update-workspace failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:archive-workspace', async (_event, params) => {
    try {
      const { getSharedWorkspaceManager } = require('./shared-workspace-manager');
      const manager = getSharedWorkspaceManager(database);
      return await manager.archiveWorkspace(params.workspaceId, params.archivedByDid);
    } catch (error) {
      logger.error('[IPC] crossorg:archive-workspace failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:invite-org', async (_event, params) => {
    try {
      const { getSharedWorkspaceManager } = require('./shared-workspace-manager');
      const manager = getSharedWorkspaceManager(database);
      return await manager.inviteOrg(params.workspaceId, params.orgData, params.invitedByDid);
    } catch (error) {
      logger.error('[IPC] crossorg:invite-org failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:remove-org', async (_event, params) => {
    try {
      const { getSharedWorkspaceManager } = require('./shared-workspace-manager');
      const manager = getSharedWorkspaceManager(database);
      return await manager.removeOrg(params.workspaceId, params.orgId, params.removedByDid);
    } catch (error) {
      logger.error('[IPC] crossorg:remove-org failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:add-member', async (_event, params) => {
    try {
      const { getSharedWorkspaceManager } = require('./shared-workspace-manager');
      const manager = getSharedWorkspaceManager(database);
      return await manager.addMember(params.workspaceId, params.memberData, params.addedByDid);
    } catch (error) {
      logger.error('[IPC] crossorg:add-member failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:remove-member', async (_event, params) => {
    try {
      const { getSharedWorkspaceManager } = require('./shared-workspace-manager');
      const manager = getSharedWorkspaceManager(database);
      return await manager.removeMember(params.workspaceId, params.memberDid, params.removedByDid);
    } catch (error) {
      logger.error('[IPC] crossorg:remove-member failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:get-workspaces', async (_event, params) => {
    try {
      const { getSharedWorkspaceManager } = require('./shared-workspace-manager');
      const manager = getSharedWorkspaceManager(database);
      return await manager.getWorkspaces(params.orgId, params.options || {});
    } catch (error) {
      logger.error('[IPC] crossorg:get-workspaces failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:get-workspace-members', async (_event, params) => {
    try {
      const { getSharedWorkspaceManager } = require('./shared-workspace-manager');
      const manager = getSharedWorkspaceManager(database);
      return await manager.getWorkspaceMembers(params.workspaceId, params.options || {});
    } catch (error) {
      logger.error('[IPC] crossorg:get-workspace-members failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:update-member-role', async (_event, params) => {
    try {
      const { getSharedWorkspaceManager } = require('./shared-workspace-manager');
      const manager = getSharedWorkspaceManager(database);
      return await manager.updateMemberRole(
        params.workspaceId,
        params.memberDid,
        params.role,
        params.permissions,
        params.updatedByDid
      );
    } catch (error) {
      logger.error('[IPC] crossorg:update-member-role failed:', error);
      throw error;
    }
  });

  // ========================================
  // Resource Sharing (8 handlers)
  // ========================================

  ipcMain.handle('crossorg:share-resource', async (_event, params) => {
    try {
      const { getResourceSharingManager } = require('./resource-sharing-manager');
      const manager = getResourceSharingManager(database);
      return await manager.shareResource(params);
    } catch (error) {
      logger.error('[IPC] crossorg:share-resource failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:unshare-resource', async (_event, params) => {
    try {
      const { getResourceSharingManager } = require('./resource-sharing-manager');
      const manager = getResourceSharingManager(database);
      return await manager.unshareResource(params.shareId, params.unsharerDid);
    } catch (error) {
      logger.error('[IPC] crossorg:unshare-resource failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:get-shared-resources', async (_event, params) => {
    try {
      const { getResourceSharingManager } = require('./resource-sharing-manager');
      const manager = getResourceSharingManager(database);
      return await manager.getSharedResources(params.orgId, params.options || {});
    } catch (error) {
      logger.error('[IPC] crossorg:get-shared-resources failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:access-shared-resource', async (_event, params) => {
    try {
      const { getResourceSharingManager } = require('./resource-sharing-manager');
      const manager = getResourceSharingManager(database);
      return await manager.accessSharedResource(params.shareId, params.accessorDid, params.accessorOrgId);
    } catch (error) {
      logger.error('[IPC] crossorg:access-shared-resource failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:update-share-permissions', async (_event, params) => {
    try {
      const { getResourceSharingManager } = require('./resource-sharing-manager');
      const manager = getResourceSharingManager(database);
      return await manager.updateSharePermissions(params.shareId, params.permissions, params.updatedByDid);
    } catch (error) {
      logger.error('[IPC] crossorg:update-share-permissions failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:get-share-analytics', async (_event, params) => {
    try {
      const { getResourceSharingManager } = require('./resource-sharing-manager');
      const manager = getResourceSharingManager(database);
      return await manager.getShareAnalytics(params.orgId, params.options || {});
    } catch (error) {
      logger.error('[IPC] crossorg:get-share-analytics failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:sync-resource', async (_event, params) => {
    try {
      const { getResourceSharingManager } = require('./resource-sharing-manager');
      const manager = getResourceSharingManager(database);
      return await manager.syncResource(params.shareId, params.syncByDid);
    } catch (error) {
      logger.error('[IPC] crossorg:sync-resource failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:request-resource', async (_event, params) => {
    try {
      const { getResourceSharingManager } = require('./resource-sharing-manager');
      const manager = getResourceSharingManager(database);
      return await manager.requestResource(params);
    } catch (error) {
      logger.error('[IPC] crossorg:request-resource failed:', error);
      throw error;
    }
  });

  // ========================================
  // B2B Data Exchange (6 handlers)
  // ========================================

  ipcMain.handle('crossorg:initiate-transaction', async (_event, params) => {
    try {
      const { getB2BExchangeManager } = require('./b2b-exchange-manager');
      const manager = getB2BExchangeManager(database);
      return await manager.initiateTransaction(params);
    } catch (error) {
      logger.error('[IPC] crossorg:initiate-transaction failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:accept-transaction', async (_event, params) => {
    try {
      const { getB2BExchangeManager } = require('./b2b-exchange-manager');
      const manager = getB2BExchangeManager(database);
      return await manager.acceptTransaction(params.transactionId, params.acceptedByDid);
    } catch (error) {
      logger.error('[IPC] crossorg:accept-transaction failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:reject-transaction', async (_event, params) => {
    try {
      const { getB2BExchangeManager } = require('./b2b-exchange-manager');
      const manager = getB2BExchangeManager(database);
      return await manager.rejectTransaction(params.transactionId, params.rejectedByDid, params.reason);
    } catch (error) {
      logger.error('[IPC] crossorg:reject-transaction failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:get-transactions', async (_event, params) => {
    try {
      const { getB2BExchangeManager } = require('./b2b-exchange-manager');
      const manager = getB2BExchangeManager(database);
      return await manager.getTransactions(params.orgId, params.options || {});
    } catch (error) {
      logger.error('[IPC] crossorg:get-transactions failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:verify-data-integrity', async (_event, params) => {
    try {
      const { getB2BExchangeManager } = require('./b2b-exchange-manager');
      const manager = getB2BExchangeManager(database);
      return await manager.verifyDataIntegrity(params.transactionId, params.providedHash);
    } catch (error) {
      logger.error('[IPC] crossorg:verify-data-integrity failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:get-audit-log', async (_event, params) => {
    try {
      const { getB2BExchangeManager } = require('./b2b-exchange-manager');
      const manager = getB2BExchangeManager(database);
      return await manager.getAuditLog(params.orgId, params.options || {});
    } catch (error) {
      logger.error('[IPC] crossorg:get-audit-log failed:', error);
      throw error;
    }
  });

  // ========================================
  // Discovery (3 handlers)
  // ========================================

  ipcMain.handle('crossorg:discover-orgs', async (_event, params) => {
    try {
      const { getPartnershipManager } = require('./partnership-manager');
      const manager = getPartnershipManager(database);
      return await manager.discoverOrgs(params || {});
    } catch (error) {
      logger.error('[IPC] crossorg:discover-orgs failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:get-org-profile', async (_event, params) => {
    try {
      const { getPartnershipManager } = require('./partnership-manager');
      const manager = getPartnershipManager(database);
      return await manager.getOrgProfile(params.orgId);
    } catch (error) {
      logger.error('[IPC] crossorg:get-org-profile failed:', error);
      throw error;
    }
  });

  ipcMain.handle('crossorg:search-shared-resources', async (_event, params) => {
    try {
      const { getResourceSharingManager } = require('./resource-sharing-manager');
      const manager = getResourceSharingManager(database);
      return await manager.searchSharedResources(params.orgId, params.searchParams || {});
    } catch (error) {
      logger.error('[IPC] crossorg:search-shared-resources failed:', error);
      throw error;
    }
  });

  logger.info('[IPC] 跨组织协作IPC处理器注册完成 (35个handlers)');
}

module.exports = {
  registerCrossOrgIPC
};
