'use strict';

const { logger } = require('../utils/logger.js');

/**
 * Register Enterprise Organization IPC handlers.
 *
 * All channels are prefixed with `enterprise:` and return
 * `{ success: boolean, data?, error?: string }`.
 *
 * @param {Object} deps
 * @param {Object} deps.enterpriseOrgManager - EnterpriseOrgManager instance (must be initialized)
 * @param {Object} [deps.ipcMain] - Optional injected ipcMain (for testing)
 */
function registerEnterpriseIPC({ enterpriseOrgManager, ipcMain: injectedIpcMain } = {}) {
  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  let registeredCount = 0;

  const safeHandle = (channel, handler) => {
    try {
      try { ipcMain.removeHandler(channel); } catch (_e) { /* ignore */ }
      ipcMain.handle(channel, handler);
      registeredCount++;
    } catch (err) {
      logger.warn(`[Enterprise IPC] Failed to register ${channel}: ${err.message}`);
    }
  };

  // -------------------------------------------------------------------------
  // 1. enterprise:create-department
  // -------------------------------------------------------------------------
  safeHandle('enterprise:create-department', async (_event, params) => {
    try {
      if (!enterpriseOrgManager) {
        return { success: false, error: 'EnterpriseOrgManager not initialized' };
      }

      const { orgId, name, description, parentDeptId, leadDid, leadName } = params;
      const department = await enterpriseOrgManager.createDepartment(orgId, {
        name,
        description,
        parentDeptId,
        leadDid,
        leadName,
      });

      return { success: true, data: department };
    } catch (error) {
      logger.error('[Enterprise IPC] create-department failed:', error);
      return { success: false, error: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // 2. enterprise:get-hierarchy
  // -------------------------------------------------------------------------
  safeHandle('enterprise:get-hierarchy', async (_event, orgId) => {
    try {
      if (!enterpriseOrgManager) {
        return { success: false, error: 'EnterpriseOrgManager not initialized' };
      }

      const hierarchy = await enterpriseOrgManager.getOrgHierarchy(orgId);

      return { success: true, data: hierarchy };
    } catch (error) {
      logger.error('[Enterprise IPC] get-hierarchy failed:', error);
      return { success: false, error: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // 3. enterprise:move-department
  // -------------------------------------------------------------------------
  safeHandle('enterprise:move-department', async (_event, params) => {
    try {
      if (!enterpriseOrgManager) {
        return { success: false, error: 'EnterpriseOrgManager not initialized' };
      }

      const { deptId, newParentId } = params;
      const result = await enterpriseOrgManager.moveDepartment(deptId, newParentId);

      return result.success !== undefined ? result : { success: true, data: result };
    } catch (error) {
      logger.error('[Enterprise IPC] move-department failed:', error);
      return { success: false, error: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // 4. enterprise:request-member-join
  // -------------------------------------------------------------------------
  safeHandle('enterprise:request-member-join', async (_event, params) => {
    try {
      if (!enterpriseOrgManager) {
        return { success: false, error: 'EnterpriseOrgManager not initialized' };
      }

      const { orgId, memberDid, role, requestedBy } = params;
      const result = await enterpriseOrgManager.requestMemberJoin(
        orgId,
        memberDid,
        role,
        requestedBy
      );

      return { success: true, data: result };
    } catch (error) {
      logger.error('[Enterprise IPC] request-member-join failed:', error);
      return { success: false, error: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // 5. enterprise:get-dashboard-stats
  // -------------------------------------------------------------------------
  safeHandle('enterprise:get-dashboard-stats', async (_event, orgId) => {
    try {
      if (!enterpriseOrgManager) {
        return { success: false, error: 'EnterpriseOrgManager not initialized' };
      }

      const stats = await enterpriseOrgManager.getOrgDashboardStats(orgId);

      return { success: true, data: stats };
    } catch (error) {
      logger.error('[Enterprise IPC] get-dashboard-stats failed:', error);
      return { success: false, error: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // 6. enterprise:bulk-import
  // -------------------------------------------------------------------------
  safeHandle('enterprise:bulk-import', async (_event, params) => {
    try {
      if (!enterpriseOrgManager) {
        return { success: false, error: 'EnterpriseOrgManager not initialized' };
      }

      const { orgId, members } = params;
      const result = await enterpriseOrgManager.bulkMemberImport(orgId, members);

      return { success: true, data: result };
    } catch (error) {
      logger.error('[Enterprise IPC] bulk-import failed:', error);
      return { success: false, error: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // 7. enterprise:get-departments
  // -------------------------------------------------------------------------
  safeHandle('enterprise:get-departments', async (_event, orgId) => {
    try {
      if (!enterpriseOrgManager) {
        return { success: false, error: 'EnterpriseOrgManager not initialized' };
      }

      const departments = await enterpriseOrgManager.getDepartments(orgId);

      return { success: true, data: departments };
    } catch (error) {
      logger.error('[Enterprise IPC] get-departments failed:', error);
      return { success: false, error: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // 8. enterprise:get-department-members
  // -------------------------------------------------------------------------
  safeHandle('enterprise:get-department-members', async (_event, deptId) => {
    try {
      if (!enterpriseOrgManager) {
        return { success: false, error: 'EnterpriseOrgManager not initialized' };
      }

      const members = await enterpriseOrgManager.getDepartmentMembers(deptId);

      return { success: true, data: members };
    } catch (error) {
      logger.error('[Enterprise IPC] get-department-members failed:', error);
      return { success: false, error: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // 9. enterprise:update-department
  // -------------------------------------------------------------------------
  safeHandle('enterprise:update-department', async (_event, params) => {
    try {
      if (!enterpriseOrgManager) {
        return { success: false, error: 'EnterpriseOrgManager not initialized' };
      }

      const { deptId, name, description, leadDid, leadName } = params;
      const result = await enterpriseOrgManager.updateDepartment(deptId, {
        name,
        description,
        leadDid,
        leadName,
      });

      return result.success !== undefined ? result : { success: true, data: result };
    } catch (error) {
      logger.error('[Enterprise IPC] update-department failed:', error);
      return { success: false, error: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // 10. enterprise:delete-department
  // -------------------------------------------------------------------------
  safeHandle('enterprise:delete-department', async (_event, deptId) => {
    try {
      if (!enterpriseOrgManager) {
        return { success: false, error: 'EnterpriseOrgManager not initialized' };
      }

      const result = await enterpriseOrgManager.deleteDepartment(deptId);

      return result.success !== undefined ? result : { success: true, data: result };
    } catch (error) {
      logger.error('[Enterprise IPC] delete-department failed:', error);
      return { success: false, error: error.message };
    }
  });

  logger.info(`[Enterprise IPC] Registered ${registeredCount} enterprise IPC handlers`);
}

module.exports = { registerEnterpriseIPC };
