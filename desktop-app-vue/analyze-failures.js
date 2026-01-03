const fs = require('fs');

const log = fs.readFileSync('test-results.log', 'utf-8');

// Extract FAIL sections
const failSections = log.match(/FAIL\s+tests\/.*?\.test\.js.*?(?=(?:PASS|FAIL|Test Files))/gs) || [];

const failures = {};

failSections.forEach(section => {
  const fileMatch = section.match(/FAIL\s+(tests\/.*?\.test\.js)/);
  if (!fileMatch) return;
  
  const file = fileMatch[1];
  const failedTests = (section.match(/✖/g) || []).length;
  
  failures[file] = failedTests;
});

// Sort by number of failures
const sorted = Object.entries(failures).sort((a, b) => a[1] - b[1]);

console.log('\n📊 失败测试文件统计 (按失败数量排序)\n');
console.log('文件路径 | 失败数量');
console.log('-'.repeat(80));

sorted.forEach(([file, count]) => {
  console.log(`${file} | ${count}`);
});

console.log('\n总计: ' + sorted.length + ' 个测试文件失败');
console.log('总失败测试数: ' + sorted.reduce((sum, [_, count]) => sum + count, 0));

