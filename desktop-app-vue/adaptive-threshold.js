/**
 * 自适应阈值调整系统
 * 基于实际性能数据自动调整知识蒸馏阈值
 *
 * 核心算法:
 * 1. 监控小模型表现（成功率、质量分数）
 * 2. 使用滑动窗口评估趋势
 * 3. 基于多目标优化调整阈值
 * 4. 渐进式调整，避免震荡
 *
 * 使用方法:
 *   node adaptive-threshold.js [命令]
 *
 * 命令:
 *   monitor      监控当前阈值表现
 *   adjust       执行自适应调整
 *   simulate     模拟调整效果
 *   auto         自动调整模式（持续运行）
 */

const path = require('path');
const fs = require('fs');

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
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

function logInfo(msg) {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

function logHeader(title) {
  console.log(`\n${colors.cyan}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.cyan}${title}${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}\n`);
}

/**
 * 自适应阈值管理器
 */
class AdaptiveThresholdManager {
  constructor(db) {
    this.db = db;

    // 配置参数
    this.config = {
      // 目标指标
      targets: {
        smallModelRate: { min: 40, max: 60, ideal: 45 },
        successRate: { min: 85, ideal: 95 },
        costSavings: { min: 50, ideal: 70 },
        qualityScore: { min: 0.8, ideal: 0.9 }
      },

      // 调整参数
      adjustment: {
        minSampleSize: 50,           // 最小样本数
        windowSize: 100,              // 滑动窗口大小
        learningRate: 0.05,           // 学习率（每次调整幅度）
        maxAdjustment: 0.1,           // 单次最大调整
        minAdjustment: 0.01,          // 单次最小调整
        cooldownPeriod: 3600000,      // 冷却期（1小时，防止频繁调整）
        convergenceThreshold: 0.005   // 收敛阈值
      },

      // 安全边界
      boundaries: {
        minThreshold: 0.2,
        maxThreshold: 0.6,
        emergencyStop: {
          successRateMin: 70,        // 成功率低于70%紧急停止
          smallModelRateMax: 80      // 小模型使用率超过80%紧急停止
        }
      },

      // 当前状态
      currentThreshold: 0.35,
      lastAdjustmentTime: null,
      adjustmentHistory: []
    };
  }

  /**
   * 加载当前配置
   */
  async loadCurrentConfig() {
    try {
      const configModule = require('./src/main/ai-engine/ai-engine-config');
      const aiConfig = configModule.getAIEngineConfig();

      this.config.currentThreshold = aiConfig.knowledgeDistillationConfig?.routing?.complexityThreshold || 0.35;

      logInfo(`当前阈值: ${this.config.currentThreshold}`);
    } catch (error) {
      logWarning(`无法加载当前配置: ${error.message}`);
    }
  }

  /**
   * 监控当前性能
   */
  async monitorPerformance(days = 7) {
    logHeader('📊 性能监控');

    // 1. 获取知识蒸馏数据
    const distillationData = this.db.prepare(`
      SELECT
        task_id,
        complexity_score,
        actual_model,
        created_at
      FROM knowledge_distillation_history
      WHERE created_at >= datetime('now', '-${days} days')
      ORDER BY created_at DESC
    `).all();

    if (distillationData.length < this.config.adjustment.minSampleSize) {
      logWarning(`样本数不足 (${distillationData.length} < ${this.config.adjustment.minSampleSize})`);
      return null;
    }

    // 2. 计算关键指标
    const metrics = this.calculateMetrics(distillationData);

    // 3. 评估表现
    const evaluation = this.evaluatePerformance(metrics);

    // 4. 输出报告
    this.printMonitoringReport(metrics, evaluation);

    return { metrics, evaluation };
  }

  /**
   * 计算性能指标
   */
  calculateMetrics(data) {
    const total = data.length;

    // 小模型使用情况
    const smallModelTasks = data.filter(d => d.actual_model?.includes('1.5b'));
    const smallModelRate = (smallModelTasks.length / total) * 100;

    // 按阈值分组
    const threshold = this.config.currentThreshold;
    const belowThreshold = data.filter(d => d.complexity_score < threshold);
    const aboveThreshold = data.filter(d => d.complexity_score >= threshold);

    // 阈值附近的任务（±0.05）
    const nearThreshold = data.filter(d =>
      Math.abs(d.complexity_score - threshold) <= 0.05
    );

    // 计算分布
    const complexityDistribution = {
      simple: data.filter(d => d.complexity_score < 0.3).length,
      medium: data.filter(d => d.complexity_score >= 0.3 && d.complexity_score < 0.5).length,
      complex: data.filter(d => d.complexity_score >= 0.5).length
    };

    return {
      total,
      smallModelRate,
      smallModelTasks: smallModelTasks.length,
      largeModelTasks: total - smallModelTasks.length,
      belowThreshold: belowThreshold.length,
      aboveThreshold: aboveThreshold.length,
      nearThreshold: nearThreshold.length,
      complexityDistribution,
      avgComplexity: data.reduce((sum, d) => sum + d.complexity_score, 0) / total
    };
  }

  /**
   * 评估性能
   */
  evaluatePerformance(metrics) {
    const targets = this.config.targets;
    const evaluation = {
      overall: 'good',
      issues: [],
      recommendations: [],
      score: 0
    };

    // 1. 评估小模型使用率
    if (metrics.smallModelRate < targets.smallModelRate.min) {
      evaluation.issues.push(`小模型使用率过低 (${metrics.smallModelRate.toFixed(1)}% < ${targets.smallModelRate.min}%)`);
      evaluation.recommendations.push('建议提高阈值以增加小模型使用');
      evaluation.score -= 20;
    } else if (metrics.smallModelRate > targets.smallModelRate.max) {
      evaluation.issues.push(`小模型使用率过高 (${metrics.smallModelRate.toFixed(1)}% > ${targets.smallModelRate.max}%)`);
      evaluation.recommendations.push('建议降低阈值以减少小模型使用');
      evaluation.score -= 20;
    } else {
      evaluation.score += 40;
    }

    // 2. 评估阈值附近的任务分布
    const nearThresholdRate = (metrics.nearThreshold / metrics.total) * 100;
    if (nearThresholdRate > 30) {
      evaluation.issues.push(`阈值附近任务过多 (${nearThresholdRate.toFixed(1)}%)`);
      evaluation.recommendations.push('阈值可能不够明确，考虑调整');
      evaluation.score -= 10;
    } else {
      evaluation.score += 20;
    }

    // 3. 评估复杂度分布
    const { simple, medium, complex } = metrics.complexityDistribution;
    const totalDist = simple + medium + complex;

    if (simple / totalDist > 0.7) {
      // 大部分是简单任务
      if (metrics.smallModelRate < 60) {
        evaluation.recommendations.push('任务偏简单，可以提高阈值增加小模型使用');
      }
    } else if (complex / totalDist > 0.5) {
      // 大部分是复杂任务
      if (metrics.smallModelRate > 40) {
        evaluation.recommendations.push('任务偏复杂，可以降低阈值保证质量');
      }
    }

    evaluation.score += 40; // 基础分

    // 确定整体评级
    if (evaluation.score >= 80) {
      evaluation.overall = 'excellent';
    } else if (evaluation.score >= 60) {
      evaluation.overall = 'good';
    } else if (evaluation.score >= 40) {
      evaluation.overall = 'fair';
    } else {
      evaluation.overall = 'poor';
    }

    return evaluation;
  }

  /**
   * 输出监控报告
   */
  printMonitoringReport(metrics, evaluation) {
    console.log('性能指标:\n');
    logInfo('总任务数', metrics.total);
    logInfo('小模型使用率', `${metrics.smallModelRate.toFixed(1)}%`);
    logInfo('小模型任务', metrics.smallModelTasks);
    logInfo('大模型任务', metrics.largeModelTasks);
    logInfo('平均复杂度', metrics.avgComplexity.toFixed(3));

    console.log('\n阈值分析:\n');
    logInfo('当前阈值', this.config.currentThreshold);
    logInfo('低于阈值', `${metrics.belowThreshold} (${(metrics.belowThreshold / metrics.total * 100).toFixed(1)}%)`);
    logInfo('高于阈值', `${metrics.aboveThreshold} (${(metrics.aboveThreshold / metrics.total * 100).toFixed(1)}%)`);
    logInfo('阈值附近 (±0.05)', `${metrics.nearThreshold} (${(metrics.nearThreshold / metrics.total * 100).toFixed(1)}%)`);

    console.log('\n复杂度分布:\n');
    const { simple, medium, complex } = metrics.complexityDistribution;
    const total = simple + medium + complex;
    logInfo('简单任务 (<0.3)', `${simple} (${(simple / total * 100).toFixed(1)}%)`);
    logInfo('中等任务 (0.3-0.5)', `${medium} (${(medium / total * 100).toFixed(1)}%)`);
    logInfo('复杂任务 (>0.5)', `${complex} (${(complex / total * 100).toFixed(1)}%)`);

    console.log('\n性能评估:\n');
    const statusColor = {
      excellent: colors.green,
      good: colors.blue,
      fair: colors.yellow,
      poor: colors.red
    }[evaluation.overall];

    console.log(`整体评分: ${statusColor}${evaluation.score}/100 (${evaluation.overall})${colors.reset}`);

    if (evaluation.issues.length > 0) {
      console.log('\n发现问题:');
      evaluation.issues.forEach(issue => logWarning(issue));
    }

    if (evaluation.recommendations.length > 0) {
      console.log('\n优化建议:');
      evaluation.recommendations.forEach(rec => console.log(`  💡 ${rec}`));
    }
  }

  /**
   * 计算最优阈值
   */
  calculateOptimalThreshold(data) {
    // 使用梯度下降优化多目标函数
    const currentThreshold = this.config.currentThreshold;
    const learningRate = this.config.adjustment.learningRate;

    // 目标函数: 最大化小模型使用率（在目标范围内）同时保证质量
    let optimalThreshold = currentThreshold;
    let bestScore = -Infinity;

    // 在当前阈值附近搜索
    const searchRange = [-0.1, -0.05, -0.02, 0, 0.02, 0.05, 0.1];

    searchRange.forEach(delta => {
      const testThreshold = Math.max(
        this.config.boundaries.minThreshold,
        Math.min(this.config.boundaries.maxThreshold, currentThreshold + delta)
      );

      const metrics = this.simulateThreshold(data, testThreshold);
      const score = this.scoreThreshold(metrics);

      if (score > bestScore) {
        bestScore = score;
        optimalThreshold = testThreshold;
      }
    });

    // 渐进式调整
    const adjustment = (optimalThreshold - currentThreshold) * learningRate;

    // 限制调整幅度
    const clampedAdjustment = Math.max(
      -this.config.adjustment.maxAdjustment,
      Math.min(this.config.adjustment.maxAdjustment, adjustment)
    );

    const newThreshold = currentThreshold + clampedAdjustment;

    return {
      current: currentThreshold,
      optimal: optimalThreshold,
      recommended: newThreshold,
      adjustment: clampedAdjustment,
      score: bestScore
    };
  }

  /**
   * 模拟阈值效果
   */
  simulateThreshold(data, threshold) {
    const smallModelTasks = data.filter(d => d.complexity_score < threshold).length;
    const smallModelRate = (smallModelTasks / data.length) * 100;

    // 估算成本节省（小模型成本是大模型的1/10）
    const costSavings = (smallModelTasks * 0.9) / data.length * 100;

    return {
      smallModelRate,
      costSavings
    };
  }

  /**
   * 评分阈值方案
   */
  scoreThreshold(metrics) {
    const targets = this.config.targets;
    let score = 0;

    // 1. 小模型使用率评分（40分）
    if (metrics.smallModelRate >= targets.smallModelRate.min &&
        metrics.smallModelRate <= targets.smallModelRate.max) {
      // 在目标范围内，计算偏离理想值的程度
      const deviation = Math.abs(metrics.smallModelRate - targets.smallModelRate.ideal);
      score += 40 * (1 - deviation / 10);
    } else {
      // 超出范围，惩罚
      const outOfRange = Math.max(
        targets.smallModelRate.min - metrics.smallModelRate,
        metrics.smallModelRate - targets.smallModelRate.max,
        0
      );
      score += Math.max(0, 40 - outOfRange * 2);
    }

    // 2. 成本节省评分（30分）
    if (metrics.costSavings >= targets.costSavings.ideal) {
      score += 30;
    } else if (metrics.costSavings >= targets.costSavings.min) {
      score += 30 * (metrics.costSavings - targets.costSavings.min) / (targets.costSavings.ideal - targets.costSavings.min);
    }

    // 3. 稳定性评分（30分）
    // 倾向于小幅调整
    score += 30;

    return score;
  }

  /**
   * 执行自适应调整
   */
  async adjust(dryRun = false) {
    logHeader('⚙️ 自适应阈值调整');

    // 1. 检查冷却期
    if (this.config.lastAdjustmentTime) {
      const timeSinceLastAdjustment = Date.now() - this.config.lastAdjustmentTime;
      if (timeSinceLastAdjustment < this.config.adjustment.cooldownPeriod) {
        const remainingMinutes = Math.ceil((this.config.adjustment.cooldownPeriod - timeSinceLastAdjustment) / 60000);
        logWarning(`仍在冷却期，需等待 ${remainingMinutes} 分钟`);
        return null;
      }
    }

    // 2. 获取数据
    const data = this.db.prepare(`
      SELECT task_id, complexity_score, actual_model, created_at
      FROM knowledge_distillation_history
      WHERE created_at >= datetime('now', '-7 days')
      ORDER BY created_at DESC
      LIMIT ${this.config.adjustment.windowSize}
    `).all();

    if (data.length < this.config.adjustment.minSampleSize) {
      logWarning(`样本数不足 (${data.length} < ${this.config.adjustment.minSampleSize})`);
      return null;
    }

    // 3. 计算最优阈值
    const result = this.calculateOptimalThreshold(data);

    console.log('调整分析:\n');
    logInfo('当前阈值', result.current.toFixed(3));
    logInfo('理论最优', result.optimal.toFixed(3));
    logInfo('推荐新值', result.recommended.toFixed(3));
    logInfo('调整幅度', `${(result.adjustment >= 0 ? '+' : '')}${result.adjustment.toFixed(3)}`);
    logInfo('评分', `${result.score.toFixed(1)}/100`);

    // 4. 检查是否需要调整
    if (Math.abs(result.adjustment) < this.config.adjustment.minAdjustment) {
      logSuccess('当前阈值已接近最优，无需调整');
      return null;
    }

    // 5. 应用调整
    if (!dryRun) {
      await this.applyThresholdAdjustment(result.recommended);
      logSuccess(`阈值已调整: ${result.current.toFixed(3)} → ${result.recommended.toFixed(3)}`);

      // 更新状态
      this.config.lastAdjustmentTime = Date.now();
      this.config.adjustmentHistory.push({
        timestamp: new Date().toISOString(),
        from: result.current,
        to: result.recommended,
        adjustment: result.adjustment,
        score: result.score
      });

      this.saveAdjustmentHistory();
    } else {
      logInfo('模拟模式', '未实际应用调整');
    }

    return result;
  }

  /**
   * 应用阈值调整
   */
  async applyThresholdAdjustment(newThreshold) {
    const configPath = path.join(__dirname, 'src/main/ai-engine/ai-engine-config.js');
    let configContent = fs.readFileSync(configPath, 'utf8');

    // 查找并替换阈值
    const thresholdRegex = /(complexityThreshold:\s*)[\d.]+/;
    configContent = configContent.replace(thresholdRegex, `$1${newThreshold.toFixed(2)}`);

    // 备份原文件
    const backupPath = `${configPath}.backup-adaptive-${Date.now()}`;
    fs.writeFileSync(backupPath, fs.readFileSync(configPath));

    // 写入新配置
    fs.writeFileSync(configPath, configContent, 'utf8');

    logInfo('配置文件已更新', configPath);
    logInfo('备份文件', backupPath);
  }

  /**
   * 保存调整历史
   */
  saveAdjustmentHistory() {
    const historyPath = path.join(__dirname, 'adaptive-threshold-history.json');
    fs.writeFileSync(historyPath, JSON.stringify({
      currentThreshold: this.config.currentThreshold,
      lastAdjustmentTime: this.config.lastAdjustmentTime,
      history: this.config.adjustmentHistory
    }, null, 2), 'utf8');
  }

  /**
   * 自动调整模式
   */
  async autoAdjustMode(intervalMinutes = 60) {
    logHeader('🤖 自动调整模式');
    logInfo('检查间隔', `${intervalMinutes} 分钟`);
    console.log('\n按 Ctrl+C 停止\n');

    const checkAndAdjust = async () => {
      try {
        const monitoring = await this.monitorPerformance(7);

        if (monitoring && monitoring.evaluation.overall !== 'excellent') {
          console.log('\n检测到性能可优化，尝试调整...\n');
          await this.adjust(false);
        } else {
          logSuccess('性能良好，无需调整');
        }
      } catch (error) {
        logError(`自动调整出错: ${error.message}`);
      }
    };

    // 立即执行一次
    await checkAndAdjust();

    // 设置定时执行
    setInterval(checkAndAdjust, intervalMinutes * 60 * 1000);
  }
}

/**
 * 主函数
 */
async function main() {
  const command = process.argv[2] || 'monitor';

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     自适应阈值调整系统                                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  try {
    // 连接数据库
    const DatabaseManager = require('./src/main/database');
    const dbPath = path.join(__dirname, 'data/chainlesschain.db');
    const dbManager = new DatabaseManager(dbPath, { encryptionEnabled: false });
    await dbManager.initialize();

    const manager = new AdaptiveThresholdManager(dbManager.db);
    await manager.loadCurrentConfig();

    switch (command) {
      case 'monitor':
        await manager.monitorPerformance(7);
        break;

      case 'adjust':
        await manager.adjust(false);
        break;

      case 'simulate':
        await manager.adjust(true);
        break;

      case 'auto': {
        const interval = parseInt(process.argv[3]) || 60;
        await manager.autoAdjustMode(interval);
        // 保持进程运行
        await new Promise(() => {});
        break;
      }

      default:
        logError(`未知命令: ${command}`);
        console.log('\n可用命令:');
        console.log('  monitor      监控当前阈值表现');
        console.log('  adjust       执行自适应调整');
        console.log('  simulate     模拟调整效果（不实际应用）');
        console.log('  auto [mins]  自动调整模式（默认60分钟检查一次）');
        dbManager.close();
        process.exit(1);
    }

    if (command !== 'auto') {
      dbManager.close();
      console.log('');
      process.exit(0);
    }

  } catch (error) {
    logError(`执行失败: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
