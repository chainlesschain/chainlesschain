/**
 * Browser Workflow System - Main Entry Point
 *
 * @module browser/workflow
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { WorkflowEngine, ExecutionContext, ExecutionStatus } = require('./workflow-engine');
const { WorkflowStorage } = require('./workflow-storage');
const { VariableManager, VariableScope, BuiltInPrefixes, createLoopContext } = require('./workflow-variables');
const { ControlFlowManager, StepType, ConditionOperator, LoopType, parseConditionString, parseValue } = require('./control-flow');
const { WorkflowBuilder, createWorkflow, condition, and, or, not } = require('./workflow-builder');
const {
  registerWorkflowIPC,
  initializeWorkflowSystem,
  getWorkflowEngine,
  getWorkflowStorage,
  cleanupWorkflowSystem
} = require('./workflow-ipc');

module.exports = {
  // Engine
  WorkflowEngine,
  ExecutionContext,
  ExecutionStatus,

  // Storage
  WorkflowStorage,

  // Variables
  VariableManager,
  VariableScope,
  BuiltInPrefixes,
  createLoopContext,

  // Control Flow
  ControlFlowManager,
  StepType,
  ConditionOperator,
  LoopType,
  parseConditionString,
  parseValue,

  // Builder
  WorkflowBuilder,
  createWorkflow,
  condition,
  and,
  or,
  not,

  // IPC
  registerWorkflowIPC,
  initializeWorkflowSystem,
  getWorkflowEngine,
  getWorkflowStorage,
  cleanupWorkflowSystem
};
