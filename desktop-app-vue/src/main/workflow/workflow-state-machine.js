/**
 * 工作流状态机
 *
 * 管理工作流的状态转换和生命周期
 *
 * 状态流转:
 * idle -> running -> (paused -> running) -> completed/failed/cancelled
 *
 * v0.27.0: 新建文件
 */

const { EventEmitter } = require('events');
const { logger } = require('../utils/logger.js');

/**
 * 工作流状态枚举
 */
const WorkflowState = {
  IDLE: 'idle',           // 空闲，等待启动
  RUNNING: 'running',     // 运行中
  PAUSED: 'paused',       // 已暂停
  COMPLETED: 'completed', // 已完成
  FAILED: 'failed',       // 失败
  CANCELLED: 'cancelled', // 已取消
};

/**
 * 状态转换配置
 */
const STATE_TRANSITIONS = {
  [WorkflowState.IDLE]: [WorkflowState.RUNNING, WorkflowState.CANCELLED],
  [WorkflowState.RUNNING]: [WorkflowState.PAUSED, WorkflowState.COMPLETED, WorkflowState.FAILED, WorkflowState.CANCELLED],
  [WorkflowState.PAUSED]: [WorkflowState.RUNNING, WorkflowState.CANCELLED],
  [WorkflowState.COMPLETED]: [], // 终态
  [WorkflowState.FAILED]: [WorkflowState.RUNNING], // 可重试
  [WorkflowState.CANCELLED]: [], // 终态
};

/**
 * 工作流状态机类
 */
class WorkflowStateMachine extends EventEmitter {
  constructor(workflowId) {
    super();
    this.workflowId = workflowId;
    this.state = WorkflowState.IDLE;
    this.stateHistory = [];
    this.metadata = {};

    // 记录初始状态
    this._recordStateChange(null, WorkflowState.IDLE, 'initialized');
  }

  /**
   * 获取当前状态
   * @returns {string} 当前状态
   */
  getState() {
    return this.state;
  }

  /**
   * 检查是否可以转换到目标状态
   * @param {string} targetState - 目标状态
   * @returns {boolean} 是否可转换
   */
  canTransitionTo(targetState) {
    const allowedTransitions = STATE_TRANSITIONS[this.state] || [];
    return allowedTransitions.includes(targetState);
  }

  /**
   * 转换状态
   * @param {string} targetState - 目标状态
   * @param {string} reason - 转换原因
   * @returns {boolean} 是否成功
   */
  transitionTo(targetState, reason = '') {
    if (!this.canTransitionTo(targetState)) {
      logger.warn(`[WorkflowStateMachine] Invalid transition: ${this.state} -> ${targetState}`);
      return false;
    }

    const previousState = this.state;
    this.state = targetState;

    this._recordStateChange(previousState, targetState, reason);

    // 发送状态变更事件
    this.emit('state-change', {
      workflowId: this.workflowId,
      previousState,
      currentState: targetState,
      reason,
      timestamp: Date.now(),
    });

    logger.info(`[WorkflowStateMachine] ${this.workflowId}: ${previousState} -> ${targetState} (${reason})`);

    return true;
  }

  /**
   * 启动工作流
   * @returns {boolean} 是否成功
   */
  start() {
    return this.transitionTo(WorkflowState.RUNNING, 'workflow started');
  }

  /**
   * 暂停工作流
   * @returns {boolean} 是否成功
   */
  pause() {
    return this.transitionTo(WorkflowState.PAUSED, 'workflow paused');
  }

  /**
   * 恢复工作流
   * @returns {boolean} 是否成功
   */
  resume() {
    return this.transitionTo(WorkflowState.RUNNING, 'workflow resumed');
  }

  /**
   * 完成工作流
   * @returns {boolean} 是否成功
   */
  complete() {
    return this.transitionTo(WorkflowState.COMPLETED, 'workflow completed');
  }

  /**
   * 标记工作流失败
   * @param {string} error - 错误信息
   * @returns {boolean} 是否成功
   */
  fail(error = '') {
    return this.transitionTo(WorkflowState.FAILED, `workflow failed: ${error}`);
  }

  /**
   * 取消工作流
   * @param {string} reason - 取消原因
   * @returns {boolean} 是否成功
   */
  cancel(reason = 'user cancelled') {
    return this.transitionTo(WorkflowState.CANCELLED, reason);
  }

  /**
   * 重试工作流（从失败状态）
   * @returns {boolean} 是否成功
   */
  retry() {
    if (this.state !== WorkflowState.FAILED) {
      logger.warn(`[WorkflowStateMachine] Cannot retry from state: ${this.state}`);
      return false;
    }
    return this.transitionTo(WorkflowState.RUNNING, 'workflow retried');
  }

  /**
   * 检查是否为终态
   * @returns {boolean} 是否为终态
   */
  isTerminal() {
    return [WorkflowState.COMPLETED, WorkflowState.CANCELLED].includes(this.state);
  }

  /**
   * 检查是否正在运行
   * @returns {boolean} 是否运行中
   */
  isRunning() {
    return this.state === WorkflowState.RUNNING;
  }

  /**
   * 检查是否已暂停
   * @returns {boolean} 是否已暂停
   */
  isPaused() {
    return this.state === WorkflowState.PAUSED;
  }

  /**
   * 设置元数据
   * @param {string} key - 键
   * @param {any} value - 值
   */
  setMetadata(key, value) {
    this.metadata[key] = value;
  }

  /**
   * 获取元数据
   * @param {string} key - 键
   * @returns {any} 值
   */
  getMetadata(key) {
    return this.metadata[key];
  }

  /**
   * 获取状态历史
   * @returns {Array} 状态历史
   */
  getHistory() {
    return [...this.stateHistory];
  }

  /**
   * 记录状态变更
   * @private
   */
  _recordStateChange(from, to, reason) {
    this.stateHistory.push({
      from,
      to,
      reason,
      timestamp: Date.now(),
    });
  }

  /**
   * 序列化状态机
   * @returns {Object} 序列化对象
   */
  toJSON() {
    return {
      workflowId: this.workflowId,
      state: this.state,
      stateHistory: this.stateHistory,
      metadata: this.metadata,
    };
  }

  /**
   * 从序列化对象恢复
   * @param {Object} data - 序列化对象
   * @returns {WorkflowStateMachine} 状态机实例
   */
  static fromJSON(data) {
    const machine = new WorkflowStateMachine(data.workflowId);
    machine.state = data.state;
    machine.stateHistory = data.stateHistory || [];
    machine.metadata = data.metadata || {};
    return machine;
  }
}

module.exports = {
  WorkflowStateMachine,
  WorkflowState,
  STATE_TRANSITIONS,
};
