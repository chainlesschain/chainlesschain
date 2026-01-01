/**
 * 知识蒸馏日常监控脚本
 * 用于快速检查知识蒸馏系统的运行状况
 *
 * Usage:
 *   node monitor-distillation.js [天数]
 *   默认: 最近7天
 */

const path = require('path');

async function monitor(days = 7) {
  const DatabaseManager = require('./src/main/database');
  const { getAIEngineConfig } = require('./src/main/ai-engine/ai-engine-config');
  
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  知识蒸馏监控 - 最近 ' + days + ' 天                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  const dbPath = path.join(__dirname, 'data/chainlesschain.db');
  const dbManager = new DatabaseManager(dbPath, { encryptionEnabled: false });
  await dbManager.initialize();
  const db = dbManager.db;
  
  // 获取基本统计
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN actual_model = 'small' THEN 1 ELSE 0 END) as small_count,
      SUM(CASE WHEN actual_model = 'large' THEN 1 ELSE 0 END) as large_count,
      AVG(complexity_score) as avg_complexity,
      MIN(created_at) as first_date,
      MAX(created_at) as last_date
    FROM knowledge_distillation_history
    WHERE created_at >= datetime('now', '-${days} days')
  `).get();
  
  if (!stats || stats.total === 0) {
    console.log('⚠ 最近 ' + days + ' 天没有知识蒸馏记录\n');
    console.log('建议:');
    console.log('  1. 检查系统是否正常运行');
    console.log('  2. 使用测试脚本生成数据: node test-kd.js 100');
    console.log('  3. 确保 enableKnowledgeDistillation=true\n');
    dbManager.close();
    return;
  }
  
  const smallPct = (stats.small_count / stats.total * 100).toFixed(1);
  const largePct = (stats.large_count / stats.total * 100).toFixed(1);
  const costSavings = ((stats.total * 0.01 - (stats.small_count * 0.001 + stats.large_count * 0.01)) / (stats.total * 0.01) * 100).toFixed(1);
  
  console.log('📊 数据概览:');
  console.log('  总任务数: ' + stats.total);
  console.log('  数据范围: ' + stats.first_date + ' 至 ' + stats.last_date);
  console.log('  平均复杂度: ' + stats.avg_complexity.toFixed(3));
  
  console.log('\n🤖 模型使用:');
  console.log('  小模型: ' + stats.small_count + ' (' + smallPct + '%)');
  console.log('  大模型: ' + stats.large_count + ' (' + largePct + '%)');
  
  console.log('\n💰 成本节省: ' + costSavings + '%');
  
  // 目标检查
  const config = getAIEngineConfig();
  const threshold = config.knowledgeDistillationConfig.routing.complexityThreshold;
  
  console.log('\n⚙️ 当前配置:');
  console.log('  阈值: ' + threshold);
  console.log('  小模型: ' + config.knowledgeDistillationConfig.studentModel.model);
  console.log('  大模型: ' + config.knowledgeDistillationConfig.teacherModel.model);
  
  console.log('\n✅ 健康检查:');
  
  const targetMin = 40, targetMax = 60;
  const smallRate = parseFloat(smallPct);
  
  if (smallRate >= targetMin && smallRate <= targetMax) {
    console.log('  ✓ 小模型使用率正常 (' + targetMin + '-' + targetMax + '%)');
  } else if (smallRate < targetMin) {
    console.log('  ⚠ 小模型使用率偏低 (' + smallPct + '% < ' + targetMin + '%)');
    console.log('    建议: 考虑提高阈值到 ' + (threshold + 0.05).toFixed(2));
  } else {
    console.log('  ⚠ 小模型使用率偏高 (' + smallPct + '% > ' + targetMax + '%)');
    console.log('    建议: 考虑降低阈值到 ' + (threshold - 0.05).toFixed(2));
  }
  
  if (parseFloat(costSavings) >= 50) {
    console.log('  ✓ 成本节省达标 (≥50%)');
  } else {
    console.log('  ⚠ 成本节省不足 (' + costSavings + '% < 50%)');
  }
  
  if (stats.total >= 100) {
    console.log('  ✓ 数据量充足 (≥100条)');
  } else {
    console.log('  ℹ 数据量较少 (' + stats.total + ' < 100条)，建议积累更多数据');
  }
  
  console.log('\n📋 下一步操作:');
  console.log('  • 详细分析: node tune-distillation-threshold.js analyze');
  console.log('  • 获取推荐: node tune-distillation-threshold.js recommend');
  console.log('  • 模拟阈值: node tune-distillation-threshold.js simulate 0.30');
  console.log('  • 生成测试数据: node test-kd.js 100\n');
  
  dbManager.close();
}

const days = parseInt(process.argv[2]) || 7;
monitor(days).catch(console.error);
