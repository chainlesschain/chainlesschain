/**
 * 测试验证脚本
 * 静态分析测试文件的结构和质量
 */

const fs = require('fs');
const path = require('path');

// ANSI颜色代码
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  red: '\x1b[31m',
  bold: '\x1b[1m'
};

function analyzeTestFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const stats = {
    filePath,
    totalLines: lines.length,
    describes: 0,
    its: 0,
    expects: 0,
    beforeEachs: 0,
    afterEachs: 0,
    mocks: 0,
    imports: 0,
    comments: 0
  };

  // 分析每一行
  lines.forEach(line => {
    const trimmed = line.trim();

    if (trimmed.startsWith('describe(')) stats.describes++;
    if (trimmed.startsWith('it(')) stats.its++;
    if (trimmed.includes('expect(')) stats.expects++;
    if (trimmed.startsWith('beforeEach(')) stats.beforeEachs++;
    if (trimmed.startsWith('afterEach(')) stats.afterEachs++;
    if (trimmed.includes('vi.mock(') || trimmed.includes('.mockReturnValue') || trimmed.includes('.mockResolvedValue')) stats.mocks++;
    if (trimmed.startsWith('import ') || trimmed.startsWith('const ') && trimmed.includes('require(')) stats.imports++;
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) stats.comments++;
  });

  return stats;
}

function validateTestStructure(stats) {
  const issues = [];
  const warnings = [];

  // 验证测试用例数量
  if (stats.its === 0) {
    issues.push('没有找到测试用例 (it)');
  } else if (stats.its < 10) {
    warnings.push(`测试用例较少: ${stats.its}个`);
  }

  // 验证断言数量
  if (stats.expects === 0) {
    issues.push('没有找到断言 (expect)');
  } else if (stats.expects < stats.its) {
    warnings.push(`断言数量(${stats.expects})少于测试用例数(${stats.its})`);
  }

  // 验证测试套件
  if (stats.describes === 0) {
    warnings.push('没有使用 describe 组织测试');
  }

  // 验证清理
  if (stats.beforeEachs === 0 && stats.mocks > 0) {
    warnings.push('使用了mock但没有beforeEach清理');
  }

  // 验证Mock数量
  if (stats.mocks === 0 && stats.imports > 3) {
    warnings.push('可能缺少必要的Mock');
  }

  return { issues, warnings };
}

function printReport(testFiles) {
  console.log(`\n${colors.bold}${colors.blue}============================================`);
  console.log('📊 测试验证报告');
  console.log(`============================================${colors.reset}\n`);

  let totalStats = {
    files: testFiles.length,
    describes: 0,
    its: 0,
    expects: 0,
    lines: 0,
    issues: 0,
    warnings: 0
  };

  testFiles.forEach((file, index) => {
    const stats = analyzeTestFile(file);
    const validation = validateTestStructure(stats);

    console.log(`${colors.bold}文件 ${index + 1}: ${path.basename(file)}${colors.reset}`);
    console.log(`  路径: ${file}`);
    console.log(`  ${colors.green}✓ 代码行数: ${stats.totalLines}${colors.reset}`);
    console.log(`  ${colors.green}✓ 测试套件: ${stats.describes}个 describe${colors.reset}`);
    console.log(`  ${colors.green}✓ 测试用例: ${stats.its}个 it${colors.reset}`);
    console.log(`  ${colors.green}✓ 断言数量: ${stats.expects}个 expect${colors.reset}`);
    console.log(`  ${colors.blue}  Mock数量: ${stats.mocks}个${colors.reset}`);
    console.log(`  ${colors.blue}  生命周期: ${stats.beforeEachs} beforeEach, ${stats.afterEachs} afterEach${colors.reset}`);

    if (validation.issues.length > 0) {
      console.log(`\n  ${colors.red}❌ 问题:${colors.reset}`);
      validation.issues.forEach(issue => {
        console.log(`     - ${issue}`);
      });
      totalStats.issues += validation.issues.length;
    }

    if (validation.warnings.length > 0) {
      console.log(`\n  ${colors.yellow}⚠️  警告:${colors.reset}`);
      validation.warnings.forEach(warning => {
        console.log(`     - ${warning}`);
      });
      totalStats.warnings += validation.warnings.length;
    }

    console.log('');

    // 累加统计
    totalStats.describes += stats.describes;
    totalStats.its += stats.its;
    totalStats.expects += stats.expects;
    totalStats.lines += stats.totalLines;
  });

  // 打印汇总
  console.log(`${colors.bold}${colors.blue}============================================`);
  console.log('📈 汇总统计');
  console.log(`============================================${colors.reset}\n`);

  console.log(`  测试文件: ${colors.bold}${totalStats.files}${colors.reset} 个`);
  console.log(`  代码行数: ${colors.bold}${totalStats.lines.toLocaleString()}${colors.reset} 行`);
  console.log(`  测试套件: ${colors.bold}${totalStats.describes}${colors.reset} 个`);
  console.log(`  测试用例: ${colors.bold}${totalStats.its}${colors.reset} 个`);
  console.log(`  断言数量: ${colors.bold}${totalStats.expects}${colors.reset} 个`);
  console.log(`  平均每个文件: ${colors.bold}${Math.round(totalStats.its / totalStats.files)}${colors.reset} 个用例`);

  console.log('');

  // 质量评分
  const coverageRatio = totalStats.expects / totalStats.its;
  const testDensity = totalStats.its / (totalStats.lines / 100);

  console.log(`${colors.bold}${colors.blue}质量指标:${colors.reset}`);
  console.log(`  断言覆盖率: ${colors.bold}${(coverageRatio * 100).toFixed(1)}%${colors.reset} (${coverageRatio >= 1 ? colors.green + '优秀' : colors.yellow + '良好'}${colors.reset})`);
  console.log(`  测试密度: ${colors.bold}${testDensity.toFixed(2)}${colors.reset} 用例/100行 (${testDensity >= 8 ? colors.green + '优秀' : testDensity >= 5 ? colors.yellow + '良好' : colors.red + '需改进'}${colors.reset})`);

  console.log('');

  // 最终评估
  if (totalStats.issues === 0 && totalStats.warnings === 0) {
    console.log(`${colors.green}${colors.bold}✅ 所有测试文件验证通过！${colors.reset}`);
    console.log(`${colors.green}   结构完整，可以运行测试。${colors.reset}\n`);
  } else if (totalStats.issues === 0) {
    console.log(`${colors.yellow}${colors.bold}⚠️  测试文件基本合格，但有 ${totalStats.warnings} 个警告${colors.reset}\n`);
  } else {
    console.log(`${colors.red}${colors.bold}❌ 发现 ${totalStats.issues} 个问题，请修复后再运行测试${colors.reset}\n`);
  }

  return totalStats.issues === 0;
}

// 主函数
function main() {
  const testFiles = [
    path.join(__dirname, '../tests/unit/config/unified-config-manager.test.js'),
    path.join(__dirname, '../tests/unit/api/backend-client.test.js')
  ];

  // 检查文件是否存在
  const existingFiles = testFiles.filter(file => fs.existsSync(file));
  const missingFiles = testFiles.filter(file => !fs.existsSync(file));

  if (missingFiles.length > 0) {
    console.log(`${colors.red}❌ 缺少测试文件:${colors.reset}`);
    missingFiles.forEach(file => console.log(`  - ${file}`));
    console.log('');
  }

  if (existingFiles.length === 0) {
    console.log(`${colors.red}错误: 没有找到任何测试文件${colors.reset}\n`);
    process.exit(1);
  }

  const success = printReport(existingFiles);

  console.log(`${colors.blue}💡 提示: 要运行实际测试，请执行:${colors.reset}`);
  console.log(`   npm run test tests/unit/config tests/unit/api\n`);

  process.exit(success ? 0 : 1);
}

main();
