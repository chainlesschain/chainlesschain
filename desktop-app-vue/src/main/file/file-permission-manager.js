/**
 * 文件权限管理器 - Phase 2
 * 负责文件权限、共享、访问控制等功能
 */

const { v4: uuidv4 } = require('uuid');

class FilePermissionManager {
  /**
   * @param {Object} db - Better-SQLite3数据库实例
   * @param {Object} organizationManager - 组织管理器实例
   */
  constructor(db, organizationManager) {
    this.db = db;
    this.organizationManager = organizationManager;
  }

  /**
   * 授予文件权限
   * @param {Object} permissionData - 权限数据
   * @param {string} granterDID - 授权者DID
   * @returns {Object} 权限信息
   */
  async grantPermission(permissionData, granterDID) {
    const {
      file_id,
      member_did,
      role,
      permission
    } = permissionData;

    // 验证权限值
    const validPermissions = ['view', 'edit', 'manage'];
    if (!validPermissions.includes(permission)) {
      throw new Error('无效的权限类型');
    }

    // 检查授权者是否有manage权限
    const canGrant = await this.checkPermission(file_id, granterDID, 'manage');
    if (!canGrant) {
      throw new Error('无权限授予文件访问权限');
    }

    // 检查是否已存在相同权限
    const existing = this.db.prepare(`
      SELECT id FROM file_permissions
      WHERE file_id = ? AND member_did = ?
    `).get(file_id, member_did);

    const permissionId = existing?.id || `perm_${uuidv4().replace(/-/g, '')}`;
    const now = Date.now();

    if (existing) {
      // 更新现有权限
      this.db.prepare(`
        UPDATE file_permissions
        SET role = ?, permission = ?, granted_by = ?, granted_at = ?
        WHERE id = ?
      `).run(role, permission, granterDID, now, permissionId);

      console.log('[FilePermissionManager] 权限更新成功');
    } else {
      // 插入新权限
      this.db.prepare(`
        INSERT INTO file_permissions (id, file_id, member_did, role, permission, granted_by, granted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(permissionId, file_id, member_did, role, permission, granterDID, now);

      console.log('[FilePermissionManager] 权限授予成功');
    }

    return this.getPermission(permissionId);
  }

  /**
   * 撤销文件权限
   * @param {string} file_id - 文件ID
   * @param {string} member_did - 成员DID
   * @param {string} revokerDID - 撤销者DID
   * @returns {Object} 结果
   */
  async revokePermission(file_id, member_did, revokerDID) {
    // 检查撤销者是否有manage权限
    const canRevoke = await this.checkPermission(file_id, revokerDID, 'manage');
    if (!canRevoke) {
      return { success: false, error: '无权限撤销文件访问权限' };
    }

    this.db.prepare(`
      DELETE FROM file_permissions
      WHERE file_id = ? AND member_did = ?
    `).run(file_id, member_did);

    console.log('[FilePermissionManager] 权限撤销成功');

    return { success: true };
  }

  /**
   * 检查用户对文件的权限
   * @param {string} fileId - 文件ID
   * @param {string} userDID - 用户DID
   * @param {string} requiredPermission - 需要的权限
   * @returns {boolean} 是否有权限
   */
  async checkPermission(fileId, userDID, requiredPermission) {
    // 获取文件信息
    const file = this.db.prepare('SELECT * FROM project_files WHERE id = ?').get(fileId);
    if (!file) {
      return false;
    }

    // 如果是文件所有者（通过项目判断），自动有所有权限
    // TODO: 实现文件所有者逻辑

    // 检查直接权限
    const directPermission = this.db.prepare(`
      SELECT permission FROM file_permissions
      WHERE file_id = ? AND member_did = ?
    `).get(fileId, userDID);

    if (directPermission) {
      return this._hasRequiredPermission(directPermission.permission, requiredPermission);
    }

    // 检查角色权限
    if (file.org_id) {
      const rolePermissions = this.db.prepare(`
        SELECT fp.permission
        FROM file_permissions fp
        JOIN organization_members om ON fp.role = om.role
        WHERE fp.file_id = ? AND om.member_did = ? AND om.org_id = ?
      `).all(fileId, userDID, file.org_id);

      for (const perm of rolePermissions) {
        if (this._hasRequiredPermission(perm.permission, requiredPermission)) {
          return true;
        }
      }

      // 检查组织级别权限
      const hasOrgPermission = await this.organizationManager.checkPermission(
        file.org_id,
        userDID,
        'file.manage'
      );

      if (hasOrgPermission) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取权限信息
   * @param {string} permissionId - 权限ID
   * @returns {Object} 权限信息
   */
  getPermission(permissionId) {
    return this.db.prepare('SELECT * FROM file_permissions WHERE id = ?').get(permissionId);
  }

  /**
   * 获取文件的所有权限
   * @param {string} fileId - 文件ID
   * @returns {Array} 权限列表
   */
  getFilePermissions(fileId) {
    return this.db.prepare(`
      SELECT * FROM file_permissions
      WHERE file_id = ?
      ORDER BY granted_at DESC
    `).all(fileId);
  }

  /**
   * 获取用户的文件权限列表
   * @param {string} userDID - 用户DID
   * @returns {Array} 权限列表
   */
  getUserPermissions(userDID) {
    return this.db.prepare(`
      SELECT fp.*, pf.file_name, pf.file_type
      FROM file_permissions fp
      JOIN project_files pf ON fp.file_id = pf.id
      WHERE fp.member_did = ?
      ORDER BY fp.granted_at DESC
    `).all(userDID);
  }

  /**
   * 共享文件
   * @param {Object} shareData - 共享数据
   * @param {string} sharerDID - 分享者DID
   * @returns {Object} 共享信息
   */
  async shareFile(shareData, sharerDID) {
    const {
      file_id,
      share_type,
      target_id,
      permission,
      expires_in
    } = shareData;

    // 验证共享类型
    const validShareTypes = ['workspace', 'user', 'role', 'public'];
    if (!validShareTypes.includes(share_type)) {
      throw new Error('无效的共享类型');
    }

    // 检查分享者是否有权限
    const canShare = await this.checkPermission(file_id, sharerDID, 'edit');
    if (!canShare) {
      throw new Error('无权限分享此文件');
    }

    const shareId = `share_${uuidv4().replace(/-/g, '')}`;
    const now = Date.now();
    const expiresAt = expires_in ? now + expires_in : null;

    this.db.prepare(`
      INSERT INTO file_shares (id, file_id, share_type, target_id, permission, expires_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id, share_type, target_id) DO UPDATE SET
        permission = excluded.permission,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `).run(shareId, file_id, share_type, target_id, permission, expiresAt, sharerDID, now);

    console.log('[FilePermissionManager] 文件分享成功');

    return this.getShare(shareId);
  }

  /**
   * 取消文件共享
   * @param {string} shareId - 共享ID
   * @param {string} revokerDID - 撤销者DID
   * @returns {Object} 结果
   */
  async unshareFile(shareId, revokerDID) {
    const share = this.getShare(shareId);
    if (!share) {
      return { success: false, error: '共享不存在' };
    }

    // 检查撤销者是否有权限
    const canUnshare = await this.checkPermission(share.file_id, revokerDID, 'manage');
    if (!canUnshare && share.created_by !== revokerDID) {
      return { success: false, error: '无权限取消此共享' };
    }

    this.db.prepare('DELETE FROM file_shares WHERE id = ?').run(shareId);

    console.log('[FilePermissionManager] 文件共享已取消');

    return { success: true };
  }

  /**
   * 获取共享信息
   * @param {string} shareId - 共享ID
   * @returns {Object} 共享信息
   */
  getShare(shareId) {
    return this.db.prepare('SELECT * FROM file_shares WHERE id = ?').get(shareId);
  }

  /**
   * 获取文件的所有共享
   * @param {string} fileId - 文件ID
   * @returns {Array} 共享列表
   */
  getFileShares(fileId) {
    const now = Date.now();

    return this.db.prepare(`
      SELECT * FROM file_shares
      WHERE file_id = ? AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
    `).all(fileId, now);
  }

  /**
   * 获取用户可访问的共享文件
   * @param {string} userDID - 用户DID
   * @param {string} orgId - 组织ID（可选）
   * @returns {Array} 文件列表
   */
  async getSharedFilesForUser(userDID, orgId = null) {
    const now = Date.now();
    const files = [];

    // 1. 直接分享给用户的文件
    const directShares = this.db.prepare(`
      SELECT pf.*, fs.permission as share_permission
      FROM file_shares fs
      JOIN project_files pf ON fs.file_id = pf.id
      WHERE fs.share_type = 'user' AND fs.target_id = ?
        AND (fs.expires_at IS NULL OR fs.expires_at > ?)
    `).all(userDID, now);

    files.push(...directShares);

    // 2. 公开分享的文件
    const publicShares = this.db.prepare(`
      SELECT pf.*, fs.permission as share_permission
      FROM file_shares fs
      JOIN project_files pf ON fs.file_id = pf.id
      WHERE fs.share_type = 'public'
        AND (fs.expires_at IS NULL OR fs.expires_at > ?)
        ${orgId ? 'AND pf.org_id = ?' : ''}
    `).all(...(orgId ? [now, orgId] : [now]));

    files.push(...publicShares);

    // 3. 基于角色的共享
    if (orgId) {
      const member = this.db.prepare(`
        SELECT role FROM organization_members
        WHERE org_id = ? AND member_did = ?
      `).get(orgId, userDID);

      if (member) {
        const roleShares = this.db.prepare(`
          SELECT pf.*, fs.permission as share_permission
          FROM file_shares fs
          JOIN project_files pf ON fs.file_id = pf.id
          WHERE fs.share_type = 'role' AND fs.target_id = ?
            AND (fs.expires_at IS NULL OR fs.expires_at > ?)
            AND pf.org_id = ?
        `).all(member.role, now, orgId);

        files.push(...roleShares);
      }
    }

    return files;
  }

  /**
   * 清理过期的共享
   * @returns {number} 清理数量
   */
  cleanupExpiredShares() {
    const now = Date.now();

    const result = this.db.prepare(`
      DELETE FROM file_shares
      WHERE expires_at IS NOT NULL AND expires_at < ?
    `).run(now);

    console.log(`[FilePermissionManager] 清理过期共享: ${result.changes} 条`);

    return result.changes;
  }

  /**
   * 判断权限等级
   * @private
   */
  _hasRequiredPermission(grantedPermission, requiredPermission) {
    const permissionLevels = {
      'view': 1,
      'edit': 2,
      'manage': 3
    };

    const granted = permissionLevels[grantedPermission] || 0;
    const required = permissionLevels[requiredPermission] || 0;

    return granted >= required;
  }
}

module.exports = FilePermissionManager;
