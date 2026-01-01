/**
 * 生产环境监控脚本
 * 用于定期检查P0/P1/P2优化功能的关键指标
 *
 * Usage: node monitor-production.js [days]
 * Example: node monitor-production.js 7  # 查询最近7天的数据
 */

const path = require('path');
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function logHeader(title) {
  console.log(`\n${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}${title}${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}\n`);
}

function logSuccess(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function logWarning(msg) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function logError(msg) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function logInfo(key, value) {
  console.log(`  ${key}: ${colors.blue}${value}${colors.reset}`);
}

async function main() {
  const days = parseInt(process.argv[2]) || 7;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     P0/P1/P2 优化系统生产环境监控                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n📅 监控时间范围: 最近 ${days} 天\n`);

  try {
    // 连接数据库
    const DatabaseManager = require('./src/main/database');
    const dbPath = path.join(__dirname, 'data/chainlesschain.db');
    const db = new DatabaseManager(dbPath, { encryptionEnabled: false });
    await db.initialize();

    // ========================================
    // 1. P2 意图融合监控
    // ========================================
    logHeader('📊 P2 意图融合 (Intent Fusion) 监控');

    const fusionStats = db.db.prepare(`
      SELECT
        COUNT(*) as total_fusions,
        AVG(CAST(reduction_rate AS REAL)) as avg_savings_rate,
        SUM(llm_calls_saved) as total_llm_saved,
        MAX(created_at) as last_fusion
      FROM intent_fusion_history
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    if (fusionStats && fusionStats.total_fusions > 0) {
      logInfo('融合次数', fusionStats.total_fusions);
      logInfo('平均节省率', `${fusionStats.avg_savings_rate?.toFixed(2) || 0}%`);
      logInfo('累计节省LLM调用', fusionStats.total_llm_saved || 0);
      logInfo('最后融合时间', fusionStats.last_fusion || 'N/A');

      // 判断健康状态
      if (fusionStats.avg_savings_rate >= 50) {
        logSuccess(`意图融合效果优秀 (节省率 ${fusionStats.avg_savings_rate.toFixed(1)}% > 50%)`);
      } else if (fusionStats.avg_savings_rate >= 40) {
        logWarning(`意图融合效果一般 (节省率 ${fusionStats.avg_savings_rate.toFixed(1)}%)`);
      } else {
        logError(`意图融合效果不佳 (节省率 ${fusionStats.avg_savings_rate.toFixed(1)}% < 40%)`);
      }
    } else {
      logWarning('最近没有意图融合记录');
    }

    // ========================================
    // 2. P2 知识蒸馏监控
    // ========================================
    logHeader('🧠 P2 知识蒸馏 (Knowledge Distillation) 监控');

    const distillationStats = db.db.prepare(`
      SELECT
        actual_model,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
      FROM knowledge_distillation_history
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY actual_model
      ORDER BY count DESC
    `).all();

    if (distillationStats && distillationStats.length > 0) {
      console.log('  模型使用分布:');
      distillationStats.forEach(stat => {
        const model = stat.actual_model || 'unknown';
        const isSmall = model.includes('1.5b');
        const color = isSmall ? colors.green : colors.yellow;
        console.log(`    ${color}${model}${colors.reset}: ${stat.count} 次 (${stat.percentage}%)`);
      });

      // 计算小模型使用率
      const smallModelStats = distillationStats.find(s => s.actual_model?.includes('1.5b'));
      if (smallModelStats) {
        const smallModelRate = smallModelStats.percentage;
        if (smallModelRate >= 40 && smallModelRate <= 60) {
          logSuccess(`小模型使用率合理 (${smallModelRate}%，目标40-50%)`);
        } else if (smallModelRate < 30) {
          logWarning(`小模型使用率偏低 (${smallModelRate}% < 30%)`);
        } else {
          logWarning(`小模型使用率偏高 (${smallModelRate}% > 60%)`);
        }
      }
    } else {
      logWarning('最近没有知识蒸馏记录');
    }

    // ========================================
    // 3. P2 流式响应监控
    // ========================================
    logHeader('⚡ P2 流式响应 (Streaming Response) 监控');

    const streamingStats = db.db.prepare(`
      SELECT
        COUNT(DISTINCT task_id) as total_tasks,
        COUNT(*) as total_events,
        MAX(timestamp) as last_event
      FROM streaming_response_events
      WHERE timestamp >= datetime('now', '-${days} days')
    `).get();

    if (streamingStats && streamingStats.total_tasks > 0) {
      logInfo('流式任务数', streamingStats.total_tasks);
      logInfo('总事件数', streamingStats.total_events);
      logInfo('平均事件数/任务', (streamingStats.total_events / streamingStats.total_tasks).toFixed(1));
      logInfo('最后事件时间', streamingStats.last_event || 'N/A');
      logSuccess('流式响应功能正常');
    } else {
      logWarning('最近没有流式响应记录');
    }

    // ========================================
    // 4. P1 自我修正监控
    // ========================================
    logHeader('🔧 P1 自我修正 (Self-Correction) 监控');

    const correctionStats = db.db.prepare(`
      SELECT
        COUNT(*) as total_corrections,
        AVG(attempts) as avg_attempts,
        SUM(final_success) as successful_corrections,
        SUM(final_success) * 100.0 / COUNT(*) as success_rate
      FROM self_correction_history
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    if (correctionStats && correctionStats.total_corrections > 0) {
      logInfo('修正次数', correctionStats.total_corrections);
      logInfo('平均尝试次数', correctionStats.avg_attempts?.toFixed(1) || 'N/A');
      logInfo('成功修正数', correctionStats.successful_corrections);
      logInfo('成功率', `${correctionStats.success_rate?.toFixed(1) || 0}%`);

      if (correctionStats.success_rate >= 70) {
        logSuccess(`自我修正效果优秀 (成功率 ${correctionStats.success_rate.toFixed(1)}% > 70%)`);
      } else if (correctionStats.success_rate >= 60) {
        logWarning(`自我修正效果一般 (成功率 ${correctionStats.success_rate.toFixed(1)}%)`);
      } else {
        logError(`自我修正效果不佳 (成功率 ${correctionStats.success_rate.toFixed(1)}% < 60%)`);
      }
    } else {
      logWarning('最近没有自我修正记录');
    }

    // ========================================
    // 5. P1 多意图识别监控
    // ========================================
    logHeader('🎯 P1 多意图识别 (Multi-Intent) 监控');

    const multiIntentStats = db.db.prepare(`
      SELECT
        COUNT(*) as total_recognitions,
        SUM(CASE WHEN is_multi_intent = 1 THEN 1 ELSE 0 END) as multi_intent_count,
        AVG(intent_count) as avg_intent_count
      FROM multi_intent_history
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    if (multiIntentStats && multiIntentStats.total_recognitions > 0) {
      const multiRate = (multiIntentStats.multi_intent_count / multiIntentStats.total_recognitions * 100).toFixed(1);
      logInfo('识别次数', multiIntentStats.total_recognitions);
      logInfo('多意图检出数', multiIntentStats.multi_intent_count);
      logInfo('多意图占比', `${multiRate}%`);
      logInfo('平均意图数', multiIntentStats.avg_intent_count?.toFixed(1) || 'N/A');
      logSuccess('多意图识别功能正常');
    } else {
      logWarning('最近没有多意图识别记录');
    }

    // ========================================
    // 6. P1 检查点校验监控
    // ========================================
    logHeader('✅ P1 检查点校验 (Checkpoint Validation) 监控');

    const checkpointStats = db.db.prepare(`
      SELECT
        COUNT(*) as total_validations,
        SUM(passed) as passed_count,
        SUM(passed) * 100.0 / COUNT(*) as pass_rate
      FROM checkpoint_validations
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    if (checkpointStats && checkpointStats.total_validations > 0) {
      logInfo('校验次数', checkpointStats.total_validations);
      logInfo('通过次数', checkpointStats.passed_count);
      logInfo('通过率', `${checkpointStats.pass_rate?.toFixed(1) || 0}%`);

      if (checkpointStats.pass_rate >= 80) {
        logSuccess(`检查点校验效果优秀 (通过率 ${checkpointStats.pass_rate.toFixed(1)}%)`);
      } else {
        logWarning(`检查点校验通过率偏低 (${checkpointStats.pass_rate.toFixed(1)}%)`);
      }
    } else {
      logWarning('最近没有检查点校验记录');
    }

    // ========================================
    // 7. 系统健康摘要
    // ========================================
    logHeader('🏥 系统健康摘要');

    let healthScore = 0;
    const checks = [];

    // 检查1: 意图融合效果
    if (fusionStats && fusionStats.avg_savings_rate >= 50) {
      healthScore += 20;
      checks.push({ name: '意图融合效果', status: 'pass' });
    } else {
      checks.push({ name: '意图融合效果', status: 'fail' });
    }

    // 检查2: 小模型使用率
    const smallModelStats2 = distillationStats?.find(s => s.actual_model?.includes('1.5b'));
    if (smallModelStats2 && smallModelStats2.percentage >= 40 && smallModelStats2.percentage <= 60) {
      healthScore += 20;
      checks.push({ name: '小模型使用率', status: 'pass' });
    } else {
      checks.push({ name: '小模型使用率', status: 'fail' });
    }

    // 检查3: 自我修正成功率
    if (correctionStats && correctionStats.success_rate >= 70) {
      healthScore += 20;
      checks.push({ name: '自我修正成功率', status: 'pass' });
    } else {
      checks.push({ name: '自我修正成功率', status: 'fail' });
    }

    // 检查4: 检查点校验通过率
    if (checkpointStats && checkpointStats.pass_rate >= 80) {
      healthScore += 20;
      checks.push({ name: '检查点校验通过率', status: 'pass' });
    } else {
      checks.push({ name: '检查点校验通过率', status: 'fail' });
    }

    // 检查5: 流式响应可用性
    if (streamingStats && streamingStats.total_tasks > 0) {
      healthScore += 20;
      checks.push({ name: '流式响应可用性', status: 'pass' });
    } else {
      checks.push({ name: '流式响应可用性', status: 'fail' });
    }

    // 输出健康检查结果
    checks.forEach(check => {
      if (check.status === 'pass') {
        logSuccess(check.name);
      } else {
        logError(check.name);
      }
    });

    console.log(`\n健康评分: ${healthScore}/100`);
    if (healthScore >= 80) {
      logSuccess('系统整体健康状态：优秀 ✨');
    } else if (healthScore >= 60) {
      logWarning('系统整体健康状态：良好 ⚠️');
    } else {
      logError('系统整体健康状态：需要关注 ⚠️⚠️⚠️');
    }

    console.log('');

    db.close();
    process.exit(0);

  } catch (error) {
    logError(`监控执行出错: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
