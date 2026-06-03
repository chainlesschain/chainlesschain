#!/usr/bin/env node

/**
 * E2E测试验证脚本
 * 用于验证所有新创建的E2E测试是否可以正常运行
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 测试配置
const testModules = [
  { name: '知识管理', dir: 'knowledge', files: ['knowledge-graph.e2e.test.ts', 'file-import.e2e.test.ts'] },
  { name: '社交网络', dir: 'social', files: ['contacts.e2e.test.ts', 'friends.e2e.test.ts'] },
  { name: '项目管理', dir: 'project', files: ['project-workspace.e2e.test.ts', 'project-categories.e2e.test.ts'] },
  { name: '系统设置', dir: 'settings', files: ['general-settings.e2e.test.ts', 'system-settings.e2e.test.ts'] },
  { name: '系统监控', dir: 'monitoring', files: ['database-performance.e2e.test.ts', 'llm-performance.e2e.test.ts'] },
  { name: '交易市场', dir: 'trading', files: ['trading-hub.e2e.test.ts', 'marketplace.e2e.test.ts'] },
  { name: '企业版', dir: 'enterprise', files: ['organizations.e2e.test.ts', 'enterprise-dashboard.e2e.test.ts'] },
  { name: '开发工具', dir: 'devtools', files: ['webide.e2e.test.ts'] },
  { name: '内容聚合', dir: 'content', files: ['rss-feeds.e2e.test.ts', 'email-accounts.e2e.test.ts'] },
  { name: '插件生态', dir: 'plugins', files: ['plugin-marketplace.e2e.test.ts'] },
  { name: '多媒体处理', dir: 'multimedia', files: ['audio-import.e2e.test.ts'] }
];

// 结果统计
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  modules: []
};

console.log('================================================================================');
console.log('E2E测试验证 - 运行抽样测试');
console.log('================================================================================\n');

// 运行每个模块的第一个测试文件
for (const module of testModules) {
  const testFile = module.files[0];
  const testPath = path.join(module.dir, testFile);
  const fullPath = path.join(__dirname, module.dir, testFile);

  console.log(`\n📦 测试模块: ${module.name} (${module.dir})`);
  console.log(`   文件: ${testFile}`);

  // 检查文件是否存在
  if (!fs.existsSync(fullPath)) {
    console.log(`   ⚠️  文件不存在: ${fullPath}，跳过`);
    results.skipped++;
    results.modules.push({ name: module.name, status: 'skipped' });
    continue;
  }

  try {
    console.log(`   🔄 正在运行测试...`);

    // 运行测试
    const projectRoot = path.join(__dirname, '..', '..');
    const output = execSync(
      `npx playwright test tests/e2e/${testPath} --timeout=60000 --reporter=list`,
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      }
    );

    // 解析输出
    const passedMatch = output.match(/(\d+) passed/);
    const failedMatch = output.match(/(\d+) failed/);

    const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1]) : 0;

    results.total += passed + failed;
    results.passed += passed;
    results.failed += failed;

    if (failed === 0 && passed > 0) {
      console.log(`   ✅ 测试通过 (${passed}/${passed})`);
      results.modules.push({ name: module.name, status: 'passed', passed, failed });
    } else {
      console.log(`   ❌ 测试失败 (${passed}/${passed + failed})`);
      results.modules.push({ name: module.name, status: 'failed', passed, failed });
    }

  } catch (error) {
    console.log(`   ❌ 测试执行错误`);
    results.failed++;
    results.modules.push({ name: module.name, status: 'error', error: error.message });
  }
}

// 输出总结
console.log('\n\n================================================================================');
console.log('测试验证总结');
console.log('================================================================================\n');

console.log(`总测试模块: ${testModules.length}`);
console.log(`总测试用例: ${results.total}`);
console.log(`✅ 通过: ${results.passed}`);
console.log(`❌ 失败: ${results.failed}`);
console.log(`⚠️  跳过: ${results.skipped}`);
console.log(`成功率: ${results.total > 0 ? ((results.passed / results.total) * 100).toFixed(1) : 0}%\n`);

// 模块详情
console.log('模块测试结果:');
results.modules.forEach(m => {
  const statusIcon = m.status === 'passed' ? '✅' : m.status === 'failed' ? '❌' : '⚠️';
  const details = m.status === 'passed' ? `(${m.passed} passed)` :
                  m.status === 'failed' ? `(${m.passed}/${m.passed + m.failed})` : '';
  console.log(`  ${statusIcon} ${m.name.padEnd(12)} ${details}`);
});

console.log('\n================================================================================');

// 生成报告文件
const reportPath = path.join(__dirname, 'VALIDATION_RESULTS.md');
const report = `# E2E测试验证结果

生成时间: ${new Date().toLocaleString('zh-CN')}

## 总体统计

- 总测试模块: ${testModules.length}
- 总测试用例: ${results.total}
- ✅ 通过: ${results.passed}
- ❌ 失败: ${results.failed}
- ⚠️ 跳过: ${results.skipped}
- 成功率: ${results.total > 0 ? ((results.passed / results.total) * 100).toFixed(1) : 0}%

## 模块测试结果

${results.modules.map(m => {
  const statusIcon = m.status === 'passed' ? '✅' : m.status === 'failed' ? '❌' : '⚠️';
  const details = m.status === 'passed' ? `${m.passed} passed` :
                  m.status === 'failed' ? `${m.passed}/${m.passed + m.failed}` :
                  m.status === 'skipped' ? 'Skipped' : 'Error';
  return `- ${statusIcon} **${m.name}**: ${details}`;
}).join('\n')}

## 结论

${results.failed === 0 && results.skipped === 0
  ? '✅ 所有测试模块验证通过！'
  : results.failed > 0
    ? '⚠️ 部分测试失败，需要修复。'
    : '⚠️ 部分测试被跳过。'
}

## 下一步建议

${results.failed > 0 ? '1. 检查失败的测试用例\n2. 根据实际页面调整选择器\n3. 修复失败的测试\n' : ''}
${results.skipped > 0 ? '1. 检查被跳过的测试文件\n2. 确保所有测试文件存在\n' : ''}
${results.failed === 0 && results.skipped === 0 ? '1. 运行完整的测试套件\n2. 持续监控测试结果\n3. 根据页面更新维护测试\n' : ''}
`;

fs.writeFileSync(reportPath, report, 'utf8');
console.log(`\n📄 详细报告已保存到: ${reportPath}\n`);

// 退出码
process.exit(results.failed > 0 ? 1 : 0);
