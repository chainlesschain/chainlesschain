/**
 * Skills 模块入口
 *
 * @module ai-engine/cowork/skills
 */

const { BaseSkill } = require("./base-skill");
const { OfficeSkill } = require("./office-skill");
const { SkillRegistry, getSkillRegistry } = require("./skill-registry");
const { SkillMdParser } = require("./skill-md-parser");
const { SkillLoader, LAYER_PRIORITY } = require("./skill-loader");
const { SkillGating } = require("./skill-gating");
const { MarkdownSkill } = require("./markdown-skill");
const { registerSkillsIPC, unregisterSkillsIPC } = require("./skills-ipc");

// v1.1.0: Pipeline, Metrics, Workflow
const {
  SkillPipelineEngine,
  StepType,
  PipelineState,
} = require("./skill-pipeline-engine");
const { SkillMetricsCollector } = require("./skill-metrics-collector");
const {
  PIPELINE_TEMPLATES,
  getTemplates,
  getTemplateById,
  getTemplatesByCategory,
} = require("./pipeline-templates");
const { registerSkillPipelineIPC } = require("./skill-pipeline-ipc");
const { registerSkillMetricsIPC } = require("./skill-metrics-ipc");
const { SkillWorkflowEngine, NodeType } = require("./skill-workflow-engine");
const { registerSkillWorkflowIPC } = require("./skill-workflow-ipc");

module.exports = {
  // 基类
  BaseSkill,

  // 内置技能
  OfficeSkill,

  // 注册表
  SkillRegistry,
  getSkillRegistry,

  // SKILL.md 支持
  SkillMdParser,
  SkillLoader,
  SkillGating,
  MarkdownSkill,
  LAYER_PRIORITY,

  // IPC 处理器
  registerSkillsIPC,
  unregisterSkillsIPC,

  // v1.1.0: Pipeline Engine
  SkillPipelineEngine,
  StepType,
  PipelineState,
  SkillMetricsCollector,
  PIPELINE_TEMPLATES,
  getTemplates,
  getTemplateById,
  getTemplatesByCategory,
  registerSkillPipelineIPC,
  registerSkillMetricsIPC,

  // v1.1.0: Workflow Engine
  SkillWorkflowEngine,
  NodeType,
  registerSkillWorkflowIPC,
};
