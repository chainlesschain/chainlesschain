/**
 * 分析权限格式
 * 识别点号格式和冒号格式的使用情况
 */

const tools = require('./src/main/skill-tool-system/builtin-tools.js');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  权限格式分析                                            ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 收集所有权限
const allPermissions = new Set();
const dotFormatPermissions = new Set();  // file.write
const colonFormatPermissions = new Set();  // file:write
const toolsWithDotFormat = [];
const toolsWithColonFormat = [];
const toolsWithMixedFormat = [];

tools.forEach(tool => {
  if (!tool.required_permissions || tool.required_permissions.length === 0) {
    return;
  }

  const hasDot = tool.required_permissions.some(p => p.includes('.'));
  const hasColon = tool.required_permissions.some(p => p.includes(':'));

  tool.required_permissions.forEach(perm => {
    allPermissions.add(perm);
    if (perm.includes('.')) {
      dotFormatPermissions.add(perm);
    }
    if (perm.includes(':')) {
      colonFormatPermissions.add(perm);
    }
  });

  if (hasDot && hasColon) {
    toolsWithMixedFormat.push(tool);
  } else if (hasDot) {
    toolsWithDotFormat.push(tool);
  } else if (hasColon) {
    toolsWithColonFormat.push(tool);
  }
});

console.log(`总权限类型数: ${allPermissions.size}`);
console.log(`点号格式权限: ${dotFormatPermissions.size}种`);
console.log(`冒号格式权限: ${colonFormatPermissions.size}种\n`);

console.log(`使用点号格式的工具: ${toolsWithDotFormat.length}个`);
console.log(`使用冒号格式的工具: ${toolsWithColonFormat.length}个`);
console.log(`混用两种格式的工具: ${toolsWithMixedFormat.length}个\n`);

// 显示点号格式权限列表
console.log('点号格式权限列表:');
const dotPerms = Array.from(dotFormatPermissions).sort();
dotPerms.forEach(perm => {
  const count = tools.filter(t =>
    t.required_permissions && t.required_permissions.includes(perm)
  ).length;
  console.log(`  ${perm} - 使用工具数: ${count}`);
});

// 显示冒号格式权限列表（前20个）
console.log('\n冒号格式权限列表（前20个）:');
const colonPerms = Array.from(colonFormatPermissions).sort();
colonPerms.slice(0, 20).forEach(perm => {
  const count = tools.filter(t =>
    t.required_permissions && t.required_permissions.includes(perm)
  ).length;
  console.log(`  ${perm} - 使用工具数: ${count}`);
});
if (colonPerms.length > 20) {
  console.log(`  ... 还有${colonPerms.length - 20}个`);
}

// 检查是否有可以转换的权限
console.log('\n可转换的点号格式权限:');
const conversionMap = {};
dotPerms.forEach(dotPerm => {
  const colonPerm = dotPerm.replace(/\./g, ':');
  conversionMap[dotPerm] = colonPerm;

  const dotCount = tools.filter(t =>
    t.required_permissions && t.required_permissions.includes(dotPerm)
  ).length;
  const colonCount = tools.filter(t =>
    t.required_permissions && t.required_permissions.includes(colonPerm)
  ).length;

  console.log(`  ${dotPerm} → ${colonPerm}`);
  console.log(`    当前使用: 点号${dotCount}个工具, 冒号${colonCount}个工具`);
});

// 显示混用格式的工具示例
if (toolsWithMixedFormat.length > 0) {
  console.log('\n混用格式的工具示例:');
  toolsWithMixedFormat.slice(0, 5).forEach(tool => {
    console.log(`  ${tool.id}:`);
    console.log(`    ${tool.required_permissions.join(', ')}`);
  });
}

// 保存分析结果
const fs = require('fs');
const report = {
  summary: {
    totalPermissions: allPermissions.size,
    dotFormatCount: dotFormatPermissions.size,
    colonFormatCount: colonFormatPermissions.size,
    toolsWithDot: toolsWithDotFormat.length,
    toolsWithColon: toolsWithColonFormat.length,
    toolsWithMixed: toolsWithMixedFormat.length
  },
  dotFormatPermissions: Array.from(dotFormatPermissions).sort(),
  colonFormatPermissions: Array.from(colonFormatPermissions).sort(),
  conversionMap: conversionMap,
  toolsNeedingConversion: toolsWithDotFormat.concat(toolsWithMixedFormat).map(t => ({
    id: t.id,
    name: t.name,
    permissions: t.required_permissions
  }))
};

fs.writeFileSync('./permission-format-analysis.json', JSON.stringify(report, null, 2));
console.log('\n📄 分析报告已保存到: permission-format-analysis.json');

console.log('\n═══════════════════════════════════════════════════════════');
console.log('建议: 统一使用冒号格式（file:write）');
console.log(`需要转换: ${toolsWithDotFormat.length + toolsWithMixedFormat.length}个工具`);
console.log('═══════════════════════════════════════════════════════════\n');
