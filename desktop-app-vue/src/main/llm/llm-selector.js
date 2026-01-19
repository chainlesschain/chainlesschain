const { logger, createLogger } = require('../utils/logger.js');

/**
 * LLM 智能选择器
 * 根据任务特点、策略和可用性自动选择最优LLM服务
 */

/**
 * LLM提供商特性配置
 */
const LLM_CHARACTERISTICS = {
  ollama: {
    name: 'Ollama（本地）',
    cost: 0, // 免费本地
    speed: 70, // 中等速度（依赖硬件）
    quality: 75, // 中上质量
    contextLength: 4096,
    capabilities: ['chat', 'completion', 'embedding'],
    suitable: ['quick', 'offline', 'privacy'], // 适合快速查询、离线使用、隐私场景
    requiresInternet: false,
  },

  volcengine: {
    name: '火山引擎（豆包）',
    cost: 30, // 低成本
    speed: 90, // 高速
    quality: 85, // 高质量
    contextLength: 8192,
    capabilities: ['chat', 'completion', 'function-calling'],
    suitable: ['general', 'fast', 'chinese'], // 适合通用、快速响应、中文任务
    requiresInternet: true,
  },

  openai: {
    name: 'OpenAI',
    cost: 80, // 较高成本
    speed: 85, // 高速
    quality: 95, // 最高质量
    contextLength: 16384,
    capabilities: ['chat', 'completion', 'function-calling', 'vision'],
    suitable: ['complex', 'quality', 'english'], // 适合复杂任务、高质量要求、英文
    requiresInternet: true,
  },

  deepseek: {
    name: 'DeepSeek',
    cost: 20, // 低成本
    speed: 80, // 较快
    quality: 85, // 高质量
    contextLength: 32768,
    capabilities: ['chat', 'completion', 'code'],
    suitable: ['code', 'long-context', 'analysis'], // 适合代码、长上下文、分析任务
    requiresInternet: true,
  },

  dashscope: {
    name: '阿里通义千问',
    cost: 40, // 中等成本
    speed: 85, // 较快
    quality: 88, // 高质量
    contextLength: 8192,
    capabilities: ['chat', 'completion', 'multimodal'],
    suitable: ['general', 'chinese', 'multimodal'], // 适合通用、中文、多模态
    requiresInternet: true,
  },

  zhipu: {
    name: '智谱AI',
    cost: 35, // 中低成本
    speed: 82, // 较快
    quality: 86, // 高质量
    contextLength: 8192,
    capabilities: ['chat', 'completion', 'code'],
    suitable: ['general', 'code', 'chinese'], // 适合通用、代码、中文
    requiresInternet: true,
  },
};

/**
 * 任务类型特征
 */
const TASK_TYPES = {
  quick: { name: '快速查询', prioritize: ['speed', 'cost'] },
  complex: { name: '复杂推理', prioritize: ['quality', 'contextLength'] },
  code: { name: '代码生成', prioritize: ['quality', 'capabilities'] },
  translation: { name: '翻译', prioritize: ['quality', 'speed'] },
  summary: { name: '摘要', prioritize: ['speed', 'cost'] },
  analysis: { name: '深度分析', prioritize: ['quality', 'contextLength'] },
  chat: { name: '日常对话', prioritize: ['speed', 'cost'] },
  creative: { name: '创意生成', prioritize: ['quality'] },
};

/**
 * LLM选择器类
 */
class LLMSelector {
  constructor(database) {
    this.database = database;
    this.healthStatus = new Map(); // 记录各LLM的健康状态
    this.lastCheck = new Map(); // 上次健康检查时间
    this.checkInterval = 60000; // 健康检查间隔（1分钟）
  }

  /**
   * 从数据库加载配置
   */
  loadConfig() {
    return {
      provider: this.database.getSetting('llm.provider') || 'volcengine',
      priority: this.database.getSetting('llm.priority') || ['volcengine', 'ollama', 'deepseek'],
      autoFallback: this.database.getSetting('llm.autoFallback') !== false,
      autoSelect: this.database.getSetting('llm.autoSelect') !== false,
      selectionStrategy: this.database.getSetting('llm.selectionStrategy') || 'balanced',
    };
  }

  /**
   * 获取LLM提供商配置
   */
  getProviderConfig(provider) {
    const config = {};

    switch (provider) {
      case 'ollama':
        config.host = this.database.getSetting('llm.ollamaHost');
        config.model = this.database.getSetting('llm.ollamaModel');
        break;

      case 'openai':
        config.apiKey = this.database.getSetting('llm.openaiApiKey');
        config.baseUrl = this.database.getSetting('llm.openaiBaseUrl');
        config.model = this.database.getSetting('llm.openaiModel');
        break;

      case 'volcengine':
        config.apiKey = this.database.getSetting('llm.volcengineApiKey');
        config.model = this.database.getSetting('llm.volcengineModel');
        break;

      case 'deepseek':
        config.apiKey = this.database.getSetting('llm.deepseekApiKey');
        config.model = this.database.getSetting('llm.deepseekModel');
        break;

      case 'dashscope':
        config.apiKey = this.database.getSetting('llm.dashscopeApiKey');
        config.model = this.database.getSetting('llm.dashscopeModel');
        break;

      case 'zhipu':
        config.apiKey = this.database.getSetting('llm.zhipuApiKey');
        config.model = this.database.getSetting('llm.zhipuModel');
        break;
    }

    return config;
  }

  /**
   * 检查LLM是否配置完整
   */
  isProviderConfigured(provider) {
    const config = this.getProviderConfig(provider);
    const chars = LLM_CHARACTERISTICS[provider];

    if (!chars) {return false;}

    // 本地服务（Ollama）只需要host
    if (provider === 'ollama') {
      return !!config.host;
    }

    // 云服务需要API Key
    return !!config.apiKey && config.apiKey.length > 0;
  }

  /**
   * 计算LLM得分
   * @param {string} provider - LLM提供商
   * @param {string} strategy - 选择策略
   * @param {string} taskType - 任务类型
   * @returns {number} 得分（0-100）
   */
  calculateScore(provider, strategy, taskType = 'chat') {
    const chars = LLM_CHARACTERISTICS[provider];
    if (!chars) {return 0;}

    // 检查是否配置
    if (!this.isProviderConfigured(provider)) {
      return 0;
    }

    // 检查健康状态
    const health = this.healthStatus.get(provider);
    if (health === false) {
      return 0; // 不可用
    }

    let score = 0;

    // 根据策略计算得分
    switch (strategy) {
      case 'cost': // 成本优先
        score = (100 - chars.cost) * 0.7 + chars.quality * 0.2 + chars.speed * 0.1;
        break;

      case 'speed': // 速度优先
        score = chars.speed * 0.7 + chars.quality * 0.2 + (100 - chars.cost) * 0.1;
        break;

      case 'quality': // 质量优先
        score = chars.quality * 0.7 + chars.speed * 0.2 + (100 - chars.cost) * 0.1;
        break;

      case 'balanced': // 平衡
      default:
        score = chars.quality * 0.4 + chars.speed * 0.3 + (100 - chars.cost) * 0.3;
        break;
    }

    // 根据任务类型调整得分
    const task = TASK_TYPES[taskType];
    if (task && chars.suitable) {
      // 检查是否适合该任务
      const taskMatch = chars.suitable.some(s =>
        task.name.toLowerCase().includes(s) || taskType === s
      );
      if (taskMatch) {
        score *= 1.2; // 提升20%
      }
    }

    // 本地服务（不需要网络）加分
    if (!chars.requiresInternet) {
      score *= 1.1;
    }

    return Math.min(100, score);
  }

  /**
   * 智能选择最优LLM
   * @param {Object} options - 选择选项
   * @returns {string} 选择的LLM提供商
   */
  selectBestLLM(options = {}) {
    const config = this.loadConfig();
    const {
      taskType = 'chat',
      strategy = config.selectionStrategy,
      excludes = [],
    } = options;

    // 如果禁用了自动选择，返回当前提供商
    if (!config.autoSelect) {
      return config.provider;
    }

    // 获取优先级列表
    const priorityList = config.priority || ['volcengine', 'ollama', 'deepseek'];

    // 计算每个LLM的得分
    const scores = [];
    for (const provider of priorityList) {
      if (excludes.includes(provider)) {continue;}

      const score = this.calculateScore(provider, strategy, taskType);
      if (score > 0) {
        scores.push({ provider, score });
      }
    }

    // 按得分排序
    scores.sort((a, b) => b.score - a.score);

    // 返回得分最高的
    if (scores.length > 0) {
      logger.info(`[LLMSelector] 智能选择: ${scores[0].provider} (得分: ${scores[0].score.toFixed(2)})`);
      return scores[0].provider;
    }

    // 如果都不可用，返回第一个优先级
    logger.warn('[LLMSelector] 没有可用的LLM，返回默认');
    return priorityList[0] || 'volcengine';
  }

  /**
   * 获取备用LLM列表（按优先级）
   * @param {string} currentProvider - 当前提供商
   * @returns {Array} 备用提供商列表
   */
  getFallbackList(currentProvider) {
    const config = this.loadConfig();
    const priorityList = config.priority || ['volcengine', 'ollama', 'deepseek'];

    // 排除当前提供商
    return priorityList.filter(p => p !== currentProvider && this.isProviderConfigured(p));
  }

  /**
   * 选择下一个可用的LLM（fallback机制）
   * @param {string} currentProvider - 当前失败的提供商
   * @param {Array} triedProviders - 已尝试的提供商列表
   * @returns {string|null} 下一个提供商，如果没有则返回null
   */
  selectFallback(currentProvider, triedProviders = []) {
    const config = this.loadConfig();

    if (!config.autoFallback) {
      return null;
    }

    const fallbackList = this.getFallbackList(currentProvider);

    for (const provider of fallbackList) {
      if (!triedProviders.includes(provider)) {
        logger.info(`[LLMSelector] Fallback到: ${provider}`);
        return provider;
      }
    }

    return null;
  }

  /**
   * 更新LLM健康状态
   * @param {string} provider - 提供商
   * @param {boolean} healthy - 是否健康
   */
  updateHealth(provider, healthy) {
    this.healthStatus.set(provider, healthy);
    this.lastCheck.set(provider, Date.now());
  }

  /**
   * 检查是否需要健康检查
   * @param {string} provider - 提供商
   * @returns {boolean}
   */
  needsHealthCheck(provider) {
    const lastCheck = this.lastCheck.get(provider);
    if (!lastCheck) {return true;}

    return Date.now() - lastCheck > this.checkInterval;
  }

  /**
   * 获取所有LLM的特性信息
   * @returns {Object}
   */
  getAllCharacteristics() {
    return { ...LLM_CHARACTERISTICS };
  }

  /**
   * 获取任务类型列表
   * @returns {Object}
   */
  getTaskTypes() {
    return { ...TASK_TYPES };
  }

  /**
   * 生成选择报告
   * @param {string} taskType - 任务类型
   * @returns {Array} 排序后的LLM列表及得分
   */
  generateSelectionReport(taskType = 'chat') {
    const config = this.loadConfig();
    const strategy = config.selectionStrategy;
    const priorityList = config.priority || ['volcengine', 'ollama', 'deepseek'];

    const report = [];
    for (const provider of priorityList) {
      const chars = LLM_CHARACTERISTICS[provider];
      if (!chars) {continue;}

      const score = this.calculateScore(provider, strategy, taskType);
      const configured = this.isProviderConfigured(provider);
      const healthy = this.healthStatus.get(provider) !== false;

      report.push({
        provider,
        name: chars.name,
        score,
        configured,
        healthy,
        characteristics: {
          cost: chars.cost,
          speed: chars.speed,
          quality: chars.quality,
          contextLength: chars.contextLength,
        },
      });
    }

    report.sort((a, b) => b.score - a.score);
    return report;
  }
}

module.exports = LLMSelector;
