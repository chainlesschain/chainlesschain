/**
 * 知识蒸馏阈值调优脚本
 *
 * 功能:
 * 1. 分析历史知识蒸馏数据
 * 2. 评估当前阈值效果
 * 3. 推荐新的阈值
 * 4. 模拟不同阈值的效果
 *
 * 使用方法:
 *   node tune-distillation-threshold.js [命令] [选项]
 *
 * 命令:
 *   analyze         分析当前数据并给出建议
 *   simulate <threshold>  模拟指定阈值的效果
 *   recommend       基于数据推荐最佳阈值
 *
 * 示例:
 *   node tune-distillation-threshold.js analyze
 *   node tune-distillation-threshold.js simulate 0.4
 *   node tune-distillation-threshold.js recommend
 */

const path = require('path');

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function logSuccess(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function logError(msg) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function logWarning(msg) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function logInfo(key, value) {
  console.log(`  ${key}: ${colors.blue}${value}${colors.reset}`);
}

function logHeader(title) {
  console.log(`\n${colors.cyan}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.cyan}${title}${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}\n`);
}

// 知识蒸馏配置
const MODELS = {
  small: 'qwen2.5:1.5b',
  large: 'qwen2.5:7b'
};

const COST_PER_TOKEN = {
  'qwen2.5:1.5b': 0.001,  // 小模型成本（相对单位）
  'qwen2.5:7b': 0.01      // 大模型成本（相对单位）
};

// 当前默认阈值
const CURRENT_THRESHOLD = 0.35;

// 目标指标
const TARGETS = {
  smallModelRate: { min: 40, max: 60, ideal: 45 },  // 小模型使用率 (%)
  costSavings: { min: 50, ideal: 69.6 },            // 成本节省 (%)
  accuracyTolerance: 5                              // 可接受的准确度损失 (%)
};

/**
 * 分析知识蒸馏历史数据
 */
async function analyzeData(db, days = 7) {
  logHeader('📊 知识蒸馏数据分析');

  // 1. 基本统计
  const basicStats = db.prepare(`
    SELECT
      COUNT(*) as total_tasks,
      COUNT(DISTINCT task_id) as unique_tasks,
      AVG(complexity_score) as avg_complexity,
      MIN(created_at) as first_task,
      MAX(created_at) as last_task
    FROM knowledge_distillation_history
    WHERE created_at >= datetime('now', '-${days} days')
  `).get();

  if (!basicStats || basicStats.total_tasks === 0) {
    logWarning(`最近 ${days} 天没有知识蒸馏记录`);
    console.log('\n💡 建议:');
    console.log('   1. 等待系统积累更多使用数据（建议至少 100 次任务）');
    console.log('   2. 确保 enableKnowledgeDistillation 已启用');
    console.log('   3. 检查 AI Engine 是否正常运行\n');
    return null;
  }

  console.log('基本统计:');
  logInfo('总任务数', basicStats.total_tasks);
  logInfo('唯一任务数', basicStats.unique_tasks);
  logInfo('平均复杂度', basicStats.avg_complexity?.toFixed(3) || 'N/A');
  logInfo('数据时间范围', `${basicStats.first_task} 至 ${basicStats.last_task}`);

  // 2. 模型使用分布
  const modelDistribution = db.prepare(`
    SELECT
      actual_model,
      COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage,
      AVG(complexity_score) as avg_complexity
    FROM knowledge_distillation_history
    WHERE created_at >= datetime('now', '-${days} days')
    GROUP BY actual_model
    ORDER BY count DESC
  `).all();

  console.log('\n模型使用分布:');
  modelDistribution.forEach(stat => {
    const isSmall = stat.actual_model?.includes('1.5b');
    const color = isSmall ? colors.green : colors.yellow;
    console.log(`  ${color}${stat.actual_model || 'unknown'}${colors.reset}: ${stat.count} 次 (${stat.percentage}%) - 平均复杂度: ${stat.avg_complexity?.toFixed(3) || 'N/A'}`);
  });

  // 3. 复杂度级别分布
  const complexityDistribution = db.prepare(`
    SELECT
      complexity_level,
      COUNT(*) as count,
      AVG(complexity_score) as avg_score,
      actual_model,
      COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(PARTITION BY complexity_level) as model_share
    FROM knowledge_distillation_history
    WHERE created_at >= datetime('now', '-${days} days')
    GROUP BY complexity_level, actual_model
    ORDER BY complexity_level, count DESC
  `).all();

  console.log('\n复杂度级别分布:');
  const levels = [...new Set(complexityDistribution.map(d => d.complexity_level))];
  levels.forEach(level => {
    const levelData = complexityDistribution.filter(d => d.complexity_level === level);
    console.log(`\n  ${level}:`);
    levelData.forEach(stat => {
      console.log(`    ${stat.actual_model}: ${stat.count} 次 (${stat.model_share.toFixed(1)}%) - 平均分数: ${stat.avg_score.toFixed(3)}`);
    });
  });

  // 4. 阈值附近的任务分析
  const nearThreshold = db.prepare(`
    SELECT
      complexity_score,
      complexity_level,
      actual_model,
      COUNT(*) as count
    FROM knowledge_distillation_history
    WHERE created_at >= datetime('now', '-${days} days')
      AND complexity_score BETWEEN ? AND ?
    GROUP BY complexity_score, complexity_level, actual_model
    ORDER BY complexity_score
  `).all(CURRENT_THRESHOLD - 0.1, CURRENT_THRESHOLD + 0.1);

  if (nearThreshold.length > 0) {
    console.log(`\n阈值附近的任务 (${(CURRENT_THRESHOLD - 0.1).toFixed(2)} - ${(CURRENT_THRESHOLD + 0.1).toFixed(2)}):`);
    nearThreshold.forEach(task => {
      const color = task.complexity_score < CURRENT_THRESHOLD ? colors.green : colors.yellow;
      console.log(`  ${color}${task.complexity_score.toFixed(3)}${colors.reset}: ${task.actual_model} (${task.count} 次) - ${task.complexity_level}`);
    });
  }

  // 5. 计算当前效果指标
  const smallModelStats = modelDistribution.find(s => s.actual_model?.includes('1.5b'));
  const smallModelRate = smallModelStats ? smallModelStats.percentage : 0;

  // 估算成本节省
  const costSavings = calculateCostSavings(modelDistribution);

  console.log('\n当前阈值效果 (阈值 = ' + CURRENT_THRESHOLD + '):');
  logInfo('小模型使用率', `${smallModelRate.toFixed(1)}%`);
  logInfo('成本节省估算', `${costSavings.toFixed(1)}%`);

  // 评估
  console.log('\n评估:');
  if (smallModelRate >= TARGETS.smallModelRate.min && smallModelRate <= TARGETS.smallModelRate.max) {
    logSuccess(`小模型使用率在目标范围内 (${TARGETS.smallModelRate.min}-${TARGETS.smallModelRate.max}%)`);
  } else if (smallModelRate < TARGETS.smallModelRate.min) {
    logWarning(`小模型使用率偏低 (${smallModelRate.toFixed(1)}% < ${TARGETS.smallModelRate.min}%)`);
    console.log(`    💡 建议: 提高阈值以增加小模型使用`);
  } else {
    logWarning(`小模型使用率偏高 (${smallModelRate.toFixed(1)}% > ${TARGETS.smallModelRate.max}%)`);
    console.log(`    💡 建议: 降低阈值以减少小模型使用`);
  }

  if (costSavings >= TARGETS.costSavings.min) {
    logSuccess(`成本节省达标 (${costSavings.toFixed(1)}% >= ${TARGETS.costSavings.min}%)`);
  } else {
    logWarning(`成本节省不足 (${costSavings.toFixed(1)}% < ${TARGETS.costSavings.min}%)`);
  }

  return {
    basicStats,
    modelDistribution,
    complexityDistribution,
    smallModelRate,
    costSavings,
    nearThreshold
  };
}

/**
 * 计算成本节省
 */
function calculateCostSavings(modelDistribution) {
  let totalCost = 0;
  let totalTasks = 0;

  modelDistribution.forEach(stat => {
    const costPerTask = COST_PER_TOKEN[stat.actual_model] || COST_PER_TOKEN[MODELS.large];
    totalCost += stat.count * costPerTask;
    totalTasks += stat.count;
  });

  // 如果全部使用大模型的成本
  const baselineCost = totalTasks * COST_PER_TOKEN[MODELS.large];

  // 节省百分比
  return ((baselineCost - totalCost) / baselineCost) * 100;
}

/**
 * 模拟不同阈值的效果
 */
function simulateThreshold(db, threshold, days = 7) {
  logHeader(`🔬 模拟阈值: ${threshold}`);

  const allTasks = db.prepare(`
    SELECT
      complexity_score,
      complexity_level,
      actual_model
    FROM knowledge_distillation_history
    WHERE created_at >= datetime('now', '-${days} days')
  `).all();

  if (allTasks.length === 0) {
    logWarning('没有数据可供模拟');
    return null;
  }

  // 模拟新的模型分配
  let smallModelCount = 0;
  let largeModelCount = 0;
  let totalCost = 0;

  allTasks.forEach(task => {
    let selectedModel;
    if (task.complexity_score < threshold) {
      selectedModel = MODELS.small;
      smallModelCount++;
    } else {
      selectedModel = MODELS.large;
      largeModelCount++;
    }
    totalCost += COST_PER_TOKEN[selectedModel];
  });

  const smallModelRate = (smallModelCount / allTasks.length) * 100;
  const baselineCost = allTasks.length * COST_PER_TOKEN[MODELS.large];
  const costSavings = ((baselineCost - totalCost) / baselineCost) * 100;

  console.log('模拟结果:');
  logInfo('总任务数', allTasks.length);
  logInfo('小模型使用', `${smallModelCount} 次 (${smallModelRate.toFixed(1)}%)`);
  logInfo('大模型使用', `${largeModelCount} 次 (${(100 - smallModelRate).toFixed(1)}%)`);
  logInfo('成本节省', `${costSavings.toFixed(1)}%`);

  console.log('\n与目标对比:');
  const smallModelInRange = smallModelRate >= TARGETS.smallModelRate.min && smallModelRate <= TARGETS.smallModelRate.max;
  const costSavingsGood = costSavings >= TARGETS.costSavings.min;

  if (smallModelInRange) {
    logSuccess(`小模型使用率在目标范围 (${TARGETS.smallModelRate.min}-${TARGETS.smallModelRate.max}%)`);
  } else {
    logWarning(`小模型使用率不在目标范围`);
  }

  if (costSavingsGood) {
    logSuccess(`成本节省达标 (>= ${TARGETS.costSavings.min}%)`);
  } else {
    logWarning(`成本节省未达标 (< ${TARGETS.costSavings.min}%)`);
  }

  const score = (smallModelInRange ? 50 : 0) + (costSavingsGood ? 50 : 0);
  console.log(`\n综合评分: ${score}/100`);

  return {
    threshold,
    smallModelRate,
    costSavings,
    score,
    smallModelCount,
    largeModelCount
  };
}

/**
 * 推荐最佳阈值
 */
function recommendThreshold(db, days = 7) {
  logHeader('🎯 推荐最佳阈值');

  const allTasks = db.prepare(`
    SELECT complexity_score
    FROM knowledge_distillation_history
    WHERE created_at >= datetime('now', '-${days} days')
    ORDER BY complexity_score
  `).all();

  if (allTasks.length < 50) {
    logWarning(`数据量不足 (${allTasks.length} < 50)，建议等待更多数据后再进行调优`);
    return null;
  }

  console.log(`基于 ${allTasks.length} 个任务进行分析...\n`);

  // 尝试不同的阈值
  const testThresholds = [0.25, 0.30, 0.35, 0.40, 0.45, 0.50];
  const results = [];

  console.log('测试不同阈值:\n');
  testThresholds.forEach(threshold => {
    const result = simulateThreshold(db, threshold, days);
    if (result) {
      results.push(result);
    }
  });

  // 找到最佳阈值
  results.sort((a, b) => b.score - a.score);
  const best = results[0];

  logHeader('🏆 推荐结果');

  console.log('最佳阈值: ' + colors.green + best.threshold + colors.reset);
  logInfo('小模型使用率', `${best.smallModelRate.toFixed(1)}%`);
  logInfo('成本节省', `${best.costSavings.toFixed(1)}%`);
  logInfo('综合评分', `${best.score}/100`);

  console.log('\n所有测试结果排名:');
  results.forEach((r, i) => {
    const color = i === 0 ? colors.green : i === 1 ? colors.blue : colors.reset;
    console.log(`  ${color}${i + 1}. 阈值 ${r.threshold}: 评分 ${r.score}/100 (小模型 ${r.smallModelRate.toFixed(1)}%, 节省 ${r.costSavings.toFixed(1)}%)${colors.reset}`);
  });

  console.log('\n📋 实施步骤:');
  console.log('   1. 在 ai-engine-config.js 中修改 distillationConfig.complexityThreshold');
  console.log(`   2. 将阈值从 ${CURRENT_THRESHOLD} 更改为 ${best.threshold}`);
  console.log('   3. 重新构建: npm run build:main');
  console.log('   4. 重启应用并观察效果');
  console.log('   5. 一周后重新运行此脚本评估效果\n');

  return best;
}

/**
 * 主函数
 */
async function main() {
  const command = process.argv[2] || 'analyze';
  const days = 7;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     知识蒸馏阈值调优工具                                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n📅 分析范围: 最近 ${days} 天`);
  console.log(`🎯 当前阈值: ${CURRENT_THRESHOLD}`);
  console.log(`🎯 目标小模型使用率: ${TARGETS.smallModelRate.ideal}%`);
  console.log(`🎯 目标成本节省: ${TARGETS.costSavings.ideal}%\n`);

  try {
    // 连接数据库
    const DatabaseManager = require('./src/main/database');
    const dbPath = path.join(__dirname, 'data/chainlesschain.db');
    const dbManager = new DatabaseManager(dbPath, { encryptionEnabled: false });
    await dbManager.initialize();
    const db = dbManager.db;

    switch (command) {
      case 'analyze':
        await analyzeData(db, days);
        break;

      case 'simulate':
        const threshold = parseFloat(process.argv[3]);
        if (isNaN(threshold) || threshold < 0 || threshold > 1) {
          logError('无效的阈值，必须是 0-1 之间的数字');
          console.log('用法: node tune-distillation-threshold.js simulate <threshold>');
          console.log('示例: node tune-distillation-threshold.js simulate 0.4');
          process.exit(1);
        }
        simulateThreshold(db, threshold, days);
        break;

      case 'recommend':
        recommendThreshold(db, days);
        break;

      default:
        logError(`未知命令: ${command}`);
        console.log('\n可用命令:');
        console.log('  analyze         分析当前数据');
        console.log('  simulate <n>    模拟指定阈值');
        console.log('  recommend       推荐最佳阈值');
        process.exit(1);
    }

    dbManager.close();
    console.log('');
    process.exit(0);

  } catch (error) {
    logError(`执行失败: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
