/**
 * 统一测试运行器
 * 运行所有测试并生成报告
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class TestRunner {
  constructor() {
    this.results = {
      unit: null,
      integration: null,
      e2e: null,
      performance: null,
      database: null,
      ukey: null
    };
    this.startTime = Date.now();
  }

  /**
   * 运行测试套件
   */
  async runTestSuite(name, command, args = []) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running ${name} tests...`);
    console.log('='.repeat(60));

    return new Promise((resolve) => {
      const startTime = Date.now();
      const proc = spawn(command, args, {
        cwd: process.cwd(),
        shell: true,
        stdio: 'inherit'
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        const result = {
          name,
          passed: code === 0,
          exitCode: code,
          duration,
          timestamp: new Date().toISOString()
        };

        this.results[name.toLowerCase().replace(' ', '')] = result;

        if (code === 0) {
          console.log(`\n✓ ${name} tests PASSED (${(duration / 1000).toFixed(2)}s)`);
        } else {
          console.log(`\n✗ ${name} tests FAILED (${(duration / 1000).toFixed(2)}s)`);
        }

        resolve(result);
      });

      proc.on('error', (error) => {
        console.error(`Failed to run ${name} tests:`, error);
        resolve({
          name,
          passed: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      });
    });
  }

  /**
   * 运行所有测试
   */
  async runAll() {
    console.log('\n' + '█'.repeat(60));
    console.log('ChainlessChain 自动化测试套件');
    console.log('█'.repeat(60) + '\n');

    // 1. 单元测试
    await this.runTestSuite('Unit', 'npm', ['run', 'test:unit']);

    // 2. 集成测试
    await this.runTestSuite('Integration', 'npm', ['run', 'test:integration']);

    // 3. 数据库测试
    await this.runTestSuite('Database', 'node', ['scripts/test-database.js']);

    // 4. U-Key测试
    await this.runTestSuite('UKey', 'node', ['scripts/test-ukey.js']);

    // 5. 性能测试
    await this.runTestSuite('Performance', 'npm', ['run', 'test:performance']);

    // 6. E2E测试 (可选,耗时较长)
    if (process.env.RUN_E2E_TESTS === 'true') {
      await this.runTestSuite('E2E', 'npm', ['run', 'test:e2e']);
    } else {
      console.log('\n⊘ E2E tests SKIPPED (set RUN_E2E_TESTS=true to run)');
    }

    // 生成报告
    await this.generateReport();
  }

  /**
   * 生成测试报告
   */
  async generateReport() {
    const totalDuration = Date.now() - this.startTime;
    const totalTests = Object.values(this.results).filter(r => r !== null).length;
    const passedTests = Object.values(this.results).filter(r => r && r.passed).length;
    const failedTests = totalTests - passedTests;

    console.log('\n' + '='.repeat(60));
    console.log('测试报告摘要');
    console.log('='.repeat(60));

    console.log(`\n总计: ${totalTests} 个测试套件`);
    console.log(`通过: ${passedTests} ✓`);
    console.log(`失败: ${failedTests} ✗`);
    console.log(`总耗时: ${(totalDuration / 1000).toFixed(2)}秒`);

    console.log('\n详细结果:');
    for (const [name, result] of Object.entries(this.results)) {
      if (result) {
        const status = result.passed ? '✓ PASS' : '✗ FAIL';
        const duration = result.duration ? `(${(result.duration / 1000).toFixed(2)}s)` : '';
        console.log(`  ${status} ${result.name} ${duration}`);
      }
    }

    // 保存报告到文件
    const report = {
      summary: {
        total: totalTests,
        passed: passedTests,
        failed: failedTests,
        duration: totalDuration,
        timestamp: new Date().toISOString()
      },
      results: this.results
    };

    const reportPath = path.join(process.cwd(), 'test-results');
    await fs.mkdir(reportPath, { recursive: true });

    const reportFile = path.join(reportPath, 'test-report.json');
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));

    console.log(`\n报告已保存到: ${reportFile}`);

    // 生成HTML报告
    await this.generateHTMLReport(report, reportPath);

    console.log('='.repeat(60) + '\n');

    // 如果有失败的测试,退出码为1
    if (failedTests > 0) {
      process.exit(1);
    }
  }

  /**
   * 生成HTML报告
   */
  async generateHTMLReport(report, reportPath) {
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ChainlessChain 测试报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }
    .header h1 { font-size: 32px; margin-bottom: 10px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      padding: 40px;
      background: #f9fafb;
    }
    .summary-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      text-align: center;
    }
    .summary-card h3 {
      font-size: 14px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    .summary-card .value {
      font-size: 36px;
      font-weight: bold;
      color: #1f2937;
    }
    .summary-card.passed .value { color: #10b981; }
    .summary-card.failed .value { color: #ef4444; }
    .results {
      padding: 40px;
    }
    .results h2 {
      font-size: 24px;
      margin-bottom: 20px;
      color: #1f2937;
    }
    .test-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 15px 20px;
      margin-bottom: 10px;
      background: #f9fafb;
      border-radius: 6px;
      border-left: 4px solid #e5e7eb;
    }
    .test-item.passed { border-left-color: #10b981; background: #f0fdf4; }
    .test-item.failed { border-left-color: #ef4444; background: #fef2f2; }
    .test-item .name {
      font-weight: 600;
      color: #1f2937;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .test-item .status {
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status.passed { background: #10b981; color: white; }
    .status.failed { background: #ef4444; color: white; }
    .duration { color: #6b7280; font-size: 14px; }
    .footer {
      padding: 20px 40px;
      background: #f9fafb;
      text-align: center;
      color: #6b7280;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ChainlessChain 测试报告</h1>
      <p>生成时间: ${new Date(report.summary.timestamp).toLocaleString('zh-CN')}</p>
    </div>

    <div class="summary">
      <div class="summary-card">
        <h3>总测试套件</h3>
        <div class="value">${report.summary.total}</div>
      </div>
      <div class="summary-card passed">
        <h3>通过</h3>
        <div class="value">${report.summary.passed}</div>
      </div>
      <div class="summary-card failed">
        <h3>失败</h3>
        <div class="value">${report.summary.failed}</div>
      </div>
      <div class="summary-card">
        <h3>总耗时</h3>
        <div class="value">${(report.summary.duration / 1000).toFixed(1)}<span style="font-size:18px">s</span></div>
      </div>
    </div>

    <div class="results">
      <h2>详细结果</h2>
      ${Object.values(report.results)
        .filter(r => r !== null)
        .map(result => `
          <div class="test-item ${result.passed ? 'passed' : 'failed'}">
            <div class="name">
              <span>${result.passed ? '✓' : '✗'}</span>
              ${result.name}
            </div>
            <div style="display: flex; align-items: center; gap: 15px;">
              ${result.duration ? `<span class="duration">${(result.duration / 1000).toFixed(2)}s</span>` : ''}
              <span class="status ${result.passed ? 'passed' : 'failed'}">
                ${result.passed ? 'Pass' : 'Fail'}
              </span>
            </div>
          </div>
        `).join('')}
    </div>

    <div class="footer">
      ChainlessChain - 个人移动AI管理系统 © 2025
    </div>
  </div>
</body>
</html>
    `;

    const htmlFile = path.join(reportPath, 'test-report.html');
    await fs.writeFile(htmlFile, html);
    console.log(`HTML报告已保存到: ${htmlFile}`);
  }
}

// 主函数
async function main() {
  const runner = new TestRunner();
  await runner.runAll();
}

// 运行
if (require.main === module) {
  main().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = TestRunner;
