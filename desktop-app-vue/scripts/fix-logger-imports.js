#!/usr/bin/env node

/**
 * 修复 logger 导入路径
 * 根据文件位置计算正确的相对路径
 */

const fs = require('fs');
const path = require('path');

function calculateRelativePath(filePath, targetPath) {
  const fileDir = path.dirname(filePath);
  const relativePath = path.relative(fileDir, targetPath);
  return relativePath.startsWith('.') ? relativePath : './' + relativePath;
}

function fixImportPath(filePath, loggerPath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // 检查是否有错误的导入
  if (!content.includes("require('./utils/logger')") &&
      !content.includes('from \'@/utils/logger\'')) {
    return false;
  }

  // 计算正确的相对路径
  const correctPath = calculateRelativePath(filePath, loggerPath);

  // 替换导入路径
  let newContent = content;

  // 主进程文件 (CommonJS)
  newContent = newContent.replace(
    /require\(['"]\.\/utils\/logger['"]\)/g,
    `require('${correctPath}')`
  );

  return newContent !== content ? newContent : false;
}

function processDirectory(dirPath, loggerPath) {
  let fixedCount = 0;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    // 跳过特定目录
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'out', '.git'].includes(entry.name)) {
        continue;
      }
      fixedCount += processDirectory(fullPath, loggerPath);
    } else if (entry.isFile() && fullPath.endsWith('.js')) {
      const newContent = fixImportPath(fullPath, loggerPath);
      if (newContent) {
        fs.writeFileSync(fullPath, newContent, 'utf8');
        console.log(`✓ 已修复: ${fullPath}`);
        fixedCount++;
      }
    }
  }

  return fixedCount;
}

function main() {
  console.log('='.repeat(60));
  console.log('Logger 导入路径修复工具');
  console.log('='.repeat(60));

  const mainLoggerPath = path.resolve('src/main/utils/logger.js');
  const mainDir = path.resolve('src/main');

  console.log(`\n修复 src/main 目录...`);
  const mainFixed = processDirectory(mainDir, mainLoggerPath);

  console.log('\n' + '='.repeat(60));
  console.log(`修复完成！共修复 ${mainFixed} 个文件`);
  console.log('='.repeat(60));
}

main();
