/**
 * 分析缺失examples和permissions的工具
 * 生成详细报告用于批量补充
 */

const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const fs = require('fs');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  工具字段缺失分析                                        ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const missingExamples = [];
const missingPermissions = [];

tools.forEach(tool => {
  // 检查examples
  if (!tool.examples || tool.examples.length === 0) {
    missingExamples.push({
      id: tool.id,
      name: tool.name,
      category: tool.category,
      description: tool.description,
      parameters: tool.parameters_schema?.properties ? Object.keys(tool.parameters_schema.properties) : []
    });
  }

  // 检查permissions
  if (!tool.required_permissions || tool.required_permissions.length === 0) {
    missingPermissions.push({
      id: tool.id,
      name: tool.name,
      category: tool.category,
      description: tool.description,
      riskLevel: tool.risk_level
    });
  }
});

console.log(`📊 总工具数: ${tools.length}`);
console.log(`❌ 缺少examples: ${missingExamples.length}个`);
console.log(`❌ 缺少permissions: ${missingPermissions.length}个\n`);

// 按类别统计缺失examples
console.log('缺少examples的工具（按类别）:');
const examplesByCategory = {};
missingExamples.forEach(tool => {
  if (!examplesByCategory[tool.category]) {
    examplesByCategory[tool.category] = [];
  }
  examplesByCategory[tool.category].push(tool);
});

Object.keys(examplesByCategory).sort().forEach(cat => {
  console.log(`  ${cat}: ${examplesByCategory[cat].length}个`);
});

// 按类别统计缺失permissions
console.log('\n缺少permissions的工具（按类别）:');
const permsByCategory = {};
missingPermissions.forEach(tool => {
  if (!permsByCategory[tool.category]) {
    permsByCategory[tool.category] = [];
  }
  permsByCategory[tool.category].push(tool);
});

Object.keys(permsByCategory).sort().forEach(cat => {
  console.log(`  ${cat}: ${permsByCategory[cat].length}个`);
});

// 输出到JSON文件
const report = {
  summary: {
    total: tools.length,
    missingExamplesCount: missingExamples.length,
    missingPermissionsCount: missingPermissions.length
  },
  missingExamples: missingExamples,
  missingPermissions: missingPermissions,
  examplesByCategory: examplesByCategory,
  permsByCategory: permsByCategory
};

fs.writeFileSync('./missing-fields-report.json', JSON.stringify(report, null, 2));

console.log('\n✅ 详细报告已保存到: missing-fields-report.json');

// 显示前10个缺失examples的工具
console.log('\n前10个缺少examples的工具:');
missingExamples.slice(0, 10).forEach((tool, i) => {
  console.log(`  ${i+1}. ${tool.id} (${tool.category})`);
  console.log(`     参数: ${tool.parameters.join(', ')}`);
});

// 显示前10个缺失permissions的工具
console.log('\n前10个缺少permissions的工具:');
missingPermissions.slice(0, 10).forEach((tool, i) => {
  console.log(`  ${i+1}. ${tool.id} (${tool.category}) - 风险级别${tool.riskLevel}`);
});
