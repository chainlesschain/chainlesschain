/**
 * 检查点校验器
 *
 * 功能:
 * 1. 在关键步骤后进行结果校验
 * 2. 检查结果完整性
 * 3. 验证预期输出
 * 4. 检查依赖数据（为下一步做准备）
 * 5. LLM质量评估（可选）
 *
 * 优势:
 * - 早期发现错误，节省计算资源
 * - 关键步骤人工确认，提升可靠性
 * - LLM质量评估，适用于生成类任务
 *
 * 版本: v0.17.0-P1
 * 更新: 2026-01-01
 */

class CheckpointValidator {
  constructor(llmService, database) {
    this.llmService = llmService;
    this.database = database;

    // 校验配置
    this.config = {
      enableLLMQualityCheck: true,    // 是否启用LLM质量评估
      qualityThreshold: 0.7,           // 质量评分阈值（0-1）
      enableStrictMode: false,         // 严格模式（所有校验必须通过）
      saveValidationHistory: true      // 是否保存校验历史
    };

    // 预期输出配置（根据工具类型）
    this.expectedOutputs = {
      'html_generator': ['html', 'title'],
      'css_generator': ['css'],
      'js_generator': ['javascript', 'code'],
      'word_generator': ['filePath', 'success'],
      'pdf_generator': ['filePath', 'success'],
      'file_writer': ['path', 'success'],
      'file_reader': ['content'],
      'data_analyzer': ['analysis', 'statistics'],
      'git_commit': ['success', 'commitHash'],
      'deploy_to_cloud': ['success', 'url']
    };

    // 质量检查需求（哪些工具需要LLM质量评估）
    this.qualityCheckRequired = new Set([
      'html_generator',
      'css_generator',
      'js_generator',
      'word_generator',
      'pdf_generator',
      'data_analyzer'
    ]);
  }

  /**
   * 验证检查点
   * @param {number} stepIndex - 步骤索引
   * @param {Object} result - 步骤执行结果
   * @param {Object} plan - 完整执行计划
   * @param {Object} options - 校验选项
   * @returns {Object} 校验结果
   */
  async validateCheckpoint(stepIndex, result, plan, options = {}) {
    const {
      skipLLMCheck = false,
      strictMode = this.config.enableStrictMode
    } = options;

    const validations = [];
    const step = plan.subtasks[stepIndex];

    // 1. 结果完整性检查
    const completenessCheck = this.checkCompleteness(result, step);
    validations.push(completenessCheck);

    // 2. 预期输出检查
    const expectedOutputCheck = this.checkExpectedOutputs(result, step);
    validations.push(expectedOutputCheck);

    // 3. 依赖数据检查（为下一步准备）
    const nextStepCheck = this.checkNextStepDependencies(stepIndex, result, plan);
    if (nextStepCheck) {
      validations.push(nextStepCheck);
    }

    // 4. 数据类型校验
    const typeCheck = this.checkDataTypes(result, step);
    validations.push(typeCheck);

    // 5. LLM质量检查（可选，耗时较长）
    if (!skipLLMCheck &&
        this.config.enableLLMQualityCheck &&
        this.isQualityCheckRequired(step)) {

      const qualityCheck = await this.llmQualityCheck(result, step);
      validations.push(qualityCheck);
    }

    // 汇总校验结果
    const allPassed = strictMode
      ? validations.every(v => v.passed)
      : validations.filter(v => v.critical).every(v => v.passed);

    const summary = {
      stepIndex,
      stepTitle: step.title || step.tool,
      passed: allPassed,
      validations,
      failedCount: validations.filter(v => !v.passed).length,
      criticalFailures: validations.filter(v => !v.passed && v.critical).length,
      recommendation: this.getRecommendation(validations, allPassed)
    };

    // 保存校验历史
    if (this.config.saveValidationHistory) {
      await this.saveValidationHistory(summary);
    }

    return summary;
  }

  /**
   * 检查结果完整性
   * @param {Object} result - 结果
   * @param {Object} step - 步骤配置
   * @returns {Object} 校验结果
   */
  checkCompleteness(result, step) {
    const validation = {
      type: 'completeness',
      critical: true,
      passed: true,
      reason: ''
    };

    // 检查结果是否为空
    if (!result || result === null || result === undefined) {
      validation.passed = false;
      validation.reason = '步骤执行结果为空';
      return validation;
    }

    // 检查是否明确失败
    if (result.success === false) {
      validation.passed = false;
      validation.reason = '步骤执行明确标记为失败';
      if (result.error) {
        validation.reason += `: ${result.error}`;
      }
      return validation;
    }

    // 检查是否包含错误信息
    if (result.error && !result.success) {
      validation.passed = false;
      validation.reason = `包含错误信息: ${result.error}`;
      return validation;
    }

    return validation;
  }

  /**
   * 检查预期输出
   * @param {Object} result - 结果
   * @param {Object} step - 步骤配置
   * @returns {Object} 校验结果
   */
  checkExpectedOutputs(result, step) {
    const validation = {
      type: 'expected_outputs',
      critical: true,
      passed: true,
      reason: '',
      missingOutputs: []
    };

    // 获取该工具的预期输出列表
    const expectedKeys = step.expected_outputs
      || this.expectedOutputs[step.tool]
      || [];

    // 检查每个预期输出
    for (const key of expectedKeys) {
      if (!(key in result) || result[key] === null || result[key] === undefined) {
        validation.passed = false;
        validation.missingOutputs.push(key);
      }
    }

    if (!validation.passed) {
      validation.reason = `缺少预期输出: ${validation.missingOutputs.join(', ')}`;
    }

    return validation;
  }

  /**
   * 检查下一步依赖
   * @param {number} stepIndex - 当前步骤索引
   * @param {Object} result - 当前结果
   * @param {Object} plan - 完整计划
   * @returns {Object|null} 校验结果
   */
  checkNextStepDependencies(stepIndex, result, plan) {
    const nextStep = plan.subtasks[stepIndex + 1];

    // 如果没有下一步，跳过检查
    if (!nextStep) {
      return null;
    }

    const validation = {
      type: 'next_step_dependencies',
      critical: false,  // 非关键校验
      passed: true,
      reason: '',
      missingDependencies: []
    };

    // 提取下一步需要的输入
    const requiredInputs = this.extractRequiredInputs(nextStep);

    // 检查当前结果是否提供了这些输入
    for (const input of requiredInputs) {
      if (!(input in result) || result[input] === null || result[input] === undefined) {
        validation.passed = false;
        validation.missingDependencies.push(input);
      }
    }

    if (!validation.passed) {
      validation.reason = `下一步需要 ${validation.missingDependencies.join(', ')}，但当前步骤未提供`;
    }

    return validation;
  }

  /**
   * 提取步骤需要的输入参数
   * @param {Object} step - 步骤配置
   * @returns {Array} 需要的输入参数列表
   */
  extractRequiredInputs(step) {
    const inputs = [];

    if (!step.params) {
      return inputs;
    }

    // 检查params中的变量引用（如 {{variableName}}）
    const paramStr = JSON.stringify(step.params);
    const variablePattern = /\{\{(\w+)\}\}/g;
    let match;

    while ((match = variablePattern.exec(paramStr)) !== null) {
      inputs.push(match[1]);
    }

    // 添加常见的必需参数
    const commonRequired = {
      'file_writer': ['content', 'path'],
      'deploy_to_cloud': ['filePath', 'platform'],
      'css_generator': ['html'],
      'js_generator': ['html']
    };

    if (commonRequired[step.tool]) {
      inputs.push(...commonRequired[step.tool]);
    }

    // 去重
    return [...new Set(inputs)];
  }

  /**
   * 检查数据类型
   * @param {Object} result - 结果
   * @param {Object} step - 步骤配置
   * @returns {Object} 校验结果
   */
  checkDataTypes(result, step) {
    const validation = {
      type: 'data_types',
      critical: false,
      passed: true,
      reason: '',
      typeErrors: []
    };

    // 类型期望配置
    const typeExpectations = {
      'html_generator': { html: 'string', title: 'string' },
      'css_generator': { css: 'string' },
      'file_writer': { path: 'string', success: 'boolean' },
      'data_analyzer': { analysis: 'object', statistics: 'object' }
    };

    const expected = typeExpectations[step.tool];

    if (!expected) {
      return validation;  // 无类型期望，跳过检查
    }

    for (const [key, expectedType] of Object.entries(expected)) {
      if (key in result) {
        const actualType = typeof result[key];

        if (actualType !== expectedType) {
          validation.passed = false;
          validation.typeErrors.push({
            key,
            expected: expectedType,
            actual: actualType
          });
        }
      }
    }

    if (!validation.passed) {
      validation.reason = `数据类型不匹配: ${JSON.stringify(validation.typeErrors)}`;
    }

    return validation;
  }

  /**
   * 判断是否需要LLM质量检查
   * @param {Object} step - 步骤配置
   * @returns {boolean}
   */
  isQualityCheckRequired(step) {
    // 步骤配置中明确要求
    if (step.quality_check_required === true) {
      return true;
    }

    // 步骤配置中明确不要求
    if (step.quality_check_required === false) {
      return false;
    }

    // 根据工具类型判断
    return this.qualityCheckRequired.has(step.tool);
  }

  /**
   * LLM质量检查
   * @param {Object} result - 结果
   * @param {Object} step - 步骤配置
   * @returns {Object} 校验结果
   */
  async llmQualityCheck(result, step) {
    const validation = {
      type: 'llm_quality',
      critical: false,
      passed: true,
      reason: '',
      score: 0
    };

    try {
      const prompt = `
评估以下步骤的输出质量（0-1分）:

步骤: ${step.title || step.tool}
预期: ${step.description || '完成任务'}

实际输出:
${this.formatResultForDisplay(result)}

评分标准:
- 0.9-1.0: 完全符合预期，质量优秀
- 0.7-0.9: 基本符合预期，有小瑕疵
- 0.5-0.7: 部分符合预期，需修正
- 0.0-0.5: 不符合预期，失败

输出格式（严格JSON，无其他文本）:
{
  "score": 0.85,
  "reason": "质量评估理由"
}
`;

      const llmResult = await this.llmService.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      });

      const parsed = this.parseJSON(llmResult.content || llmResult);

      if (parsed && typeof parsed.score === 'number') {
        validation.score = parsed.score;
        validation.passed = parsed.score >= this.config.qualityThreshold;
        validation.reason = parsed.reason || `质量评分: ${parsed.score}`;
      } else {
        validation.passed = true;  // LLM检查失败时默认通过
        validation.reason = 'LLM质量评估失败，跳过检查';
      }

    } catch (error) {
      console.error('LLM质量检查失败:', error);
      validation.passed = true;  // 检查失败时默认通过
      validation.reason = `LLM质量评估异常: ${error.message}`;
    }

    return validation;
  }

  /**
   * 格式化结果用于展示
   * @param {Object} result - 结果对象
   * @returns {string} 格式化后的字符串
   */
  formatResultForDisplay(result) {
    // 截断过长的内容
    const formatted = JSON.stringify(result, (key, value) => {
      if (typeof value === 'string' && value.length > 500) {
        return value.substring(0, 500) + '... [truncated]';
      }
      return value;
    }, 2);

    return formatted;
  }

  /**
   * 获取推荐动作
   * @param {Array} validations - 所有校验结果
   * @param {boolean} allPassed - 是否全部通过
   * @returns {string} 推荐动作
   */
  getRecommendation(validations, allPassed) {
    if (allPassed) {
      return 'continue';  // 继续执行
    }

    // 检查关键校验是否失败
    const criticalFailures = validations.filter(v => !v.passed && v.critical);

    if (criticalFailures.length > 0) {
      return 'retry';  // 建议重试
    }

    // 只有非关键校验失败
    return 'continue_with_warning';  // 继续，但警告用户
  }

  /**
   * 保存校验历史
   * @param {Object} summary - 校验摘要
   * @returns {void}
   */
  async saveValidationHistory(summary) {
    if (!this.database) {
      return;
    }

    try {
      await this.database.run(`
        INSERT INTO checkpoint_validations (
          step_index,
          step_title,
          passed,
          failed_count,
          critical_failures,
          validations,
          recommendation,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        summary.stepIndex,
        summary.stepTitle,
        summary.passed ? 1 : 0,
        summary.failedCount,
        summary.criticalFailures,
        JSON.stringify(summary.validations),
        summary.recommendation,
        Date.now()
      ]);

    } catch (error) {
      console.error('保存校验历史失败:', error);
    }
  }

  /**
   * 获取校验统计
   * @param {number} days - 统计天数
   * @returns {Object} 统计信息
   */
  async getValidationStats(days = 7) {
    if (!this.database) {
      return null;
    }

    try {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

      const stats = await this.database.get(`
        SELECT
          COUNT(*) as total_validations,
          SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed_count,
          SUM(failed_count) as total_failures,
          SUM(critical_failures) as total_critical_failures,
          AVG(failed_count) as avg_failures_per_validation
        FROM checkpoint_validations
        WHERE created_at > ?
      `, [cutoff]);

      return {
        totalValidations: stats.total_validations,
        passedCount: stats.passed_count,
        passRate: stats.total_validations > 0
          ? (stats.passed_count / stats.total_validations * 100).toFixed(2) + '%'
          : 'N/A',
        totalFailures: stats.total_failures,
        totalCriticalFailures: stats.total_critical_failures,
        avgFailuresPerValidation: parseFloat(stats.avg_failures_per_validation || 0).toFixed(2)
      };

    } catch (error) {
      console.error('获取校验统计失败:', error);
      return null;
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

module.exports = CheckpointValidator;
