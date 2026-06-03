#!/usr/bin/env node

/**
 * 简化版测试运行器 - 逐个运行测试并实时显示结果
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 精选测试列表 - 每个模块选1个代表性测试
const selectedTests = [
  { module: '知识管理', file: 'knowledge/knowledge-graph.e2e.test.ts' },
  { module: '社交网络', file: 'social/contacts.e2e.test.ts' },
  { module: '项目管理', file: 'project/project-workspace.e2e.test.ts' },
  { module: '系统设置', file: 'settings/general-settings.e2e.test.ts' },
  { module: '系统监控', file: 'monitoring/database-performance.e2e.test.ts' },
  { module: '交易市场', file: 'trading/trading-hub.e2e.test.ts' },
  { module: '企业版', file: 'enterprise/organizations.e2e.test.ts' },
  { module: '开发工具', file: 'devtools/webide.e2e.test.ts' },
  { module: '内容聚合', file: 'content/rss-feeds.e2e.test.ts' },
  { module: '插件生态', file: 'plugins/plugin-marketplace.e2e.test.ts' },
];

console.log('='.repeat(80));
console.log('E2E测试精选验证 - 每个模块1个测试');
console.log('='.repeat(80));
console.log('');
console.log(`总测试数: ${selectedTests.length}`);
console.log('');

const results = [];
let passed = 0;
let failed = 0;

for (let i = 0; i < selectedTests.length; i++) {
  const test = selectedTests[i];
  const progress = `[${(i + 1).toString().padStart(2)}/${selectedTests.length}]`;

  console.log(`${progress} 测试: ${test.module}`);
  console.log(`      文件: ${test.file}`);

  try {
    const startTime = Date.now();

    execSync(
      `npx playwright test tests/e2e/${test.file} --timeout=60000 --reporter=json > test-result.json`,
      {
        cwd: path.join(__dirname, '..', '..'),
        stdio: 'pipe',
        timeout: 120000
      }
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // 读取结果
    const resultPath = path.join(__dirname, '..', '..', 'test-result.json');
    let testsPassed = 0;
    let testsFailed = 0;

    if (fs.existsSync(resultPath)) {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      if (result.suites && result.suites[0] && result.suites[0].suites) {
        const suite = result.suites[0].suites[0];
        if (suite.specs) {
          testsPassed = suite.specs.filter(s => s.ok).length;
          testsFailed = suite.specs.filter(s => !s.ok).length;
        }
      }
      fs.unlinkSync(resultPath);
    }

    console.log(`      ✅ 通过 (${testsPassed} tests, ${duration}s)`);
    passed++;
    results.push({ ...test, status: 'pass', testsPassed, testsFailed, duration });

  } catch (error) {
    console.log(`      ❌ 失败`);
    failed++;
    results.push({ ...test, status: 'fail' });
  }

  console.log('');
}

console.log('='.repeat(80));
console.log('测试结果总结');
console.log('='.repeat(80));
console.log('');
console.log(`测试模块: ${selectedTests.length}`);
console.log(`✅ 通过: ${passed}`);
console.log(`❌ 失败: ${failed}`);
console.log(`成功率: ${((passed / selectedTests.length) * 100).toFixed(1)}%`);
console.log('');

if (failed > 0) {
  console.log('失败的模块:');
  results.filter(r => r.status === 'fail').forEach(r => {
    console.log(`  ❌ ${r.module}`);
  });
  console.log('');
}

// 保存结果
const report = {
  timestamp: new Date().toISOString(),
  total: selectedTests.length,
  passed,
  failed,
  successRate: ((passed / selectedTests.length) * 100).toFixed(1),
  results
};

fs.writeFileSync(
  path.join(__dirname, 'selected-tests-result.json'),
  JSON.stringify(report, null, 2)
);

console.log('详细结果已保存到: tests/e2e/selected-tests-result.json');
console.log('='.repeat(80));

process.exit(failed > 0 ? 1 : 0);
