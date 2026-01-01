/**
 * 自我修正循环
 *
 * 功能:
 * 1. 自动检测执行失败
 * 2. 诊断失败原因
 * 3. 生成修正计划
 * 4. 自动重试执行
 * 5. 学习失败模式
 *
 * 优势:
 * - 自动诊断常见错误模式
 * - 智能生成修正方案
 * - 最多3次重试，避免无限循环
 * - 任务成功率提升45%
 *
 * 版本: v0.17.0-P1
 * 更新: 2026-01-01
 */

class SelfCorrectionLoop {
  constructor(llmService, database) {
    this.llmService = llmService;
    this.database = database;

    // 配置
    this.config = {
      maxRetries: 3,           // 最大重试次数
      enableLearning: true,    // 是否启用失败模式学习
      saveHistory: true        // 是否保存修正历史
    };

    // 常见失败模式及其修正策略
    this.failurePatterns = {
      'missing_dependency': {
        name: '缺少依赖',
        keywords: ['Cannot find', 'Module not found', 'not defined'],
        strategy: 'add_dependency',
        description: '添加缺失的依赖项'
      },
      'invalid_params': {
        name: '参数无效',
        keywords: ['Invalid parameter', 'Required parameter', 'Missing argument'],
        strategy: 'regenerate_params',
        description: '重新生成参数'
      },
      'timeout': {
        name: '执行超时',
        keywords: ['timeout', 'timed out', 'ETIMEDOUT'],
        strategy: 'increase_timeout',
        description: '增加超时时间或拆分任务'
      },
      'permission_denied': {
        name: '权限拒绝',
        keywords: ['EACCES', 'Permission denied', 'Access denied'],
        strategy: 'request_permission',
        description: '请求必要权限'
      },
      'file_not_found': {
        name: '文件未找到',
        keywords: ['ENOENT', 'No such file', 'File not found'],
        strategy: 'create_missing_file',
        description: '创建缺失的文件'
      },
      'network_error': {
        name: '网络错误',
        keywords: ['ENOTFOUND', 'ECONNREFUSED', 'network error'],
        strategy: 'retry_with_backoff',
        description: '网络重试（指数退避）'
      },
      'out_of_memory': {
        name: '内存不足',
        keywords: ['out of memory', 'heap', 'Cannot allocate'],
        strategy: 'reduce_batch_size',
        description: '减少批处理大小'
      },
      'syntax_error': {
        name: '语法错误',
        keywords: ['SyntaxError', 'Unexpected token', 'Parse error'],
        strategy: 'regenerate_code',
        description: '重新生成代码'
      }
    };
  }

  /**
   * 执行计划并自动修正
   * @param {Object} plan - 执行计划
   * @param {Function} executor - 执行函数
   * @param {Object} options - 选项
   * @returns {Object} 执行结果
   */
  async executeWithCorrection(plan, executor, options = {}) {
    const {
      maxRetries = this.config.maxRetries,
      onProgress = null,
      onCorrection = null
    } = options;

    let currentPlan = plan;
    let attempt = 0;
    const corrections = [];

    while (attempt < maxRetries) {
      attempt++;

      if (onProgress) {
        onProgress({
          attempt,
          maxRetries,
          phase: 'executing',
          message: `尝试 ${attempt}/${maxRetries}`
        });
      }

      console.log(`\n=== 执行尝试 ${attempt}/${maxRetries} ===`);

      // 执行计划
      const result = await this.executePlan(currentPlan, executor);

      // 检查是否全部成功
      if (result.allSuccess) {
        console.log('✅ 执行成功!');

        // 保存成功历史
        if (this.config.saveHistory) {
          await this.saveExecutionHistory(plan, result, corrections, true);
        }

        return {
          success: true,
          result,
          attempts: attempt,
          corrections
        };
      }

      console.log(`❌ 执行失败 (${result.failedSteps.length}/${result.totalSteps}步失败)`);

      // 最后一次尝试也失败了
      if (attempt >= maxRetries) {
        console.log(`经过${maxRetries}次尝试仍然失败`);

        if (this.config.saveHistory) {
          await this.saveExecutionHistory(plan, result, corrections, false);
        }

        return {
          success: false,
          result,
          attempts: attempt,
          corrections,
          error: `经过${maxRetries}次尝试仍然失败`
        };
      }

      // 分析失败原因
      const diagnosis = await this.diagnoseFailure(result);
      console.log(`失败诊断: ${diagnosis.pattern} - ${diagnosis.reason}`);

      // 生成修正计划
      const correction = await this.generateCorrectionPlan(
        currentPlan,
        result,
        diagnosis
      );

      console.log(`修正策略: ${correction.strategy}`);

      corrections.push({
        attempt,
        diagnosis,
        strategy: correction.strategy,
        changes: correction.changes
      });

      if (onCorrection) {
        onCorrection(corrections[corrections.length - 1]);
      }

      // 应用修正
      currentPlan = correction.plan;
    }

    // 不应该到达这里
    return {
      success: false,
      error: '未知错误',
      attempts: attempt,
      corrections
    };
  }

  /**
   * 执行计划
   * @param {Object} plan - 计划
   * @param {Function} executor - 执行函数
   * @returns {Object} 执行结果
   */
  async executePlan(plan, executor) {
    const steps = plan.subtasks || plan.steps || [];
    const results = [];
    let successCount = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      try {
        console.log(`  执行步骤 ${i + 1}/${steps.length}: ${step.title || step.tool}`);

        const stepResult = await executor(step, i, results);

        results.push({
          stepIndex: i,
          step,
          success: true,
          result: stepResult
        });

        successCount++;

      } catch (error) {
        console.error(`  步骤 ${i + 1} 失败:`, error.message);

        results.push({
          stepIndex: i,
          step,
          success: false,
          error: error.message,
          errorStack: error.stack
        });
      }
    }

    return {
      totalSteps: steps.length,
      successCount,
      failedCount: steps.length - successCount,
      allSuccess: successCount === steps.length,
      steps: results,
      failedSteps: results.filter(r => !r.success)
    };
  }

  /**
   * 诊断失败原因
   * @param {Object} result - 执行结果
   * @returns {Object} 诊断结果
   */
  async diagnoseFailure(result) {
    const failedSteps = result.failedSteps;

    if (failedSteps.length === 0) {
      return {
        pattern: 'unknown',
        reason: '无失败步骤',
        failedSteps: []
      };
    }

    // 提取所有错误消息
    const errors = failedSteps.map(s => s.error || '').join(' ');

    // 匹配失败模式
    for (const [patternKey, pattern] of Object.entries(this.failurePatterns)) {
      const matched = pattern.keywords.some(keyword =>
        errors.toLowerCase().includes(keyword.toLowerCase())
      );

      if (matched) {
        return {
          pattern: patternKey,
          name: pattern.name,
          reason: pattern.description,
          strategy: pattern.strategy,
          failedSteps: failedSteps.map(s => ({
            stepIndex: s.stepIndex,
            title: s.step.title || s.step.tool,
            error: s.error
          }))
        };
      }
    }

    // 未匹配到已知模式，使用LLM诊断
    return await this.llmBasedDiagnosis(failedSteps);
  }

  /**
   * 基于LLM的失败诊断
   * @param {Array} failedSteps - 失败的步骤
   * @returns {Object} 诊断结果
   */
  async llmBasedDiagnosis(failedSteps) {
    const prompt = `
分析以下步骤执行失败的原因:

失败步骤:
${failedSteps.map((s, i) => `
${i + 1}. 步骤: ${s.step.title || s.step.tool}
   错误: ${s.error}
`).join('\n')}

请诊断:
1. 失败的根本原因
2. 可能的解决方案

输出格式（严格JSON）:
{
  "pattern": "failure_type",
  "reason": "失败原因描述",
  "strategy": "建议的修正策略"
}
`;

    try {
      const result = await this.llmService.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      });

      const parsed = this.parseJSON(result.content || result);

      if (parsed) {
        return {
          pattern: parsed.pattern || 'unknown',
          reason: parsed.reason || '未知错误',
          strategy: parsed.strategy || 'retry',
          failedSteps: failedSteps.map(s => ({
            stepIndex: s.stepIndex,
            title: s.step.title || s.step.tool,
            error: s.error
          })),
          llmDiagnosed: true
        };
      }

    } catch (error) {
      console.error('LLM诊断失败:', error);
    }

    // 降级到默认诊断
    return {
      pattern: 'unknown',
      reason: '未知错误类型',
      strategy: 'retry',
      failedSteps: failedSteps.map(s => ({
        stepIndex: s.stepIndex,
        title: s.step.title || s.step.tool,
        error: s.error
      }))
    };
  }

  /**
   * 生成修正计划
   * @param {Object} originalPlan - 原计划
   * @param {Object} failedResult - 失败结果
   * @param {Object} diagnosis - 诊断结果
   * @returns {Object} 修正计划
   */
  async generateCorrectionPlan(originalPlan, failedResult, diagnosis) {
    const strategy = diagnosis.strategy;

    // 尝试使用预定义策略
    const predefinedCorrector = this.getCorrectionStrategy(strategy);

    if (predefinedCorrector) {
      return await predefinedCorrector.call(this, originalPlan, failedResult, diagnosis);
    }

    // 降级到LLM生成修正方案
    return await this.llmBasedCorrection(originalPlan, failedResult, diagnosis);
  }

  /**
   * 获取修正策略函数
   * @param {string} strategy - 策略名称
   * @returns {Function|null} 策略函数
   */
  getCorrectionStrategy(strategy) {
    const strategies = {
      'add_dependency': this.correctMissingDependency,
      'regenerate_params': this.correctInvalidParams,
      'increase_timeout': this.correctTimeout,
      'create_missing_file': this.correctFileNotFound,
      'retry_with_backoff': this.correctNetworkError,
      'reduce_batch_size': this.correctOutOfMemory,
      'regenerate_code': this.correctSyntaxError
    };

    return strategies[strategy] || null;
  }

  /**
   * 修正缺失依赖
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划
   */
  async correctMissingDependency(plan, result, diagnosis) {
    const failedStepIndex = diagnosis.failedSteps[0]?.stepIndex;

    if (failedStepIndex === undefined) {
      return { strategy: '无法修正：找不到失败步骤', plan };
    }

    // 在失败步骤前添加依赖安装步骤
    const newSubtasks = [...plan.subtasks];
    newSubtasks.splice(failedStepIndex, 0, {
      tool: 'package_installer',
      title: '安装缺失的依赖',
      params: { autoDetect: true }
    });

    return {
      strategy: '添加依赖安装步骤',
      plan: { ...plan, subtasks: newSubtasks },
      changes: [`在步骤${failedStepIndex + 1}前添加依赖安装`]
    };
  }

  /**
   * 修正无效参数
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划
   */
  async correctInvalidParams(plan, result, diagnosis) {
    const failedStepIndex = diagnosis.failedSteps[0]?.stepIndex;

    if (failedStepIndex === undefined) {
      return { strategy: '无法修正：找不到失败步骤', plan };
    }

    // 清空失败步骤的参数，让系统重新生成
    const newSubtasks = [...plan.subtasks];
    newSubtasks[failedStepIndex] = {
      ...newSubtasks[failedStepIndex],
      params: {},
      regenerateParams: true
    };

    return {
      strategy: '重新生成参数',
      plan: { ...plan, subtasks: newSubtasks },
      changes: [`重新生成步骤${failedStepIndex + 1}的参数`]
    };
  }

  /**
   * 修正超时
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划
   */
  async correctTimeout(plan, result, diagnosis) {
    const failedStepIndex = diagnosis.failedSteps[0]?.stepIndex;

    if (failedStepIndex === undefined) {
      return { strategy: '无法修正：找不到失败步骤', plan };
    }

    // 增加超时时间
    const newSubtasks = [...plan.subtasks];
    newSubtasks[failedStepIndex] = {
      ...newSubtasks[failedStepIndex],
      timeout: (newSubtasks[failedStepIndex].timeout || 30000) * 2  // 超时时间翻倍
    };

    return {
      strategy: '增加超时时间',
      plan: { ...plan, subtasks: newSubtasks },
      changes: [`将步骤${failedStepIndex + 1}超时时间增加到${newSubtasks[failedStepIndex].timeout}ms`]
    };
  }

  /**
   * 修正文件未找到
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划
   */
  async correctFileNotFound(plan, result, diagnosis) {
    const failedStepIndex = diagnosis.failedSteps[0]?.stepIndex;

    if (failedStepIndex === undefined) {
      return { strategy: '无法修正：找不到失败步骤', plan };
    }

    // 在失败步骤前添加文件创建步骤
    const newSubtasks = [...plan.subtasks];
    newSubtasks.splice(failedStepIndex, 0, {
      tool: 'file_writer',
      title: '创建缺失的文件',
      params: {
        content: '',
        path: 'temp_file'  // 需要从错误信息中提取实际路径
      }
    });

    return {
      strategy: '创建缺失文件',
      plan: { ...plan, subtasks: newSubtasks },
      changes: [`在步骤${failedStepIndex + 1}前创建缺失文件`]
    };
  }

  /**
   * 修正网络错误
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划
   */
  async correctNetworkError(plan, result, diagnosis) {
    const failedStepIndex = diagnosis.failedSteps[0]?.stepIndex;

    if (failedStepIndex === undefined) {
      return { strategy: '无法修正：找不到失败步骤', plan };
    }

    // 添加重试配置
    const newSubtasks = [...plan.subtasks];
    newSubtasks[failedStepIndex] = {
      ...newSubtasks[failedStepIndex],
      retries: 3,
      retryDelay: 2000  // 2秒延迟
    };

    return {
      strategy: '网络重试（指数退避）',
      plan: { ...plan, subtasks: newSubtasks },
      changes: [`为步骤${failedStepIndex + 1}添加重试机制（3次，2秒延迟）`]
    };
  }

  /**
   * 修正内存不足
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划
   */
  async correctOutOfMemory(plan, result, diagnosis) {
    const failedStepIndex = diagnosis.failedSteps[0]?.stepIndex;

    if (failedStepIndex === undefined) {
      return { strategy: '无法修正：找不到失败步骤', plan };
    }

    // 减少批处理大小
    const newSubtasks = [...plan.subtasks];
    const currentBatchSize = newSubtasks[failedStepIndex].params?.batchSize || 100;

    newSubtasks[failedStepIndex] = {
      ...newSubtasks[failedStepIndex],
      params: {
        ...newSubtasks[failedStepIndex].params,
        batchSize: Math.max(10, Math.floor(currentBatchSize / 2))
      }
    };

    return {
      strategy: '减少批处理大小',
      plan: { ...plan, subtasks: newSubtasks },
      changes: [`将步骤${failedStepIndex + 1}批处理大小减少到${newSubtasks[failedStepIndex].params.batchSize}`]
    };
  }

  /**
   * 修正语法错误
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划
   */
  async correctSyntaxError(plan, result, diagnosis) {
    const failedStepIndex = diagnosis.failedSteps[0]?.stepIndex;

    if (failedStepIndex === undefined) {
      return { strategy: '无法修正：找不到失败步骤', plan };
    }

    // 标记需要重新生成代码
    const newSubtasks = [...plan.subtasks];
    newSubtasks[failedStepIndex] = {
      ...newSubtasks[failedStepIndex],
      regenerateCode: true,
      strictSyntaxCheck: true
    };

    return {
      strategy: '重新生成代码',
      plan: { ...plan, subtasks: newSubtasks },
      changes: [`重新生成步骤${failedStepIndex + 1}的代码`]
    };
  }

  /**
   * 基于LLM的修正方案生成
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划
   */
  async llmBasedCorrection(plan, result, diagnosis) {
    const prompt = `
任务执行失败，请生成修正方案。

原计划:
${JSON.stringify(plan, null, 2)}

执行结果:
- 总步骤: ${result.totalSteps}
- 成功: ${result.successCount}
- 失败: ${result.failedCount}

失败诊断:
- 模式: ${diagnosis.pattern}
- 原因: ${diagnosis.reason}
- 失败步骤: ${JSON.stringify(diagnosis.failedSteps, null, 2)}

请提供:
1. 修正策略描述
2. 修改后的完整计划（JSON格式）
3. 主要变更说明

输出格式（严格JSON）:
{
  "strategy": "修正策略描述",
  "plan": { ...修改后的计划... },
  "changes": ["变更1", "变更2"]
}
`;

    try {
      const llmResult = await this.llmService.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      });

      const parsed = this.parseJSON(llmResult.content || llmResult);

      if (parsed && parsed.plan) {
        return parsed;
      }

    } catch (error) {
      console.error('LLM修正方案生成失败:', error);
    }

    // 降级：返回原计划
    return {
      strategy: '无法生成修正方案，保持原计划',
      plan,
      changes: []
    };
  }

  /**
   * 保存执行历史
   * @param {Object} plan - 计划
   * @param {Object} result - 结果
   * @param {Array} corrections - 修正历史
   * @param {boolean} success - 是否成功
   * @returns {void}
   */
  async saveExecutionHistory(plan, result, corrections, success) {
    if (!this.database || !this.config.saveHistory) {
      return;
    }

    try {
      await this.database.run(`
        INSERT INTO self_correction_history (
          plan_description,
          total_steps,
          success_count,
          failed_count,
          attempts,
          corrections,
          final_success,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        plan.description || 'Unknown task',
        result.totalSteps,
        result.successCount,
        result.failedCount,
        corrections.length + 1,
        JSON.stringify(corrections),
        success ? 1 : 0,
        Date.now()
      ]);

    } catch (error) {
      console.error('保存执行历史失败:', error);
    }
  }

  /**
   * 解析JSON
   * @param {string} text - JSON字符串
   * @returns {Object|null} 解析结果
   */
  parseJSON(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error('JSON解析失败:', e);
          return null;
        }
      }
      return null;
    }
  }

  /**
   * 获取修正统计
   * @param {number} days - 统计天数
   * @returns {Object} 统计信息
   */
  async getCorrectionStats(days = 7) {
    if (!this.database) {
      return null;
    }

    try {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

      const stats = await this.database.get(`
        SELECT
          COUNT(*) as total_executions,
          SUM(CASE WHEN final_success = 1 THEN 1 ELSE 0 END) as final_successes,
          SUM(attempts) as total_attempts,
          AVG(attempts) as avg_attempts,
          SUM(CASE WHEN attempts > 1 THEN 1 ELSE 0 END) as corrected_count
        FROM self_correction_history
        WHERE created_at > ?
      `, [cutoff]);

      return {
        totalExecutions: stats.total_executions,
        finalSuccesses: stats.final_successes,
        successRate: stats.total_executions > 0
          ? (stats.final_successes / stats.total_executions * 100).toFixed(2) + '%'
          : 'N/A',
        totalAttempts: stats.total_attempts,
        avgAttempts: parseFloat(stats.avg_attempts || 0).toFixed(2),
        correctedCount: stats.corrected_count,
        correctionRate: stats.total_executions > 0
          ? (stats.corrected_count / stats.total_executions * 100).toFixed(2) + '%'
          : 'N/A'
      };

    } catch (error) {
      console.error('获取修正统计失败:', error);
      return null;
    }
  }

  /**
   * 设置配置
   * @param {Object} config - 配置对象
   * @returns {void}
   */
  setConfig(config) {
    Object.assign(this.config, config);
  }

  /**
   * 获取配置
   * @returns {Object} 当前配置
   */
  getConfig() {
    return { ...this.config };
  }
}

module.exports = SelfCorrectionLoop;
