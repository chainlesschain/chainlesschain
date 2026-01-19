const { logger, createLogger } = require('../utils/logger.js');

/**
 * 多意图识别器
 *
 * 功能:
 * 1. 识别用户输入中的多个独立意图
 * 2. 自动拆分复合任务为独立子任务
 * 3. 建立任务依赖关系
 * 4. 确定任务优先级
 *
 * 示例:
 * 输入: "创建博客网站并部署到云端"
 * 输出: [
 *   { intent: 'CREATE_FILE', priority: 1, description: '创建博客网站' },
 *   { intent: 'DEPLOY_PROJECT', priority: 2, dependencies: [1], description: '部署到云端' }
 * ]
 *
 * 版本: v0.17.0-P1
 * 更新: 2026-01-01
 */

class MultiIntentRecognizer {
  constructor(llmService, intentClassifier) {
    this.llmService = llmService;
    this.intentClassifier = intentClassifier;

    // 常见复合意图模式
    this.compositePatterns = [
      {
        pattern: /(.+)并(.+)/,
        splitter: '并'
      },
      {
        pattern: /(.+)然后(.+)/,
        splitter: '然后'
      },
      {
        pattern: /(.+)再(.+)/,
        splitter: '再'
      },
      {
        pattern: /(.+)最后(.+)/,
        splitter: '最后'
      }
    ];

    // 任务依赖关系关键词
    this.dependencyKeywords = ['然后', '再', '之后', '接着', '最后', '完成后'];
  }

  /**
   * 识别多个意图
   * @param {string} text - 用户输入
   * @param {Object} context - 上下文信息
   * @returns {Object} 多意图识别结果
   */
  async classifyMultiple(text, context = {}) {
    // 1. 快速检测是否包含多个意图
    const hasMultipleIntents = this.detectMultipleIntents(text);

    if (!hasMultipleIntents) {
      // 单一意图，使用原有分类器
      const singleIntent = await this.intentClassifier.classify(text, context);
      return {
        intents: [
          {
            intent: singleIntent.intent,
            priority: 1,
            description: text,
            entities: singleIntent.entities,
            confidence: singleIntent.confidence,
            dependencies: []
          }
        ],
        isMultiIntent: false
      };
    }

    // 2. 使用LLM识别和拆分多个意图
    const multiIntents = await this.llmBasedSplit(text, context);

    // 3. 为每个子意图执行详细识别
    const detailedIntents = await this.enrichIntents(multiIntents, context);

    // 4. 验证依赖关系
    const validatedIntents = this.validateDependencies(detailedIntents);

    return {
      intents: validatedIntents,
      isMultiIntent: true,
      totalTasks: validatedIntents.length
    };
  }

  /**
   * 快速检测是否包含多个意图
   * @param {string} text - 用户输入
   * @returns {boolean}
   */
  detectMultipleIntents(text) {
    // 检查是否包含复合意图关键词
    const keywords = ['并', '然后', '再', '之后', '接着', '最后', '以及', '和', '还有'];

    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return true;
      }
    }

    // 检查是否匹配复合模式
    for (const pattern of this.compositePatterns) {
      if (pattern.pattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 使用LLM拆分多个意图
   * @param {string} text - 用户输入
   * @param {Object} context - 上下文
   * @returns {Array} 拆分后的意图列表
   */
  async llmBasedSplit(text, context) {
    const prompt = `
分析以下用户输入，识别其中包含的多个独立意图，并拆分为独立任务。

用户输入: "${text}"

上下文信息:
${JSON.stringify(context, null, 2)}

要求:
1. 识别所有独立意图（CREATE_FILE, EDIT_FILE, DEPLOY_PROJECT, ANALYZE_DATA等）
2. 为每个意图分配优先级（数字越小优先级越高）
3. 标注任务依赖关系（dependencies数组包含依赖任务的优先级）
4. 提取每个意图的实体参数
5. 生成简洁的任务描述

输出格式（严格JSON，无其他文本）:
{
  "intents": [
    {
      "intent": "CREATE_FILE",
      "priority": 1,
      "description": "创建博客网站",
      "entities": {
        "fileType": "HTML",
        "theme": "dark"
      },
      "dependencies": []
    },
    {
      "intent": "DEPLOY_PROJECT",
      "priority": 2,
      "description": "部署到云端",
      "entities": {
        "platform": "vercel",
        "domain": "myblog.com"
      },
      "dependencies": [1]
    }
  ]
}
`;

    try {
      const result = await this.llmService.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1  // 降低随机性
      });

      // 解析LLM返回的JSON
      const parsed = this.parseJSON(result.content || result);

      if (!parsed || !parsed.intents || !Array.isArray(parsed.intents)) {
        throw new Error('LLM返回格式不正确');
      }

      return parsed.intents;

    } catch (error) {
      logger.error('LLM多意图拆分失败:', error);

      // 降级策略：使用规则引擎拆分
      return this.ruleBasedSplit(text, context);
    }
  }

  /**
   * 基于规则的意图拆分（降级策略）
   * @param {string} text - 用户输入
   * @param {Object} context - 上下文
   * @returns {Array} 拆分后的意图列表
   */
  ruleBasedSplit(text, context) {
    const intents = [];
    let priority = 1;

    // 尝试所有复合模式
    for (const pattern of this.compositePatterns) {
      const match = text.match(pattern.pattern);

      if (match && match.length > 1) {
        // 拆分为多个子任务
        for (let i = 1; i < match.length; i++) {
          const subText = match[i].trim();

          if (subText) {
            intents.push({
              intent: this.guessIntent(subText),
              priority: priority,
              description: subText,
              entities: this.extractEntities(subText),
              dependencies: priority > 1 ? [priority - 1] : []
            });

            priority++;
          }
        }

        // 找到匹配后退出
        break;
      }
    }

    // 如果没有匹配到模式，返回单一意图
    if (intents.length === 0) {
      intents.push({
        intent: this.guessIntent(text),
        priority: 1,
        description: text,
        entities: this.extractEntities(text),
        dependencies: []
      });
    }

    return intents;
  }

  /**
   * 简单的意图猜测（基于关键词）
   * @param {string} text - 文本
   * @returns {string} 意图类型
   */
  guessIntent(text) {
    const intentKeywords = {
      'CREATE_FILE': ['创建', '生成', '制作', '新建'],
      'EDIT_FILE': ['修改', '编辑', '更新', '改'],
      'DEPLOY_PROJECT': ['部署', '发布', '上线', '上传'],
      'ANALYZE_DATA': ['分析', '统计', '查看', '检查'],
      'EXPORT_FILE': ['导出', '下载', '保存为'],
      'QUERY_INFO': ['查询', '搜索', '查找', '寻找']
    };

    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          return intent;
        }
      }
    }

    return 'UNKNOWN';
  }

  /**
   * 简单的实体提取
   * @param {string} text - 文本
   * @returns {Object} 实体对象
   */
  extractEntities(text) {
    const entities = {};

    // 文件类型
    const fileTypes = ['HTML', 'CSS', 'JavaScript', 'Word', 'PDF', 'Markdown'];
    for (const type of fileTypes) {
      if (text.toLowerCase().includes(type.toLowerCase())) {
        entities.fileType = type;
        break;
      }
    }

    // 部署平台
    const platforms = ['Vercel', 'Netlify', 'GitHub Pages', 'Cloudflare'];
    for (const platform of platforms) {
      if (text.toLowerCase().includes(platform.toLowerCase())) {
        entities.platform = platform;
        break;
      }
    }

    return entities;
  }

  /**
   * 丰富意图信息（使用原有分类器）
   * @param {Array} intents - 基础意图列表
   * @param {Object} context - 上下文
   * @returns {Array} 丰富后的意图列表
   */
  async enrichIntents(intents, context) {
    const enriched = [];

    for (const intent of intents) {
      try {
        // 使用原有分类器进行详细识别
        const detailed = await this.intentClassifier.classify(
          intent.description,
          context
        );

        enriched.push({
          ...intent,
          intent: detailed.intent || intent.intent,
          entities: {
            ...intent.entities,
            ...detailed.entities
          },
          confidence: detailed.confidence || 0.7
        });

      } catch (error) {
        logger.error(`意图丰富失败: ${intent.description}`, error);

        // 失败时保留原始意图
        enriched.push({
          ...intent,
          confidence: 0.5
        });
      }
    }

    return enriched;
  }

  /**
   * 验证依赖关系
   * @param {Array} intents - 意图列表
   * @returns {Array} 验证后的意图列表
   */
  validateDependencies(intents) {
    const prioritySet = new Set(intents.map(i => i.priority));

    for (const intent of intents) {
      if (!intent.dependencies) {
        intent.dependencies = [];
        continue;
      }

      // 过滤无效的依赖关系
      intent.dependencies = intent.dependencies.filter(dep => {
        // 依赖的任务必须存在
        if (!prioritySet.has(dep)) {
          logger.warn(`任务${intent.priority}依赖不存在的任务${dep}`);
          return false;
        }

        // 依赖的任务必须优先级更高（数字更小）
        if (dep >= intent.priority) {
          logger.warn(`任务${intent.priority}依赖了优先级更低的任务${dep}`);
          return false;
        }

        return true;
      });
    }

    // 检测循环依赖
    const hasCycle = this.detectCyclicDependency(intents);
    if (hasCycle) {
      logger.error('检测到循环依赖，清除所有依赖关系');
      intents.forEach(intent => intent.dependencies = []);
    }

    return intents;
  }

  /**
   * 检测循环依赖
   * @param {Array} intents - 意图列表
   * @returns {boolean} 是否存在循环依赖
   */
  detectCyclicDependency(intents) {
    const graph = new Map();

    // 构建依赖图
    for (const intent of intents) {
      graph.set(intent.priority, intent.dependencies || []);
    }

    // DFS检测环
    const visited = new Set();
    const recStack = new Set();

    const hasCycle = (node) => {
      if (!visited.has(node)) {
        visited.add(node);
        recStack.add(node);

        const neighbors = graph.get(node) || [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor) && hasCycle(neighbor)) {
            return true;
          } else if (recStack.has(neighbor)) {
            return true;
          }
        }
      }

      recStack.delete(node);
      return false;
    };

    for (const node of graph.keys()) {
      if (hasCycle(node)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 解析JSON（容错处理）
   * @param {string} text - JSON字符串
   * @returns {Object} 解析后的对象
   */
  parseJSON(text) {
    try {
      // 尝试直接解析
      return JSON.parse(text);
    } catch (error) {
      // 尝试提取JSON部分
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          logger.error('JSON解析失败:', e);
          return null;
        }
      }
      return null;
    }
  }

  /**
   * 获取执行顺序（拓扑排序）
   * @param {Array} intents - 意图列表
   * @returns {Array} 排序后的意图列表
   */
  getExecutionOrder(intents) {
    // 按优先级排序
    return intents.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 生成执行计划摘要
   * @param {Array} intents - 意图列表
   * @returns {string} 摘要文本
   */
  generateSummary(intents) {
    const summary = [];

    summary.push(`检测到 ${intents.length} 个独立任务：\n`);

    for (const intent of this.getExecutionOrder(intents)) {
      const deps = intent.dependencies && intent.dependencies.length > 0
        ? ` (依赖: 任务${intent.dependencies.join(', ')})`
        : '';

      summary.push(`${intent.priority}. ${intent.description}${deps}`);
    }

    return summary.join('\n');
  }
}

module.exports = MultiIntentRecognizer;
