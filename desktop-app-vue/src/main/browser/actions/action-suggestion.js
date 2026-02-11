/**
 * ActionSuggestion - AI 驱动的操作建议引擎
 *
 * 基于上下文智能推荐下一步操作：
 * - 历史操作模式学习
 * - 页面内容分析
 * - 目标意图推断
 * - 常见工作流识别
 *
 * @module browser/actions/action-suggestion
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');

/**
 * 建议类型
 */
const SuggestionType = {
  CLICK: 'click',
  TYPE: 'type',
  SELECT: 'select',
  SCROLL: 'scroll',
  NAVIGATE: 'navigate',
  WAIT: 'wait',
  SUBMIT: 'submit',
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
  UPLOAD: 'upload',
  DOWNLOAD: 'download'
};

/**
 * 建议优先级
 */
const SuggestionPriority = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

/**
 * 常见工作流模式
 */
const COMMON_PATTERNS = [
  {
    name: 'login',
    description: '登录流程',
    triggers: ['login', 'signin', '登录', '用户名', 'username'],
    sequence: [
      { type: SuggestionType.TYPE, target: 'username', priority: SuggestionPriority.HIGH },
      { type: SuggestionType.TYPE, target: 'password', priority: SuggestionPriority.HIGH },
      { type: SuggestionType.CLICK, target: 'submit', priority: SuggestionPriority.HIGH }
    ]
  },
  {
    name: 'search',
    description: '搜索流程',
    triggers: ['search', '搜索', 'query', '查询'],
    sequence: [
      { type: SuggestionType.TYPE, target: 'search-input', priority: SuggestionPriority.HIGH },
      { type: SuggestionType.CLICK, target: 'search-button', priority: SuggestionPriority.MEDIUM }
    ]
  },
  {
    name: 'form-fill',
    description: '表单填写',
    triggers: ['form', 'input', '表单', '填写'],
    sequence: [
      { type: SuggestionType.TYPE, target: 'form-field', priority: SuggestionPriority.MEDIUM },
      { type: SuggestionType.SUBMIT, target: 'form', priority: SuggestionPriority.HIGH }
    ]
  },
  {
    name: 'checkout',
    description: '结账流程',
    triggers: ['checkout', 'cart', 'payment', '结账', '购物车', '支付'],
    sequence: [
      { type: SuggestionType.CLICK, target: 'proceed', priority: SuggestionPriority.HIGH },
      { type: SuggestionType.TYPE, target: 'shipping', priority: SuggestionPriority.MEDIUM },
      { type: SuggestionType.CONFIRM, target: 'order', priority: SuggestionPriority.HIGH }
    ]
  },
  {
    name: 'pagination',
    description: '翻页操作',
    triggers: ['page', 'next', 'previous', '下一页', '上一页'],
    sequence: [
      { type: SuggestionType.CLICK, target: 'next-page', priority: SuggestionPriority.MEDIUM },
      { type: SuggestionType.SCROLL, target: 'top', priority: SuggestionPriority.LOW }
    ]
  }
];

class ActionSuggestion extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      maxSuggestions: config.maxSuggestions || 5,
      enablePatternLearning: config.enablePatternLearning !== false,
      confidenceThreshold: config.confidenceThreshold || 0.5,
      historySize: config.historySize || 100,
      ...config
    };

    // 操作历史
    this.history = [];

    // 学习的模式
    this.learnedPatterns = new Map();

    // 当前上下文
    this.currentContext = null;

    // 统计
    this.stats = {
      totalSuggestions: 0,
      accepted: 0,
      rejected: 0,
      byType: {}
    };
  }

  /**
   * 获取操作建议
   * @param {Object} context - 当前上下文
   * @returns {Promise<Object>}
   */
  async suggest(context) {
    this.currentContext = context;
    const suggestions = [];

    try {
      // 1. 基于页面内容的建议
      const contentSuggestions = await this._analyzeContent(context);
      suggestions.push(...contentSuggestions);

      // 2. 基于历史模式的建议
      const historySuggestions = this._analyzeHistory(context);
      suggestions.push(...historySuggestions);

      // 3. 基于常见工作流的建议
      const patternSuggestions = this._matchPatterns(context);
      suggestions.push(...patternSuggestions);

      // 4. 基于学习模式的建议
      if (this.config.enablePatternLearning) {
        const learnedSuggestions = this._applyLearnedPatterns(context);
        suggestions.push(...learnedSuggestions);
      }

      // 去重和排序
      const uniqueSuggestions = this._deduplicateAndSort(suggestions);

      // 限制数量
      const topSuggestions = uniqueSuggestions.slice(0, this.config.maxSuggestions);

      this.stats.totalSuggestions += topSuggestions.length;

      this.emit('suggested', {
        context,
        suggestions: topSuggestions
      });

      return {
        success: true,
        suggestions: topSuggestions,
        context: {
          url: context.url,
          title: context.title
        }
      };

    } catch (error) {
      this.emit('error', { error: error.message });
      return {
        success: false,
        error: error.message,
        suggestions: []
      };
    }
  }

  /**
   * 分析页面内容
   * @private
   */
  async _analyzeContent(context) {
    const suggestions = [];
    const { elements, forms, buttons, inputs } = context;

    // 分析表单
    if (forms && forms.length > 0) {
      for (const form of forms) {
        if (form.hasEmptyFields) {
          suggestions.push({
            type: SuggestionType.TYPE,
            target: form.firstEmptyField,
            description: `填写 ${form.firstEmptyField.label || '表单字段'}`,
            priority: SuggestionPriority.HIGH,
            confidence: 0.9,
            source: 'content-analysis'
          });
        }

        if (form.canSubmit) {
          suggestions.push({
            type: SuggestionType.SUBMIT,
            target: form.submitButton,
            description: '提交表单',
            priority: SuggestionPriority.MEDIUM,
            confidence: 0.8,
            source: 'content-analysis'
          });
        }
      }
    }

    // 分析按钮
    if (buttons && buttons.length > 0) {
      for (const button of buttons) {
        const text = (button.text || '').toLowerCase();
        const priority = this._inferButtonPriority(text);

        suggestions.push({
          type: SuggestionType.CLICK,
          target: button,
          description: `点击 "${button.text || '按钮'}"`,
          priority,
          confidence: this._calculateButtonConfidence(button),
          source: 'content-analysis'
        });
      }
    }

    // 分析输入框
    if (inputs && inputs.length > 0) {
      const emptyInputs = inputs.filter(i => !i.value);
      if (emptyInputs.length > 0) {
        const firstEmpty = emptyInputs[0];
        suggestions.push({
          type: SuggestionType.TYPE,
          target: firstEmpty,
          description: `在 ${firstEmpty.label || firstEmpty.placeholder || '输入框'} 中输入`,
          priority: SuggestionPriority.HIGH,
          confidence: 0.85,
          source: 'content-analysis'
        });
      }
    }

    return suggestions;
  }

  /**
   * 分析历史操作
   * @private
   */
  _analyzeHistory(context) {
    const suggestions = [];

    if (this.history.length < 2) {
      return suggestions;
    }

    // 查找类似上下文的历史操作
    const similarContexts = this.history.filter(h =>
      this._contextSimilarity(h.context, context) > 0.7
    );

    if (similarContexts.length > 0) {
      // 找出后续操作
      for (const similar of similarContexts.slice(-5)) {
        const idx = this.history.indexOf(similar);
        if (idx >= 0 && idx < this.history.length - 1) {
          const nextAction = this.history[idx + 1];
          suggestions.push({
            type: nextAction.type,
            target: nextAction.target,
            description: `基于历史: ${nextAction.description || nextAction.type}`,
            priority: SuggestionPriority.MEDIUM,
            confidence: 0.7,
            source: 'history'
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * 匹配常见模式
   * @private
   */
  _matchPatterns(context) {
    const suggestions = [];
    const pageContent = (context.content || context.url || '').toLowerCase();

    for (const pattern of COMMON_PATTERNS) {
      const matchScore = pattern.triggers.reduce((score, trigger) => {
        return pageContent.includes(trigger.toLowerCase()) ? score + 1 : score;
      }, 0) / pattern.triggers.length;

      if (matchScore > 0.3) {
        // 确定当前在模式的哪个阶段
        const stageIndex = this._determinePatternStage(pattern, context);

        if (stageIndex < pattern.sequence.length) {
          const nextStep = pattern.sequence[stageIndex];
          suggestions.push({
            type: nextStep.type,
            target: nextStep.target,
            description: `${pattern.description}: ${nextStep.type}`,
            priority: nextStep.priority,
            confidence: matchScore,
            source: 'pattern',
            pattern: pattern.name
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * 应用学习的模式
   * @private
   */
  _applyLearnedPatterns(context) {
    const suggestions = [];
    const contextKey = this._contextKey(context);

    for (const [key, pattern] of this.learnedPatterns) {
      if (this._keysSimilar(key, contextKey)) {
        suggestions.push({
          type: pattern.type,
          target: pattern.target,
          description: `学习模式: ${pattern.description || pattern.type}`,
          priority: SuggestionPriority.MEDIUM,
          confidence: pattern.frequency / 10, // 基于频率的置信度
          source: 'learned'
        });
      }
    }

    return suggestions;
  }

  /**
   * 确定模式阶段
   * @private
   */
  _determinePatternStage(pattern, context) {
    const recentHistory = this.history.slice(-pattern.sequence.length);

    for (let i = 0; i < pattern.sequence.length; i++) {
      const step = pattern.sequence[i];
      const completed = recentHistory.some(h =>
        h.type === step.type && this._targetMatch(h.target, step.target)
      );

      if (!completed) {
        return i;
      }
    }

    return pattern.sequence.length;
  }

  /**
   * 去重和排序
   * @private
   */
  _deduplicateAndSort(suggestions) {
    // 去重
    const seen = new Set();
    const unique = suggestions.filter(s => {
      const key = `${s.type}_${JSON.stringify(s.target)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 按优先级和置信度排序
    return unique.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return (b.confidence || 0) - (a.confidence || 0);
    });
  }

  /**
   * 计算上下文相似度
   * @private
   */
  _contextSimilarity(ctx1, ctx2) {
    if (!ctx1 || !ctx2) return 0;

    let score = 0;
    let count = 0;

    if (ctx1.url && ctx2.url) {
      score += this._urlSimilarity(ctx1.url, ctx2.url);
      count++;
    }

    if (ctx1.title && ctx2.title) {
      score += this._stringSimilarity(ctx1.title, ctx2.title);
      count++;
    }

    return count > 0 ? score / count : 0;
  }

  /**
   * URL 相似度
   * @private
   */
  _urlSimilarity(url1, url2) {
    try {
      const u1 = new URL(url1);
      const u2 = new URL(url2);

      if (u1.hostname !== u2.hostname) return 0;
      if (u1.pathname === u2.pathname) return 1;

      const path1 = u1.pathname.split('/').filter(Boolean);
      const path2 = u2.pathname.split('/').filter(Boolean);

      const common = path1.filter((p, i) => path2[i] === p).length;
      return common / Math.max(path1.length, path2.length, 1);
    } catch {
      return 0;
    }
  }

  /**
   * 字符串相似度
   * @private
   */
  _stringSimilarity(str1, str2) {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    if (s1 === s2) return 1;

    const words1 = new Set(s1.split(/\s+/));
    const words2 = new Set(s2.split(/\s+/));

    const intersection = [...words1].filter(w => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;

    return intersection / union;
  }

  /**
   * 生成上下文键
   * @private
   */
  _contextKey(context) {
    const url = context.url || '';
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname}`;
    } catch {
      return url;
    }
  }

  /**
   * 检查键相似性
   * @private
   */
  _keysSimilar(key1, key2) {
    return key1 === key2 || key1.includes(key2) || key2.includes(key1);
  }

  /**
   * 目标匹配
   * @private
   */
  _targetMatch(target1, target2) {
    if (typeof target1 === 'string' && typeof target2 === 'string') {
      return target1.includes(target2) || target2.includes(target1);
    }
    return false;
  }

  /**
   * 推断按钮优先级
   * @private
   */
  _inferButtonPriority(text) {
    const highPriority = ['submit', 'confirm', 'save', 'next', '确认', '提交', '保存', '下一步'];
    const lowPriority = ['cancel', 'close', 'back', '取消', '关闭', '返回'];

    if (highPriority.some(t => text.includes(t))) {
      return SuggestionPriority.HIGH;
    }
    if (lowPriority.some(t => text.includes(t))) {
      return SuggestionPriority.LOW;
    }
    return SuggestionPriority.MEDIUM;
  }

  /**
   * 计算按钮置信度
   * @private
   */
  _calculateButtonConfidence(button) {
    let confidence = 0.5;

    // 主要按钮更高置信度
    if (button.isPrimary || button.className?.includes('primary')) {
      confidence += 0.2;
    }

    // 有明确文本更高置信度
    if (button.text && button.text.length > 0) {
      confidence += 0.1;
    }

    // 可见区域内更高置信度
    if (button.visible) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1);
  }

  /**
   * 记录操作
   * @param {Object} action - 执行的操作
   */
  recordAction(action) {
    this.history.push({
      ...action,
      context: this.currentContext,
      timestamp: Date.now()
    });

    // 限制历史大小
    if (this.history.length > this.config.historySize) {
      this.history = this.history.slice(-this.config.historySize / 2);
    }

    // 学习模式
    if (this.config.enablePatternLearning) {
      this._learnPattern(action);
    }

    this.emit('actionRecorded', action);
  }

  /**
   * 学习模式
   * @private
   */
  _learnPattern(action) {
    if (!this.currentContext) return;

    const key = this._contextKey(this.currentContext);
    const existing = this.learnedPatterns.get(key);

    if (existing) {
      existing.frequency++;
      existing.lastSeen = Date.now();
    } else {
      this.learnedPatterns.set(key, {
        type: action.type,
        target: action.target,
        description: action.description,
        frequency: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now()
      });
    }
  }

  /**
   * 反馈建议结果
   * @param {Object} suggestion - 建议
   * @param {boolean} accepted - 是否接受
   */
  feedback(suggestion, accepted) {
    if (accepted) {
      this.stats.accepted++;
    } else {
      this.stats.rejected++;
    }

    if (!this.stats.byType[suggestion.type]) {
      this.stats.byType[suggestion.type] = { accepted: 0, rejected: 0 };
    }

    if (accepted) {
      this.stats.byType[suggestion.type].accepted++;
    } else {
      this.stats.byType[suggestion.type].rejected++;
    }

    this.emit('feedback', { suggestion, accepted });
  }

  /**
   * 获取历史
   * @param {number} limit - 返回数量
   * @returns {Array}
   */
  getHistory(limit = 20) {
    return this.history.slice(-limit).reverse();
  }

  /**
   * 获取统计
   * @returns {Object}
   */
  getStats() {
    const total = this.stats.accepted + this.stats.rejected;
    return {
      ...this.stats,
      acceptanceRate: total > 0
        ? ((this.stats.accepted / total) * 100).toFixed(2) + '%'
        : '0%',
      learnedPatterns: this.learnedPatterns.size
    };
  }

  /**
   * 清除历史
   */
  clearHistory() {
    this.history = [];
    this.emit('historyCleared');
  }

  /**
   * 清除学习模式
   */
  clearLearnedPatterns() {
    this.learnedPatterns.clear();
    this.emit('patternsCleared');
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalSuggestions: 0,
      accepted: 0,
      rejected: 0,
      byType: {}
    };
    this.emit('reset');
  }

  /**
   * 导出数据
   * @returns {Object}
   */
  export() {
    return {
      history: this.history,
      learnedPatterns: Array.from(this.learnedPatterns.entries()),
      stats: this.stats,
      exportedAt: Date.now()
    };
  }

  /**
   * 导入数据
   * @param {Object} data - 导入数据
   * @returns {Object}
   */
  import(data) {
    if (data.history) {
      this.history = data.history;
    }

    if (data.learnedPatterns) {
      for (const [key, value] of data.learnedPatterns) {
        this.learnedPatterns.set(key, value);
      }
    }

    if (data.stats) {
      this.stats = { ...this.stats, ...data.stats };
    }

    return { success: true };
  }
}

// 单例
let suggestionInstance = null;

function getActionSuggestion(config) {
  if (!suggestionInstance) {
    suggestionInstance = new ActionSuggestion(config);
  }
  return suggestionInstance;
}

module.exports = {
  ActionSuggestion,
  SuggestionType,
  SuggestionPriority,
  getActionSuggestion
};
