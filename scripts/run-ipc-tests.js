#!/usr/bin/env node
/**
 * IPC API 单元测试运行器
 * 运行新增的62个API方法的测试
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('========================================');
console.log('Running IPC API Unit Tests');
console.log('========================================\n');

const testFiles = [
  'knowledge-ipc.test.js',
  'system-ipc.test.js',
  'social-ipc.test.js',
  'notification-ipc.test.js',
  'pdf-ipc.test.js',
  'document-ipc.test.js',
  'git-sync-ipc.test.js',
];

const results = {
  passed: 0,
  failed: 0,
  total: testFiles.length,
};

testFiles.forEach((testFile, index) => {
  const testPath = path.join(__dirname, '../tests/unit', testFile);

  if (!fs.existsSync(testPath)) {
    console.log(`❌ [${index + 1}/${testFiles.length}] ${testFile} - File not found`);
    results.failed++;
    return;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${index + 1}/${testFiles.length}: ${testFile}`);
  console.log('='.repeat(60));

  try {
    // 运行测试
    execSync(`npx vitest run ${testPath}`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });

    console.log(`✅ ${testFile} - PASSED`);
    results.passed++;
  } catch (error) {
    console.log(`❌ ${testFile} - FAILED`);
    results.failed++;
  }
});

console.log('\n' + '='.repeat(60));
console.log('Test Results Summary');
console.log('='.repeat(60));
console.log(`Total: ${results.total}`);
console.log(`Passed: ${results.passed}`);
console.log(`Failed: ${results.failed}`);
console.log(`Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);
console.log('='.repeat(60));

process.exit(results.failed > 0 ? 1 : 0);
