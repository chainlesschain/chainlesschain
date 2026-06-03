/**
 * 将生成的permissions应用到builtin-tools.js
 * 自动更新工具定义，添加required_permissions字段
 */

const fs = require('fs');
const generatedPermissions = require('./generated-permissions.json');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  应用Permissions到builtin-tools.js                     ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const builtinPath = './src/main/skill-tool-system/builtin-tools.js';
let content = fs.readFileSync(builtinPath, 'utf-8');

// 备份原文件
const backupPath = builtinPath + '.backup-permissions-' + Date.now();
fs.writeFileSync(backupPath, content);
console.log(`📦 已备份原文件到: ${backupPath}\n`);

let appliedCount = 0;
let skippedCount = 0;
const errors = [];

// 对每个工具应用permissions
Object.entries(generatedPermissions).forEach(([toolId, permissions]) => {
  try {
    // 查找工具定义的位置
    const idPattern = new RegExp(`id:\\s*['"]${toolId}['"]`, 'g');
    const match = idPattern.exec(content);

    if (!match) {
      errors.push(`未找到工具: ${toolId}`);
      skippedCount++;
      return;
    }

    // 从id位置向后查找，找到该工具对象的结束位置
    const startPos = match.index;

    // 查找这个工具对象的范围
    let braceCount = 0;
    let inString = false;
    let stringChar = null;
    let toolStart = -1;
    let toolEnd = -1;

    // 向前找到工具对象的开始{
    for (let i = startPos; i >= 0; i--) {
      const char = content[i];
      if (char === '{' && !inString) {
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
    braceCount = 0;
    for (let i = toolStart; i < content.length; i++) {
      const char = content[i];

      // 处理字符串
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

    // 检查是否已有required_permissions
    if (/required_permissions:\s*\[/.test(toolDef)) {
      // 已有required_permissions，替换
      const permissionsStr = JSON.stringify(permissions);

      const newToolDef = toolDef.replace(
        /required_permissions:\s*\[[^\]]*\]/s,
        `required_permissions: ${permissionsStr}`
      );

      content = content.substring(0, toolStart) + newToolDef + content.substring(toolEnd + 1);
      appliedCount++;
    } else {
      // 没有required_permissions，在examples之后添加
      const examplesPos = toolDef.indexOf('examples:');
      if (examplesPos === -1) {
        errors.push(`工具${toolId}没有examples字段`);
        skippedCount++;
        return;
      }

      // 找到examples的结束位置
      let pos = examplesPos;
      braceCount = 0;
      let bracketCount = 0;
      inString = false;
      let foundStart = false;

      for (let i = examplesPos; i < toolDef.length; i++) {
        const char = toolDef[i];

        if ((char === '"' || char === "'" || char === '`') && (i === 0 || toolDef[i-1] !== '\\')) {
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
          if (char === '[') {
            bracketCount++;
            foundStart = true;
          }
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
          if (char === ']') {
            bracketCount--;
            if (foundStart && bracketCount === 0 && braceCount === 0) {
              pos = i + 1;
              break;
            }
          }
        }
      }

      // 在examples后添加required_permissions
      const permissionsStr = JSON.stringify(permissions);

      const beforeExamplesEnd = toolDef.substring(0, pos);
      const afterExamplesEnd = toolDef.substring(pos);

      // 查找],后的位置
      const commaPos = afterExamplesEnd.indexOf(',');
      if (commaPos === -1) {
        errors.push(`无法在examples后找到逗号: ${toolId}`);
        skippedCount++;
        return;
      }

      const newToolDef = beforeExamplesEnd +
        afterExamplesEnd.substring(0, commaPos + 1) +
        '\n  required_permissions: ' + permissionsStr + ',' +
        afterExamplesEnd.substring(commaPos + 1);

      content = content.substring(0, toolStart) + newToolDef + content.substring(toolEnd + 1);
      appliedCount++;
    }
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
