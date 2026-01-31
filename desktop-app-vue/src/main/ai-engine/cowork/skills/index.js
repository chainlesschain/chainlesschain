/**
 * Skills 模块入口
 *
 * @module ai-engine/cowork/skills
 */

const { BaseSkill } = require('./base-skill');
const { OfficeSkill } = require('./office-skill');
const { SkillRegistry, getSkillRegistry } = require('./skill-registry');

module.exports = {
  // 基类
  BaseSkill,

  // 内置技能
  OfficeSkill,

  // 注册表
  SkillRegistry,
  getSkillRegistry,
};
