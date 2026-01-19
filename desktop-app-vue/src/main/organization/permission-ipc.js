/**
 * Permission Management IPC Handlers
 *
 * Provides IPC endpoints for managing permissions in the enterprise version.
 *
 * Endpoints:
 * - permission:check - Check if user has specific permission
 * - permission:get-effective - Get all effective permissions for user
 * - permission:update-resource - Update permissions for a resource
 * - permission:create-override - Create permission override for user
 * - permission:delete-override - Delete permission override
 * - permission:get-audit-log - Get permission audit log
 * - permission:create-template - Create permission template
 * - permission:apply-template - Apply permission template
 * - permission:create-group - Create permission group
 * - permission:assign-group - Assign permission group to role
 */

const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain } = require('electron');

class PermissionIPC {
  constructor(database, permissionManager, permissionMiddleware) {
    this.database = database;
    this.permissionManager = permissionManager;
    this.middleware = permissionMiddleware;

    this.registerHandlers();
  }

  registerHandlers() {
    // Check permission
    ipcMain.handle('permission:check', async (event, args) => {
      try {
        const { orgId, userDID, permission, resourceType, resourceId } = args;

        const hasPermission = await this.middleware.checkPermission(
          orgId,
          userDID,
          permission,
          { resourceType, resourceId }
        );

        return { success: true, hasPermission };

      } catch (error) {
        logger.error('[PermissionIPC] Check permission failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Get effective permissions
    ipcMain.handle('permission:get-effective', async (event, args) => {
      try {
        const { orgId, userDID, resourceType, resourceId } = args;

        const permissions = await this.permissionManager.getEffectivePermissions(
          orgId,
          userDID,
          resourceType,
          resourceId
        );

        return { success: true, permissions };

      } catch (error) {
        logger.error('[PermissionIPC] Get effective permissions failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Update resource permissions
    ipcMain.handle('permission:update-resource', async (event, args) => {
      try {
        // Check if user has manage permission
        await this.middleware.requirePermission('knowledge.manage')(event, args);

        const { orgId, resourceType, resourceId, userDID, permissions } = args;

        let result;
        if (resourceType === 'folder') {
          result = await this.permissionManager.updateFolderPermissions(
            orgId,
            resourceId,
            userDID,
            permissions
          );
        } else if (resourceType === 'knowledge') {
          result = await this.permissionManager.updateKnowledgePermissions(
            orgId,
            resourceId,
            userDID,
            permissions
          );
        } else {
          throw new Error(`Unsupported resource type: ${resourceType}`);
        }

        // Clear cache
        this.middleware.clearCache(orgId);

        return { success: true, permissions: result };

      } catch (error) {
        logger.error('[PermissionIPC] Update resource permissions failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Create permission override
    ipcMain.handle('permission:create-override', async (event, args) => {
      try {
        // Check if user has manage permission
        await this.middleware.requireRole(['owner', 'admin'])(event, args);

        const {
          orgId,
          targetUserDID,
          resourceType,
          resourceId,
          permission,
          granted,
          reason,
          expiresAt,
          userDID
        } = args;

        const db = this.database.getDatabase();
        const now = Date.now();

        db.prepare(`
          INSERT OR REPLACE INTO permission_overrides
          (org_id, user_did, resource_type, resource_id, permission, granted, reason, granted_by, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
          now
        );

        // Clear cache for target user
        this.middleware.clearCache(orgId, targetUserDID);

        // Log activity
        await this.logActivity(orgId, userDID, 'create_permission_override', 'permission', null, {
          targetUserDID,
          resourceType,
          resourceId,
          permission,
          granted
        });

        return { success: true };

      } catch (error) {
        logger.error('[PermissionIPC] Create permission override failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Delete permission override
    ipcMain.handle('permission:delete-override', async (event, args) => {
      try {
        // Check if user has manage permission
        await this.middleware.requireRole(['owner', 'admin'])(event, args);

        const { orgId, overrideId, userDID } = args;

        const db = this.database.getDatabase();

        // Get override details before deleting
        const override = db.prepare(`
          SELECT * FROM permission_overrides WHERE id = ? AND org_id = ?
        `).get(overrideId, orgId);

        if (!override) {
          throw new Error('Permission override not found');
        }

        // Delete override
        db.prepare(`
          DELETE FROM permission_overrides WHERE id = ? AND org_id = ?
        `).run(overrideId, orgId);

        // Clear cache for target user
        this.middleware.clearCache(orgId, override.user_did);

        // Log activity
        await this.logActivity(orgId, userDID, 'delete_permission_override', 'permission', overrideId, {
          targetUserDID: override.user_did,
          resourceType: override.resource_type,
          resourceId: override.resource_id,
          permission: override.permission
        });

        return { success: true };

      } catch (error) {
        logger.error('[PermissionIPC] Delete permission override failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Get permission overrides
    ipcMain.handle('permission:get-overrides', async (event, args) => {
      try {
        const { orgId, userDID, resourceType, resourceId } = args;

        const db = this.database.getDatabase();

        let query = `
          SELECT * FROM permission_overrides
          WHERE org_id = ?
        `;
        const params = [orgId];

        if (userDID) {
          query += ' AND user_did = ?';
          params.push(userDID);
        }

        if (resourceType) {
          query += ' AND resource_type = ?';
          params.push(resourceType);
        }

        if (resourceId) {
          query += ' AND resource_id = ?';
          params.push(resourceId);
        }

        query += ' ORDER BY created_at DESC';

        const overrides = db.prepare(query).all(...params);

        return { success: true, overrides };

      } catch (error) {
        logger.error('[PermissionIPC] Get permission overrides failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Get audit log
    ipcMain.handle('permission:get-audit-log', async (event, args) => {
      try {
        // Check if user has view permission
        await this.middleware.requireRole(['owner', 'admin'])(event, args);

        const { orgId, ...options } = args;

        const logs = await this.middleware.getAuditLog(orgId, options);

        return { success: true, logs };

      } catch (error) {
        logger.error('[PermissionIPC] Get audit log failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Create permission template
    ipcMain.handle('permission:create-template', async (event, args) => {
      try {
        // Check if user has manage permission
        await this.middleware.requireRole(['owner', 'admin'])(event, args);

        const {
          orgId,
          templateName,
          templateType,
          permissions,
          description,
          userDID
        } = args;

        const db = this.database.getDatabase();
        const now = Date.now();

        db.prepare(`
          INSERT INTO permission_templates
          (org_id, template_name, template_type, permissions, description, is_system, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        `).run(
          orgId,
          templateName,
          templateType,
          JSON.stringify(permissions),
          description || null,
          userDID,
          now,
          now
        );

        // Log activity
        await this.logActivity(orgId, userDID, 'create_permission_template', 'permission', null, {
          templateName,
          templateType
        });

        return { success: true };

      } catch (error) {
        logger.error('[PermissionIPC] Create permission template failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Get permission templates
    ipcMain.handle('permission:get-templates', async (event, args) => {
      try {
        const { orgId, templateType } = args;

        const db = this.database.getDatabase();

        let query = `
          SELECT * FROM permission_templates
          WHERE org_id = ? OR org_id = '_system'
        `;
        const params = [orgId];

        if (templateType) {
          query += ' AND template_type = ?';
          params.push(templateType);
        }

        query += ' ORDER BY is_system DESC, template_name ASC';

        const templates = db.prepare(query).all(...params);

        return {
          success: true,
          templates: templates.map(t => ({
            ...t,
            permissions: JSON.parse(t.permissions)
          }))
        };

      } catch (error) {
        logger.error('[PermissionIPC] Get permission templates failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Apply permission template
    ipcMain.handle('permission:apply-template', async (event, args) => {
      try {
        // Check if user has manage permission
        await this.middleware.requireRole(['owner', 'admin'])(event, args);

        const { orgId, templateId, targetType, targetId, userDID } = args;

        const db = this.database.getDatabase();

        // Get template
        const template = db.prepare(`
          SELECT * FROM permission_templates WHERE id = ?
        `).get(templateId);

        if (!template) {
          throw new Error('Permission template not found');
        }

        const permissions = JSON.parse(template.permissions);

        // Apply permissions based on target type
        if (targetType === 'role') {
          // Update role permissions
          db.prepare(`
            UPDATE organization_roles
            SET permissions = ?, updated_at = ?
            WHERE org_id = ? AND role_name = ?
          `).run(JSON.stringify(permissions), Date.now(), orgId, targetId);

        } else if (targetType === 'folder') {
          // Update folder permissions
          await this.permissionManager.updateFolderPermissions(
            orgId,
            targetId,
            userDID,
            this.convertToResourcePermissions(permissions)
          );

        } else if (targetType === 'knowledge') {
          // Update knowledge permissions
          await this.permissionManager.updateKnowledgePermissions(
            orgId,
            targetId,
            userDID,
            this.convertToResourcePermissions(permissions)
          );
        }

        // Clear cache
        this.middleware.clearCache(orgId);

        // Log activity
        await this.logActivity(orgId, userDID, 'apply_permission_template', 'permission', null, {
          templateId,
          templateName: template.template_name,
          targetType,
          targetId
        });

        return { success: true };

      } catch (error) {
        logger.error('[PermissionIPC] Apply permission template failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Create permission group
    ipcMain.handle('permission:create-group', async (event, args) => {
      try {
        // Check if user has manage permission
        await this.middleware.requireRole(['owner', 'admin'])(event, args);

        const {
          orgId,
          groupName,
          displayName,
          description,
          permissions,
          userDID
        } = args;

        const db = this.database.getDatabase();
        const now = Date.now();

        db.prepare(`
          INSERT INTO permission_groups
          (org_id, group_name, display_name, description, permissions, is_system, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        `).run(
          orgId,
          groupName,
          displayName,
          description || null,
          JSON.stringify(permissions),
          userDID,
          now,
          now
        );

        // Log activity
        await this.logActivity(orgId, userDID, 'create_permission_group', 'permission', null, {
          groupName,
          displayName
        });

        return { success: true };

      } catch (error) {
        logger.error('[PermissionIPC] Create permission group failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Get permission groups
    ipcMain.handle('permission:get-groups', async (event, args) => {
      try {
        const { orgId } = args;

        const db = this.database.getDatabase();

        const groups = db.prepare(`
          SELECT * FROM permission_groups
          WHERE org_id = ? OR org_id = '_system'
          ORDER BY is_system DESC, display_name ASC
        `).all(orgId);

        return {
          success: true,
          groups: groups.map(g => ({
            ...g,
            permissions: JSON.parse(g.permissions)
          }))
        };

      } catch (error) {
        logger.error('[PermissionIPC] Get permission groups failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Assign permission group to role
    ipcMain.handle('permission:assign-group', async (event, args) => {
      try {
        // Check if user has manage permission
        await this.middleware.requireRole(['owner', 'admin'])(event, args);

        const { orgId, roleName, groupId, userDID } = args;

        const db = this.database.getDatabase();

        db.prepare(`
          INSERT OR IGNORE INTO role_permission_mappings
          (org_id, role_name, permission_group_id, created_at)
          VALUES (?, ?, ?, ?)
        `).run(orgId, roleName, groupId, Date.now());

        // Clear cache
        this.middleware.clearCache(orgId);

        // Log activity
        await this.logActivity(orgId, userDID, 'assign_permission_group', 'permission', null, {
          roleName,
          groupId
        });

        return { success: true };

      } catch (error) {
        logger.error('[PermissionIPC] Assign permission group failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Get permission statistics
    ipcMain.handle('permission:get-statistics', async (event, args) => {
      try {
        // Check if user has view permission
        await this.middleware.requireRole(['owner', 'admin'])(event, args);

        const { orgId, startDate, endDate } = args;

        const db = this.database.getDatabase();

        // Get audit log statistics
        let query = `
          SELECT
            action,
            result,
            COUNT(*) as count
          FROM permission_audit_log
          WHERE org_id = ?
        `;
        const params = [orgId];

        if (startDate) {
          query += ' AND created_at >= ?';
          params.push(startDate);
        }

        if (endDate) {
          query += ' AND created_at <= ?';
          params.push(endDate);
        }

        query += ' GROUP BY action, result';

        const stats = db.prepare(query).all(...params);

        // Get top users by permission checks
        const topUsers = db.prepare(`
          SELECT
            user_did,
            COUNT(*) as check_count,
            SUM(CASE WHEN result = 'denied' THEN 1 ELSE 0 END) as denied_count
          FROM permission_audit_log
          WHERE org_id = ? AND action = 'check'
          ${startDate ? 'AND created_at >= ?' : ''}
          ${endDate ? 'AND created_at <= ?' : ''}
          GROUP BY user_did
          ORDER BY check_count DESC
          LIMIT 10
        `).all(...params);

        // Get most checked permissions
        const topPermissions = db.prepare(`
          SELECT
            permission,
            COUNT(*) as check_count,
            SUM(CASE WHEN result = 'denied' THEN 1 ELSE 0 END) as denied_count
          FROM permission_audit_log
          WHERE org_id = ? AND action = 'check'
          ${startDate ? 'AND created_at >= ?' : ''}
          ${endDate ? 'AND created_at <= ?' : ''}
          GROUP BY permission
          ORDER BY check_count DESC
          LIMIT 10
        `).all(...params);

        return {
          success: true,
          statistics: {
            summary: stats,
            topUsers,
            topPermissions
          }
        };

      } catch (error) {
        logger.error('[PermissionIPC] Get permission statistics failed:', error);
        return { success: false, error: error.message };
      }
    });

    logger.info('[PermissionIPC] ✓ Permission IPC handlers registered');
  }

  /**
   * Convert permission array to resource permissions object
   */
  convertToResourcePermissions(permissions) {
    const resourcePermissions = {
      view: [],
      edit: [],
      delete: [],
      share: [],
      manage: [],
      comment: []
    };

    // Map permissions to roles
    const roleMapping = {
      'knowledge.view': ['view'],
      'knowledge.edit': ['edit'],
      'knowledge.delete': ['delete'],
      'knowledge.share': ['share'],
      'knowledge.manage': ['manage'],
      'knowledge.comment': ['comment']
    };

    for (const permission of permissions) {
      if (permission === '*') {
        // Grant all permissions to owner
        Object.keys(resourcePermissions).forEach(action => {
          resourcePermissions[action] = ['owner'];
        });
        break;
      }

      const actions = roleMapping[permission];
      if (actions) {
        actions.forEach(action => {
          if (!resourcePermissions[action].includes('owner')) {
            resourcePermissions[action].push('owner');
          }
        });
      }
    }

    return resourcePermissions;
  }

  /**
   * Log activity
   */
  async logActivity(orgId, userDID, action, targetType, targetId, details) {
    try {
      const db = this.database.getDatabase();
      db.prepare(`
        INSERT INTO organization_activities
        (org_id, user_did, action, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        orgId,
        userDID,
        action,
        targetType,
        targetId,
        JSON.stringify(details),
        Date.now()
      );
    } catch (error) {
      logger.error('[PermissionIPC] Failed to log activity:', error);
    }
  }

  /**
   * Clean up
   */
  destroy() {
    // Remove all IPC handlers
    ipcMain.removeHandler('permission:check');
    ipcMain.removeHandler('permission:get-effective');
    ipcMain.removeHandler('permission:update-resource');
    ipcMain.removeHandler('permission:create-override');
    ipcMain.removeHandler('permission:delete-override');
    ipcMain.removeHandler('permission:get-overrides');
    ipcMain.removeHandler('permission:get-audit-log');
    ipcMain.removeHandler('permission:create-template');
    ipcMain.removeHandler('permission:get-templates');
    ipcMain.removeHandler('permission:apply-template');
    ipcMain.removeHandler('permission:create-group');
    ipcMain.removeHandler('permission:get-groups');
    ipcMain.removeHandler('permission:assign-group');
    ipcMain.removeHandler('permission:get-statistics');
  }
}

module.exports = PermissionIPC;
