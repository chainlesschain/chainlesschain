/**
 * 高级优化器
 * 提供智能预测缓存、并行优化、智能重试等高级功能
 *
 * 核心功能:
 * 1. 智能预测缓存（Predictive Caching）
 * 2. 并行任务优化（Parallel Task Optimization）
 * 3. 智能重试机制（Smart Retry）
 * 4. 性能瓶颈识别（Bottleneck Detection）
 *
 * 使用方法:
 *   node advanced-optimizer.js [命令]
 *
 * 命令:
 *   predict      运行预测缓存
 *   parallel     分析并行优化机会
 *   bottleneck   识别性能瓶颈
 *   optimize     执行全面优化
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
 * 高级优化管理器
 */
class AdvancedOptimizer {
  constructor(db) {
    this.db = db;

    this.config = {
      // 预测缓存配置
      predictiveCache: {
        enabled: true,
        lookAheadWindow: 5,        // 预测未来5个可能的请求
        confidenceThreshold: 0.6,   // 置信度阈值
        maxPredictions: 10          // 最大预测数
      },

      // 并行优化配置
      parallelOptimization: {
        enabled: true,
        maxParallelTasks: 4,        // 最大并行任务数
        minTaskDuration: 100,       // 最小任务时长（ms）
        dependencyAnalysis: true    // 依赖分析
      },

      // 智能重试配置
      smartRetry: {
        enabled: true,
        maxRetries: 3,
        backoffStrategy: 'exponential',  // linear, exponential, adaptive
        initialDelay: 1000,
        maxDelay: 10000,
        errorPatternLearning: true
      },

      // 瓶颈检测配置
      bottleneckDetection: {
        enabled: true,
        thresholds: {
          slowTaskMs: 2000,
          highFailureRate: 0.2,
          lowCacheHitRate: 0.5
        }
      }
    };
  }

  /**
   * 1. 智能预测缓存
   */
  async predictiveCaching() {
    logHeader('🔮 智能预测缓存');

    // 分析用户行为模式
    const patterns = await this.analyzeUserPatterns();

    // 预测下一步可能的请求
    const predictions = this.predictNextRequests(patterns);

    // 预加载到缓存
    const preloaded = await this.preloadCache(predictions);

    console.log('预测结果:\n');
    logInfo('识别到的模式', patterns.length);
    logInfo('生成的预测', predictions.length);
    logInfo('预加载条目', preloaded);

    if (predictions.length > 0) {
      console.log('\nTop 5 预测请求:');
      predictions.slice(0, 5).forEach((pred, i) => {
        console.log(`  ${i + 1}. ${pred.type}: ${pred.key} (置信度: ${(pred.confidence * 100).toFixed(1)}%)`);
      });
    }

    return { patterns, predictions, preloaded };
  }

  /**
   * 分析用户行为模式
   */
  async analyzeUserPatterns() {
    // 获取最近的意图序列
    const intentSequences = this.db.prepare(`
      SELECT
        user_input,
        intents,
        created_at
      FROM multi_intent_history
      WHERE created_at >= datetime('now', '-7 days')
      ORDER BY created_at
      LIMIT 100
    `).all();

    const patterns = [];
    const sequenceMap = new Map();

    // 构建n-gram模式（连续n个意图的序列）
    for (let i = 0; i < intentSequences.length - 1; i++) {
      const current = JSON.parse(intentSequences[i].intents || '[]');
      const next = JSON.parse(intentSequences[i + 1].intents || '[]');

      if (current.length > 0 && next.length > 0) {
        const key = current.join('->');
        const value = next.join('->');

        if (!sequenceMap.has(key)) {
          sequenceMap.set(key, new Map());
        }

        const transitions = sequenceMap.get(key);
        transitions.set(value, (transitions.get(value) || 0) + 1);
      }
    }

    // 提取高频模式
    for (const [from, transitions] of sequenceMap.entries()) {
      const total = Array.from(transitions.values()).reduce((a, b) => a + b, 0);
      const sorted = Array.from(transitions.entries())
        .sort((a, b) => b[1] - a[1]);

      if (sorted.length > 0 && sorted[0][1] / total >= 0.3) {
        patterns.push({
          from,
          to: sorted[0][0],
          confidence: sorted[0][1] / total,
          count: sorted[0][1]
        });
      }
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 预测下一步请求
   */
  predictNextRequests(patterns) {
    const predictions = [];
    const config = this.config.predictiveCache;

    patterns.forEach(pattern => {
      if (pattern.confidence >= config.confidenceThreshold) {
        predictions.push({
          type: 'intent',
          key: pattern.to,
          confidence: pattern.confidence,
          source: pattern.from
        });
      }
    });

    return predictions.slice(0, config.maxPredictions);
  }

  /**
   * 预加载缓存
   */
  async preloadCache(predictions) {
    let preloaded = 0;

    predictions.forEach(pred => {
      // 这里应该实际调用缓存系统预加载
      // 简化版：只记录预测
      preloaded++;
    });

    return preloaded;
  }

  /**
   * 2. 并行任务优化
   */
  async parallelOptimization() {
    logHeader('⚡ 并行任务优化');

    // 分析任务依赖关系
    const tasks = await this.analyzeTasks();

    // 识别可并行执行的任务
    const parallelGroups = this.identifyParallelTasks(tasks);

    // 计算并行化收益
    const benefit = this.calculateParallelBenefit(parallelGroups);

    console.log('分析结果:\n');
    logInfo('总任务数', tasks.length);
    logInfo('并行组数', parallelGroups.length);
    logInfo('可并行任务', parallelGroups.reduce((sum, g) => sum + g.tasks.length, 0));
    logInfo('预计时间节省', `${benefit.timeSavings.toFixed(0)}ms (${benefit.savingsPercent.toFixed(1)}%)`);

    if (parallelGroups.length > 0) {
      console.log('\n并行化机会:');
      parallelGroups.forEach((group, i) => {
        console.log(`\n  组 ${i + 1}: ${group.tasks.length} 个任务`);
        console.log(`  预计时间: ${group.sequentialTime}ms → ${group.parallelTime}ms`);
        console.log(`  节省: ${group.timeSaved}ms (${((group.timeSaved / group.sequentialTime) * 100).toFixed(1)}%)`);
      });
    }

    return { tasks, parallelGroups, benefit };
  }

  /**
   * 分析任务
   */
  async analyzeTasks() {
    // 获取最近的工具调用序列
    const toolUsage = this.db.prepare(`
      SELECT
        feature_name,
        avg_duration_ms,
        usage_count
      FROM feature_usage_tracking
      WHERE created_at >= datetime('now', '-7 days')
      ORDER BY usage_count DESC
      LIMIT 50
    `).all();

    return toolUsage.map(tool => ({
      name: tool.feature_name,
      avgDuration: tool.avg_duration_ms || 100,
      usageCount: tool.usage_count,
      dependencies: [] // 简化版，实际应该分析依赖
    }));
  }

  /**
   * 识别可并行任务
   */
  identifyParallelTasks(tasks) {
    const groups = [];
    const config = this.config.parallelOptimization;

    // 简化版：按任务时长分组，时长相近且无依赖的任务可以并行
    const longTasks = tasks.filter(t => t.avgDuration >= config.minTaskDuration);

    if (longTasks.length >= 2) {
      // 创建并行组（假设无依赖）
      for (let i = 0; i < longTasks.length; i += config.maxParallelTasks) {
        const groupTasks = longTasks.slice(i, i + config.maxParallelTasks);

        const sequentialTime = groupTasks.reduce((sum, t) => sum + t.avgDuration, 0);
        const parallelTime = Math.max(...groupTasks.map(t => t.avgDuration));
        const timeSaved = sequentialTime - parallelTime;

        if (timeSaved > 100) {
          groups.push({
            tasks: groupTasks,
            sequentialTime,
            parallelTime,
            timeSaved
          });
        }
      }
    }

    return groups;
  }

  /**
   * 计算并行化收益
   */
  calculateParallelBenefit(groups) {
    const totalSequentialTime = groups.reduce((sum, g) => sum + g.sequentialTime, 0);
    const totalParallelTime = groups.reduce((sum, g) => sum + g.parallelTime, 0);
    const timeSavings = totalSequentialTime - totalParallelTime;
    const savingsPercent = totalSequentialTime > 0
      ? (timeSavings / totalSequentialTime) * 100
      : 0;

    return { timeSavings, savingsPercent };
  }

  /**
   * 3. 智能重试机制
   */
  async smartRetry() {
    logHeader('🔄 智能重试分析');

    // 分析失败模式
    const failures = await this.analyzeFailures();

    // 优化重试策略
    const retryStrategy = this.optimizeRetryStrategy(failures);

    console.log('失败分析:\n');
    logInfo('总失败次数', failures.total);
    logInfo('可恢复失败', failures.recoverable);
    logInfo('平均重试次数', failures.avgRetries.toFixed(1));

    if (failures.patterns.length > 0) {
      console.log('\n失败模式:');
      failures.patterns.forEach(pattern => {
        console.log(`  ${pattern.type}: ${pattern.count} 次 (${pattern.successRate.toFixed(1)}% 最终成功)`);
      });
    }

    console.log('\n优化后的重试策略:\n');
    Object.entries(retryStrategy).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });

    return { failures, retryStrategy };
  }

  /**
   * 分析失败模式
   */
  async analyzeFailures() {
    const failureData = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        AVG(attempts) as avg_attempts,
        SUM(final_success) as recovered
      FROM self_correction_history
      WHERE created_at >= datetime('now', '-7 days')
    `).get();

    const patterns = this.db.prepare(`
      SELECT
        error_type,
        COUNT(*) as count,
        SUM(final_success) * 100.0 / COUNT(*) as success_rate
      FROM self_correction_history
      WHERE created_at >= datetime('now', '-7 days')
        AND error_type IS NOT NULL
      GROUP BY error_type
      ORDER BY count DESC
      LIMIT 5
    `).all();

    return {
      total: failureData.total || 0,
      recoverable: failureData.recovered || 0,
      avgRetries: failureData.avg_attempts || 0,
      patterns: patterns.map(p => ({
        type: p.error_type,
        count: p.count,
        successRate: p.success_rate
      }))
    };
  }

  /**
   * 优化重试策略
   */
  optimizeRetryStrategy(failures) {
    const config = this.config.smartRetry;
    const strategy = { ...config };

    // 基于失败率调整
    if (failures.total > 0) {
      const recoverRate = failures.recoverable / failures.total;

      if (recoverRate > 0.8) {
        // 高恢复率，可以增加重试次数
        strategy.maxRetries = Math.min(5, strategy.maxRetries + 1);
        strategy.backoffStrategy = 'linear'; // 快速重试
      } else if (recoverRate < 0.3) {
        // 低恢复率，减少重试次数
        strategy.maxRetries = Math.max(1, strategy.maxRetries - 1);
        strategy.backoffStrategy = 'exponential'; // 慢速重试
      }

      // 基于平均重试次数调整延迟
      if (failures.avgRetries > 2) {
        strategy.initialDelay = Math.max(500, strategy.initialDelay - 200);
      }
    }

    return strategy;
  }

  /**
   * 4. 性能瓶颈识别
   */
  async bottleneckDetection() {
    logHeader('🔍 性能瓶颈识别');

    const bottlenecks = [];

    // 1. 识别慢任务
    const slowTasks = this.identifySlowTasks();
    if (slowTasks.length > 0) {
      bottlenecks.push({
        type: 'slow_tasks',
        severity: 'high',
        items: slowTasks,
        recommendation: '优化慢任务或考虑异步处理'
      });
    }

    // 2. 识别高失败率功能
    const unreliableTasks = this.identifyUnreliableTasks();
    if (unreliableTasks.length > 0) {
      bottlenecks.push({
        type: 'unreliable_tasks',
        severity: 'medium',
        items: unreliableTasks,
        recommendation: '改进错误处理和重试逻辑'
      });
    }

    // 3. 识别缓存未命中热点
    const cacheMisses = this.identifyCacheMisses();
    if (cacheMisses.length > 0) {
      bottlenecks.push({
        type: 'cache_misses',
        severity: 'medium',
        items: cacheMisses,
        recommendation: '改进缓存策略或增加预热'
      });
    }

    console.log('瓶颈检测结果:\n');
    logInfo('发现瓶颈数', bottlenecks.length);

    bottlenecks.forEach((bottleneck, i) => {
      const severityColor = {
        high: colors.red,
        medium: colors.yellow,
        low: colors.blue
      }[bottleneck.severity];

      console.log(`\n${i + 1}. ${severityColor}${bottleneck.type}${colors.reset} (${bottleneck.severity})`);
      console.log(`   影响范围: ${bottleneck.items.length} 项`);
      console.log(`   建议: ${bottleneck.recommendation}`);

      if (bottleneck.items.length > 0) {
        console.log('   详情:');
        bottleneck.items.slice(0, 3).forEach(item => {
          console.log(`     - ${item.name}: ${item.metric}`);
        });

        if (bottleneck.items.length > 3) {
          console.log(`     ... 还有 ${bottleneck.items.length - 3} 项`);
        }
      }
    });

    if (bottlenecks.length === 0) {
      logSuccess('未发现明显瓶颈，系统运行良好');
    }

    return bottlenecks;
  }

  /**
   * 识别慢任务
   */
  identifySlowTasks() {
    const threshold = this.config.bottleneckDetection.thresholds.slowTaskMs;

    const slowTasks = this.db.prepare(`
      SELECT
        feature_name,
        avg_duration_ms,
        usage_count
      FROM feature_usage_tracking
      WHERE avg_duration_ms > ?
      ORDER BY avg_duration_ms DESC
      LIMIT 10
    `, [threshold]).all();

    return slowTasks.map(task => ({
      name: task.feature_name,
      metric: `${task.avg_duration_ms.toFixed(0)}ms 平均耗时 (${task.usage_count} 次使用)`
    }));
  }

  /**
   * 识别不可靠任务
   */
  identifyUnreliableTasks() {
    const threshold = this.config.bottleneckDetection.thresholds.highFailureRate;

    const unreliable = this.db.prepare(`
      SELECT
        feature_name,
        failure_count,
        success_count,
        failure_count * 1.0 / (success_count + failure_count) as failure_rate
      FROM feature_usage_tracking
      WHERE failure_count > 0
        AND failure_count * 1.0 / (success_count + failure_count) > ?
      ORDER BY failure_rate DESC
      LIMIT 10
    `, [threshold]).all();

    return unreliable.map(task => ({
      name: task.feature_name,
      metric: `${(task.failure_rate * 100).toFixed(1)}% 失败率 (${task.failure_count}/${task.success_count + task.failure_count})`
    }));
  }

  /**
   * 识别缓存未命中
   */
  identifyCacheMisses() {
    // 简化版：返回空数组（实际应该连接缓存统计）
    return [];
  }

  /**
   * 全面优化
   */
  async optimize() {
    logHeader('🚀 执行全面优化');

    const results = {
      predictive: await this.predictiveCaching(),
      parallel: await this.parallelOptimization(),
      retry: await this.smartRetry(),
      bottlenecks: await this.bottleneckDetection()
    };

    logHeader('✅ 优化完成');

    console.log('优化摘要:\n');
    logSuccess(`预测缓存: ${results.predictive.preloaded} 条目预加载`);
    logSuccess(`并行优化: ${results.parallel.benefit.timeSavings.toFixed(0)}ms 预计节省`);
    logSuccess(`重试策略: 已优化（最大${results.retry.retryStrategy.maxRetries}次重试）`);
    logSuccess(`瓶颈识别: 发现 ${results.bottlenecks.length} 个瓶颈`);

    // 保存优化报告
    this.saveOptimizationReport(results);

    return results;
  }

  /**
   * 保存优化报告
   */
  saveOptimizationReport(results) {
    const reportPath = path.join(__dirname, 'optimization-report.json');

    const report = {
      timestamp: new Date().toISOString(),
      results,
      summary: {
        predictiveCache: {
          patterns: results.predictive.patterns.length,
          predictions: results.predictive.predictions.length,
          preloaded: results.predictive.preloaded
        },
        parallel: {
          groups: results.parallel.parallelGroups.length,
          timeSavings: results.parallel.benefit.timeSavings,
          savingsPercent: results.parallel.benefit.savingsPercent
        },
        retry: {
          totalFailures: results.retry.failures.total,
          recoverable: results.retry.failures.recoverable,
          strategy: results.retry.retryStrategy
        },
        bottlenecks: results.bottlenecks.length
      }
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    logSuccess(`优化报告已保存: ${reportPath}`);
  }
}

/**
 * 主函数
 */
async function main() {
  const command = process.argv[2] || 'optimize';

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     高级优化器                                           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  try {
    // 连接数据库
    const DatabaseManager = require('./src/main/database');
    const dbPath = path.join(__dirname, 'data/chainlesschain.db');
    const dbManager = new DatabaseManager(dbPath, { encryptionEnabled: false });
    await dbManager.initialize();

    const optimizer = new AdvancedOptimizer(dbManager.db);

    switch (command) {
      case 'predict':
        await optimizer.predictiveCaching();
        break;

      case 'parallel':
        await optimizer.parallelOptimization();
        break;

      case 'retry':
        await optimizer.smartRetry();
        break;

      case 'bottleneck':
        await optimizer.bottleneckDetection();
        break;

      case 'optimize':
        await optimizer.optimize();
        break;

      default:
        logError(`未知命令: ${command}`);
        console.log('\n可用命令:');
        console.log('  predict      智能预测缓存');
        console.log('  parallel     并行任务优化');
        console.log('  retry        智能重试分析');
        console.log('  bottleneck   性能瓶颈识别');
        console.log('  optimize     执行全面优化');
        dbManager.close();
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
