/**
 * 数据引擎功能测试脚本
 * 测试CSV/Excel读写、数据分析、图表生成等功能
 */

const path = require('path');
const fs = require('fs').promises;
const DataEngine = require('../src/main/engines/data-engine');

// ANSI颜色代码
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function error(message) {
  log(`❌ ${message}`, 'red');
}

function info(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function section(title) {
  log(`\n${'='.repeat(60)}`, 'yellow');
  log(title, 'yellow');
  log('='.repeat(60), 'yellow');
}

async function cleanup(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (e) {
    // 文件不存在，忽略
  }
}

async function runTests() {
  const dataEngine = new DataEngine();
  const testDir = path.join(__dirname, '..', 'test-data-output');

  // 确保测试目录存在
  await fs.mkdir(testDir, { recursive: true });

  let passed = 0;
  let failed = 0;

  section('数据引擎测试套件');

  // 检查Excel支持
  info(`Excel支持状态: ${dataEngine.excelSupported ? '✅ 已启用' : '❌ 未启用'}`);
  info(`图表类型: ${Object.keys(dataEngine.chartTypes).join(', ')}\n`);

  // 测试1: CSV写入
  section('测试 1: CSV写入功能');
  try {
    const csvPath = path.join(testDir, 'test-sales.csv');
    const testData = {
      headers: ['产品', '销量', '价格', '收入'],
      rows: [
        { '产品': '手机', '销量': '100', '价格': '3999', '收入': '399900' },
        { '产品': '电脑', '销量': '50', '价格': '5999', '收入': '299950' },
        { '产品': '平板', '销量': '80', '价格': '2999', '收入': '239920' },
        { '产品': '耳机', '销量': '200', '价格': '299', '收入': '59800' },
      ]
    };

    await cleanup(csvPath);
    const result = await dataEngine.writeCSV(csvPath, testData);

    if (result.success && result.rowCount === 4) {
      success('CSV写入成功');
      info(`  文件路径: ${csvPath}`);
      info(`  行数: ${result.rowCount}`);
      passed++;
    } else {
      error('CSV写入失败');
      failed++;
    }
  } catch (e) {
    error(`CSV写入异常: ${e.message}`);
    failed++;
  }

  // 测试2: CSV读取
  section('测试 2: CSV读取功能');
  try {
    const csvPath = path.join(testDir, 'test-sales.csv');
    const data = await dataEngine.readCSV(csvPath);

    if (data.success && data.rowCount === 4 && data.headers.length === 4) {
      success('CSV读取成功');
      info(`  表头: ${data.headers.join(', ')}`);
      info(`  行数: ${data.rowCount}`);
      info(`  第一行: ${JSON.stringify(data.rows[0])}`);
      passed++;
    } else {
      error('CSV读取失败');
      failed++;
    }
  } catch (e) {
    error(`CSV读取异常: ${e.message}`);
    failed++;
  }

  // 测试3: CSV特殊字符处理（引号、逗号）
  section('测试 3: CSV特殊字符处理');
  try {
    const csvPath = path.join(testDir, 'test-special.csv');
    const testData = {
      headers: ['名称', '描述', '标签'],
      rows: [
        { '名称': '产品A', '描述': '包含逗号,的描述', '标签': 'tag1' },
        { '名称': '产品B', '描述': '包含"引号"的描述', '标签': 'tag2' },
        { '名称': '产品C', '描述': '同时有,逗号和"引号"', '标签': 'tag3' },
      ]
    };

    await cleanup(csvPath);
    await dataEngine.writeCSV(csvPath, testData);
    const readData = await dataEngine.readCSV(csvPath);

    if (readData.rows[0]['描述'].includes('逗号,') &&
        readData.rows[1]['描述'].includes('"引号"')) {
      success('CSV特殊字符处理正确');
      info(`  逗号处理: ✅`);
      info(`  引号处理: ✅`);
      passed++;
    } else {
      error('CSV特殊字符处理失败');
      failed++;
    }
  } catch (e) {
    error(`CSV特殊字符处理异常: ${e.message}`);
    failed++;
  }

  // 测试4: Excel写入（如果支持）
  if (dataEngine.excelSupported) {
    section('测试 4: Excel写入功能');
    try {
      const excelPath = path.join(testDir, 'test-sales.xlsx');
      const testData = {
        headers: ['产品', '销量', '价格', '收入'],
        rows: [
          { '产品': '手机', '销量': '100', '价格': '3999', '收入': '399900' },
          { '产品': '电脑', '销量': '50', '价格': '5999', '收入': '299950' },
          { '产品': '平板', '销量': '80', '价格': '2999', '收入': '239920' },
        ]
      };

      await cleanup(excelPath);
      const result = await dataEngine.writeExcel(excelPath, testData);

      if (result.success && result.rowCount === 3) {
        success('Excel写入成功');
        info(`  文件路径: ${excelPath}`);
        info(`  行数: ${result.rowCount}`);
        passed++;
      } else {
        error('Excel写入失败');
        failed++;
      }
    } catch (e) {
      error(`Excel写入异常: ${e.message}`);
      failed++;
    }

    // 测试5: Excel读取
    section('测试 5: Excel读取功能');
    try {
      const excelPath = path.join(testDir, 'test-sales.xlsx');
      const data = await dataEngine.readExcel(excelPath);

      if (data.success && data.rowCount === 3 && data.headers.length === 4) {
        success('Excel读取成功');
        info(`  工作表: ${data.sheetName}`);
        info(`  表头: ${data.headers.join(', ')}`);
        info(`  行数: ${data.rowCount}`);
        passed++;
      } else {
        error('Excel读取失败');
        failed++;
      }
    } catch (e) {
      error(`Excel读取异常: ${e.message}`);
      failed++;
    }
  } else {
    section('测试 4-5: Excel功能');
    log('⚠️  Excel库未安装，跳过Excel测试', 'yellow');
  }

  // 测试6: 数据分析
  section('测试 6: 数据分析功能');
  try {
    const csvPath = path.join(testDir, 'test-sales.csv');
    const data = await dataEngine.readCSV(csvPath);
    const analysis = dataEngine.analyzeData(data, { columns: ['销量', '价格', '收入'] });

    if (analysis.success && analysis.columns.length === 3) {
      success('数据分析成功');
      info(`  分析列: ${analysis.columns.join(', ')}`);

      for (const column of analysis.columns) {
        const stats = analysis.analysis[column];
        info(`  ${column}统计:`);
        info(`    - 平均值: ${stats.mean.toFixed(2)}`);
        info(`    - 中位数: ${stats.median.toFixed(2)}`);
        info(`    - 标准差: ${stats.stdDev.toFixed(2)}`);
        info(`    - 最小值: ${stats.min}`);
        info(`    - 最大值: ${stats.max}`);
      }
      passed++;
    } else {
      error('数据分析失败');
      failed++;
    }
  } catch (e) {
    error(`数据分析异常: ${e.message}`);
    failed++;
  }

  // 测试7: 图表生成
  section('测试 7: 图表生成功能');
  try {
    const csvPath = path.join(testDir, 'test-sales.csv');
    const chartPath = path.join(testDir, 'test-chart.html');
    const data = await dataEngine.readCSV(csvPath);

    await cleanup(chartPath);
    const result = await dataEngine.generateChart(data, {
      chartType: 'bar',
      title: '产品销量图表',
      xColumn: '产品',
      yColumn: '销量',
      outputPath: chartPath
    });

    if (result.success && result.filePath) {
      const chartContent = await fs.readFile(chartPath, 'utf-8');
      const hasChartJS = chartContent.toLowerCase().includes('chart.js');
      const hasTitle = chartContent.includes('产品销量图表');

      if (hasChartJS && hasTitle) {
        success('图表生成成功');
        info(`  图表类型: ${result.chartType}`);
        info(`  文件路径: ${result.filePath}`);
        info(`  文件大小: ${chartContent.length} bytes`);
        passed++;
      } else {
        error('图表内容不完整');
        info(`  Chart.js检测: ${hasChartJS ? '✅' : '❌'}`);
        info(`  标题检测: ${hasTitle ? '✅' : '❌'}`);
        failed++;
      }
    } else {
      error('图表生成失败');
      failed++;
    }
  } catch (e) {
    error(`图表生成异常: ${e.message}`);
    failed++;
  }

  // 测试8: 分析报告生成
  section('测试 8: 分析报告生成功能');
  try {
    const csvPath = path.join(testDir, 'test-sales.csv');
    const reportPath = path.join(testDir, 'test-report.md');
    const data = await dataEngine.readCSV(csvPath);
    const analysis = dataEngine.analyzeData(data);

    await cleanup(reportPath);
    const result = await dataEngine.generateReport(analysis, reportPath);

    if (result.success && result.filePath) {
      const reportContent = await fs.readFile(reportPath, 'utf-8');
      if (reportContent.includes('数据分析报告') && reportContent.includes('统计指标')) {
        success('分析报告生成成功');
        info(`  文件路径: ${result.filePath}`);
        info(`  文件大小: ${reportContent.length} bytes`);
        passed++;
      } else {
        error('报告内容不完整');
        failed++;
      }
    } else {
      error('报告生成失败');
      failed++;
    }
  } catch (e) {
    error(`报告生成异常: ${e.message}`);
    failed++;
  }

  // 测试9: 路径安全验证
  section('测试 9: 路径安全验证');
  try {
    const engine = new DataEngine();
    const testCases = [
      { path: 'data.csv', expected: true, desc: '正常文件名' },
      { path: '../etc/passwd', expected: false, desc: '父目录遍历' },
      { path: '/etc/passwd', expected: false, desc: '绝对路径' },
      { path: 'file\\\\share', expected: false, desc: '多个反斜杠' },
      { path: 'file:name.csv', expected: false, desc: '非法字符' },
      { path: 'normal_file-123.xlsx', expected: true, desc: '正常Excel文件' },
    ];

    let securityPassed = 0;
    let securityFailed = 0;

    for (const test of testCases) {
      const result = engine.isPathSafe(test.path);
      if (result === test.expected) {
        info(`  ✅ ${test.desc}: ${test.path} → ${result}`);
        securityPassed++;
      } else {
        info(`  ❌ ${test.desc}: ${test.path} → ${result} (预期: ${test.expected})`);
        securityFailed++;
      }
    }

    if (securityFailed === 0) {
      success(`路径安全验证通过 (${securityPassed}/${testCases.length})`);
      passed++;
    } else {
      error(`路径安全验证失败 (${securityPassed}/${testCases.length})`);
      failed++;
    }
  } catch (e) {
    error(`路径安全验证异常: ${e.message}`);
    failed++;
  }

  // 测试10: 统计计算精度
  section('测试 10: 统计计算精度验证');
  try {
    const testData = {
      headers: ['值'],
      rows: [
        { '值': '10' },
        { '值': '20' },
        { '值': '30' },
        { '值': '40' },
        { '值': '50' },
      ]
    };

    const analysis = dataEngine.analyzeData(testData);
    const stats = analysis.analysis['值'];

    const expectedMean = 30;
    const expectedMedian = 30;
    const expectedStdDev = 15.81; // 样本标准差

    const meanCorrect = Math.abs(stats.mean - expectedMean) < 0.01;
    const medianCorrect = Math.abs(stats.median - expectedMedian) < 0.01;
    const stdDevCorrect = Math.abs(stats.stdDev - expectedStdDev) < 0.01;

    if (meanCorrect && medianCorrect && stdDevCorrect) {
      success('统计计算精度正确');
      info(`  平均值: ${stats.mean} (预期: ${expectedMean})`);
      info(`  中位数: ${stats.median} (预期: ${expectedMedian})`);
      info(`  标准差: ${stats.stdDev.toFixed(2)} (预期: ${expectedStdDev})`);
      passed++;
    } else {
      error('统计计算精度不正确');
      info(`  平均值: ${stats.mean} vs ${expectedMean} - ${meanCorrect ? '✅' : '❌'}`);
      info(`  中位数: ${stats.median} vs ${expectedMedian} - ${medianCorrect ? '✅' : '❌'}`);
      info(`  标准差: ${stats.stdDev.toFixed(2)} vs ${expectedStdDev} - ${stdDevCorrect ? '✅' : '❌'}`);
      failed++;
    }
  } catch (e) {
    error(`统计计算异常: ${e.message}`);
    failed++;
  }

  // 汇总结果
  section('测试结果汇总');
  const total = passed + failed;
  const percentage = ((passed / total) * 100).toFixed(1);

  log(`\n通过: ${passed}/${total} (${percentage}%)`, passed === total ? 'green' : 'yellow');
  log(`失败: ${failed}/${total}`, failed > 0 ? 'red' : 'green');

  if (passed === total) {
    log('\n🎉 所有测试通过！数据引擎功能完整！', 'green');
  } else {
    log('\n⚠️  部分测试失败，请检查上述错误信息', 'yellow');
  }

  log(`\n测试文件位置: ${testDir}`, 'gray');
  log('可以查看生成的CSV、Excel、图表和报告文件\n', 'gray');
}

// 运行测试
runTests().catch(err => {
  error(`测试执行失败: ${err.message}`);
  console.error(err);
  process.exit(1);
});
