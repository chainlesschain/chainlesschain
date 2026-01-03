/**
 * 验证工具整合脚本
 * 检查builtin-tools.js中的工具是否正确整合，无重复
 */

const tools = require('./src/main/skill-tool-system/builtin-tools.js');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  工具整合验证                                            ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 1. 总工具数
console.log(`✅ 总工具数: ${tools.length}`);

// 2. 检查重复ID
const ids = tools.map(t => t.id);
const uniqueIds = new Set(ids);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

if (duplicates.length > 0) {
  console.log(`❌ 发现${duplicates.length}个重复工具ID:`);
  const duplicateSet = new Set(duplicates);
  duplicateSet.forEach(id => {
    const count = ids.filter(i => i === id).length;
    console.log(`   - ${id} (出现${count}次)`);
  });
} else {
  console.log(`✅ 无重复工具ID (唯一ID数: ${uniqueIds.size})`);
}

// 3. 按类别统计
console.log('\n📊 按类别统计:');
const categories = {};
tools.forEach(t => {
  categories[t.category] = (categories[t.category] || 0) + 1;
});

Object.keys(categories).sort().forEach(cat => {
  console.log(`   ${cat.padEnd(20)}: ${categories[cat]}个工具`);
});

// 4. 验证新增的Office和Data Science工具
console.log('\n🎯 新增工具验证:');

const officeTools = tools.filter(t => t.category === 'office');
console.log(`   Office工具: ${officeTools.length}个`);
officeTools.forEach(t => console.log(`      - ${t.id}`));

const dataScienceTools = tools.filter(t => t.category === 'data-science');
console.log(`   Data Science工具: ${dataScienceTools.length}个`);
dataScienceTools.forEach(t => console.log(`      - ${t.id}`));

// 5. 验证工具结构完整性
console.log('\n🔍 结构完整性检查:');
const requiredFields = ['id', 'name', 'display_name', 'description', 'category', 'tool_type', 'parameters_schema', 'return_schema'];
let invalidTools = [];

tools.forEach(tool => {
  const missingFields = requiredFields.filter(field => !tool[field]);
  if (missingFields.length > 0) {
    invalidTools.push({ id: tool.id, missingFields });
  }
});

if (invalidTools.length > 0) {
  console.log(`   ❌ 发现${invalidTools.length}个工具缺少必需字段:`);
  invalidTools.forEach(t => {
    console.log(`      - ${t.id}: 缺少 ${t.missingFields.join(', ')}`);
  });
} else {
  console.log(`   ✅ 所有工具结构完整`);
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
if (duplicates.length === 0 && invalidTools.length === 0) {
  console.log('║  ✅ 验证通过！工具整合成功                              ║');
} else {
  console.log('║  ❌ 验证失败，存在问题                                  ║');
}
console.log('╚══════════════════════════════════════════════════════════╝\n');

process.exit(duplicates.length > 0 || invalidTools.length > 0 ? 1 : 0);
