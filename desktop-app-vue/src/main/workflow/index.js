/**
 * 工作流模块入口
 *
 * 导出所有工作流相关组件
 *
 * v0.27.0: 新建文件
 */

const { WorkflowPipeline, WorkflowManager } = require('./workflow-pipeline.js');
const { WorkflowStateMachine, WorkflowState, STATE_TRANSITIONS } = require('./workflow-state-machine.js');
const { QualityGateManager, GateStatus, DEFAULT_QUALITY_GATES, CHECK_EXECUTORS } = require('./quality-gate-manager.js');
const { WorkflowStage, WorkflowStageFactory, StageStatus, DEFAULT_STAGES } = require('./workflow-stage.js');
const { WorkflowIPC, registerWorkflowIPC } = require('./workflow-ipc.js');

module.exports = {
  // 核心类
  WorkflowPipeline,
  WorkflowManager,
  WorkflowStateMachine,
  QualityGateManager,
  WorkflowStage,
  WorkflowStageFactory,
  WorkflowIPC,

  // 工厂函数
  registerWorkflowIPC,

  // 枚举与常量
  WorkflowState,
  GateStatus,
  StageStatus,
  STATE_TRANSITIONS,
  DEFAULT_QUALITY_GATES,
  DEFAULT_STAGES,
  CHECK_EXECUTORS,
};
