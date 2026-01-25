#!/usr/bin/env node

/**
 * 检查测试进度
 */

const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'full-validation-results.log');

console.log('检查验证测试进度...\n');

if (!fs.existsSync(logFile)) {
  console.log('❌ 验证测试尚未开始或日志文件不存在');
  console.log(`   期望文件: ${logFile}`);
  process.exit(1);
}

const content = fs.readFileSync(logFile, 'utf8');
const lines = content.split('\n');

// 查找进度
const progressLines = lines.filter(line => line.includes('[') && line.includes('/'));
const resultLines = lines.filter(line => line.includes('✅') || line.includes('❌'));

console.log('='.repeat(60));
console.log('测试进度');
console.log('='.repeat(60));

if (progressLines.length > 0) {
  console.log('\n最近的测试:');
  progressLines.slice(-5).forEach(line => console.log('  ' + line.trim()));
}

if (resultLines.length > 0) {
  console.log('\n测试结果:');
  const passed = resultLines.filter(line => line.includes('✅')).length;
  const failed = resultLines.filter(line => line.includes('❌')).length;

  console.log(`  ✅ 通过: ${passed}`);
  console.log(`  ❌ 失败: ${failed}`);
  console.log(`  📊 总计: ${passed + failed}`);
}

// 检查是否完成
if (content.includes('测试结果') || content.includes('成功率')) {
  console.log('\n✅ 验证测试已完成!');
  console.log('\n查看完整结果: cat tests/e2e/full-validation-results.log');
} else {
  console.log('\n🔄 验证测试进行中...');
  console.log('\n实时查看: tail -f tests/e2e/full-validation-results.log');
}

console.log('='.repeat(60));
