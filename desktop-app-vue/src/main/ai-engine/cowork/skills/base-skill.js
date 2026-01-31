/**
 * BaseSkill - 技能基类
 *
 * 所有专业化技能的基类，定义标准接口和通用功能。
 *
 * @module ai-engine/cowork/skills/base-skill
 */

const { logger } = require('../../../utils/logger.js');
const EventEmitter = require('events');

/**
 * BaseSkill 抽象类
 */
class BaseSkill extends EventEmitter {
  constructor(options = {}) {
    super();

    this.skillId = options.skillId || this.constructor.name;
    this.name = options.name || 'Unnamed Skill';
    this.description = options.description || '';
    this.version = options.version || '1.0.0';
    this.category = options.category || 'general';

    // 技能能力标签
    this.capabilities = options.capabilities || [];

    // 支持的文件类型
    this.supportedFileTypes = options.supportedFileTypes || [];

    // 配置
    this.config = {
      enabled: true,
      ...options.config,
    };

    // 性能指标
    this.metrics = {
      invocations: 0,
      successes: 0,
      failures: 0,
      totalExecutionTime: 0,
      avgExecutionTime: 0,
    };
  }

  /**
   * 检查是否可以处理任务
   * @param {Object} task - 任务对象
   * @returns {number} 匹配分数 (0-100)
   */
  canHandle(task) {
    if (!this.config.enabled) {
      return 0;
    }

    let score = 0;

    // 基于任务类型匹配
    if (task.type && this.capabilities.includes(task.type)) {
      score += 50;
    }

    // 基于文件类型匹配
    if (task.fileType && this.supportedFileTypes.includes(task.fileType)) {
      score += 30;
    }

    // 基于关键词匹配
    if (task.description) {
      const keywords = this._extractKeywords(task.description);
      const matchedKeywords = keywords.filter(k => this.capabilities.includes(k));
      score += matchedKeywords.length * 5;
    }

    return Math.min(100, score);
  }

  /**
   * 执行技能（子类必须实现）
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果
   */
  async execute(task, context = {}) {
    throw new Error('execute() method must be implemented by subclass');
  }

  /**
   * 执行技能（带性能跟踪）
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果
   */
  async executeWithMetrics(task, context = {}) {
    const startTime = Date.now();
    this.metrics.invocations++;

    try {
      this._log(`开始执行技能: ${this.name}`);
      this.emit('skill-started', { skill: this.skillId, task });

      const result = await this.execute(task, context);

      const executionTime = Date.now() - startTime;
      this.metrics.successes++;
      this.metrics.totalExecutionTime += executionTime;
      this.metrics.avgExecutionTime =
        this.metrics.totalExecutionTime / this.metrics.invocations;

      this._log(`技能执行成功: ${this.name}, 耗时: ${executionTime}ms`);
      this.emit('skill-completed', {
        skill: this.skillId,
        task,
        result,
        executionTime,
      });

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metrics.failures++;

      this._log(`技能执行失败: ${this.name}, 错误: ${error.message}`, 'error');
      this.emit('skill-failed', {
        skill: this.skillId,
        task,
        error,
        executionTime,
      });

      throw error;
    }
  }

  /**
   * 验证输入
   * @param {Object} input - 输入数据
   * @param {Object} schema - 验证模式
   * @returns {Object} { valid: boolean, errors?: Array }
   */
  validateInput(input, schema) {
    const errors = [];

    for (const [key, rules] of Object.entries(schema)) {
      const value = input[key];

      if (rules.required && (value === undefined || value === null)) {
        errors.push(`${key} is required`);
        continue;
      }

      if (value !== undefined && value !== null) {
        if (rules.type && typeof value !== rules.type) {
          errors.push(`${key} must be of type ${rules.type}`);
        }

        if (rules.minLength && value.length < rules.minLength) {
          errors.push(`${key} must have at least ${rules.minLength} characters`);
        }

        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push(`${key} must have at most ${rules.maxLength} characters`);
        }

        if (rules.pattern && !rules.pattern.test(value)) {
          errors.push(`${key} does not match required pattern`);
        }

        if (rules.enum && !rules.enum.includes(value)) {
          errors.push(`${key} must be one of: ${rules.enum.join(', ')}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * 提取关键词
   * @private
   */
  _extractKeywords(text) {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3);
  }

  /**
   * 日志输出
   * @protected
   */
  _log(message, level = 'info') {
    const prefix = `[Skill:${this.skillId}]`;

    if (level === 'error') {
      logger.error(`${prefix} ${message}`);
    } else if (level === 'warn') {
      logger.warn(`${prefix} ${message}`);
    } else {
      logger.info(`${prefix} ${message}`);
    }
  }

  /**
   * 获取技能信息
   * @returns {Object}
   */
  getInfo() {
    return {
      skillId: this.skillId,
      name: this.name,
      description: this.description,
      version: this.version,
      category: this.category,
      capabilities: this.capabilities,
      supportedFileTypes: this.supportedFileTypes,
      enabled: this.config.enabled,
      metrics: this.metrics,
    };
  }

  /**
   * 启用/禁用技能
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
    this._log(`技能已${enabled ? '启用' : '禁用'}`);
  }

  /**
   * 重置指标
   */
  resetMetrics() {
    this.metrics = {
      invocations: 0,
      successes: 0,
      failures: 0,
      totalExecutionTime: 0,
      avgExecutionTime: 0,
    };
  }
}

module.exports = { BaseSkill };
