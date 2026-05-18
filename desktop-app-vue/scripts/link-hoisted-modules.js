#!/usr/bin/env node
/**
 * 复制被workspace提升到根目录的所有模块
 * 用于解决Electron打包时无法访问父目录node_modules的问题
 *
 * 策略：复制根目录node_modules中所有本地不存在的模块
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');
const localNodeModules = path.join(__dirname, '..', 'node_modules');
const rootNodeModules = path.join(rootDir, 'node_modules');

console.log('[Copy Hoisted Modules] 开始复制提升的模块...');
console.log(`[Copy Hoisted Modules] 根目录: ${rootNodeModules}`);
console.log(`[Copy Hoisted Modules] 本地目录: ${localNodeModules}`);

// 确保本地node_modules存在
if (!fs.existsSync(localNodeModules)) {
  fs.mkdirSync(localNodeModules, { recursive: true });
}

// 获取根目录所有模块
let rootModules = [];
try {
  rootModules = fs.readdirSync(rootNodeModules);
  console.log(`[Copy Hoisted Modules] 根目录共有 ${rootModules.length} 个模块`);
} catch (err) {
  console.error('[Copy Hoisted Modules] 无法读取根目录node_modules:', err.message);
  process.exit(1);
}

// 获取本地已存在的模块
let localModules = [];
try {
  if (fs.existsSync(localNodeModules)) {
    localModules = fs.readdirSync(localNodeModules);
  }
  console.log(`[Copy Hoisted Modules] 本地已有 ${localModules.length} 个模块`);
} catch (err) {
  console.error('[Copy Hoisted Modules] 无法读取本地node_modules:', err.message);
}

let copiedCount = 0;
let skippedCount = 0;
let errorCount = 0;

// 遍历根目录的所有模块
for (const moduleName of rootModules) {
  // 跳过隐藏文件和.bin目录
  if (moduleName.startsWith('.')) {
    continue;
  }

  const rootModulePath = path.join(rootNodeModules, moduleName);
  const localModulePath = path.join(localNodeModules, moduleName);

  // 检查是否是目录
  try {
    const stats = fs.statSync(rootModulePath);
    if (!stats.isDirectory()) {
      continue;
    }
  } catch (err) {
    continue;
  }

  // 检查本地是否已经存在
  if (fs.existsSync(localModulePath)) {
    try {
      const stats = fs.lstatSync(localModulePath);

      // 如果是符号链接，删除它并复制实际内容
      if (stats.isSymbolicLink()) {
        console.log(`  🔄 替换符号链接: ${moduleName}`);
        fs.rmSync(localModulePath, { recursive: true, force: true });
      } else {
        // 已经是实际目录，跳过
        skippedCount++;
        continue;
      }
    } catch (err) {
      console.error(`  ❌ 无法处理 ${moduleName}:`, err.message);
      errorCount++;
      continue;
    }
  }

  // 复制模块
  try {
    console.log(`  📦 复制 ${moduleName}...`);
    copyDir(rootModulePath, localModulePath);
    copiedCount++;
  } catch (err) {
    console.error(`  ❌ 复制失败 ${moduleName}:`, err.message);
    errorCount++;
  }
}

console.log(`\n[Copy Hoisted Modules] 完成!`);
console.log(`  - 已复制: ${copiedCount}`);
console.log(`  - 已存在(跳过): ${skippedCount}`);
console.log(`  - 错误: ${errorCount}`);
console.log(`  - 总计扫描: ${rootModules.length}`);

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
