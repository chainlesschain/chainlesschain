/**
 * 测试健康检查工具
 * 快速验证E2E测试环境是否正常
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('========================================');
console.log('E2E测试环境健康检查');
console.log('========================================\n');

const checks = [];

// Check 1: Node.js版本
async function checkNodeVersion() {
  return new Promise((resolve) => {
    const proc = spawn('node', ['--version']);
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      const version = output.trim();
      const major = parseInt(version.substring(1).split('.')[0]);
      const passed = major >= 16;

      checks.push({
        name: 'Node.js 版本',
        status: passed ? 'PASS' : 'FAIL',
        message: `${version} ${passed ? '(>= v16 ✓)' : '(需要 >= v16 ✗)'}`,
      });
      resolve();
    });
  });
}

// Check 2: npm是否可用
async function checkNpm() {
  return new Promise((resolve) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const proc = spawn(npmCmd, ['--version']);
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.on('error', (err) => {
      checks.push({
        name: 'npm 可用性',
        status: 'WARN',
        message: 'npm 检查失败 (可能在Git Bash环境) ⚠',
      });
      resolve();
    });

    proc.on('close', (code) => {
      if (output) {
        const passed = code === 0;
        checks.push({
          name: 'npm 可用性',
          status: passed ? 'PASS' : 'FAIL',
          message: passed ? `npm ${output.trim()} ✓` : 'npm 不可用 ✗',
        });
      }
      resolve();
    });
  });
}

// Check 3: package.json存在
function checkPackageJson() {
  const packagePath = path.join(__dirname, '..', '..', 'package.json');
  const exists = fs.existsSync(packagePath);

  checks.push({
    name: 'package.json',
    status: exists ? 'PASS' : 'FAIL',
    message: exists ? '存在 ✓' : '不存在 ✗',
  });
}

// Check 4: Playwright已安装
function checkPlaywright() {
  const packagePath = path.join(__dirname, '..', '..', 'package.json');
  if (fs.existsSync(packagePath)) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    const hasPw =
      pkg.devDependencies && pkg.devDependencies['@playwright/test'];

    checks.push({
      name: 'Playwright',
      status: hasPw ? 'PASS' : 'WARN',
      message: hasPw
        ? `已安装 ${pkg.devDependencies['@playwright/test']} ✓`
        : '未在devDependencies中找到 ⚠',
    });
  } else {
    checks.push({
      name: 'Playwright',
      status: 'FAIL',
      message: '无法检查 (package.json不存在) ✗',
    });
  }
}

// Check 5: 测试文件存在
function checkTestFiles() {
  const testFiles = [
    'tests/e2e/llm/llm-test-chat.e2e.test.ts',
    'tests/e2e/p2p/device-pairing.e2e.test.ts',
    'tests/e2e/p2p/safety-numbers.e2e.test.ts',
    'tests/e2e/p2p/session-fingerprint.e2e.test.ts',
    'tests/e2e/p2p/device-management.e2e.test.ts',
    'tests/e2e/p2p/file-transfer.e2e.test.ts',
    'tests/e2e/p2p/message-queue.e2e.test.ts',
    'tests/e2e/test/android-features-test.e2e.test.ts',
  ];

  let existCount = 0;
  testFiles.forEach((file) => {
    const fullPath = path.join(__dirname, '..', '..', file);
    if (fs.existsSync(fullPath)) {
      existCount++;
    }
  });

  const passed = existCount === testFiles.length;
  checks.push({
    name: '测试文件',
    status: passed ? 'PASS' : existCount > 0 ? 'WARN' : 'FAIL',
    message: `${existCount}/${testFiles.length} 个文件存在 ${passed ? '✓' : '⚠'}`,
  });
}

// Check 6: helpers/common.ts存在
function checkHelpers() {
  const helperPath = path.join(__dirname, 'helpers', 'common.ts');
  const exists = fs.existsSync(helperPath);

  checks.push({
    name: '测试助手',
    status: exists ? 'PASS' : 'FAIL',
    message: exists ? 'helpers/common.ts 存在 ✓' : 'helpers/common.ts 不存在 ✗',
  });
}

// Check 7: 功能页面存在
function checkPages() {
  const pages = [
    'src/renderer/pages/LLMTestChatPage.vue',
    'src/renderer/pages/p2p/DevicePairingPage.vue',
    'src/renderer/pages/p2p/SafetyNumbersPage.vue',
    'src/renderer/pages/p2p/SessionFingerprintPage.vue',
    'src/renderer/pages/p2p/DeviceManagementPage.vue',
    'src/renderer/pages/p2p/FileTransferPage.vue',
    'src/renderer/pages/p2p/MessageQueuePage.vue',
    'src/renderer/pages/AndroidFeaturesTestPage.vue',
  ];

  let existCount = 0;
  pages.forEach((page) => {
    const fullPath = path.join(__dirname, '..', '..', page);
    if (fs.existsSync(fullPath)) {
      existCount++;
    }
  });

  const passed = existCount === pages.length;
  checks.push({
    name: '功能页面',
    status: passed ? 'PASS' : existCount > 0 ? 'WARN' : 'FAIL',
    message: `${existCount}/${pages.length} 个页面存在 ${passed ? '✓' : '⚠'}`,
  });
}

// Check 8: 路由配置
function checkRouter() {
  const routerPath = path.join(__dirname, '..', '..', 'src', 'renderer', 'router', 'index.js');
  if (fs.existsSync(routerPath)) {
    const content = fs.readFileSync(routerPath, 'utf-8');
    const hasLLMTest = content.includes('/llm/test-chat');
    const hasP2P = content.includes('/p2p/device-pairing');
    const hasTest = content.includes('/test/android-features');

    const passed = hasLLMTest && hasP2P && hasTest;
    checks.push({
      name: '路由配置',
      status: passed ? 'PASS' : 'WARN',
      message: passed ? '新路由已配置 ✓' : '部分路由可能未配置 ⚠',
    });
  } else {
    checks.push({
      name: '路由配置',
      status: 'FAIL',
      message: 'router/index.js 不存在 ✗',
    });
  }
}

// 运行所有检查
async function runChecks() {
  console.log('开始检查...\n');

  // 运行异步检查
  await checkNodeVersion();
  await checkNpm();

  // 运行同步检查
  checkPackageJson();
  checkPlaywright();
  checkTestFiles();
  checkHelpers();
  checkPages();
  checkRouter();

  console.log('检查结果:');
  console.log('========================================\n');

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  checks.forEach((check) => {
    const symbol =
      check.status === 'PASS' ? '✅' : check.status === 'WARN' ? '⚠️ ' : '❌';

    console.log(`${symbol} ${check.name}: ${check.message}`);

    if (check.status === 'PASS') passCount++;
    else if (check.status === 'WARN') warnCount++;
    else failCount++;
  });

  console.log('\n========================================');
  console.log('总结:');
  console.log(`  通过: ${passCount}`);
  console.log(`  警告: ${warnCount}`);
  console.log(`  失败: ${failCount}`);
  console.log('========================================\n');

  if (failCount > 0) {
    console.log('❌ 存在失败项，请先解决问题再运行测试');
    console.log('\n建议:');
    console.log('  1. 运行 npm install 安装依赖');
    console.log('  2. 检查文件是否正确创建');
    console.log('  3. 确认路由配置是否完整');
    process.exit(1);
  } else if (warnCount > 0) {
    console.log('⚠️  存在警告项，但可以继续运行测试');
    console.log('\n建议:');
    console.log('  1. 检查警告项并酌情修复');
    console.log('  2. 运行 node tests/e2e/quick-verify.js 验证测试文件');
    process.exit(0);
  } else {
    console.log('✅ 所有检查通过，环境健康！');
    console.log('\n下一步:');
    console.log('  1. 运行 node tests/e2e/quick-verify.js 验证测试文件');
    console.log('  2. 运行 npm run test:e2e tests/e2e/ 执行测试');
    console.log('  3. 运行 node tests/e2e/generate-test-report.js 生成报告');
    process.exit(0);
  }
}

// 执行检查
runChecks().catch((err) => {
  console.error('检查失败:', err);
  process.exit(1);
});
