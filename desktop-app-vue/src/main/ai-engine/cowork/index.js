/**
 * Cowork 模块 - Claude Cowork 风格的多代理协作系统
 *
 * @module ai-engine/cowork
 */

const { TeammateTool, TeamStatus, AgentStatus } = require('./teammate-tool');
const { FileSandbox, Permission } = require('./file-sandbox');
const { LongRunningTaskManager, TaskStatus } = require('./long-running-task-manager');
const {
  BaseSkill,
  OfficeSkill,
  SkillRegistry,
  getSkillRegistry,
} = require('./skills');

module.exports = {
  // 核心工具
  TeammateTool,
  FileSandbox,
  LongRunningTaskManager,

  // 状态常量
  TeamStatus,
  AgentStatus,
  TaskStatus,
  Permission,

  // Skills 系统
  BaseSkill,
  OfficeSkill,
  SkillRegistry,
  getSkillRegistry,
};
