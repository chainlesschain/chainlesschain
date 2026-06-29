/**
 * OrganizationManager — activity methods (prototype mixin).
 * Split verbatim from organization-manager.js; mixed into OrganizationManager.prototype.
 * Methods reference `this` exactly as before.
 *
 * @module organization/organization-manager-activity
 */
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

module.exports = {
  async logActivity(
    orgId,
    actorDID,
    action,
    resourceType,
    resourceId,
    metadata,
  ) {
    this.db.run(
      `INSERT INTO organization_activities (id, org_id, actor_did, action, resource_type, resource_id, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        orgId,
        actorDID,
        action,
        resourceType,
        resourceId,
        JSON.stringify(metadata),
        Date.now(),
      ],
    );
  },

  async getOrganizationActivities(orgId, limit = 50) {
    return this.db
      .prepare(
        `SELECT * FROM organization_activities WHERE org_id = ? ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(orgId, limit);
  },

  getMemberActivities(orgId, memberDID, limit = 10) {
    try {
      const activities = this.db
        .prepare(
          `
        SELECT * FROM organization_activities
        WHERE org_id = ? AND actor_did = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `,
        )
        .all(orgId, memberDID, limit);

      return activities;
    } catch (error) {
      logger.error("获取成员活动失败:", error);
      return [];
    }
  },
};
