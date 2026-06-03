/**
 * 项目创建检查点管理器
 * 支持流式创建的断点续传功能
 *
 * 功能：
 * - 保存创建过程中的中间状态
 * - 失败时自动保存检查点
 * - 恢复时从上次中断处继续
 * - 自动清理过期检查点
 */

const { logger } = require('../utils/logger');
const crypto = require('crypto');

class CheckpointManager {
  constructor(database) {
    this.database = database;
    this.initializeTable();
  }

  /**
   * 初始化检查点表
   */
  initializeTable() {
    if (!this.database || !this.database.db) {
      logger.warn('[CheckpointManager] 数据库未初始化，跳过表创建');
      return;
    }

    try {
      this.database.db.exec(`
        CREATE TABLE IF NOT EXISTS project_checkpoints (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          operation TEXT NOT NULL,
          status TEXT DEFAULT 'in_progress',
          current_stage TEXT,
          completed_stages TEXT,
          completed_files TEXT,
          accumulated_data TEXT,
          error_message TEXT,
          retry_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )
      `);

      // 创建索引
      this.database.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_checkpoints_project_id
        ON project_checkpoints(project_id);

        CREATE INDEX IF NOT EXISTS idx_checkpoints_status
        ON project_checkpoints(status);

        CREATE INDEX IF NOT EXISTS idx_checkpoints_expires_at
        ON project_checkpoints(expires_at);
      `);

      logger.info('[CheckpointManager] 检查点表已初始化');
    } catch (error) {
      logger.error('[CheckpointManager] 初始化表失败:', error);
    }
  }

  /**
   * 创建新检查点
   * @param {Object} options - 检查点选项
   * @returns {Object} 检查点对象
   */
  createCheckpoint(options) {
    const {
      projectId = null,
      operation = 'create-stream',
      currentStage = null,
      completedStages = [],
      completedFiles = [],
      accumulatedData = {},
      ttl = 24 * 60 * 60 * 1000 // 默认24小时过期
    } = options;

    const now = Date.now();
    const checkpoint = {
      id: crypto.randomUUID(),
      project_id: projectId,
      operation,
      status: 'in_progress',
      current_stage: currentStage,
      completed_stages: JSON.stringify(completedStages),
      completed_files: JSON.stringify(completedFiles),
      accumulated_data: JSON.stringify(accumulatedData),
      error_message: null,
      retry_count: 0,
      created_at: now,
      updated_at: now,
      expires_at: now + ttl
    };

    try {
      this.database.db.prepare(`
        INSERT INTO project_checkpoints (
          id, project_id, operation, status, current_stage,
          completed_stages, completed_files, accumulated_data,
          error_message, retry_count, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        checkpoint.id,
        checkpoint.project_id,
        checkpoint.operation,
        checkpoint.status,
        checkpoint.current_stage,
        checkpoint.completed_stages,
        checkpoint.completed_files,
        checkpoint.accumulated_data,
        checkpoint.error_message,
        checkpoint.retry_count,
        checkpoint.created_at,
        checkpoint.updated_at,
        checkpoint.expires_at
      );

      logger.info(`[CheckpointManager] 检查点已创建: ${checkpoint.id}`);
      return checkpoint;
    } catch (error) {
      logger.error('[CheckpointManager] 创建检查点失败:', error);
      throw error;
    }
  }

  /**
   * 更新检查点
   * @param {string} checkpointId - 检查点ID
   * @param {Object} updates - 更新内容
   */
  updateCheckpoint(checkpointId, updates) {
    const {
      currentStage,
      completedStages,
      completedFiles,
      accumulatedData,
      status,
      errorMessage
    } = updates;

    try {
      const updateFields = [];
      const params = [];

      if (currentStage !== undefined) {
        updateFields.push('current_stage = ?');
        params.push(currentStage);
      }

      if (completedStages !== undefined) {
        updateFields.push('completed_stages = ?');
        params.push(JSON.stringify(completedStages));
      }

      if (completedFiles !== undefined) {
        updateFields.push('completed_files = ?');
        params.push(JSON.stringify(completedFiles));
      }

      if (accumulatedData !== undefined) {
        updateFields.push('accumulated_data = ?');
        params.push(JSON.stringify(accumulatedData));
      }

      if (status !== undefined) {
        updateFields.push('status = ?');
        params.push(status);
      }

      if (errorMessage !== undefined) {
        updateFields.push('error_message = ?');
        params.push(errorMessage);
      }

      updateFields.push('updated_at = ?');
      params.push(Date.now());

      params.push(checkpointId);

      this.database.db.prepare(`
        UPDATE project_checkpoints
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `).run(...params);

      logger.info(`[CheckpointManager] 检查点已更新: ${checkpointId}`);
    } catch (error) {
      logger.error('[CheckpointManager] 更新检查点失败:', error);
      throw error;
    }
  }

  /**
   * 标记检查点为失败
   * @param {string} checkpointId - 检查点ID
   * @param {string} errorMessage - 错误信息
   */
  markAsFailed(checkpointId, errorMessage) {
    try {
      this.database.db.prepare(`
        UPDATE project_checkpoints
        SET status = 'failed',
            error_message = ?,
            retry_count = retry_count + 1,
            updated_at = ?
        WHERE id = ?
      `).run(errorMessage, Date.now(), checkpointId);

      logger.info(`[CheckpointManager] 检查点标记为失败: ${checkpointId}`);
    } catch (error) {
      logger.error('[CheckpointManager] 标记失败时出错:', error);
    }
  }

  /**
   * 标记检查点为完成
   * @param {string} checkpointId - 检查点ID
   */
  markAsCompleted(checkpointId) {
    try {
      this.database.db.prepare(`
        UPDATE project_checkpoints
        SET status = 'completed',
            updated_at = ?
        WHERE id = ?
      `).run(Date.now(), checkpointId);

      logger.info(`[CheckpointManager] 检查点标记为完成: ${checkpointId}`);
    } catch (error) {
      logger.error('[CheckpointManager] 标记完成时出错:', error);
    }
  }

  /**
   * 获取检查点
   * @param {string} checkpointId - 检查点ID
   * @returns {Object|null} 检查点对象
   */
  getCheckpoint(checkpointId) {
    try {
      const checkpoint = this.database.db.prepare(`
        SELECT * FROM project_checkpoints WHERE id = ?
      `).get(checkpointId);

      if (!checkpoint) {
        return null;
      }

      // 解析JSON字段
      return {
        ...checkpoint,
        completed_stages: JSON.parse(checkpoint.completed_stages || '[]'),
        completed_files: JSON.parse(checkpoint.completed_files || '[]'),
        accumulated_data: JSON.parse(checkpoint.accumulated_data || '{}')
      };
    } catch (error) {
      logger.error('[CheckpointManager] 获取检查点失败:', error);
      return null;
    }
  }

  /**
   * 查找项目的最新检查点
   * @param {string} projectId - 项目ID（可能为null）
   * @param {string} operation - 操作类型
   * @returns {Object|null} 检查点对象
   */
  findLatestCheckpoint(projectId, operation = 'create-stream') {
    try {
      let query = `
        SELECT * FROM project_checkpoints
        WHERE operation = ? AND status = 'in_progress'
      `;
      const params = [operation];

      if (projectId) {
        query += ' AND project_id = ?';
        params.push(projectId);
      }

      query += ' ORDER BY created_at DESC LIMIT 1';

      const checkpoint = this.database.db.prepare(query).get(...params);

      if (!checkpoint) {
        return null;
      }

      // 检查是否过期
      if (checkpoint.expires_at < Date.now()) {
        logger.info(`[CheckpointManager] 检查点已过期: ${checkpoint.id}`);
        this.markAsFailed(checkpoint.id, '检查点已过期');
        return null;
      }

      // 解析JSON字段
      return {
        ...checkpoint,
        completed_stages: JSON.parse(checkpoint.completed_stages || '[]'),
        completed_files: JSON.parse(checkpoint.completed_files || '[]'),
        accumulated_data: JSON.parse(checkpoint.accumulated_data || '{}')
      };
    } catch (error) {
      logger.error('[CheckpointManager] 查找检查点失败:', error);
      return null;
    }
  }

  /**
   * 删除检查点
   * @param {string} checkpointId - 检查点ID
   */
  deleteCheckpoint(checkpointId) {
    try {
      this.database.db.prepare(`
        DELETE FROM project_checkpoints WHERE id = ?
      `).run(checkpointId);

      logger.info(`[CheckpointManager] 检查点已删除: ${checkpointId}`);
    } catch (error) {
      logger.error('[CheckpointManager] 删除检查点失败:', error);
    }
  }

  /**
   * 清理过期检查点
   * @param {number} olderThan - 清理多久之前的检查点（毫秒）
   * @returns {number} 清理的数量
   */
  cleanupExpired(olderThan = 24 * 60 * 60 * 1000) {
    try {
      const expiryTime = Date.now() - olderThan;

      const result = this.database.db.prepare(`
        DELETE FROM project_checkpoints
        WHERE expires_at < ? OR (status = 'completed' AND updated_at < ?)
      `).run(Date.now(), expiryTime);

      const deletedCount = result.changes || 0;
      logger.info(`[CheckpointManager] 清理了 ${deletedCount} 个过期检查点`);

      return deletedCount;
    } catch (error) {
      logger.error('[CheckpointManager] 清理检查点失败:', error);
      return 0;
    }
  }

  /**
   * 获取检查点统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    try {
      const stats = this.database.db.prepare(`
        SELECT
          status,
          COUNT(*) as count
        FROM project_checkpoints
        GROUP BY status
      `).all();

      const result = {
        total: 0,
        in_progress: 0,
        completed: 0,
        failed: 0
      };

      stats.forEach(row => {
        result.total += row.count;
        result[row.status] = row.count;
      });

      return result;
    } catch (error) {
      logger.error('[CheckpointManager] 获取统计信息失败:', error);
      return { total: 0, in_progress: 0, completed: 0, failed: 0 };
    }
  }
}

module.exports = CheckpointManager;
