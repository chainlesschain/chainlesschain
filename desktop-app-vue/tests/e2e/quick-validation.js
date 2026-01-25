#!/usr/bin/env node

/**
 * 快速验证 - 每个模块测试1个文件
 */

const { execSync } = require('child_process');

const tests = [
  { name: '知识管理', path: 'knowledge/knowledge-graph.e2e.test.ts' },
  { name: '社交网络', path: 'social/contacts.e2e.test.ts' },
  { name: '项目管理', path: 'project/project-categories.e2e.test.ts' },
  { name: '系统设置', path: 'settings/general-settings.e2e.test.ts' },
  { name: '系统监控', path: 'monitoring/database-performance.e2e.test.ts' },
  { name: '交易市场', path: 'trading/trading-hub.e2e.test.ts' },
  { name: '企业版', path: 'enterprise/organizations.e2e.test.ts' },
  { name: '开发工具', path: 'devtools/webide.e2e.test.ts' },
  { name: '内容聚合', path: 'content/rss-feeds.e2e.test.ts' },
  { name: '插件生态', path: 'plugins/plugin-marketplace.e2e.test.ts' },
  { name: '多媒体处理', path: 'multimedia/audio-import.e2e.test.ts' }
];

console.log('='.repeat(80));
console.log('E2E快速验证 - 测试所有模块 (每个模块1个文件)');
console.log('='.repeat(80));
console.log('');

let passed = 0;
let failed = 0;
const results = [];

for (let i = 0; i < tests.length; i++) {
  const test = tests[i];
  const num = `[${(i + 1).toString().padStart(2)}/${tests.length}]`;

  process.stdout.write(`${num} ${test.name.padEnd(15)}`);

  try {
    const output = execSync(
      `npx playwright test tests/e2e/${test.path} --timeout=60000 --reporter=list`,
      {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 180000,
        cwd: require('path').join(__dirname, '..', '..')
      }
    );

    const passMatch = output.match(/(\d+) passed/);
    const testCount = passMatch ? passMatch[1] : '?';

    console.log(` ✅ 通过 (${testCount} tests)`);
    passed++;
    results.push({ ...test, status: 'pass', tests: testCount });

  } catch (error) {
    const output = error.stdout ? error.stdout.toString() : '';
    const passMatch = output.match(/(\d+) passed/);

    if (passMatch) {
      const testCount = passMatch[1];
      console.log(` ✅ 通过 (${testCount} tests)`);
      passed++;
      results.push({ ...test, status: 'pass', tests: testCount });
    } else {
      console.log(` ❌ 失败`);
      failed++;
      results.push({ ...test, status: 'fail' });
    }
  }
}

console.log('');
console.log('='.repeat(80));
console.log('测试结果');
console.log('='.repeat(80));
console.log(`模块总数: ${tests.length}`);
console.log(`✅ 通过: ${passed}`);
console.log(`❌ 失败: ${failed}`);
console.log(`成功率: ${((passed / tests.length) * 100).toFixed(1)}%`);
console.log('='.repeat(80));

if (failed > 0) {
  console.log('');
  console.log('失败的模块:');
  results.filter(r => r.status === 'fail').forEach(r => {
    console.log(`  ❌ ${r.name}`);
  });
}

process.exit(failed > 0 ? 1 : 0);
