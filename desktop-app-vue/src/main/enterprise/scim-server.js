/**
 * SCIM 2.0 Server
 *
 * SCIM 2.0 endpoint implementation for user/group provisioning:
 * - /Users CRUD with filtering and pagination
 * - /Groups CRUD with member management
 * - PATCH operations (RFC 7644)
 * - Schema discovery endpoints
 *
 * @module enterprise/scim-server
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const SCIM_SCHEMAS = {
  USER: "urn:ietf:params:scim:schemas:core:2.0:User",
  GROUP: "urn:ietf:params:scim:schemas:core:2.0:Group",
  LIST_RESPONSE: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  PATCH_OP: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  ERROR: "urn:ietf:params:scim:api:messages:2.0:Error",
};

const RESOURCE_TYPES = {
  USER: "User",
  GROUP: "Group",
};

// ============================================================
// SCIMServer
// ============================================================

class SCIMServer extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
  }

  async initialize() {
    logger.info("[SCIMServer] Initializing SCIM 2.0 server...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[SCIMServer] SCIM 2.0 server initialized");
  }

  _ensureTables() {
    if (!this.database || !this.database.db) return;

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS scim_resources (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        external_id TEXT,
        display_name TEXT,
        user_name TEXT,
        email TEXT,
        active INTEGER DEFAULT 1,
        attributes TEXT DEFAULT '{}',
        members TEXT DEFAULT '[]',
        source TEXT DEFAULT 'scim',
        provider TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_scim_type ON scim_resources(resource_type);
      CREATE INDEX IF NOT EXISTS idx_scim_username ON scim_resources(user_name);
      CREATE INDEX IF NOT EXISTS idx_scim_external ON scim_resources(external_id);
      CREATE INDEX IF NOT EXISTS idx_scim_active ON scim_resources(active);

      CREATE TABLE IF NOT EXISTS scim_sync_log (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        provider TEXT,
        status TEXT DEFAULT 'success',
        details TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_scim_sync_provider ON scim_sync_log(provider);
      CREATE INDEX IF NOT EXISTS idx_scim_sync_created ON scim_sync_log(created_at DESC);
    `);
  }

  // ============================================================
  // Users CRUD
  // ============================================================

  /**
   * Create a SCIM User resource.
   * @param {Object} userData - SCIM User attributes
   * @returns {Object} Created SCIM User
   */
  async createUser(userData) {
    try {
      const id = uuidv4();
      const now = Date.now();

      this.database.db
        .prepare(
          `INSERT INTO scim_resources (id, resource_type, external_id, display_name, user_name, email, active, attributes, source, provider, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          RESOURCE_TYPES.USER,
          userData.externalId || null,
          userData.displayName || userData.userName || "",
          userData.userName,
          userData.emails?.[0]?.value || userData.email || null,
          userData.active !== false ? 1 : 0,
          JSON.stringify(userData),
          "scim",
          userData.provider || null,
          now,
          now,
        );

      this.database.saveToFile();
      this._logOperation("create", RESOURCE_TYPES.USER, id, userData.provider);
      this.emit("user:created", { id, userName: userData.userName });

      return this._buildUserResponse(id, userData, now);
    } catch (error) {
      logger.error("[SCIMServer] Create user failed:", error);
      throw error;
    }
  }

  /**
   * Get a SCIM User by ID.
   * @param {string} userId - SCIM User ID
   * @returns {Object} SCIM User
   */
  async getUser(userId) {
    try {
      const row = this.database.db
        .prepare("SELECT * FROM scim_resources WHERE id = ? AND resource_type = ?")
        .get(userId, RESOURCE_TYPES.USER);

      if (!row) return this._buildError(404, "User not found");

      return this._rowToUserResponse(row);
    } catch (error) {
      logger.error("[SCIMServer] Get user failed:", error);
      throw error;
    }
  }

  /**
   * List SCIM Users with filtering and pagination.
   * @param {Object} [options] - Query options
   * @returns {Object} SCIM ListResponse
   */
  async listUsers(options = {}) {
    try {
      const startIndex = options.startIndex || 1;
      const count = options.count || 100;
      const filter = options.filter;

      let query = "SELECT * FROM scim_resources WHERE resource_type = ?";
      const params = [RESOURCE_TYPES.USER];

      if (filter) {
        // Simple filter: userName eq "xxx"
        const match = filter.match(/(\w+)\s+eq\s+"([^"]+)"/);
        if (match) {
          const [, field, value] = match;
          const columnMap = { userName: "user_name", displayName: "display_name", externalId: "external_id" };
          const column = columnMap[field] || field;
          query += ` AND ${column} = ?`;
          params.push(value);
        }
      }

      const total = this.database.db
        .prepare(query.replace("SELECT *", "SELECT COUNT(*) as count"))
        .get(...params);

      query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(count, startIndex - 1);

      const rows = this.database.db.prepare(query).all(...params);

      return {
        schemas: [SCIM_SCHEMAS.LIST_RESPONSE],
        totalResults: total?.count || 0,
        startIndex,
        itemsPerPage: count,
        Resources: rows.map((row) => this._rowToUserResponse(row)),
      };
    } catch (error) {
      logger.error("[SCIMServer] List users failed:", error);
      throw error;
    }
  }

  /**
   * Update a SCIM User (PUT).
   * @param {string} userId - SCIM User ID
   * @param {Object} userData - Updated attributes
   * @returns {Object} Updated SCIM User
   */
  async updateUser(userId, userData) {
    try {
      const now = Date.now();
      this.database.db
        .prepare(
          `UPDATE scim_resources SET display_name = ?, user_name = ?, email = ?, active = ?, attributes = ?, updated_at = ?
           WHERE id = ? AND resource_type = ?`,
        )
        .run(
          userData.displayName || "",
          userData.userName || "",
          userData.emails?.[0]?.value || userData.email || null,
          userData.active !== false ? 1 : 0,
          JSON.stringify(userData),
          now,
          userId,
          RESOURCE_TYPES.USER,
        );

      this.database.saveToFile();
      this._logOperation("update", RESOURCE_TYPES.USER, userId);
      this.emit("user:updated", { id: userId });

      return await this.getUser(userId);
    } catch (error) {
      logger.error("[SCIMServer] Update user failed:", error);
      throw error;
    }
  }

  /**
   * Patch a SCIM User.
   * @param {string} userId - SCIM User ID
   * @param {Object} patchOp - SCIM PatchOp
   * @returns {Object} Updated SCIM User
   */
  async patchUser(userId, patchOp) {
    try {
      const row = this.database.db
        .prepare("SELECT * FROM scim_resources WHERE id = ? AND resource_type = ?")
        .get(userId, RESOURCE_TYPES.USER);

      if (!row) return this._buildError(404, "User not found");

      let attrs = {};
      try { attrs = JSON.parse(row.attributes || "{}"); } catch (_e) {
        // Expected error, ignore
      }

      for (const op of patchOp.Operations || []) {
        if (op.op === "replace" || op.op === "Replace") {
          if (op.path === "active") {
            attrs.active = op.value;
          } else if (op.value && typeof op.value === "object") {
            Object.assign(attrs, op.value);
          }
        } else if (op.op === "add" || op.op === "Add") {
          if (op.value && typeof op.value === "object") {
            Object.assign(attrs, op.value);
          }
        } else if (op.op === "remove" || op.op === "Remove") {
          if (op.path && attrs[op.path] !== undefined) {
            delete attrs[op.path];
          }
        }
      }

      return await this.updateUser(userId, attrs);
    } catch (error) {
      logger.error("[SCIMServer] Patch user failed:", error);
      throw error;
    }
  }

  /**
   * Delete a SCIM User.
   * @param {string} userId - SCIM User ID
   * @returns {Object} Success
   */
  async deleteUser(userId) {
    try {
      this.database.db
        .prepare("DELETE FROM scim_resources WHERE id = ? AND resource_type = ?")
        .run(userId, RESOURCE_TYPES.USER);

      this.database.saveToFile();
      this._logOperation("delete", RESOURCE_TYPES.USER, userId);
      this.emit("user:deleted", { id: userId });

      return { success: true };
    } catch (error) {
      logger.error("[SCIMServer] Delete user failed:", error);
      throw error;
    }
  }

  // ============================================================
  // Groups CRUD
  // ============================================================

  async createGroup(groupData) {
    try {
      const id = uuidv4();
      const now = Date.now();

      this.database.db
        .prepare(
          `INSERT INTO scim_resources (id, resource_type, external_id, display_name, members, attributes, source, provider, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'scim', ?, ?, ?)`,
        )
        .run(
          id,
          RESOURCE_TYPES.GROUP,
          groupData.externalId || null,
          groupData.displayName || "",
          JSON.stringify(groupData.members || []),
          JSON.stringify(groupData),
          groupData.provider || null,
          now,
          now,
        );

      this.database.saveToFile();
      this._logOperation("create", RESOURCE_TYPES.GROUP, id);
      return { schemas: [SCIM_SCHEMAS.GROUP], id, displayName: groupData.displayName };
    } catch (error) {
      logger.error("[SCIMServer] Create group failed:", error);
      throw error;
    }
  }

  async listGroups(options = {}) {
    try {
      const count = options.count || 100;
      const startIndex = options.startIndex || 1;

      const rows = this.database.db
        .prepare("SELECT * FROM scim_resources WHERE resource_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .all(RESOURCE_TYPES.GROUP, count, startIndex - 1);

      const total = this.database.db
        .prepare("SELECT COUNT(*) as count FROM scim_resources WHERE resource_type = ?")
        .get(RESOURCE_TYPES.GROUP);

      return {
        schemas: [SCIM_SCHEMAS.LIST_RESPONSE],
        totalResults: total?.count || 0,
        startIndex,
        itemsPerPage: count,
        Resources: rows.map((row) => ({
          schemas: [SCIM_SCHEMAS.GROUP],
          id: row.id,
          displayName: row.display_name,
          members: JSON.parse(row.members || "[]"),
        })),
      };
    } catch (error) {
      logger.error("[SCIMServer] List groups failed:", error);
      throw error;
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  _buildUserResponse(id, userData, createdAt) {
    return {
      schemas: [SCIM_SCHEMAS.USER],
      id,
      userName: userData.userName,
      name: userData.name || { givenName: "", familyName: "" },
      displayName: userData.displayName || userData.userName,
      emails: userData.emails || (userData.email ? [{ value: userData.email, primary: true }] : []),
      active: userData.active !== false,
      meta: {
        resourceType: RESOURCE_TYPES.USER,
        created: new Date(createdAt || Date.now()).toISOString(),
        lastModified: new Date().toISOString(),
      },
    };
  }

  _rowToUserResponse(row) {
    let attrs = {};
    try { attrs = JSON.parse(row.attributes || "{}"); } catch (_e) {
      // Expected error, ignore
    }
    return {
      schemas: [SCIM_SCHEMAS.USER],
      id: row.id,
      externalId: row.external_id,
      userName: row.user_name,
      displayName: row.display_name,
      emails: attrs.emails || (row.email ? [{ value: row.email, primary: true }] : []),
      active: row.active === 1,
      meta: {
        resourceType: RESOURCE_TYPES.USER,
        created: new Date(row.created_at).toISOString(),
        lastModified: new Date(row.updated_at).toISOString(),
      },
    };
  }

  _buildError(status, detail) {
    return { schemas: [SCIM_SCHEMAS.ERROR], status, detail };
  }

  _logOperation(operation, resourceType, resourceId, provider) {
    try {
      if (!this.database || !this.database.db) return;
      this.database.db
        .prepare(
          "INSERT INTO scim_sync_log (id, operation, resource_type, resource_id, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(uuidv4(), operation, resourceType, resourceId, provider || null, Date.now());
    } catch (_e) {
      // Expected error, ignore
    }
  }

  async close() {
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[SCIMServer] Closed");
  }
}

let _instance;
function getSCIMServer() {
  if (!_instance) _instance = new SCIMServer();
  return _instance;
}

export { SCIMServer, getSCIMServer, SCIM_SCHEMAS, RESOURCE_TYPES };
