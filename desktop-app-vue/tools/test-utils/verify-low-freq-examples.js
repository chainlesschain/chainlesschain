/**
 * 验证低频工具examples质量
 */

const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const lowFreqReport = require('./low-frequency-tools.json');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  验证低频工具Examples质量                               ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const lowFreqIds = lowFreqReport.tools.map(t => t.id);
const lowFreqTools = tools.filter(t => lowFreqIds.includes(t.id));

// 统计
let totalExamples = 0;
const exampleCounts = {};

lowFreqTools.forEach(tool => {
  const count = tool.examples ? tool.examples.length : 0;
  totalExamples += count;
  exampleCounts[count] = (exampleCounts[count] || 0) + 1;
});

console.log(`低频工具总数: ${lowFreqTools.length}`);
console.log(`Examples总数: ${totalExamples}`);
console.log(`平均每工具: ${(totalExamples / lowFreqTools.length).toFixed(2)}个\n`);

console.log('Examples数量分布:');
Object.entries(exampleCounts)
  .sort((a, b) => Number(a[0]) - Number(b[0]))
  .forEach(([count, tools]) => {
    console.log(`  ${count}个examples: ${tools}个工具`);
  });

// 显示前10个低频工具
console.log('\n═══ 前10个低频工具Examples ===\n');

lowFreqTools.slice(0, 10).forEach((tool, idx) => {
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

lowFreqTools.forEach(tool => {
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
  console.log('✅ 所有低频工具的examples质量合格！');
} else {
  console.log(`⚠️  发现 ${qualityIssues.length} 个质量问题:`);
  qualityIssues.slice(0, 10).forEach(issue => {
    console.log(`  - ${issue}`);
  });
}

// 对比优化前后
console.log('\n═══ 优化前后对比 ===\n');

const beforeCount = lowFreqReport.tools.filter(t => t.current_examples_count >= 2).length;
const afterCount = lowFreqTools.filter(t => t.examples && t.examples.length >= 2).length;

const beforeAvg = lowFreqReport.tools.reduce((sum, t) => sum + t.current_examples_count, 0) / lowFreqReport.tools.length;
const afterAvg = totalExamples / lowFreqTools.length;

console.log(`有2+examples的工具:`);
console.log(`  优化前: ${beforeCount}/${lowFreqReport.tools.length} (${(beforeCount/lowFreqReport.tools.length*100).toFixed(1)}%)`);
console.log(`  优化后: ${afterCount}/${lowFreqTools.length} (${(afterCount/lowFreqTools.length*100).toFixed(1)}%)`);

console.log(`\n平均examples数:`);
console.log(`  优化前: ${beforeAvg.toFixed(2)}个/工具`);
console.log(`  优化后: ${afterAvg.toFixed(2)}个/工具`);
console.log(`  提升: ${((afterAvg - beforeAvg) / beforeAvg * 100).toFixed(1)}%`);

// 整体统计
console.log('\n═══ 整体统计（全部300个工具） ===\n');

const allToolsWith2Plus = tools.filter(t => t.examples && t.examples.length >= 2).length;
const allTotalExamples = tools.reduce((sum, t) => sum + (t.examples?.length || 0), 0);
const allAvgExamples = allTotalExamples / tools.length;

console.log(`总工具数: ${tools.length}`);
console.log(`有2+examples的工具: ${allToolsWith2Plus}个 (${(allToolsWith2Plus/tools.length*100).toFixed(1)}%)`);
console.log(`Examples总数: ${allTotalExamples}`);
console.log(`平均每工具: ${allAvgExamples.toFixed(2)}个examples`);

console.log('\n═══════════════════════════════════════════════════════════');
console.log('✅ 验证完成！');
console.log('═══════════════════════════════════════════════════════════\n');
