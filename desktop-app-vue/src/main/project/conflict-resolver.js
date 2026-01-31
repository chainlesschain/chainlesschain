/**
 * 文件冲突检测和解决系统
 *
 * 支持：
 * - 版本号检测
 * - 三方合并
 * - 冲突历史记录
 * - 多种冲突解决策略
 *
 * @version 0.27.0
 */

const { logger } = require('../utils/logger.js');
const crypto = require('crypto');
const { EventEmitter } = require('events');

/**
 * 冲突类型
 */
const ConflictType = {
  VERSION_MISMATCH: 'version_mismatch', // 版本冲突
  CONCURRENT_EDIT: 'concurrent_edit', // 并发编辑
  DELETE_MODIFY: 'delete_modify', // 删除-修改冲突
  BINARY_CONFLICT: 'binary_conflict', // 二进制文件冲突
};

/**
 * 冲突解决策略
 */
const ResolutionStrategy = {
  USE_MINE: 'use-mine', // 使用本地版本
  USE_THEIRS: 'use-theirs', // 使用服务器版本
  MERGE: 'merge', // 手动合并
  AUTO_MERGE: 'auto-merge', // 自动合并
};

/**
 * 文件冲突
 */
class FileConflict {
  constructor(options) {
    this.id = options.id || crypto.randomUUID();
    this.fileId = options.fileId;
    this.fileName = options.fileName;
    this.type = options.type;

    // 版本信息
    this.currentVersion = options.currentVersion;
    this.expectedVersion = options.expectedVersion;

    // 内容信息
    this.currentContent = options.currentContent;
    this.newContent = options.newContent;
    this.baseContent = options.baseContent; // 共同祖先版本

    // 元数据
    this.currentModifiedAt = options.currentModifiedAt;
    this.currentModifiedBy = options.currentModifiedBy;
    this.newModifiedAt = options.newModifiedAt;
    this.newModifiedBy = options.newModifiedBy;

    // 差异信息
    this.diff = null;
    this.conflictMarkers = null;

    // 状态
    this.resolved = false;
    this.resolution = null;
    this.resolvedAt = null;
    this.resolvedBy = null;

    this.createdAt = Date.now();
  }

  /**
   * 生成冲突差异
   */
  generateDiff() {
    if (!this.currentContent || !this.newContent) {
      return null;
    }

    const currentLines = this.currentContent.split('\n');
    const newLines = this.newContent.split('\n');

    // 简单的行级差异（生产环境应使用 diff 库）
    const diff = {
      additions: [],
      deletions: [],
      modifications: [],
    };

    const maxLen = Math.max(currentLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
      const currentLine = currentLines[i];
      const newLine = newLines[i];

      if (currentLine === undefined) {
        // 新增行
        diff.additions.push({ line: i + 1, content: newLine });
      } else if (newLine === undefined) {
        // 删除行
        diff.deletions.push({ line: i + 1, content: currentLine });
      } else if (currentLine !== newLine) {
        // 修改行
        diff.modifications.push({
          line: i + 1,
          from: currentLine,
          to: newLine,
        });
      }
    }

    this.diff = diff;
    return diff;
  }

  /**
   * 生成冲突标记（Git 风格）
   */
  generateConflictMarkers() {
    if (!this.currentContent || !this.newContent) {
      return null;
    }

    const markers = {
      start: '<<<<<<< LOCAL (当前版本)',
      separator: '=======',
      end: '>>>>>>> REMOTE (新版本)',
    };

    // 生成带冲突标记的内容
    const conflictContent = [
      markers.start,
      this.currentContent,
      markers.separator,
      this.newContent,
      markers.end,
    ].join('\n');

    this.conflictMarkers = {
      markers,
      content: conflictContent,
    };

    return this.conflictMarkers;
  }

  /**
   * 尝试自动合并
   */
  async autoMerge() {
    if (!this.baseContent || !this.currentContent || !this.newContent) {
      return { success: false, reason: '缺少基础版本，无法自动合并' };
    }

    const baseLines = this.baseContent.split('\n');
    const currentLines = this.currentContent.split('\n');
    const newLines = this.newContent.split('\n');

    const mergedLines = [];
    let hasConflict = false;

    const maxLen = Math.max(baseLines.length, currentLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
      const baseLine = baseLines[i];
      const currentLine = currentLines[i];
      const newLine = newLines[i];

      if (currentLine === newLine) {
        // 两边相同，使用任意一个
        mergedLines.push(currentLine || '');
      } else if (currentLine === baseLine) {
        // 只有远程改变，使用远程版本
        mergedLines.push(newLine || '');
      } else if (newLine === baseLine) {
        // 只有本地改变，使用本地版本
        mergedLines.push(currentLine || '');
      } else {
        // 两边都改变，无法自动合并
        hasConflict = true;
        mergedLines.push(
          `<<<<<<< LOCAL\n${currentLine || ''}\n=======\n${newLine || ''}\n>>>>>>> REMOTE`
        );
      }
    }

    if (hasConflict) {
      return {
        success: false,
        reason: '存在冲突行，需要手动解决',
        mergedContent: mergedLines.join('\n'),
        hasConflictMarkers: true,
      };
    }

    return {
      success: true,
      mergedContent: mergedLines.join('\n'),
    };
  }

  /**
   * 解决冲突
   */
  resolve(strategy, mergedContent = null) {
    this.resolved = true;
    this.resolvedAt = Date.now();
    this.resolution = {
      strategy,
      mergedContent,
    };

    let finalContent;

    switch (strategy) {
      case ResolutionStrategy.USE_MINE:
        finalContent = this.currentContent;
        break;

      case ResolutionStrategy.USE_THEIRS:
        finalContent = this.newContent;
        break;

      case ResolutionStrategy.MERGE:
      case ResolutionStrategy.AUTO_MERGE:
        finalContent = mergedContent;
        break;

      default:
        throw new Error(`未知的解决策略: ${strategy}`);
    }

    return {
      content: finalContent,
      strategy,
      resolvedAt: this.resolvedAt,
    };
  }

  /**
   * 序列化冲突信息
   */
  toJSON() {
    return {
      id: this.id,
      fileId: this.fileId,
      fileName: this.fileName,
      type: this.type,
      currentVersion: this.currentVersion,
      expectedVersion: this.expectedVersion,
      currentModifiedAt: this.currentModifiedAt,
      currentModifiedBy: this.currentModifiedBy,
      newModifiedAt: this.newModifiedAt,
      newModifiedBy: this.newModifiedBy,
      diff: this.diff,
      conflictMarkers: this.conflictMarkers,
      resolved: this.resolved,
      resolution: this.resolution,
      createdAt: this.createdAt,
      resolvedAt: this.resolvedAt,
    };
  }
}

/**
 * 冲突解决器
 */
class ConflictResolver extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.conflicts = new Map(); // fileId -> FileConflict
    this.history = []; // 冲突历史
  }

  /**
   * 检测文件更新冲突
   *
   * @param {Object} params - 更新参数
   * @returns {Object} 检测结果
   */
  async detectConflict(params) {
    const { fileId, content, version, modifiedBy } = params;

    // 1. 获取当前文件信息
    const currentFile = await this._getCurrentFile(fileId);

    if (!currentFile) {
      // 文件不存在，无冲突
      return { hasConflict: false };
    }

    // 2. 检查版本号
    const currentVersion = currentFile.version || 1;
    const expectedVersion = version || currentVersion;

    if (currentVersion !== expectedVersion) {
      // 版本冲突
      logger.warn(`[ConflictResolver] 检测到版本冲突: 当前=${currentVersion}, 期望=${expectedVersion}`);

      const conflict = new FileConflict({
        fileId,
        fileName: currentFile.file_name,
        type: ConflictType.VERSION_MISMATCH,
        currentVersion,
        expectedVersion,
        currentContent: currentFile.content,
        newContent: content,
        baseContent: await this._getBaseVersion(fileId, expectedVersion),
        currentModifiedAt: currentFile.updated_at,
        currentModifiedBy: currentFile.modified_by,
        newModifiedAt: Date.now(),
        newModifiedBy: modifiedBy,
      });

      // 生成差异和冲突标记
      conflict.generateDiff();
      conflict.generateConflictMarkers();

      // 尝试自动合并
      const autoMergeResult = await conflict.autoMerge();

      this.conflicts.set(fileId, conflict);
      this.emit('conflict-detected', conflict);

      return {
        hasConflict: true,
        conflict,
        autoMergeResult,
      };
    }

    // 3. 无冲突
    return { hasConflict: false };
  }

  /**
   * 解决冲突
   *
   * @param {string} fileId - 文件ID
   * @param {string} strategy - 解决策略
   * @param {string} mergedContent - 合并后的内容（手动合并时需要）
   * @returns {Object} 解决结果
   */
  async resolveConflict(fileId, strategy, mergedContent = null) {
    const conflict = this.conflicts.get(fileId);

    if (!conflict) {
      throw new Error(`冲突不存在: ${fileId}`);
    }

    if (conflict.resolved) {
      throw new Error(`冲突已解决: ${fileId}`);
    }

    logger.info(`[ConflictResolver] 解决冲突: ${fileId}, 策略: ${strategy}`);

    const resolution = conflict.resolve(strategy, mergedContent);

    // 更新文件
    await this._updateFile(fileId, {
      content: resolution.content,
      version: conflict.currentVersion + 1,
      updated_at: Date.now(),
    });

    // 移到历史记录
    this.history.push(conflict);
    this.conflicts.delete(fileId);

    this.emit('conflict-resolved', {
      fileId,
      conflict,
      resolution,
    });

    logger.info(`[ConflictResolver] 冲突已解决: ${fileId}`);

    return {
      success: true,
      content: resolution.content,
      newVersion: conflict.currentVersion + 1,
    };
  }

  /**
   * 获取所有活跃冲突
   */
  getActiveConflicts() {
    return Array.from(this.conflicts.values()).map((c) => c.toJSON());
  }

  /**
   * 获取冲突历史
   */
  getConflictHistory(limit = 50) {
    return this.history.slice(-limit).map((c) => c.toJSON());
  }

  /**
   * 清除已解决的冲突历史
   */
  clearHistory() {
    this.history = [];
    logger.info('[ConflictResolver] 冲突历史已清除');
  }

  /**
   * 获取当前文件信息（私有）
   */
  async _getCurrentFile(fileId) {
    if (!this.database || !this.database.db) {
      throw new Error('数据库未初始化');
    }

    const file = this.database.db
      .prepare('SELECT * FROM project_files WHERE id = ?')
      .get(fileId);

    return file || null;
  }

  /**
   * 获取基础版本（私有）
   */
  async _getBaseVersion(fileId, version) {
    // 从文件版本历史表获取
    if (!this.database || !this.database.db) {
      return null;
    }

    try {
      const baseVersion = this.database.db
        .prepare('SELECT content FROM file_versions WHERE file_id = ? AND version = ?')
        .get(fileId, version);

      return baseVersion ? baseVersion.content : null;
    } catch (error) {
      logger.warn('[ConflictResolver] 无法获取基础版本:', error.message);
      return null;
    }
  }

  /**
   * 更新文件（私有）
   */
  async _updateFile(fileId, updates) {
    if (!this.database || !this.database.db) {
      throw new Error('数据库未初始化');
    }

    const fields = Object.keys(updates);
    const values = Object.values(updates);

    const setClause = fields.map((f) => `${f} = ?`).join(', ');

    this.database.db
      .prepare(`UPDATE project_files SET ${setClause} WHERE id = ?`)
      .run(...values, fileId);

    logger.info(`[ConflictResolver] 文件已更新: ${fileId}`);
  }
}

/**
 * 创建冲突解决器实例
 */
let conflictResolverInstance = null;

function getConflictResolver(database) {
  if (!conflictResolverInstance) {
    conflictResolverInstance = new ConflictResolver(database);
    logger.info('[ConflictResolver] 冲突解决器已初始化');
  }
  return conflictResolverInstance;
}

module.exports = {
  ConflictResolver,
  FileConflict,
  ConflictType,
  ResolutionStrategy,
  getConflictResolver,
};
