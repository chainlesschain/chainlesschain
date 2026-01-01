/**
 * 统一权限格式
 * 将所有点号格式（file.write）转换为冒号格式（file:write）
 */

const fs = require('fs');
const tools = require('./src/main/skill-tool-system/builtin-tools.js');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  统一权限格式                                            ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const builtinPath = './src/main/skill-tool-system/builtin-tools.js';

// 备份原文件
const backupPath = builtinPath + '.backup-permission-format-' + Date.now();
const originalContent = fs.readFileSync(builtinPath, 'utf-8');
fs.writeFileSync(backupPath, originalContent);
console.log(`📦 已备份原文件到: ${backupPath}\n`);

let convertedToolsCount = 0;
let convertedPermissionsCount = 0;
const conversionLog = [];

// 转换每个工具的permissions
tools.forEach(tool => {
  if (!tool.required_permissions || tool.required_permissions.length === 0) {
    return;
  }

  let hasConversion = false;
  const oldPermissions = [...tool.required_permissions];

  tool.required_permissions = tool.required_permissions.map(perm => {
    if (perm.includes('.')) {
      const newPerm = perm.replace(/\./g, ':');
      conversionLog.push({
        toolId: tool.id,
        oldPermission: perm,
        newPermission: newPerm
      });
      convertedPermissionsCount++;
      hasConversion = true;
      return newPerm;
    }
    return perm;
  });

  if (hasConversion) {
    convertedToolsCount++;
  }
});

console.log(`✅ 转换完成!`);
console.log(`  转换工具数: ${convertedToolsCount}个`);
console.log(`  转换权限数: ${convertedPermissionsCount}个\n`);

// 序列化工具数组
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
console.log(`✅ 权限格式统一完成`);
console.log('═══════════════════════════════════════════════════════════\n');
console.log(`📝 已更新: ${builtinPath}`);
console.log(`📦 备份文件: ${backupPath}`);

// 保存转换日志
const logReport = {
  summary: {
    convertedTools: convertedToolsCount,
    convertedPermissions: convertedPermissionsCount
  },
  conversions: conversionLog
};

fs.writeFileSync('./permission-conversion-log.json', JSON.stringify(logReport, null, 2));
console.log(`📄 转换日志已保存到: permission-conversion-log.json`);

// 验证生成的文件
console.log('\n验证生成的文件...');
try {
  delete require.cache[require.resolve(builtinPath)];
  const reloadedTools = require(builtinPath);
  console.log(`✅ 文件验证成功！总工具数: ${reloadedTools.length}`);

  // 统计权限格式
  let dotCount = 0;
  let colonCount = 0;
  reloadedTools.forEach(t => {
    if (t.required_permissions) {
      t.required_permissions.forEach(p => {
        if (p.includes('.')) dotCount++;
        if (p.includes(':')) colonCount++;
      });
    }
  });

  console.log(`\n权限格式统计:`);
  console.log(`  点号格式: ${dotCount}个 ${dotCount === 0 ? '✅' : '⚠️'}`);
  console.log(`  冒号格式: ${colonCount}个 ✅`);

  if (dotCount === 0) {
    console.log(`\n🎉 所有权限已成功统一为冒号格式！`);
  }

} catch (error) {
  console.error(`❌ 文件验证失败: ${error.message}`);
  console.log(`\n正在恢复备份...`);
  fs.writeFileSync(builtinPath, originalContent);
  console.log(`✅ 已恢复到备份版本`);
}
