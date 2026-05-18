/**
 * 分析技能系统现状
 */

const skills = require('./src/main/skill-tool-system/builtin-skills.js');
const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const fs = require('fs');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  技能系统现状分析                                       ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 1. 技能基础统计
console.log('═══ 1. 技能基础统计 ===\n');
console.log(`技能总数: ${skills.length}`);

const categoryStats = {};
skills.forEach(skill => {
  categoryStats[skill.category] = (categoryStats[skill.category] || 0) + 1;
});

console.log('\n技能按类别分布:');
Object.entries(categoryStats)
  .sort((a, b) => b[1] - a[1])
  .forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}个`);
  });

// 2. 技能-工具关联分析
console.log('\n\n═══ 2. 技能-工具关联分析 ===\n');

const toolsMap = new Map(tools.map(t => [t.name, t]));
let totalToolRefs = 0;
let validToolRefs = 0;
let invalidToolRefs = 0;
const missingTools = new Set();
const skillToolCounts = [];

skills.forEach(skill => {
  const toolCount = skill.tools ? skill.tools.length : 0;
  skillToolCounts.push({ id: skill.id, name: skill.name, count: toolCount });

  if (skill.tools) {
    totalToolRefs += skill.tools.length;
    skill.tools.forEach(toolName => {
      if (toolsMap.has(toolName)) {
        validToolRefs++;
      } else {
        invalidToolRefs++;
        missingTools.add(toolName);
      }
    });
  }
});

console.log(`技能总工具引用数: ${totalToolRefs}`);
console.log(`有效工具引用: ${validToolRefs} (${(validToolRefs/totalToolRefs*100).toFixed(1)}%)`);
console.log(`无效工具引用: ${invalidToolRefs} (${(invalidToolRefs/totalToolRefs*100).toFixed(1)}%)`);
console.log(`平均每技能引用工具: ${(totalToolRefs/skills.length).toFixed(1)}个`);

if (missingTools.size > 0) {
  console.log(`\n缺失的工具 (${missingTools.size}个):`);
  Array.from(missingTools).slice(0, 10).forEach(tool => {
    console.log(`  - ${tool}`);
  });
  if (missingTools.size > 10) {
    console.log(`  ... 还有 ${missingTools.size - 10} 个`);
  }
}

// 工具引用最多和最少的技能
skillToolCounts.sort((a, b) => b.count - a.count);
console.log('\n工具引用最多的技能 (前5):');
skillToolCounts.slice(0, 5).forEach((s, i) => {
  console.log(`  ${i + 1}. ${s.name}: ${s.count}个工具`);
});

console.log('\n工具引用最少的技能 (后5):');
skillToolCounts.slice(-5).forEach((s, i) => {
  console.log(`  ${i + 1}. ${s.name}: ${s.count}个工具`);
});

// 3. 技能配置分析
console.log('\n\n═══ 3. 技能配置分析 ===\n');

let hasConfig = 0;
let hasTags = 0;
let hasDocPath = 0;
let hasIcon = 0;
let hasDescription = 0;

const configIssues = [];

skills.forEach(skill => {
  if (skill.config) hasConfig++;
  if (skill.tags) hasTags++;
  if (skill.doc_path) hasDocPath++;
  if (skill.icon) hasIcon++;
  if (skill.description) hasDescription++;

  // 检查配置问题
  if (!skill.description || skill.description.trim() === '') {
    configIssues.push(`${skill.id}: 缺少description`);
  }
  if (!skill.tools || skill.tools.length === 0) {
    configIssues.push(`${skill.id}: 没有关联工具`);
  }
  if (skill.config) {
    try {
      JSON.parse(skill.config);
    } catch (e) {
      configIssues.push(`${skill.id}: config不是有效JSON`);
    }
  }
  if (skill.tags) {
    try {
      JSON.parse(skill.tags);
    } catch (e) {
      configIssues.push(`${skill.id}: tags不是有效JSON`);
    }
  }
});

console.log(`有配置(config): ${hasConfig}/${skills.length} (${(hasConfig/skills.length*100).toFixed(1)}%)`);
console.log(`有标签(tags): ${hasTags}/${skills.length} (${(hasTags/skills.length*100).toFixed(1)}%)`);
console.log(`有文档路径: ${hasDocPath}/${skills.length} (${(hasDocPath/skills.length*100).toFixed(1)}%)`);
console.log(`有图标: ${hasIcon}/${skills.length} (${(hasIcon/skills.length*100).toFixed(1)}%)`);
console.log(`有描述: ${hasDescription}/${skills.length} (${(hasDescription/skills.length*100).toFixed(1)}%)`);

if (configIssues.length > 0) {
  console.log(`\n配置问题 (${configIssues.length}个):`);
  configIssues.slice(0, 10).forEach(issue => {
    console.log(`  - ${issue}`);
  });
  if (configIssues.length > 10) {
    console.log(`  ... 还有 ${configIssues.length - 10} 个`);
  }
}

// 4. 技能启用状态
console.log('\n\n═══ 4. 技能启用状态 ===\n');

const enabledSkills = skills.filter(s => s.enabled === 1 || s.enabled === true);
const disabledSkills = skills.filter(s => s.enabled === 0 || s.enabled === false);
const builtinSkills = skills.filter(s => s.is_builtin === 1 || s.is_builtin === true);

console.log(`已启用技能: ${enabledSkills.length}/${skills.length} (${(enabledSkills.length/skills.length*100).toFixed(1)}%)`);
console.log(`已禁用技能: ${disabledSkills.length}/${skills.length} (${(disabledSkills.length/skills.length*100).toFixed(1)}%)`);
console.log(`内置技能: ${builtinSkills.length}/${skills.length} (${(builtinSkills.length/skills.length*100).toFixed(1)}%)`);

// 5. 工具覆盖率分析
console.log('\n\n═══ 5. 工具覆盖率分析 ===\n');

const usedTools = new Set();
skills.forEach(skill => {
  if (skill.tools) {
    skill.tools.forEach(tool => usedTools.add(tool));
  }
});

const unusedTools = tools.filter(t => !usedTools.has(t.name));

console.log(`总工具数: ${tools.length}`);
console.log(`被技能引用的工具: ${usedTools.size} (${(usedTools.size/tools.length*100).toFixed(1)}%)`);
console.log(`未被引用的工具: ${unusedTools.length} (${(unusedTools.length/tools.length*100).toFixed(1)}%)`);

if (unusedTools.length > 0) {
  console.log(`\n未被引用的工具 (前10):)`);
  unusedTools.slice(0, 10).forEach(tool => {
    console.log(`  - ${tool.name} (${tool.category})`);
  });
  if (unusedTools.length > 10) {
    console.log(`  ... 还有 ${unusedTools.length - 10} 个`);
  }
}

// 6. 重复工具引用分析
console.log('\n\n═══ 6. 工具引用频率 ===\n');

const toolRefCount = new Map();
skills.forEach(skill => {
  if (skill.tools) {
    skill.tools.forEach(tool => {
      toolRefCount.set(tool, (toolRefCount.get(tool) || 0) + 1);
    });
  }
});

const sortedToolRefs = Array.from(toolRefCount.entries())
  .sort((a, b) => b[1] - a[1]);

console.log('引用最多的工具 (前10):');
sortedToolRefs.slice(0, 10).forEach(([tool, count]) => {
  console.log(`  ${tool}: 被${count}个技能引用`);
});

// 生成报告
const report = {
  timestamp: new Date().toISOString(),
  summary: {
    totalSkills: skills.length,
    totalTools: tools.length,
    totalToolReferences: totalToolRefs,
    validToolReferences: validToolRefs,
    invalidToolReferences: invalidToolRefs,
    avgToolsPerSkill: (totalToolRefs / skills.length).toFixed(1),
    toolCoverageRate: ((usedTools.size / tools.length) * 100).toFixed(1) + '%',
    missingToolsCount: missingTools.size,
    unusedToolsCount: unusedTools.length,
    configIssuesCount: configIssues.length
  },
  categoryDistribution: categoryStats,
  missingTools: Array.from(missingTools),
  unusedTools: unusedTools.map(t => ({ name: t.name, category: t.category })),
  configIssues: configIssues,
  topReferencedTools: sortedToolRefs.slice(0, 20).map(([tool, count]) => ({ tool, count }))
};

fs.writeFileSync('./skill-system-analysis.json', JSON.stringify(report, null, 2));

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log('✅ 分析完成！');
console.log('📄 详细报告已保存到: skill-system-analysis.json');
console.log('═══════════════════════════════════════════════════════════\n');
