/**
 * P1优化回滚脚本
 * 在部署出现问题时快速回滚到P0版本
 *
 * 运行: node rollback-p1.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      P1优化回滚脚本                                      ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function rollback() {
  try {
    console.log('⚠️  警告: 此操作将回滚到P0版本（AIEngineManagerOptimized）\n');

    const answer = await question('是否继续? (yes/no): ');

    if (answer.toLowerCase() !== 'yes') {
      console.log('\n❌ 回滚已取消\n');
      rl.close();
      return;
    }

    console.log('\n开始回滚...\n');

    // ========================================
    // 1. 备份当前状态
    // ========================================
    console.log('[1/4] 备份当前P1配置...');

    const indexPath = path.join(__dirname, 'src/main/index.js');
    const indexBackup = path.join(__dirname, 'src/main/index.js.p1-backup');

    fs.copyFileSync(indexPath, indexBackup);
    console.log('  ✅ 已备份: index.js -> index.js.p1-backup\n');

    // ========================================
    // 2. 修改主入口文件
    // ========================================
    console.log('[2/4] 回滚主入口文件到P0版本...');

    let indexContent = fs.readFileSync(indexPath, 'utf-8');

    // 替换P1引擎为P0引擎
    const oldImport = `// AI Engine modules (P1优化版 v0.17.0)
// P1: 多意图识别、动态Few-shot学习、分层规划、检查点校验、自我修正
const { AIEngineManagerP1, getAIEngineManagerP1 } = require('./ai-engine/ai-engine-manager-p1');
const AIEngineIPC = require('./ai-engine/ai-engine-ipc');

// 创建快捷别名以保持API兼容性
const AIEngineManager = AIEngineManagerP1;
const getAIEngineManager = getAIEngineManagerP1;`;

    const newImport = `// AI Engine modules (优化版 v0.16.1)
const { AIEngineManagerOptimized, getAIEngineManagerOptimized } = require('./ai-engine/ai-engine-manager-optimized');
const AIEngineIPC = require('./ai-engine/ai-engine-ipc');

// 创建快捷别名以保持API兼容性
const AIEngineManager = AIEngineManagerOptimized;
const getAIEngineManager = getAIEngineManagerOptimized;`;

    if (indexContent.includes('AIEngineManagerP1')) {
      indexContent = indexContent.replace(oldImport, newImport);
      fs.writeFileSync(indexPath, indexContent, 'utf-8');
      console.log('  ✅ 已回滚: src/main/index.js\n');
    } else {
      console.log('  ℹ️  index.js 已经是P0版本，无需修改\n');
    }

    // ========================================
    // 3. 更新环境配置
    // ========================================
    console.log('[3/4] 更新环境配置...');

    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf-8');

      // 关闭P1模块
      envContent = envContent.replace(/ENABLE_MULTI_INTENT=true/g, 'ENABLE_MULTI_INTENT=false');
      envContent = envContent.replace(/ENABLE_DYNAMIC_FEW_SHOT=true/g, 'ENABLE_DYNAMIC_FEW_SHOT=false');
      envContent = envContent.replace(/ENABLE_HIERARCHICAL_PLANNING=true/g, 'ENABLE_HIERARCHICAL_PLANNING=false');
      envContent = envContent.replace(/ENABLE_CHECKPOINT_VALIDATION=true/g, 'ENABLE_CHECKPOINT_VALIDATION=false');
      envContent = envContent.replace(/ENABLE_SELF_CORRECTION=true/g, 'ENABLE_SELF_CORRECTION=false');

      fs.writeFileSync(envPath, envContent, 'utf-8');
      console.log('  ✅ 已更新: .env (P1模块已关闭)\n');
    } else {
      console.log('  ℹ️  .env 文件不存在，跳过\n');
    }

    // ========================================
    // 4. 完成
    // ========================================
    console.log('[4/4] 回滚完成！\n');

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ 回滚成功                                            ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    console.log('📋 回滚详情:');
    console.log('  ✅ AI引擎: P1 -> P0');
    console.log('  ✅ 配置文件: P1模块已关闭');
    console.log('  ✅ 备份文件: index.js.p1-backup\n');

    console.log('🔄 下一步:');
    console.log('  1. 重启应用');
    console.log('  2. 验证功能正常');
    console.log('  3. 如需恢复P1，运行: node restore-p1.js\n');

    console.log('💡 提示:');
    console.log('  - P1数据库表和数据仍然保留');
    console.log('  - 只是不再使用P1引擎');
    console.log('  - 可以随时重新启用P1\n');

    rl.close();

  } catch (error) {
    console.error('\n❌ 回滚失败:', error.message);
    console.error(error.stack);
    rl.close();
    process.exit(1);
  }
}

rollback();
