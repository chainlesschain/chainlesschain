/**
 * SessionManager — tags methods (prototype mixin).
 * Split verbatim from session-manager.js; mixed into SessionManager.prototype.
 * Methods reference `this` (db / sessionCache / llmManager / ...) exactly as before.
 *
 * @module llm/session-manager-tags
 */
const { logger } = require("../utils/logger.js");

module.exports = {
  async addTags(sessionId, tags) {
    try {
      const session = await this.loadSession(sessionId);
      const currentTags = session.metadata.tags || [];

      // 确保 tags 是数组
      const newTags = Array.isArray(tags) ? tags : [tags];

      // 合并去重
      const mergedTags = [...new Set([...currentTags, ...newTags])];
      session.metadata.tags = mergedTags;
      session.metadata.updatedAt = Date.now();

      await this.saveSession(sessionId);

      logger.info(`[SessionManager] 会话 ${sessionId} 添加标签:`, newTags);
      this.emit("tags-updated", { sessionId, tags: mergedTags });

      return session;
    } catch (error) {
      logger.error("[SessionManager] 添加标签失败:", error);
      throw error;
    }
  },

  async removeTags(sessionId, tags) {
    try {
      const session = await this.loadSession(sessionId);
      const currentTags = session.metadata.tags || [];

      const tagsToRemove = Array.isArray(tags) ? tags : [tags];
      session.metadata.tags = currentTags.filter(
        (t) => !tagsToRemove.includes(t),
      );
      session.metadata.updatedAt = Date.now();

      await this.saveSession(sessionId);

      logger.info(`[SessionManager] 会话 ${sessionId} 移除标签:`, tagsToRemove);
      this.emit("tags-updated", { sessionId, tags: session.metadata.tags });

      return session;
    } catch (error) {
      logger.error("[SessionManager] 移除标签失败:", error);
      throw error;
    }
  },

  async getAllTags() {
    try {
      const stmt = this.db.prepare(`
        SELECT metadata FROM llm_sessions
      `);
      const rows = stmt.all();

      const tagCount = new Map();
      for (const row of rows) {
        // per-row 守卫：一条坏 metadata 不应让整个标签聚合抛错（getGlobalStats/
        // getTagDetails 都依赖它）
        let metadata = {};
        try {
          metadata =
            typeof row.metadata === "string"
              ? JSON.parse(row.metadata || "{}")
              : row.metadata || {};
        } catch {
          metadata = {};
        }
        const tags = metadata.tags || [];
        for (const tag of tags) {
          tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
        }
      }

      return Array.from(tagCount.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    } catch (error) {
      logger.error("[SessionManager] 获取标签列表失败:", error);
      throw error;
    }
  },

  async findSessionsByTags(tags, options = {}) {
    const { matchMode = "any", limit = 50 } = options;

    try {
      const sessions = await this.listSessions({ limit: 1000 });

      return sessions
        .filter((session) => {
          const sessionTags = session.metadata?.tags || [];
          if (matchMode === "all") {
            return tags.every((t) => sessionTags.includes(t));
          }
          return tags.some((t) => sessionTags.includes(t));
        })
        .slice(0, limit);
    } catch (error) {
      logger.error("[SessionManager] 按标签查找失败:", error);
      throw error;
    }
  },

  async renameTag(oldTag, newTag) {
    if (!oldTag || !newTag) {
      throw new Error("标签名不能为空");
    }

    if (oldTag === newTag) {
      return { updated: 0 };
    }

    try {
      // 获取所有包含该标签的会话
      const sessions = await this.findSessionsByTags([oldTag], {
        limit: 10000,
      });
      let updated = 0;

      for (const session of sessions) {
        const fullSession = await this.loadSession(session.id);
        const tags = fullSession.metadata?.tags || [];
        const tagIndex = tags.indexOf(oldTag);

        if (tagIndex !== -1) {
          // 替换标签
          tags[tagIndex] = newTag;
          // 去重
          fullSession.metadata.tags = [...new Set(tags)];
          fullSession.metadata.updatedAt = Date.now();

          // 保存
          await this.saveSession(session.id);
          updated++;
        }
      }

      logger.info(
        `[SessionManager] 标签重命名: "${oldTag}" -> "${newTag}"，更新 ${updated} 个会话`,
      );
      this.emit("tag-renamed", { oldTag, newTag, updated });

      return { updated, oldTag, newTag };
    } catch (error) {
      logger.error("[SessionManager] 重命名标签失败:", error);
      throw error;
    }
  },

  async mergeTags(sourceTags, targetTag) {
    if (!sourceTags || sourceTags.length === 0 || !targetTag) {
      throw new Error("源标签和目标标签不能为空");
    }

    // 移除目标标签（如果在源标签中）
    const tagsToMerge = sourceTags.filter((t) => t !== targetTag);

    if (tagsToMerge.length === 0) {
      return { updated: 0, merged: 0 };
    }

    try {
      // 获取所有包含这些标签的会话
      const sessions = await this.findSessionsByTags(tagsToMerge, {
        limit: 10000,
      });
      let updated = 0;

      for (const session of sessions) {
        const fullSession = await this.loadSession(session.id);
        const tags = fullSession.metadata?.tags || [];
        let modified = false;

        // 移除源标签，添加目标标签
        const newTags = tags.filter((t) => !tagsToMerge.includes(t));
        if (!newTags.includes(targetTag)) {
          newTags.push(targetTag);
        }

        // 检查是否有变化
        if (
          newTags.length !== tags.length ||
          !newTags.every((t) => tags.includes(t))
        ) {
          fullSession.metadata.tags = newTags;
          fullSession.metadata.updatedAt = Date.now();
          await this.saveSession(session.id);
          updated++;
          modified = true;
        }
      }

      logger.info(
        `[SessionManager] 标签合并: [${tagsToMerge.join(", ")}] -> "${targetTag}"，更新 ${updated} 个会话`,
      );
      this.emit("tags-merged", {
        sourceTags: tagsToMerge,
        targetTag,
        updated,
      });

      return { updated, merged: tagsToMerge.length, targetTag };
    } catch (error) {
      logger.error("[SessionManager] 合并标签失败:", error);
      throw error;
    }
  },

  async deleteTag(tag) {
    if (!tag) {
      throw new Error("标签名不能为空");
    }

    try {
      // 获取所有包含该标签的会话
      const sessions = await this.findSessionsByTags([tag], { limit: 10000 });
      let updated = 0;

      for (const session of sessions) {
        const fullSession = await this.loadSession(session.id);
        const tags = fullSession.metadata?.tags || [];
        const newTags = tags.filter((t) => t !== tag);

        if (newTags.length !== tags.length) {
          fullSession.metadata.tags = newTags;
          fullSession.metadata.updatedAt = Date.now();
          await this.saveSession(session.id);
          updated++;
        }
      }

      logger.info(
        `[SessionManager] 标签已删除: "${tag}"，影响 ${updated} 个会话`,
      );
      this.emit("tag-deleted", { tag, updated });

      return { deleted: tag, updated };
    } catch (error) {
      logger.error("[SessionManager] 删除标签失败:", error);
      throw error;
    }
  },

  async deleteTags(tags) {
    if (!tags || tags.length === 0) {
      return { deleted: 0, updated: 0 };
    }

    try {
      let totalUpdated = 0;

      for (const tag of tags) {
        const result = await this.deleteTag(tag);
        totalUpdated += result.updated;
      }

      logger.info(
        `[SessionManager] 批量删除标签: ${tags.length} 个标签，影响 ${totalUpdated} 个会话`,
      );

      return { deleted: tags.length, updated: totalUpdated };
    } catch (error) {
      logger.error("[SessionManager] 批量删除标签失败:", error);
      throw error;
    }
  },

  async getTagDetails(tag, options = {}) {
    const { limit = 50 } = options;

    try {
      const sessions = await this.findSessionsByTags([tag], { limit });
      const allTags = await this.getAllTags();
      const tagInfo = allTags.find((t) => t.name === tag);

      return {
        name: tag,
        count: tagInfo?.count || sessions.length,
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
        })),
      };
    } catch (error) {
      logger.error("[SessionManager] 获取标签详情失败:", error);
      throw error;
    }
  },
};
