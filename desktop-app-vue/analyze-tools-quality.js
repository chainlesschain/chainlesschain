/**
 * 工具质量分析脚本
 * 分析builtin-tools.js中的工具质量和一致性
 */

const tools = require('./src/main/skill-tool-system/builtin-tools.js');

const stats = {
  total: tools.length,
  categories: {},
  schemaIssues: [],
  examplesMissing: [],
  permissionsMissing: [],
  toolTypeDistribution: {},
  riskLevelDistribution: {},
  avgPropertiesCount: 0,
  largestTools: []
};

let totalProperties = 0;

tools.forEach(tool => {
  // 类别统计
  stats.categories[tool.category] = (stats.categories[tool.category] || 0) + 1;

  // tool_type分布
  stats.toolTypeDistribution[tool.tool_type] = (stats.toolTypeDistribution[tool.tool_type] || 0) + 1;

  // risk_level分布
  stats.riskLevelDistribution[tool.risk_level] = (stats.riskLevelDistribution[tool.risk_level] || 0) + 1;

  // 检查examples
  if (!tool.examples || tool.examples.length === 0) {
    stats.examplesMissing.push(tool.id);
  }

  // 检查permissions
  if (!tool.required_permissions || tool.required_permissions.length === 0) {
    stats.permissionsMissing.push(tool.id);
  }

  // 检查schema完整性
  if (tool.parameters_schema && tool.parameters_schema.properties) {
    const propCount = Object.keys(tool.parameters_schema.properties).length;
    totalProperties += propCount;

    if (propCount > 10) {
      stats.largestTools.push({id: tool.id, properties: propCount});
    }
  } else if (tool.parameters_schema) {
    stats.schemaIssues.push({id: tool.id, issue: 'missing properties'});
  }
});

stats.avgPropertiesCount = (totalProperties / tools.length).toFixed(2);
stats.largestTools.sort((a, b) => b.properties - a.properties);

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  工具系统质量分析                                        ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

console.log('📊 基础统计:');
console.log(`   总工具数: ${stats.total}`);
console.log(`   平均参数数: ${stats.avgPropertiesCount}`);

console.log('\n🏷️  tool_type分布:');
Object.entries(stats.toolTypeDistribution)
  .sort((a,b) => b[1]-a[1])
  .forEach(([type, count]) => {
    const percentage = ((count / stats.total) * 100).toFixed(1);
    console.log(`   ${type.padEnd(15)}: ${count.toString().padStart(3)} (${percentage}%)`);
  });

console.log('\n⚠️  risk_level分布:');
Object.entries(stats.riskLevelDistribution)
  .sort((a,b) => parseInt(a[0]) - parseInt(b[0]))
  .forEach(([level, count]) => {
    const percentage = ((count / stats.total) * 100).toFixed(1);
    const label = level === '1' ? '低风险' : level === '2' ? '中风险' : level === '3' ? '高风险' : '极高风险';
    console.log(`   级别${level} (${label.padEnd(6)}): ${count.toString().padStart(3)} (${percentage}%)`);
  });

console.log('\n📂 最大的10个类别:');
Object.entries(stats.categories)
  .sort((a,b) => b[1]-a[1])
  .slice(0,10)
  .forEach(([cat, count], index) => {
    const percentage = ((count / stats.total) * 100).toFixed(1);
    console.log(`   ${(index+1).toString().padStart(2)}. ${cat.padEnd(20)}: ${count.toString().padStart(3)} (${percentage}%)`);
  });

console.log('\n🔍 质量问题:');
console.log(`   ❌ 缺少examples的工具: ${stats.examplesMissing.length}`);
if (stats.examplesMissing.length > 0 && stats.examplesMissing.length <= 10) {
  stats.examplesMissing.forEach(id => console.log(`      - ${id}`));
} else if (stats.examplesMissing.length > 10) {
  stats.examplesMissing.slice(0, 5).forEach(id => console.log(`      - ${id}`));
  console.log(`      ... 还有 ${stats.examplesMissing.length - 5} 个`);
}

console.log(`\n   ⚠️  缺少required_permissions的工具: ${stats.permissionsMissing.length}`);
if (stats.permissionsMissing.length > 0 && stats.permissionsMissing.length <= 10) {
  stats.permissionsMissing.forEach(id => console.log(`      - ${id}`));
} else if (stats.permissionsMissing.length > 10) {
  stats.permissionsMissing.slice(0, 5).forEach(id => console.log(`      - ${id}`));
  console.log(`      ... 还有 ${stats.permissionsMissing.length - 5} 个`);
}

console.log(`\n   🔧 schema问题: ${stats.schemaIssues.length}`);
if (stats.schemaIssues.length > 0) {
  stats.schemaIssues.forEach(issue => console.log(`      - ${issue.id}: ${issue.issue}`));
}

console.log('\n📦 最复杂的10个工具（按参数数量）:');
stats.largestTools.slice(0, 10).forEach((tool, index) => {
  console.log(`   ${(index+1).toString().padStart(2)}. ${tool.id.padEnd(40)}: ${tool.properties} 参数`);
});

console.log('\n💡 优化建议:');
const suggestions = [];

if (stats.examplesMissing.length > 0) {
  suggestions.push(`为 ${stats.examplesMissing.length} 个工具添加examples`);
}

if (stats.permissionsMissing.length > 50) {
  suggestions.push(`审查 ${stats.permissionsMissing.length} 个工具的权限定义`);
}

if (stats.largestTools.length > 0) {
  suggestions.push(`简化 ${stats.largestTools.filter(t => t.properties > 15).length} 个参数过多的工具`);
}

const categoryCount = Object.keys(stats.categories).length;
if (categoryCount > 40) {
  suggestions.push(`整合 ${categoryCount} 个类别（过多）`);
}

if (suggestions.length === 0) {
  console.log('   ✅ 工具系统质量良好！');
} else {
  suggestions.forEach((s, i) => console.log(`   ${i+1}. ${s}`));
}

console.log('\n');
