/**
 * 工作流管道核心
 *
 * 管理项目创建到交付的完整流程
 *
 * 功能:
 * - 6阶段流程执行
 * - 质量门禁检查
 * - 进度事件发送
 * - 暂停/恢复/取消
 * - 错误恢复
 *
 * v0.27.0: 新建文件
 */

const { EventEmitter } = require('events');
const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const { WorkflowStateMachine, WorkflowState } = require('./workflow-state-machine.js');
const { QualityGateManager, GateStatus } = require('./quality-gate-manager.js');
const { WorkflowStageFactory, StageStatus } = require('./workflow-stage.js');
const ProgressEmitter = require('../utils/progress-emitter.js');

/**
 * 工作流管道类
 */
class WorkflowPipeline extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || `wf-${uuidv4().substring(0, 8)}`;
    this.title = options.title || '项目工作流';
    this.description = options.description || '';

    // 核心组件
    this.stateMachine = new WorkflowStateMachine(this.id);
    this.qualityGateManager = new QualityGateManager({
      llmService: options.llmService,
    });
    this.progressEmitter = options.progressEmitter || new ProgressEmitter({
      autoForwardToIPC: true,
      throttleInterval: 100,
    });

    // 阶段管理
    this.stages = [];
    this.currentStageIndex = -1;
    this.stageExecutors = options.stageExecutors || {};

    // 运行时数据
    this.input = null;
    this.context = {};
    this.results = {};
    this.logs = [];
    this.startTime = null;
    this.endTime = null;
    this.pausePromise = null;
    this.pauseResolve = null;

    // 初始化默认阶段
    this._initializeStages();

    // 监听状态机事件
    this._setupStateMachineListeners();

    // 监听质量门禁事件
    this._setupQualityGateListeners();

    logger.info(`[WorkflowPipeline] 初始化工作流: ${this.id}`);
  }

  /**
   * 初始化默认阶段
   * @private
   */
  _initializeStages() {
    this.stages = WorkflowStageFactory.createDefaultStages(this.stageExecutors);

    // 监听每个阶段的事件
    this.stages.forEach((stage, index) => {
      stage.on('stage-start', (data) => this._onStageStart(index, data));
      stage.on('stage-progress', (data) => this._onStageProgress(index, data));
      stage.on('stage-complete', (data) => this._onStageComplete(index, data));
      stage.on('stage-error', (data) => this._onStageError(index, data));
      stage.on('step-start', (data) => this._onStepStart(data));
      stage.on('step-progress', (data) => this._onStepProgress(data));
      stage.on('step-complete', (data) => this._onStepComplete(data));
      stage.on('step-error', (data) => this._onStepError(data));
    });
  }

  /**
   * 设置状态机监听器
   * @private
   */
  _setupStateMachineListeners() {
    this.stateMachine.on('state-change', (data) => {
      this._log('info', `状态变更: ${data.previousState} -> ${data.currentState}`);
      this.emit('workflow:state-change', data);
      this._emitProgress();
    });
  }

  /**
   * 设置质量门禁监听器
   * @private
   */
  _setupQualityGateListeners() {
    this.qualityGateManager.on('gate-checking', (data) => {
      this._log('info', `开始质量检查: ${data.gateName}`);
      this.emit('workflow:gate-checking', data);
    });

    this.qualityGateManager.on('check-completed', (data) => {
      this.emit('workflow:check-completed', data);
    });

    this.qualityGateManager.on('gate-completed', (data) => {
      this._log(data.passed ? 'info' : 'warn', `质量门禁${data.passed ? '通过' : '失败'}: ${data.gateName}`);
      this.emit('workflow:gate-result', data);
    });
  }

  /**
   * 注册阶段执行器
   * @param {string} stageId - 阶段ID
   * @param {Function} executor - 执行函数
   */
  registerStageExecutor(stageId, executor) {
    const stage = this.stages.find(s => s.id === stageId);
    if (stage) {
      stage.executor = executor;
    }
    this.stageExecutors[stageId] = executor;
  }

  /**
   * 执行工作流
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Object} 执行结果
   */
  async execute(input, context = {}) {
    if (!this.stateMachine.start()) {
      throw new Error('无法启动工作流，当前状态不允许');
    }

    this.input = input;
    this.context = context;
    this.startTime = Date.now();
    this.results = {};

    // 创建进度追踪器
    const tracker = this.progressEmitter.createTracker(this.id, {
      title: this.title,
      description: this.description,
      totalSteps: this.stages.length * 100,
      metadata: { type: 'workflow' },
    });

    this._log('info', '工作流开始执行');
    this.emit('workflow:start', this._getWorkflowInfo());

    let currentInput = input;

    try {
      for (let i = 0; i < this.stages.length; i++) {
        // 检查暂停状态
        await this._checkPause();

        // 检查取消状态
        if (this.stateMachine.getState() === WorkflowState.CANCELLED) {
          throw new Error('工作流已取消');
        }

        const stage = this.stages[i];
        this.currentStageIndex = i;

        // 执行阶段
        this._log('info', `开始阶段 ${i + 1}/${this.stages.length}: ${stage.name}`);
        const stageResult = await stage.execute(currentInput, this.context);
        this.results[stage.id] = stageResult;

        // 更新进度
        const overallProgress = Math.round(((i + 1) / this.stages.length) * 100);
        tracker.setPercent(overallProgress, `完成阶段: ${stage.name}`);

        // 质量门禁检查
        if (stage.qualityGateId) {
          const gateResult = await this.qualityGateManager.check(
            stage.qualityGateId,
            stageResult,
            this.context
          );

          if (!gateResult.passed && gateResult.blocking) {
            // 阻塞门禁失败
            throw new Error(`质量门禁失败: ${gateResult.message}`);
          }
        }

        // 传递给下一阶段
        currentInput = stageResult;
      }

      // 完成
      this.stateMachine.complete();
      this.endTime = Date.now();
      tracker.complete({ message: '工作流执行完成', results: this.results });

      this._log('info', '工作流执行完成');
      this.emit('workflow:complete', {
        ...this._getWorkflowInfo(),
        results: this.results,
      });

      return {
        success: true,
        workflowId: this.id,
        results: this.results,
        duration: this.endTime - this.startTime,
      };

    } catch (error) {
      this.stateMachine.fail(error.message);
      this.endTime = Date.now();
      tracker.error(error);

      this._log('error', `工作流执行失败: ${error.message}`);
      this.emit('workflow:error', {
        ...this._getWorkflowInfo(),
        error: error.message,
      });

      return {
        success: false,
        workflowId: this.id,
        error: error.message,
        failedStage: this.currentStageIndex >= 0 ? this.stages[this.currentStageIndex].id : null,
        duration: this.endTime - this.startTime,
      };
    }
  }

  /**
   * 暂停工作流
   * @returns {boolean} 是否成功
   */
  pause() {
    if (!this.stateMachine.pause()) {
      return false;
    }

    this.pausePromise = new Promise(resolve => {
      this.pauseResolve = resolve;
    });

    this._log('info', '工作流已暂停');
    this.emit('workflow:paused', this._getWorkflowInfo());
    return true;
  }

  /**
   * 恢复工作流
   * @returns {boolean} 是否成功
   */
  resume() {
    if (!this.stateMachine.resume()) {
      return false;
    }

    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
      this.pausePromise = null;
    }

    this._log('info', '工作流已恢复');
    this.emit('workflow:resumed', this._getWorkflowInfo());
    return true;
  }

  /**
   * 取消工作流
   * @param {string} reason - 取消原因
   * @returns {boolean} 是否成功
   */
  cancel(reason = '用户取消') {
    if (!this.stateMachine.cancel(reason)) {
      return false;
    }

    // 如果正在暂停，也需要解锁
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
      this.pausePromise = null;
    }

    this.endTime = Date.now();
    this._log('info', `工作流已取消: ${reason}`);
    this.emit('workflow:cancelled', {
      ...this._getWorkflowInfo(),
      reason,
    });
    return true;
  }

  /**
   * 重试失败的工作流
   * @returns {Object} 执行结果
   */
  async retry() {
    if (!this.stateMachine.retry()) {
      throw new Error('无法重试，当前状态不允许');
    }

    // 重置失败的阶段
    const failedStageIndex = this.currentStageIndex;
    for (let i = failedStageIndex; i < this.stages.length; i++) {
      this.stages[i].reset();
    }

    // 从失败点继续执行
    return this._continueFromStage(failedStageIndex);
  }

  /**
   * 从指定阶段继续执行
   * @private
   */
  async _continueFromStage(startIndex) {
    let currentInput = startIndex > 0
      ? this.results[this.stages[startIndex - 1].id]
      : this.input;

    this._log('info', `从阶段 ${startIndex + 1} 继续执行`);

    try {
      for (let i = startIndex; i < this.stages.length; i++) {
        await this._checkPause();

        if (this.stateMachine.getState() === WorkflowState.CANCELLED) {
          throw new Error('工作流已取消');
        }

        const stage = this.stages[i];
        this.currentStageIndex = i;

        const stageResult = await stage.execute(currentInput, this.context);
        this.results[stage.id] = stageResult;

        if (stage.qualityGateId) {
          const gateResult = await this.qualityGateManager.check(
            stage.qualityGateId,
            stageResult,
            this.context
          );

          if (!gateResult.passed && gateResult.blocking) {
            throw new Error(`质量门禁失败: ${gateResult.message}`);
          }
        }

        currentInput = stageResult;
      }

      this.stateMachine.complete();
      this.endTime = Date.now();

      this.emit('workflow:complete', {
        ...this._getWorkflowInfo(),
        results: this.results,
      });

      return {
        success: true,
        workflowId: this.id,
        results: this.results,
      };

    } catch (error) {
      this.stateMachine.fail(error.message);
      this.endTime = Date.now();

      this.emit('workflow:error', {
        ...this._getWorkflowInfo(),
        error: error.message,
      });

      return {
        success: false,
        workflowId: this.id,
        error: error.message,
      };
    }
  }

  /**
   * 检查暂停状态
   * @private
   */
  async _checkPause() {
    if (this.pausePromise) {
      await this.pausePromise;
    }
  }

  /**
   * 手动覆盖质量门禁
   * @param {string} gateId - 门禁ID
   * @param {string} reason - 原因
   * @returns {boolean} 是否成功
   */
  overrideQualityGate(gateId, reason = '手动覆盖') {
    return this.qualityGateManager.override(gateId, reason);
  }

  /**
   * 获取工作流状态
   * @returns {Object} 工作流状态
   */
  getStatus() {
    return this._getWorkflowInfo();
  }

  /**
   * 获取阶段列表
   * @returns {Array} 阶段信息列表
   */
  getStages() {
    return this.stages.map(stage => stage.getStatus());
  }

  /**
   * 获取质量门禁状态
   * @returns {Object} 门禁状态映射
   */
  getQualityGates() {
    return this.qualityGateManager.getAllStatuses();
  }

  /**
   * 获取执行日志
   * @param {number} limit - 限制数量
   * @returns {Array} 日志列表
   */
  getLogs(limit = 100) {
    return this.logs.slice(-limit);
  }

  /**
   * 记录日志
   * @private
   */
  _log(level, message) {
    const logEntry = {
      time: new Date().toISOString(),
      level,
      message,
    };
    this.logs.push(logEntry);

    // 保持日志数量限制
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-500);
    }

    logger[level](`[WorkflowPipeline:${this.id}] ${message}`);
  }

  /**
   * 获取工作流信息
   * @private
   */
  _getWorkflowInfo() {
    const state = this.stateMachine.getState();

    return {
      workflowId: this.id,
      title: this.title,
      timestamp: Date.now(),
      overall: {
        percent: this._calculateOverallProgress(),
        stage: this.currentStageIndex + 1,
        totalStages: this.stages.length,
        status: state,
        elapsedTime: this.startTime ? Date.now() - this.startTime : 0,
      },
      currentStage: this.currentStageIndex >= 0
        ? this.stages[this.currentStageIndex].getStatus()
        : null,
      qualityGates: this.qualityGateManager.getAllStatuses(),
      recentLogs: this.logs.slice(-10),
    };
  }

  /**
   * 计算整体进度
   * @private
   */
  _calculateOverallProgress() {
    if (this.currentStageIndex < 0) {return 0;}

    const completedWeight = this.stages
      .slice(0, this.currentStageIndex)
      .reduce((sum, s) => sum + s.estimatedWeight, 0);

    const currentStage = this.stages[this.currentStageIndex];
    const currentWeight = currentStage
      ? (currentStage.progress / 100) * currentStage.estimatedWeight
      : 0;

    const totalWeight = this.stages.reduce((sum, s) => sum + s.estimatedWeight, 0);

    return Math.round(((completedWeight + currentWeight) / totalWeight) * 100);
  }

  /**
   * 发送进度事件
   * @private
   */
  _emitProgress() {
    this.emit('workflow:progress', this._getWorkflowInfo());
  }

  // 阶段事件处理器
  _onStageStart(index, data) {
    this._log('info', `阶段开始: ${data.name}`);
    this.emit('workflow:stage-start', { ...data, stageIndex: index });
    this._emitProgress();
  }

  _onStageProgress(index, data) {
    this.emit('workflow:stage-progress', { ...data, stageIndex: index });
    this._emitProgress();
  }

  _onStageComplete(index, data) {
    this._log('info', `阶段完成: ${data.name}`);
    this.emit('workflow:stage-complete', { ...data, stageIndex: index });
    this._emitProgress();
  }

  _onStageError(index, data) {
    this._log('error', `阶段失败: ${data.name} - ${data.error}`);
    this.emit('workflow:stage-error', { ...data, stageIndex: index });
  }

  _onStepStart(data) {
    this._log('info', `步骤开始: ${data.step.name}`);
    this.emit('workflow:step-start', data);
  }

  _onStepProgress(data) {
    this.emit('workflow:step-progress', data);
    this._emitProgress();
  }

  _onStepComplete(data) {
    this._log('info', `步骤完成: ${data.step.name}`);
    this.emit('workflow:step-complete', data);
  }

  _onStepError(data) {
    this._log('error', `步骤失败: ${data.step.name} - ${data.error}`);
    this.emit('workflow:step-error', data);
  }

  /**
   * 序列化工作流
   * @returns {Object} 序列化对象
   */
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      state: this.stateMachine.toJSON(),
      currentStageIndex: this.currentStageIndex,
      stages: this.stages.map(s => s.getStatus()),
      results: this.results,
      logs: this.logs,
      startTime: this.startTime,
      endTime: this.endTime,
    };
  }
}

/**
 * 工作流管理器
 * 管理多个工作流实例
 */
class WorkflowManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.workflows = new Map();
    this.progressEmitter = options.progressEmitter;
    this.llmService = options.llmService;
    this.mainWindow = null;

    logger.info('[WorkflowManager] 初始化工作流管理器');
  }

  /**
   * 设置主窗口
   * @param {BrowserWindow} window - Electron 主窗口
   */
  setMainWindow(window) {
    this.mainWindow = window;
    if (this.progressEmitter) {
      this.progressEmitter.setMainWindow(window);
    }
  }

  /**
   * 创建工作流
   * @param {Object} options - 工作流选项
   * @returns {WorkflowPipeline} 工作流实例
   */
  createWorkflow(options = {}) {
    const workflow = new WorkflowPipeline({
      ...options,
      progressEmitter: this.progressEmitter,
      llmService: this.llmService,
    });

    this.workflows.set(workflow.id, workflow);

    // 转发工作流事件
    this._forwardWorkflowEvents(workflow);

    logger.info(`[WorkflowManager] 创建工作流: ${workflow.id}`);
    return workflow;
  }

  /**
   * 获取工作流
   * @param {string} workflowId - 工作流ID
   * @returns {WorkflowPipeline|null} 工作流实例
   */
  getWorkflow(workflowId) {
    return this.workflows.get(workflowId) || null;
  }

  /**
   * 获取所有工作流
   * @returns {Array} 工作流列表
   */
  getAllWorkflows() {
    return Array.from(this.workflows.values()).map(wf => wf.getStatus());
  }

  /**
   * 删除工作流
   * @param {string} workflowId - 工作流ID
   * @returns {boolean} 是否成功
   */
  deleteWorkflow(workflowId) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {return false;}

    // 如果正在运行，先取消
    if (workflow.stateMachine.isRunning()) {
      workflow.cancel('工作流被删除');
    }

    workflow.removeAllListeners();
    this.workflows.delete(workflowId);

    logger.info(`[WorkflowManager] 删除工作流: ${workflowId}`);
    return true;
  }

  /**
   * 转发工作流事件
   * @private
   */
  _forwardWorkflowEvents(workflow) {
    const events = [
      'workflow:start',
      'workflow:progress',
      'workflow:stage-start',
      'workflow:stage-complete',
      'workflow:stage-error',
      'workflow:step-start',
      'workflow:step-complete',
      'workflow:step-error',
      'workflow:gate-checking',
      'workflow:gate-result',
      'workflow:complete',
      'workflow:error',
      'workflow:paused',
      'workflow:resumed',
      'workflow:cancelled',
      'workflow:state-change',
    ];

    events.forEach(event => {
      workflow.on(event, (data) => {
        this.emit(event, data);

        // 转发到渲染进程
        if (this.mainWindow && this.mainWindow.webContents) {
          try {
            this.mainWindow.webContents.send(event, data);
          } catch (error) {
            logger.warn(`[WorkflowManager] IPC 转发失败: ${event}`);
          }
        }
      });
    });
  }
}

module.exports = {
  WorkflowPipeline,
  WorkflowManager,
};
