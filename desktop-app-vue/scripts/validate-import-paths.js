#!/usr/bin/env node

/**
 * 验证测试文件的导入路径
 *
 * 检查子目录中的测试文件是否使用了正确的相对路径层级
 * 防止 MODULE_NOT_FOUND 错误
 *
 * 用法:
 *   node scripts/validate-import-paths.js
 *   node scripts/validate-import-paths.js --fix
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(color, ...args, COLORS.reset);
}

/**
 * 计算文件所需的 ../ 层级数
 * @param {string} filePath - 测试文件路径
 * @returns {number} - 需要的 ../ 数量
 */
function getRequiredLevels(filePath) {
  // 从 tests/unit/ 计算深度
  const relativePath = filePath.replace(/^tests\/unit\//, '');
  const depth = relativePath.split('/').length - 1; // -1 因为文件本身不算

  // 需要 depth + 2 个 ../ 才能到达 src/
  // 例如: tests/unit/tools/file.test.js
  //   depth = 1 (tools)
  //   需要: ../../../ (3个) 才能到 src/
  return depth + 2;
}

/**
 * 提取文件中所有的导入路径
 * @param {string} content - 文件内容
 * @returns {Array} - 导入路径列表
 */
function extractImports(content) {
  const imports = [];

  // require() patterns
  const requireMatches = content.matchAll(/require\(['"]([^'"]+)['"]\)/g);
  for (const match of requireMatches) {
    imports.push({ type: 'require', path: match[1], fullMatch: match[0] });
  }

  // import from patterns
  const importMatches = content.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g);
  for (const match of importMatches) {
    imports.push({ type: 'import', path: match[1], fullMatch: match[0] });
  }

  // vi.mock() patterns
  const mockMatches = content.matchAll(/vi\.mock\(['"]([^'"]+)['"]/g);
  for (const match of mockMatches) {
    imports.push({ type: 'mock', path: match[1], fullMatch: match[0] });
  }

  return imports;
}

/**
 * 验证导入路径的 ../ 层级
 * @param {string} importPath - 导入路径
 * @param {number} requiredLevels - 需要的层级数
 * @returns {Object} - 验证结果
 */
function validateImportPath(importPath, requiredLevels) {
  // 跳过非相对路径
  if (!importPath.startsWith('../')) {
    return { valid: true, reason: 'not_relative' };
  }

  // 跳过不是指向 src/ 的路径
  if (!importPath.includes('/src/')) {
    return { valid: true, reason: 'not_src' };
  }

  // 计算实际的 ../ 层级
  const actualLevels = (importPath.match(/\.\.\//g) || []).length;

  if (actualLevels === requiredLevels) {
    return { valid: true, actualLevels, requiredLevels };
  }

  return {
    valid: false,
    actualLevels,
    requiredLevels,
    suggested: importPath.replace(
      new RegExp(`^(\\.\\./)+ {${actualLevels}}`),
      '../'.repeat(requiredLevels)
    ),
  };
}

/**
 * 验证单个文件
 * @param {string} filePath - 文件路径
 * @param {boolean} autoFix - 是否自动修复
 * @returns {Object} - 验证结果
 */
function validateFile(filePath, autoFix = false) {
  const content = fs.readFileSync(filePath, 'utf8');
  const imports = extractImports(content);
  const requiredLevels = getRequiredLevels(filePath);

  const errors = [];
  let fixedContent = content;

  imports.forEach((imp) => {
    const validation = validateImportPath(imp.path, requiredLevels);

    if (!validation.valid) {
      errors.push({
        import: imp,
        validation,
      });

      if (autoFix && validation.suggested) {
        fixedContent = fixedContent.replace(
          imp.fullMatch,
          imp.fullMatch.replace(imp.path, validation.suggested)
        );
      }
    }
  });

  if (autoFix && errors.length > 0) {
    fs.writeFileSync(filePath, fixedContent, 'utf8');
  }

  return {
    filePath,
    requiredLevels,
    totalImports: imports.length,
    errors,
    fixed: autoFix && errors.length > 0,
  };
}

/**
 * 验证所有测试文件
 * @param {boolean} autoFix - 是否自动修复
 */
function validateAll(autoFix = false) {
  log(COLORS.cyan, '\n🔍 Validating test import paths...\n');

  const testFiles = glob.sync('tests/unit/**/*.{js,ts}', {
    ignore: [
      '**/node_modules/**',
      '**/__mocks__/**',
      '**/dist/**',
      '**/*.md',
    ],
  });

  log(COLORS.blue, `📁 Found ${testFiles.length} test files\n`);

  const results = testFiles.map((file) => validateFile(file, autoFix));

  const filesWithErrors = results.filter((r) => r.errors.length > 0);
  const totalErrors = filesWithErrors.reduce((sum, r) => sum + r.errors.length, 0);

  // 打印结果
  if (filesWithErrors.length === 0) {
    log(COLORS.green, '✅ All import paths are correct!');
    return { success: true, totalFiles: testFiles.length };
  }

  log(COLORS.red, `\n❌ Found ${totalErrors} incorrect import paths in ${filesWithErrors.length} files:\n`);

  filesWithErrors.forEach((result) => {
    log(COLORS.yellow, `📄 ${result.filePath}`);
    log(COLORS.blue, `   Required levels: ${result.requiredLevels} (${' ../'.repeat(result.requiredLevels)})`);

    result.errors.forEach((error, index) => {
      const { import: imp, validation } = error;

      log(COLORS.red, `   ${index + 1}. ${imp.type}: ${imp.path}`);
      log(COLORS.cyan, `      Actual: ${validation.actualLevels} levels`);
      log(COLORS.cyan, `      Expected: ${validation.requiredLevels} levels`);

      if (validation.suggested) {
        log(COLORS.green, `      Fix: ${validation.suggested}`);
      }
    });

    console.log();
  });

  if (autoFix) {
    log(COLORS.green, `\n✅ Fixed ${filesWithErrors.length} files automatically`);
    return { success: true, fixed: filesWithErrors.length };
  } else {
    log(COLORS.yellow, '\n💡 Run with --fix flag to auto-fix these issues:');
    log(COLORS.cyan, '   node scripts/validate-import-paths.js --fix\n');
    return { success: false, errors: totalErrors };
  }
}

/**
 * 生成验证报告
 */
function generateReport() {
  log(COLORS.cyan, '\n📊 Generating import path validation report...\n');

  const testFiles = glob.sync('tests/unit/**/*.{js,ts}', {
    ignore: ['**/node_modules/**', '**/__mocks__/**', '**/dist/**', '**/*.md'],
  });

  const stats = {
    totalFiles: testFiles.length,
    byDepth: {},
    withRelativeImports: 0,
    withAbsoluteImports: 0,
    withIncorrectPaths: 0,
  };

  testFiles.forEach((file) => {
    const result = validateFile(file);
    const depth = result.requiredLevels - 2; // Convert back to directory depth

    if (!stats.byDepth[depth]) {
      stats.byDepth[depth] = 0;
    }
    stats.byDepth[depth]++;

    if (result.totalImports > 0) {
      stats.withRelativeImports++;
    }

    if (result.errors.length > 0) {
      stats.withIncorrectPaths++;
    }
  });

  console.log('📊 Statistics:');
  console.log(`   Total test files: ${stats.totalFiles}`);
  console.log(`   Files with relative imports: ${stats.withRelativeImports}`);
  console.log(`   Files with incorrect paths: ${stats.withIncorrectPaths}`);
  console.log('\n📁 Files by directory depth:');

  Object.keys(stats.byDepth)
    .sort()
    .forEach((depth) => {
      const levels = parseInt(depth) + 2;
      const prefix = '../'.repeat(levels);
      console.log(`   Depth ${depth} (${prefix}): ${stats.byDepth[depth]} files`);
    });

  console.log();
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const autoFix = args.includes('--fix');
  const showReport = args.includes('--report');

  if (showReport) {
    generateReport();
  } else {
    const result = validateAll(autoFix);
    process.exit(result.success ? 0 : 1);
  }
}

module.exports = {
  validateFile,
  validateAll,
  getRequiredLevels,
  extractImports,
  validateImportPath,
};
