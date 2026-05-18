#!/usr/bin/env node

/**
 * 快速检查 - 验证测试文件结构
 */

const fs = require('fs');
const path = require('path');

const modules = ['knowledge', 'social', 'settings', 'monitoring', 'trading', 'enterprise', 'devtools', 'content', 'plugins', 'multimedia'];

console.log('快速检查新创建的E2E测试文件...\n');

let totalFiles = 0;
let validFiles = 0;

modules.forEach(module => {
  const dir = path.join(__dirname, module);

  if (!fs.existsSync(dir)) {
    console.log(`❌ 目录不存在: ${module}/`);
    return;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.ts'));
  console.log(`✅ ${module.padEnd(15)} ${files.length} 个测试文件`);

  totalFiles += files.length;

  files.forEach(file => {
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    const hasImport = content.includes('import') && content.includes('@playwright/test');
    const hasHelper = content.includes('launchElectronApp');
    const hasDescribe = content.includes('test.describe');
    const hasTest = content.includes('test(');

    if (hasImport && hasHelper && hasDescribe && hasTest) {
      validFiles++;
    } else {
      console.log(`  ⚠️  ${file} 可能缺少必要结构`);
    }
  });
});

console.log(`\n总计: ${totalFiles} 个文件, ${validFiles} 个结构正确`);
console.log(validFiles === totalFiles ? '✅ 所有文件结构正确!' : '⚠️  部分文件需要检查');
