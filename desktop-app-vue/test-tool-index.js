/**
 * 工具索引系统测试
 * 验证索引功能和性能
 */

const { getToolIndex, ToolIndex } = require('./src/main/skill-tool-system/tool-index');
const tools = require('./src/main/skill-tool-system/builtin-tools');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  工具索引系统测试                                        ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 创建索引
console.log('⏳ 正在构建索引...');
const startTime = Date.now();
const index = getToolIndex();
const buildTime = Date.now() - startTime;
console.log(`✅ 索引构建完成，耗时: ${buildTime}ms\n`);

// 1. 基础功能测试
console.log('═══ 1. 基础功能测试 ═══\n');

// 测试通过ID查找
console.log('测试: 通过ID查找工具');
const tool1 = index.getById('tool_contract_analyzer');
console.log(`  ✅ getById('tool_contract_analyzer'): ${tool1 ? tool1.display_name : 'NOT FOUND'}`);

// 测试通过Name查找
console.log('\n测试: 通过Name查找工具');
const tool2 = index.getByName('contract_analyzer');
console.log(`  ✅ getByName('contract_analyzer'): ${tool2 ? tool2.display_name : 'NOT FOUND'}`);

// 测试通过类别查找
console.log('\n测试: 通过Category查找工具');
const aiTools = index.getByCategory('ai');
console.log(`  ✅ getByCategory('ai'): ${aiTools.length}个工具`);
console.log(`     示例: ${aiTools.slice(0, 3).map(t => t.name).join(', ')}`);

// 测试通过权限查找
console.log('\n测试: 通过Permission查找工具');
const fileReadTools = index.getByPermission('file:read');
console.log(`  ✅ getByPermission('file:read'): ${fileReadTools.length}个工具`);

// 测试通过风险级别查找
console.log('\n测试: 通过Risk Level查找工具');
const level1Tools = index.getByRiskLevel(1);
const level2Tools = index.getByRiskLevel(2);
const level3Tools = index.getByRiskLevel(3);
console.log(`  ✅ getByRiskLevel(1): ${level1Tools.length}个工具`);
console.log(`  ✅ getByRiskLevel(2): ${level2Tools.length}个工具`);
console.log(`  ✅ getByRiskLevel(3): ${level3Tools.length}个工具`);

// 2. 高级功能测试
console.log('\n═══ 2. 高级功能测试 ═══\n');

// 测试获取所有类别
console.log('测试: 获取所有类别');
const allCategories = index.getAllCategories();
console.log(`  ✅ getAllCategories(): ${allCategories.length}个类别`);
console.log(`     前10个: ${allCategories.slice(0, 10).join(', ')}`);

// 测试获取所有权限
console.log('\n测试: 获取所有权限类型');
const allPermissions = index.getAllPermissions();
console.log(`  ✅ getAllPermissions(): ${allPermissions.length}个权限类型`);
console.log(`     前10个: ${allPermissions.slice(0, 10).join(', ')}`);

// 测试多条件查询
console.log('\n测试: 多条件查询');
const queryResult1 = index.query({ category: 'ai', riskLevel: 1 });
console.log(`  ✅ query({category:'ai', riskLevel:1}): ${queryResult1.length}个工具`);

const queryResult2 = index.query({ permissions: ['data:read'] });
console.log(`  ✅ query({permissions:['data:read']}): ${queryResult2.length}个工具`);

// 测试搜索
console.log('\n测试: 模糊搜索');
const searchResult1 = index.search('contract');
console.log(`  ✅ search('contract'): ${searchResult1.length}个工具`);
console.log(`     示例: ${searchResult1.slice(0, 3).map(t => t.name).join(', ')}`);

const searchResult2 = index.search('分析');
console.log(`  ✅ search('分析'): ${searchResult2.length}个工具`);

// 3. 统计信息测试
console.log('\n═══ 3. 统计信息 ═══\n');

const stats = index.getStats();
console.log(`总工具数: ${stats.totalTools}`);
console.log(`类别数量: ${stats.categoriesCount}`);
console.log(`权限类型数量: ${stats.permissionsCount}`);
console.log(`风险级别数量: ${stats.riskLevelsCount}`);

console.log('\n按类别统计（前10）:');
Object.entries(stats.byCategory)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}个`);
  });

console.log('\n权限使用排行（前10）:');
stats.topPermissions.forEach((item, i) => {
  console.log(`  ${i+1}. ${item.permission}: ${item.count}个工具`);
});

console.log('\n按风险级别统计:');
Object.entries(stats.byRiskLevel)
  .sort((a, b) => a[0] - b[0])
  .forEach(([level, count]) => {
    console.log(`  Level ${level}: ${count}个`);
  });

// 4. 健康检查
console.log('\n═══ 4. 健康检查 ═══\n');

const health = index.healthCheck();
console.log(`健康状态: ${health.healthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);

if (!health.healthy) {
  console.log('问题:');
  health.issues.forEach(issue => console.log(`  - ${issue}`));
}

console.log('\n索引大小:');
Object.entries(health.indexSizes).forEach(([name, size]) => {
  console.log(`  ${name}: ${size}`);
});

// 5. 性能测试
console.log('\n═══ 5. 性能测试 ═══\n');

// 测试通过ID查找性能
console.log('测试: ID查找性能');
const iterations = 10000;

// 无索引查找（遍历数组）
let start = Date.now();
for (let i = 0; i < iterations; i++) {
  const randomId = tools[Math.floor(Math.random() * tools.length)].id;
  tools.find(t => t.id === randomId);
}
const noIndexTime = Date.now() - start;

// 有索引查找（Map查找）
start = Date.now();
for (let i = 0; i < iterations; i++) {
  const randomId = tools[Math.floor(Math.random() * tools.length)].id;
  index.getById(randomId);
}
const withIndexTime = Date.now() - start;

console.log(`  无索引（数组遍历）: ${noIndexTime}ms`);
console.log(`  有索引（Map查找）: ${withIndexTime}ms`);
console.log(`  性能提升: ${(noIndexTime / withIndexTime).toFixed(2)}x`);

// 测试类别查找性能
console.log('\n测试: Category查找性能');

// 无索引
start = Date.now();
for (let i = 0; i < 1000; i++) {
  tools.filter(t => t.category === 'ai');
}
const noCatIndexTime = Date.now() - start;

// 有索引
start = Date.now();
for (let i = 0; i < 1000; i++) {
  index.getByCategory('ai');
}
const withCatIndexTime = Date.now() - start;

console.log(`  无索引（数组过滤）: ${noCatIndexTime}ms`);
console.log(`  有索引（Map查找）: ${withCatIndexTime}ms`);
console.log(`  性能提升: ${(noCatIndexTime / withCatIndexTime).toFixed(2)}x`);

// 6. 内存占用估算
console.log('\n═══ 6. 内存占用估算 ═══\n');

// 粗略估算
const toolsMemory = JSON.stringify(tools).length;
const indexMemory =
  JSON.stringify([...index.byId.keys()]).length +
  JSON.stringify([...index.byName.keys()]).length +
  JSON.stringify([...index.byCategory.keys()]).length +
  JSON.stringify([...index.byPermission.keys()]).length;

console.log(`工具数据大小: ~${(toolsMemory / 1024).toFixed(2)}KB`);
console.log(`索引额外占用: ~${(indexMemory / 1024).toFixed(2)}KB`);
console.log(`内存开销: ${((indexMemory / toolsMemory) * 100).toFixed(2)}%`);

console.log('\n═══════════════════════════════════════════════════════════');
console.log('✅ 所有测试完成！');
console.log('═══════════════════════════════════════════════════════════\n');
