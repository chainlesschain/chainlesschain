const fs = require('fs');
const path = require('path');

// 简单的构建脚本：复制main和preload文件到dist目录
const sourceMain = path.join(__dirname, '../src/main/index.js');
const sourcePreload = path.join(__dirname, '../src/preload/index.js');
const distMain = path.join(__dirname, '../dist/main');
const distPreload = path.join(__dirname, '../dist/preload');

// 创建目录
if (!fs.existsSync(distMain)) {
  fs.mkdirSync(distMain, { recursive: true });
}
if (!fs.existsSync(distPreload)) {
  fs.mkdirSync(distPreload, { recursive: true });
}

// 复制文件
fs.copyFileSync(sourceMain, path.join(distMain, 'index.js'));
fs.copyFileSync(sourcePreload, path.join(distPreload, 'index.js'));

console.log('Main process build completed!');
