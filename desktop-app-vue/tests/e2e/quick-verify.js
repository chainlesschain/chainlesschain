/**
 * 快速验证新创建的E2E测试文件
 * 检查测试文件是否正确创建和配置
 */

const fs = require('fs');
const path = require('path');

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

const requiredImports = [
  "import { test, expect } from '@playwright/test'",
  "import { launchElectronApp, closeElectronApp } from '../helpers/common'",
];

const requiredHooks = [
  'test.beforeEach',
  'test.afterEach',
];

const requiredPatterns = [
  'test.describe',
  'launchElectronApp',
  'closeElectronApp',
  'window.evaluate',
  'window.location.hash',
  'e2e=true',
];

console.log('========================================');
console.log('安卓功能E2E测试验证');
console.log('========================================\n');

let totalFiles = 0;
let validFiles = 0;
let totalTests = 0;
let issues = [];

testFiles.forEach(filePath => {
  totalFiles++;
  const fullPath = path.join(__dirname, '..', '..', filePath);

  console.log(`检查: ${filePath}`);

  if (!fs.existsSync(fullPath)) {
    console.log(`  ❌ 文件不存在`);
    issues.push(`${filePath}: 文件不存在`);
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  let fileValid = true;

  // Check required imports
  requiredImports.forEach(imp => {
    if (!content.includes(imp)) {
      console.log(`  ⚠️  缺少导入: ${imp}`);
      fileValid = false;
      issues.push(`${filePath}: 缺少导入 ${imp}`);
    }
  });

  // Check required hooks
  requiredHooks.forEach(hook => {
    if (!content.includes(hook)) {
      console.log(`  ⚠️  缺少钩子: ${hook}`);
      fileValid = false;
      issues.push(`${filePath}: 缺少钩子 ${hook}`);
    }
  });

  // Check required patterns
  requiredPatterns.forEach(pattern => {
    if (!content.includes(pattern)) {
      console.log(`  ⚠️  缺少模式: ${pattern}`);
      fileValid = false;
      issues.push(`${filePath}: 缺少模式 ${pattern}`);
    }
  });

  // Count test cases
  const testMatches = content.match(/test\(/g);
  const testCount = testMatches ? testMatches.length : 0;
  totalTests += testCount;

  console.log(`  📝 测试用例数: ${testCount}`);

  if (fileValid) {
    console.log(`  ✅ 验证通过\n`);
    validFiles++;
  } else {
    console.log(`  ❌ 验证失败\n`);
  }
});

console.log('========================================');
console.log('验证结果统计');
console.log('========================================');
console.log(`总文件数: ${totalFiles}`);
console.log(`验证通过: ${validFiles}`);
console.log(`验证失败: ${totalFiles - validFiles}`);
console.log(`总测试用例: ${totalTests}`);
console.log('');

if (issues.length > 0) {
  console.log('发现的问题:');
  issues.forEach(issue => console.log(`  - ${issue}`));
  console.log('');
  process.exit(1);
} else {
  console.log('✅ 所有测试文件验证通过！');
  console.log('');
  console.log('建议的下一步:');
  console.log('1. 运行单个测试验证: npm run test:e2e tests/e2e/llm/llm-test-chat.e2e.test.ts');
  console.log('2. 运行P2P测试套件: npm run test:e2e tests/e2e/p2p/');
  console.log('3. 运行所有新测试: ./tests/e2e/run-android-features-tests.bat all');
  process.exit(0);
}
