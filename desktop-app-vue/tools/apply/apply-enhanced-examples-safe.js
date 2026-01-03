/**
 * 安全地应用增强examples
 * 通过修改对象然后重新序列化，避免字符串替换问题
 */

const fs = require('fs');
const enhancedExamples = require('./enhanced-examples.json');
const tools = require('./src/main/skill-tool-system/builtin-tools.js');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  应用增强Examples（安全模式）                           ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const builtinPath = './src/main/skill-tool-system/builtin-tools.js';

// 备份原文件
const backupPath = builtinPath + '.backup-enhanced-safe-' + Date.now();
const originalContent = fs.readFileSync(builtinPath, 'utf-8');
fs.writeFileSync(backupPath, originalContent);
console.log(`📦 已备份原文件到: ${backupPath}\n`);

let appliedCount = 0;

// 修改工具对象的examples
tools.forEach(tool => {
  if (enhancedExamples[tool.id]) {
    tool.examples = enhancedExamples[tool.id];
    appliedCount++;
  }
});

// 序列化工具数组为JavaScript代码
function serializeTools(tools) {
  const lines = [];

  lines.push('/**');
  lines.push(' * 内置工具定义');
  lines.push(' * 自动生成，请勿手动编辑');
  lines.push(' */');
  lines.push('');
  lines.push('const tools = [');

  tools.forEach((tool, toolIdx) => {
    lines.push('  {');

    // 按固定顺序输出字段
    const fields = [
      'id', 'name', 'display_name', 'description', 'category',
      'tool_type', 'parameters_schema', 'return_schema', 'examples',
      'required_permissions', 'risk_level', 'is_builtin', 'enabled'
    ];

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

  lines.push('];');
  lines.push('');
  lines.push('module.exports = tools;');

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
    // 处理特殊字符
    if (value.includes('\n') || value.includes('"') || value.includes("'")) {
      // 使用反引号（模板字符串）
      return '`' + value.replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/\\/g, '\\\\') + '`';
    }
    // 使用单引号
    return `'${value.replace(/'/g, "\\'")}'`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';

    // 检查是否是简单数组（所有元素都是字符串或数字）
    const isSimple = value.every(v => typeof v === 'string' || typeof v === 'number');

    if (isSimple && value.length <= 5) {
      // 简单数组，单行显示
      const items = value.map(v => serializeValue(v, indentLevel));
      return `[${items.join(', ')}]`;
    }

    // 复杂数组，多行显示
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

      // 如果值是多行的，需要特殊处理
      if (valStr.includes('\n')) {
        lines.push(`${innerIndent}${key}: ${valStr}${comma}`);
      } else {
        lines.push(`${innerIndent}${key}: ${valStr}${comma}`);
      }
    });
    lines.push(`${indent}}`);
    return lines.join('\n');
  }

  return 'null';
}

// 生成新的文件内容
console.log('正在序列化工具数组...');
const newContent = serializeTools(tools);

// 写入文件
fs.writeFileSync(builtinPath, newContent);

console.log('═══════════════════════════════════════════════════════════');
console.log(`✅ 成功应用: ${appliedCount}个高频工具的增强examples`);
console.log('═══════════════════════════════════════════════════════════\n');
console.log(`📝 已更新: ${builtinPath}`);
console.log(`📦 备份文件: ${backupPath}`);

// 验证生成的文件是否可以正常require
console.log('\n验证生成的文件...');
try {
  // 清除缓存
  delete require.cache[require.resolve(builtinPath)];
  const reloadedTools = require(builtinPath);
  console.log(`✅ 文件验证成功！总工具数: ${reloadedTools.length}`);

  // 检查高频工具的examples数量
  const enhancedToolIds = Object.keys(enhancedExamples);
  let totalExamples = 0;
  enhancedToolIds.forEach(id => {
    const tool = reloadedTools.find(t => t.id === id);
    if (tool && tool.examples) {
      totalExamples += tool.examples.length;
    }
  });
  console.log(`✅ 高频工具examples总数: ${totalExamples}`);
  console.log(`✅ 平均每个高频工具: ${(totalExamples / enhancedToolIds.length).toFixed(1)}个examples`);

} catch (error) {
  console.error(`❌ 文件验证失败: ${error.message}`);
  console.log(`\n正在恢复备份...`);
  fs.writeFileSync(builtinPath, originalContent);
  console.log(`✅ 已恢复到备份版本`);
}
