/**
 * 项目分享管理器
 * 负责项目分享功能的创建、查询、更新和删除
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class ShareManager {
  constructor(database) {
    this.database = database;
  }

  /**
   * 创建或更新项目分享
   * @param {string} projectId - 项目ID
   * @param {string} shareMode - 分享模式 ('private' | 'public')
   * @param {Object} options - 可选配置
   * @returns {Object} 分享信息
   */
  async createOrUpdateShare(projectId, shareMode, options = {}) {
    try {
      const {
        expiresInDays = null,  // 过期天数，null表示永不过期
        regenerateToken = false // 是否重新生成token
      } = options;

      // 检查项目是否存在
      const project = this.database.prepare(`
        SELECT id, name FROM projects WHERE id = ?
      `).get(projectId);

      if (!project) {
        throw new Error(`项目不存在: ${projectId}`);
      }

      // 检查是否已有分享记录
      const existingShare = this.database.prepare(`
        SELECT * FROM project_shares WHERE project_id = ?
      `).get(projectId);

      const now = Date.now();
      let shareToken;
      let shareLink;
      let shareId;

      if (existingShare && !regenerateToken) {
        // 使用现有token
        shareToken = existingShare.share_token;
        shareId = existingShare.id;
      } else {
        // 生成新token（使用加密的随机字符串）
        shareToken = this.generateShareToken();
        shareId = existingShare ? existingShare.id : uuidv4();
      }

      // 生成分享链接
      shareLink = this.generateShareLink(shareToken);

      // 计算过期时间
      let expiresAt = null;
      if (expiresInDays && expiresInDays > 0) {
        expiresAt = now + (expiresInDays * 24 * 60 * 60 * 1000);
      }

      if (existingShare) {
        // 更新现有分享
        this.database.prepare(`
          UPDATE project_shares
          SET share_mode = ?,
              share_link = ?,
              share_token = ?,
              updated_at = ?,
              expires_at = ?
          WHERE id = ?
        `).run(shareMode, shareLink, shareToken, now, expiresAt, shareId);

        console.log(`[ShareManager] 更新分享: ${projectId}, 模式: ${shareMode}`);
      } else {
        // 创建新分享
        this.database.prepare(`
          INSERT INTO project_shares (
            id, project_id, share_token, share_mode,
            share_link, access_count, created_at, updated_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          shareId,
          projectId,
          shareToken,
          shareMode,
          shareLink,
          0, // access_count
          now,
          now,
          expiresAt
        );

        console.log(`[ShareManager] 创建分享: ${projectId}, 模式: ${shareMode}`);
      }

      // 获取完整的分享信息
      const shareInfo = this.getShareByProjectId(projectId);

      return {
        success: true,
        share: shareInfo
      };

    } catch (error) {
      console.error('[ShareManager] 创建/更新分享失败:', error);
      throw error;
    }
  }

  /**
   * 生成分享token
   * @returns {string} 随机token
   */
  generateShareToken() {
    // 生成32字节随机数据，转为base64url格式（URL安全）
    return crypto.randomBytes(32)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * 生成分享链接
   * @param {string} token - 分享token
   * @returns {string} 分享链接
   */
  generateShareLink(token) {
    // 开发环境使用localhost，生产环境使用实际域名
    const isDev = process.env.NODE_ENV !== 'production';
    const baseUrl = isDev
      ? 'http://localhost:5173'  // Vite开发服务器端口
      : 'https://chainlesschain.com';

    return `${baseUrl}/share/project/${token}`;
  }

  /**
   * 根据项目ID获取分享信息
   * @param {string} projectId - 项目ID
   * @returns {Object|null} 分享信息
   */
  getShareByProjectId(projectId) {
    try {
      const share = this.database.prepare(`
        SELECT
          s.*,
          p.name as project_name,
          p.description as project_description,
          p.project_type,
          p.cover_image_url
        FROM project_shares s
        JOIN projects p ON s.project_id = p.id
        WHERE s.project_id = ?
      `).get(projectId);

      if (!share) {
        return null;
      }

      // 检查是否过期
      if (share.expires_at && share.expires_at < Date.now()) {
        return {
          ...share,
          is_expired: true
        };
      }

      return {
        ...share,
        is_expired: false
      };

    } catch (error) {
      console.error('[ShareManager] 获取分享信息失败:', error);
      return null;
    }
  }

  /**
   * 根据token获取分享信息
   * @param {string} token - 分享token
   * @returns {Object|null} 分享信息
   */
  getShareByToken(token) {
    try {
      const share = this.database.prepare(`
        SELECT
          s.*,
          p.name as project_name,
          p.description as project_description,
          p.project_type,
          p.cover_image_url,
          p.file_count,
          p.created_at as project_created_at
        FROM project_shares s
        JOIN projects p ON s.project_id = p.id
        WHERE s.share_token = ?
      `).get(token);

      if (!share) {
        return null;
      }

      // 检查是否过期
      const now = Date.now();
      if (share.expires_at && share.expires_at < now) {
        return {
          ...share,
          is_expired: true,
          accessible: false
        };
      }

      // 检查分享模式
      const accessible = share.share_mode === 'public';

      return {
        ...share,
        is_expired: false,
        accessible
      };

    } catch (error) {
      console.error('[ShareManager] 根据token获取分享失败:', error);
      return null;
    }
  }

  /**
   * 增加访问计数
   * @param {string} token - 分享token
   * @returns {boolean} 是否成功
   */
  incrementAccessCount(token) {
    try {
      const result = this.database.prepare(`
        UPDATE project_shares
        SET access_count = access_count + 1
        WHERE share_token = ?
      `).run(token);

      return result.changes > 0;
    } catch (error) {
      console.error('[ShareManager] 增加访问计数失败:', error);
      return false;
    }
  }

  /**
   * 删除项目分享
   * @param {string} projectId - 项目ID
   * @returns {boolean} 是否成功
   */
  deleteShare(projectId) {
    try {
      const result = this.database.prepare(`
        DELETE FROM project_shares WHERE project_id = ?
      `).run(projectId);

      console.log(`[ShareManager] 删除分享: ${projectId}`);
      return result.changes > 0;

    } catch (error) {
      console.error('[ShareManager] 删除分享失败:', error);
      return false;
    }
  }

  /**
   * 获取所有公开分享的项目
   * @param {Object} options - 查询选项
   * @returns {Array} 分享列表
   */
  getPublicShares(options = {}) {
    try {
      const {
        limit = 20,
        offset = 0,
        projectType = null
      } = options;

      let query = `
        SELECT
          s.*,
          p.name as project_name,
          p.description as project_description,
          p.project_type,
          p.cover_image_url,
          p.file_count
        FROM project_shares s
        JOIN projects p ON s.project_id = p.id
        WHERE s.share_mode = 'public'
          AND (s.expires_at IS NULL OR s.expires_at > ?)
      `;

      const params = [Date.now()];

      if (projectType) {
        query += ` AND p.project_type = ?`;
        params.push(projectType);
      }

      query += ` ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const shares = this.database.prepare(query).all(...params);

      return shares;

    } catch (error) {
      console.error('[ShareManager] 获取公开分享失败:', error);
      return [];
    }
  }

  /**
   * 获取分享统计
   * @param {string} projectId - 项目ID
   * @returns {Object} 统计信息
   */
  getShareStats(projectId) {
    try {
      const share = this.getShareByProjectId(projectId);

      if (!share) {
        return {
          hasShare: false,
          accessCount: 0,
          isPublic: false,
          isExpired: false
        };
      }

      return {
        hasShare: true,
        shareMode: share.share_mode,
        accessCount: share.access_count || 0,
        isPublic: share.share_mode === 'public',
        isExpired: share.is_expired,
        createdAt: share.created_at,
        expiresAt: share.expires_at
      };

    } catch (error) {
      console.error('[ShareManager] 获取分享统计失败:', error);
      return {
        hasShare: false,
        accessCount: 0,
        isPublic: false,
        isExpired: false
      };
    }
  }

  /**
   * 清理过期的分享
   * @returns {number} 清理数量
   */
  cleanExpiredShares() {
    try {
      const now = Date.now();
      const result = this.database.prepare(`
        DELETE FROM project_shares
        WHERE expires_at IS NOT NULL AND expires_at < ?
      `).run(now);

      const count = result.changes;
      if (count > 0) {
        console.log(`[ShareManager] 清理了 ${count} 个过期分享`);
      }

      return count;

    } catch (error) {
      console.error('[ShareManager] 清理过期分享失败:', error);
      return 0;
    }
  }
}

// 单例模式
let shareManager = null;

/**
 * 获取分享管理器实例
 * @param {Object} database - 数据库实例
 * @returns {ShareManager}
 */
function getShareManager(database) {
  if (!shareManager && database) {
    shareManager = new ShareManager(database);
  }
  return shareManager;
}

module.exports = {
  ShareManager,
  getShareManager
};
