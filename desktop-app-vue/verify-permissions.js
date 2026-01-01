/**
 * 验证permissions是否成功应用到builtin-tools.js
 */

const tools = require('./src/main/skill-tool-system/builtin-tools.js');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  验证Permissions应用结果                                ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const withPermissions = tools.filter(t => t.required_permissions && t.required_permissions.length > 0);
const withoutPermissions = tools.filter(t => !t.required_permissions || t.required_permissions.length === 0);

console.log(`总工具数: ${tools.length}`);
console.log(`有permissions: ${withPermissions.length} (${(withPermissions.length/tools.length*100).toFixed(1)}%)`);
console.log(`无permissions: ${withoutPermissions.length} (${(withoutPermissions.length/tools.length*100).toFixed(1)}%)`);

if (withoutPermissions.length > 0) {
  console.log('\n仍然缺少permissions的工具:');
  withoutPermissions.slice(0, 10).forEach(t => {
    console.log(`  - ${t.id} (${t.category})`);
  });
  if (withoutPermissions.length > 10) {
    console.log(`  ... 还有${withoutPermissions.length - 10}个`);
  }
}

// 检查几个示例工具
console.log('\n示例工具验证:');
const sampleIds = ['tool_html_generator', 'tool_json_parser', 'tool_text_analyzer'];

sampleIds.forEach(id => {
  const tool = tools.find(t => t.id === id);
  if (tool) {
    console.log(`\n${id}:`);
    console.log(`  category: ${tool.category}`);
    console.log(`  risk_level: ${tool.risk_level || 1}`);
    console.log(`  has permissions: ${tool.required_permissions ? 'YES' : 'NO'}`);
    if (tool.required_permissions && tool.required_permissions.length > 0) {
      console.log(`  permissions count: ${tool.required_permissions.length}`);
      console.log(`  permissions:`, JSON.stringify(tool.required_permissions, null, 4));
    }
  }
});

// 统计权限使用情况
const permissionUsage = {};
tools.forEach(t => {
  if (t.required_permissions) {
    t.required_permissions.forEach(perm => {
      permissionUsage[perm] = (permissionUsage[perm] || 0) + 1;
    });
  }
});

console.log('\n权限使用统计（前10）:');
Object.entries(permissionUsage)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([perm, count]) => {
    console.log(`  ${perm}: ${count}个工具`);
  });

console.log('\n═══════════════════════════════════════════════════════════');
if (withoutPermissions.length === 0) {
  console.log('✅ 所有工具都有required_permissions！');
} else {
  console.log(`⚠️  还有${withoutPermissions.length}个工具缺少permissions`);
}
console.log('═══════════════════════════════════════════════════════════\n');
