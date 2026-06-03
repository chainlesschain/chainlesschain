/**
 * 事务管理器
 *
 * 提供多步骤事务管理，支持自动回滚
 *
 * 使用示例:
 * ```javascript
 * const transaction = new TransactionManager('create-project');
 *
 * try {
 *   const projectId = await transaction.step('generate-id',
 *     () => crypto.randomUUID(),
 *     null // 无需回滚
 *   );
 *
 *   await transaction.step('create-backend',
 *     () => httpClient.createProject(data),
 *     () => httpClient.deleteProject(projectId) // 回滚函数
 *   );
 *
 *   await transaction.commit();
 * } catch (error) {
 *   await transaction.rollback();
 *   throw error;
 * }
 * ```
 *
 * @version 0.27.0
 */

const { logger } = require('./logger.js');
const { EventEmitter } = require('events');

/**
 * 事务步骤状态
 */
const StepStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  ROLLED_BACK: 'rolled_back',
  FAILED: 'failed',
};

/**
 * 事务状态
 */
const TransactionStatus = {
  IDLE: 'idle',
  RUNNING: 'running',
  COMMITTED: 'committed',
  ROLLING_BACK: 'rolling_back',
  ROLLED_BACK: 'rolled_back',
  FAILED: 'failed',
};

/**
 * 事务步骤
 */
class TransactionStep {
  constructor(name, executor, rollback) {
    this.name = name;
    this.executor = executor;
    this.rollback = rollback;
    this.status = StepStatus.PENDING;
    this.result = null;
    this.error = null;
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * 执行步骤
   */
  async execute() {
    this.status = StepStatus.RUNNING;
    this.startTime = Date.now();

    try {
      this.result = await this.executor();
      this.status = StepStatus.COMPLETED;
      this.endTime = Date.now();
      return this.result;
    } catch (error) {
      this.status = StepStatus.FAILED;
      this.error = error;
      this.endTime = Date.now();
      throw error;
    }
  }

  /**
   * 回滚步骤
   */
  async rollbackStep() {
    if (!this.rollback || this.status !== StepStatus.COMPLETED) {
      return;
    }

    try {
      await this.rollback();
      this.status = StepStatus.ROLLED_BACK;
      logger.info(`[Transaction] 步骤回滚成功: ${this.name}`);
    } catch (error) {
      logger.error(`[Transaction] 步骤回滚失败: ${this.name}`, error);
      throw error;
    }
  }

  /**
   * 获取步骤信息
   */
  getInfo() {
    return {
      name: this.name,
      status: this.status,
      duration: this.endTime ? this.endTime - this.startTime : null,
      error: this.error ? this.error.message : null,
    };
  }
}

/**
 * 事务管理器
 */
class TransactionManager extends EventEmitter {
  constructor(name = 'transaction') {
    super();
    this.name = name;
    this.steps = [];
    this.status = TransactionStatus.IDLE;
    this.startTime = null;
    this.endTime = null;
    this.error = null;
  }

  /**
   * 添加并执行事务步骤
   *
   * @param {string} name - 步骤名称
   * @param {Function} executor - 执行函数，返回结果
   * @param {Function|null} rollback - 回滚函数，可选
   * @returns {Promise<any>} 步骤执行结果
   */
  async step(name, executor, rollback = null) {
    if (this.status === TransactionStatus.COMMITTED) {
      throw new Error('事务已提交，无法添加新步骤');
    }

    if (this.status === TransactionStatus.ROLLED_BACK) {
      throw new Error('事务已回滚，无法添加新步骤');
    }

    const step = new TransactionStep(name, executor, rollback);
    this.steps.push(step);

    if (this.status === TransactionStatus.IDLE) {
      this.status = TransactionStatus.RUNNING;
      this.startTime = Date.now();
    }

    logger.info(`[Transaction:${this.name}] 执行步骤 ${this.steps.length}: ${name}`);
    this.emit('step-start', { name, index: this.steps.length - 1 });

    try {
      const result = await step.execute();
      this.emit('step-complete', { name, index: this.steps.length - 1, result });
      return result;
    } catch (error) {
      this.error = error;
      this.emit('step-error', { name, index: this.steps.length - 1, error });
      throw error;
    }
  }

  /**
   * 提交事务
   */
  async commit() {
    if (this.status !== TransactionStatus.RUNNING) {
      throw new Error(`无法提交事务，当前状态: ${this.status}`);
    }

    this.status = TransactionStatus.COMMITTED;
    this.endTime = Date.now();

    logger.info(`[Transaction:${this.name}] 事务提交成功，耗时: ${this.endTime - this.startTime}ms`);
    this.emit('committed', this.getInfo());
  }

  /**
   * 回滚事务
   *
   * 按照相反的顺序回滚所有已完成的步骤
   */
  async rollback() {
    if (this.status === TransactionStatus.ROLLED_BACK) {
      logger.warn(`[Transaction:${this.name}] 事务已回滚，跳过`);
      return;
    }

    this.status = TransactionStatus.ROLLING_BACK;
    logger.warn(`[Transaction:${this.name}] 开始回滚事务，共 ${this.steps.length} 个步骤`);
    this.emit('rollback-start', { stepCount: this.steps.length });

    const completedSteps = this.steps
      .filter(step => step.status === StepStatus.COMPLETED)
      .reverse();

    const rollbackErrors = [];

    for (const step of completedSteps) {
      try {
        logger.info(`[Transaction:${this.name}] 回滚步骤: ${step.name}`);
        await step.rollbackStep();
        this.emit('step-rolled-back', { name: step.name });
      } catch (error) {
        logger.error(`[Transaction:${this.name}] 回滚步骤失败: ${step.name}`, error);
        rollbackErrors.push({
          step: step.name,
          error: error.message,
        });
        this.emit('step-rollback-error', { name: step.name, error });
      }
    }

    this.status = TransactionStatus.ROLLED_BACK;
    this.endTime = Date.now();

    if (rollbackErrors.length > 0) {
      logger.error(`[Transaction:${this.name}] 事务回滚完成，但有 ${rollbackErrors.length} 个步骤回滚失败`);
      this.emit('rollback-complete', {
        success: false,
        errors: rollbackErrors,
      });
      throw new Error(`事务回滚部分失败: ${JSON.stringify(rollbackErrors)}`);
    } else {
      logger.info(`[Transaction:${this.name}] 事务回滚成功`);
      this.emit('rollback-complete', { success: true });
    }
  }

  /**
   * 获取事务信息
   */
  getInfo() {
    return {
      name: this.name,
      status: this.status,
      stepCount: this.steps.length,
      completedSteps: this.steps.filter(s => s.status === StepStatus.COMPLETED).length,
      duration: this.endTime ? this.endTime - this.startTime : null,
      steps: this.steps.map(s => s.getInfo()),
      error: this.error ? this.error.message : null,
    };
  }

  /**
   * 获取最后一个步骤的结果
   */
  getLastResult() {
    if (this.steps.length === 0) {
      return null;
    }
    return this.steps[this.steps.length - 1].result;
  }

  /**
   * 获取指定步骤的结果
   */
  getStepResult(name) {
    const step = this.steps.find(s => s.name === name);
    return step ? step.result : null;
  }
}

/**
 * 创建事务管理器
 *
 * @param {string} name - 事务名称
 * @returns {TransactionManager} 事务管理器实例
 */
function createTransaction(name) {
  return new TransactionManager(name);
}

module.exports = {
  TransactionManager,
  TransactionStatus,
  StepStatus,
  createTransaction,
};
