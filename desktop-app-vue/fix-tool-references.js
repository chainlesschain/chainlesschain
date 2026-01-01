/**
 * Phase 1: 修复无效工具引用
 * 自动映射和修正技能中的工具引用
 */

const fs = require('fs');
const skills = require('./src/main/skill-tool-system/builtin-skills.js');
const tools = require('./src/main/skill-tool-system/builtin-tools.js');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  Phase 1: 修复无效工具引用                              ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 创建工具名称映射
const toolsMap = new Map(tools.map(t => [t.name, t]));
const toolNamesLower = new Map(tools.map(t => [t.name.toLowerCase(), t.name]));

// 缺失工具列表
const missingTools = new Set();
const toolNameMappings = new Map();

// 第一步：识别所有缺失的工具
console.log('═══ 步骤1: 识别缺失工具 ===\n');

skills.forEach(skill => {
  if (skill.tools) {
    skill.tools.forEach(toolName => {
      if (!toolsMap.has(toolName)) {
        missingTools.add(toolName);
      }
    });
  }
});

console.log(`发现 ${missingTools.size} 个缺失的工具引用\n`);

// 第二步：创建工具名称映射
console.log('═══ 步骤2: 创建工具名称映射 ===\n');

missingTools.forEach(missingTool => {
  let mappedTool = null;

  // 策略1: 移除tool_前缀
  if (missingTool.startsWith('tool_')) {
    const withoutPrefix = missingTool.substring(5); // 移除'tool_'
    if (toolsMap.has(withoutPrefix)) {
      mappedTool = withoutPrefix;
    } else if (toolNamesLower.has(withoutPrefix.toLowerCase())) {
      mappedTool = toolNamesLower.get(withoutPrefix.toLowerCase());
    }
  }

  // 策略2: 直接查找（不区分大小写）
  if (!mappedTool && toolNamesLower.has(missingTool.toLowerCase())) {
    mappedTool = toolNamesLower.get(missingTool.toLowerCase());
  }

  // 策略3: 模糊匹配（查找包含关键词的工具）
  if (!mappedTool) {
    const keywords = missingTool.replace(/^tool_/, '').replace(/_/g, ' ').split(' ');
    for (const [toolName, tool] of toolsMap.entries()) {
      const toolNameLower = toolName.toLowerCase();
      const matchCount = keywords.filter(kw => toolNameLower.includes(kw.toLowerCase())).length;
      if (matchCount >= keywords.length / 2) { // 至少匹配50%关键词
        mappedTool = toolName;
        break;
      }
    }
  }

  if (mappedTool) {
    toolNameMappings.set(missingTool, mappedTool);
    console.log(`✓ ${missingTool} → ${mappedTool}`);
  } else {
    console.log(`✗ ${missingTool} → 未找到匹配`);
  }
});

console.log(`\n成功映射: ${toolNameMappings.size}/${missingTools.size} (${(toolNameMappings.size/missingTools.size*100).toFixed(1)}%)\n`);

// 第三步：应用工具名称修正
console.log('═══ 步骤3: 应用工具名称修正 ===\n');

let totalReplacements = 0;

skills.forEach(skill => {
  if (skill.tools) {
    skill.tools = skill.tools.map(toolName => {
      if (toolNameMappings.has(toolName)) {
        totalReplacements++;
        return toolNameMappings.get(toolName);
      }
      return toolName;
    });
  }
});

console.log(`替换了 ${totalReplacements} 个工具引用\n`);

// 第四步：验证修正结果
console.log('═══ 步骤4: 验证修正结果 ===\n');

let validRefs = 0;
let invalidRefs = 0;
const stillMissingTools = new Set();

skills.forEach(skill => {
  if (skill.tools) {
    skill.tools.forEach(toolName => {
      if (toolsMap.has(toolName)) {
        validRefs++;
      } else {
        invalidRefs++;
        stillMissingTools.add(toolName);
      }
    });
  }
});

console.log(`有效工具引用: ${validRefs}`);
console.log(`无效工具引用: ${invalidRefs}`);
console.log(`修正率: ${(totalReplacements/(totalReplacements+invalidRefs)*100).toFixed(1)}%\n`);

if (stillMissingTools.size > 0) {
  console.log(`仍然缺失的工具 (${stillMissingTools.size}个):`);
  Array.from(stillMissingTools).slice(0, 20).forEach(tool => {
    console.log(`  - ${tool}`);
  });
  if (stillMissingTools.size > 20) {
    console.log(`  ... 还有 ${stillMissingTools.size - 20} 个`);
  }
  console.log('');
}

// 第五步：序列化并保存
console.log('═══ 步骤5: 保存修正结果 ===\n');

// 备份原文件
const builtinSkillsPath = './src/main/skill-tool-system/builtin-skills.js';
const backupPath = builtinSkillsPath + '.backup-fix-tools-' + Date.now();
const originalContent = fs.readFileSync(builtinSkillsPath, 'utf-8');
fs.writeFileSync(backupPath, originalContent);
console.log(`📦 已备份原文件到: ${backupPath}\n`);

// 序列化技能数组
function serializeSkills(skills) {
  const lines = [
    '/**',
    ' * 内置技能定义',
    ' * 定义系统内置的技能',
    ' *',
    ' * 注意：config 和 tags 必须是 JSON 字符串格式（符合数据库 schema）',
    ' */',
    '',
    '',
    '// 导入额外的技能定义',
    'const additionalSkills = require(\'./additional-skills\');',
    'const additionalSkillsV3 = require(\'./additional-skills-v3\');',
    '',
    'const builtinSkills = ['
  ];

  skills.forEach((skill, skillIdx) => {
    lines.push('  {');
    const fields = ['id', 'name', 'display_name', 'description', 'category', 'icon', 'tags', 'config', 'doc_path', 'tools', 'enabled', 'is_builtin'];

    fields.forEach((field, fieldIdx) => {
      if (skill[field] !== undefined) {
        const value = skill[field];
        const valueStr = serializeValue(value, 2);
        const comma = fieldIdx < fields.length - 1 && hasMoreFields(skill, fields, fieldIdx) ? ',' : '';
        lines.push(`    "${field}": ${valueStr}${comma}`);
      }
    });

    const skillComma = skillIdx < skills.length - 1 ? ',' : '';
    lines.push(`  }${skillComma}`);
  });

  lines.push('];', '', '// 合并所有技能', 'const allSkills = [...builtinSkills, ...additionalSkills, ...additionalSkillsV3];', '', 'module.exports = allSkills;');
  return lines.join('\n');
}

function hasMoreFields(obj, fields, currentIdx) {
  for (let i = currentIdx + 1; i < fields.length; i++) {
    if (obj[fields[i]] !== undefined) return true;
  }
  return false;
}

function serializeValue(value, indentLevel) {
  const indent = '  '.repeat(indentLevel);
  const innerIndent = '  '.repeat(indentLevel + 1);

  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  if (typeof value === 'string') {
    if (value.includes('\n') || value.includes('"')) {
      return '`' + value.replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/\\/g, '\\\\') + '`';
    }
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const isSimple = value.every(v => typeof v === 'string');
    if (isSimple && value.length <= 5) {
      const items = value.map(v => serializeValue(v, indentLevel));
      return `[${items.join(', ')}]`;
    }
    const lines = ['['];
    value.forEach((item, idx) => {
      const itemStr = serializeValue(item, indentLevel + 1);
      const comma = idx < value.length - 1 ? ',' : '';
      lines.push(`${innerIndent}${itemStr}${comma}`);
    });
    lines.push(`${indent}]`);
    return lines.join('\n');
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const lines = ['{'];
    keys.forEach((key, idx) => {
      const val = value[key];
      const valStr = serializeValue(val, indentLevel + 1);
      const comma = idx < keys.length - 1 ? ',' : '';
      lines.push(`${innerIndent}"${key}": ${valStr}${comma}`);
    });
    lines.push(`${indent}}`);
    return lines.join('\n');
  }

  return 'null';
}

console.log('正在序列化技能数组...');

// 只序列化原始的15个内置技能，不包括additional skills
const originalBuiltinSkills = skills.slice(0, 15);
const newContent = serializeSkills(originalBuiltinSkills);

fs.writeFileSync(builtinSkillsPath, newContent);

console.log('═══════════════════════════════════════════════════════════');
console.log(`✅ 成功修正 ${totalReplacements} 个工具引用`);
console.log('═══════════════════════════════════════════════════════════\n');
console.log(`📝 已更新: ${builtinSkillsPath}`);
console.log(`📦 备份文件: ${backupPath}\n`);

// 验证生成的文件
console.log('验证生成的文件...');
try {
  delete require.cache[require.resolve(builtinSkillsPath)];
  const reloadedSkills = require(builtinSkillsPath);
  console.log(`✅ 文件验证成功！总技能数: ${reloadedSkills.length}`);
} catch (error) {
  console.error(`❌ 文件验证失败: ${error.message}`);
  console.log(`\n正在恢复备份...`);
  fs.writeFileSync(builtinSkillsPath, originalContent);
  console.log(`✅ 已恢复到备份版本`);
}

// 保存映射报告
const report = {
  timestamp: new Date().toISOString(),
  totalMissingTools: missingTools.size,
  successfulMappings: toolNameMappings.size,
  totalReplacements: totalReplacements,
  validReferencesAfter: validRefs,
  invalidReferencesAfter: invalidRefs,
  mappings: Object.fromEntries(toolNameMappings),
  stillMissingTools: Array.from(stillMissingTools)
};

fs.writeFileSync('./tool-reference-fix-report.json', JSON.stringify(report, null, 2));
console.log('\n📄 详细报告已保存到: tool-reference-fix-report.json\n');
