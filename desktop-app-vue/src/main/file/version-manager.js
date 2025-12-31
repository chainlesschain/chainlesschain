/**
 * 版本控制管理器 - Phase 2
 * 负责文件版本历史、版本比较、版本回滚等功能
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class VersionManager {
  /**
   * @param {Object} db - Better-SQLite3数据库实例
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * 创建新版本
   * @param {Object} versionData - 版本数据
   * @param {string} creatorDID - 创建者DID
   * @returns {Object} 版本信息
   */
  createVersion(versionData, creatorDID) {
    const {
      file_id,
      file_path,
      file_size,
      checksum,
      change_description
    } = versionData;

    // 获取当前最新版本号
    const latestVersion = this.db.prepare(`
      SELECT MAX(version_number) as max_version
      FROM file_versions
      WHERE file_id = ?
    `).get(file_id);

    const newVersionNumber = (latestVersion?.max_version || 0) + 1;

    // 插入版本记录
    const versionId = `ver_${uuidv4().replace(/-/g, '')}`;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO file_versions (
        id, file_id, version_number, file_path, file_size,
        checksum, created_by, created_at, change_description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      file_id,
      newVersionNumber,
      file_path,
      file_size,
      checksum,
      creatorDID,
      now,
      change_description || null
    );

    // 更新主文件表的版本号
    this.db.prepare(`
      UPDATE project_files
      SET version_number = ?, updated_at = ?
      WHERE id = ?
    `).run(newVersionNumber, now, file_id);

    console.log(`[VersionManager] 版本创建成功: v${newVersionNumber}`);

    return this.getVersion(versionId);
  }

  /**
   * 获取版本信息
   * @param {string} versionId - 版本ID
   * @returns {Object} 版本信息
   */
  getVersion(versionId) {
    const version = this.db.prepare(`
      SELECT * FROM file_versions WHERE id = ?
    `).get(versionId);

    if (!version) {
      throw new Error('版本不存在');
    }

    return version;
  }

  /**
   * 获取文件的所有版本
   * @param {string} fileId - 文件ID
   * @returns {Array} 版本列表
   */
  getFileVersions(fileId) {
    return this.db.prepare(`
      SELECT * FROM file_versions
      WHERE file_id = ?
      ORDER BY version_number DESC
    `).all(fileId);
  }

  /**
   * 获取特定版本号的版本
   * @param {string} fileId - 文件ID
   * @param {number} versionNumber - 版本号
   * @returns {Object} 版本信息
   */
  getVersionByNumber(fileId, versionNumber) {
    const version = this.db.prepare(`
      SELECT * FROM file_versions
      WHERE file_id = ? AND version_number = ?
    `).get(fileId, versionNumber);

    if (!version) {
      throw new Error('指定版本不存在');
    }

    return version;
  }

  /**
   * 获取最新版本
   * @param {string} fileId - 文件ID
   * @returns {Object} 版本信息
   */
  getLatestVersion(fileId) {
    const version = this.db.prepare(`
      SELECT * FROM file_versions
      WHERE file_id = ?
      ORDER BY version_number DESC
      LIMIT 1
    `).get(fileId);

    return version || null;
  }

  /**
   * 回滚到指定版本
   * @param {string} fileId - 文件ID
   * @param {number} targetVersion - 目标版本号
   * @param {string} rollerDID - 回滚者DID
   * @returns {Object} 新版本信息
   */
  rollbackToVersion(fileId, targetVersion, rollerDID) {
    // 获取目标版本
    const targetVersionData = this.getVersionByNumber(fileId, targetVersion);

    if (!targetVersionData) {
      throw new Error(`版本 ${targetVersion} 不存在`);
    }

    // 创建新版本（基于目标版本的内容）
    const newVersion = this.createVersion({
      file_id: fileId,
      file_path: targetVersionData.file_path,
      file_size: targetVersionData.file_size,
      checksum: targetVersionData.checksum,
      change_description: `回滚到版本 v${targetVersion}`
    }, rollerDID);

    // 更新主文件表
    this.db.prepare(`
      UPDATE project_files
      SET file_path = ?, file_size = ?, checksum = ?, updated_at = ?
      WHERE id = ?
    `).run(
      targetVersionData.file_path,
      targetVersionData.file_size,
      targetVersionData.checksum,
      Date.now(),
      fileId
    );

    console.log(`[VersionManager] 文件已回滚到版本 v${targetVersion}`);

    return newVersion;
  }

  /**
   * 比较两个版本
   * @param {string} fileId - 文件ID
   * @param {number} version1 - 版本号1
   * @param {number} version2 - 版本号2
   * @returns {Object} 比较结果
   */
  compareVersions(fileId, version1, version2) {
    const v1 = this.getVersionByNumber(fileId, version1);
    const v2 = this.getVersionByNumber(fileId, version2);

    return {
      version1: {
        number: v1.version_number,
        size: v1.file_size,
        checksum: v1.checksum,
        created_at: v1.created_at,
        created_by: v1.created_by,
        description: v1.change_description
      },
      version2: {
        number: v2.version_number,
        size: v2.file_size,
        checksum: v2.checksum,
        created_at: v2.created_at,
        created_by: v2.created_by,
        description: v2.change_description
      },
      differences: {
        size_changed: v1.file_size !== v2.file_size,
        size_diff: v2.file_size - v1.file_size,
        content_changed: v1.checksum !== v2.checksum,
        time_diff: v2.created_at - v1.created_at
      }
    };
  }

  /**
   * 删除旧版本（保留最近N个版本）
   * @param {string} fileId - 文件ID
   * @param {number} keepCount - 保留版本数
   * @returns {number} 删除的版本数
   */
  pruneVersions(fileId, keepCount = 10) {
    const versions = this.getFileVersions(fileId);

    if (versions.length <= keepCount) {
      return 0;
    }

    // 要删除的版本
    const versionsToDelete = versions.slice(keepCount);
    let deletedCount = 0;

    for (const version of versionsToDelete) {
      // 删除磁盘文件（可选）
      try {
        if (fs.existsSync(version.file_path)) {
          // fs.unlinkSync(version.file_path); // 谨慎使用
        }
      } catch (error) {
        console.error('[VersionManager] 删除版本文件失败:', error);
      }

      // 删除数据库记录
      this.db.prepare('DELETE FROM file_versions WHERE id = ?').run(version.id);
      deletedCount++;
    }

    console.log(`[VersionManager] 清理旧版本完成，删除 ${deletedCount} 个版本`);

    return deletedCount;
  }

  /**
   * 获取版本统计信息
   * @param {string} fileId - 文件ID
   * @returns {Object} 统计信息
   */
  getVersionStats(fileId) {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total_versions,
        MIN(version_number) as first_version,
        MAX(version_number) as latest_version,
        SUM(file_size) as total_size,
        MIN(created_at) as first_created_at,
        MAX(created_at) as last_created_at
      FROM file_versions
      WHERE file_id = ?
    `).get(fileId);

    return {
      total_versions: stats.total_versions || 0,
      first_version: stats.first_version || 0,
      latest_version: stats.latest_version || 0,
      total_size: stats.total_size || 0,
      first_created_at: stats.first_created_at,
      last_created_at: stats.last_created_at,
      size_avg: stats.total_versions > 0 ? Math.round(stats.total_size / stats.total_versions) : 0
    };
  }

  /**
   * 获取版本创建者列表
   * @param {string} fileId - 文件ID
   * @returns {Array} 创建者DID列表
   */
  getVersionContributors(fileId) {
    const contributors = this.db.prepare(`
      SELECT DISTINCT created_by, COUNT(*) as version_count
      FROM file_versions
      WHERE file_id = ?
      GROUP BY created_by
      ORDER BY version_count DESC
    `).all(fileId);

    return contributors;
  }

  /**
   * 检查版本是否存在
   * @param {string} fileId - 文件ID
   * @param {number} versionNumber - 版本号
   * @returns {boolean}
   */
  versionExists(fileId, versionNumber) {
    const version = this.db.prepare(`
      SELECT id FROM file_versions
      WHERE file_id = ? AND version_number = ?
    `).get(fileId, versionNumber);

    return !!version;
  }

  /**
   * 获取版本变更摘要
   * @param {string} fileId - 文件ID
   * @param {number} limit - 限制数量
   * @returns {Array} 变更摘要列表
   */
  getVersionHistory(fileId, limit = 20) {
    return this.db.prepare(`
      SELECT
        version_number,
        file_size,
        created_by,
        created_at,
        change_description
      FROM file_versions
      WHERE file_id = ?
      ORDER BY version_number DESC
      LIMIT ?
    `).all(fileId, limit);
  }
}

module.exports = VersionManager;
