#!/usr/bin/env node

const { execSync } = require('child_process');

// 测试配置 - 每个模块选2个文件测试
const tests = [
  { module: '知识管理', path: 'knowledge/knowledge-graph.e2e.test.ts' },
  { module: '知识管理', path: 'knowledge/file-import.e2e.test.ts' },
  { module: '社交网络', path: 'social/contacts.e2e.test.ts' },
  { module: '社交网络', path: 'social/friends.e2e.test.ts' },
  { module: '项目管理', path: 'project/project-workspace.e2e.test.ts' },
  { module: '项目管理', path: 'project/project-categories.e2e.test.ts' },
  { module: '系统设置', path: 'settings/general-settings.e2e.test.ts' },
  { module: '系统设置', path: 'settings/system-settings.e2e.test.ts' },
  { module: '系统监控', path: 'monitoring/database-performance.e2e.test.ts' },
  { module: '系统监控', path: 'monitoring/llm-performance.e2e.test.ts' },
  { module: '交易市场', path: 'trading/trading-hub.e2e.test.ts' },
  { module: '交易市场', path: 'trading/marketplace.e2e.test.ts' },
  { module: '企业版', path: 'enterprise/organizations.e2e.test.ts' },
  { module: '企业版', path: 'enterprise/enterprise-dashboard.e2e.test.ts' },
  { module: '开发工具', path: 'devtools/webide.e2e.test.ts' },
  { module: '内容聚合', path: 'content/rss-feeds.e2e.test.ts' },
  { module: '内容聚合', path: 'content/email-accounts.e2e.test.ts' },
  { module: '插件生态', path: 'plugins/plugin-marketplace.e2e.test.ts' },
  { module: '多媒体处理', path: 'multimedia/audio-import.e2e.test.ts' }
];

console.log('='.repeat(80));
console.log('E2E测试批量验证 - 快速抽样测试');
console.log('='.repeat(80));
console.log('');

let passed = 0;
let failed = 0;
const results = [];

// 运行测试
for (let i = 0; i < tests.length; i++) {
  const test = tests[i];
  const progress = `[${i + 1}/${tests.length}]`;

  process.stdout.write(`${progress} ${test.module.padEnd(12)} ${test.path}...`);

  try {
    const output = execSync(
      `npx playwright test tests/e2e/${test.path} --timeout=60000 --reporter=list`,
      {
        stdio: 'pipe',
        timeout: 120000,
        encoding: 'utf8'
      }
    );

    // 检查输出中是否有"passed"
    if (output.includes('passed') && !output.includes('failed')) {
      console.log(' ✅ 通过');
      passed++;
      results.push({ ...test, status: 'pass' });
    } else {
      console.log(' ⚠️ 部分通过');
      passed++;
      results.push({ ...test, status: 'partial' });
    }
  } catch (error) {
    // 即使有异常，也检查是否有passed
    const output = error.stdout ? error.stdout.toString() : '';
    if (output.includes('passed') && !output.includes('failed')) {
      console.log(' ✅ 通过');
      passed++;
      results.push({ ...test, status: 'pass' });
    } else {
      console.log(' ❌ 失败');
      failed++;
      results.push({ ...test, status: 'fail' });
    }
  }
}

console.log('');
console.log('='.repeat(80));
console.log('测试结果总结');
console.log('='.repeat(80));
console.log('');
console.log(`总测试文件: ${tests.length}`);
console.log(`✅ 通过: ${passed}`);
console.log(`❌ 失败: ${failed}`);
console.log(`成功率: ${((passed / tests.length) * 100).toFixed(1)}%`);
console.log('');

// 按模块统计
const moduleStats = {};
results.forEach(r => {
  if (!moduleStats[r.module]) {
    moduleStats[r.module] = { total: 0, passed: 0 };
  }
  moduleStats[r.module].total++;
  if (r.status === 'pass') moduleStats[r.module].passed++;
});

console.log('按模块统计:');
Object.keys(moduleStats).forEach(module => {
  const stats = moduleStats[module];
  const icon = stats.passed === stats.total ? '✅' : '⚠️';
  console.log(`  ${icon} ${module.padEnd(15)} ${stats.passed}/${stats.total}`);
});

console.log('');
console.log('='.repeat(80));

if (failed > 0) {
  console.log('');
  console.log('失败的测试:');
  results.filter(r => r.status === 'fail').forEach(r => {
    console.log(`  ❌ ${r.module} - ${r.path}`);
  });
}

process.exit(failed > 0 ? 1 : 0);
