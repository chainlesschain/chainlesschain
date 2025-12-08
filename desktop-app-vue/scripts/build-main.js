const fs = require('fs');
const path = require('path');

// 递归复制目录
function copyDir(src, dest) {
  // 创建目标目录
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  // 读取源目录
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      // 递归复制子目录
      copyDir(srcPath, destPath);
    } else {
      // 复制文件
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 构建主进程和preload脚本
const srcMain = path.join(__dirname, '../src/main');
const srcPreload = path.join(__dirname, '../src/preload');
const distMain = path.join(__dirname, '../dist/main');
const distPreload = path.join(__dirname, '../dist/preload');

console.log('Building main process...');

// 复制整个main目录
copyDir(srcMain, distMain);
console.log('✓ Main process files copied');

// 复制preload目录
copyDir(srcPreload, distPreload);
console.log('✓ Preload files copied');

console.log('\nMain process build completed successfully!');
