#!/usr/bin/env node

/**
 * console 到 logger 批量迁移工具
 *
 * 使用方法：
 *   node scripts/migrate-to-logger.js [--dry-run] [--path=src/main]
 *
 * 选项：
 *   --dry-run    仅显示将要修改的文件，不实际修改
 *   --path       指定要处理的目录（默认：src）
 *   --skip       跳过的目录（多个用逗号分隔）
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targetPath = args.find(arg => arg.startsWith('--path='))?.split('=')[1] || 'src';
const skipDirs = args.find(arg => arg.startsWith('--skip='))?.split('=')[1]?.split(',') || ['node_modules', 'dist', 'out'];

const stats = {
  filesScanned: 0,
  filesModified: 0,
  consoleLog: 0,
  consoleInfo: 0,
  consoleWarn: 0,
  consoleError: 0,
  consoleDebug: 0,
  consoleTime: 0,
  consoleTimeEnd: 0,
};

const loggerImports = {
  main: `const { logger, createLogger } = require('./utils/logger');`,
  renderer: `import { logger, createLogger } from '@/utils/logger';`,
};

/**
 * 判断文件是否应该处理
 */
function shouldProcessFile(filePath) {
  const ext = path.extname(filePath);
  return ['.js', '.ts', '.vue'].includes(ext);
}

/**
 * 判断是否需要跳过目录
 */
function shouldSkipDir(dirPath) {
  const parts = dirPath.split(path.sep);
  return skipDirs.some(skip => parts.includes(skip));
}

/**
 * 检测文件类型（主进程/渲染进程）
 */
function detectFileType(filePath, content) {
  if (filePath.includes('/main/')) return 'main';
  if (filePath.includes('/renderer/')) return 'renderer';

  // 通过内容检测
  if (content.includes('require(') && !content.includes('import ')) return 'main';
  if (content.includes('import ') || content.includes('export default')) return 'renderer';

  return 'renderer'; // 默认渲染进程
}

/**
 * 检查文件是否已导入 logger
 */
function hasLoggerImport(content, fileType) {
  if (fileType === 'main') {
    return content.includes('require(\'./utils/logger\')') ||
           content.includes('require("./utils/logger")') ||
           content.includes('require(\'../utils/logger\')') ||
           content.includes('require("../utils/logger")');
  } else {
    return content.includes('from \'@/utils/logger\'') ||
           content.includes('from "@/utils/logger"');
  }
}

/**
 * 添加 logger 导入
 */
function addLoggerImport(content, fileType, filePath) {
  const importStatement = loggerImports[fileType];

  if (fileType === 'main') {
    // 在第一个 require 之前添加
    const firstRequire = content.match(/^(const|let|var)\s+.*=\s*require\(/m);
    if (firstRequire) {
      const index = content.indexOf(firstRequire[0]);
      return content.slice(0, index) + importStatement + '\n' + content.slice(index);
    } else {
      // 在文件开头添加
      return importStatement + '\n\n' + content;
    }
  } else if (filePath.endsWith('.vue')) {
    // Vue文件：在<script>或<script setup>之后添加
    const scriptMatch = content.match(/<script[^>]*>/);
    if (scriptMatch) {
      const index = content.indexOf(scriptMatch[0]) + scriptMatch[0].length;
      return content.slice(0, index) + '\n' + importStatement + '\n' + content.slice(index);
    }
    return content;
  } else {
    // 在第一个 import 之前添加
    const firstImport = content.match(/^import\s+/m);
    if (firstImport) {
      const index = content.indexOf(firstImport[0]);
      return content.slice(0, index) + importStatement + '\n' + content.slice(index);
    } else {
      return importStatement + '\n\n' + content;
    }
  }
}

/**
 * 替换 console 调用
 */
function replaceConsoleCalls(content) {
  let modified = content;
  let changes = 0;

  // 替换 console.log -> logger.info
  const logMatches = content.match(/console\.log\(/g);
  if (logMatches) {
    stats.consoleLog += logMatches.length;
    changes += logMatches.length;
    modified = modified.replace(/console\.log\(/g, 'logger.info(');
  }

  // 替换 console.info -> logger.info
  const infoMatches = content.match(/console\.info\(/g);
  if (infoMatches) {
    stats.consoleInfo += infoMatches.length;
    changes += infoMatches.length;
    modified = modified.replace(/console\.info\(/g, 'logger.info(');
  }

  // 替换 console.warn -> logger.warn
  const warnMatches = content.match(/console\.warn\(/g);
  if (warnMatches) {
    stats.consoleWarn += warnMatches.length;
    changes += warnMatches.length;
    modified = modified.replace(/console\.warn\(/g, 'logger.warn(');
  }

  // 替换 console.error -> logger.error
  const errorMatches = content.match(/console\.error\(/g);
  if (errorMatches) {
    stats.consoleError += errorMatches.length;
    changes += errorMatches.length;
    modified = modified.replace(/console\.error\(/g, 'logger.error(');
  }

  // 替换 console.debug -> logger.debug
  const debugMatches = content.match(/console\.debug\(/g);
  if (debugMatches) {
    stats.consoleDebug += debugMatches.length;
    changes += debugMatches.length;
    modified = modified.replace(/console\.debug\(/g, 'logger.debug(');
  }

  // 替换 console.time -> logger.perfStart
  const timeMatches = content.match(/console\.time\(/g);
  if (timeMatches) {
    stats.consoleTime += timeMatches.length;
    changes += timeMatches.length;
    modified = modified.replace(/console\.time\(/g, 'logger.perfStart(');
  }

  // 替换 console.timeEnd -> logger.perfEnd
  const timeEndMatches = content.match(/console\.timeEnd\(/g);
  if (timeEndMatches) {
    stats.consoleTimeEnd += timeEndMatches.length;
    changes += timeEndMatches.length;
    modified = modified.replace(/console\.timeEnd\(/g, 'logger.perfEnd(');
  }

  return { content: modified, changes };
}

/**
 * 处理单个文件
 */
function processFile(filePath) {
  stats.filesScanned++;

  const content = fs.readFileSync(filePath, 'utf8');
  const fileType = detectFileType(filePath, content);

  // 替换 console 调用
  const { content: modifiedContent, changes } = replaceConsoleCalls(content);

  if (changes === 0) {
    return; // 没有修改
  }

  // 添加 logger 导入（如果还没有）
  let finalContent = modifiedContent;
  if (!hasLoggerImport(modifiedContent, fileType)) {
    finalContent = addLoggerImport(modifiedContent, fileType, filePath);
  }

  stats.filesModified++;

  if (!dryRun) {
    fs.writeFileSync(filePath, finalContent, 'utf8');
    console.log(`✓ 已修改: ${filePath} (${changes} 处)`);
  } else {
    console.log(`预览: ${filePath} (将修改 ${changes} 处)`);
  }
}

/**
 * 递归处理目录
 */
function processDirectory(dirPath) {
  if (shouldSkipDir(dirPath)) {
    return;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      processDirectory(fullPath);
    } else if (entry.isFile() && shouldProcessFile(fullPath)) {
      try {
        processFile(fullPath);
      } catch (error) {
        console.error(`✗ 处理失败: ${fullPath}`, error.message);
      }
    }
  }
}

/**
 * 主函数
 */
function main() {
  console.log('='.repeat(60));
  console.log('Console to Logger 迁移工具');
  console.log('='.repeat(60));
  console.log(`目标目录: ${targetPath}`);
  console.log(`跳过目录: ${skipDirs.join(', ')}`);
  console.log(`模式: ${dryRun ? '预览模式 (不会修改文件)' : '修改模式'}`);
  console.log('='.repeat(60));
  console.log('');

  const fullPath = path.resolve(targetPath);

  if (!fs.existsSync(fullPath)) {
    console.error(`错误: 目录不存在: ${fullPath}`);
    process.exit(1);
  }

  processDirectory(fullPath);

  console.log('');
  console.log('='.repeat(60));
  console.log('迁移统计:');
  console.log('='.repeat(60));
  console.log(`扫描文件: ${stats.filesScanned}`);
  console.log(`修改文件: ${stats.filesModified}`);
  console.log('');
  console.log('替换详情:');
  console.log(`  console.log   -> logger.info:      ${stats.consoleLog}`);
  console.log(`  console.info  -> logger.info:      ${stats.consoleInfo}`);
  console.log(`  console.warn  -> logger.warn:      ${stats.consoleWarn}`);
  console.log(`  console.error -> logger.error:     ${stats.consoleError}`);
  console.log(`  console.debug -> logger.debug:     ${stats.consoleDebug}`);
  console.log(`  console.time  -> logger.perfStart: ${stats.consoleTime}`);
  console.log(`  console.timeEnd -> logger.perfEnd: ${stats.consoleTimeEnd}`);
  console.log('');
  console.log(`总计替换: ${stats.consoleLog + stats.consoleInfo + stats.consoleWarn + stats.consoleError + stats.consoleDebug + stats.consoleTime + stats.consoleTimeEnd}`);
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('');
    console.log('提示: 这是预览模式，没有实际修改文件。');
    console.log('      移除 --dry-run 参数以执行实际修改。');
  }
}

main();
