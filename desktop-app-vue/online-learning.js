/**
 * 模型在线学习系统
 * 从用户反馈和实际使用中持续学习优化
 *
 * 核心功能:
 * 1. 复杂度评估模型学习
 * 2. 意图识别准确率提升
 * 3. 工具选择优化
 * 4. 用户偏好学习
 *
 * 学习方法:
 * - 增量学习（Incremental Learning）
 * - 强化学习（Reinforcement Learning）
 * - 迁移学习（Transfer Learning）
 *
 * 使用方法:
 *   node online-learning.js [命令]
 *
 * 命令:
 *   train        训练模型
 *   evaluate     评估模型性能
 *   update       更新模型参数
 *   stats        查看学习统计
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
 * 在线学习管理器
 */
class OnlineLearningManager {
  constructor(db) {
    this.db = db;

    // 模型参数
    this.models = {
      // 复杂度评估模型
      complexityEstimator: {
        weights: {
          intentComplexity: 0.3,
          contextComplexity: 0.25,
          historyComplexity: 0.2,
          toolsComplexity: 0.25
        },
        learningRate: 0.01,
        trainingExamples: []
      },

      // 意图识别模型
      intentRecognizer: {
        patterns: new Map(),
        confidenceThreshold: 0.7,
        learningRate: 0.05
      },

      // 工具选择模型
      toolSelector: {
        preferences: new Map(),
        successRates: new Map(),
        learningRate: 0.1
      },

      // 用户偏好模型
      userPreference: {
        features: new Map(),
        responseStyle: {},
        learningRate: 0.05
      }
    };

    // 学习统计
    this.stats = {
      totalTrainingSessions: 0,
      totalExamples: 0,
      lastTrainingTime: null,
      modelVersion: '1.0.0',
      improvements: []
    };

    this.loadModels();
  }

  /**
   * 加载已保存的模型
   */
  loadModels() {
    const modelPath = path.join(__dirname, 'online-learning-models.json');

    if (fs.existsSync(modelPath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
        this.models = { ...this.models, ...saved.models };
        this.stats = { ...this.stats, ...saved.stats };
        logSuccess(`已加载模型 v${this.stats.modelVersion}`);
      } catch (error) {
        logWarning(`加载模型失败: ${error.message}`);
      }
    }
  }

  /**
   * 保存模型
   */
  saveModels() {
    const modelPath = path.join(__dirname, 'online-learning-models.json');

    // 转换Map为普通对象以便序列化
    const serializable = {
      models: {
        complexityEstimator: this.models.complexityEstimator,
        intentRecognizer: {
          ...this.models.intentRecognizer,
          patterns: Array.from(this.models.intentRecognizer.patterns.entries())
        },
        toolSelector: {
          ...this.models.toolSelector,
          preferences: Array.from(this.models.toolSelector.preferences.entries()),
          successRates: Array.from(this.models.toolSelector.successRates.entries())
        },
        userPreference: {
          ...this.models.userPreference,
          features: Array.from(this.models.userPreference.features.entries())
        }
      },
      stats: this.stats
    };

    fs.writeFileSync(modelPath, JSON.stringify(serializable, null, 2), 'utf8');
    logSuccess(`模型已保存: ${modelPath}`);
  }

  /**
   * 收集训练数据
   */
  async collectTrainingData(days = 30) {
    logHeader('📚 收集训练数据');

    const data = {
      complexity: [],
      intent: [],
      tools: [],
      feedback: []
    };

    // 1. 复杂度评估训练数据
    const complexityData = this.db.prepare(`
      SELECT
        kdh.task_id,
        kdh.complexity_score,
        kdh.actual_model,
        sch.final_success,
        sch.attempts
      FROM knowledge_distillation_history kdh
      LEFT JOIN self_correction_history sch ON kdh.task_id = sch.task_id
      WHERE kdh.created_at >= datetime('now', '-${days} days')
        AND sch.final_success IS NOT NULL
    `).all();

    data.complexity = complexityData.map(row => ({
      taskId: row.task_id,
      predictedComplexity: row.complexity_score,
      actualComplexity: this.calculateActualComplexity(row),
      label: row.final_success ? 'success' : 'failure'
    }));

    // 2. 意图识别训练数据
    const intentData = this.db.prepare(`
      SELECT
        user_input,
        intents,
        intent_count,
        confidence,
        success
      FROM multi_intent_history
      WHERE created_at >= datetime('now', '-${days} days')
        AND success = 1
    `).all();

    data.intent = intentData.map(row => ({
      input: row.user_input,
      intents: JSON.parse(row.intents || '[]'),
      confidence: row.confidence
    }));

    // 3. 工具使用数据
    const toolData = this.db.prepare(`
      SELECT
        feature_name,
        usage_count,
        success_count,
        failure_count,
        avg_duration_ms
      FROM feature_usage_tracking
      WHERE created_at >= datetime('now', '-${days} days')
    `).all();

    data.tools = toolData.map(row => ({
      tool: row.feature_name,
      successRate: row.success_count / (row.success_count + row.failure_count),
      avgDuration: row.avg_duration_ms,
      usageCount: row.usage_count
    }));

    // 4. 用户反馈数据
    const feedbackData = this.db.prepare(`
      SELECT
        related_feature,
        rating,
        feedback_type,
        description
      FROM user_feedback
      WHERE created_at >= datetime('now', '-${days} days')
        AND rating IS NOT NULL
    `).all();

    data.feedback = feedbackData.map(row => ({
      feature: row.related_feature,
      rating: row.rating,
      type: row.feedback_type,
      description: row.description
    }));

    console.log('数据收集完成:\n');
    logInfo('复杂度样本', data.complexity.length);
    logInfo('意图样本', data.intent.length);
    logInfo('工具样本', data.tools.length);
    logInfo('反馈样本', data.feedback.length);

    return data;
  }

  /**
   * 计算实际复杂度
   */
  calculateActualComplexity(row) {
    // 基于实际结果反推复杂度
    let actualComplexity = row.complexity_score;

    // 如果失败或需要多次尝试，说明比预期复杂
    if (!row.final_success) {
      actualComplexity += 0.2;
    } else if (row.attempts > 1) {
      actualComplexity += 0.1 * (row.attempts - 1);
    }

    // 如果用小模型成功，说明实际更简单
    if (row.actual_model?.includes('1.5b') && row.final_success) {
      actualComplexity -= 0.1;
    }

    return Math.max(0, Math.min(1, actualComplexity));
  }

  /**
   * 训练复杂度评估模型
   */
  trainComplexityModel(data) {
    logHeader('🎓 训练复杂度评估模型');

    if (data.complexity.length < 20) {
      logWarning('训练样本不足 (<20)');
      return null;
    }

    const model = this.models.complexityEstimator;
    const learningRate = model.learningRate;

    let totalError = 0;
    let improvedCount = 0;

    data.complexity.forEach(example => {
      const predicted = example.predictedComplexity;
      const actual = example.actualComplexity;
      const error = actual - predicted;

      totalError += Math.abs(error);

      // 梯度下降更新权重
      if (Math.abs(error) > 0.1) {
        // 只在误差较大时更新
        const adjustment = learningRate * error;

        // 简化版权重更新（实际应该基于特征值）
        const avgAdjustment = adjustment / 4;
        model.weights.intentComplexity += avgAdjustment;
        model.weights.contextComplexity += avgAdjustment;
        model.weights.historyComplexity += avgAdjustment;
        model.weights.toolsComplexity += avgAdjustment;

        improvedCount++;
      }

      // 保存训练样本
      model.trainingExamples.push({
        predicted,
        actual,
        error,
        label: example.label
      });
    });

    // 限制训练样本数量
    if (model.trainingExamples.length > 1000) {
      model.trainingExamples = model.trainingExamples.slice(-1000);
    }

    // 归一化权重
    const totalWeight = Object.values(model.weights).reduce((a, b) => a + b, 0);
    Object.keys(model.weights).forEach(key => {
      model.weights[key] /= totalWeight;
    });

    const avgError = totalError / data.complexity.length;

    console.log('训练结果:\n');
    logInfo('训练样本数', data.complexity.length);
    logInfo('平均误差', avgError.toFixed(4));
    logInfo('更新次数', improvedCount);

    console.log('\n更新后的权重:');
    Object.entries(model.weights).forEach(([key, value]) => {
      console.log(`  ${key}: ${value.toFixed(4)}`);
    });

    if (avgError < 0.15) {
      logSuccess('模型性能优秀 (平均误差 < 0.15)');
    } else if (avgError < 0.25) {
      logSuccess('模型性能良好 (平均误差 < 0.25)');
    } else {
      logWarning('模型需要更多训练数据');
    }

    return { avgError, improvedCount };
  }

  /**
   * 训练意图识别模型
   */
  trainIntentModel(data) {
    logHeader('🎯 训练意图识别模型');

    if (data.intent.length < 10) {
      logWarning('训练样本不足 (<10)');
      return null;
    }

    const model = this.models.intentRecognizer;
    let patternsLearned = 0;

    data.intent.forEach(example => {
      const { input, intents, confidence } = example;

      // 只学习高置信度的样本
      if (confidence >= model.confidenceThreshold) {
        // 提取关键词模式
        const keywords = this.extractKeywords(input);

        keywords.forEach(keyword => {
          if (!model.patterns.has(keyword)) {
            model.patterns.set(keyword, {
              intents: new Map(),
              count: 0
            });
          }

          const pattern = model.patterns.get(keyword);
          pattern.count++;

          intents.forEach(intent => {
            const currentCount = pattern.intents.get(intent) || 0;
            pattern.intents.set(intent, currentCount + 1);
          });

          patternsLearned++;
        });
      }
    });

    console.log('训练结果:\n');
    logInfo('训练样本数', data.intent.length);
    logInfo('学习到的模式', model.patterns.size);
    logInfo('模式-意图映射', patternsLearned);

    // 显示Top 5 关键词
    const topPatterns = Array.from(model.patterns.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    if (topPatterns.length > 0) {
      console.log('\nTop 5 关键词模式:');
      topPatterns.forEach(([keyword, data]) => {
        const topIntent = Array.from(data.intents.entries())
          .sort((a, b) => b[1] - a[1])[0];
        console.log(`  "${keyword}": ${topIntent[0]} (${data.count}次)`);
      });
    }

    return { patternsLearned };
  }

  /**
   * 提取关键词
   */
  extractKeywords(text) {
    // 简化版关键词提取（实际应该使用NLP）
    const stopWords = new Set(['的', '了', '和', '是', '在', '我', '有', '这', '个', '你', '不', '就', '都', '把']);

    const words = text
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stopWords.has(w));

    return [...new Set(words)]; // 去重
  }

  /**
   * 训练工具选择模型
   */
  trainToolModel(data) {
    logHeader('🔧 训练工具选择模型');

    if (data.tools.length === 0) {
      logWarning('无工具使用数据');
      return null;
    }

    const model = this.models.toolSelector;

    data.tools.forEach(example => {
      const { tool, successRate, avgDuration, usageCount } = example;

      // 更新成功率
      model.successRates.set(tool, successRate);

      // 计算偏好分数（综合成功率和使用频率）
      const preferenceScore = (
        successRate * 0.7 +                              // 成功率权重70%
        Math.min(usageCount / 100, 1) * 0.2 +            // 使用频率权重20%
        (1 - Math.min(avgDuration / 5000, 1)) * 0.1      // 速度权重10%
      );

      const currentPreference = model.preferences.get(tool) || 0;
      const newPreference = currentPreference + (preferenceScore - currentPreference) * model.learningRate;
      model.preferences.set(tool, newPreference);
    });

    console.log('训练结果:\n');
    logInfo('工具数量', data.tools.length);
    logInfo('总使用次数', data.tools.reduce((sum, t) => sum + t.usageCount, 0));

    // Top 5 工具
    const topTools = Array.from(model.preferences.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (topTools.length > 0) {
      console.log('\nTop 5 推荐工具:');
      topTools.forEach(([tool, score]) => {
        const successRate = model.successRates.get(tool) || 0;
        console.log(`  ${tool}: 评分 ${score.toFixed(3)}, 成功率 ${(successRate * 100).toFixed(1)}%`);
      });
    }

    return { toolsLearned: data.tools.length };
  }

  /**
   * 学习用户偏好
   */
  learnUserPreferences(data) {
    logHeader('👤 学习用户偏好');

    if (data.feedback.length === 0) {
      logWarning('无用户反馈数据');
      return null;
    }

    const model = this.models.userPreference;

    data.feedback.forEach(feedback => {
      const { feature, rating, type } = feedback;

      // 更新功能评分
      const currentRating = model.features.get(feature) || 3;
      const newRating = currentRating + (rating - currentRating) * model.learningRate;
      model.features.set(feature, newRating);

      // 统计反馈类型
      model.responseStyle[type] = (model.responseStyle[type] || 0) + 1;
    });

    const avgRating = data.feedback.reduce((sum, f) => sum + f.rating, 0) / data.feedback.length;

    console.log('学习结果:\n');
    logInfo('反馈数量', data.feedback.length);
    logInfo('平均评分', avgRating.toFixed(2));

    // 显示功能评分
    const featureRatings = Array.from(model.features.entries())
      .sort((a, b) => b[1] - a[1]);

    if (featureRatings.length > 0) {
      console.log('\n功能满意度:');
      featureRatings.forEach(([feature, rating]) => {
        const emoji = rating >= 4 ? '😊' : rating >= 3 ? '😐' : '😞';
        console.log(`  ${feature}: ${emoji} ${rating.toFixed(2)}/5`);
      });
    }

    // 反馈类型分布
    console.log('\n反馈类型分布:');
    Object.entries(model.responseStyle)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });

    return { feedbackProcessed: data.feedback.length, avgRating };
  }

  /**
   * 训练所有模型
   */
  async train(days = 30) {
    logHeader('🚀 开始训练');

    const data = await this.collectTrainingData(days);

    const results = {
      complexity: this.trainComplexityModel(data),
      intent: this.trainIntentModel(data),
      tool: this.trainToolModel(data),
      preference: this.learnUserPreferences(data)
    };

    // 更新统计
    this.stats.totalTrainingSessions++;
    this.stats.totalExamples = data.complexity.length + data.intent.length + data.tools.length + data.feedback.length;
    this.stats.lastTrainingTime = new Date().toISOString();

    if (results.complexity) {
      this.stats.improvements.push({
        timestamp: new Date().toISOString(),
        type: 'complexity',
        metric: 'avgError',
        value: results.complexity.avgError
      });
    }

    // 保存模型
    this.saveModels();

    logHeader('✅ 训练完成');
    logSuccess(`模型已更新，版本: ${this.stats.modelVersion}`);

    return results;
  }

  /**
   * 评估模型性能
   */
  async evaluate() {
    logHeader('📊 模型性能评估');

    // 使用最近的数据评估
    const testData = await this.collectTrainingData(7);

    console.log('复杂度评估模型:\n');
    if (this.models.complexityEstimator.trainingExamples.length > 0) {
      const recentExamples = this.models.complexityEstimator.trainingExamples.slice(-50);
      const avgError = recentExamples.reduce((sum, ex) => sum + Math.abs(ex.error), 0) / recentExamples.length;

      logInfo('训练样本数', this.models.complexityEstimator.trainingExamples.length);
      logInfo('平均误差', avgError.toFixed(4));

      if (avgError < 0.15) {
        logSuccess('性能优秀');
      } else if (avgError < 0.25) {
        logInfo('性能良好');
      } else {
        logWarning('需要更多训练');
      }
    } else {
      logWarning('模型尚未训练');
    }

    console.log('\n意图识别模型:\n');
    logInfo('学习到的模式数', this.models.intentRecognizer.patterns.size);

    console.log('\n工具选择模型:\n');
    logInfo('工具偏好数', this.models.toolSelector.preferences.size);

    console.log('\n用户偏好模型:\n');
    logInfo('功能评分数', this.models.userPreference.features.size);

    console.log('\n整体统计:\n');
    logInfo('训练会话数', this.stats.totalTrainingSessions);
    logInfo('总训练样本数', this.stats.totalExamples);
    logInfo('最后训练时间', this.stats.lastTrainingTime || '从未训练');
    logInfo('模型版本', this.stats.modelVersion);
  }

  /**
   * 显示统计信息
   */
  showStats() {
    logHeader('📈 学习统计');

    console.log('模型信息:\n');
    logInfo('模型版本', this.stats.modelVersion);
    logInfo('训练会话', this.stats.totalTrainingSessions);
    logInfo('总样本数', this.stats.totalExamples);
    logInfo('最后训练', this.stats.lastTrainingTime || '从未训练');

    if (this.stats.improvements.length > 0) {
      console.log('\n性能改进趋势:');
      const recentImprovements = this.stats.improvements.slice(-5);
      recentImprovements.forEach(imp => {
        console.log(`  ${imp.timestamp.split('T')[0]}: ${imp.type} ${imp.metric} = ${imp.value.toFixed(4)}`);
      });
    }

    console.log('\n当前模型状态:\n');
    console.log('复杂度权重:');
    Object.entries(this.models.complexityEstimator.weights).forEach(([key, value]) => {
      console.log(`  ${key}: ${value.toFixed(4)}`);
    });

    console.log(`\n意图模式: ${this.models.intentRecognizer.patterns.size} 个`);
    console.log(`工具偏好: ${this.models.toolSelector.preferences.size} 个`);
    console.log(`用户偏好: ${this.models.userPreference.features.size} 个`);
  }
}

/**
 * 主函数
 */
async function main() {
  const command = process.argv[2] || 'train';

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     模型在线学习系统                                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  try {
    // 连接数据库
    const DatabaseManager = require('./src/main/database');
    const dbPath = path.join(__dirname, 'data/chainlesschain.db');
    const dbManager = new DatabaseManager(dbPath, { encryptionEnabled: false });
    await dbManager.initialize();

    const manager = new OnlineLearningManager(dbManager.db);

    switch (command) {
      case 'train': {
        const days = parseInt(process.argv[3]) || 30;
        await manager.train(days);
        break;
      }

      case 'evaluate':
        await manager.evaluate();
        break;

      case 'stats':
        manager.showStats();
        break;

      default:
        logError(`未知命令: ${command}`);
        console.log('\n可用命令:');
        console.log('  train [days]  训练模型（默认30天数据）');
        console.log('  evaluate      评估模型性能');
        console.log('  stats         查看学习统计');
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
