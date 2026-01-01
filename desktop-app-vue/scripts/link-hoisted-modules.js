#!/usr/bin/env node
/**
 * 链接被workspace提升到根目录的模块
 * 用于解决Electron打包时无法访问父目录node_modules的问题
 */

const fs = require('fs');
const path = require('path');

// 需要链接的模块列表（这些模块被提升到根目录）
const HOISTED_MODULES = [
  'uuid',
  'axios',
  'lodash',
  'express',
  'dotenv',
  'sql.js'
];

const rootDir = path.join(__dirname, '..', '..');
const localNodeModules = path.join(__dirname, '..', 'node_modules');
const rootNodeModules = path.join(rootDir, 'node_modules');

console.log('[Link Hoisted Modules] 开始链接提升的模块...');

// 确保本地node_modules存在
if (!fs.existsSync(localNodeModules)) {
  fs.mkdirSync(localNodeModules, { recursive: true });
}

let linkedCount = 0;
let skippedCount = 0;

HOISTED_MODULES.forEach(moduleName => {
  const rootModulePath = path.join(rootNodeModules, moduleName);
  const localModulePath = path.join(localNodeModules, moduleName);

  // 检查根目录是否有这个模块
  if (!fs.existsSync(rootModulePath)) {
    console.log(`  ⚠️  ${moduleName} 不在根目录，跳过`);
    skippedCount++;
    return;
  }

  // 如果本地已经存在（可能是符号链接或实际目录）
  if (fs.existsSync(localModulePath)) {
    try {
      const stats = fs.lstatSync(localModulePath);
      if (stats.isSymbolicLink()) {
        console.log(`  ✓  ${moduleName} 已经是符号链接`);
        linkedCount++;
        return;
      }
      // 如果是实际目录，删除它
      console.log(`  🔄 删除现有目录: ${moduleName}`);
      fs.rmSync(localModulePath, { recursive: true, force: true });
    } catch (err) {
      console.error(`  ❌ 无法处理 ${moduleName}:`, err.message);
      return;
    }
  }

  // 创建符号链接 (Windows上可能需要管理员权限，使用junction作为替代)
  try {
    if (process.platform === 'win32') {
      // Windows: 使用junction (不需要管理员权限)
      fs.symlinkSync(rootModulePath, localModulePath, 'junction');
    } else {
      // Unix: 使用符号链接
      fs.symlinkSync(rootModulePath, localModulePath);
    }
    console.log(`  ✓  已链接: ${moduleName}`);
    linkedCount++;
  } catch (err) {
    console.error(`  ❌ 无法链接 ${moduleName}:`, err.message);

    // 如果符号链接失败，尝试复制
    try {
      console.log(`  🔄 尝试复制 ${moduleName}...`);
      copyDir(rootModulePath, localModulePath);
      console.log(`  ✓  已复制: ${moduleName}`);
      linkedCount++;
    } catch (copyErr) {
      console.error(`  ❌ 复制也失败了:`, copyErr.message);
    }
  }
});

console.log(`\n[Link Hoisted Modules] 完成! 链接/复制: ${linkedCount}, 跳过: ${skippedCount}`);

/**
 * 递归复制目录
 */
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
