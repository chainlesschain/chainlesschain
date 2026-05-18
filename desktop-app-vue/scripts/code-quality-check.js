/**
 * 代码质量检查脚本
 * 检查外部设备文件功能的代码质量
 */

const fs = require('fs');
const path = require('path');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

// 检查项
const checks = [];

// 检查1: 文件存在性检查
function checkFilesExist() {
  log('\n[检查 1/6] 验证必要文件是否存在...', 'cyan');

  const requiredFiles = [
    'src/main/file/external-device-file-manager.js',
    'src/main/file/external-device-file-ipc.js',
    'src/main/p2p/file-sync-protocols.js',
    'src/renderer/pages/ExternalDeviceBrowser.vue',
  ];

  let passed = 0;
  let failed = 0;

  requiredFiles.forEach((file) => {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
      log(`  ✓ ${file}`, 'green');
      passed++;
    } else {
      log(`  ✗ ${file} 缺失`, 'red');
      failed++;
    }
  });

  checks.push({ name: '文件存在性', passed, failed });
  return failed === 0;
}

// 检查2: 语法基础检查
function checkSyntax() {
  log('\n[检查 2/6] 检查 JavaScript 语法...', 'cyan');

  const files = [
    'src/main/file/external-device-file-manager.js',
    'src/main/file/external-device-file-ipc.js',
  ];

  let passed = 0;
  let failed = 0;

  files.forEach((file) => {
    const filePath = path.join(__dirname, '..', file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // 检查常见语法错误
      const issues = [];

      // 检查未闭合的括号
      const openBraces = (content.match(/{/g) || []).length;
      const closeBraces = (content.match(/}/g) || []).length;
      if (openBraces !== closeBraces) {
        issues.push(`括号不匹配 (${openBraces} 开, ${closeBraces} 闭)`);
      }

      // 检查未闭合的小括号
      const openParens = (content.match(/\(/g) || []).length;
      const closeParens = (content.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        issues.push(`小括号不匹配 (${openParens} 开, ${closeParens} 闭)`);
      }

      // 检查 require 语句
      const requireRegex = /require\(['"](.*?)['"]\)/g;
      const requires = content.match(requireRegex) || [];

      if (issues.length === 0) {
        log(`  ✓ ${file} - 无明显语法错误`, 'green');
        passed++;
      } else {
        log(`  ✗ ${file}:`, 'red');
        issues.forEach((issue) => log(`    - ${issue}`, 'yellow'));
        failed++;
      }
    } catch (error) {
      log(`  ✗ ${file} - ${error.message}`, 'red');
      failed++;
    }
  });

  checks.push({ name: 'JavaScript 语法', passed, failed });
  return failed === 0;
}

// 检查3: 错误处理检查
function checkErrorHandling() {
  log('\n[检查 3/6] 检查错误处理...', 'cyan');

  const filePath = path.join(__dirname, '..', 'src/main/file/external-device-file-manager.js');
  const content = fs.readFileSync(filePath, 'utf-8');

  const issues = [];

  // 检查是否有足够的 try-catch
  const asyncFunctions = content.match(/async \w+\([^)]*\)/g) || [];
  const tryCatchBlocks = content.match(/try\s*{/g) || [];

  if (tryCatchBlocks.length < asyncFunctions.length * 0.7) {
    issues.push(`异步函数可能缺少错误处理 (${asyncFunctions.length} 个异步函数, ${tryCatchBlocks.length} 个 try-catch)`);
  }

  // 检查是否有 logger.error
  const errorLogs = content.match(/logger\.error/g) || [];
  if (errorLogs.length < 5) {
    issues.push(`错误日志可能不足 (仅 ${errorLogs.length} 处)`);
  }

  if (issues.length === 0) {
    log('  ✓ 错误处理充分', 'green');
    checks.push({ name: '错误处理', passed: 1, failed: 0 });
    return true;
  } else {
    log('  ⚠ 发现潜在问题:', 'yellow');
    issues.forEach((issue) => log(`    - ${issue}`, 'yellow'));
    checks.push({ name: '错误处理', passed: 0, failed: 1 });
    return false;
  }
}

// 检查4: 性能相关检查
function checkPerformance() {
  log('\n[检查 4/6] 检查性能优化...', 'cyan');

  const filePath = path.join(__dirname, '..', 'src/main/file/external-device-file-manager.js');
  const content = fs.readFileSync(filePath, 'utf-8');

  const findings = [];

  // 检查是否使用了批量处理
  if (content.includes('batchSize') || content.includes('BATCH_SIZE')) {
    findings.push('✓ 使用了批量处理');
  } else {
    findings.push('⚠ 未发现批量处理逻辑');
  }

  // 检查是否有缓存机制
  if (content.includes('cache') || content.includes('Cache')) {
    findings.push('✓ 实现了缓存机制');
  } else {
    findings.push('⚠ 未发现缓存机制');
  }

  // 检查是否有并发控制
  if (content.includes('concur') || content.includes('queue')) {
    findings.push('✓ 实现了并发控制');
  } else {
    findings.push('⚠ 未发现并发控制');
  }

  // 检查是否有索引优化
  const dbFilePath = path.join(__dirname, '..', 'src/main/database.js');
  if (fs.existsSync(dbFilePath)) {
    const dbContent = fs.readFileSync(dbFilePath, 'utf-8');
    const indexes = dbContent.match(/CREATE INDEX/gi) || [];
    if (indexes.length > 5) {
      findings.push(`✓ 数据库索引充足 (${indexes.length} 个索引)`);
    } else {
      findings.push(`⚠ 数据库索引可能不足 (${indexes.length} 个索引)`);
    }
  }

  findings.forEach((finding) => {
    if (finding.startsWith('✓')) {
      log(`  ${finding}`, 'green');
    } else {
      log(`  ${finding}`, 'yellow');
    }
  });

  const passed = findings.filter((f) => f.startsWith('✓')).length;
  const failed = findings.filter((f) => f.startsWith('⚠')).length;

  checks.push({ name: '性能优化', passed, failed });
  return failed === 0;
}

// 检查5: 安全性检查
function checkSecurity() {
  log('\n[检查 5/6] 检查安全性...', 'cyan');

  const filePath = path.join(__dirname, '..', 'src/main/file/external-device-file-manager.js');
  const content = fs.readFileSync(filePath, 'utf-8');

  const issues = [];

  // 检查是否有路径遍历漏洞防护
  if (!content.includes('path.join') && content.includes('path +')) {
    issues.push('可能存在路径拼接漏洞，建议使用 path.join');
  }

  // 检查是否有 SQL 注入防护
  if (content.includes('prepare(') && content.includes('?')) {
    log('  ✓ 使用了参数化查询，防止 SQL 注入', 'green');
  } else if (content.includes('.exec(') || content.includes('.run(')) {
    issues.push('可能存在 SQL 注入风险，建议使用参数化查询');
  }

  // 检查是否验证文件大小
  if (content.includes('file_size') || content.includes('fileSize')) {
    log('  ✓ 检查了文件大小', 'green');
  } else {
    issues.push('缺少文件大小验证');
  }

  // 检查是否有校验和验证
  if (content.includes('checksum') || content.includes('sha256')) {
    log('  ✓ 实现了文件完整性校验', 'green');
  } else {
    issues.push('缺少文件完整性校验');
  }

  if (issues.length === 0) {
    checks.push({ name: '安全性', passed: 1, failed: 0 });
    return true;
  } else {
    log('  ⚠ 发现潜在安全问题:', 'yellow');
    issues.forEach((issue) => log(`    - ${issue}`, 'yellow'));
    checks.push({ name: '安全性', passed: 0, failed: 1 });
    return false;
  }
}

// 检查6: 代码复杂度
function checkComplexity() {
  log('\n[检查 6/6] 检查代码复杂度...', 'cyan');

  const filePath = path.join(__dirname, '..', 'src/main/file/external-device-file-manager.js');
  const content = fs.readFileSync(filePath, 'utf-8');

  // 统计函数数量
  const functions = content.match(/\w+\s*\([^)]*\)\s*{/g) || [];
  const asyncFunctions = content.match(/async\s+\w+\s*\([^)]*\)/g) || [];

  // 统计代码行数
  const lines = content.split('\n').length;

  // 统计注释行
  const commentLines = content.match(/\/\/.+|\/\*[\s\S]*?\*\//g) || [];

  log(`  ℹ 总代码行数: ${lines}`, 'cyan');
  log(`  ℹ 函数数量: ${functions.length}`, 'cyan');
  log(`  ℹ 异步函数: ${asyncFunctions.length}`, 'cyan');
  log(`  ℹ 注释块: ${commentLines.length}`, 'cyan');

  const findings = [];

  if (lines > 2000) {
    findings.push('⚠ 文件过大，建议拆分模块');
  } else {
    findings.push('✓ 文件大小适中');
  }

  if (commentLines.length / lines > 0.1) {
    findings.push('✓ 注释充分');
  } else {
    findings.push('⚠ 注释可能不足');
  }

  findings.forEach((finding) => {
    if (finding.startsWith('✓')) {
      log(`  ${finding}`, 'green');
    } else {
      log(`  ${finding}`, 'yellow');
    }
  });

  const passed = findings.filter((f) => f.startsWith('✓')).length;
  const failed = findings.filter((f) => f.startsWith('⚠')).length;

  checks.push({ name: '代码复杂度', passed, failed });
  return failed === 0;
}

// 生成报告
function generateReport() {
  log('\n' + '='.repeat(60), 'cyan');
  log('代码质量检查报告', 'cyan');
  log('='.repeat(60), 'cyan');

  let totalPassed = 0;
  let totalFailed = 0;

  checks.forEach((check) => {
    totalPassed += check.passed;
    totalFailed += check.failed;

    const status = check.failed === 0 ? '✓' : '⚠';
    const color = check.failed === 0 ? 'green' : 'yellow';

    log(`${status} ${check.name}: ${check.passed} 通过, ${check.failed} 警告`, color);
  });

  log('\n' + '-'.repeat(60), 'cyan');
  log(`总计: ${totalPassed} 通过, ${totalFailed} 警告`, totalFailed === 0 ? 'green' : 'yellow');

  const score = Math.round((totalPassed / (totalPassed + totalFailed)) * 100);
  log(`代码质量评分: ${score}/100`, score >= 80 ? 'green' : score >= 60 ? 'yellow' : 'red');
  log('='.repeat(60), 'cyan');

  return totalFailed === 0;
}

// 主函数
function main() {
  log('外部设备文件功能 - 代码质量检查', 'cyan');
  log('='.repeat(60), 'cyan');

  checkFilesExist();
  checkSyntax();
  checkErrorHandling();
  checkPerformance();
  checkSecurity();
  checkComplexity();

  const success = generateReport();

  process.exit(success ? 0 : 1);
}

main();
