/**
 * 验证新创建的测试文件
 * 检查文件是否存在、结构是否正确
 */

const fs = require('fs');
const path = require('path');

const testFiles = {
  trading: [
    'trading-hub.e2e.test.ts',
    'marketplace.e2e.test.ts',
    'contracts.e2e.test.ts',
    'credit-score.e2e.test.ts',
    'my-reviews.e2e.test.ts',
    'wallet.e2e.test.ts',
    'bridge.e2e.test.ts'
  ],
  enterprise: [
    'organizations.e2e.test.ts',
    'organization-members.e2e.test.ts',
    'organization-roles.e2e.test.ts',
    'organization-settings.e2e.test.ts',
    'organization-activities.e2e.test.ts',
    'organization-knowledge.e2e.test.ts',
    'enterprise-dashboard.e2e.test.ts',
    'permission-management.e2e.test.ts'
  ]
};

const expectedPatterns = [
  'import { test, expect } from \'@playwright/test\'',
  'import { launchElectronApp, closeElectronApp } from \'../helpers/common\'',
  'test.beforeEach',
  'test.afterEach',
  'launchElectronApp()',
  'closeElectronApp(app)',
  'window.location.hash',
  '?e2e=true'
];

function verifyFile(filePath, fileName) {
  if (!fs.existsSync(filePath)) {
    return { success: false, message: `文件不存在: ${fileName}` };
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  // 检查必要的模式
  const missingPatterns = expectedPatterns.filter(pattern => !content.includes(pattern));

  if (missingPatterns.length > 0) {
    return {
      success: false,
      message: `缺少必要的代码模式: ${missingPatterns.join(', ')}`
    };
  }

  // 检查测试用例数量
  const testCount = (content.match(/test\(/g) || []).length;
  if (testCount < 4) {
    return {
      success: false,
      message: `测试用例数量不足: ${testCount} (期望至少 4 个)`
    };
  }

  return { success: true, message: '✓ 验证通过', testCount };
}

function main() {
  console.log('='.repeat(60));
  console.log('验证新创建的 E2E 测试文件');
  console.log('='.repeat(60));
  console.log();

  let totalFiles = 0;
  let successFiles = 0;
  let totalTests = 0;

  // 验证交易市场模块
  console.log('📦 交易市场模块 (tests/e2e/trading/)');
  console.log('-'.repeat(60));

  testFiles.trading.forEach(fileName => {
    const filePath = path.join(__dirname, 'trading', fileName);
    totalFiles++;

    const result = verifyFile(filePath, fileName);

    if (result.success) {
      console.log(`✓ ${fileName} - ${result.message} (${result.testCount} 个测试)`);
      successFiles++;
      totalTests += result.testCount;
    } else {
      console.log(`✗ ${fileName} - ${result.message}`);
    }
  });

  console.log();

  // 验证企业版模块
  console.log('🏢 企业版模块 (tests/e2e/enterprise/)');
  console.log('-'.repeat(60));

  testFiles.enterprise.forEach(fileName => {
    const filePath = path.join(__dirname, 'enterprise', fileName);
    totalFiles++;

    const result = verifyFile(filePath, fileName);

    if (result.success) {
      console.log(`✓ ${fileName} - ${result.message} (${result.testCount} 个测试)`);
      successFiles++;
      totalTests += result.testCount;
    } else {
      console.log(`✗ ${fileName} - ${result.message}`);
    }
  });

  console.log();
  console.log('='.repeat(60));
  console.log('验证结果统计');
  console.log('='.repeat(60));
  console.log(`总文件数: ${totalFiles}`);
  console.log(`验证通过: ${successFiles}`);
  console.log(`验证失败: ${totalFiles - successFiles}`);
  console.log(`总测试用例数: ${totalTests}`);
  console.log();

  if (successFiles === totalFiles) {
    console.log('✅ 所有测试文件验证通过！');
    process.exit(0);
  } else {
    console.log('❌ 部分测试文件验证失败');
    process.exit(1);
  }
}

main();
