/**
 * 应用低频工具examples
 * 使用安全的对象修改+序列化方式
 */

const fs = require('fs');
const enhancedExamples = require('./low-freq-enhanced-examples.json');
const tools = require('./src/main/skill-tool-system/builtin-tools.js');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  应用低频工具Examples                                   ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const builtinPath = './src/main/skill-tool-system/builtin-tools.js';

// 备份
const backupPath = builtinPath + '.backup-low-freq-' + Date.now();
const originalContent = fs.readFileSync(builtinPath, 'utf-8');
fs.writeFileSync(backupPath, originalContent);
console.log(`📦 已备份原文件到: ${backupPath}\n`);

let appliedCount = 0;

// 修改工具对象
tools.forEach(tool => {
  if (enhancedExamples[tool.id]) {
    tool.examples = enhancedExamples[tool.id];
    appliedCount++;
  }
});

// 序列化
function serializeTools(tools) {
  const lines = ['/**', ' * 内置工具定义', ' * 自动生成，请勿手动编辑', ' */', '', 'const tools = ['];

  tools.forEach((tool, toolIdx) => {
    lines.push('  {');
    const fields = ['id', 'name', 'display_name', 'description', 'category', 'tool_type', 'parameters_schema', 'return_schema', 'examples', 'required_permissions', 'risk_level', 'is_builtin', 'enabled'];
    fields.forEach((field, fieldIdx) => {
      if (tool[field] !== undefined) {
        const value = tool[field];
        const valueStr = serializeValue(value, 2);
        const comma = fieldIdx < fields.length - 1 && hasMoreFields(tool, fields, fieldIdx) ? ',' : '';
        lines.push(`    ${field}: ${valueStr}${comma}`);
      }
    });
    const toolComma = toolIdx < tools.length - 1 ? ',' : '';
    lines.push(`  }${toolComma}`);
  });

  lines.push('];', '', 'module.exports = tools;');
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
    if (value.includes('\n') || value.includes('"') || value.includes("'")) {
      return '`' + value.replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/\\/g, '\\\\') + '`';
    }
    return `'${value.replace(/'/g, "\\'")}'`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const isSimple = value.every(v => typeof v === 'string' || typeof v === 'number');
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
      lines.push(`${innerIndent}${key}: ${valStr}${comma}`);
    });
    lines.push(`${indent}}`);
    return lines.join('\n');
  }

  return 'null';
}

console.log('正在序列化工具数组...');
const newContent = serializeTools(tools);

fs.writeFileSync(builtinPath, newContent);

console.log('═══════════════════════════════════════════════════════════');
console.log(`✅ 成功应用: ${appliedCount}个低频工具的examples`);
console.log('═══════════════════════════════════════════════════════════\n');
console.log(`📝 已更新: ${builtinPath}`);
console.log(`📦 备份文件: ${backupPath}`);

// 验证
console.log('\n验证生成的文件...');
try {
  delete require.cache[require.resolve(builtinPath)];
  const reloadedTools = require(builtinPath);
  console.log(`✅ 文件验证成功！总工具数: ${reloadedTools.length}`);

  const enhancedToolIds = Object.keys(enhancedExamples);
  let totalExamples = 0;
  enhancedToolIds.forEach(id => {
    const tool = reloadedTools.find(t => t.id === id);
    if (tool && tool.examples) {
      totalExamples += tool.examples.length;
    }
  });
  console.log(`✅ 低频工具examples总数: ${totalExamples}`);
  console.log(`✅ 平均每个低频工具: ${(totalExamples / enhancedToolIds.length).toFixed(1)}个examples`);

} catch (error) {
  console.error(`❌ 文件验证失败: ${error.message}`);
  console.log(`\n正在恢复备份...`);
  fs.writeFileSync(builtinPath, originalContent);
  console.log(`✅ 已恢复到备份版本`);
}
