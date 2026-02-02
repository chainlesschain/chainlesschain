/**
 * Permission Engine
 *
 * Core permission evaluation engine for enterprise RBAC.
 *
 * Features:
 * - Resource-level permissions
 * - Permission inheritance
 * - Condition-based access
 * - Permission delegation
 * - Team-based permissions
 *
 * @module permission/permission-engine
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

class PermissionEngine extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.permissionCache = new Map();
    this.cacheTimeout = 60000; // 1 minute cache
  }

  // ========================================
  // Permission Grant Operations
  // ========================================

  /**
   * Grant a permission
   */
  async grantPermission(params) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const grantId = uuidv4();

      db.prepare(
        `
        INSERT INTO permission_grants (
          id, org_id, grantee_type, grantee_id, resource_type, resource_id,
          permission, conditions, granted_by, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        grantId,
        params.orgId,
        params.granteeType,
        params.granteeId,
        params.resourceType,
        params.resourceId,
        params.permission,
        params.conditions ? JSON.stringify(params.conditions) : null,
        params.grantedBy,
        params.expiresAt,
        now,
        now,
      );

      // Clear cache for this grantee
      this._invalidateCache(params.granteeId);

      // Log audit
      await this._logPermissionAudit(
        params.orgId,
        params.grantedBy,
        "grant",
        params.permission,
        params,
      );

      logger.info(
        `[Permission] Granted ${params.permission} to ${params.granteeId} on ${params.resourceType}/${params.resourceId}`,
      );

      return { success: true, grantId };
    } catch (error) {
      if (error.message?.includes("UNIQUE constraint")) {
        return { success: false, error: "PERMISSION_EXISTS" };
      }
      logger.error("[Permission] Error granting permission:", error);
      throw error;
    }
  }

  /**
   * Revoke a permission
   */
  async revokePermission(grantId, revokedBy) {
    try {
      const db = this.database.getDatabase();

      const grant = db
        .prepare(`SELECT * FROM permission_grants WHERE id = ?`)
        .get(grantId);
      if (!grant) {
        return { success: false, error: "GRANT_NOT_FOUND" };
      }

      db.prepare(`DELETE FROM permission_grants WHERE id = ?`).run(grantId);

      // Clear cache
      this._invalidateCache(grant.grantee_id);

      // Log audit
      await this._logPermissionAudit(
        grant.org_id,
        revokedBy,
        "revoke",
        grant.permission,
        { grantId, ...grant },
      );

      logger.info(`[Permission] Revoked permission grant ${grantId}`);

      return { success: true };
    } catch (error) {
      logger.error("[Permission] Error revoking permission:", error);
      throw error;
    }
  }

  /**
   * Check if a user has a specific permission
   */
  async checkPermission(params) {
    try {
      const { userDid, orgId, resourceType, resourceId, permission } = params;
      const cacheKey = `${userDid}:${orgId}:${resourceType}:${resourceId || "*"}:${permission}`;

      // Check cache
      const cached = this._getFromCache(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      const db = this.database.getDatabase();
      const now = Date.now();

      // 1. Check direct user permissions
      let hasPermission = await this._checkDirectPermission(
        db,
        "user",
        userDid,
        orgId,
        resourceType,
        resourceId,
        permission,
        now,
      );

      if (!hasPermission) {
        // 2. Check role-based permissions
        const userRoles = await this._getUserRoles(db, userDid, orgId);
        for (const roleId of userRoles) {
          hasPermission = await this._checkDirectPermission(
            db,
            "role",
            roleId,
            orgId,
            resourceType,
            resourceId,
            permission,
            now,
          );
          if (hasPermission) {
            break;
          }
        }
      }

      if (!hasPermission) {
        // 3. Check team-based permissions
        const userTeams = await this._getUserTeams(db, userDid, orgId);
        for (const teamId of userTeams) {
          hasPermission = await this._checkDirectPermission(
            db,
            "team",
            teamId,
            orgId,
            resourceType,
            resourceId,
            permission,
            now,
          );
          if (hasPermission) {
            break;
          }
        }
      }

      if (!hasPermission) {
        // 4. Check inherited permissions
        hasPermission = await this._checkInheritedPermission(
          db,
          userDid,
          orgId,
          resourceType,
          resourceId,
          permission,
          now,
        );
      }

      if (!hasPermission) {
        // 5. Check delegated permissions
        hasPermission = await this._checkDelegatedPermission(
          db,
          userDid,
          orgId,
          resourceType,
          resourceId,
          permission,
          now,
        );
      }

      // Cache result
      this._setCache(cacheKey, hasPermission);

      return { success: true, hasPermission };
    } catch (error) {
      logger.error("[Permission] Error checking permission:", error);
      throw error;
    }
  }

  /**
   * Get all permissions for a user
   */
  async getUserPermissions(userDid, orgId) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Get direct permissions
      const directPerms = db
        .prepare(
          `
        SELECT * FROM permission_grants
        WHERE org_id = ? AND grantee_type = 'user' AND grantee_id = ?
          AND (expires_at IS NULL OR expires_at > ?)
      `,
        )
        .all(orgId, userDid, now);

      // Get role-based permissions
      const userRoles = await this._getUserRoles(db, userDid, orgId);
      const rolePerms = [];
      for (const roleId of userRoles) {
        const perms = db
          .prepare(
            `
          SELECT * FROM permission_grants
          WHERE org_id = ? AND grantee_type = 'role' AND grantee_id = ?
            AND (expires_at IS NULL OR expires_at > ?)
        `,
          )
          .all(orgId, roleId, now);
        rolePerms.push(...perms);
      }

      // Get team-based permissions
      const userTeams = await this._getUserTeams(db, userDid, orgId);
      const teamPerms = [];
      for (const teamId of userTeams) {
        const perms = db
          .prepare(
            `
          SELECT * FROM permission_grants
          WHERE org_id = ? AND grantee_type = 'team' AND grantee_id = ?
            AND (expires_at IS NULL OR expires_at > ?)
        `,
          )
          .all(orgId, teamId, now);
        teamPerms.push(...perms);
      }

      // Get delegated permissions
      const delegatedPerms = db
        .prepare(
          `
        SELECT * FROM permission_delegations
        WHERE org_id = ? AND delegate_did = ? AND status = 'active'
          AND start_date <= ? AND end_date > ?
      `,
        )
        .all(orgId, userDid, now, now);

      return {
        success: true,
        permissions: {
          direct: directPerms.map(this._formatGrant),
          role: rolePerms.map(this._formatGrant),
          team: teamPerms.map(this._formatGrant),
          delegated: delegatedPerms.map((d) => ({
            id: d.id,
            delegatorDid: d.delegator_did,
            permissions: d.permissions ? JSON.parse(d.permissions) : [],
            resourceScope: d.resource_scope
              ? JSON.parse(d.resource_scope)
              : null,
            expiresAt: d.end_date,
          })),
        },
      };
    } catch (error) {
      logger.error("[Permission] Error getting user permissions:", error);
      throw error;
    }
  }

  /**
   * Get permissions for a resource
   */
  async getResourcePermissions(orgId, resourceType, resourceId) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const grants = db
        .prepare(
          `
        SELECT * FROM permission_grants
        WHERE org_id = ? AND resource_type = ?
          AND (resource_id = ? OR resource_id IS NULL)
          AND (expires_at IS NULL OR expires_at > ?)
      `,
        )
        .all(orgId, resourceType, resourceId, now);

      return {
        success: true,
        grants: grants.map(this._formatGrant),
      };
    } catch (error) {
      logger.error("[Permission] Error getting resource permissions:", error);
      throw error;
    }
  }

  /**
   * Bulk grant permissions
   */
  async bulkGrant(grants, grantedBy) {
    try {
      const results = [];
      for (const grant of grants) {
        const result = await this.grantPermission({ ...grant, grantedBy });
        results.push({ ...grant, ...result });
      }
      return { success: true, results };
    } catch (error) {
      logger.error("[Permission] Error in bulk grant:", error);
      throw error;
    }
  }

  /**
   * Get effective permissions (combined from all sources)
   */
  async getEffectivePermissions(userDid, orgId, resourceType, resourceId) {
    const allPerms = await this.getUserPermissions(userDid, orgId);
    const effectivePerms = new Set();

    // Combine all permissions
    for (const perm of allPerms.permissions.direct) {
      if (
        perm.resourceType === resourceType &&
        (!perm.resourceId || perm.resourceId === resourceId)
      ) {
        effectivePerms.add(perm.permission);
      }
    }

    for (const perm of allPerms.permissions.role) {
      if (
        perm.resourceType === resourceType &&
        (!perm.resourceId || perm.resourceId === resourceId)
      ) {
        effectivePerms.add(perm.permission);
      }
    }

    for (const perm of allPerms.permissions.team) {
      if (
        perm.resourceType === resourceType &&
        (!perm.resourceId || perm.resourceId === resourceId)
      ) {
        effectivePerms.add(perm.permission);
      }
    }

    for (const delegation of allPerms.permissions.delegated) {
      for (const perm of delegation.permissions) {
        effectivePerms.add(perm);
      }
    }

    return {
      success: true,
      permissions: Array.from(effectivePerms),
    };
  }

  // ========================================
  // Permission Inheritance
  // ========================================

  /**
   * Set up permission inheritance
   */
  async inheritPermissions(params) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const id = uuidv4();

      db.prepare(
        `
        INSERT INTO permission_inheritance (
          id, org_id, parent_resource_type, parent_resource_id,
          child_resource_type, child_resource_id, inherit_permissions, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        params.orgId,
        params.parentResourceType,
        params.parentResourceId,
        params.childResourceType,
        params.childResourceId,
        params.inheritPermissions
          ? JSON.stringify(params.inheritPermissions)
          : null,
        now,
      );

      logger.info(
        `[Permission] Set up inheritance from ${params.parentResourceType}/${params.parentResourceId} to ${params.childResourceType}/${params.childResourceId}`,
      );

      return { success: true, inheritanceId: id };
    } catch (error) {
      logger.error("[Permission] Error setting up inheritance:", error);
      throw error;
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  async _checkDirectPermission(
    db,
    granteeType,
    granteeId,
    orgId,
    resourceType,
    resourceId,
    permission,
    now,
  ) {
    const grant = db
      .prepare(
        `
      SELECT 1 FROM permission_grants
      WHERE org_id = ? AND grantee_type = ? AND grantee_id = ?
        AND resource_type = ? AND (resource_id = ? OR resource_id IS NULL)
        AND permission = ?
        AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1
    `,
      )
      .get(
        orgId,
        granteeType,
        granteeId,
        resourceType,
        resourceId,
        permission,
        now,
      );

    return !!grant;
  }

  async _checkInheritedPermission(
    db,
    userDid,
    orgId,
    resourceType,
    resourceId,
    permission,
    now,
  ) {
    // Find parent resources
    const inheritance = db
      .prepare(
        `
      SELECT parent_resource_type, parent_resource_id, inherit_permissions
      FROM permission_inheritance
      WHERE org_id = ? AND child_resource_type = ? AND child_resource_id = ?
    `,
      )
      .all(orgId, resourceType, resourceId);

    for (const inherit of inheritance) {
      const inheritPerms = inherit.inherit_permissions
        ? JSON.parse(inherit.inherit_permissions)
        : null;
      if (inheritPerms && !inheritPerms.includes(permission)) {
        continue;
      }

      const result = await this.checkPermission({
        userDid,
        orgId,
        resourceType: inherit.parent_resource_type,
        resourceId: inherit.parent_resource_id,
        permission,
      });

      if (result.hasPermission) {
        return true;
      }
    }

    return false;
  }

  async _checkDelegatedPermission(
    db,
    userDid,
    orgId,
    resourceType,
    resourceId,
    permission,
    now,
  ) {
    const delegations = db
      .prepare(
        `
      SELECT * FROM permission_delegations
      WHERE org_id = ? AND delegate_did = ? AND status = 'active'
        AND start_date <= ? AND end_date > ?
    `,
      )
      .all(orgId, userDid, now, now);

    for (const delegation of delegations) {
      const perms = delegation.permissions
        ? JSON.parse(delegation.permissions)
        : [];
      const scope = delegation.resource_scope
        ? JSON.parse(delegation.resource_scope)
        : null;

      if (perms.includes(permission)) {
        if (!scope) {
          return true;
        }
        if (
          scope.resourceType === resourceType &&
          (!scope.resourceId || scope.resourceId === resourceId)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  async _getUserRoles(db, userDid, orgId) {
    const member = db
      .prepare(
        `
      SELECT role FROM organization_members WHERE org_id = ? AND member_did = ?
    `,
      )
      .get(orgId, userDid);

    const roles = member ? [member.role] : [];

    // Get custom roles
    const customRoles = db
      .prepare(
        `
      SELECT r.id FROM organization_roles r
      INNER JOIN permission_grants pg ON pg.grantee_id = r.id AND pg.grantee_type = 'role'
      WHERE pg.org_id = ? AND EXISTS (
        SELECT 1 FROM permission_grants pg2
        WHERE pg2.org_id = ? AND pg2.grantee_type = 'user' AND pg2.grantee_id = ?
          AND pg2.resource_type = 'role' AND pg2.resource_id = r.id
      )
    `,
      )
      .all(orgId, orgId, userDid);

    return [...roles, ...customRoles.map((r) => r.id)];
  }

  async _getUserTeams(db, userDid, orgId) {
    const teams = db
      .prepare(
        `
      SELECT tm.team_id FROM org_team_members tm
      INNER JOIN org_teams t ON t.id = tm.team_id
      WHERE t.org_id = ? AND tm.member_did = ?
    `,
      )
      .all(orgId, userDid);

    return teams.map((t) => t.team_id);
  }

  async _logPermissionAudit(orgId, userDid, action, permission, context) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO permission_audit_log (
          org_id, user_did, permission, action, result,
          resource_type, resource_id, context, created_at
        ) VALUES (?, ?, ?, ?, 'success', ?, ?, ?, ?)
      `,
      ).run(
        orgId,
        userDid,
        permission,
        action,
        context.resourceType,
        context.resourceId,
        JSON.stringify(context),
        now,
      );
    } catch (error) {
      logger.warn("[Permission] Failed to log audit:", error);
    }
  }

  _formatGrant(grant) {
    return {
      id: grant.id,
      granteeType: grant.grantee_type,
      granteeId: grant.grantee_id,
      resourceType: grant.resource_type,
      resourceId: grant.resource_id,
      permission: grant.permission,
      conditions: grant.conditions ? JSON.parse(grant.conditions) : null,
      expiresAt: grant.expires_at,
      createdAt: grant.created_at,
    };
  }

  _getFromCache(key) {
    const entry = this.permissionCache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheTimeout) {
      return entry.value;
    }
    return undefined;
  }

  _setCache(key, value) {
    this.permissionCache.set(key, { value, timestamp: Date.now() });
  }

  _invalidateCache(granteeId) {
    for (const key of this.permissionCache.keys()) {
      if (key.includes(granteeId)) {
        this.permissionCache.delete(key);
      }
    }
  }
}

let permissionEngine = null;

function getPermissionEngine(database) {
  if (!permissionEngine && database) {
    permissionEngine = new PermissionEngine(database);
  }
  return permissionEngine;
}

module.exports = {
  PermissionEngine,
  getPermissionEngine,
};
