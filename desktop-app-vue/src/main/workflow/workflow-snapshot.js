/**
 * 工作流快照系统
 *
 * 支持阶段执行前创建快照，失败时回滚
 *
 * 功能：
 * - 上下文快照
 * - 文件系统快照（增量备份）
 * - 数据库状态快照
 * - 自动回滚机制
 *
 * @version 0.27.0
 */

const { logger } = require('../utils/logger.js');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * 快照类型
 */
const SnapshotType = {
  CONTEXT: 'context', // 上下文快照
  FILESYSTEM: 'filesystem', // 文件系统快照
  DATABASE: 'database', // 数据库快照
  FULL: 'full', // 完整快照
};

/**
 * 工作流快照
 */
class WorkflowSnapshot {
  constructor(stageId, stageName) {
    this.id = `snapshot-${stageId}-${Date.now()}`;
    this.stageId = stageId;
    this.stageName = stageName;
    this.timestamp = Date.now();
    this.type = SnapshotType.FULL;

    // 快照数据
    this.contextSnapshot = null;
    this.filesystemSnapshot = null;
    this.databaseSnapshot = null;

    // 元数据
    this.size = 0;
    this.fileCount = 0;
  }

  /**
   * 捕获上下文快照
   */
  captureContext(context) {
    try {
      // 深拷贝上下文
      this.contextSnapshot = JSON.parse(JSON.stringify(context));
      logger.info(`[Snapshot] 上下文快照已创建: ${this.stageId}`);
      return true;
    } catch (error) {
      logger.error(`[Snapshot] 创建上下文快照失败:`, error);
      return false;
    }
  }

  /**
   * 捕获文件系统快照
   *
   * @param {Array<string>} filePaths - 需要备份的文件路径
   * @param {string} backupDir - 备份目录
   */
  async captureFilesystem(filePaths, backupDir) {
    if (!filePaths || filePaths.length === 0) {
      logger.info('[Snapshot] 无文件需要备份');
      return true;
    }

    try {
      // 创建备份目录
      const snapshotDir = path.join(backupDir, this.id);
      await fs.mkdir(snapshotDir, { recursive: true });

      this.filesystemSnapshot = {
        backupDir: snapshotDir,
        files: [],
      };

      // 备份每个文件
      for (const filePath of filePaths) {
        try {
          // 检查文件是否存在
          await fs.access(filePath);

          // 计算相对路径
          const fileName = path.basename(filePath);
          const backupPath = path.join(snapshotDir, fileName);

          // 复制文件
          await fs.copyFile(filePath, backupPath);

          // 记录备份信息
          this.filesystemSnapshot.files.push({
            originalPath: filePath,
            backupPath,
            size: (await fs.stat(filePath)).size,
          });

          this.fileCount++;
          this.size += (await fs.stat(filePath)).size;

          logger.info(`[Snapshot] 文件已备份: ${fileName}`);
        } catch (fileError) {
          logger.warn(`[Snapshot] 备份文件失败: ${filePath}`, fileError.message);
          // 继续备份其他文件
        }
      }

      logger.info(`[Snapshot] 文件系统快照已创建: ${this.fileCount} 个文件, ${this.size} 字节`);
      return true;
    } catch (error) {
      logger.error('[Snapshot] 创建文件系统快照失败:', error);
      return false;
    }
  }

  /**
   * 捕获数据库状态快照
   *
   * @param {Object} database - 数据库实例
   * @param {Array<string>} tables - 需要备份的表名
   */
  async captureDatabase(database, tables = []) {
    if (!database || !database.db) {
      logger.warn('[Snapshot] 数据库未初始化，跳过数据库快照');
      return false;
    }

    try {
      this.databaseSnapshot = {
        tables: {},
        timestamp: Date.now(),
      };

      // 备份指定表的数据
      for (const tableName of tables) {
        try {
          const rows = database.db.prepare(`SELECT * FROM ${tableName}`).all();
          this.databaseSnapshot.tables[tableName] = {
            rowCount: rows.length,
            data: rows, // 完整数据
          };

          logger.info(`[Snapshot] 表已备份: ${tableName} (${rows.length} 行)`);
        } catch (tableError) {
          logger.warn(`[Snapshot] 备份表失败: ${tableName}`, tableError.message);
        }
      }

      logger.info(`[Snapshot] 数据库快照已创建: ${tables.length} 个表`);
      return true;
    } catch (error) {
      logger.error('[Snapshot] 创建数据库快照失败:', error);
      return false;
    }
  }

  /**
   * 恢复上下文
   */
  restoreContext() {
    if (!this.contextSnapshot) {
      logger.warn('[Snapshot] 无上下文快照可恢复');
      return null;
    }

    try {
      // 深拷贝返回
      const restored = JSON.parse(JSON.stringify(this.contextSnapshot));
      logger.info(`[Snapshot] 上下文已恢复: ${this.stageId}`);
      return restored;
    } catch (error) {
      logger.error('[Snapshot] 恢复上下文失败:', error);
      return null;
    }
  }

  /**
   * 恢复文件系统
   */
  async restoreFilesystem() {
    if (!this.filesystemSnapshot || !this.filesystemSnapshot.files) {
      logger.warn('[Snapshot] 无文件系统快照可恢复');
      return true;
    }

    try {
      logger.info(`[Snapshot] 开始恢复文件系统: ${this.filesystemSnapshot.files.length} 个文件`);

      for (const fileInfo of this.filesystemSnapshot.files) {
        try {
          // 从备份恢复文件
          await fs.copyFile(fileInfo.backupPath, fileInfo.originalPath);
          logger.info(`[Snapshot] 文件已恢复: ${path.basename(fileInfo.originalPath)}`);
        } catch (fileError) {
          logger.error(`[Snapshot] 恢复文件失败: ${fileInfo.originalPath}`, fileError);
          // 继续恢复其他文件
        }
      }

      logger.info('[Snapshot] 文件系统恢复完成');
      return true;
    } catch (error) {
      logger.error('[Snapshot] 恢复文件系统失败:', error);
      return false;
    }
  }

  /**
   * 恢复数据库状态
   */
  async restoreDatabase(database) {
    if (!this.databaseSnapshot || !this.databaseSnapshot.tables) {
      logger.warn('[Snapshot] 无数据库快照可恢复');
      return true;
    }

    if (!database || !database.db) {
      logger.error('[Snapshot] 数据库未初始化，无法恢复');
      return false;
    }

    try {
      logger.info(`[Snapshot] 开始恢复数据库: ${Object.keys(this.databaseSnapshot.tables).length} 个表`);

      for (const [tableName, tableData] of Object.entries(this.databaseSnapshot.tables)) {
        try {
          // 清空表
          database.db.prepare(`DELETE FROM ${tableName}`).run();

          // 恢复数据
          if (tableData.data && tableData.data.length > 0) {
            const columns = Object.keys(tableData.data[0]);
            const placeholders = columns.map(() => '?').join(', ');
            const stmt = database.db.prepare(
              `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`
            );

            for (const row of tableData.data) {
              const values = columns.map((col) => row[col]);
              stmt.run(...values);
            }
          }

          logger.info(`[Snapshot] 表已恢复: ${tableName} (${tableData.rowCount} 行)`);
        } catch (tableError) {
          logger.error(`[Snapshot] 恢复表失败: ${tableName}`, tableError);
          // 继续恢复其他表
        }
      }

      logger.info('[Snapshot] 数据库恢复完成');
      return true;
    } catch (error) {
      logger.error('[Snapshot] 恢复数据库失败:', error);
      return false;
    }
  }

  /**
   * 清理快照
   */
  async cleanup() {
    try {
      // 清理文件系统备份
      if (this.filesystemSnapshot && this.filesystemSnapshot.backupDir) {
        await fs.rm(this.filesystemSnapshot.backupDir, { recursive: true, force: true });
        logger.info(`[Snapshot] 快照已清理: ${this.id}`);
      }
    } catch (error) {
      logger.warn('[Snapshot] 清理快照失败:', error);
    }
  }

  /**
   * 获取快照信息
   */
  getInfo() {
    return {
      id: this.id,
      stageId: this.stageId,
      stageName: this.stageName,
      timestamp: this.timestamp,
      type: this.type,
      size: this.size,
      fileCount: this.fileCount,
      hasContext: !!this.contextSnapshot,
      hasFilesystem: !!this.filesystemSnapshot,
      hasDatabase: !!this.databaseSnapshot,
    };
  }
}

/**
 * 快照管理器
 */
class SnapshotManager {
  constructor(options = {}) {
    this.backupDir = options.backupDir || path.join(process.cwd(), '.workflow-snapshots');
    this.database = options.database;
    this.maxSnapshots = options.maxSnapshots || 10; // 最多保留10个快照
    this.snapshots = new Map(); // stageId -> WorkflowSnapshot
  }

  /**
   * 创建快照
   *
   * @param {string} stageId - 阶段ID
   * @param {string} stageName - 阶段名称
   * @param {Object} options - 快照选项
   * @returns {WorkflowSnapshot} 快照实例
   */
  async createSnapshot(stageId, stageName, options = {}) {
    logger.info(`[SnapshotManager] 创建快照: ${stageName}`);

    const snapshot = new WorkflowSnapshot(stageId, stageName);

    // 捕获上下文
    if (options.context) {
      snapshot.captureContext(options.context);
    }

    // 捕获文件系统
    if (options.filePaths && options.filePaths.length > 0) {
      await snapshot.captureFilesystem(options.filePaths, this.backupDir);
    }

    // 捕获数据库
    if (options.dbTables && options.dbTables.length > 0) {
      await snapshot.captureDatabase(this.database, options.dbTables);
    }

    // 保存快照
    this.snapshots.set(stageId, snapshot);

    // 清理旧快照
    await this._cleanupOldSnapshots();

    logger.info(`[SnapshotManager] 快照创建完成: ${snapshot.id}`);
    return snapshot;
  }

  /**
   * 恢复快照
   *
   * @param {string} stageId - 阶段ID
   * @returns {Object} 恢复结果
   */
  async restoreSnapshot(stageId) {
    const snapshot = this.snapshots.get(stageId);

    if (!snapshot) {
      logger.warn(`[SnapshotManager] 快照不存在: ${stageId}`);
      return { success: false, error: '快照不存在' };
    }

    logger.warn(`[SnapshotManager] 开始回滚到快照: ${snapshot.id}`);

    const result = {
      success: true,
      context: null,
      filesystemRestored: false,
      databaseRestored: false,
      errors: [],
    };

    try {
      // 恢复上下文
      result.context = snapshot.restoreContext();

      // 恢复文件系统
      result.filesystemRestored = await snapshot.restoreFilesystem();
      if (!result.filesystemRestored) {
        result.errors.push('文件系统恢复失败');
      }

      // 恢复数据库
      result.databaseRestored = await snapshot.restoreDatabase(this.database);
      if (!result.databaseRestored) {
        result.errors.push('数据库恢复失败');
      }

      if (result.errors.length > 0) {
        result.success = false;
        logger.error(`[SnapshotManager] 快照恢复部分失败:`, result.errors);
      } else {
        logger.info(`[SnapshotManager] 快照恢复成功: ${snapshot.id}`);
      }

      return result;
    } catch (error) {
      logger.error('[SnapshotManager] 快照恢复失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 删除快照
   */
  async deleteSnapshot(stageId) {
    const snapshot = this.snapshots.get(stageId);

    if (snapshot) {
      await snapshot.cleanup();
      this.snapshots.delete(stageId);
      logger.info(`[SnapshotManager] 快照已删除: ${stageId}`);
    }
  }

  /**
   * 清理所有快照
   */
  async cleanupAll() {
    logger.info(`[SnapshotManager] 清理所有快照...`);

    for (const snapshot of this.snapshots.values()) {
      await snapshot.cleanup();
    }

    this.snapshots.clear();

    // 清理备份目录
    try {
      await fs.rm(this.backupDir, { recursive: true, force: true });
      logger.info('[SnapshotManager] 备份目录已清理');
    } catch (error) {
      logger.warn('[SnapshotManager] 清理备份目录失败:', error);
    }
  }

  /**
   * 清理旧快照（保留最近N个）
   * @private
   */
  async _cleanupOldSnapshots() {
    if (this.snapshots.size <= this.maxSnapshots) {
      return;
    }

    const snapshotArray = Array.from(this.snapshots.entries());
    snapshotArray.sort((a, b) => a[1].timestamp - b[1].timestamp);

    // 删除最旧的快照
    const toDelete = snapshotArray.slice(0, snapshotArray.length - this.maxSnapshots);

    for (const [stageId, snapshot] of toDelete) {
      await snapshot.cleanup();
      this.snapshots.delete(stageId);
      logger.info(`[SnapshotManager] 旧快照已清理: ${snapshot.id}`);
    }
  }

  /**
   * 获取所有快照信息
   */
  getAllSnapshots() {
    return Array.from(this.snapshots.values()).map((s) => s.getInfo());
  }
}

module.exports = {
  WorkflowSnapshot,
  SnapshotManager,
  SnapshotType,
};
