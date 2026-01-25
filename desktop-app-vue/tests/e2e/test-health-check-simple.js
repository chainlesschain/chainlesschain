/**
 * 测试健康检查工具（简化版）
 * 快速验证E2E测试环境是否正常
 */

const fs = require('fs');
const path = require('path');

console.log('========================================');
console.log('E2E测试环境健康检查（简化版）');
console.log('========================================\n');

const checks = [];

// Check 1: Node.js版本
function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.substring(1).split('.')[0]);
  const passed = major >= 16;

  checks.push({
    name: 'Node.js 版本',
    status: passed ? 'PASS' : 'FAIL',
    message: `${version} ${passed ? '(>= v16 ✓)' : '(需要 >= v16 ✗)'}`,
  });
}

// Check 2: package.json存在
function checkPackageJson() {
  const packagePath = path.join(__dirname, '..', '..', 'package.json');
  const exists = fs.existsSync(packagePath);

  checks.push({
    name: 'package.json',
    status: exists ? 'PASS' : 'FAIL',
    message: exists ? '存在 ✓' : '不存在 ✗',
  });

  return exists;
}

// Check 3: Playwright已安装
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

// Check 4: 测试文件存在
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
  const missingFiles = [];

  testFiles.forEach((file) => {
    const fullPath = path.join(__dirname, '..', '..', file);
    if (fs.existsSync(fullPath)) {
      existCount++;
    } else {
      missingFiles.push(file);
    }
  });

  const passed = existCount === testFiles.length;
  checks.push({
    name: '测试文件',
    status: passed ? 'PASS' : existCount > 0 ? 'WARN' : 'FAIL',
    message: `${existCount}/${testFiles.length} 个文件存在 ${passed ? '✓' : '⚠'}`,
    details: missingFiles.length > 0 ? `缺失: ${missingFiles.join(', ')}` : null,
  });

  return { total: testFiles.length, exist: existCount, missing: missingFiles };
}

// Check 5: helpers/common.ts存在
function checkHelpers() {
  const helperPath = path.join(__dirname, 'helpers', 'common.ts');
  const exists = fs.existsSync(helperPath);

  checks.push({
    name: '测试助手',
    status: exists ? 'PASS' : 'FAIL',
    message: exists ? 'helpers/common.ts 存在 ✓' : 'helpers/common.ts 不存在 ✗',
  });
}

// Check 6: 功能页面存在
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
  const missingPages = [];

  pages.forEach((page) => {
    const fullPath = path.join(__dirname, '..', '..', page);
    if (fs.existsSync(fullPath)) {
      existCount++;
    } else {
      missingPages.push(page);
    }
  });

  const passed = existCount === pages.length;
  checks.push({
    name: '功能页面',
    status: passed ? 'PASS' : existCount > 0 ? 'WARN' : 'FAIL',
    message: `${existCount}/${pages.length} 个页面存在 ${passed ? '✓' : '⚠'}`,
    details: missingPages.length > 0 ? `缺失: ${missingPages.join(', ')}` : null,
  });

  return { total: pages.length, exist: existCount, missing: missingPages };
}

// Check 7: 路由配置
function checkRouter() {
  const routerPath = path.join(__dirname, '..', '..', 'src', 'renderer', 'router', 'index.js');

  if (!fs.existsSync(routerPath)) {
    checks.push({
      name: '路由配置',
      status: 'FAIL',
      message: 'router/index.js 不存在 ✗',
    });
    return false;
  }

  const content = fs.readFileSync(routerPath, 'utf-8');
  const routes = [
    { name: 'LLM测试聊天', path: '/llm/test-chat' },
    { name: '设备配对', path: '/p2p/device-pairing' },
    { name: '安全号码', path: '/p2p/safety-numbers' },
    { name: '会话指纹', path: '/p2p/session-fingerprint' },
    { name: '设备管理', path: '/p2p/device-management' },
    { name: '文件传输', path: '/p2p/file-transfer' },
    { name: '消息队列', path: '/p2p/message-queue' },
    { name: 'Android测试入口', path: '/test/android-features' },
  ];

  let foundCount = 0;
  const missing = [];

  routes.forEach((route) => {
    if (content.includes(route.path)) {
      foundCount++;
    } else {
      missing.push(route.name);
    }
  });

  const passed = foundCount === routes.length;
  checks.push({
    name: '路由配置',
    status: passed ? 'PASS' : foundCount > 0 ? 'WARN' : 'FAIL',
    message: `${foundCount}/${routes.length} 个路由已配置 ${passed ? '✓' : '⚠'}`,
    details: missing.length > 0 ? `缺失: ${missing.join(', ')}` : null,
  });

  return foundCount === routes.length;
}

// Check 8: 文档文件存在
function checkDocs() {
  const docs = [
    'tests/e2e/ANDROID_FEATURES_TESTS.md',
    'tests/e2e/ANDROID_FEATURES_TEST_SUMMARY.md',
    'tests/e2e/TEST_EXECUTION_PLAN.md',
    'tests/e2e/ANDROID_FEATURES_README.md',
  ];

  let existCount = 0;
  docs.forEach((doc) => {
    const fullPath = path.join(__dirname, '..', '..', doc);
    if (fs.existsSync(fullPath)) {
      existCount++;
    }
  });

  const passed = existCount === docs.length;
  checks.push({
    name: '文档文件',
    status: passed ? 'PASS' : existCount > 0 ? 'WARN' : 'FAIL',
    message: `${existCount}/${docs.length} 个文档存在 ${passed ? '✓' : '⚠'}`,
  });
}

// Check 9: 工具脚本存在
function checkScripts() {
  const scripts = [
    'tests/e2e/quick-verify.js',
    'tests/e2e/generate-test-report.js',
    'tests/e2e/run-android-features-tests.sh',
    'tests/e2e/run-android-features-tests.bat',
  ];

  let existCount = 0;
  scripts.forEach((script) => {
    const fullPath = path.join(__dirname, '..', '..', script);
    if (fs.existsSync(fullPath)) {
      existCount++;
    }
  });

  const passed = existCount === scripts.length;
  checks.push({
    name: '工具脚本',
    status: passed ? 'PASS' : existCount > 0 ? 'WARN' : 'FAIL',
    message: `${existCount}/${scripts.length} 个脚本存在 ${passed ? '✓' : '⚠'}`,
  });
}

// 运行所有检查
function runChecks() {
  console.log('开始检查...\n');

  checkNodeVersion();
  checkPackageJson();
  checkPlaywright();
  const testFilesResult = checkTestFiles();
  checkHelpers();
  const pagesResult = checkPages();
  const routerOk = checkRouter();
  checkDocs();
  checkScripts();

  console.log('检查结果:');
  console.log('========================================\n');

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  checks.forEach((check) => {
    const symbol =
      check.status === 'PASS' ? '✅' : check.status === 'WARN' ? '⚠️ ' : '❌';

    console.log(`${symbol} ${check.name}: ${check.message}`);
    if (check.details) {
      console.log(`   ${check.details}`);
    }

    if (check.status === 'PASS') passCount++;
    else if (check.status === 'WARN') warnCount++;
    else failCount++;
  });

  console.log('\n========================================');
  console.log('总结:');
  console.log(`  通过: ${passCount}/${checks.length}`);
  console.log(`  警告: ${warnCount}/${checks.length}`);
  console.log(`  失败: ${failCount}/${checks.length}`);
  console.log('========================================\n');

  // 详细统计
  console.log('详细统计:');
  console.log(`  测试文件: ${testFilesResult.exist}/${testFilesResult.total}`);
  console.log(`  功能页面: ${pagesResult.exist}/${pagesResult.total}`);
  console.log(`  路由配置: ${routerOk ? '完整' : '不完整'}`);
  console.log('');

  if (failCount > 0) {
    console.log('❌ 存在失败项，请先解决问题再运行测试\n');
    console.log('建议:');
    console.log('  1. 检查文件是否正确创建');
    console.log('  2. 运行 npm install 安装依赖');
    console.log('  3. 确认路由配置是否完整\n');
    process.exit(1);
  } else if (warnCount > 0) {
    console.log('⚠️  存在警告项，但可以继续运行测试\n');
    console.log('建议:');
    console.log('  1. 检查警告项并酌情修复');
    console.log('  2. 运行 node tests/e2e/quick-verify.js 验证测试文件\n');
    process.exit(0);
  } else {
    console.log('✅ 所有检查通过，环境健康！\n');
    console.log('下一步:');
    console.log('  1. 运行 node tests/e2e/quick-verify.js 验证测试文件');
    console.log('  2. 运行测试: npm run test:e2e tests/e2e/');
    console.log('  3. 生成报告: node tests/e2e/generate-test-report.js\n');
    process.exit(0);
  }
}

// 执行检查
try {
  runChecks();
} catch (err) {
  console.error('检查失败:', err);
  process.exit(1);
}
