/**
 * 验证高频工具的增强examples
 */

const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const highFreqReport = require('./high-frequency-tools.json');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  验证高频工具增强Examples                               ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const highFreqIds = highFreqReport.tools.map(t => t.id);
const highFreqTools = tools.filter(t => highFreqIds.includes(t.id));

// 统计
let totalExamples = 0;
const exampleCounts = {};

highFreqTools.forEach(tool => {
  const count = tool.examples ? tool.examples.length : 0;
  totalExamples += count;
  exampleCounts[count] = (exampleCounts[count] || 0) + 1;
});

console.log(`高频工具总数: ${highFreqTools.length}`);
console.log(`Examples总数: ${totalExamples}`);
console.log(`平均每工具: ${(totalExamples / highFreqTools.length).toFixed(2)}个\n`);

console.log('Examples数量分布:');
Object.entries(exampleCounts)
  .sort((a, b) => Number(a[0]) - Number(b[0]))
  .forEach(([count, tools]) => {
    console.log(`  ${count}个examples: ${tools}个工具`);
  });

// 显示前10个高频工具的examples
console.log('\n═══ 前10个高频工具Examples预览 ═══\n');

highFreqTools.slice(0, 10).forEach((tool, idx) => {
  console.log(`${idx + 1}. ${tool.id} (${tool.category})`);
  console.log(`   ${tool.display_name}`);
  console.log(`   Examples数量: ${tool.examples ? tool.examples.length : 0}`);

  if (tool.examples && tool.examples.length > 0) {
    tool.examples.forEach((ex, exIdx) => {
      console.log(`   ${exIdx + 1}. ${ex.description}`);
      const paramKeys = Object.keys(ex.params || {});
      if (paramKeys.length > 0 && paramKeys.length <= 3) {
        console.log(`      参数: ${paramKeys.join(', ')}`);
      } else if (paramKeys.length > 3) {
        console.log(`      参数: ${paramKeys.slice(0, 3).join(', ')} ... (${paramKeys.length}个)`);
      }
    });
  }
  console.log('');
});

// 检查examples质量
console.log('═══ Examples质量检查 ═══\n');

const qualityIssues = [];

highFreqTools.forEach(tool => {
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

if (qualityIssues.length === 0) {
  console.log('✅ 所有高频工具的examples质量合格！');
} else {
  console.log(`⚠️  发现 ${qualityIssues.length} 个质量问题:`);
  qualityIssues.slice(0, 10).forEach(issue => {
    console.log(`  - ${issue}`);
  });
  if (qualityIssues.length > 10) {
    console.log(`  ... 还有${qualityIssues.length - 10}个问题`);
  }
}

// 对比优化前后
console.log('\n═══ 优化前后对比 ═══\n');

const beforeCount = highFreqReport.tools.filter(t => t.current_examples_count > 0).length;
const afterCount = highFreqTools.filter(t => t.examples && t.examples.length > 0).length;

const beforeAvg = highFreqReport.tools.reduce((sum, t) => sum + t.current_examples_count, 0) / highFreqReport.tools.length;
const afterAvg = totalExamples / highFreqTools.length;

console.log(`有examples的工具:`);
console.log(`  优化前: ${beforeCount}/${highFreqReport.tools.length} (${(beforeCount/highFreqReport.tools.length*100).toFixed(1)}%)`);
console.log(`  优化后: ${afterCount}/${highFreqTools.length} (${(afterCount/highFreqTools.length*100).toFixed(1)}%)`);

console.log(`\n平均examples数:`);
console.log(`  优化前: ${beforeAvg.toFixed(2)}个/工具`);
console.log(`  优化后: ${afterAvg.toFixed(2)}个/工具`);
console.log(`  提升: ${((afterAvg - beforeAvg) / beforeAvg * 100).toFixed(1)}%`);

console.log('\n═══════════════════════════════════════════════════════════');
console.log('✅ 验证完成！');
console.log('═══════════════════════════════════════════════════════════\n');
