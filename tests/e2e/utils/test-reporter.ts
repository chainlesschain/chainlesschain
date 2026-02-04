/**
 * Test Reporter Utility
 * Generates detailed test reports with metrics and visualizations
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TestResult {
  suite: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  retries?: number;
}

export interface TestMetrics {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  passRate: number;
}

export interface PerformanceMetric {
  operation: string;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  count: number;
}

export class TestReporter {
  private results: TestResult[] = [];
  private performanceMetrics: Map<string, number[]> = new Map();
  private startTime: number = 0;
  private endTime: number = 0;

  /**
   * Start test session
   */
  startSession() {
    this.startTime = Date.now();
    this.results = [];
    this.performanceMetrics.clear();
  }

  /**
   * End test session
   */
  endSession() {
    this.endTime = Date.now();
  }

  /**
   * Add test result
   */
  addResult(result: TestResult) {
    this.results.push(result);
  }

  /**
   * Record performance metric
   */
  recordPerformance(operation: string, duration: number) {
    if (!this.performanceMetrics.has(operation)) {
      this.performanceMetrics.set(operation, []);
    }
    this.performanceMetrics.get(operation)!.push(duration);
  }

  /**
   * Calculate metrics
   */
  calculateMetrics(): TestMetrics {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.status === 'passed').length;
    const failed = this.results.filter((r) => r.status === 'failed').length;
    const skipped = this.results.filter((r) => r.status === 'skipped').length;
    const duration = this.endTime - this.startTime;

    return {
      totalTests: total,
      passed,
      failed,
      skipped,
      duration,
      passRate: total > 0 ? (passed / total) * 100 : 0,
    };
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): PerformanceMetric[] {
    const summary: PerformanceMetric[] = [];

    this.performanceMetrics.forEach((durations, operation) => {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);

      summary.push({
        operation,
        avgDuration: avg,
        minDuration: min,
        maxDuration: max,
        count: durations.length,
      });
    });

    return summary.sort((a, b) => b.avgDuration - a.avgDuration);
  }

  /**
   * Generate HTML report
   */
  generateHTMLReport(outputPath: string) {
    const metrics = this.calculateMetrics();
    const perfSummary = this.getPerformanceSummary();

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>E2E Test Report - ChainlessChain PM</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #f5f7fa;
            padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            border-radius: 10px;
            margin-bottom: 30px;
        }
        .header h1 { font-size: 32px; margin-bottom: 10px; }
        .header p { opacity: 0.9; }
        .metrics {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .metric-card {
            background: white;
            padding: 25px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .metric-card h3 {
            color: #64748b;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 10px;
            text-transform: uppercase;
        }
        .metric-card .value {
            font-size: 36px;
            font-weight: 700;
            color: #1e293b;
        }
        .metric-card .label {
            color: #94a3b8;
            font-size: 14px;
            margin-top: 5px;
        }
        .metric-card.passed .value { color: #10b981; }
        .metric-card.failed .value { color: #ef4444; }
        .metric-card.rate .value { color: #3b82f6; }
        .section {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        .section h2 {
            font-size: 24px;
            margin-bottom: 20px;
            color: #1e293b;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e2e8f0;
        }
        th {
            background: #f8fafc;
            font-weight: 600;
            color: #475569;
        }
        .status {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        .status.passed { background: #d1fae5; color: #065f46; }
        .status.failed { background: #fee2e2; color: #991b1b; }
        .status.skipped { background: #fef3c7; color: #92400e; }
        .progress-bar {
            height: 8px;
            background: #e2e8f0;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 10px;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #10b981 0%, #059669 100%);
            transition: width 0.3s;
        }
        .chart {
            margin-top: 20px;
        }
        .bar-chart {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .bar-item {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .bar-label {
            width: 200px;
            font-size: 14px;
            color: #64748b;
        }
        .bar {
            flex: 1;
            height: 30px;
            background: #e2e8f0;
            border-radius: 4px;
            position: relative;
            overflow: hidden;
        }
        .bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            padding: 0 10px;
            color: white;
            font-size: 12px;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 Project Management E2E Test Report</h1>
            <p>Generated on ${new Date().toLocaleString()}</p>
        </div>

        <div class="metrics">
            <div class="metric-card">
                <h3>Total Tests</h3>
                <div class="value">${metrics.totalTests}</div>
                <div class="label">Test cases executed</div>
            </div>
            <div class="metric-card passed">
                <h3>Passed</h3>
                <div class="value">${metrics.passed}</div>
                <div class="label">Success</div>
            </div>
            <div class="metric-card failed">
                <h3>Failed</h3>
                <div class="value">${metrics.failed}</div>
                <div class="label">Failures</div>
            </div>
            <div class="metric-card rate">
                <h3>Pass Rate</h3>
                <div class="value">${metrics.passRate.toFixed(1)}%</div>
                <div class="label">Success rate</div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${metrics.passRate}%"></div>
                </div>
            </div>
            <div class="metric-card">
                <h3>Duration</h3>
                <div class="value">${(metrics.duration / 1000).toFixed(1)}s</div>
                <div class="label">Total execution time</div>
            </div>
        </div>

        <div class="section">
            <h2>Test Results</h2>
            <table>
                <thead>
                    <tr>
                        <th>Suite</th>
                        <th>Test Name</th>
                        <th>Status</th>
                        <th>Duration</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.results
                      .map(
                        (r) => `
                        <tr>
                            <td>${r.suite}</td>
                            <td>${r.name}</td>
                            <td><span class="status ${r.status}">${r.status}</span></td>
                            <td>${r.duration}ms</td>
                        </tr>
                    `
                      )
                      .join('')}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>Performance Metrics</h2>
            <div class="chart">
                <div class="bar-chart">
                    ${perfSummary
                      .map(
                        (p) => `
                        <div class="bar-item">
                            <div class="bar-label">${p.operation}</div>
                            <div class="bar">
                                <div class="bar-fill" style="width: ${Math.min(
                                  (p.avgDuration / 1000) * 10,
                                  100
                                )}%">
                                    ${p.avgDuration.toFixed(0)}ms avg (${p.count} ops)
                                </div>
                            </div>
                        </div>
                    `
                      )
                      .join('')}
                </div>
            </div>
        </div>

        <div class="section">
            <h2>Performance Summary</h2>
            <table>
                <thead>
                    <tr>
                        <th>Operation</th>
                        <th>Avg Duration</th>
                        <th>Min Duration</th>
                        <th>Max Duration</th>
                        <th>Count</th>
                    </tr>
                </thead>
                <tbody>
                    ${perfSummary
                      .map(
                        (p) => `
                        <tr>
                            <td>${p.operation}</td>
                            <td>${p.avgDuration.toFixed(2)}ms</td>
                            <td>${p.minDuration.toFixed(2)}ms</td>
                            <td>${p.maxDuration.toFixed(2)}ms</td>
                            <td>${p.count}</td>
                        </tr>
                    `
                      )
                      .join('')}
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>
    `;

    fs.writeFileSync(outputPath, html, 'utf-8');
  }

  /**
   * Generate JSON report
   */
  generateJSONReport(outputPath: string) {
    const report = {
      timestamp: new Date().toISOString(),
      metrics: this.calculateMetrics(),
      results: this.results,
      performance: this.getPerformanceSummary(),
    };

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  }

  /**
   * Generate markdown report
   */
  generateMarkdownReport(outputPath: string) {
    const metrics = this.calculateMetrics();
    const perfSummary = this.getPerformanceSummary();

    const markdown = `
# Project Management E2E Test Report

**Generated**: ${new Date().toLocaleString()}

## Summary

| Metric | Value |
|--------|-------|
| Total Tests | ${metrics.totalTests} |
| Passed | ✅ ${metrics.passed} |
| Failed | ❌ ${metrics.failed} |
| Skipped | ⏭️ ${metrics.skipped} |
| Pass Rate | ${metrics.passRate.toFixed(1)}% |
| Duration | ${(metrics.duration / 1000).toFixed(1)}s |

## Test Results

| Suite | Test Name | Status | Duration |
|-------|-----------|--------|----------|
${this.results
  .map(
    (r) =>
      `| ${r.suite} | ${r.name} | ${r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : '⏭️'} ${r.status} | ${r.duration}ms |`
  )
  .join('\n')}

## Performance Metrics

| Operation | Avg Duration | Min | Max | Count |
|-----------|--------------|-----|-----|-------|
${perfSummary
  .map(
    (p) =>
      `| ${p.operation} | ${p.avgDuration.toFixed(2)}ms | ${p.minDuration.toFixed(2)}ms | ${p.maxDuration.toFixed(2)}ms | ${p.count} |`
  )
  .join('\n')}

## Failed Tests

${this.results
  .filter((r) => r.status === 'failed')
  .map(
    (r) => `
### ${r.suite} - ${r.name}

\`\`\`
${r.error || 'No error details'}
\`\`\`
`
  )
  .join('\n')}

---
*Report generated by ChainlessChain E2E Test Reporter*
    `;

    fs.writeFileSync(outputPath, markdown.trim(), 'utf-8');
  }

  /**
   * Generate all reports
   */
  generateAllReports(outputDir: string) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    this.generateHTMLReport(path.join(outputDir, `report-${timestamp}.html`));
    this.generateJSONReport(path.join(outputDir, `report-${timestamp}.json`));
    this.generateMarkdownReport(path.join(outputDir, `report-${timestamp}.md`));

    console.log(`\n✅ Test reports generated in: ${outputDir}`);
    console.log(`   - HTML: report-${timestamp}.html`);
    console.log(`   - JSON: report-${timestamp}.json`);
    console.log(`   - Markdown: report-${timestamp}.md\n`);
  }
}

/**
 * Default reporter instance
 */
export const testReporter = new TestReporter();
