/**
 * 语音命令识别器
 *
 * 智能识别和执行语音命令
 * 支持系统命令、导航命令、AI命令等
 */

const { logger, createLogger } = require('../utils/logger.js');
const { EventEmitter } = require('events');

/**
 * 语音命令识别类
 */
class VoiceCommandRecognizer extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      language: config.language || 'zh',
      confidence: config.minConfidence || 0.7,
      fuzzyMatch: config.fuzzyMatch !== false,
      contextAware: config.contextAware !== false,
      ...config
    };

    // 命令注册表
    this.commands = new Map();

    // 命令别名
    this.aliases = new Map();

    // 上下文栈
    this.contextStack = [];

    // 注册默认命令
    this.registerDefaultCommands();
  }

  /**
   * 注册默认命令
   */
  registerDefaultCommands() {
    // ===== 导航命令 =====
    this.registerCommand({
      name: 'navigate_home',
      patterns: ['打开首页', '返回首页', '回到主页', '首页'],
      action: () => ({ type: 'navigate', target: 'home' }),
      description: '导航到首页'
    });

    this.registerCommand({
      name: 'navigate_projects',
      patterns: ['打开项目', '查看项目', '项目列表', '我的项目'],
      action: () => ({ type: 'navigate', target: 'projects' }),
      description: '打开项目页面'
    });

    this.registerCommand({
      name: 'navigate_notes',
      patterns: ['打开笔记', '查看笔记', '笔记本', '我的笔记'],
      action: () => ({ type: 'navigate', target: 'notes' }),
      description: '打开笔记页面'
    });

    this.registerCommand({
      name: 'navigate_chat',
      patterns: ['打开聊天', '打开对话', 'AI聊天', '智能对话'],
      action: () => ({ type: 'navigate', target: 'chat' }),
      description: '打开AI对话'
    });

    this.registerCommand({
      name: 'navigate_settings',
      patterns: ['打开设置', '系统设置', '偏好设置', '设置'],
      action: () => ({ type: 'navigate', target: 'settings' }),
      description: '打开设置页面'
    });

    // ===== 操作命令 =====
    this.registerCommand({
      name: 'create_note',
      patterns: ['创建笔记', '新建笔记', '写笔记', '记录'],
      action: (params) => ({ type: 'create', resource: 'note', params }),
      description: '创建新笔记'
    });

    this.registerCommand({
      name: 'create_project',
      patterns: ['创建项目', '新建项目', '开始项目'],
      action: (params) => ({ type: 'create', resource: 'project', params }),
      description: '创建新项目'
    });

    this.registerCommand({
      name: 'save',
      patterns: ['保存', '保存文件', '存储', '保存当前内容'],
      action: () => ({ type: 'save' }),
      description: '保存当前内容'
    });

    this.registerCommand({
      name: 'search',
      patterns: ['搜索', '查找', '检索'],
      action: (params) => ({ type: 'search', query: params.query }),
      description: '搜索内容',
      extractParams: (text) => {
        // 提取搜索关键词: "搜索 XXX" -> query: "XXX"
        const match = text.match(/(?:搜索|查找|检索)\s*(.+)/);
        return match ? { query: match[1].trim() } : {};
      }
    });

    // ===== AI命令 =====
    this.registerCommand({
      name: 'summarize',
      patterns: ['总结', '总结这段', '总结一下', '概括', '摘要'],
      action: (params) => ({ type: 'ai', task: 'summarize', params }),
      description: 'AI总结文本'
    });

    this.registerCommand({
      name: 'translate',
      patterns: ['翻译', '翻译成英文', '翻译成中文', '翻译这段'],
      action: (params) => ({
        type: 'ai',
        task: 'translate',
        targetLanguage: params.targetLanguage || 'en'
      }),
      description: 'AI翻译文本',
      extractParams: (text) => {
        let targetLanguage = 'en';
        if (text.includes('英文') || text.includes('英语')) {
          targetLanguage = 'en';
        } else if (text.includes('中文') || text.includes('汉语')) {
          targetLanguage = 'zh';
        } else if (text.includes('日文') || text.includes('日语')) {
          targetLanguage = 'ja';
        }
        return { targetLanguage };
      }
    });

    this.registerCommand({
      name: 'generate_outline',
      patterns: ['生成大纲', '创建大纲', '大纲', '提取大纲'],
      action: () => ({ type: 'ai', task: 'outline' }),
      description: 'AI生成大纲'
    });

    this.registerCommand({
      name: 'explain',
      patterns: ['解释', '说明', '解释一下', '这是什么意思'],
      action: (params) => ({ type: 'ai', task: 'explain', params }),
      description: 'AI解释内容'
    });

    // ===== 系统命令 =====
    this.registerCommand({
      name: 'help',
      patterns: ['帮助', '如何使用', '使用说明', '指南'],
      action: () => ({ type: 'system', task: 'help' }),
      description: '显示帮助信息'
    });

    this.registerCommand({
      name: 'cancel',
      patterns: ['取消', '算了', '不要了', '停止'],
      action: () => ({ type: 'system', task: 'cancel' }),
      description: '取消当前操作'
    });

    this.registerCommand({
      name: 'undo',
      patterns: ['撤销', '撤回', '恢复', '回退'],
      action: () => ({ type: 'system', task: 'undo' }),
      description: '撤销上一步操作'
    });

    this.registerCommand({
      name: 'redo',
      patterns: ['重做', '恢复撤销', '重新执行'],
      action: () => ({ type: 'system', task: 'redo' }),
      description: '重做操作'
    });
  }

  /**
   * 注册命令
   * @param {Object} command - 命令配置
   */
  registerCommand(command) {
    if (!command.name || !command.patterns || !command.action) {
      throw new Error('命令必须包含 name, patterns 和 action');
    }

    this.commands.set(command.name, {
      name: command.name,
      patterns: Array.isArray(command.patterns) ? command.patterns : [command.patterns],
      action: command.action,
      description: command.description || '',
      context: command.context || null,
      extractParams: command.extractParams || null,
      priority: command.priority || 0
    });

    // 注册别名
    command.patterns.forEach(pattern => {
      this.aliases.set(pattern.toLowerCase(), command.name);
    });

    logger.info(`[VoiceCommand] 注册命令: ${command.name}, 模式数: ${command.patterns.length}`);
  }

  /**
   * 识别命令
   * @param {string} text - 语音转文字结果
   * @param {Object} context - 当前上下文
   * @returns {Object|null} 识别结果
   */
  recognize(text, context = {}) {
    if (!text || typeof text !== 'string') {
      return null;
    }

    const normalizedText = text.trim().toLowerCase();

    logger.info(`[VoiceCommand] 识别命令: "${text}"`);

    // 1. 精确匹配
    const exactMatch = this.findExactMatch(normalizedText, context);
    if (exactMatch) {
      logger.info(`[VoiceCommand] 精确匹配: ${exactMatch.name}`);
      return this.buildResult(exactMatch, text, 1.0);
    }

    // 2. 模糊匹配
    if (this.config.fuzzyMatch) {
      const fuzzyMatch = this.findFuzzyMatch(normalizedText, context);
      if (fuzzyMatch && fuzzyMatch.confidence >= this.config.confidence) {
        logger.info(`[VoiceCommand] 模糊匹配: ${fuzzyMatch.command.name} (${fuzzyMatch.confidence.toFixed(2)})`);
        return this.buildResult(fuzzyMatch.command, text, fuzzyMatch.confidence);
      }
    }

    // 3. NLU解析（高级功能）
    if (this.config.useNLU) {
      const nluResult = this.parseWithNLU(text, context);
      if (nluResult) {
        logger.info(`[VoiceCommand] NLU匹配: ${nluResult.intent}`);
        return nluResult;
      }
    }

    logger.info('[VoiceCommand] 未识别到命令');
    return null;
  }

  /**
   * 精确匹配
   */
  findExactMatch(text, context) {
    // 检查别名表
    const commandName = this.aliases.get(text);
    if (commandName) {
      const command = this.commands.get(commandName);
      if (this.isContextMatch(command, context)) {
        return command;
      }
    }

    // 遍历所有命令
    for (const [name, command] of this.commands) {
      if (this.isContextMatch(command, context)) {
        for (const pattern of command.patterns) {
          if (pattern.toLowerCase() === text) {
            return command;
          }
        }
      }
    }

    return null;
  }

  /**
   * 模糊匹配
   */
  findFuzzyMatch(text, context) {
    let bestMatch = null;
    let bestConfidence = 0;

    for (const [name, command] of this.commands) {
      if (!this.isContextMatch(command, context)) {
        continue;
      }

      for (const pattern of command.patterns) {
        const confidence = this.calculateSimilarity(text, pattern.toLowerCase());

        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestMatch = command;
        }
      }
    }

    return bestMatch && bestConfidence >= this.config.confidence
      ? { command: bestMatch, confidence: bestConfidence }
      : null;
  }

  /**
   * 计算相似度
   */
  calculateSimilarity(text1, text2) {
    // 包含匹配
    if (text1.includes(text2) || text2.includes(text1)) {
      return 0.9;
    }

    // 编辑距离
    const distance = this.levenshteinDistance(text1, text2);
    const maxLength = Math.max(text1.length, text2.length);
    const similarity = 1 - distance / maxLength;

    return similarity;
  }

  /**
   * Levenshtein距离
   */
  levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const dp = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) {dp[i][0] = i;}
    for (let j = 0; j <= len2; j++) {dp[0][j] = j;}

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,    // 删除
            dp[i][j - 1] + 1,    // 插入
            dp[i - 1][j - 1] + 1 // 替换
          );
        }
      }
    }

    return dp[len1][len2];
  }

  /**
   * 上下文匹配检查
   */
  isContextMatch(command, context) {
    if (!command.context || !this.config.contextAware) {
      return true;
    }

    // 检查上下文条件
    if (typeof command.context === 'function') {
      return command.context(context);
    }

    if (typeof command.context === 'object') {
      for (const [key, value] of Object.entries(command.context)) {
        if (context[key] !== value) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 构建结果
   */
  buildResult(command, originalText, confidence) {
    let params = {};

    // 提取参数
    if (command.extractParams) {
      params = command.extractParams(originalText);
    }

    // 执行命令action
    const actionResult = typeof command.action === 'function'
      ? command.action(params)
      : command.action;

    return {
      command: command.name,
      confidence: confidence,
      params: params,
      action: actionResult,
      originalText: originalText,
      description: command.description
    };
  }

  /**
   * NLU解析（简单版本）
   */
  parseWithNLU(text, context) {
    // 这里可以集成更复杂的NLU引擎
    // 目前使用简单的关键词和规则

    // 意图映射
    const intentPatterns = {
      create: /创建|新建|开始/,
      search: /搜索|查找|检索/,
      navigate: /打开|进入|跳转/,
      ai_process: /总结|翻译|解释|生成/
    };

    for (const [intent, pattern] of Object.entries(intentPatterns)) {
      if (pattern.test(text)) {
        return {
          intent: intent,
          confidence: 0.8,
          entities: this.extractEntities(text),
          originalText: text
        };
      }
    }

    return null;
  }

  /**
   * 提取实体
   */
  extractEntities(text) {
    const entities = {};

    // 提取资源类型
    const resourcePatterns = {
      note: /笔记/,
      project: /项目/,
      chat: /聊天|对话/,
      file: /文件|文档/
    };

    for (const [type, pattern] of Object.entries(resourcePatterns)) {
      if (pattern.test(text)) {
        entities.resourceType = type;
        break;
      }
    }

    // 提取目标语言
    const languagePatterns = {
      en: /英文|英语|English/,
      zh: /中文|汉语|Chinese/,
      ja: /日文|日语|Japanese/
    };

    for (const [lang, pattern] of Object.entries(languagePatterns)) {
      if (pattern.test(text)) {
        entities.targetLanguage = lang;
        break;
      }
    }

    return entities;
  }

  /**
   * 设置上下文
   */
  pushContext(context) {
    this.contextStack.push(context);
  }

  /**
   * 弹出上下文
   */
  popContext() {
    return this.contextStack.pop();
  }

  /**
   * 获取当前上下文
   */
  getCurrentContext() {
    return this.contextStack.length > 0
      ? this.contextStack[this.contextStack.length - 1]
      : {};
  }

  /**
   * 获取所有命令
   */
  getAllCommands() {
    return Array.from(this.commands.values()).map(cmd => ({
      name: cmd.name,
      patterns: cmd.patterns,
      description: cmd.description
    }));
  }

  /**
   * 移除命令
   */
  unregisterCommand(name) {
    const command = this.commands.get(name);
    if (command) {
      // 移除别名
      command.patterns.forEach(pattern => {
        this.aliases.delete(pattern.toLowerCase());
      });

      this.commands.delete(name);
      logger.info(`[VoiceCommand] 移除命令: ${name}`);
    }
  }
}

module.exports = VoiceCommandRecognizer;
