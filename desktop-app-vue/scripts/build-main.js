const fs = require('fs');
const path = require('path');

// 检查是否为生产环境
const isProduction = process.env.NODE_ENV === 'production';

// 动态导入terser（仅在生产环境）
let minifyCode = null;
if (isProduction) {
  try {
    const { minify } = require('terser');
    minifyCode = minify;
  } catch (error) {
    console.warn('⚠ Terser not found. Install with: npm install --save-dev terser');
    console.warn('⚠ Building without minification...');
  }
}

// 递归复制目录，并对JS文件应用压缩
async function copyDir(src, dest) {
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
      await copyDir(srcPath, destPath);
    } else if (entry.name.endsWith('.js') && isProduction && minifyCode) {
      // 生产环境：压缩JS文件并移除console
      try {
        const code = fs.readFileSync(srcPath, 'utf8');
        const minified = await minifyCode(code, {
          compress: {
            drop_console: true,
            drop_debugger: true,
            pure_funcs: ['console.log', 'console.info', 'console.debug'],
          },
          format: {
            comments: false,
          },
          mangle: false, // 保持变量名不混淆，便于调试
        });

        if (minified.code) {
          fs.writeFileSync(destPath, minified.code);
        } else {
          // 如果压缩失败，回退到直接复制
          fs.copyFileSync(srcPath, destPath);
        }
      } catch (error) {
        console.warn(`⚠ Failed to minify ${srcPath}:`, error.message);
        // 回退到直接复制
        fs.copyFileSync(srcPath, destPath);
      }
    } else if (entry.name.endsWith('.js')) {
      // 开发环境的JS文件：使用Buffer确保UTF-8编码
      const buffer = fs.readFileSync(srcPath);
      const code = buffer.toString('utf8');
      fs.writeFileSync(destPath, code, { encoding: 'utf8' });
    } else {
      // 非JS文件：直接复制
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 主构建流程
async function build() {
  const srcMain = path.join(__dirname, '../src/main');
  const srcPreload = path.join(__dirname, '../src/preload');
  const srcShared = path.join(__dirname, '../src/shared');
  const distMain = path.join(__dirname, '../dist/main');
  const distPreload = path.join(__dirname, '../dist/preload');
  const distShared = path.join(__dirname, '../dist/shared');

  console.log(`Building main process... (${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'})`);

  // 复制整个main目录
  await copyDir(srcMain, distMain);
  console.log('✓ Main process files copied' + (isProduction && minifyCode ? ' and minified' : ''));

  // 复制preload目录
  await copyDir(srcPreload, distPreload);
  console.log('✓ Preload files copied' + (isProduction && minifyCode ? ' and minified' : ''));

  // 复制shared目录
  await copyDir(srcShared, distShared);
  console.log('✓ Shared files copied' + (isProduction && minifyCode ? ' and minified' : ''));

  console.log('\nMain process build completed successfully!');
  if (isProduction && !minifyCode) {
    console.warn('\n⚠ PRODUCTION BUILD WITHOUT MINIFICATION!');
    console.warn('⚠ Run: npm install --save-dev terser');
  }
}

// 执行构建
build().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
