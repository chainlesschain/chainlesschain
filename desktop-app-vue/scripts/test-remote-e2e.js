/**
 * 远程控制系统端到端测试运行脚本
 *
 * 运行所有远程控制相关测试并生成报告
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('================================================');
console.log('远程控制系统 E2E 测试');
console.log('================================================\n');

const testFiles = [
  'tests/remote/ai-handler-enhanced.test.js',
  'tests/remote/system-handler-enhanced.test.js',
  'tests/remote/logging.test.js',
  'tests/remote/command-router.test.js',
  'tests/remote/permission-gate.test.js',
  'tests/integration/remote-control-e2e.test.js'
];

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const results = [];

function runTest(testFile) {
  return new Promise((resolve, reject) => {
    console.log(`\n运行测试: ${testFile}`);
    console.log('─'.repeat(50));

    const vitest = spawn('npx', ['vitest', 'run', testFile], {
      cwd: path.join(__dirname, '..'),
      shell: true,
      stdio: 'pipe'
    });

    let output = '';
    let passed = 0;
    let failed = 0;

    vitest.stdout.on('data', (data) => {
      const str = data.toString();
      output += str;
      process.stdout.write(str);

      // 解析测试结果
      const passMatch = str.match(/(\d+) passed/);
      if (passMatch) {
        passed = parseInt(passMatch[1]);
      }

      const failMatch = str.match(/(\d+) failed/);
      if (failMatch) {
        failed = parseInt(failMatch[1]);
      }
    });

    vitest.stderr.on('data', (data) => {
      const str = data.toString();
      output += str;
      process.stderr.write(str);
    });

    vitest.on('close', (code) => {
      results.push({
        file: testFile,
        passed,
        failed,
        code,
        success: code === 0
      });

      totalTests += passed + failed;
      passedTests += passed;
      failedTests += failed;

      if (code === 0) {
        console.log(`✅ ${testFile} 测试通过`);
        resolve();
      } else {
        console.log(`❌ ${testFile} 测试失败 (退出码: ${code})`);
        resolve(); // 继续执行其他测试
      }
    });

    vitest.on('error', (err) => {
      console.error(`❌ 测试运行错误: ${err.message}`);
      reject(err);
    });
  });
}

async function runAllTests() {
  const startTime = Date.now();

  for (const testFile of testFiles) {
    try {
      await runTest(testFile);
    } catch (err) {
      console.error(`测试执行失败: ${err.message}`);
    }
  }

  const duration = Date.now() - startTime;

  // 生成测试报告
  console.log('\n================================================');
  console.log('测试结果汇总');
  console.log('================================================\n');

  results.forEach((result) => {
    const status = result.success ? '✅ 通过' : '❌ 失败';
    console.log(`${status} - ${result.file}`);
    console.log(`  通过: ${result.passed}, 失败: ${result.failed}`);
  });

  console.log('\n================================================');
  console.log(`总测试数: ${totalTests}`);
  console.log(`通过: ${passedTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
  console.log(`失败: ${failedTests}`);
  console.log(`总耗时: ${(duration / 1000).toFixed(2)}s`);
  console.log('================================================\n');

  // 保存测试报告
  const reportPath = path.join(__dirname, '../tests/reports/remote-e2e-test-report.json');
  const reportDir = path.dirname(reportPath);

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const report = {
    timestamp: new Date().toISOString(),
    totalTests,
    passedTests,
    failedTests,
    successRate: ((passedTests / totalTests) * 100).toFixed(1),
    duration,
    results
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`测试报告已保存到: ${reportPath}\n`);

  // 退出码
  const exitCode = failedTests > 0 ? 1 : 0;
  if (exitCode === 0) {
    console.log('✅ 所有测试通过！');
  } else {
    console.log('❌ 部分测试失败，请检查日志');
  }

  process.exit(exitCode);
}

// 运行测试
runAllTests().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
