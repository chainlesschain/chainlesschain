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
};
