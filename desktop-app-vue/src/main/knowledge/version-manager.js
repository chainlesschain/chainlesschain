const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * 知识库版本历史管理器
 * 负责版本创建、查询、对比和恢复
 */
class KnowledgeVersionManager {
  constructor(db) {
    this.db = db;
  }

  /**
   * 创建版本快照
   * @param {string} knowledgeId - 知识库ID
   * @param {string} updatedBy - 更新者DID
   * @param {Object} options - 选项
   * @returns {Object} 结果
   */
  async createVersionSnapshot(knowledgeId, updatedBy, options = {}) {
    try {
      // 获取当前知识信息
      const knowledge = this.db
        .prepare(
          `
        SELECT * FROM knowledge_items WHERE id = ?
      `,
        )
        .get(knowledgeId);

      if (!knowledge) {
        return { success: false, error: "知识不存在" };
      }

      // 获取最新版本号
      const latestVersion = this.db
        .prepare(
          `
        SELECT MAX(version) as max_version
        FROM knowledge_version_history
        WHERE knowledge_id = ?
      `,
        )
        .get(knowledgeId);

      const newVersion = (latestVersion?.max_version || 0) + 1;

      // 创建版本记录
      const versionId = uuidv4();
      const now = Date.now();

      this.db
        .prepare(
          `
        INSERT INTO knowledge_version_history (
          id, knowledge_id, version, title, content, content_snapshot,
          created_by, updated_by, git_commit_hash, cid, parent_version_id,
          change_summary, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          versionId,
          knowledgeId,
          newVersion,
          knowledge.title,
          knowledge.content,
          JSON.stringify({
            title: knowledge.title,
            content: knowledge.content,
            type: knowledge.type,
            tags: this.getKnowledgeTags(knowledgeId),
          }),
          knowledge.created_by,
          updatedBy,
          options.gitCommitHash || knowledge.git_commit_hash,
          options.cid || knowledge.cid,
          options.parentVersionId || null,
          options.changeSummary || null,
          options.metadata ? JSON.stringify(options.metadata) : null,
          now,
        );

      // 更新knowledge_items的版本号
      this.db
        .prepare(
          `
        UPDATE knowledge_items
        SET version = ?, parent_version_id = ?
        WHERE id = ?
      `,
        )
        .run(newVersion, versionId, knowledgeId);

      logger.info(
        `[VersionManager] 创建版本快照成功: ${knowledgeId} v${newVersion}`,
      );

      return {
        success: true,
        versionId,
        version: newVersion,
      };
    } catch (error) {
      logger.error("[VersionManager] 创建版本快照失败:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取版本历史列表
   * @param {string} knowledgeId - 知识库ID
   * @param {number} limit - 限制数量
   * @returns {Array} 版本列表
   */
  getVersionHistory(knowledgeId, limit = 50) {
    try {
      const versions = this.db
        .prepare(
          `
        SELECT
          v.*,
          k.type,
          k.share_scope,
          k.org_id
        FROM knowledge_version_history v
        LEFT JOIN knowledge_items k ON v.knowledge_id = k.id
        WHERE v.knowledge_id = ?
        ORDER BY v.version DESC
        LIMIT ?
      `,
        )
        .all(knowledgeId, limit);

      return versions.map((v) => ({
        ...v,
        content_snapshot: v.content_snapshot
          ? JSON.parse(v.content_snapshot)
          : null,
        metadata: v.metadata ? JSON.parse(v.metadata) : null,
      }));
    } catch (error) {
      logger.error("[VersionManager] 获取版本历史失败:", error);
      return [];
    }
  }

  /**
   * 获取特定版本
   * @param {string} versionId - 版本ID
   * @returns {Object|null} 版本信息
   */
  getVersion(versionId) {
    try {
      const version = this.db
        .prepare(
          `
        SELECT * FROM knowledge_version_history WHERE id = ?
      `,
        )
        .get(versionId);

      if (!version) {
        return null;
      }

      return {
        ...version,
        content_snapshot: version.content_snapshot
          ? JSON.parse(version.content_snapshot)
          : null,
        metadata: version.metadata ? JSON.parse(version.metadata) : null,
      };
    } catch (error) {
      logger.error("[VersionManager] 获取版本失败:", error);
      return null;
    }
  }

  /**
   * 恢复到指定版本
   * @param {string} knowledgeId - 知识库ID
   * @param {string} versionId - 版本ID
   * @param {string} restoredBy - 恢复者DID
   * @returns {Object} 结果
   */
  async restoreVersion(knowledgeId, versionId, restoredBy) {
    try {
      // 获取目标版本
      const targetVersion = this.getVersion(versionId);
      if (!targetVersion) {
        return { success: false, error: "版本不存在" };
      }

      // 验证版本属于该知识
      if (targetVersion.knowledge_id !== knowledgeId) {
        return { success: false, error: "版本不匹配" };
      }

      // 获取当前知识状态
      const currentKnowledge = this.db
        .prepare(
          `
        SELECT * FROM knowledge_items WHERE id = ?
      `,
        )
        .get(knowledgeId);

      if (!currentKnowledge) {
        return { success: false, error: "知识不存在" };
      }

      // 先创建当前状态的版本快照（恢复前备份）
      const snapshotResult = await this.createVersionSnapshot(
        knowledgeId,
        restoredBy,
        {
          changeSummary: `恢复前备份（准备恢复到v${targetVersion.version}）`,
          metadata: { type: "pre_restore_backup" },
        },
      );

      if (!snapshotResult.success) {
        return { success: false, error: "创建备份失败" };
      }

      // 恢复内容
      const snapshot = targetVersion.content_snapshot || {};
      const now = Date.now();

      this.db
        .prepare(
          `
        UPDATE knowledge_items
        SET
          title = ?,
          content = ?,
          updated_by = ?,
          updated_at = ?
        WHERE id = ?
      `,
        )
        .run(
          snapshot.title || targetVersion.title,
          snapshot.content || targetVersion.content,
          restoredBy,
          now,
          knowledgeId,
        );

      // 创建恢复后的新版本快照
      const restoreResult = await this.createVersionSnapshot(
        knowledgeId,
        restoredBy,
        {
          changeSummary: `恢复到v${targetVersion.version}`,
          metadata: {
            type: "restore",
            restored_from_version: targetVersion.version,
            restored_from_version_id: versionId,
          },
        },
      );

      logger.info(
        `[VersionManager] 恢复版本成功: ${knowledgeId} 恢复到 v${targetVersion.version}`,
      );

      return {
        success: true,
        restoredToVersion: targetVersion.version,
        newVersion: restoreResult.version,
      };
    } catch (error) {
      logger.error("[VersionManager] 恢复版本失败:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 对比两个版本
   * @param {string} versionId1 - 版本1 ID
   * @param {string} versionId2 - 版本2 ID
   * @returns {Object} 对比结果
   */
  compareVersions(versionId1, versionId2) {
    try {
      const version1 = this.getVersion(versionId1);
      const version2 = this.getVersion(versionId2);

      if (!version1 || !version2) {
        return { success: false, error: "版本不存在" };
      }

      // 简单的文本差异统计
      const content1 = version1.content || "";
      const content2 = version2.content || "";

      const lines1 = content1.split("\n");
      const lines2 = content2.split("\n");

      const addedLines = Math.max(0, lines2.length - lines1.length);
      const deletedLines = Math.max(0, lines1.length - lines2.length);

      const titleChanged = version1.title !== version2.title;
      const contentChanged = content1 !== content2;

      return {
        success: true,
        version1: {
          id: version1.id,
          version: version1.version,
          title: version1.title,
          created_at: version1.created_at,
        },
        version2: {
          id: version2.id,
          version: version2.version,
          title: version2.title,
          created_at: version2.created_at,
        },
        diff: {
          titleChanged,
          contentChanged,
          addedLines,
          deletedLines,
          totalChanges: Math.abs(lines1.length - lines2.length),
        },
      };
    } catch (error) {
      logger.error("[VersionManager] 对比版本失败:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除旧版本（保留策略）
   * @param {string} knowledgeId - 知识库ID
   * @param {number} keepCount - 保留版本数（默认50）
   * @returns {Object} 结果
   */
  pruneOldVersions(knowledgeId, keepCount = 50) {
    try {
      // 获取版本总数
      const totalVersions = this.db
        .prepare(
          `
        SELECT COUNT(*) as count
        FROM knowledge_version_history
        WHERE knowledge_id = ?
      `,
        )
        .get(knowledgeId);

      if (totalVersions.count <= keepCount) {
        return { success: true, deleted: 0, message: "版本数量未超过限制" };
      }

      // 删除旧版本（保留最新的keepCount个）
      const result = this.db
        .prepare(
          `
        DELETE FROM knowledge_version_history
        WHERE knowledge_id = ?
        AND id NOT IN (
          SELECT id FROM knowledge_version_history
          WHERE knowledge_id = ?
          ORDER BY version DESC
          LIMIT ?
        )
      `,
        )
        .run(knowledgeId, knowledgeId, keepCount);

      logger.info(
        `[VersionManager] 清理旧版本: ${knowledgeId}, 删除 ${result.changes} 个版本`,
      );

      return {
        success: true,
        deleted: result.changes,
        message: `删除了 ${result.changes} 个旧版本`,
      };
    } catch (error) {
      logger.error("[VersionManager] 清理旧版本失败:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取知识的标签
   * @param {string} knowledgeId - 知识库ID
   * @returns {Array} 标签列表
   */
  getKnowledgeTags(knowledgeId) {
    try {
      const tags = this.db
        .prepare(
          `
        SELECT t.id, t.name, t.color
        FROM tags t
        INNER JOIN knowledge_tags kt ON t.id = kt.tag_id
        WHERE kt.knowledge_id = ?
      `,
        )
        .all(knowledgeId);

      return tags;
    } catch (error) {
      logger.error("[VersionManager] 获取标签失败:", error);
      return [];
    }
  }

  /**
   * 获取版本统计信息
   * @param {string} knowledgeId - 知识库ID
   * @returns {Object} 统计信息
   */
  getVersionStats(knowledgeId) {
    try {
      const stats = this.db
        .prepare(
          `
        SELECT
          COUNT(*) as total_versions,
          MIN(created_at) as first_version_at,
          MAX(created_at) as last_version_at,
          COUNT(DISTINCT updated_by) as contributors
        FROM knowledge_version_history
        WHERE knowledge_id = ?
      `,
        )
        .get(knowledgeId);

      return (
        stats || {
          total_versions: 0,
          first_version_at: null,
          last_version_at: null,
          contributors: 0,
        }
      );
    } catch (error) {
      logger.error("[VersionManager] 获取版本统计失败:", error);
      return {
        total_versions: 0,
        first_version_at: null,
        last_version_at: null,
        contributors: 0,
      };
    }
  }
}

module.exports = { KnowledgeVersionManager };
