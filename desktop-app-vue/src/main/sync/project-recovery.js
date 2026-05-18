const { logger } = require("../utils/logger.js");

/**
 * 项目恢复工具
 * 用于恢复被同步逻辑错误标记为删除的项目
 */

class ProjectRecovery {
  constructor(database) {
    this.database = database;
  }

  /**
   * 扫描被标记为删除但应该恢复的项目
   * @returns {Array} 可恢复的项目列表
   */
  scanRecoverableProjects() {
    if (!this.database || !this.database.db) {
      logger.error("[ProjectRecovery] 数据库未初始化");
      return [];
    }

    try {
      // 查找所有被标记为删除的项目
      const deletedProjects = this.database.db
        .prepare(
          `
          SELECT
            id, name, description, project_type, status,
            root_path, file_count, deleted, sync_status,
            created_at, updated_at, synced_at
          FROM projects
          WHERE deleted = 1
          ORDER BY updated_at DESC
        `,
        )
        .all();

      logger.info(
        `[ProjectRecovery] 找到 ${deletedProjects.length} 个已删除的项目`,
      );

      // 过滤出可能被错误删除的项目（有文件目录存在的）
      const recoverableProjects = [];
      const fs = require("fs");

      for (const project of deletedProjects) {
        // 检查项目目录是否存在
        if (project.root_path && fs.existsSync(project.root_path)) {
          recoverableProjects.push({
            ...project,
            reason: "项目目录仍然存在",
            canRecover: true,
          });
        } else if (!project.synced_at) {
          // 从未同步过的项目也可能被错误删除
          recoverableProjects.push({
            ...project,
            reason: "从未同步到后端",
            canRecover: true,
          });
        }
      }

      logger.info(
        `[ProjectRecovery] 找到 ${recoverableProjects.length} 个可恢复的项目`,
      );
      return recoverableProjects;
    } catch (error) {
      logger.error("[ProjectRecovery] 扫描失败:", error);
      return [];
    }
  }

  /**
   * 恢复单个项目
   * @param {string} projectId - 项目ID
   * @returns {boolean} 是否成功
   */
  recoverProject(projectId) {
    if (!this.database || !this.database.db) {
      logger.error("[ProjectRecovery] 数据库未初始化");
      return false;
    }

    try {
      const stmt = this.database.db.prepare(`
        UPDATE projects
        SET deleted = 0,
            updated_at = ?,
            sync_status = 'pending'
        WHERE id = ?
      `);

      stmt.run(Date.now(), projectId);
      this.database.saveToFile();

      logger.info(`[ProjectRecovery] 成功恢复项目: ${projectId}`);
      return true;
    } catch (error) {
      logger.error(`[ProjectRecovery] 恢复项目失败: ${projectId}`, error);
      return false;
    }
  }

  /**
   * 批量恢复项目
   * @param {Array<string>} projectIds - 项目ID数组
   * @returns {Object} 恢复结果
   */
  recoverProjects(projectIds) {
    const results = {
      success: [],
      failed: [],
    };

    for (const projectId of projectIds) {
      if (this.recoverProject(projectId)) {
        results.success.push(projectId);
      } else {
        results.failed.push(projectId);
      }
    }

    logger.info(
      `[ProjectRecovery] 批量恢复完成: 成功 ${results.success.length}, 失败 ${results.failed.length}`,
    );
    return results;
  }

  /**
   * 自动恢复所有可恢复的项目
   * @returns {Object} 恢复结果
   */
  autoRecoverAll() {
    const recoverableProjects = this.scanRecoverableProjects();

    if (recoverableProjects.length === 0) {
      logger.info("[ProjectRecovery] 没有需要恢复的项目");
      return { success: [], failed: [] };
    }

    const projectIds = recoverableProjects.map((p) => p.id);
    return this.recoverProjects(projectIds);
  }

  /**
   * 获取恢复统计信息
   * @returns {Object} 统计信息
   */
  getRecoveryStats() {
    if (!this.database || !this.database.db) {
      return { total: 0, recoverable: 0, details: [] };
    }

    const deletedProjects = this.database.db
      .prepare("SELECT COUNT(*) as count FROM projects WHERE deleted = 1")
      .get();

    const recoverableProjects = this.scanRecoverableProjects();

    return {
      total: deletedProjects.count,
      recoverable: recoverableProjects.length,
      details: recoverableProjects.map((p) => ({
        id: p.id,
        name: p.name,
        reason: p.reason,
        createdAt: new Date(p.created_at).toLocaleString("zh-CN"),
      })),
    };
  }
}

module.exports = ProjectRecovery;
