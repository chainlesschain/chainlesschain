/**
 * 将V3工具插入到builtin-tools.js
 */

const fs = require('fs');
const path = require('path');

const builtinToolsPath = path.join(__dirname, 'src/main/skill-tool-system/builtin-tools.js');
const v3ToolsPath = path.join(__dirname, 'v3-tools-js-format.txt');

console.log('读取文件...');

// 读取builtin-tools.js
let builtinContent = fs.readFileSync(builtinToolsPath, 'utf-8');

// 读取V3工具定义
const v3Tools = fs.readFileSync(v3ToolsPath, 'utf-8');

console.log('原始文件大小:', Math.ceil(builtinContent.length / 1024), 'KB');
console.log('V3工具大小:', Math.ceil(v3Tools.length / 1024), 'KB');

// 找到最后一个工具的结束位置（在 ]; 之前）
const closingBracketIndex = builtinContent.lastIndexOf('];');

if (closingBracketIndex === -1) {
  console.error('❌ 找不到builtinTools数组的closing bracket');
  process.exit(1);
}

// 找到最后一个 } 之后的位置
const lastToolEnd = builtinContent.lastIndexOf('}', closingBracketIndex);

if (lastToolEnd === -1) {
  console.error('❌ 找不到最后一个工具的结束位置');
  process.exit(1);
}

// 检查是否已经添加了V3工具
if (builtinContent.includes('V3专业领域工具（已补全Schema）')) {
  console.log('⚠️  V3工具似乎已经添加过了，跳过插入');
  process.exit(0);
}

// 在最后一个工具的 } 后添加逗号，然后插入V3工具
const before = builtinContent.substring(0, lastToolEnd + 1);
const after = builtinContent.substring(lastToolEnd + 1);

// 构建新内容
const newContent = before + ',' + v3Tools + after;

// 备份原文件
const backupPath = builtinToolsPath + '.backup-before-v3';
fs.writeFileSync(backupPath, builtinContent);
console.log('✅ 已备份原文件到:', backupPath);

// 写入新内容
fs.writeFileSync(builtinToolsPath, newContent);

console.log('✅ V3工具已成功插入到builtin-tools.js');
console.log('新文件大小:', Math.ceil(newContent.length / 1024), 'KB');
console.log('增加了:', Math.ceil(v3Tools.length / 1024), 'KB');

// 验证
const lines = newContent.split('\n').length;
console.log('新文件行数:', lines);
