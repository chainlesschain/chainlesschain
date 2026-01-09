#!/usr/bin/env node

/**
 * 验证 LLM IPC 修复
 * 这个脚本验证源文件是否正确支持依赖注入
 */

const fs = require('fs');
const path = require('path');

console.log('验证 LLM IPC 修复...\n');

// 1. 检查源文件
const sourceFile = path.join(__dirname, 'src/main/llm/llm-ipc.js');
const sourceContent = fs.readFileSync(sourceFile, 'utf-8');

console.log('1. 检查源文件修改:');
console.log('   - 检查 injectedIpcMain 参数...');
if (sourceContent.includes('ipcMain: injectedIpcMain')) {
  console.log('     ✓ 找到 ipcMain 参数注入');
} else {
  console.log('     ✗ 缺少 ipcMain 参数注入');
  process.exit(1);
}

console.log('   - 检查依赖注入支持...');
if (sourceContent.includes('const ipcMain = injectedIpcMain || electron.ipcMain;')) {
  console.log('     ✓ 正确实现了依赖注入逻辑');
} else {
  console.log('     ✗ 缺少正确的依赖注入逻辑');
  process.exit(1);
}

console.log('   - 检查所有 ipcMain.handle 调用...');
const handlePattern = /ipcMain\.handle\(['"]([^'"]+)['"]/g;
let match;
const handlers = [];
while ((match = handlePattern.exec(sourceContent)) !== null) {
  handlers.push(match[1]);
}

console.log(`     ✓ 找到 ${handlers.length} 个 IPC handlers`);

// 2. 检查测试文件
console.log('\n2. 检查测试文件修改:');
const testFile = path.join(__dirname, 'tests/unit/llm/llm-ipc.test.js');
const testContent = fs.readFileSync(testFile, 'utf-8');

console.log('   - 检查 mockIpcMain 创建...');
if (testContent.includes('mockIpcMain = {') && testContent.includes('handle: (channel, handler) =>')) {
  console.log('     ✓ 正确创建了 mock ipcMain');
} else {
  console.log('     ✗ 缺少 mock ipcMain 创建');
  process.exit(1);
}

console.log('   - 检查依赖注入调用...');
if (testContent.includes('ipcMain: mockIpcMain')) {
  console.log('     ✓ 在 registerLLMIPC 调用中传递了 ipcMain');
} else {
  console.log('     ✗ 缺少 ipcMain 注入');
  process.exit(1);
}

console.log('   - 检查 handler 调用测试...');
if (testContent.includes("const handler = handlers['llm:check-status'];") &&
    testContent.includes('await handler({})')) {
  console.log('     ✓ 正确实现了 handler 调用测试');
} else {
  console.log('     ✗ 缺少 handler 调用测试');
  process.exit(1);
}

// 3. 总结
console.log('\n3. 修复验证总结:');
console.log(`   - 源文件 IPC handlers 数量: ${handlers.length}`);
console.log(`   - Handler 列表: ${handlers.join(', ')}`);
console.log('   - 支持依赖注入: 是');
console.log('   - 测试支持动态验证: 是');

console.log('\n✓ LLM IPC 修复验证完成！');
console.log('\n现在可以运行: npm test -- tests/unit/llm/llm-ipc.test.js');
