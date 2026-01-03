/**
 * 验证examples是否成功应用到builtin-tools.js
 */

const tools = require('./src/main/skill-tool-system/builtin-tools.js');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  验证Examples应用结果                                   ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const withExamples = tools.filter(t => t.examples && t.examples.length > 0);
const withoutExamples = tools.filter(t => !t.examples || t.examples.length === 0);

console.log(`总工具数: ${tools.length}`);
console.log(`有examples: ${withExamples.length} (${(withExamples.length/tools.length*100).toFixed(1)}%)`);
console.log(`无examples: ${withoutExamples.length} (${(withoutExamples.length/tools.length*100).toFixed(1)}%)`);

if (withoutExamples.length > 0) {
  console.log('\n仍然缺少examples的工具:');
  withoutExamples.slice(0, 10).forEach(t => {
    console.log(`  - ${t.id} (${t.category})`);
  });
  if (withoutExamples.length > 10) {
    console.log(`  ... 还有${withoutExamples.length - 10}个`);
  }
}

// 检查几个示例工具
console.log('\n示例工具验证:');
const sampleIds = ['tool_model_generator', 'tool_audio_fingerprint', 'tool_chart_generator'];

sampleIds.forEach(id => {
  const tool = tools.find(t => t.id === id);
  if (tool) {
    console.log(`\n${id}:`);
    console.log(`  category: ${tool.category}`);
    console.log(`  has examples: ${tool.examples ? 'YES' : 'NO'}`);
    if (tool.examples && tool.examples.length > 0) {
      console.log(`  examples count: ${tool.examples.length}`);
      console.log(`  example params:`, JSON.stringify(tool.examples[0].params, null, 4));
    }
  }
});

console.log('\n═══════════════════════════════════════════════════════════');
if (withoutExamples.length === 0) {
  console.log('✅ 所有工具都有examples！');
} else {
  console.log(`⚠️  还有${withoutExamples.length}个工具缺少examples`);
}
console.log('═══════════════════════════════════════════════════════════\n');
