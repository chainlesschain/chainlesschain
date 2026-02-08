/**
 * 高级语音命令系统
 *
 * 支持复杂的语音命令、上下文感知、参数提取和智能执行
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");

/**
 * 高级语音命令类
 */
class AdvancedVoiceCommands extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enableContextAware: config.enableContextAware !== false,
      enableChaining: config.enableChaining !== false,
      enableMacros: config.enableMacros !== false,
      minConfidence: config.minConfidence || 0.7,
      ...config,
    };

    // 命令注册表
    this.commands = new Map();
    this.macros = new Map();
    this.contextStack = [];
    this.commandHistory = [];

    // 注册高级命令
    this.registerAdvancedCommands();
  }

  /**
   * 注册高级命令
   */
  registerAdvancedCommands() {
    // ===== 文档编辑命令 =====
    this.registerCommand({
      name: "format_text",
      patterns: ["加粗", "斜体", "下划线", "删除线", "标题", "引用", "代码块"],
      category: "editing",
      action: (params) => ({
        type: "format",
        style: params.style,
        selection: params.selection,
      }),
      extractParams: (text) => {
        const styleMap = {
          加粗: "bold",
          斜体: "italic",
          下划线: "underline",
          删除线: "strikethrough",
          标题: "heading",
          引用: "quote",
          代码块: "code",
        };

        for (const [key, value] of Object.entries(styleMap)) {
          if (text.includes(key)) {
            return { style: value };
          }
        }

        return {};
      },
      description: "格式化选中文本",
    });

    this.registerCommand({
      name: "insert_element",
      patterns: [
        "插入图片",
        "插入表格",
        "插入链接",
        "插入列表",
        "插入分隔线",
        "插入代码",
      ],
      category: "editing",
      action: (params) => ({
        type: "insert",
        element: params.element,
        properties: params.properties,
      }),
      extractParams: (text) => {
        const elementMap = {
          图片: "image",
          表格: "table",
          链接: "link",
          列表: "list",
          分隔线: "divider",
          代码: "code",
        };

        for (const [key, value] of Object.entries(elementMap)) {
          if (text.includes(key)) {
            return { element: value };
          }
        }

        return;
      },
      description: "插入文档元素",
    });

    // ===== 智能搜索命令 =====
    this.registerCommand({
      name: "smart_search",
      patterns: ["搜索关于", "查找包含", "找到所有", "显示相关", "检索"],
      category: "search",
      action: (params) => ({
        type: "search",
        query: params.query,
        filters: params.filters,
        scope: params.scope,
      }),
      extractParams: (text) => {
        // 提取搜索查询
        const patterns = [
          /(?:搜索|查找|检索)(?:关于|包含)?\s*(.+)/,
          /找到所有\s*(.+)/,
          /显示相关\s*(.+)/,
        ];

        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match) {
            return {
              query: match[1].trim(),
              scope: "all",
            };
          }
        }

        return {};
      },
      description: "智能搜索内容",
    });

    // ===== 批量操作命令 =====
    this.registerCommand({
      name: "batch_operation",
      patterns: ["全选", "全部删除", "批量导出", "批量标记", "批量移动"],
      category: "batch",
      action: (params) => ({
        type: "batch",
        operation: params.operation,
        target: params.target,
        options: params.options,
      }),
      extractParams: (text) => {
        const operationMap = {
          全选: "select_all",
          全部删除: "delete_all",
          批量导出: "export_batch",
          批量标记: "tag_batch",
          批量移动: "move_batch",
        };

        for (const [key, value] of Object.entries(operationMap)) {
          if (text.includes(key)) {
            return { operation: value };
          }
        }

        return {};
      },
      description: "批量操作",
    });

    // ===== AI 增强命令 =====
    this.registerCommand({
      name: "ai_enhance",
      patterns: ["优化这段", "改进文本", "润色", "扩写", "缩写", "重写"],
      category: "ai",
      action: (params) => ({
        type: "ai",
        task: params.task,
        content: params.content,
        options: params.options,
      }),
      extractParams: (text) => {
        const taskMap = {
          优化: "optimize",
          改进: "improve",
          润色: "polish",
          扩写: "expand",
          缩写: "summarize",
          重写: "rewrite",
        };

        for (const [key, value] of Object.entries(taskMap)) {
          if (text.includes(key)) {
            return { task: value };
          }
        }

        return {};
      },
      description: "AI 文本增强",
    });

    // ===== 工作流命令 =====
    this.registerCommand({
      name: "workflow",
      patterns: ["开始工作流", "执行流程", "运行自动化", "触发任务"],
      category: "workflow",
      action: (params) => ({
        type: "workflow",
        name: params.workflowName,
        params: params.workflowParams,
      }),
      extractParams: (text) => {
        // 提取工作流名称
        const match = text.match(
          /(?:开始|执行|运行|触发)\s*(.+?)(?:工作流|流程|自动化|任务)?$/,
        );
        return match ? { workflowName: match[1].trim() } : {};
      },
      description: "执行工作流",
    });

    // ===== 快捷操作命令 =====
    this.registerCommand({
      name: "quick_action",
      patterns: [
        "复制",
        "粘贴",
        "剪切",
        "撤销",
        "重做",
        "保存",
        "关闭",
        "刷新",
      ],
      category: "quick",
      action: (params) => ({
        type: "quick_action",
        action: params.action,
      }),
      extractParams: (text) => {
        const actionMap = {
          复制: "copy",
          粘贴: "paste",
          剪切: "cut",
          撤销: "undo",
          重做: "redo",
          保存: "save",
          关闭: "close",
          刷新: "refresh",
        };

        for (const [key, value] of Object.entries(actionMap)) {
          if (text === key) {
            return { action: value };
          }
        }

        return {};
      },
      description: "快捷操作",
    });

    // ===== 导航命令（增强版）=====
    this.registerCommand({
      name: "navigate_to",
      patterns: ["跳转到", "打开页面", "前往", "切换到"],
      category: "navigation",
      action: (params) => ({
        type: "navigate",
        target: params.target,
        params: params.navParams,
      }),
      extractParams: (text) => {
        // 提取目标页面
        const pageMap = {
          首页: "home",
          笔记: "notes",
          项目: "projects",
          聊天: "chat",
          设置: "settings",
          知识图谱: "knowledge-graph",
          社交: "social",
          交易: "trade",
        };

        for (const [key, value] of Object.entries(pageMap)) {
          if (text.includes(key)) {
            return { target: value };
          }
        }

        return {};
      },
      description: "页面导航",
    });

    // ===== 时间相关命令 =====
    this.registerCommand({
      name: "time_based",
      patterns: [
        "设置提醒",
        "创建日程",
        "添加待办",
        "查看日历",
        "今天的任务",
        "本周计划",
      ],
      category: "time",
      action: (params) => ({
        type: "time_based",
        action: params.action,
        time: params.time,
        content: params.content,
      }),
      extractParams: (text) => {
        const actionMap = {
          提醒: "reminder",
          日程: "schedule",
          待办: "todo",
          日历: "calendar",
          任务: "tasks",
          计划: "plan",
        };

        for (const [key, value] of Object.entries(actionMap)) {
          if (text.includes(key)) {
            return { action: value };
          }
        }

        return {};
      },
      description: "时间管理",
    });

    // ===== 多媒体命令 =====
    this.registerCommand({
      name: "multimedia",
      patterns: ["截图", "录屏", "录音", "拍照", "扫描二维码"],
      category: "multimedia",
      action: (params) => ({
        type: "multimedia",
        action: params.action,
        options: params.options,
      }),
      extractParams: (text) => {
        const actionMap = {
          截图: "screenshot",
          录屏: "screen_record",
          录音: "audio_record",
          拍照: "photo",
          扫描: "scan_qr",
        };

        for (const [key, value] of Object.entries(actionMap)) {
          if (text.includes(key)) {
            return { action: value };
          }
        }

        return {};
      },
      description: "多媒体操作",
    });
  }

  /**
   * 注册命令
   */
  registerCommand(command) {
    if (!command.name || !command.patterns || !command.action) {
      throw new Error("命令必须包含 name, patterns 和 action");
    }

    this.commands.set(command.name, {
      name: command.name,
      patterns: Array.isArray(command.patterns)
        ? command.patterns
        : [command.patterns],
      action: command.action,
      category: command.category || "general",
      description: command.description || "",
      extractParams: command.extractParams || null,
      context: command.context || null,
      priority: command.priority || 0,
      enabled: command.enabled !== false,
    });

    logger.info(
      `[AdvancedVoiceCommands] 注册命令: ${command.name} (${command.category})`,
    );
  }

  /**
   * 识别命令
   */
  recognize(text, context = {}) {
    if (!text || typeof text !== "string") {
      return null;
    }

    const normalizedText = text.trim().toLowerCase();
    logger.info(`[AdvancedVoiceCommands] 识别命令: "${text}"`);

    // 1. 检查是否为命令链
    if (this.config.enableChaining && this.isCommandChain(text)) {
      return this.parseCommandChain(text, context);
    }

    // 2. 检查是否为宏命令
    if (this.config.enableMacros && this.macros.has(normalizedText)) {
      return this.executeMacro(normalizedText, context);
    }

    // 3. 精确匹配
    const exactMatch = this.findExactMatch(normalizedText, context);
    if (exactMatch) {
      return this.buildResult(exactMatch, text, 1.0);
    }

    // 4. 模糊匹配
    const fuzzyMatch = this.findFuzzyMatch(normalizedText, context);
    if (fuzzyMatch && fuzzyMatch.confidence >= this.config.minConfidence) {
      return this.buildResult(fuzzyMatch.command, text, fuzzyMatch.confidence);
    }

    // 5. 智能解析
    const smartMatch = this.smartParse(text, context);
    if (smartMatch) {
      return smartMatch;
    }

    return null;
  }

  /**
   * 检查是否为命令链
   */
  isCommandChain(text) {
    // 检查是否包含连接词
    const chainKeywords = ["然后", "接着", "再", "之后", "并且", "同时"];
    return chainKeywords.some((keyword) => text.includes(keyword));
  }

  /**
   * 解析命令链
   */
  parseCommandChain(text, context) {
    const chainKeywords = ["然后", "接着", "再", "之后", "并且", "同时"];
    let commands = [text];

    // 按连接词分割
    for (const keyword of chainKeywords) {
      const parts = commands[commands.length - 1].split(keyword);
      if (parts.length > 1) {
        commands = commands.slice(0, -1).concat(parts);
      }
    }

    // 识别每个子命令
    const recognizedCommands = commands
      .map((cmd) => this.recognize(cmd.trim(), context))
      .filter((cmd) => cmd !== null);

    if (recognizedCommands.length === 0) {
      return null;
    }

    return {
      type: "chain",
      commands: recognizedCommands,
      originalText: text,
    };
  }

  /**
   * 精确匹配
   */
  findExactMatch(text, context) {
    for (const [name, command] of this.commands) {
      if (!command.enabled) {
        continue;
      }
      if (!this.isContextMatch(command, context)) {
        continue;
      }

      for (const pattern of command.patterns) {
        if (pattern.toLowerCase() === text) {
          return command;
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
      if (!command.enabled) {
        continue;
      }
      if (!this.isContextMatch(command, context)) {
        continue;
      }

      for (const pattern of command.patterns) {
        const confidence = this.calculateSimilarity(
          text,
          pattern.toLowerCase(),
        );

        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestMatch = command;
        }
      }
    }

    return bestMatch && bestConfidence >= this.config.minConfidence
      ? { command: bestMatch, confidence: bestConfidence }
      : null;
  }

  /**
   * 智能解析
   */
  smartParse(text, context) {
    // 使用自然语言理解技术
    // 这里可以集成更复杂的 NLU 引擎

    // 意图识别
    const intent = this.detectIntent(text);
    if (!intent) {
      return null;
    }

    // 实体提取
    const entities = this.extractEntities(text);

    // 构建命令
    return {
      type: "smart",
      intent: intent,
      entities: entities,
      confidence: 0.8,
      originalText: text,
    };
  }

  /**
   * 检测意图
   */
  detectIntent(text) {
    const intentPatterns = {
      create: /创建|新建|添加|开始/,
      edit: /编辑|修改|更改|调整/,
      delete: /删除|移除|清除/,
      search: /搜索|查找|检索|寻找/,
      navigate: /打开|跳转|前往|切换/,
      format: /格式化|加粗|斜体|标题/,
      ai: /总结|翻译|解释|生成|优化/,
      batch: /批量|全部|所有/,
      multimedia: /截图|录屏|录音|拍照/,
    };

    for (const [intent, pattern] of Object.entries(intentPatterns)) {
      if (pattern.test(text)) {
        return intent;
      }
    }

    return null;
  }

  /**
   * 提取实体
   */
  extractEntities(text) {
    const entities = {};

    // 提取数字
    const numbers = text.match(/\d+/g);
    if (numbers) {
      entities.numbers = numbers.map((n) => parseInt(n));
    }

    // 提取时间
    const timePatterns = {
      今天: "today",
      明天: "tomorrow",
      昨天: "yesterday",
      本周: "this_week",
      下周: "next_week",
    };

    for (const [key, value] of Object.entries(timePatterns)) {
      if (text.includes(key)) {
        entities.time = value;
        break;
      }
    }

    return entities;
  }

  /**
   * 计算相似度
   */
  calculateSimilarity(text1, text2) {
    if (text1.includes(text2) || text2.includes(text1)) {
      return 0.9;
    }

    const distance = this.levenshteinDistance(text1, text2);
    const maxLength = Math.max(text1.length, text2.length);
    return 1 - distance / maxLength;
  }

  /**
   * Levenshtein 距离
   */
  levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const dp = Array(len1 + 1)
      .fill(null)
      .map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) {
      dp[i][0] = i;
    }
    for (let j = 0; j <= len2; j++) {
      dp[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + 1,
          );
        }
      }
    }

    return dp[len1][len2];
  }

  /**
   * 上下文匹配
   */
  isContextMatch(command, context) {
    if (!command.context || !this.config.enableContextAware) {
      return true;
    }

    if (typeof command.context === "function") {
      return command.context(context);
    }

    if (typeof command.context === "object") {
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

    if (command.extractParams) {
      params = command.extractParams(originalText);
    }

    const actionResult =
      typeof command.action === "function"
        ? command.action(params)
        : command.action;

    const result = {
      command: command.name,
      category: command.category,
      confidence: confidence,
      params: params,
      action: actionResult,
      originalText: originalText,
      description: command.description,
    };

    // 记录到历史
    this.addToHistory(result);

    return result;
  }

  /**
   * 注册宏命令
   */
  registerMacro(name, commands) {
    this.macros.set(name.toLowerCase(), commands);
    logger.info(`[AdvancedVoiceCommands] 注册宏: ${name}`);
  }

  /**
   * 执行宏命令
   */
  executeMacro(name, context) {
    const commands = this.macros.get(name);
    if (!commands) {
      return null;
    }

    return {
      type: "macro",
      name: name,
      commands: commands,
      originalText: name,
    };
  }

  /**
   * 添加到历史
   */
  addToHistory(result) {
    this.commandHistory.push({
      ...result,
      timestamp: Date.now(),
    });

    // 限制历史大小
    if (this.commandHistory.length > 100) {
      this.commandHistory.shift();
    }
  }

  /**
   * 获取命令历史
   */
  getHistory(limit = 10) {
    return this.commandHistory.slice(-limit);
  }

  /**
   * 获取所有命令
   */
  getAllCommands() {
    return Array.from(this.commands.values())
      .filter((cmd) => cmd.enabled)
      .map((cmd) => ({
        name: cmd.name,
        category: cmd.category,
        patterns: cmd.patterns,
        description: cmd.description,
      }));
  }

  /**
   * 按类别获取命令
   */
  getCommandsByCategory(category) {
    return this.getAllCommands().filter((cmd) => cmd.category === category);
  }

  /**
   * 启用/禁用命令
   */
  setCommandEnabled(name, enabled) {
    const command = this.commands.get(name);
    if (command) {
      command.enabled = enabled;
      logger.info(
        `[AdvancedVoiceCommands] ${enabled ? "启用" : "禁用"}命令: ${name}`,
      );
    }
  }
}

module.exports = AdvancedVoiceCommands;
