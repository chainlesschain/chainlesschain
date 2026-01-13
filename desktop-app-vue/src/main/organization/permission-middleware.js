/**
 * Permission Middleware
 *
 * Provides middleware functions for permission checking in IPC handlers and API routes.
 * Implements fine-grained access control for enterprise features.
 *
 * Features:
 * - Role-based access control (RBAC)
 * - Resource-level permissions
 * - Permission inheritance
 * - Audit logging
 * - Rate limiting for sensitive operations
 */

const EventEmitter = require('events');

class PermissionMiddleware extends EventEmitter {
  constructor(database, permissionManager) {
    super();
    this.database = database;
    this.permissionManager = permissionManager;

    // Cache for permission checks (TTL: 5 minutes)
    this.permissionCache = new Map();
    this.cacheTTL = 5 * 60 * 1000;

    // Rate limiting for sensitive operations
    this.rateLimits = new Map();
    this.rateLimitWindow = 60 * 1000; // 1 minute
    this.rateLimitMax = 10; // Max 10 operations per minute
  }

  /**
   * Create middleware for IPC handler
   * @param {string} requiredPermission - Required permission string
   * @param {Object} options - Middleware options
   * @returns {Function} Middleware function
   */
  requirePermission(requiredPermission, options = {}) {
    return async (event, args) => {
      try {
        const { orgId, userDID } = this.extractContext(args);

        // Check if user has permission
        const hasPermission = await this.checkPermission(
          orgId,
          userDID,
          requiredPermission,
          options
        );

        if (!hasPermission) {
          const error = new Error(`Permission denied: ${requiredPermission}`);
          error.code = 'PERMISSION_DENIED';
          error.permission = requiredPermission;

          // Log permission denial
          await this.logPermissionDenial(orgId, userDID, requiredPermission, args);

          throw error;
        }

        // Log successful permission check
        if (options.audit !== false) {
          await this.logPermissionGrant(orgId, userDID, requiredPermission, args);
        }

        return true;

      } catch (error) {
        console.error('[PermissionMiddleware] Permission check failed:', error);
        throw error;
      }
    };
  }

  /**
   * Create middleware for multiple permissions (AND logic)
   * @param {string[]} requiredPermissions - Array of required permissions
   * @param {Object} options - Middleware options
   * @returns {Function} Middleware function
   */
  requireAllPermissions(requiredPermissions, options = {}) {
    return async (event, args) => {
      const { orgId, userDID } = this.extractContext(args);

      for (const permission of requiredPermissions) {
        const hasPermission = await this.checkPermission(
          orgId,
          userDID,
          permission,
          options
        );

        if (!hasPermission) {
          const error = new Error(`Permission denied: ${permission}`);
          error.code = 'PERMISSION_DENIED';
          error.permission = permission;

          await this.logPermissionDenial(orgId, userDID, permission, args);
          throw error;
        }
      }

      return true;
    };
  }

  /**
   * Create middleware for multiple permissions (OR logic)
   * @param {string[]} requiredPermissions - Array of required permissions
   * @param {Object} options - Middleware options
   * @returns {Function} Middleware function
   */
  requireAnyPermission(requiredPermissions, options = {}) {
    return async (event, args) => {
      const { orgId, userDID } = this.extractContext(args);

      for (const permission of requiredPermissions) {
        const hasPermission = await this.checkPermission(
          orgId,
          userDID,
          permission,
          { ...options, skipAudit: true }
        );

        if (hasPermission) {
          if (options.audit !== false) {
            await this.logPermissionGrant(orgId, userDID, permission, args);
          }
          return true;
        }
      }

      const error = new Error(`Permission denied: requires one of [${requiredPermissions.join(', ')}]`);
      error.code = 'PERMISSION_DENIED';
      error.permissions = requiredPermissions;

      await this.logPermissionDenial(orgId, userDID, requiredPermissions.join('|'), args);
      throw error;
    };
  }

  /**
   * Create middleware for role-based access
   * @param {string[]} allowedRoles - Array of allowed roles
   * @param {Object} options - Middleware options
   * @returns {Function} Middleware function
   */
  requireRole(allowedRoles, options = {}) {
    return async (event, args) => {
      const { orgId, userDID } = this.extractContext(args);

      const userRole = await this.permissionManager.getUserRole(orgId, userDID);

      if (!userRole || !allowedRoles.includes(userRole)) {
        const error = new Error(`Role required: one of [${allowedRoles.join(', ')}]`);
        error.code = 'ROLE_REQUIRED';
        error.requiredRoles = allowedRoles;
        error.userRole = userRole;

        await this.logRoleDenial(orgId, userDID, allowedRoles, userRole, args);
        throw error;
      }

      return true;
    };
  }

  /**
   * Create middleware for resource ownership check
   * @param {string} resourceType - Type of resource (folder, knowledge, etc.)
   * @param {Function} resourceIdExtractor - Function to extract resource ID from args
   * @param {Object} options - Middleware options
   * @returns {Function} Middleware function
   */
  requireOwnership(resourceType, resourceIdExtractor, options = {}) {
    return async (event, args) => {
      const { orgId, userDID } = this.extractContext(args);
      const resourceId = resourceIdExtractor(args);

      const isOwner = await this.checkOwnership(orgId, userDID, resourceType, resourceId);

      if (!isOwner) {
        const error = new Error(`Ownership required for ${resourceType}:${resourceId}`);
        error.code = 'OWNERSHIP_REQUIRED';
        error.resourceType = resourceType;
        error.resourceId = resourceId;

        await this.logOwnershipDenial(orgId, userDID, resourceType, resourceId, args);
        throw error;
      }

      return true;
    };
  }

  /**
   * Create middleware with rate limiting
   * @param {string} operation - Operation name
   * @param {Object} limits - Rate limit configuration
   * @returns {Function} Middleware function
   */
  rateLimit(operation, limits = {}) {
    const maxRequests = limits.max || this.rateLimitMax;
    const windowMs = limits.window || this.rateLimitWindow;

    return async (event, args) => {
      const { orgId, userDID } = this.extractContext(args);
      const key = `${orgId}:${userDID}:${operation}`;

      const now = Date.now();
      const userLimits = this.rateLimits.get(key) || { count: 0, resetAt: now + windowMs };

      // Reset if window expired
      if (now > userLimits.resetAt) {
        userLimits.count = 0;
        userLimits.resetAt = now + windowMs;
      }

      // Check limit
      if (userLimits.count >= maxRequests) {
        const error = new Error(`Rate limit exceeded for ${operation}`);
        error.code = 'RATE_LIMIT_EXCEEDED';
        error.operation = operation;
        error.resetAt = userLimits.resetAt;

        await this.logRateLimitExceeded(orgId, userDID, operation, args);
        throw error;
      }

      // Increment counter
      userLimits.count++;
      this.rateLimits.set(key, userLimits);

      return true;
    };
  }

  /**
   * Check permission with caching
   * @param {string} orgId - Organization ID
   * @param {string} userDID - User DID
   * @param {string} permission - Permission string
   * @param {Object} options - Check options
   * @returns {Promise<boolean>}
   */
  async checkPermission(orgId, userDID, permission, options = {}) {
    // Check cache first
    if (!options.skipCache) {
      const cacheKey = `${orgId}:${userDID}:${permission}`;
      const cached = this.permissionCache.get(cacheKey);

      if (cached && Date.now() < cached.expiresAt) {
        return cached.value;
      }
    }

    // Parse permission string (e.g., "knowledge.edit", "member.manage")
    const [resource, action] = permission.split('.');

    let hasPermission = false;

    // Check based on permission type
    if (resource === 'org') {
      // Organization-level permission
      hasPermission = await this.checkOrgPermission(orgId, userDID, action);
    } else if (resource === 'member') {
      // Member management permission
      hasPermission = await this.checkMemberPermission(orgId, userDID, action);
    } else if (resource === 'knowledge') {
      // Knowledge base permission
      hasPermission = await this.checkKnowledgePermission(orgId, userDID, action, options);
    } else if (resource === 'project') {
      // Project permission
      hasPermission = await this.checkProjectPermission(orgId, userDID, action, options);
    } else {
      // Generic permission check
      hasPermission = await this.checkGenericPermission(orgId, userDID, permission);
    }

    // Cache result
    if (!options.skipCache) {
      const cacheKey = `${orgId}:${userDID}:${permission}`;
      this.permissionCache.set(cacheKey, {
        value: hasPermission,
        expiresAt: Date.now() + this.cacheTTL
      });
    }

    return hasPermission;
  }

  /**
   * Check organization-level permission
   */
  async checkOrgPermission(orgId, userDID, action) {
    const userRole = await this.permissionManager.getUserRole(orgId, userDID);

    const rolePermissions = {
      owner: ['view', 'edit', 'delete', 'manage', 'invite', 'settings'],
      admin: ['view', 'edit', 'invite', 'settings'],
      editor: ['view', 'edit'],
      member: ['view'],
      viewer: ['view']
    };

    return rolePermissions[userRole]?.includes(action) || false;
  }

  /**
   * Check member management permission
   */
  async checkMemberPermission(orgId, userDID, action) {
    const userRole = await this.permissionManager.getUserRole(orgId, userDID);

    const rolePermissions = {
      owner: ['view', 'add', 'remove', 'edit', 'manage'],
      admin: ['view', 'add', 'remove', 'edit'],
      editor: ['view'],
      member: ['view'],
      viewer: ['view']
    };

    return rolePermissions[userRole]?.includes(action) || false;
  }

  /**
   * Check knowledge base permission
   */
  async checkKnowledgePermission(orgId, userDID, action, options = {}) {
    // If specific resource ID provided, check resource-level permission
    if (options.resourceId) {
      return await this.permissionManager.checkPermission(
        orgId,
        userDID,
        'knowledge',
        options.resourceId,
        action
      );
    }

    // Otherwise check role-based permission
    const userRole = await this.permissionManager.getUserRole(orgId, userDID);

    const rolePermissions = {
      owner: ['view', 'create', 'edit', 'delete', 'share', 'comment'],
      admin: ['view', 'create', 'edit', 'delete', 'share', 'comment'],
      editor: ['view', 'create', 'edit', 'comment'],
      member: ['view', 'comment'],
      viewer: ['view']
    };

    return rolePermissions[userRole]?.includes(action) || false;
  }

  /**
   * Check project permission
   */
  async checkProjectPermission(orgId, userDID, action, options = {}) {
    const userRole = await this.permissionManager.getUserRole(orgId, userDID);

    const rolePermissions = {
      owner: ['view', 'create', 'edit', 'delete', 'manage'],
      admin: ['view', 'create', 'edit', 'delete'],
      editor: ['view', 'create', 'edit'],
      member: ['view'],
      viewer: ['view']
    };

    return rolePermissions[userRole]?.includes(action) || false;
  }

  /**
   * Check generic permission
   */
  async checkGenericPermission(orgId, userDID, permission) {
    const userRole = await this.permissionManager.getUserRole(orgId, userDID);

    // Owner has all permissions
    if (userRole === 'owner') {
      return true;
    }

    // Check custom role permissions
    const db = this.database.getDatabase();
    const role = db.prepare(`
      SELECT permissions FROM organization_roles
      WHERE org_id = ? AND role_name = ?
    `).get(orgId, userRole);

    if (!role) {
      return false;
    }

    const permissions = JSON.parse(role.permissions);
    return permissions.includes(permission) || permissions.includes('*');
  }

  /**
   * Check resource ownership
   */
  async checkOwnership(orgId, userDID, resourceType, resourceId) {
    const db = this.database.getDatabase();

    let query;
    if (resourceType === 'folder') {
      query = `SELECT created_by FROM org_knowledge_folders WHERE id = ? AND org_id = ?`;
    } else if (resourceType === 'knowledge') {
      query = `SELECT created_by FROM org_knowledge_items WHERE knowledge_id = ? AND org_id = ?`;
    } else {
      return false;
    }

    const resource = db.prepare(query).get(resourceId, orgId);
    return resource?.created_by === userDID;
  }

  /**
   * Extract context from IPC arguments
   */
  extractContext(args) {
    // Support multiple argument formats
    if (args && typeof args === 'object') {
      return {
        orgId: args.orgId || args.org_id,
        userDID: args.userDID || args.user_did || args.did
      };
    }

    return { orgId: null, userDID: null };
  }

  /**
   * Log permission grant
   */
  async logPermissionGrant(orgId, userDID, permission, context) {
    try {
      const db = this.database.getDatabase();
      db.prepare(`
        INSERT INTO permission_audit_log
        (org_id, user_did, permission, action, result, context, created_at)
        VALUES (?, ?, ?, 'check', 'granted', ?, ?)
      `).run(orgId, userDID, permission, JSON.stringify(context), Date.now());

      this.emit('permission:granted', { orgId, userDID, permission, context });
    } catch (error) {
      console.error('[PermissionMiddleware] Failed to log permission grant:', error);
    }
  }

  /**
   * Log permission denial
   */
  async logPermissionDenial(orgId, userDID, permission, context) {
    try {
      const db = this.database.getDatabase();
      db.prepare(`
        INSERT INTO permission_audit_log
        (org_id, user_did, permission, action, result, context, created_at)
        VALUES (?, ?, ?, 'check', 'denied', ?, ?)
      `).run(orgId, userDID, permission, JSON.stringify(context), Date.now());

      this.emit('permission:denied', { orgId, userDID, permission, context });
    } catch (error) {
      console.error('[PermissionMiddleware] Failed to log permission denial:', error);
    }
  }

  /**
   * Log role denial
   */
  async logRoleDenial(orgId, userDID, requiredRoles, userRole, context) {
    try {
      const db = this.database.getDatabase();
      db.prepare(`
        INSERT INTO permission_audit_log
        (org_id, user_did, permission, action, result, context, created_at)
        VALUES (?, ?, ?, 'role_check', 'denied', ?, ?)
      `).run(
        orgId,
        userDID,
        `role:${requiredRoles.join('|')}`,
        JSON.stringify({ ...context, userRole, requiredRoles }),
        Date.now()
      );

      this.emit('role:denied', { orgId, userDID, requiredRoles, userRole, context });
    } catch (error) {
      console.error('[PermissionMiddleware] Failed to log role denial:', error);
    }
  }

  /**
   * Log ownership denial
   */
  async logOwnershipDenial(orgId, userDID, resourceType, resourceId, context) {
    try {
      const db = this.database.getDatabase();
      db.prepare(`
        INSERT INTO permission_audit_log
        (org_id, user_did, permission, action, result, context, created_at)
        VALUES (?, ?, ?, 'ownership_check', 'denied', ?, ?)
      `).run(
        orgId,
        userDID,
        `ownership:${resourceType}`,
        JSON.stringify({ ...context, resourceType, resourceId }),
        Date.now()
      );

      this.emit('ownership:denied', { orgId, userDID, resourceType, resourceId, context });
    } catch (error) {
      console.error('[PermissionMiddleware] Failed to log ownership denial:', error);
    }
  }

  /**
   * Log rate limit exceeded
   */
  async logRateLimitExceeded(orgId, userDID, operation, context) {
    try {
      const db = this.database.getDatabase();
      db.prepare(`
        INSERT INTO permission_audit_log
        (org_id, user_did, permission, action, result, context, created_at)
        VALUES (?, ?, ?, 'rate_limit', 'exceeded', ?, ?)
      `).run(
        orgId,
        userDID,
        `ratelimit:${operation}`,
        JSON.stringify(context),
        Date.now()
      );

      this.emit('ratelimit:exceeded', { orgId, userDID, operation, context });
    } catch (error) {
      console.error('[PermissionMiddleware] Failed to log rate limit:', error);
    }
  }

  /**
   * Clear permission cache
   */
  clearCache(orgId = null, userDID = null) {
    if (orgId && userDID) {
      // Clear specific user's cache
      for (const [key] of this.permissionCache) {
        if (key.startsWith(`${orgId}:${userDID}:`)) {
          this.permissionCache.delete(key);
        }
      }
    } else if (orgId) {
      // Clear organization's cache
      for (const [key] of this.permissionCache) {
        if (key.startsWith(`${orgId}:`)) {
          this.permissionCache.delete(key);
        }
      }
    } else {
      // Clear all cache
      this.permissionCache.clear();
    }
  }

  /**
   * Get audit log
   */
  async getAuditLog(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT * FROM permission_audit_log
        WHERE org_id = ?
      `;
      const params = [orgId];

      if (options.userDID) {
        query += ' AND user_did = ?';
        params.push(options.userDID);
      }

      if (options.action) {
        query += ' AND action = ?';
        params.push(options.action);
      }

      if (options.result) {
        query += ' AND result = ?';
        params.push(options.result);
      }

      if (options.startDate) {
        query += ' AND created_at >= ?';
        params.push(options.startDate);
      }

      if (options.endDate) {
        query += ' AND created_at <= ?';
        params.push(options.endDate);
      }

      query += ' ORDER BY created_at DESC';

      if (options.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }

      const logs = db.prepare(query).all(...params);

      return logs.map(log => ({
        ...log,
        context: JSON.parse(log.context)
      }));

    } catch (error) {
      console.error('[PermissionMiddleware] Failed to get audit log:', error);
      return [];
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.permissionCache.clear();
    this.rateLimits.clear();
    this.removeAllListeners();
  }
}

module.exports = PermissionMiddleware;
