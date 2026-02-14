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

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * Register all permission system IPC handlers
 */
function registerPermissionIPC(database) {
  logger.info("[IPC] 注册权限系统IPC处理器 (28个handlers)");

  // ========================================
  // Permission Management (8 handlers)
  // ========================================

  ipcMain.handle("perm:grant-permission", async (_event, params) => {
    try {
      const { getPermissionEngine } = require("./permission-engine");
      const engine = getPermissionEngine(database);
      return await engine.grantPermission(params);
    } catch (error) {
      logger.error("[IPC] perm:grant-permission failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:revoke-permission", async (_event, params) => {
    try {
      const { getPermissionEngine } = require("./permission-engine");
      const engine = getPermissionEngine(database);
      return await engine.revokePermission(params.grantId, params.revokedBy);
    } catch (error) {
      logger.error("[IPC] perm:revoke-permission failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:check-permission", async (_event, params) => {
    try {
      const { getPermissionEngine } = require("./permission-engine");
      const engine = getPermissionEngine(database);
      return await engine.checkPermission(params);
    } catch (error) {
      logger.error("[IPC] perm:check-permission failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:get-user-permissions", async (_event, params) => {
    try {
      const { getPermissionEngine } = require("./permission-engine");
      const engine = getPermissionEngine(database);
      return await engine.getUserPermissions(params.userDid, params.orgId);
    } catch (error) {
      logger.error("[IPC] perm:get-user-permissions failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:get-resource-permissions", async (_event, params) => {
    try {
      const { getPermissionEngine } = require("./permission-engine");
      const engine = getPermissionEngine(database);
      return await engine.getResourcePermissions(
        params.orgId,
        params.resourceType,
        params.resourceId,
      );
    } catch (error) {
      logger.error("[IPC] perm:get-resource-permissions failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:bulk-grant", async (_event, params) => {
    try {
      const { getPermissionEngine } = require("./permission-engine");
      const engine = getPermissionEngine(database);
      return await engine.bulkGrant(params.grants, params.grantedBy);
    } catch (error) {
      logger.error("[IPC] perm:bulk-grant failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:inherit-permissions", async (_event, params) => {
    try {
      const { getPermissionEngine } = require("./permission-engine");
      const engine = getPermissionEngine(database);
      return await engine.inheritPermissions(params);
    } catch (error) {
      logger.error("[IPC] perm:inherit-permissions failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:get-effective-permissions", async (_event, params) => {
    try {
      const { getPermissionEngine } = require("./permission-engine");
      const engine = getPermissionEngine(database);
      return await engine.getEffectivePermissions(
        params.userDid,
        params.orgId,
        params.resourceType,
        params.resourceId,
      );
    } catch (error) {
      logger.error("[IPC] perm:get-effective-permissions failed:", error);
      throw error;
    }
  });

  // ========================================
  // Approval Workflows (8 handlers)
  // ========================================

  ipcMain.handle("perm:create-workflow", async (_event, params) => {
    try {
      const {
        getApprovalWorkflowManager,
      } = require("./approval-workflow-manager");
      const manager = getApprovalWorkflowManager(database);
      return await manager.createWorkflow(params);
    } catch (error) {
      logger.error("[IPC] perm:create-workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:update-workflow", async (_event, params) => {
    try {
      const {
        getApprovalWorkflowManager,
      } = require("./approval-workflow-manager");
      const manager = getApprovalWorkflowManager(database);
      return await manager.updateWorkflow(params.workflowId, params.updates);
    } catch (error) {
      logger.error("[IPC] perm:update-workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:delete-workflow", async (_event, params) => {
    try {
      const {
        getApprovalWorkflowManager,
      } = require("./approval-workflow-manager");
      const manager = getApprovalWorkflowManager(database);
      return await manager.deleteWorkflow(params.workflowId);
    } catch (error) {
      logger.error("[IPC] perm:delete-workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:submit-approval", async (_event, params) => {
    try {
      const {
        getApprovalWorkflowManager,
      } = require("./approval-workflow-manager");
      const manager = getApprovalWorkflowManager(database);
      return await manager.submitApproval(params);
    } catch (error) {
      logger.error("[IPC] perm:submit-approval failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:approve-request", async (_event, params) => {
    try {
      const {
        getApprovalWorkflowManager,
      } = require("./approval-workflow-manager");
      const manager = getApprovalWorkflowManager(database);
      return await manager.approveRequest(
        params.requestId,
        params.approverDid,
        params.comment,
      );
    } catch (error) {
      logger.error("[IPC] perm:approve-request failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:reject-request", async (_event, params) => {
    try {
      const {
        getApprovalWorkflowManager,
      } = require("./approval-workflow-manager");
      const manager = getApprovalWorkflowManager(database);
      return await manager.rejectRequest(
        params.requestId,
        params.approverDid,
        params.comment,
      );
    } catch (error) {
      logger.error("[IPC] perm:reject-request failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:get-pending-approvals", async (_event, params) => {
    try {
      const {
        getApprovalWorkflowManager,
      } = require("./approval-workflow-manager");
      const manager = getApprovalWorkflowManager(database);
      return await manager.getPendingApprovals(
        params.approverDid,
        params.orgId,
      );
    } catch (error) {
      logger.error("[IPC] perm:get-pending-approvals failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:get-approval-history", async (_event, params) => {
    try {
      const {
        getApprovalWorkflowManager,
      } = require("./approval-workflow-manager");
      const manager = getApprovalWorkflowManager(database);
      return await manager.getApprovalHistory(
        params.orgId,
        params.options || {},
      );
    } catch (error) {
      logger.error("[IPC] perm:get-approval-history failed:", error);
      throw error;
    }
  });

  // ========================================
  // Delegation (4 handlers)
  // ========================================

  ipcMain.handle("perm:delegate-permissions", async (_event, params) => {
    try {
      const { getDelegationManager } = require("./delegation-manager");
      const manager = getDelegationManager(database);
      return await manager.delegatePermissions(params);
    } catch (error) {
      logger.error("[IPC] perm:delegate-permissions failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:revoke-delegation", async (_event, params) => {
    try {
      const { getDelegationManager } = require("./delegation-manager");
      const manager = getDelegationManager(database);
      return await manager.revokeDelegation(
        params.delegationId,
        params.revokerDid,
      );
    } catch (error) {
      logger.error("[IPC] perm:revoke-delegation failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:get-delegations", async (_event, params) => {
    try {
      const { getDelegationManager } = require("./delegation-manager");
      const manager = getDelegationManager(database);
      return await manager.getDelegations(
        params.userDid,
        params.orgId,
        params.options || {},
      );
    } catch (error) {
      logger.error("[IPC] perm:get-delegations failed:", error);
      throw error;
    }
  });

  ipcMain.handle("perm:accept-delegation", async (_event, params) => {
    try {
      const { getDelegationManager } = require("./delegation-manager");
      const manager = getDelegationManager(database);
      return await manager.acceptDelegation(
        params.delegationId,
        params.delegateDid,
      );
    } catch (error) {
      logger.error("[IPC] perm:accept-delegation failed:", error);
      throw error;
    }
  });

  // ========================================
  // Team Management (8 handlers)
  // ========================================

  ipcMain.handle("team:create-team", async (_event, params) => {
    try {
      const { getTeamManager } = require("./team-manager");
      const manager = getTeamManager(database);
      return await manager.createTeam(params);
    } catch (error) {
      logger.error("[IPC] team:create-team failed:", error);
      throw error;
    }
  });

  ipcMain.handle("team:update-team", async (_event, params) => {
    try {
      const { getTeamManager } = require("./team-manager");
      const manager = getTeamManager(database);
      return await manager.updateTeam(params.teamId, params.updates);
    } catch (error) {
      logger.error("[IPC] team:update-team failed:", error);
      throw error;
    }
  });

  ipcMain.handle("team:delete-team", async (_event, params) => {
    try {
      const { getTeamManager } = require("./team-manager");
      const manager = getTeamManager(database);
      return await manager.deleteTeam(params.teamId);
    } catch (error) {
      logger.error("[IPC] team:delete-team failed:", error);
      throw error;
    }
  });

  ipcMain.handle("team:add-member", async (_event, params) => {
    try {
      const { getTeamManager } = require("./team-manager");
      const manager = getTeamManager(database);
      return await manager.addMember(
        params.teamId,
        params.memberDid,
        params.memberName,
        params.role,
        params.invitedBy,
      );
    } catch (error) {
      logger.error("[IPC] team:add-member failed:", error);
      throw error;
    }
  });

  ipcMain.handle("team:remove-member", async (_event, params) => {
    try {
      const { getTeamManager } = require("./team-manager");
      const manager = getTeamManager(database);
      return await manager.removeMember(params.teamId, params.memberDid);
    } catch (error) {
      logger.error("[IPC] team:remove-member failed:", error);
      throw error;
    }
  });

  ipcMain.handle("team:set-lead", async (_event, params) => {
    try {
      const { getTeamManager } = require("./team-manager");
      const manager = getTeamManager(database);
      return await manager.setLead(
        params.teamId,
        params.leadDid,
        params.leadName,
      );
    } catch (error) {
      logger.error("[IPC] team:set-lead failed:", error);
      throw error;
    }
  });

  ipcMain.handle("team:get-teams", async (_event, params) => {
    try {
      const { getTeamManager } = require("./team-manager");
      const manager = getTeamManager(database);
      return await manager.getTeams(params.orgId, params.options || {});
    } catch (error) {
      logger.error("[IPC] team:get-teams failed:", error);
      throw error;
    }
  });

  ipcMain.handle("team:get-team-members", async (_event, params) => {
    try {
      const { getTeamManager } = require("./team-manager");
      const manager = getTeamManager(database);
      return await manager.getTeamMembers(params.teamId);
    } catch (error) {
      logger.error("[IPC] team:get-team-members failed:", error);
      throw error;
    }
  });

  // ========================================
  // Permission Management - Enterprise (11 handlers)
  // ========================================

  // Helper: log activity to organization_activities
  const logPermissionActivity = (
    db,
    orgId,
    userDID,
    action,
    targetType,
    targetId,
    details,
  ) => {
    try {
      db.prepare(
        `
        INSERT INTO organization_activities
        (org_id, user_did, action, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        orgId,
        userDID,
        action,
        targetType,
        targetId,
        JSON.stringify(details),
        Date.now(),
      );
    } catch (err) {
      logger.warn("[IPC] Failed to log permission activity:", err.message);
    }
  };

  ipcMain.handle("permission:get-audit-log", async (_event, params) => {
    try {
      const db = database.getDatabase();
      const {
        orgId,
        userDID,
        action,
        result: resultFilter,
        startDate,
        endDate,
        limit,
      } = params;

      let query = "SELECT * FROM permission_audit_log WHERE org_id = ?";
      const queryParams = [orgId];

      if (userDID) {
        query += " AND user_did = ?";
        queryParams.push(userDID);
      }
      if (action) {
        query += " AND action = ?";
        queryParams.push(action);
      }
      if (resultFilter) {
        query += " AND result = ?";
        queryParams.push(resultFilter);
      }
      if (startDate) {
        query += " AND created_at >= ?";
        queryParams.push(startDate);
      }
      if (endDate) {
        query += " AND created_at <= ?";
        queryParams.push(endDate);
      }

      query += " ORDER BY created_at DESC";
      if (limit) {
        query += " LIMIT ?";
        queryParams.push(limit);
      }

      const logs = db
        .prepare(query)
        .all(...queryParams)
        .map((log) => ({
          ...log,
          context: log.context ? JSON.parse(log.context) : null,
        }));

      return { success: true, logs };
    } catch (error) {
      logger.error("[IPC] permission:get-audit-log failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("permission:get-overrides", async (_event, params) => {
    try {
      const db = database.getDatabase();
      const { orgId, userDID, resourceType, resourceId } = params;

      let query = "SELECT * FROM permission_overrides WHERE org_id = ?";
      const queryParams = [orgId];

      if (userDID) {
        query += " AND user_did = ?";
        queryParams.push(userDID);
      }
      if (resourceType) {
        query += " AND resource_type = ?";
        queryParams.push(resourceType);
      }
      if (resourceId) {
        query += " AND resource_id = ?";
        queryParams.push(resourceId);
      }

      query += " ORDER BY created_at DESC";

      const overrides = db.prepare(query).all(...queryParams);
      return { success: true, overrides };
    } catch (error) {
      logger.error("[IPC] permission:get-overrides failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("permission:get-templates", async (_event, params) => {
    try {
      const db = database.getDatabase();
      const { orgId, templateType } = params;

      let query =
        "SELECT * FROM permission_templates WHERE org_id = ? OR org_id = '_system'";
      const queryParams = [orgId];

      if (templateType) {
        query += " AND template_type = ?";
        queryParams.push(templateType);
      }
      query += " ORDER BY is_system DESC, template_name ASC";

      const templates = db.prepare(query).all(...queryParams);
      return {
        success: true,
        templates: templates.map((t) => ({
          ...t,
          permissions: JSON.parse(t.permissions),
        })),
      };
    } catch (error) {
      logger.error("[IPC] permission:get-templates failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("permission:get-groups", async (_event, params) => {
    try {
      const db = database.getDatabase();
      const { orgId } = params;

      const groups = db
        .prepare(
          "SELECT * FROM permission_groups WHERE org_id = ? OR org_id = '_system' ORDER BY is_system DESC, display_name ASC",
        )
        .all(orgId);

      return {
        success: true,
        groups: groups.map((g) => ({
          ...g,
          permissions: JSON.parse(g.permissions),
        })),
      };
    } catch (error) {
      logger.error("[IPC] permission:get-groups failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("permission:get-statistics", async (_event, params) => {
    try {
      const db = database.getDatabase();
      const { orgId, startDate, endDate } = params;

      let whereClause = "WHERE org_id = ?";
      const queryParams = [orgId];

      if (startDate) {
        whereClause += " AND created_at >= ?";
        queryParams.push(startDate);
      }
      if (endDate) {
        whereClause += " AND created_at <= ?";
        queryParams.push(endDate);
      }

      const stats = db
        .prepare(
          `SELECT action, result, COUNT(*) as count FROM permission_audit_log ${whereClause} GROUP BY action, result`,
        )
        .all(...queryParams);

      const topUsers = db
        .prepare(
          `SELECT user_did, COUNT(*) as check_count, SUM(CASE WHEN result = 'denied' THEN 1 ELSE 0 END) as denied_count
         FROM permission_audit_log ${whereClause} AND action = 'check' GROUP BY user_did ORDER BY check_count DESC LIMIT 10`,
        )
        .all(...queryParams);

      const topPermissions = db
        .prepare(
          `SELECT permission, COUNT(*) as check_count, SUM(CASE WHEN result = 'denied' THEN 1 ELSE 0 END) as denied_count
         FROM permission_audit_log ${whereClause} AND action = 'check' GROUP BY permission ORDER BY check_count DESC LIMIT 10`,
        )
        .all(...queryParams);

      return {
        success: true,
        statistics: { summary: stats, topUsers, topPermissions },
      };
    } catch (error) {
      logger.error("[IPC] permission:get-statistics failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("permission:create-override", async (_event, params) => {
    try {
      const db = database.getDatabase();
      const {
        orgId,
        targetUserDID,
        resourceType,
        resourceId,
        permission,
        granted,
        reason,
        expiresAt,
        userDID,
      } = params;
      const now = Date.now();

      db.prepare(
        `
        INSERT OR REPLACE INTO permission_overrides
        (org_id, user_did, resource_type, resource_id, permission, granted, reason, granted_by, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        orgId,
        targetUserDID,
        resourceType,
        resourceId,
        permission,
        granted ? 1 : 0,
        reason || null,
        userDID,
        expiresAt || null,
        now,
        now,
      );

      logPermissionActivity(
        db,
        orgId,
        userDID,
        "create_permission_override",
        "permission",
        null,
        { targetUserDID, resourceType, resourceId, permission, granted },
      );
      return { success: true };
    } catch (error) {
      logger.error("[IPC] permission:create-override failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("permission:delete-override", async (_event, params) => {
    try {
      const db = database.getDatabase();
      const { orgId, overrideId, userDID } = params;

      const override = db
        .prepare(
          "SELECT * FROM permission_overrides WHERE id = ? AND org_id = ?",
        )
        .get(overrideId, orgId);
      if (!override) {
        throw new Error("Permission override not found");
      }

      db.prepare(
        "DELETE FROM permission_overrides WHERE id = ? AND org_id = ?",
      ).run(overrideId, orgId);

      logPermissionActivity(
        db,
        orgId,
        userDID,
        "delete_permission_override",
        "permission",
        overrideId,
        {
          targetUserDID: override.user_did,
          resourceType: override.resource_type,
          resourceId: override.resource_id,
          permission: override.permission,
        },
      );
      return { success: true };
    } catch (error) {
      logger.error("[IPC] permission:delete-override failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("permission:create-template", async (_event, params) => {
    try {
      const db = database.getDatabase();
      const {
        orgId,
        templateName,
        templateType,
        permissions,
        description,
        userDID,
      } = params;
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO permission_templates
        (org_id, template_name, template_type, permissions, description, is_system, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      `,
      ).run(
        orgId,
        templateName,
        templateType,
        JSON.stringify(permissions),
        description || null,
        userDID,
        now,
        now,
      );

      logPermissionActivity(
        db,
        orgId,
        userDID,
        "create_permission_template",
        "permission",
        null,
        { templateName, templateType },
      );
      return { success: true };
    } catch (error) {
      logger.error("[IPC] permission:create-template failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("permission:apply-template", async (_event, params) => {
    try {
      const db = database.getDatabase();
      const { orgId, templateId, targetType, targetId, userDID } = params;

      const template = db
        .prepare("SELECT * FROM permission_templates WHERE id = ?")
        .get(templateId);
      if (!template) {
        throw new Error("Permission template not found");
      }

      const permissions = JSON.parse(template.permissions);

      if (targetType === "role") {
        db.prepare(
          "UPDATE organization_roles SET permissions = ?, updated_at = ? WHERE org_id = ? AND role_name = ?",
        ).run(JSON.stringify(permissions), Date.now(), orgId, targetId);
      } else {
        throw new Error(
          `Unsupported target type for template application: ${targetType}`,
        );
      }

      logPermissionActivity(
        db,
        orgId,
        userDID,
        "apply_permission_template",
        "permission",
        null,
        {
          templateId,
          templateName: template.template_name,
          targetType,
          targetId,
        },
      );
      return { success: true };
    } catch (error) {
      logger.error("[IPC] permission:apply-template failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("permission:create-group", async (_event, params) => {
    try {
      const db = database.getDatabase();
      const {
        orgId,
        groupName,
        displayName,
        description,
        permissions,
        userDID,
      } = params;
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO permission_groups
        (org_id, group_name, display_name, description, permissions, is_system, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      `,
      ).run(
        orgId,
        groupName,
        displayName,
        description || null,
        JSON.stringify(permissions),
        userDID,
        now,
        now,
      );

      logPermissionActivity(
        db,
        orgId,
        userDID,
        "create_permission_group",
        "permission",
        null,
        { groupName, displayName },
      );
      return { success: true };
    } catch (error) {
      logger.error("[IPC] permission:create-group failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("permission:assign-group", async (_event, params) => {
    try {
      const db = database.getDatabase();
      const { orgId, roleName, groupId, userDID } = params;

      db.prepare(
        `
        INSERT OR IGNORE INTO role_permission_mappings
        (org_id, role_name, permission_group_id, created_at)
        VALUES (?, ?, ?, ?)
      `,
      ).run(orgId, roleName, groupId, Date.now());

      logPermissionActivity(
        db,
        orgId,
        userDID,
        "assign_permission_group",
        "permission",
        null,
        { roleName, groupId },
      );
      return { success: true };
    } catch (error) {
      logger.error("[IPC] permission:assign-group failed:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[IPC] 权限系统IPC处理器注册完成 (39个handlers)");
}

module.exports = {
  registerPermissionIPC,
};
