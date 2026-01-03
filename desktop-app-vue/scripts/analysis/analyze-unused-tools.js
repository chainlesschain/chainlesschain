/**
 * 分析剩余的未被引用工具
 * 为创建专门技能做准备
 */

const fs = require('fs');
const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const skills = require('./src/main/skill-tool-system/builtin-skills.js');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  分析未被引用的工具                                     ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 统计已被引用的工具
const usedTools = new Set();
skills.forEach(skill => {
  if (skill.tools) {
    skill.tools.forEach(tool => usedTools.add(tool));
  }
});

// 找出未被引用的工具
const unusedTools = tools.filter(t => !usedTools.has(t.name));

console.log(`总工具数: ${tools.length}`);
console.log(`已被引用: ${usedTools.size} (${(usedTools.size/tools.length*100).toFixed(1)}%)`);
console.log(`未被引用: ${unusedTools.length} (${(unusedTools.length/tools.length*100).toFixed(1)}%)\n`);

// 按类别分组
const categoryGroups = {};
unusedTools.forEach(tool => {
  if (!categoryGroups[tool.category]) {
    categoryGroups[tool.category] = [];
  }
  categoryGroups[tool.category].push(tool);
});

console.log('═══ 未被引用工具按类别分布 ===\n');

const sortedCategories = Object.entries(categoryGroups)
  .sort((a, b) => b[1].length - a[1].length);

sortedCategories.forEach(([category, tools]) => {
  console.log(`${category}: ${tools.length}个工具`);
  tools.forEach(tool => {
    console.log(`  - ${tool.name}: ${tool.display_name}`);
  });
  console.log('');
});

// 生成技能建议
console.log('═══ 技能创建建议 ===\n');

const skillSuggestions = [];

// 策略1: 为每个有2+工具的类别创建技能
sortedCategories.forEach(([category, tools]) => {
  if (tools.length >= 2) {
    const categoryNameMap = {
      'security': '安全与加密',
      'storage': '云存储管理',
      'config': '配置文件处理',
      'email': '邮件处理',
      'messaging': '即时通讯',
      'location': '地理位置服务',
      'hardware': '硬件控制',
      'event': '事件处理',
      'procurement': '采购管理',
      'crm': '客户关系管理',
      'audit': '审计与合规',
      'analysis': '分析与报告',
      'legal': '法律文档',
      'energy': '能源管理',
      'productivity': '生产力工具',
      'encoding': '编码转换',
      'utility': '实用工具集',
      'version-control': 'Git版本控制',
      'devops': 'DevOps工具链',
      'hr': '人力资源'
    };

    const skillName = categoryNameMap[category] || category;
    const iconMap = {
      'security': 'lock',
      'storage': 'cloud',
      'config': 'setting',
      'email': 'mail',
      'messaging': 'message',
      'location': 'environment',
      'hardware': 'desktop',
      'event': 'calendar',
      'procurement': 'shopping-cart',
      'crm': 'team',
      'audit': 'audit',
      'analysis': 'bar-chart',
      'legal': 'file-text',
      'energy': 'thunderbolt',
      'productivity': 'rocket',
      'encoding': 'code',
      'utility': 'tool',
      'version-control': 'branches',
      'devops': 'build',
      'hr': 'user'
    };

    skillSuggestions.push({
      id: `skill_${category}_tools`,
      name: skillName,
      display_name: skillName,
      category: category,
      icon: iconMap[category] || 'tool',
      tools: tools.map(t => t.name),
      toolCount: tools.length,
      description: `提供${skillName}相关的${tools.length}个专业工具`
    });
  }
});

// 策略2: 为单个工具但功能重要的创建组合技能
const singleTools = sortedCategories
  .filter(([_, tools]) => tools.length === 1)
  .map(([_, tools]) => tools[0]);

if (singleTools.length > 0) {
  // 按功能相似性分组
  const miscTools = singleTools.filter(t =>
    !['security', 'storage', 'config'].includes(t.category)
  );

  if (miscTools.length >= 3) {
    skillSuggestions.push({
      id: 'skill_misc_utilities',
      name: '其他实用工具',
      display_name: 'Miscellaneous Utilities',
      category: 'utility',
      icon: 'tool',
      tools: miscTools.map(t => t.name),
      toolCount: miscTools.length,
      description: `提供${miscTools.length}个专业领域的实用工具`
    });
  }
}

console.log(`建议创建 ${skillSuggestions.length} 个新技能:\n`);

skillSuggestions.forEach((suggestion, idx) => {
  console.log(`${idx + 1}. ${suggestion.name} (${suggestion.category})`);
  console.log(`   ID: ${suggestion.id}`);
  console.log(`   工具数: ${suggestion.toolCount}`);
  console.log(`   工具列表: ${suggestion.tools.slice(0, 3).join(', ')}${suggestion.tools.length > 3 ? '...' : ''}`);
  console.log('');
});

// 计算预期覆盖率
const newToolsCovered = skillSuggestions.reduce((sum, s) => sum + s.toolCount, 0);
const expectedCoverage = ((usedTools.size + newToolsCovered) / tools.length * 100).toFixed(1);

console.log('═══ 预期效果 ===\n');
console.log(`新增技能数: ${skillSuggestions.length}`);
console.log(`新增覆盖工具数: ${newToolsCovered}`);
console.log(`当前覆盖率: ${(usedTools.size/tools.length*100).toFixed(1)}%`);
console.log(`预期覆盖率: ${expectedCoverage}%`);
console.log(`提升: +${(expectedCoverage - (usedTools.size/tools.length*100)).toFixed(1)}%\n`);

// 保存分析结果
const report = {
  timestamp: new Date().toISOString(),
  currentCoverage: {
    totalTools: tools.length,
    usedTools: usedTools.size,
    unusedTools: unusedTools.length,
    coverageRate: `${(usedTools.size/tools.length*100).toFixed(1)}%`
  },
  unusedToolsByCategory: Object.fromEntries(
    sortedCategories.map(([cat, tools]) => [cat, tools.map(t => ({
      name: t.name,
      display_name: t.display_name,
      description: t.description
    }))])
  ),
  skillSuggestions: skillSuggestions,
  expectedCoverage: {
    newSkills: skillSuggestions.length,
    newToolsCovered: newToolsCovered,
    expectedCoverageRate: `${expectedCoverage}%`,
    improvement: `+${(expectedCoverage - (usedTools.size/tools.length*100)).toFixed(1)}%`
  }
};

fs.writeFileSync('./unused-tools-analysis.json', JSON.stringify(report, null, 2));

console.log('📄 详细报告已保存到: unused-tools-analysis.json\n');
