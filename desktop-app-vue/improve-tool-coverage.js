/**
 * Phase 3: 提高工具覆盖率
 * 将未被引用的工具智能匹配到合适的技能
 */

const fs = require('fs');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  Phase 3: 提高工具覆盖率                                ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 加载技能和工具
const skills = require('./src/main/skill-tool-system/builtin-skills.js');
const tools = require('./src/main/skill-tool-system/builtin-tools.js');

// 统计当前工具引用情况
const usedTools = new Set();
skills.forEach(skill => {
  if (skill.tools) {
    skill.tools.forEach(tool => usedTools.add(tool));
  }
});

const unusedTools = tools.filter(t => !usedTools.has(t.name));

console.log(`总工具数: ${tools.length}`);
console.log(`已被引用: ${usedTools.size} (${(usedTools.size/tools.length*100).toFixed(1)}%)`);
console.log(`未被引用: ${unusedTools.length} (${(unusedTools.length/tools.length*100).toFixed(1)}%)\n`);

// 定义技能类别与工具类别的映射关系
const categoryMappings = {
  'code': ['code', 'file', 'text', 'utility', 'version-control'],
  'web': ['web', 'network', 'html', 'css', 'javascript', 'api'],
  'data': ['data', 'data-science', 'database', 'format'],
  'content': ['text', 'document', 'format', 'markdown'],
  'document': ['document', 'office', 'pdf', 'format'],
  'media': ['media', 'image', 'video', 'audio'],
  'project': ['project', 'file', 'version-control', 'utility'],
  'ai': ['ai', 'ml', 'nlp', 'text'],
  'template': ['template', 'format', 'html', 'file'],
  'system': ['system', 'file', 'utility', 'process'],
  'network': ['network', 'api', 'http', 'websocket'],
  'automation': ['automation', 'system', 'file', 'utility'],
  'office': ['office', 'document', 'excel', 'word', 'ppt'],
  'database': ['database', 'sql', 'data'],
  'backend': ['backend', 'api', 'database', 'server'],
  'design': ['design', 'image', 'media', 'ui'],
  'quality': ['quality', 'test', 'code'],
  'devops': ['devops', 'ci-cd', 'docker', 'deployment'],
  'legal': ['legal', 'document', 'office'],
  'business': ['business', 'office', 'data'],
  'management': ['management', 'project', 'office'],
  'hr': ['hr', 'office', 'document'],
  'marketing': ['marketing', 'content', 'data', 'social-media'],
  'finance': ['finance', 'data', 'office', 'calculation'],
  'blockchain': ['blockchain', 'crypto', 'security']
};

// 为每个技能智能匹配工具
const skillToolAdditions = {};

unusedTools.forEach(tool => {
  // 为该工具查找匹配的技能
  skills.forEach(skill => {
    const matchingCategories = categoryMappings[skill.category] || [];

    // 检查工具类别是否匹配技能类别
    const categoryMatch = matchingCategories.includes(tool.category);

    // 检查工具名称或描述是否与技能相关
    const toolNameLower = tool.name.toLowerCase();
    const skillNameLower = skill.name.toLowerCase();
    const skillDescLower = (skill.description || '').toLowerCase();

    // 简单的关键词匹配
    const keywordMatch =
      skillNameLower.includes(toolNameLower.split('_')[0]) ||
      toolNameLower.includes(skillNameLower.split(/\s+/)[0]) ||
      skillDescLower.includes(toolNameLower.split('_').join(''));

    if (categoryMatch || keywordMatch) {
      if (!skillToolAdditions[skill.id]) {
        skillToolAdditions[skill.id] = [];
      }
      skillToolAdditions[skill.id].push(tool.name);
    }
  });
});

// 显示匹配结果
console.log('═══ 工具匹配结果 ===\n');

let totalAdditions = 0;
Object.entries(skillToolAdditions).forEach(([skillId, toolNames]) => {
  const skill = skills.find(s => s.id === skillId);
  console.log(`${skill.name} (${skill.category}):`);
  console.log(`  将添加 ${toolNames.length} 个工具`);
  console.log(`  工具: ${toolNames.slice(0, 5).join(', ')}${toolNames.length > 5 ? '...' : ''}`);
  console.log('');

  totalAdditions += toolNames.length;
});

console.log(`总计将添加 ${totalAdditions} 个工具引用\n`);

// 应用到技能文件
console.log('═══ 应用工具添加 ===\n');

const builtinSkillsPath = './src/main/skill-tool-system/builtin-skills.js';
let content = fs.readFileSync(builtinSkillsPath, 'utf-8');

// 备份
const backupPath = builtinSkillsPath + '.backup-coverage-' + Date.now();
fs.writeFileSync(backupPath, content);
console.log(`📦 已备份到: ${backupPath}\n`);

let modificationsCount = 0;

Object.entries(skillToolAdditions).forEach(([skillId, toolNames]) => {
  const skill = skills.find(s => s.id === skillId);
  if (!skill) return;

  // 获取该技能已有的工具
  const existingTools = skill.tools || [];

  // 合并工具（去重）
  const allTools = [...new Set([...existingTools, ...toolNames])];

  // 构建工具数组字符串
  const toolsArrayStr = allTools.map(t => `"${t}"`).join(',\n      ');

  // 查找并替换技能的tools数组
  const toolsPattern = new RegExp(
    `("id":\\s*"${skillId}"[\\s\\S]*?"tools":\\s*)\\[[^\\]]*\\]`,
    'g'
  );

  const replacement = `$1[\n      ${toolsArrayStr}\n    ]`;

  if (toolsPattern.test(content)) {
    content = content.replace(toolsPattern, replacement);
    modificationsCount++;
    console.log(`✓ ${skill.name}: ${existingTools.length} → ${allTools.length} 个工具 (+${toolNames.length})`);
  } else {
    console.log(`✗ ${skill.name}: 未找到匹配的技能定义`);
  }
});

console.log(`\n成功修改 ${modificationsCount} 个技能\n`);

// 保存修改
fs.writeFileSync(builtinSkillsPath, content);

console.log('═══════════════════════════════════════════════════════════');
console.log(`✅ 已为 ${modificationsCount} 个技能添加工具`);
console.log('═══════════════════════════════════════════════════════════\n');
console.log(`📝 已更新: ${builtinSkillsPath}\n`);

// 验证结果
console.log('═══ 验证结果 ===\n');

try {
  delete require.cache[require.resolve(builtinSkillsPath)];
  const updatedSkills = require(builtinSkillsPath);

  const updatedUsedTools = new Set();
  updatedSkills.forEach(skill => {
    if (skill.tools) {
      skill.tools.forEach(tool => updatedUsedTools.add(tool));
    }
  });

  const updatedUnusedTools = tools.filter(t => !updatedUsedTools.has(t.name));

  console.log(`技能总数: ${updatedSkills.length}`);
  console.log(`工具被引用: ${updatedUsedTools.size}/${tools.length} (${(updatedUsedTools.size/tools.length*100).toFixed(1)}%)`);
  console.log(`工具未被引用: ${updatedUnusedTools.length} (${(updatedUnusedTools.length/tools.length*100).toFixed(1)}%)`);

  // 计算总工具引用数
  let totalToolRefs = 0;
  updatedSkills.forEach(skill => {
    if (skill.tools) {
      totalToolRefs += skill.tools.length;
    }
  });

  console.log(`\n总工具引用数: ${totalToolRefs}`);
  console.log(`平均每技能: ${(totalToolRefs/updatedSkills.length).toFixed(1)}个工具\n`);

  // 保存报告
  const report = {
    timestamp: new Date().toISOString(),
    before: {
      toolsCovered: usedTools.size,
      toolsUncovered: unusedTools.length,
      coverageRate: `${(usedTools.size/tools.length*100).toFixed(1)}%`
    },
    after: {
      toolsCovered: updatedUsedTools.size,
      toolsUncovered: updatedUnusedTools.length,
      coverageRate: `${(updatedUsedTools.size/tools.length*100).toFixed(1)}%`
    },
    improvement: {
      toolsAdded: updatedUsedTools.size - usedTools.size,
      coverageIncrease: `${((updatedUsedTools.size - usedTools.size) / tools.length * 100).toFixed(1)}%`
    }
  };

  fs.writeFileSync('./tool-coverage-improvement-report.json', JSON.stringify(report, null, 2));
  console.log('📄 详细报告已保存到: tool-coverage-improvement-report.json\n');

} catch (error) {
  console.error(`❌ 验证失败: ${error.message}`);
  console.log(`\n正在恢复备份...`);
  fs.writeFileSync(builtinSkillsPath, fs.readFileSync(backupPath, 'utf-8'));
  console.log(`✅ 已恢复到备份版本`);
}
