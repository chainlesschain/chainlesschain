/**
 * 将增强的examples应用到builtin-tools.js
 * 替换高频工具的examples为更详细的场景化示例
 */

const fs = require('fs');
const enhancedExamples = require('./enhanced-examples.json');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  应用增强Examples到builtin-tools.js                    ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

/**
 * 手动构建examples字符串，避免JSON.stringify的转义问题
 */
function buildExamplesString(examples) {
  const lines = ['['];

  examples.forEach((example, idx) => {
    lines.push('  {');
    const descStr = buildValueString(example.description, 2);
    lines.push(`    description: ${descStr},`);
    lines.push(`    params: ${buildObjectString(example.params, 2)}`);
    lines.push(idx < examples.length - 1 ? '  },' : '  }');
  });

  lines.push(']');
  return lines.join('\n');
}

/**
 * 构建对象字符串
 */
function buildObjectString(obj, indentLevel) {
  const indent = '  '.repeat(indentLevel);
  const innerIndent = '  '.repeat(indentLevel + 1);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    const items = obj.map(item => buildValueString(item, indentLevel));
    return `[${items.join(', ')}]`;
  }

  if (typeof obj === 'object' && obj !== null) {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';

    const lines = ['{'];
    keys.forEach((key, idx) => {
      const value = obj[key];
      const valueStr = buildValueString(value, indentLevel + 1);
      const comma = idx < keys.length - 1 ? ',' : '';
      lines.push(`${innerIndent}${key}: ${valueStr}${comma}`);
    });
    lines.push(`${indent}}`);
    return lines.join('\n');
  }

  return obj;
}

/**
 * 转义字符串，对于包含特殊字符的使用模板字符串
 */
function escapeString(str) {
  // 如果包含换行符或双引号，使用反引号（模板字符串）
  if (str.includes('\n') || str.includes('"')) {
    return '`' + str.replace(/`/g, '\\`').replace(/\$/g, '\\$') + '`';
  }
  // 否则使用单引号
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * 构建值字符串
 */
function buildValueString(value, indentLevel) {
  if (typeof value === 'string') {
    // 如果包含换行符或双引号，使用反引号
    if (value.includes('\n') || value.includes('"')) {
      return '`' + value.replace(/`/g, '\\`').replace(/\$/g, '\\$') + '`';
    }
    // 否则使用单引号
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  } else if (Array.isArray(value)) {
    return buildObjectString(value, indentLevel);
  } else if (typeof value === 'object' && value !== null) {
    return buildObjectString(value, indentLevel);
  }
  return `'${value}'`;
}

const builtinPath = './src/main/skill-tool-system/builtin-tools.js';
let content = fs.readFileSync(builtinPath, 'utf-8');

// 备份原文件
const backupPath = builtinPath + '.backup-enhanced-' + Date.now();
fs.writeFileSync(backupPath, content);
console.log(`📦 已备份原文件到: ${backupPath}\n`);

let appliedCount = 0;
let skippedCount = 0;
const errors = [];

// 对每个工具应用enhanced examples
Object.entries(enhancedExamples).forEach(([toolId, examples]) => {
  try {
    // 查找工具定义的位置
    const idPattern = new RegExp(`id:\\s*['"]${toolId}['"]`, 'g');
    const match = idPattern.exec(content);

    if (!match) {
      errors.push(`未找到工具: ${toolId}`);
      skippedCount++;
      return;
    }

    const startPos = match.index;

    // 向前找到工具对象的开始{
    let toolStart = -1;
    for (let i = startPos; i >= 0; i--) {
      if (content[i] === '{') {
        toolStart = i;
        break;
      }
    }

    if (toolStart === -1) {
      errors.push(`无法找到工具对象起始位置: ${toolId}`);
      skippedCount++;
      return;
    }

    // 向后找到工具对象的结束}
    let braceCount = 0;
    let inString = false;
    let stringChar = null;
    let toolEnd = -1;

    for (let i = toolStart; i < content.length; i++) {
      const char = content[i];

      if ((char === '"' || char === "'" || char === '`') && (i === 0 || content[i-1] !== '\\')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
        continue;
      }

      if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            toolEnd = i;
            break;
          }
        }
      }
    }

    if (toolEnd === -1) {
      errors.push(`无法找到工具对象结束位置: ${toolId}`);
      skippedCount++;
      return;
    }

    const toolDef = content.substring(toolStart, toolEnd + 1);

    // 查找examples字段
    const examplesMatch = /examples:\s*\[[\s\S]*?\]/m.exec(toolDef);
    if (!examplesMatch) {
      errors.push(`工具${toolId}没有examples字段`);
      skippedCount++;
      return;
    }

    // 生成新的examples字符串（手动构建，避免JSON转义问题）
    const examplesStr = buildExamplesString(examples);

    // 替换examples
    const newToolDef = toolDef.replace(
      /examples:\s*\[[\s\S]*?\]/m,
      `examples: ${examplesStr}`
    );

    content = content.substring(0, toolStart) + newToolDef + content.substring(toolEnd + 1);
    appliedCount++;

  } catch (error) {
    errors.push(`处理${toolId}时出错: ${error.message}`);
    skippedCount++;
  }
});

// 保存修改后的文件
fs.writeFileSync(builtinPath, content);

console.log('═══════════════════════════════════════════════════════════');
console.log(`✅ 成功应用: ${appliedCount}个`);
console.log(`⚠️  跳过: ${skippedCount}个`);

if (errors.length > 0) {
  console.log(`\n错误信息:`);
  errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
  if (errors.length > 10) {
    console.log(`  ... 还有${errors.length - 10}个错误`);
  }
}

console.log('═══════════════════════════════════════════════════════════\n');
console.log(`📝 已更新: ${builtinPath}`);
console.log(`📦 备份文件: ${backupPath}`);

// 统计更新后的examples数量
console.log('\n验证更新结果...');
const updatedTools = require(builtinPath);
const enhancedToolIds = Object.keys(enhancedExamples);
const verification = {
  total: 0,
  min: Infinity,
  max: 0,
  examples: []
};

enhancedToolIds.forEach(id => {
  const tool = updatedTools.find(t => t.id === id);
  if (tool && tool.examples) {
    const count = tool.examples.length;
    verification.total += count;
    verification.min = Math.min(verification.min, count);
    verification.max = Math.max(verification.max, count);
    verification.examples.push({ id, count });
  }
});

console.log(`\n高频工具Examples统计:`);
console.log(`  总examples数: ${verification.total}`);
console.log(`  平均每工具: ${(verification.total / enhancedToolIds.length).toFixed(1)}个`);
console.log(`  最少: ${verification.min}个`);
console.log(`  最多: ${verification.max}个`);
