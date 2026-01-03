/**
 * 应用性能优化配置
 * 简化版 - 直接应用推荐设置
 */

console.log('🚀 应用性能优化配置...\n');

// 1. 验证环境变量
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');

if (!fs.existsSync(envPath)) {
  console.log('❌ .env文件不存在');
  console.log('   请先运行: cp .env.performance .env');
  process.exit(1);
}

console.log('✅ 环境变量文件已配置');

// 2. 验证配置文件
const configPath = path.join(__dirname, '..', 'config', 'performance.config.js');

if (!fs.existsSync(configPath)) {
  console.log('❌ 性能配置文件不存在');
  process.exit(1);
}

console.log('✅ 性能配置文件已就绪');

// 3. 验证核心组件
const files = [
  'utils/performance-config-manager.js',
  'utils/performance-monitor.js',
  'src/main/p2p/connection-pool.js',
  'src/renderer/components/graph/GraphCanvasOptimized.vue',
  'test-scripts/performance-benchmark.js',
];

let allFilesExist = true;
files.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (fs.existsSync(filePath)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file}`);
    allFilesExist = false;
  }
});

if (!allFilesExist) {
  console.log('\n❌ 部分文件缺失，请检查');
  process.exit(1);
}

console.log('\n✨ 性能优化配置验证完成！');
console.log('\n下一步:');
console.log('  1. 重启应用: npm run dev');
console.log('  2. 运行测试: npm run perf:benchmark');
console.log('  3. 查看文档: docs/PERFORMANCE_QUICKSTART.md');
console.log('');
