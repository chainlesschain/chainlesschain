const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/main/skill-tool-system/builtin-skills.js');
const allSkills = require(filePath);

// 更新每个技能，添加 enabled 和 is_builtin 字段，转换 config 和 tags 为 JSON 字符串
const updatedSkills = allSkills.map(skill => {
  const updated = {
    ...skill,
    enabled: 1,
    is_builtin: 1,
  };

  // 确保 tags 是 JSON 字符串
  if (Array.isArray(skill.tags)) {
    updated.tags = JSON.stringify(skill.tags);
  } else if (typeof skill.tags !== 'string') {
    updated.tags = JSON.stringify([]);
  }

  // 确保 config 是 JSON 字符串
  if (typeof skill.config === 'object' && skill.config !== null) {
    updated.config = JSON.stringify(skill.config);
  } else if (typeof skill.config !== 'string') {
    updated.config = JSON.stringify({});
  }

  return updated;
});

// 生成文件内容
const output = `/**
 * 内置技能定义
 * 定义系统内置的15个核心技能
 *
 * 注意：config 和 tags 必须是 JSON 字符串格式（符合数据库 schema）
 */

module.exports = ${JSON.stringify(updatedSkills, null, 2)};
`;

fs.writeFileSync(filePath, output, 'utf8');
console.log('✅ builtin-skills.js 已更新');
console.log('   总技能数:', updatedSkills.length);
console.log('   已添加字段: enabled=1, is_builtin=1');
console.log('   已转换为JSON字符串: config, tags');
