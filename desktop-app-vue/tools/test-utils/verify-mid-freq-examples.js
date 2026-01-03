/**
 * 验证中频工具examples质量
 */

const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const midFreqReport = require('./mid-frequency-tools.json');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  验证中频工具Examples质量                               ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const midFreqIds = midFreqReport.tools.map(t => t.id);
const midFreqTools = tools.filter(t => midFreqIds.includes(t.id));

// 统计
let totalExamples = 0;
const exampleCounts = {};

midFreqTools.forEach(tool => {
  const count = tool.examples ? tool.examples.length : 0;
  totalExamples += count;
  exampleCounts[count] = (exampleCounts[count] || 0) + 1;
});

console.log(`中频工具总数: ${midFreqTools.length}`);
console.log(`Examples总数: ${totalExamples}`);
console.log(`平均每工具: ${(totalExamples / midFreqTools.length).toFixed(2)}个\n`);

console.log('Examples数量分布:');
Object.entries(exampleCounts)
  .sort((a, b) => Number(a[0]) - Number(b[0]))
  .forEach(([count, tools]) => {
    console.log(`  ${count}个examples: ${tools}个工具`);
  });

// 显示前10个中频工具
console.log('\n═══ 前10个中频工具Examples ===\n');

midFreqTools.slice(0, 10).forEach((tool, idx) => {
  console.log(`${idx + 1}. ${tool.id} (${tool.category})`);
  console.log(`   ${tool.display_name}`);
  console.log(`   Examples数量: ${tool.examples ? tool.examples.length : 0}`);

  if (tool.examples && tool.examples.length > 0) {
    tool.examples.forEach((ex, exIdx) => {
      console.log(`   ${exIdx + 1}. ${ex.description}`);
    });
  }
  console.log('');
});

// 质量检查
const qualityIssues = [];

midFreqTools.forEach(tool => {
  if (!tool.examples || tool.examples.length === 0) {
    qualityIssues.push(`${tool.id}: 没有examples`);
  } else {
    tool.examples.forEach((ex, idx) => {
      if (!ex.description || ex.description.trim() === '') {
        qualityIssues.push(`${tool.id}: Example ${idx + 1} 缺少description`);
      }
      if (!ex.params || Object.keys(ex.params).length === 0) {
        qualityIssues.push(`${tool.id}: Example ${idx + 1} 缺少params`);
      }
    });
  }
});

console.log('═══ Examples质量检查 ===\n');

if (qualityIssues.length === 0) {
  console.log('✅ 所有中频工具的examples质量合格！');
} else {
  console.log(`⚠️  发现 ${qualityIssues.length} 个质量问题:`);
  qualityIssues.slice(0, 10).forEach(issue => {
    console.log(`  - ${issue}`);
  });
}

// 对比优化前后
console.log('\n═══ 优化前后对比 ===\n');

const beforeCount = midFreqReport.tools.filter(t => t.current_examples_count >= 2).length;
const afterCount = midFreqTools.filter(t => t.examples && t.examples.length >= 2).length;

const beforeAvg = midFreqReport.tools.reduce((sum, t) => sum + t.current_examples_count, 0) / midFreqReport.tools.length;
const afterAvg = totalExamples / midFreqTools.length;

console.log(`有2+examples的工具:`);
console.log(`  优化前: ${beforeCount}/${midFreqReport.tools.length} (${(beforeCount/midFreqReport.tools.length*100).toFixed(1)}%)`);
console.log(`  优化后: ${afterCount}/${midFreqTools.length} (${(afterCount/midFreqTools.length*100).toFixed(1)}%)`);

console.log(`\n平均examples数:`);
console.log(`  优化前: ${beforeAvg.toFixed(2)}个/工具`);
console.log(`  优化后: ${afterAvg.toFixed(2)}个/工具`);
console.log(`  提升: ${((afterAvg - beforeAvg) / beforeAvg * 100).toFixed(1)}%`);

console.log('\n═══════════════════════════════════════════════════════════');
console.log('✅ 验证完成！');
console.log('═══════════════════════════════════════════════════════════\n');
