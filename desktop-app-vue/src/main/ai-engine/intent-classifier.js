/**
 * 意图识别器
 * 支持6种意图: CREATE_FILE, EDIT_FILE, QUERY_INFO, ANALYZE_DATA, EXPORT_FILE, DEPLOY_PROJECT
 * 使用Few-shot Learning + 关键词规则
 */

class IntentClassifier {
  constructor() {
    // 意图类型定义
    this.INTENTS = {
      CREATE_FILE: 'create_file',
      EDIT_FILE: 'edit_file',
      QUERY_INFO: 'query_info',
      ANALYZE_DATA: 'analyze_data',
      EXPORT_FILE: 'export_file',
      DEPLOY_PROJECT: 'deploy_project',
    };

    // 关键词规则
    this.keywords = {
      [this.INTENTS.CREATE_FILE]: [
        '创建', '新建', '生成', '做一个', '帮我做', '制作', '写一个',
        '创建一个', '新增', '添加文件', '建立', '搭建',
      ],
      [this.INTENTS.EDIT_FILE]: [
        '修改', '编辑', '改', '更新', '调整', '优化', '重构',
        '删除', '添加', '插入', '替换', '改成', '变成', '改为',
      ],
      [this.INTENTS.QUERY_INFO]: [
        '查询', '查看', '显示', '展示', '告诉我', '什么是', '如何',
        '怎么', '为什么', '哪里', '搜索', '找', '有没有',
      ],
      [this.INTENTS.ANALYZE_DATA]: [
        '分析', '统计', '计算', '汇总', '对比', '比较', '趋势',
        '可视化', '图表', '报表', '总结', '评估',
      ],
      [this.INTENTS.EXPORT_FILE]: [
        '导出', '下载', '保存为', '另存为', '输出', '生成PDF',
        '转换', '打包', '压缩',
      ],
      [this.INTENTS.DEPLOY_PROJECT]: [
        '部署', '发布', '上线', '打包', '构建', 'build', 'deploy',
        '推送到服务器', '发布到',
      ],
    };

    // Few-shot示例（用于更精确的分类）
    this.examples = [
      // CREATE_FILE 示例
      { text: '帮我创建一个博客页面', intent: this.INTENTS.CREATE_FILE },
      { text: '做一个产品介绍的网站', intent: this.INTENTS.CREATE_FILE },
      { text: '新建一个数据分析报告', intent: this.INTENTS.CREATE_FILE },
      { text: '生成一份商务合同模板', intent: this.INTENTS.CREATE_FILE },
      { text: '创建HTML文件', intent: this.INTENTS.CREATE_FILE },

      // EDIT_FILE 示例
      { text: '把标题改成蓝色', intent: this.INTENTS.EDIT_FILE },
      { text: '修改首页的导航栏', intent: this.INTENTS.EDIT_FILE },
      { text: '删除这个函数', intent: this.INTENTS.EDIT_FILE },
      { text: '给这个按钮添加点击事件', intent: this.INTENTS.EDIT_FILE },
      { text: '优化这段代码的性能', intent: this.INTENTS.EDIT_FILE },

      // QUERY_INFO 示例
      { text: '这个项目有多少文件', intent: this.INTENTS.QUERY_INFO },
      { text: '显示所有CSS文件', intent: this.INTENTS.QUERY_INFO },
      { text: '查看最近的修改记录', intent: this.INTENTS.QUERY_INFO },
      { text: 'index.html在哪里', intent: this.INTENTS.QUERY_INFO },
      { text: '什么是响应式设计', intent: this.INTENTS.QUERY_INFO },

      // ANALYZE_DATA 示例
      { text: '分析用户访问数据', intent: this.INTENTS.ANALYZE_DATA },
      { text: '统计代码行数', intent: this.INTENTS.ANALYZE_DATA },
      { text: '生成销售趋势图表', intent: this.INTENTS.ANALYZE_DATA },
      { text: '对比这两个版本的性能', intent: this.INTENTS.ANALYZE_DATA },

      // EXPORT_FILE 示例
      { text: '导出为PDF', intent: this.INTENTS.EXPORT_FILE },
      { text: '下载项目文件', intent: this.INTENTS.EXPORT_FILE },
      { text: '保存为Word文档', intent: this.INTENTS.EXPORT_FILE },
      { text: '打包成压缩文件', intent: this.INTENTS.EXPORT_FILE },

      // DEPLOY_PROJECT 示例
      { text: '部署到服务器', intent: this.INTENTS.DEPLOY_PROJECT },
      { text: '发布项目', intent: this.INTENTS.DEPLOY_PROJECT },
      { text: '打包生产环境', intent: this.INTENTS.DEPLOY_PROJECT },
    ];
  }

  /**
   * 分类用户意图
   * @param {string} userInput - 用户输入
   * @param {Object} context - 上下文信息
   * @returns {Promise<Object>} 意图分类结果
   */
  async classify(userInput, context = {}) {
    const text = userInput.trim();

    // 1. 关键词匹配（快速路径）
    const keywordIntent = this.classifyByKeywords(text);

    // 2. 基于上下文的调整
    const contextIntent = this.adjustByContext(keywordIntent, text, context);

    // 3. 提取实体信息
    const entities = this.extractEntities(text, contextIntent);

    return {
      intent: contextIntent,
      confidence: this.calculateConfidence(text, contextIntent),
      entities,
      originalInput: userInput,
    };
  }

  /**
   * 基于关键词分类
   * @private
   */
  classifyByKeywords(text) {
    const scores = {};

    // 计算每个意图的匹配分数
    for (const [intent, keywords] of Object.entries(this.keywords)) {
      let score = 0;

      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          // 越长的关键词权重越高
          score += keyword.length;
        }
      }

      scores[intent] = score;
    }

    // 返回得分最高的意图
    let maxIntent = this.INTENTS.QUERY_INFO; // 默认意图
    let maxScore = 0;

    for (const [intent, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        maxIntent = intent;
      }
    }

    return maxIntent;
  }

  /**
   * 基于上下文调整意图
   * @private
   */
  adjustByContext(intent, text, context) {
    // 如果用户正在编辑某个文件，且输入较短，优先判定为编辑意图
    if (context && context.currentFile && text.length < 20 && text.includes('改')) {
      return this.INTENTS.EDIT_FILE;
    }

    // 如果提到文件名或文件类型，可能是创建或编辑
    if (this.mentionsFileType(text)) {
      if (intent === this.INTENTS.QUERY_INFO) {
        // 区分创建和查询
        if (text.includes('创建') || text.includes('新建') || text.includes('生成')) {
          return this.INTENTS.CREATE_FILE;
        }
      }
    }

    // 如果项目类型是data，且提到分析/统计，优先判定为数据分析
    if (context && context.projectType === 'data') {
      if (text.includes('分析') || text.includes('统计') || text.includes('图表')) {
        return this.INTENTS.ANALYZE_DATA;
      }
    }

    return intent;
  }

  /**
   * 提取实体信息
   * @private
   */
  extractEntities(text, intent) {
    const entities = {};

    // 提取文件类型
    const fileType = this.extractFileType(text);
    if (fileType) {
      entities.fileType = fileType;
    }

    // 提取颜色
    const colors = this.extractColors(text);
    if (colors.length > 0) {
      entities.colors = colors;
    }

    // 提取数字
    const numbers = this.extractNumbers(text);
    if (numbers.length > 0) {
      entities.numbers = numbers;
    }

    // 提取文件名
    const fileName = this.extractFileName(text);
    if (fileName) {
      entities.fileName = fileName;
    }

    // 提取目标对象（如"标题"、"按钮"、"导航栏"）
    const targets = this.extractTargets(text);
    if (targets.length > 0) {
      entities.targets = targets;
    }

    // 提取动作（如"添加"、"删除"、"修改"）
    const actions = this.extractActions(text);
    if (actions.length > 0) {
      entities.actions = actions;
    }

    return entities;
  }

  /**
   * 提取文件类型
   * @private
   */
  extractFileType(text) {
    const fileTypes = {
      'HTML': ['html', 'HTML', '网页', '页面'],
      'CSS': ['css', 'CSS', '样式', '样式表'],
      'JavaScript': ['js', 'javascript', 'JavaScript', 'JS'],
      'PDF': ['pdf', 'PDF'],
      'Word': ['word', 'Word', 'doc', 'docx', '文档'],
      'Excel': ['excel', 'Excel', 'xls', 'xlsx', '表格', '电子表格'],
      'Markdown': ['md', 'markdown', 'Markdown'],
      'Text': ['txt', 'TXT', '文本文件', '文本', 'text'],
    };

    for (const [type, patterns] of Object.entries(fileTypes)) {
      for (const pattern of patterns) {
        if (text.includes(pattern)) {
          return type;
        }
      }
    }

    return null;
  }

  /**
   * 提取颜色
   * @private
   */
  extractColors(text) {
    const colorPatterns = [
      '红色', '蓝色', '绿色', '黄色', '黑色', '白色', '灰色', '紫色', '橙色', '粉色',
      '红', '蓝', '绿', '黄', '黑', '白', '灰', '紫', '橙', '粉',
      'red', 'blue', 'green', 'yellow', 'black', 'white', 'gray', 'purple', 'orange', 'pink',
      '#[0-9a-fA-F]{3,6}', // 十六进制颜色
    ];

    const colors = [];

    for (const pattern of colorPatterns) {
      if (pattern.startsWith('#')) {
        // 正则匹配
        const regex = new RegExp(pattern, 'g');
        const matches = text.match(regex);
        if (matches) {
          colors.push(...matches);
        }
      } else if (text.includes(pattern)) {
        colors.push(pattern);
      }
    }

    return colors;
  }

  /**
   * 提取数字
   * @private
   */
  extractNumbers(text) {
    const regex = /\d+(\.\d+)?/g;
    const matches = text.match(regex);
    return matches ? matches.map(Number) : [];
  }

  /**
   * 提取文件名
   * @private
   */
  extractFileName(text) {
    // 匹配常见文件名模式
    const patterns = [
      /[\w-]+\.(html|css|js|pdf|doc|docx|xls|xlsx|md|txt)/gi,
      /index\.(html|js|css)/gi,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }

    return null;
  }

  /**
   * 提取目标对象
   * @private
   */
  extractTargets(text) {
    const targetKeywords = [
      '标题', '按钮', '导航栏', '菜单', '侧边栏', '页脚', '页眉',
      '输入框', '文本框', '图片', '背景', '链接', '卡片', '表格',
      'header', 'footer', 'button', 'menu', 'sidebar', 'navbar',
    ];

    const targets = [];

    for (const keyword of targetKeywords) {
      if (text.includes(keyword)) {
        targets.push(keyword);
      }
    }

    return targets;
  }

  /**
   * 提取动作
   * @private
   */
  extractActions(text) {
    const actionKeywords = [
      '添加', '删除', '修改', '更新', '替换', '插入', '移除',
      '调整', '优化', '重构', '改成', '变成',
    ];

    const actions = [];

    for (const keyword of actionKeywords) {
      if (text.includes(keyword)) {
        actions.push(keyword);
      }
    }

    return actions;
  }

  /**
   * 检查是否提到文件类型
   * @private
   */
  mentionsFileType(text) {
    return this.extractFileType(text) !== null;
  }

  /**
   * 计算置信度
   * @private
   */
  calculateConfidence(text, intent) {
    const keywords = this.keywords[intent] || [];
    let totalMatches = 0; // 统计关键词出现的总次数（包括重复）

    for (const keyword of keywords) {
      // 统计这个关键词在文本中出现的次数
      const regex = new RegExp(keyword, 'g');
      const matches = text.match(regex);
      if (matches) {
        totalMatches += matches.length;
      }
    }

    // 基于总匹配次数计算置信度（重复关键词表示更高的确定性）
    if (totalMatches === 0) {return 0.5;} // 默认置信度
    if (totalMatches === 1) {return 0.7;}
    if (totalMatches >= 2) {return 0.9;}

    return 0.6;
  }
}

module.exports = IntentClassifier;
