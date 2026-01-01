const builtin = require('./src/main/skill-tool-system/builtin-tools.js');

// 不加载额外工具，直接读取builtinTools数组
const fs = require('fs');
const content = fs.readFileSync('./src/main/skill-tool-system/builtin-tools.js', 'utf-8');

// 检查builtinTools数组中的内容
console.log('查找builtin-tools.js文件中的重复工具定义...\n');

const duplicateIds = [
  'tool_template_renderer',
  'tool_speech_recognizer',
  'tool_wallet_manager',
  'tool_model_predictor',
  'tool_performance_profiler',
  'tool_text_to_speech'
];

duplicateIds.forEach(id => {
  const regex = new RegExp(`id:\\s*['"]${id}['"]`, 'g');
  const matches = [...content.matchAll(regex)];
  console.log(`${id}:`);
  console.log(`  在builtin-tools.js主文件中出现次数: ${matches.length}`);
});

console.log('\n检查最终导出数组中的重复...');
const ids = builtin.map(t => t.id);

duplicateIds.forEach(id => {
  const count = ids.filter(i => i === id).length;
  const indices = ids.map((i, idx) => i === id ? idx : -1).filter(i => i !== -1);
  console.log(`${id}:`);
  console.log(`  最终数组中出现次数: ${count}`);
  console.log(`  位置: ${indices.join(', ')}`);
});
