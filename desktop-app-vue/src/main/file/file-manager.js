/**
 * 文件管理器 - Phase 2
 * 负责文件上传、下载、共享、锁定等核心功能
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class FileManager {
  /**
   * @param {Object} db - Better-SQLite3数据库实例
   * @param {Object} organizationManager - 组织管理器实例
   */
  constructor(db, organizationManager) {
    this.db = db;
    this.organizationManager = organizationManager;
  }

  /**
   * 上传文件
   * @param {Object} fileData - 文件数据
   * @param {string} uploaderDID - 上传者DID
   * @returns {Object} 文件信息
   */
  async uploadFile(fileData, uploaderDID) {
    const {
      project_id,
      org_id,
      workspace_id,
      file_name,
      file_path,
      file_type,
      file_size,
      content
    } = fileData;

    // 权限检查
    if (org_id) {
      const hasPermission = await this.organizationManager.checkPermission(
        org_id,
        uploaderDID,
        'file.upload'
      );

      if (!hasPermission) {
        throw new Error('无权限上传文件到此组织');
      }
    }

    // 计算文件checksum
    const checksum = this._calculateChecksum(content);

    // 检查是否已存在相同文件（基于checksum）
    const existingFile = this.db.prepare(`
      SELECT id FROM project_files
      WHERE checksum = ? AND project_id = ?
    `).get(checksum, project_id);

    if (existingFile) {
      console.log('[FileManager] 文件已存在（基于checksum），返回现有文件');
      return this.getFile(existingFile.id);
    }

    // 保存文件到磁盘
    const savedPath = await this._saveFileToDisk(file_path, content);

    // 插入文件记录
    const fileId = `file_${uuidv4().replace(/-/g, '')}`;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO project_files (
        id, project_id, org_id, workspace_id,
        file_name, file_path, file_type, file_size,
        checksum, version_number, lock_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fileId,
      project_id,
      org_id || null,
      workspace_id || null,
      file_name,
      savedPath,
      file_type,
      file_size,
      checksum,
      1, // 初始版本号
      'unlocked',
      now,
      now
    );

    // 记录访问日志
    await this._logFileAccess(fileId, uploaderDID, 'upload');

    // 记录活动日志
    if (org_id) {
      await this.organizationManager.logActivity(
        org_id,
        uploaderDID,
        'file.uploaded',
        { fileId, fileName: file_name }
      );
    }

    console.log('[FileManager] 文件上传成功:', file_name);

    return this.getFile(fileId);
  }

  /**
   * 获取文件信息
   * @param {string} fileId - 文件ID
   * @returns {Object} 文件信息
   */
  getFile(fileId) {
    const file = this.db.prepare(`
      SELECT * FROM project_files WHERE id = ?
    `).get(fileId);

    if (!file) {
      throw new Error('文件不存在');
    }

    // 解析JSON字段
    if (file.shared_with) {
      file.shared_with = JSON.parse(file.shared_with);
    }

    return file;
  }

  /**
   * 获取文件列表
   * @param {Object} filters - 筛选条件
   * @returns {Array} 文件列表
   */
  getFiles(filters = {}) {
    const {
      project_id,
      org_id,
      workspace_id,
      file_type,
      locked,
      limit = 100,
      offset = 0
    } = filters;

    let query = 'SELECT * FROM project_files WHERE 1=1';
    const params = [];

    if (project_id) {
      query += ' AND project_id = ?';
      params.push(project_id);
    }

    if (org_id) {
      query += ' AND org_id = ?';
      params.push(org_id);
    }

    if (workspace_id) {
      query += ' AND workspace_id = ?';
      params.push(workspace_id);
    }

    if (file_type) {
      query += ' AND file_type = ?';
      params.push(file_type);
    }

    if (locked !== undefined) {
      query += locked ? " AND lock_status != 'unlocked'" : " AND lock_status = 'unlocked'";
    }

    query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const files = this.db.prepare(query).all(...params);

    // 解析JSON字段
    return files.map(file => ({
      ...file,
      shared_with: file.shared_with ? JSON.parse(file.shared_with) : null
    }));
  }

  /**
   * 更新文件元数据
   * @param {string} fileId - 文件ID
   * @param {Object} updates - 更新数据
   * @param {string} updaterDID - 更新者DID
   * @returns {Object} 结果
   */
  async updateFile(fileId, updates, updaterDID) {
    const file = this.getFile(fileId);

    // 权限检查
    if (file.org_id) {
      const hasPermission = await this.organizationManager.checkPermission(
        file.org_id,
        updaterDID,
        'file.edit'
      );

      if (!hasPermission) {
        return { success: false, error: '无权限编辑文件' };
      }
    }

    // 检查文件锁定状态
    if (file.lock_status !== 'unlocked' && file.locked_by !== updaterDID) {
      return { success: false, error: '文件已被其他用户锁定' };
    }

    // 构建更新SQL
    const allowedFields = ['file_name', 'file_type', 'workspace_id'];
    const updateFields = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (updateFields.length === 0) {
      return { success: false, error: '没有可更新的字段' };
    }

    updateFields.push('updated_at = ?');
    params.push(Date.now());
    params.push(fileId);

    this.db.prepare(`
      UPDATE project_files
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `).run(...params);

    // 记录访问日志
    await this._logFileAccess(fileId, updaterDID, 'edit');

    console.log('[FileManager] 文件元数据更新成功');

    return { success: true };
  }

  /**
   * 删除文件
   * @param {string} fileId - 文件ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Object} 结果
   */
  async deleteFile(fileId, deleterDID) {
    const file = this.getFile(fileId);

    // 权限检查
    if (file.org_id) {
      const hasPermission = await this.organizationManager.checkPermission(
        file.org_id,
        deleterDID,
        'file.delete'
      );

      if (!hasPermission) {
        return { success: false, error: '无权限删除文件' };
      }
    }

    // 检查文件锁定状态
    if (file.lock_status !== 'unlocked') {
      return { success: false, error: '文件已锁定，无法删除' };
    }

    // 从磁盘删除文件（可选，可以改为标记删除）
    try {
      if (fs.existsSync(file.file_path)) {
        fs.unlinkSync(file.file_path);
      }
    } catch (error) {
      console.error('[FileManager] 删除磁盘文件失败:', error);
    }

    // 删除数据库记录（级联删除版本、权限等）
    this.db.prepare('DELETE FROM project_files WHERE id = ?').run(fileId);

    // 记录访问日志
    await this._logFileAccess(fileId, deleterDID, 'delete');

    // 记录活动日志
    if (file.org_id) {
      await this.organizationManager.logActivity(
        file.org_id,
        deleterDID,
        'file.deleted',
        { fileId, fileName: file.file_name }
      );
    }

    console.log('[FileManager] 文件删除成功');

    return { success: true };
  }

  /**
   * 锁定文件
   * @param {string} fileId - 文件ID
   * @param {string} lockerDID - 锁定者DID
   * @param {number} expiresIn - 锁定时长（毫秒）
   * @returns {Object} 结果
   */
  async lockFile(fileId, lockerDID, expiresIn = 3600000) {
    const file = this.getFile(fileId);

    // 检查是否已锁定
    if (file.lock_status !== 'unlocked' && file.locked_by !== lockerDID) {
      const lock = this.db.prepare('SELECT * FROM file_locks WHERE file_id = ?').get(fileId);
      if (lock && lock.expires_at > Date.now()) {
        return { success: false, error: '文件已被其他用户锁定' };
      }
    }

    const now = Date.now();
    const expiresAt = now + expiresIn;

    // 插入或更新锁定记录
    this.db.prepare(`
      INSERT INTO file_locks (id, file_id, locked_by, locked_at, expires_at, lock_type)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id) DO UPDATE SET
        locked_by = excluded.locked_by,
        locked_at = excluded.locked_at,
        expires_at = excluded.expires_at
    `).run(
      `lock_${uuidv4().replace(/-/g, '')}`,
      fileId,
      lockerDID,
      now,
      expiresAt,
      'exclusive'
    );

    // 更新文件锁定状态
    this.db.prepare(`
      UPDATE project_files
      SET lock_status = 'locked', locked_by = ?, locked_at = ?
      WHERE id = ?
    `).run(lockerDID, now, fileId);

    // 记录访问日志
    await this._logFileAccess(fileId, lockerDID, 'lock');

    console.log('[FileManager] 文件锁定成功');

    return { success: true, expiresAt };
  }

  /**
   * 解锁文件
   * @param {string} fileId - 文件ID
   * @param {string} unlockerDID - 解锁者DID
   * @returns {Object} 结果
   */
  async unlockFile(fileId, unlockerDID) {
    const file = this.getFile(fileId);

    // 检查是否有权限解锁
    if (file.locked_by !== unlockerDID) {
      // 检查是否有管理员权限
      if (file.org_id) {
        const hasPermission = await this.organizationManager.checkPermission(
          file.org_id,
          unlockerDID,
          'file.manage'
        );

        if (!hasPermission) {
          return { success: false, error: '无权限解锁此文件' };
        }
      } else {
        return { success: false, error: '只有锁定者可以解锁文件' };
      }
    }

    // 删除锁定记录
    this.db.prepare('DELETE FROM file_locks WHERE file_id = ?').run(fileId);

    // 更新文件锁定状态
    this.db.prepare(`
      UPDATE project_files
      SET lock_status = 'unlocked', locked_by = NULL, locked_at = NULL
      WHERE id = ?
    `).run(fileId);

    // 记录访问日志
    await this._logFileAccess(fileId, unlockerDID, 'unlock');

    console.log('[FileManager] 文件解锁成功');

    return { success: true };
  }

  /**
   * 添加文件标签
   * @param {string} fileId - 文件ID
   * @param {string} tag - 标签
   * @param {string} adderDID - 添加者DID
   */
  addTag(fileId, tag, adderDID) {
    const tagId = `tag_${uuidv4().replace(/-/g, '')}`;

    this.db.prepare(`
      INSERT OR IGNORE INTO file_tags (id, file_id, tag, created_by, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tagId, fileId, tag, adderDID, Date.now());

    console.log('[FileManager] 标签添加成功:', tag);
  }

  /**
   * 移除文件标签
   * @param {string} fileId - 文件ID
   * @param {string} tag - 标签
   */
  removeTag(fileId, tag) {
    this.db.prepare('DELETE FROM file_tags WHERE file_id = ? AND tag = ?').run(fileId, tag);
    console.log('[FileManager] 标签移除成功:', tag);
  }

  /**
   * 获取文件标签
   * @param {string} fileId - 文件ID
   * @returns {Array} 标签列表
   */
  getTags(fileId) {
    const tags = this.db.prepare('SELECT tag FROM file_tags WHERE file_id = ?').all(fileId);
    return tags.map(t => t.tag);
  }

  /**
   * 获取文件访问日志
   * @param {string} fileId - 文件ID
   * @param {number} limit - 限制数量
   * @returns {Array} 访问日志
   */
  getAccessLogs(fileId, limit = 50) {
    return this.db.prepare(`
      SELECT * FROM file_access_logs
      WHERE file_id = ?
      ORDER BY accessed_at DESC
      LIMIT ?
    `).all(fileId, limit);
  }

  /**
   * 计算文件checksum
   * @private
   */
  _calculateChecksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 保存文件到磁盘
   * @private
   */
  async _saveFileToDisk(originalPath, content) {
    // 实际实现中应该保存到应用数据目录
    // 这里返回原路径作为占位符
    return originalPath;
  }

  /**
   * 记录文件访问日志
   * @private
   */
  async _logFileAccess(fileId, userDID, action, metadata = {}) {
    const logId = `log_${uuidv4().replace(/-/g, '')}`;

    this.db.prepare(`
      INSERT INTO file_access_logs (id, file_id, user_did, action, accessed_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      fileId,
      userDID,
      action,
      Date.now(),
      metadata.ip || null,
      metadata.userAgent || null
    );
  }
}

module.exports = FileManager;
