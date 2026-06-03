/**
 * 带快照功能的工作流阶段
 *
 * 继承 WorkflowStage，增加快照和回滚功能
 *
 * @version 0.27.0
 */

const { WorkflowStage } = require('./workflow-stage.js');
const { SnapshotManager } = require('./workflow-snapshot.js');
const { logger } = require('../utils/logger.js');

/**
 * 带快照功能的工作流阶段
 */
class SnapshotWorkflowStage extends WorkflowStage {
  constructor(config, snapshotManager) {
    super(config);
    this.snapshotManager = snapshotManager;
    this.snapshot = null;
    this.snapshotEnabled = config.snapshotEnabled !== false; // 默认启用快照
    this.snapshotOptions = config.snapshotOptions || {};
  }

  /**
   * 执行阶段（带快照）
   *
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Object} 执行结果
   */
  async execute(input, context = {}) {
    // 如果启用快照，先创建快照
    if (this.snapshotEnabled && this.snapshotManager) {
      try {
        logger.info(`[SnapshotStage] 创建阶段快照: ${this.name}`);
        this.snapshot = await this._createSnapshot(context);
      } catch (snapshotError) {
        logger.error('[SnapshotStage] 创建快照失败:', snapshotError);
        // 继续执行，快照失败不阻塞流程
      }
    }

    try {
      // 调用父类的 execute 方法
      const result = await super.execute(input, context);
      return result;
    } catch (error) {
      // 执行失败，尝试回滚
      if (this.snapshot) {
        logger.error(`[SnapshotStage] 阶段执行失败，开始回滚: ${this.name}`);
        await this._rollback(context);
      }

      throw error;
    }
  }

  /**
   * 创建快照
   * @private
   */
  async _createSnapshot(context) {
    const options = {
      context,
      filePaths: this.snapshotOptions.filePaths || [],
      dbTables: this.snapshotOptions.dbTables || [],
    };

    return await this.snapshotManager.createSnapshot(this.id, this.name, options);
  }

  /**
   * 回滚到快照
   * @private
   */
  async _rollback(context) {
    if (!this.snapshot) {
      logger.warn(`[SnapshotStage] 无快照可回滚: ${this.name}`);
      return false;
    }

    try {
      logger.warn(`[SnapshotStage] ===== 开始回滚阶段: ${this.name} =====`);

      const result = await this.snapshotManager.restoreSnapshot(this.id);

      if (result.success) {
        logger.info(`[SnapshotStage] 阶段回滚成功: ${this.name}`);

        // 恢复上下文
        if (result.context) {
          Object.assign(context, result.context);
          logger.info('[SnapshotStage] 上下文已恢复');
        }

        return true;
      } else {
        logger.error(`[SnapshotStage] 阶段回滚失败: ${this.name}`, result.errors);
        return false;
      }
    } catch (error) {
      logger.error(`[SnapshotStage] 回滚过程出错: ${this.name}`, error);
      return false;
    }
  }

  /**
   * 清理快照
   */
  async cleanupSnapshot() {
    if (this.snapshot && this.snapshotManager) {
      await this.snapshotManager.deleteSnapshot(this.id);
      this.snapshot = null;
    }
  }

  /**
   * 重置阶段（包括清理快照）
   */
  async reset() {
    await this.cleanupSnapshot();
    super.reset();
  }
}

/**
 * 创建带快照的工作流阶段工厂
 */
class SnapshotWorkflowStageFactory {
  constructor(snapshotManager) {
    this.snapshotManager = snapshotManager;
  }

  /**
   * 创建单个阶段
   */
  createStage(config) {
    return new SnapshotWorkflowStage(config, this.snapshotManager);
  }

  /**
   * 创建默认阶段集合
   */
  createDefaultStages(executors = {}, snapshotOptions = {}) {
    const { DEFAULT_STAGES } = require('./workflow-stage.js');

    return DEFAULT_STAGES.map((config) => {
      const executor = executors[config.id];
      const stageSnapshotOptions = snapshotOptions[config.id] || {};

      return new SnapshotWorkflowStage(
        {
          ...config,
          executor,
          snapshotOptions: stageSnapshotOptions,
        },
        this.snapshotManager
      );
    });
  }
}

module.exports = {
  SnapshotWorkflowStage,
  SnapshotWorkflowStageFactory,
};
