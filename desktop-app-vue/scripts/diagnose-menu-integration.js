/**
 * 菜单集成诊断脚本
 * 检查新增菜单项的配置完整性
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(60));
console.log('菜单集成诊断报告');
console.log('='.repeat(60));
console.log();

// 新增菜单项配置
const newMenuItems = [
  // 监控与诊断 (6项)
  { key: 'llm-performance', path: '/llm/performance', component: 'LLMPerformancePage.vue', title: 'LLM性能监控' },
  { key: 'database-performance', path: '/database/performance', component: 'DatabasePerformancePage.vue', title: '数据库性能监控' },
  { key: 'error-monitor', path: '/error/monitor', component: 'ErrorMonitorPage.vue', title: '错误监控' },
  { key: 'session-manager', path: '/sessions', component: 'SessionManagerPage.vue', title: '会话管理' },
  { key: 'memory-dashboard', path: '/memory', component: 'MemoryDashboardPage.vue', title: '内存仪表板' },
  { key: 'tag-manager', path: '/tags', component: 'TagManagerPage.vue', title: '标签管理' },
  // MCP和AI配置 (2项)
  { key: 'mcp-settings', path: '/settings?tab=mcp', component: 'SettingsPage.vue', title: 'MCP服务器配置' },
  { key: 'token-usage', path: '/settings?tab=token-usage', component: 'SettingsPage.vue', title: 'Token使用统计' },
  // P2P高级功能 (6项)
  { key: 'p2p-device-pairing', path: '/p2p/device-pairing', component: 'p2p/DevicePairingPage.vue', title: '设备配对' },
  { key: 'p2p-device-management', path: '/p2p/device-management', component: 'p2p/DeviceManagementPage.vue', title: '设备管理' },
  { key: 'p2p-file-transfer', path: '/p2p/file-transfer', component: 'p2p/FileTransferPage.vue', title: '文件传输' },
  { key: 'p2p-safety-numbers', path: '/p2p/safety-numbers', component: 'p2p/SafetyNumbersPage.vue', title: '安全号码验证' },
  { key: 'p2p-session-fingerprint', path: '/p2p/session-fingerprint', component: 'p2p/SessionFingerprintPage.vue', title: '会话指纹' },
  { key: 'p2p-message-queue', path: '/p2p/message-queue', component: 'p2p/MessageQueuePage.vue', title: '消息队列' },
];

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

// 检查 MainLayout.vue 中的菜单项
console.log('1. 检查 MainLayout.vue 中的菜单配置');
console.log('-'.repeat(60));
const mainLayoutPath = path.join(__dirname, '../src/renderer/components/MainLayout.vue');
const mainLayoutContent = fs.readFileSync(mainLayoutPath, 'utf8');

newMenuItems.forEach(item => {
  totalChecks++;
  const hasMenuItem = mainLayoutContent.includes(`key="${item.key}"`);
  const hasMenuConfig = mainLayoutContent.includes(`"${item.key}"`);

  if (hasMenuItem && hasMenuConfig) {
    console.log(`✓ ${item.title} (key: ${item.key})`);
    passedChecks++;
  } else {
    console.log(`✗ ${item.title} (key: ${item.key}) - 缺失: ${!hasMenuItem ? '菜单项' : ''}${!hasMenuConfig ? '配置' : ''}`);
    failedChecks++;
  }
});

console.log();

// 检查路由配置
console.log('2. 检查路由配置 (router/index.js)');
console.log('-'.repeat(60));
const routerPath = path.join(__dirname, '../src/renderer/router/index.js');
const routerContent = fs.readFileSync(routerPath, 'utf8');

newMenuItems.forEach(item => {
  totalChecks++;
  const routePath = item.path.split('?')[0]; // 移除查询参数
  const hasRoute = routerContent.includes(`path: "${routePath}"`) || routerContent.includes(`path: '${routePath}'`);

  if (hasRoute) {
    console.log(`✓ ${item.path}`);
    passedChecks++;
  } else {
    console.log(`✗ ${item.path} - 路由未注册`);
    failedChecks++;
  }
});

console.log();

// 检查页面组件文件
console.log('3. 检查页面组件文件');
console.log('-'.repeat(60));
const pagesDir = path.join(__dirname, '../src/renderer/pages');

newMenuItems.forEach(item => {
  totalChecks++;
  const componentPath = path.join(pagesDir, item.component);
  const exists = fs.existsSync(componentPath);

  if (exists) {
    console.log(`✓ ${item.component}`);
    passedChecks++;
  } else {
    console.log(`✗ ${item.component} - 文件不存在`);
    failedChecks++;
  }
});

console.log();
console.log('='.repeat(60));
console.log(`诊断完成: ${passedChecks}/${totalChecks} 检查通过`);
console.log(`  通过: ${passedChecks}`);
console.log(`  失败: ${failedChecks}`);
console.log('='.repeat(60));

// 返回非零退出码如果有失败
process.exit(failedChecks > 0 ? 1 : 0);
