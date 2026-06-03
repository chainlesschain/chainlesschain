/**
 * 打包验证脚本
 * 用于测试打包后的应用是否能正确加载所有关键模块
 */

const criticalModules = [
  // 核心依赖
  { name: 'uuid', test: () => require('uuid').v4() },

  // 原生模块
  {
    name: 'better-sqlite3-multiple-ciphers',
    test: () => {
      try {
        const Database = require('better-sqlite3-multiple-ciphers');
        return typeof Database === 'function';
      } catch (e) {
        return false;
      }
    }
  },
  {
    name: 'sharp',
    test: () => {
      try {
        const sharp = require('sharp');
        return typeof sharp === 'function';
      } catch (e) {
        return false;
      }
    }
  },

  // 关键业务模块
  { name: 'node-forge', test: () => !!require('node-forge') },
  { name: 'ethers', test: () => !!require('ethers') },
  { name: 'libp2p', test: () => !!require('libp2p') },
  { name: 'isomorphic-git', test: () => !!require('isomorphic-git') },
  { name: 'chromadb', test: () => !!require('chromadb') },

  // Electron相关
  { name: '@electron/remote', test: () => !!require('@electron/remote') },

  // Vue生态
  { name: 'vue', test: () => !!require('vue') },
  { name: 'pinia', test: () => !!require('pinia') },
  { name: 'vue-router', test: () => !!require('vue-router') },
];

console.log('开始验证打包模块...\n');
console.log('━'.repeat(60));

let passed = 0;
let failed = 0;
const failedModules = [];

for (const module of criticalModules) {
  try {
    const result = module.test();
    if (result !== false) {
      console.log(`✓ ${module.name.padEnd(40)} [通过]`);
      passed++;
    } else {
      console.log(`✗ ${module.name.padEnd(40)} [失败]`);
      failed++;
      failedModules.push(module.name);
    }
  } catch (error) {
    console.log(`✗ ${module.name.padEnd(40)} [错误: ${error.message}]`);
    failed++;
    failedModules.push(module.name);
  }
}

console.log('━'.repeat(60));
console.log(`\n验证完成: ${passed} 通过, ${failed} 失败\n`);

if (failed > 0) {
  console.log('失败的模块:');
  failedModules.forEach(name => console.log(`  - ${name}`));
  console.log('\n建议检查:');
  console.log('  1. forge.config.js 中的 asar.unpack 配置');
  console.log('  2. ignore 规则是否过于激进');
  console.log('  3. 原生模块是否需要 rebuild');
  process.exit(1);
}

console.log('✓ 所有关键模块验证通过!\n');
process.exit(0);
