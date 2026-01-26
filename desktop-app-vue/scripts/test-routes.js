/**
 * 路由测试脚本 - 验证所有新增路由是否可访问
 * 用法: node scripts/test-routes.js
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(70));
console.log('路由可访问性测试');
console.log('='.repeat(70));
console.log();

// 读取路由配置文件
const routerPath = path.join(__dirname, '../src/renderer/router/index.js');
const routerContent = fs.readFileSync(routerPath, 'utf8');

// 新增路由列表
const newRoutes = [
  { path: 'llm/performance', name: 'LLMPerformance', title: 'LLM性能监控' },
  { path: 'database/performance', name: 'DatabasePerformance', title: '数据库性能监控' },
  { path: 'error/monitor', name: 'ErrorMonitor', title: '错误监控' },
  { path: 'sessions', name: 'SessionManager', title: '会话管理' },
  { path: 'memory', name: 'MemoryDashboard', title: '内存仪表板' },
  { path: 'tags', name: 'TagManager', title: '标签管理' },
  { path: 'settings', query: 'tab=mcp', title: 'MCP服务器配置' },
  { path: 'settings', query: 'tab=token-usage', title: 'Token使用统计' },
  { path: 'p2p/device-pairing', name: 'P2PDevicePairing', title: '设备配对' },
  { path: 'p2p/device-management', name: 'P2PDeviceManagement', title: '设备管理' },
  { path: 'p2p/file-transfer', name: 'P2PFileTransfer', title: '文件传输' },
  { path: 'p2p/safety-numbers', name: 'P2PSafetyNumbers', title: '安全号码验证' },
  { path: 'p2p/session-fingerprint', name: 'P2PSessionFingerprint', title: '会话指纹' },
  { path: 'p2p/message-queue', name: 'P2PMessageQueue', title: '消息队列' },
];

let passCount = 0;
let failCount = 0;

console.log('1. 检查路由定义');
console.log('-'.repeat(70));

newRoutes.forEach(route => {
  const searchPath = route.path.replace(/\//g, '\\/');
  const hasPath = routerContent.includes(`path: "${route.path}"`) ||
                  routerContent.includes(`path: '${route.path}'`);

  if (hasPath) {
    console.log(`✓ ${route.title}`);
    console.log(`  路径: /${route.path}${route.query ? '?' + route.query : ''}`);
    passCount++;
  } else {
    console.log(`✗ ${route.title} - 路由未找到`);
    failCount++;
  }
});

console.log();
console.log('2. 检查组件文件');
console.log('-'.repeat(70));

const componentMap = {
  'LLMPerformance': 'LLMPerformancePage.vue',
  'DatabasePerformance': 'DatabasePerformancePage.vue',
  'ErrorMonitor': 'ErrorMonitorPage.vue',
  'SessionManager': 'SessionManagerPage.vue',
  'MemoryDashboard': 'MemoryDashboardPage.vue',
  'TagManager': 'TagManagerPage.vue',
  'P2PDevicePairing': 'p2p/DevicePairingPage.vue',
  'P2PDeviceManagement': 'p2p/DeviceManagementPage.vue',
  'P2PFileTransfer': 'p2p/FileTransferPage.vue',
  'P2PSafetyNumbers': 'p2p/SafetyNumbersPage.vue',
  'P2PSessionFingerprint': 'p2p/SessionFingerprintPage.vue',
  'P2PMessageQueue': 'p2p/MessageQueuePage.vue',
};

Object.entries(componentMap).forEach(([name, file]) => {
  const componentPath = path.join(__dirname, '../src/renderer/pages', file);
  if (fs.existsSync(componentPath)) {
    console.log(`✓ ${file}`);
  } else {
    console.log(`✗ ${file} - 文件不存在`);
  }
});

console.log();
console.log('='.repeat(70));
console.log('测试URL列表（登录后在浏览器中访问）');
console.log('='.repeat(70));
console.log();
console.log('基础URL: http://127.0.0.1:5173/#/');
console.log();

newRoutes.forEach((route, index) => {
  const url = `http://127.0.0.1:5173/#/${route.path}${route.query ? '?' + route.query : ''}`;
  console.log(`${String(index + 1).padStart(2, '0')}. ${route.title}`);
  console.log(`    ${url}`);
});

console.log();
console.log('='.repeat(70));
console.log(`✅ 路由配置检查: ${passCount}/${newRoutes.length} 通过`);
console.log('='.repeat(70));
console.log();
console.log('💡 下一步:');
console.log('   1. 确保应用正在运行: npm run dev');
console.log('   2. 登录应用');
console.log('   3. 在浏览器中测试上面的URL');
console.log('   4. 或使用左侧菜单点击测试');
console.log();
