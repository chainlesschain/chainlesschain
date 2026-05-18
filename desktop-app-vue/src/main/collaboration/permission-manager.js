/**
 * Permission Manager
 *
 * Manages role-based permissions for organization knowledge folders and items.
 *
 * Permission Levels:
 * - owner: Full control (create, edit, delete, share, manage permissions)
 * - admin: Manage content (create, edit, delete, share)
 * - editor: Edit content (create, edit)
 * - member/viewer: View only
 *
 * Permission Types:
 * - view: Can view content
 * - edit: Can modify content
 * - delete: Can delete content
 * - share: Can share with others
 * - manage: Can manage permissions
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

class PermissionManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;

    // Permission hierarchy (higher level includes lower level permissions)
    this.roleHierarchy = {
      owner: ["view", "edit", "delete", "share", "manage"],
      admin: ["view", "edit", "delete", "share"],
      editor: ["view", "edit"],
      member: ["view"],
      viewer: ["view"],
    };

    // Default folder permissions
    this.defaultFolderPermissions = {
      view: ["member", "editor", "admin", "owner"],
      edit: ["editor", "admin", "owner"],
      delete: ["admin", "owner"],
      share: ["admin", "owner"],
      manage: ["owner"],
    };

    // Default knowledge permissions
    this.defaultKnowledgePermissions = {
      view: ["member", "editor", "admin", "owner"],
      edit: ["editor", "admin", "owner"],
      delete: ["admin", "owner"],
      share: ["admin", "owner"],
      comment: ["member", "editor", "admin", "owner"],
    };
  }

  /**
   * Check if user has permission for an action
   */
  async checkPermission(orgId, userDID, resourceType, resourceId, action) {
    try {
      // Get user's role in organization
      const userRole = await this.getUserRole(orgId, userDID);
      if (!userRole) {
        logger.info(
          `[PermissionManager] User ${userDID} not found in org ${orgId}`,
        );
        return false;
      }

      // Owner has all permissions
      if (userRole === "owner") {
        return true;
      }

      // Get resource permissions
      let permissions;
      if (resourceType === "folder") {
        permissions = await this.getFolderPermissions(resourceId);
      } else if (resourceType === "knowledge") {
        permissions = await this.getKnowledgePermissions(resourceId);
      } else {
        logger.warn(
          `[PermissionManager] Unknown resource type: ${resourceType}`,
        );
        return false;
      }

      // Check if user's role has permission for the action
      const allowedRoles = permissions[action] || [];
      const hasPermission = allowedRoles.includes(userRole);

      logger.info(
        `[PermissionManager] User ${userDID} (${userRole}) ${hasPermission ? "HAS" : "DOES NOT HAVE"} ${action} permission on ${resourceType} ${resourceId}`,
      );

      return hasPermission;
    } catch (error) {
      logger.error("[PermissionManager] Error checking permission:", error);
      return false;
    }
  }

  /**
   * Get user's role in organization
   */
  async getUserRole(orgId, userDID) {
    try {
      const db = this.database.getDatabase();
      const member = db
        .prepare(
          `
        SELECT role FROM organization_members
        WHERE org_id = ? AND member_did = ?
      `,
        )
        .get(orgId, userDID);

      return member?.role || null;
    } catch (error) {
      logger.error("[PermissionManager] Error getting user role:", error);
      return null;
    }
  }

  /**
   * Get folder permissions
   */
  async getFolderPermissions(folderId) {
    try {
      const db = this.database.getDatabase();
      const folder = db
        .prepare(
          `
        SELECT permissions FROM org_knowledge_folders
        WHERE id = ?
      `,
        )
        .get(folderId);

      if (!folder) {
        return this.defaultFolderPermissions;
      }

      return JSON.parse(folder.permissions);
    } catch (error) {
      logger.error(
        "[PermissionManager] Error getting folder permissions:",
        error,
      );
      return this.defaultFolderPermissions;
    }
  }

  /**
   * Get knowledge item permissions
   */
  async getKnowledgePermissions(knowledgeId) {
    try {
      const db = this.database.getDatabase();
      const orgKnowledge = db
        .prepare(
          `
        SELECT permissions FROM org_knowledge_items
        WHERE knowledge_id = ?
      `,
        )
        .get(knowledgeId);

      if (!orgKnowledge) {
        return this.defaultKnowledgePermissions;
      }

      return JSON.parse(orgKnowledge.permissions);
    } catch (error) {
      logger.error(
        "[PermissionManager] Error getting knowledge permissions:",
        error,
      );
      return this.defaultKnowledgePermissions;
    }
  }

  /**
   * Update folder permissions
   */
  async updateFolderPermissions(orgId, folderId, userDID, newPermissions) {
    try {
      // Check if user has manage permission
      const hasPermission = await this.checkPermission(
        orgId,
        userDID,
        "folder",
        folderId,
        "manage",
      );
      if (!hasPermission) {
        throw new Error("No permission to manage folder permissions");
      }

      // Validate permissions structure
      const validatedPermissions = this.validatePermissions(newPermissions);

      // Update in database
      const db = this.database.getDatabase();
      db.prepare(
        `
        UPDATE org_knowledge_folders
        SET permissions = ?, updated_at = ?
        WHERE id = ?
      `,
      ).run(JSON.stringify(validatedPermissions), Date.now(), folderId);

      this.emit("permissions-updated", {
        type: "folder",
        id: folderId,
        permissions: validatedPermissions,
        updatedBy: userDID,
      });

      return validatedPermissions;
    } catch (error) {
      logger.error(
        "[PermissionManager] Error updating folder permissions:",
        error,
      );
      throw error;
    }
  }

  /**
   * Update knowledge item permissions
   */
  async updateKnowledgePermissions(
    orgId,
    knowledgeId,
    userDID,
    newPermissions,
  ) {
    try {
      // Check if user has manage permission (usually owner/admin only)
      const userRole = await this.getUserRole(orgId, userDID);
      if (!["owner", "admin"].includes(userRole)) {
        throw new Error("No permission to manage knowledge permissions");
      }

      // Validate permissions structure
      const validatedPermissions = this.validatePermissions(newPermissions);

      // Update in database
      const db = this.database.getDatabase();
      db.prepare(
        `
        UPDATE org_knowledge_items
        SET permissions = ?, updated_at = ?
        WHERE knowledge_id = ? AND org_id = ?
      `,
      ).run(
        JSON.stringify(validatedPermissions),
        Date.now(),
        knowledgeId,
        orgId,
      );

      this.emit("permissions-updated", {
        type: "knowledge",
        id: knowledgeId,
        permissions: validatedPermissions,
        updatedBy: userDID,
      });

      return validatedPermissions;
    } catch (error) {
      logger.error(
        "[PermissionManager] Error updating knowledge permissions:",
        error,
      );
      throw error;
    }
  }

  /**
   * Validate permissions structure
   */
  validatePermissions(permissions) {
    const validActions = [
      "view",
      "edit",
      "delete",
      "share",
      "manage",
      "comment",
    ];
    const validRoles = ["viewer", "member", "editor", "admin", "owner"];

    const validated = {};

    for (const action of validActions) {
      if (permissions[action]) {
        // Ensure all roles are valid
        validated[action] = permissions[action].filter((role) =>
          validRoles.includes(role),
        );
      }
    }

    return validated;
  }

  /**
   * Get effective permissions for user on a resource
   */
  async getEffectivePermissions(orgId, userDID, resourceType, resourceId) {
    try {
      const userRole = await this.getUserRole(orgId, userDID);
      if (!userRole) {
        return [];
      }

      // Owner has all permissions
      if (userRole === "owner") {
        return this.roleHierarchy.owner;
      }

      // Get resource permissions
      let resourcePermissions;
      if (resourceType === "folder") {
        resourcePermissions = await this.getFolderPermissions(resourceId);
      } else if (resourceType === "knowledge") {
        resourcePermissions = await this.getKnowledgePermissions(resourceId);
      } else {
        return [];
      }

      // Calculate effective permissions
      const effectivePermissions = [];
      for (const [action, allowedRoles] of Object.entries(
        resourcePermissions,
      )) {
        if (allowedRoles.includes(userRole)) {
          effectivePermissions.push(action);
        }
      }

      return effectivePermissions;
    } catch (error) {
      logger.error(
        "[PermissionManager] Error getting effective permissions:",
        error,
      );
      return [];
    }
  }

  /**
   * Check if user can access folder
   */
  async canAccessFolder(orgId, userDID, folderId) {
    return await this.checkPermission(
      orgId,
      userDID,
      "folder",
      folderId,
      "view",
    );
  }

  /**
   * Check if user can access knowledge item
   */
  async canAccessKnowledge(orgId, userDID, knowledgeId) {
    return await this.checkPermission(
      orgId,
      userDID,
      "knowledge",
      knowledgeId,
      "view",
    );
  }

  /**
   * Get all accessible folders for user
   */
  async getAccessibleFolders(orgId, userDID) {
    try {
      const db = this.database.getDatabase();
      const allFolders = db
        .prepare(
          `
        SELECT * FROM org_knowledge_folders
        WHERE org_id = ?
        ORDER BY name ASC
      `,
        )
        .all(orgId);

      const accessibleFolders = [];

      for (const folder of allFolders) {
        const canAccess = await this.canAccessFolder(orgId, userDID, folder.id);
        if (canAccess) {
          accessibleFolders.push({
            ...folder,
            permissions: JSON.parse(folder.permissions),
            effectivePermissions: await this.getEffectivePermissions(
              orgId,
              userDID,
              "folder",
              folder.id,
            ),
          });
        }
      }

      return accessibleFolders;
    } catch (error) {
      logger.error(
        "[PermissionManager] Error getting accessible folders:",
        error,
      );
      return [];
    }
  }

  /**
   * Get all accessible knowledge items for user
   */
  async getAccessibleKnowledge(orgId, userDID, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT k.*, ok.*
        FROM knowledge_items k
        INNER JOIN org_knowledge_items ok ON k.id = ok.knowledge_id
        WHERE ok.org_id = ?
      `;

      const params = [orgId];

      if (options.folderId) {
        query += " AND ok.folder_id = ?";
        params.push(options.folderId);
      }

      query += " ORDER BY k.updated_at DESC";

      if (options.limit) {
        query += " LIMIT ?";
        params.push(options.limit);
      }

      const allKnowledge = db.prepare(query).all(...params);

      const accessibleKnowledge = [];

      for (const knowledge of allKnowledge) {
        const canAccess = await this.canAccessKnowledge(
          orgId,
          userDID,
          knowledge.knowledge_id,
        );
        if (canAccess) {
          accessibleKnowledge.push({
            ...knowledge,
            permissions: JSON.parse(knowledge.permissions),
            effectivePermissions: await this.getEffectivePermissions(
              orgId,
              userDID,
              "knowledge",
              knowledge.knowledge_id,
            ),
          });
        }
      }

      return accessibleKnowledge;
    } catch (error) {
      logger.error(
        "[PermissionManager] Error getting accessible knowledge:",
        error,
      );
      return [];
    }
  }

  /**
   * Create permission preset
   */
  getPermissionPreset(presetName) {
    const presets = {
      "public-read": {
        view: ["viewer", "member", "editor", "admin", "owner"],
        edit: ["admin", "owner"],
        delete: ["owner"],
        share: ["admin", "owner"],
        manage: ["owner"],
      },
      "team-edit": {
        view: ["member", "editor", "admin", "owner"],
        edit: ["editor", "admin", "owner"],
        delete: ["admin", "owner"],
        share: ["admin", "owner"],
        manage: ["owner"],
      },
      "admin-only": {
        view: ["admin", "owner"],
        edit: ["admin", "owner"],
        delete: ["owner"],
        share: ["owner"],
        manage: ["owner"],
      },
      private: {
        view: ["owner"],
        edit: ["owner"],
        delete: ["owner"],
        share: ["owner"],
        manage: ["owner"],
      },
    };

    return presets[presetName] || this.defaultFolderPermissions;
  }

  /**
   * Bulk update permissions for multiple resources
   */
  async bulkUpdatePermissions(orgId, userDID, updates) {
    try {
      const results = [];

      for (const update of updates) {
        const { type, id, permissions } = update;

        try {
          if (type === "folder") {
            await this.updateFolderPermissions(orgId, id, userDID, permissions);
          } else if (type === "knowledge") {
            await this.updateKnowledgePermissions(
              orgId,
              id,
              userDID,
              permissions,
            );
          }

          results.push({ id, type, success: true });
        } catch (error) {
          results.push({ id, type, success: false, error: error.message });
        }
      }

      return results;
    } catch (error) {
      logger.error("[PermissionManager] Error in bulk update:", error);
      throw error;
    }
  }

  /**
   * Inherit permissions from parent folder
   */
  async inheritFolderPermissions(childFolderId, parentFolderId) {
    try {
      const parentPermissions = await this.getFolderPermissions(parentFolderId);

      const db = this.database.getDatabase();
      db.prepare(
        `
        UPDATE org_knowledge_folders
        SET permissions = ?, updated_at = ?
        WHERE id = ?
      `,
      ).run(JSON.stringify(parentPermissions), Date.now(), childFolderId);

      return parentPermissions;
    } catch (error) {
      logger.error(
        "[PermissionManager] Error inheriting folder permissions:",
        error,
      );
      throw error;
    }
  }

  /**
   * Get permission summary for organization
   */
  async getPermissionSummary(orgId) {
    try {
      const db = this.database.getDatabase();

      // Count folders by permission type
      const folders = db
        .prepare(
          `
        SELECT permissions FROM org_knowledge_folders
        WHERE org_id = ?
      `,
        )
        .all(orgId);

      // Count knowledge items by permission type
      const knowledge = db
        .prepare(
          `
        SELECT permissions FROM org_knowledge_items
        WHERE org_id = ?
      `,
        )
        .all(orgId);

      // Count members by role
      const members = db
        .prepare(
          `
        SELECT role, COUNT(*) as count
        FROM organization_members
        WHERE org_id = ?
        GROUP BY role
      `,
        )
        .all(orgId);

      return {
        totalFolders: folders.length,
        totalKnowledge: knowledge.length,
        membersByRole: members.reduce((acc, m) => {
          acc[m.role] = m.count;
          return acc;
        }, {}),
        permissionDistribution: this._analyzePermissionDistribution(
          folders,
          knowledge,
        ),
      };
    } catch (error) {
      logger.error(
        "[PermissionManager] Error getting permission summary:",
        error,
      );
      return null;
    }
  }

  /**
   * Analyze permission distribution
   */
  _analyzePermissionDistribution(folders, knowledge) {
    const distribution = {
      public: 0,
      restricted: 0,
      private: 0,
    };

    const allResources = [
      ...folders.map((f) => JSON.parse(f.permissions)),
      ...knowledge.map((k) => JSON.parse(k.permissions)),
    ];

    for (const permissions of allResources) {
      const viewRoles = permissions.view || [];

      if (viewRoles.includes("viewer") || viewRoles.includes("member")) {
        distribution.public++;
      } else if (viewRoles.includes("editor") || viewRoles.includes("admin")) {
        distribution.restricted++;
      } else {
        distribution.private++;
      }
    }

    return distribution;
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.removeAllListeners();
  }
}

module.exports = PermissionManager;
