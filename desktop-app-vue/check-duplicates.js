const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const projectTools = require('./src/main/skill-tool-system/additional-project-tools.js');
const v3Tools = require('./src/main/skill-tool-system/additional-tools-v3.js');

console.log('=== 工具重复详细分析 ===\n');

const ids = tools.map(t => t.id);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
const uniqueDuplicates = [...new Set(duplicates)];

console.log('1. 总工具数:', tools.length);
console.log('2. 重复工具数:', uniqueDuplicates.length, '\n');

console.log('重复的工具ID:');
uniqueDuplicates.forEach(id => {
  const indices = [];
  ids.forEach((i, idx) => {
    if (i === id) indices.push(idx);
  });
  console.log('  -', id);
  console.log('    出现位置:', indices.join(', '));
});

console.log('\n=== Project工具分析 ===');
console.log('Project工具数:', projectTools.length);
projectTools.forEach(t => {
  console.log('  -', t.id);
});

console.log('\n=== V3工具分析 ===');
console.log('V3工具数:', v3Tools.length);
console.log('前10个V3工具:');
v3Tools.slice(0, 10).forEach(t => {
  console.log('  -', t.id);
});
