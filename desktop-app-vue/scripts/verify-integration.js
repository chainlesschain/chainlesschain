/**
 * 菜单集成自动验证脚本
 * 验证所有路由和组件是否正确配置
 */

const fs = require('fs');
const path = require('path');

console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║         ChainlessChain v0.26.2 集成验证工具                  ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log();

// 测试配置
const tests = {
  menuItems: [],
  routes: [],
  components: [],
  icons: []
};

let passCount = 0;
let failCount = 0;
let warnCount = 0;

// 14个新增功能
const features = [
  // 监控与诊断
  { id: 1, name: 'LLM性能监控', menuKey: 'llm-performance', route: '/llm/performance', component: 'LLMPerformancePage.vue', group: '监控与诊断' },
  { id: 2, name: '数据库性能监控', menuKey: 'database-performance', route: '/database/performance', component: 'DatabasePerformancePage.vue', group: '监控与诊断' },
  { id: 3, name: '错误监控', menuKey: 'error-monitor', route: '/error/monitor', component: 'ErrorMonitorPage.vue', group: '监控与诊断' },
  { id: 4, name: '会话管理', menuKey: 'session-manager', route: '/sessions', component: 'SessionManagerPage.vue', group: '监控与诊断' },
  { id: 5, name: '内存仪表板', menuKey: 'memory-dashboard', route: '/memory', component: 'MemoryDashboardPage.vue', group: '监控与诊断' },
  { id: 6, name: '标签管理', menuKey: 'tag-manager', route: '/tags', component: 'TagManagerPage.vue', group: '监控与诊断' },
  // MCP和AI配置
  { id: 7, name: 'MCP服务器', menuKey: 'mcp-settings', route: '/settings', query: 'tab=mcp', component: 'SettingsPage.vue', group: 'MCP和AI配置' },
  { id: 8, name: 'Token使用统计', menuKey: 'token-usage', route: '/settings', query: 'tab=token-usage', component: 'SettingsPage.vue', group: 'MCP和AI配置' },
  // P2P高级功能
  { id: 9, name: '设备配对', menuKey: 'p2p-device-pairing', route: '/p2p/device-pairing', component: 'p2p/DevicePairingPage.vue', group: 'P2P高级功能' },
  { id: 10, name: '设备管理', menuKey: 'p2p-device-management', route: '/p2p/device-management', component: 'p2p/DeviceManagementPage.vue', group: 'P2P高级功能' },
  { id: 11, name: '文件传输', menuKey: 'p2p-file-transfer', route: '/p2p/file-transfer', component: 'p2p/FileTransferPage.vue', group: 'P2P高级功能' },
  { id: 12, name: '安全号码验证', menuKey: 'p2p-safety-numbers', route: '/p2p/safety-numbers', component: 'p2p/SafetyNumbersPage.vue', group: 'P2P高级功能' },
  { id: 13, name: '会话指纹', menuKey: 'p2p-session-fingerprint', route: '/p2p/session-fingerprint', component: 'p2p/SessionFingerprintPage.vue', group: 'P2P高级功能' },
  { id: 14, name: '消息队列', menuKey: 'p2p-message-queue', route: '/p2p/message-queue', component: 'p2p/MessageQueuePage.vue', group: 'P2P高级功能' },
];

// 读取文件
const mainLayoutPath = path.join(__dirname, '../src/renderer/components/MainLayout.vue');
const routerPath = path.join(__dirname, '../src/renderer/router/index.js');
const mcpSettingsPath = path.join(__dirname, '../src/renderer/components/MCPSettings.vue');
const pagesDir = path.join(__dirname, '../src/renderer/pages');

console.log('📂 检查文件位置...');
console.log(`   MainLayout: ${fs.existsSync(mainLayoutPath) ? '✓' : '✗'}`);
console.log(`   Router: ${fs.existsSync(routerPath) ? '✓' : '✗'}`);
console.log(`   MCPSettings: ${fs.existsSync(mcpSettingsPath) ? '✓' : '✗'}`);
console.log(`   Pages目录: ${fs.existsSync(pagesDir) ? '✓' : '✗'}`);
console.log();

// 读取内容
const mainLayoutContent = fs.readFileSync(mainLayoutPath, 'utf8');
const routerContent = fs.readFileSync(routerPath, 'utf8');
const mcpSettingsContent = fs.readFileSync(mcpSettingsPath, 'utf8');

// 测试1: 菜单配置
console.log('═══════════════════════════════════════════════════════════════');
console.log('【1/5】检查菜单配置 (MainLayout.vue)');
console.log('═══════════════════════════════════════════════════════════════');

let menuGroup = '';
features.forEach(feature => {
  if (feature.group !== menuGroup) {
    menuGroup = feature.group;
    console.log(`\n▸ ${menuGroup}:`);
  }

  const hasMenuKey = mainLayoutContent.includes(`key="${feature.menuKey}"`);
  const hasMenuConfig = mainLayoutContent.includes(`"${feature.menuKey}"`);

  if (hasMenuKey && hasMenuConfig) {
    console.log(`  ✓ ${feature.name.padEnd(20)} [${feature.menuKey}]`);
    passCount++;
  } else {
    console.log(`  ✗ ${feature.name.padEnd(20)} [${feature.menuKey}] - 配置缺失`);
    failCount++;
  }
});

// 测试2: 路由配置
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('【2/5】检查路由配置 (router/index.js)');
console.log('═══════════════════════════════════════════════════════════════');

menuGroup = '';
features.forEach(feature => {
  if (feature.group !== menuGroup) {
    menuGroup = feature.group;
    console.log(`\n▸ ${menuGroup}:`);
  }

  const routePath = feature.route.replace(/\//g, '\\/');
  const hasRoute = routerContent.includes(`path: "${feature.route}"`) ||
                   routerContent.includes(`path: '${feature.route}'`) ||
                   routerContent.includes(`path: "${feature.route.replace('/','')}"`) ||
                   routerContent.includes(`path: '${feature.route.replace('/','')}'`);

  const fullPath = feature.query ? `${feature.route}?${feature.query}` : feature.route;

  if (hasRoute) {
    console.log(`  ✓ ${feature.name.padEnd(20)} → ${fullPath}`);
    passCount++;
  } else {
    console.log(`  ✗ ${feature.name.padEnd(20)} → ${fullPath} - 路由缺失`);
    failCount++;
  }
});

// 测试3: 页面组件
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('【3/5】检查页面组件文件');
console.log('═══════════════════════════════════════════════════════════════');

menuGroup = '';
features.forEach(feature => {
  if (feature.group !== menuGroup) {
    menuGroup = feature.group;
    console.log(`\n▸ ${menuGroup}:`);
  }

  const componentPath = path.join(pagesDir, feature.component);
  const exists = fs.existsSync(componentPath);

  if (exists) {
    const stat = fs.statSync(componentPath);
    const size = (stat.size / 1024).toFixed(1);
    console.log(`  ✓ ${feature.component.padEnd(35)} (${size} KB)`);
    passCount++;
  } else {
    console.log(`  ✗ ${feature.component.padEnd(35)} - 文件不存在`);
    failCount++;
  }
});

// 测试4: MCP重启功能
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('【4/5】检查MCP重启功能 (MCPSettings.vue)');
console.log('═══════════════════════════════════════════════════════════════');

const mcpChecks = [
  { name: 'needsRestart 状态变量', pattern: /const needsRestart = ref\(false\)/, required: true },
  { name: '重启提示警告框', pattern: /v-if="needsRestart"/, required: true },
  { name: '立即重启应用按钮', pattern: /@click="handleRestartApp"/, required: true },
  { name: 'handleRestartApp 方法', pattern: /const handleRestartApp = async/, required: true },
  { name: 'system:restart IPC调用', pattern: /system:restart/, required: true },
  { name: 'ReloadOutlined 图标', pattern: /ReloadOutlined/, required: false },
];

mcpChecks.forEach(check => {
  const found = check.pattern.test(mcpSettingsContent);
  if (found) {
    console.log(`  ✓ ${check.name}`);
    passCount++;
  } else if (check.required) {
    console.log(`  ✗ ${check.name} - 未找到`);
    failCount++;
  } else {
    console.log(`  ⚠ ${check.name} - 未找到（可选）`);
    warnCount++;
  }
});

// 测试5: 测试URL生成
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('【5/5】生成测试URL列表');
console.log('═══════════════════════════════════════════════════════════════');

console.log('\n可以直接在浏览器中测试以下URL:\n');
console.log('基础URL: http://127.0.0.1:5173/#\n');

let idx = 1;
features.forEach(feature => {
  const fullPath = feature.query ? `${feature.route}?${feature.query}` : feature.route;
  const url = `http://127.0.0.1:5173/#${fullPath}`;
  console.log(`${String(idx).padStart(2, ' ')}. ${feature.name.padEnd(20)} ${url}`);
  idx++;
});

// 总结
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('验证结果总结');
console.log('═══════════════════════════════════════════════════════════════');

const totalChecks = passCount + failCount + warnCount;
const successRate = ((passCount / totalChecks) * 100).toFixed(1);

console.log();
console.log(`  总检查项: ${totalChecks}`);
console.log(`  ✓ 通过: ${passCount} (${successRate}%)`);
console.log(`  ✗ 失败: ${failCount}`);
console.log(`  ⚠ 警告: ${warnCount}`);
console.log();

if (failCount === 0) {
  console.log('  🎉 所有检查都通过了！');
  console.log();
  console.log('  下一步:');
  console.log('  1. 启动应用: npm run dev');
  console.log('  2. 访问上面的测试URL');
  console.log('  3. 或运行自动化测试脚本（见 FINAL_TEST_GUIDE.md）');
} else {
  console.log('  ⚠️  发现问题，请检查失败项');
}

console.log();
console.log('═══════════════════════════════════════════════════════════════');

// 退出码
process.exit(failCount > 0 ? 1 : 0);
