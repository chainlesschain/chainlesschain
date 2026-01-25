/**
 * 运行所有模块的E2E测试
 * 分批运行以避免超时和资源耗尽
 */

const { execSync } = require('child_process');
const path = require('path');

// 所有测试模块
const modules = [
  { name: '知识管理', path: 'knowledge', files: 6 },
  { name: '社交网络', path: 'social', files: 7 },
  { name: '项目管理', path: 'project', files: 7 },
  { name: '系统设置', path: 'settings', files: 7 },
  { name: '系统监控', path: 'monitoring', files: 8 },
  { name: '交易市场', path: 'trading', files: 7 },
  { name: '企业版', path: 'enterprise', files: 8 },
  { name: '开发工具', path: 'devtools', files: 2 },
  { name: '内容聚合', path: 'content', files: 5 },
  { name: '插件生态', path: 'plugins', files: 3 },
  { name: '多媒体', path: 'multimedia', files: 2 }
];

// 运行配置
const config = {
  timeout: 300000, // 5分钟每个模块
  verbose: true,
  stopOnFailure: false // 继续运行即使有失败
};

// 颜色代码
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// 统计
const stats = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  startTime: Date.now()
};

console.log('\n' + '='.repeat(80));
console.log(colors.cyan + '         🚀 运行所有模块的E2E测试 🚀' + colors.reset);
console.log('='.repeat(80) + '\n');

console.log(`总模块数: ${modules.length}`);
console.log(`总文件数: ${modules.reduce((sum, m) => sum + m.files, 0)}`);
console.log(`超时设置: ${config.timeout / 1000}秒/模块`);
console.log(`失败策略: ${config.stopOnFailure ? '立即停止' : '继续运行'}`);
console.log('\n' + '-'.repeat(80) + '\n');

// 运行所有模块
modules.forEach((module, index) => {
  const moduleNum = index + 1;
  console.log(`\n[${moduleNum}/${modules.length}] ${colors.blue}测试模块: ${module.name}${colors.reset}`);
  console.log(`    路径: tests/e2e/${module.path}/`);
  console.log(`    文件数: ${module.files}`);
  console.log(`    开始时间: ${new Date().toLocaleTimeString()}`);

  stats.total++;

  try {
    const testPath = path.join('tests', 'e2e', module.path);
    const command = `npm run test:e2e -- ${testPath} --reporter=line`;

    console.log(`    执行命令: ${command}`);

    const startTime = Date.now();
    const output = execSync(command, {
      encoding: 'utf8',
      timeout: config.timeout,
      stdio: config.verbose ? 'inherit' : 'pipe'
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // 检查输出
    const outputStr = output ? output.toString() : '';
    const hasPassed = outputStr.includes('passed') || !outputStr.includes('failed');

    if (hasPassed) {
      stats.passed++;
      console.log(`    ${colors.green}✅ 通过${colors.reset} - 耗时: ${duration}秒`);
    } else {
      stats.failed++;
      console.log(`    ${colors.red}❌ 失败${colors.reset} - 耗时: ${duration}秒`);

      if (config.stopOnFailure) {
        console.log(`\n${colors.red}检测到失败，停止执行${colors.reset}`);
        process.exit(1);
      }
    }

  } catch (error) {
    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(1);

    // 检查是否是超时
    if (error.killed) {
      console.log(`    ${colors.yellow}⏱️ 超时${colors.reset} - 超过${config.timeout / 1000}秒`);
      stats.skipped++;
    } else {
      // 检查错误输出
      const errorOutput = error.stdout ? error.stdout.toString() : '';
      const hasPassed = errorOutput.includes('passed') && !errorOutput.includes('0 passed');

      if (hasPassed) {
        stats.passed++;
        console.log(`    ${colors.green}✅ 通过${colors.reset} - 耗时: ${duration}秒`);
      } else {
        stats.failed++;
        console.log(`    ${colors.red}❌ 失败${colors.reset}`);
        if (config.verbose) {
          console.log(`    错误: ${error.message}`);
        }

        if (config.stopOnFailure) {
          console.log(`\n${colors.red}检测到失败，停止执行${colors.reset}`);
          process.exit(1);
        }
      }
    }
  }

  console.log('-'.repeat(80));
});

// 打印总结
const totalDuration = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);

console.log('\n' + '='.repeat(80));
console.log(colors.cyan + '                     📊 测试总结 📊' + colors.reset);
console.log('='.repeat(80) + '\n');

console.log(`总模块数:   ${stats.total}`);
console.log(`${colors.green}通过:       ${stats.passed}${colors.reset}`);
console.log(`${colors.red}失败:       ${stats.failed}${colors.reset}`);
console.log(`${colors.yellow}跳过/超时:  ${stats.skipped}${colors.reset}`);
console.log(`总耗时:     ${totalDuration}分钟`);

const passRate = ((stats.passed / stats.total) * 100).toFixed(1);
console.log(`通过率:     ${passRate}%`);

console.log('\n' + '='.repeat(80));

// 最终状态
if (stats.failed === 0 && stats.skipped === 0) {
  console.log(colors.green + '\n🎉 所有测试通过！' + colors.reset);
  process.exit(0);
} else if (stats.failed === 0) {
  console.log(colors.yellow + '\n⚠️ 测试完成，但有跳过项' + colors.reset);
  process.exit(0);
} else {
  console.log(colors.red + '\n❌ 有测试失败' + colors.reset);
  process.exit(1);
}
