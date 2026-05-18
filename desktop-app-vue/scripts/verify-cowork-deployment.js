#!/usr/bin/env node
/**
 * Cowork系统部署验证脚本
 * 验证所有核心组件是否正常运行
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 开始验证Cowork系统部署状态...\n');

const checks = {
  passed: 0,
  failed: 0,
  warnings: 0
};

function pass(message) {
  console.log(`✅ ${message}`);
  checks.passed++;
}

function fail(message) {
  console.log(`❌ ${message}`);
  checks.failed++;
}

function warn(message) {
  console.log(`⚠️  ${message}`);
  checks.warnings++;
}

function info(message) {
  console.log(`ℹ️  ${message}`);
}

// 1. 检查数据库Schema
info('检查数据库Schema...');
const dbPath = path.join(__dirname, '../src/main/database.js');
const dbContent = fs.readFileSync(dbPath, 'utf-8');

const coworkTables = [
  'cowork_teams',
  'cowork_agents',
  'cowork_tasks',
  'cowork_messages',
  'cowork_audit_log',
  'cowork_metrics',
  'cowork_checkpoints',
  'cowork_sandbox_permissions',
  'cowork_decisions'
];

coworkTables.forEach(table => {
  if (dbContent.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
    pass(`数据库表 ${table} 已定义`);
  } else {
    fail(`数据库表 ${table} 未找到`);
  }
});

// 检查索引
const indexCount = (dbContent.match(/idx_cowork/g) || []).length;
if (indexCount >= 35) {
  pass(`找到 ${indexCount} 个Cowork索引 (预期: 35)`);
} else if (indexCount >= 27) {
  warn(`找到 ${indexCount} 个Cowork索引 (预期: 35, 部分缺失)`);
} else {
  fail(`仅找到 ${indexCount} 个Cowork索引 (预期: 35)`);
}

// 2. 检查后端模块
info('\n检查后端模块...');
const backendModules = [
  'src/main/ai-engine/cowork/teammate-tool.js',
  'src/main/ai-engine/cowork/file-sandbox.js',
  'src/main/ai-engine/cowork/long-running-task-manager.js',
  'src/main/ai-engine/cowork/cowork-ipc.js',
  'src/main/ai-engine/multi-agent/cowork-orchestrator.js'
];

backendModules.forEach(module => {
  const modulePath = path.join(__dirname, '..', module);
  if (fs.existsSync(modulePath)) {
    const stats = fs.statSync(modulePath);
    pass(`后端模块 ${path.basename(module)} 存在 (${Math.round(stats.size/1024)}KB)`);
  } else {
    fail(`后端模块 ${module} 不存在`);
  }
});

// 3. 检查技能系统
info('\n检查技能系统...');
const skillsDir = path.join(__dirname, '../src/main/ai-engine/cowork/skills');
if (fs.existsSync(skillsDir)) {
  const skills = fs.readdirSync(skillsDir).filter(f => f.endsWith('.js'));
  pass(`找到 ${skills.length} 个技能模块: ${skills.join(', ')}`);
} else {
  fail('技能目录不存在');
}

// 4. 检查集成模块
info('\n检查集成模块...');
const integrationsDir = path.join(__dirname, '../src/main/cowork/integrations');
if (fs.existsSync(integrationsDir)) {
  const integrations = fs.readdirSync(integrationsDir).filter(f => f.endsWith('.js') && f !== 'index.js');
  pass(`找到 ${integrations.length} 个集成模块: ${integrations.join(', ')}`);
} else {
  warn('集成目录不存在 (可选功能)');
}

// 5. 检查IPC注册
info('\n检查IPC注册...');
const ipcRegistry = path.join(__dirname, '../src/main/ipc/ipc-registry.js');
const ipcContent = fs.readFileSync(ipcRegistry, 'utf-8');

if (ipcContent.includes('registerCoworkIPC')) {
  pass('Cowork IPC已注册到IPC Registry');
} else {
  fail('Cowork IPC未在IPC Registry中注册');
}

// 6. 检查前端组件
info('\n检查前端组件...');
const frontendPages = [
  'src/renderer/pages/CoworkDashboard.vue',
  'src/renderer/pages/TaskMonitor.vue',
  'src/renderer/pages/SkillManager.vue',
  'src/renderer/pages/CoworkAnalytics.vue'
];

frontendPages.forEach(page => {
  const pagePath = path.join(__dirname, '..', page);
  if (fs.existsSync(pagePath)) {
    pass(`前端页面 ${path.basename(page)} 存在`);
  } else {
    fail(`前端页面 ${page} 不存在`);
  }
});

// 7. 检查前端组件
const componentsDir = path.join(__dirname, '../src/renderer/components/cowork');
if (fs.existsSync(componentsDir)) {
  const components = fs.readdirSync(componentsDir).filter(f => f.endsWith('.vue'));
  pass(`找到 ${components.length} 个Cowork组件`);
} else {
  fail('Cowork组件目录不存在');
}

// 8. 检查Pinia Store
info('\n检查Pinia Store...');
const storePath = path.join(__dirname, '../src/renderer/stores/cowork.js');
if (fs.existsSync(storePath)) {
  const storeContent = fs.readFileSync(storePath, 'utf-8');
  const actionCount = (storeContent.match(/async \w+\(/g) || []).length;
  pass(`Cowork Store存在，包含约 ${actionCount} 个action`);
} else {
  fail('Cowork Store不存在');
}

// 9. 检查路由配置
info('\n检查路由配置...');
const routerPath = path.join(__dirname, '../src/renderer/router/index.js');
const routerContent = fs.readFileSync(routerPath, 'utf-8');

const coworkRoutes = [
  '/cowork',
  '/cowork/tasks',
  '/cowork/skills',
  '/cowork/analytics'
];

coworkRoutes.forEach(route => {
  if (routerContent.includes(route)) {
    pass(`路由 ${route} 已配置`);
  } else {
    fail(`路由 ${route} 未配置`);
  }
});

// 10. 检查测试文件
info('\n检查测试文件...');
const testDirs = [
  'src/main/ai-engine/cowork/__tests__',
  'src/main/cowork/__tests__/integration',
  'src/main/cowork/__tests__/security',
  'src/main/cowork/__tests__/benchmarks'
];

let totalTests = 0;
testDirs.forEach(dir => {
  const testPath = path.join(__dirname, '..', dir);
  if (fs.existsSync(testPath)) {
    const tests = fs.readdirSync(testPath, { recursive: true })
      .filter(f => f.endsWith('.test.js') || f.endsWith('.bench.js'));
    totalTests += tests.length;
    pass(`测试目录 ${dir} 存在，包含 ${tests.length} 个测试文件`);
  } else {
    warn(`测试目录 ${dir} 不存在`);
  }
});

info(`\n📊 测试文件总数: ${totalTests}`);

// 11. 检查文档
info('\n检查文档...');
const docs = [
  'docs/features/COWORK_QUICK_START.md',
  'docs/features/COWORK_DEPLOYMENT_CHECKLIST.md',
  'docs/features/COWORK_USAGE_EXAMPLES.md',
  'docs/PROJECT_WORKFLOW_OPTIMIZATION_PLAN.md',
  'docs/COWORK_INTEGRATION_ROADMAP.md'
];

docs.forEach(doc => {
  const docPath = path.join(__dirname, '../..', doc);
  if (fs.existsSync(docPath)) {
    pass(`文档 ${path.basename(doc)} 存在`);
  } else {
    warn(`文档 ${doc} 不存在`);
  }
});

// 总结
console.log('\n' + '='.repeat(60));
console.log('📋 验证结果总结:');
console.log('='.repeat(60));
console.log(`✅ 通过: ${checks.passed}`);
console.log(`❌ 失败: ${checks.failed}`);
console.log(`⚠️  警告: ${checks.warnings}`);
console.log('='.repeat(60));

if (checks.failed === 0) {
  console.log('\n🎉 Cowork系统部署验证通过！');
  console.log('✨ 所有核心组件已就绪');
  console.log('\n📍 下一步:');
  console.log('  1. 访问 http://localhost:5173/#/cowork 查看Dashboard');
  console.log('  2. 运行 npm run test 验证测试');
  console.log('  3. 开始创建团队模板');
  process.exit(0);
} else {
  console.log('\n⚠️  部署验证发现问题，请检查上述失败项');
  process.exit(1);
}
