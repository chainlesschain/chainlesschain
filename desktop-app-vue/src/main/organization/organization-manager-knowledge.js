/**
 * OrganizationManager — knowledge methods (prototype mixin).
 * Split verbatim from organization-manager.js; mixed into OrganizationManager.prototype.
 * Methods reference `this` exactly as before.
 *
 * @module organization/organization-manager-knowledge
 */
const { logger } = require("../utils/logger.js");

module.exports = {
  async createKnowledgeEntry(
    orgId,
    knowledgeId,
    content,
    authorDID,
    timestamp,
  ) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO organization_knowledge
      (id, org_id, knowledge_id, title, content, author_did, created_at, updated_at, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced')
    `);

    stmt.run(
      `${orgId}_${knowledgeId}`,
      orgId,
      knowledgeId,
      content?.title || "",
      JSON.stringify(content),
      authorDID,
      timestamp,
      timestamp,
    );
  },

  async updateKnowledgeEntry(
    orgId,
    knowledgeId,
    content,
    authorDID,
    timestamp,
  ) {
    const stmt = this.db.prepare(`
      UPDATE organization_knowledge
      SET title = ?, content = ?, author_did = ?, updated_at = ?, sync_status = 'synced'
      WHERE org_id = ? AND knowledge_id = ?
    `);

    stmt.run(
      content?.title || "",
      JSON.stringify(content),
      authorDID,
      timestamp,
      orgId,
      knowledgeId,
    );
  },

  async deleteKnowledgeEntry(orgId, knowledgeId, authorDID, timestamp) {
    // 软删除：标记为已删除而非物理删除
    const stmt = this.db.prepare(`
      UPDATE organization_knowledge
      SET is_deleted = 1, deleted_by = ?, deleted_at = ?, sync_status = 'synced'
      WHERE org_id = ? AND knowledge_id = ?
    `);

    stmt.run(authorDID, timestamp, orgId, knowledgeId);
  },

  async handleKnowledgeEvent(orgId, type, data) {
    logger.info(`[OrganizationManager] 处理知识库事件: ${type}`, data);

    try {
      switch (type) {
        case "knowledge:create":
        case "knowledge:update":
        case "knowledge:delete":
          // 调用知识库同步方法
          return await this.syncKnowledgeChange(orgId, {
            type: type.split(":")[1], // 'create', 'update', 'delete'
            knowledgeId: data.knowledgeId || data.id,
            content: data.content || data,
            authorDID: data.authorDID || data.author,
            timestamp: data.timestamp || Date.now(),
          });

        case "knowledge:sync":
          // 批量同步
          if (Array.isArray(data.changes)) {
            const results = [];
            for (const change of data.changes) {
              const result = await this.syncKnowledgeChange(orgId, change);
              results.push(result);
            }
            return {
              success: true,
              total: data.changes.length,
              applied: results.filter((r) => r.success).length,
              skipped: results.filter((r) => r.skipped).length,
            };
          }
          return { success: false, error: "无效的同步数据格式" };

        case "knowledge:request":
          // 请求知识库数据（用于新成员加入时的初始同步）
          return await this.getOrgKnowledgeForSync(orgId, data.since || 0);

        default:
          logger.warn("[OrganizationManager] 未知的知识库事件类型:", type);
          return { success: false, error: "未知事件类型" };
      }
    } catch (error) {
      logger.error("[OrganizationManager] 处理知识库事件失败:", error);
      return { success: false, error: error.message };
    }
  },

  async getOrgKnowledgeForSync(orgId, since = 0) {
    try {
      const knowledge = this.db
        .prepare(
          `
        SELECT knowledge_id, title, content, author_did, created_at, updated_at, is_deleted
        FROM organization_knowledge
        WHERE org_id = ? AND updated_at > ? AND sync_status = 'synced'
        ORDER BY updated_at ASC
        LIMIT 1000
      `,
        )
        .all(orgId, since);

      return {
        success: true,
        knowledge: knowledge.map((k) => ({
          knowledgeId: k.knowledge_id,
          title: k.title,
          content: JSON.parse(k.content || "{}"),
          authorDID: k.author_did,
          createdAt: k.created_at,
          updatedAt: k.updated_at,
          isDeleted: k.is_deleted === 1,
        })),
        count: knowledge.length,
        lastTimestamp:
          knowledge.length > 0
            ? knowledge[knowledge.length - 1].updated_at
            : since,
      };
    } catch (error) {
      logger.error("[OrganizationManager] 获取同步知识库数据失败:", error);
      return { success: false, error: error.message };
    }
  },
};
