/**
 * AI智能调度器
 * 根据用户意图自动选择和调度技能
 */

const EventEmitter = require('events');

class AISkillScheduler extends EventEmitter {
  constructor(skillManager, toolManager, skillExecutor, llmService) {
    super();
    this.skillManager = skillManager;
    this.toolManager = toolManager;
    this.skillExecutor = skillExecutor;
    this.llmService = llmService; // LLM服务用于理解用户意图

    // 意图-技能映射规则
    this.intentSkillMapping = this.buildIntentMapping();

    // 执行历史（用于学习用户偏好）
    this.executionHistory = [];
    this.userPreferences = new Map();
  }

  /**
   * 根据用户输入智能调度技能
   * @param {string} userInput - 用户输入的自然语言
   * @param {object} context - 上下文信息
   */
  async smartSchedule(userInput, context = {}) {
    console.log(`[AIScheduler] 处理用户输入: "${userInput}"`);

    try {
      // 1. 分析用户意图
      const intent = await this.analyzeIntent(userInput, context);
      console.log(`[AIScheduler] 识别意图:`, intent);

      // 2. 推荐技能
      const recommendations = await this.recommendSkills(intent, context);
      console.log(`[AIScheduler] 推荐 ${recommendations.length} 个技能`);

      // 3. 选择最佳技能
      const selectedSkill = this.selectBestSkill(recommendations, intent, context);
      console.log(`[AIScheduler] 选择技能: ${selectedSkill.name}`);

      // 4. 生成执行参数
      const params = await this.generateParams(selectedSkill, intent, context);
      console.log(`[AIScheduler] 生成参数:`, params);

      // 5. 执行技能
      const result = await this.skillExecutor.executeSkill(
        selectedSkill.id,
        params,
        { intelligent: true }
      );

      // 6. 学习用户偏好
      this.learnFromExecution(userInput, selectedSkill, result);

      return {
        success: true,
        intent,
        skill: selectedSkill.name,
        result,
        recommendations
      };

    } catch (error) {
      console.error(`[AIScheduler] 智能调度失败:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 分析用户意图
   */
  async analyzeIntent(userInput, context) {
    // 使用关键词匹配和LLM理解相结合
    const keywordIntent = this.analyzeByKeywords(userInput);

    // 如果有LLM服务，使用AI增强理解
    if (this.llmService) {
      try {
        const llmIntent = await this.analyzeByLLM(userInput, context);
        return this.mergeIntents(keywordIntent, llmIntent);
      } catch (error) {
        console.warn('[AIScheduler] LLM分析失败，使用关键词分析:', error.message);
        return keywordIntent;
      }
    }

    return keywordIntent;
  }

  /**
   * 基于关键词的意图分析
   */
  analyzeByKeywords(userInput) {
    const input = userInput.toLowerCase();

    // 意图规则库
    const intentRules = [
      {
        keywords: ['创建', '新建', '生成', 'create', 'new'],
        action: 'create',
        confidence: 0.8
      },
      {
        keywords: ['读取', '打开', '查看', 'read', 'open', 'view'],
        action: 'read',
        confidence: 0.8
      },
      {
        keywords: ['修改', '编辑', '更新', 'edit', 'update', 'modify'],
        action: 'edit',
        confidence: 0.8
      },
      {
        keywords: ['删除', '移除', 'delete', 'remove'],
        action: 'delete',
        confidence: 0.8
      },
      {
        keywords: ['网页', '网站', 'web', 'html', 'website'],
        target: 'web',
        confidence: 0.9
      },
      {
        keywords: ['代码', 'code', '程序', 'program'],
        target: 'code',
        confidence: 0.9
      },
      {
        keywords: ['数据', 'data', '分析', 'analysis'],
        target: 'data',
        confidence: 0.9
      },
      {
        keywords: ['文档', 'document', 'word', 'pdf'],
        target: 'document',
        confidence: 0.9
      },
      {
        keywords: ['图片', 'image', '图像', 'picture'],
        target: 'image',
        confidence: 0.9
      },
      {
        keywords: ['项目', 'project', '仓库', 'repository'],
        target: 'project',
        confidence: 0.9
      },
      {
        keywords: ['搜索', 'search', '查找', 'find'],
        action: 'search',
        confidence: 0.8
      }
    ];

    const detectedIntents = [];

    intentRules.forEach(rule => {
      const matched = rule.keywords.some(keyword => input.includes(keyword));
      if (matched) {
        detectedIntents.push({
          ...rule,
          matched: true
        });
      }
    });

    // 合并意图
    const intent = {
      action: null,
      target: null,
      entities: this.extractEntities(userInput),
      confidence: 0,
      rawInput: userInput
    };

    detectedIntents.forEach(detected => {
      if (detected.action) {
        intent.action = detected.action;
        intent.confidence = Math.max(intent.confidence, detected.confidence);
      }
      if (detected.target) {
        intent.target = detected.target;
        intent.confidence = Math.max(intent.confidence, detected.confidence);
      }
    });

    return intent;
  }

  /**
   * 基于LLM的意图分析
   */
  async analyzeByLLM(userInput, context) {
    const prompt = `分析用户意图并以JSON格式返回：

用户输入: "${userInput}"
上下文: ${JSON.stringify(context)}

请识别：
1. action（动作）: create/read/edit/delete/search/analyze/generate
2. target（目标）: web/code/data/document/image/project
3. entities（实体）: 具体的对象、文件名、项目名等
4. confidence（置信度）: 0-1之间的数值

返回JSON格式：
{
  "action": "...",
  "target": "...",
  "entities": {...},
  "confidence": 0.95
}`;

    const response = await this.llmService.chat(prompt);

    try {
      // 提取JSON（处理可能的markdown包装）
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) ||
                       response.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        return JSON.parse(jsonStr);
      }

      // 如果无法解析，返回基础意图
      return {
        action: null,
        target: null,
        entities: {},
        confidence: 0.3,
        rawResponse: response
      };
    } catch (error) {
      console.error('[AIScheduler] LLM响应解析失败:', error);
      return {
        action: null,
        target: null,
        entities: {},
        confidence: 0.3
      };
    }
  }

  /**
   * 提取实体
   */
  extractEntities(userInput) {
    const entities = {};

    // 提取文件路径
    const pathMatch = userInput.match(/[\/\\]?[\w\-\.\/\\]+\.(txt|md|js|html|css|json|pdf|docx)/i);
    if (pathMatch) {
      entities.filePath = pathMatch[0];
    }

    // 提取项目名
    const projectMatch = userInput.match(/项目名[：:]\s*(\S+)|project\s+name[：:]\s*(\S+)/i);
    if (projectMatch) {
      entities.projectName = projectMatch[1] || projectMatch[2];
    }

    // 提取颜色值
    const colorMatch = userInput.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/);
    if (colorMatch) {
      entities.color = colorMatch[0];
    }

    return entities;
  }

  /**
   * 合并意图（关键词 + LLM）
   */
  mergeIntents(keywordIntent, llmIntent) {
    return {
      action: llmIntent.action || keywordIntent.action,
      target: llmIntent.target || keywordIntent.target,
      entities: { ...keywordIntent.entities, ...llmIntent.entities },
      confidence: Math.max(keywordIntent.confidence, llmIntent.confidence),
      rawInput: keywordIntent.rawInput
    };
  }

  /**
   * 推荐技能
   */
  async recommendSkills(intent, context) {
    const { action, target } = intent;

    // 获取所有启用的技能
    const allSkills = await this.skillManager.getAllSkills();
    const enabledSkills = allSkills.filter(s => s.enabled);

    // 评分和排序
    const scoredSkills = enabledSkills.map(skill => ({
      ...skill,
      score: this.calculateSkillScore(skill, intent, context)
    }));

    // 过滤低分技能并排序
    const recommendations = scoredSkills
      .filter(skill => skill.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5); // 返回Top 5

    return recommendations;
  }

  /**
   * 计算技能评分
   */
  calculateSkillScore(skill, intent, context) {
    let score = 0;

    // 1. 分类匹配（权重 40%）
    if (skill.category === intent.target) {
      score += 0.4;
    }

    // 2. 标签匹配（权重 30%）
    const tags = typeof skill.tags === 'string' ? JSON.parse(skill.tags) : skill.tags;
    const tagMatch = tags.some(tag =>
      intent.rawInput.toLowerCase().includes(tag.toLowerCase())
    );
    if (tagMatch) {
      score += 0.3;
    }

    // 3. 历史使用频率（权重 20%）
    const usageFrequency = this.getUserPreference(skill.id);
    score += usageFrequency * 0.2;

    // 4. 技能成功率（权重 10%）
    const successRate = skill.success_count > 0
      ? skill.success_count / skill.usage_count
      : 0.5;
    score += successRate * 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * 选择最佳技能
   */
  selectBestSkill(recommendations, intent, context) {
    if (recommendations.length === 0) {
      throw new Error('没有找到合适的技能');
    }

    // 返回评分最高的技能
    return recommendations[0];
  }

  /**
   * 生成执行参数
   */
  async generateParams(skill, intent, context) {
    const params = {};

    // 从意图实体中提取参数
    Object.entries(intent.entities).forEach(([key, value]) => {
      params[key] = value;
    });

    // 根据技能类型生成默认参数
    const config = typeof skill.config === 'string' ? JSON.parse(skill.config) : skill.config;

    // 合并配置默认值
    Object.entries(config).forEach(([key, value]) => {
      if (params[key] === undefined) {
        params[key] = value;
      }
    });

    // 使用LLM生成更智能的参数
    if (this.llmService && intent.confidence < 0.8) {
      try {
        const llmParams = await this.generateParamsByLLM(skill, intent, context);
        Object.assign(params, llmParams);
      } catch (error) {
        console.warn('[AIScheduler] LLM参数生成失败:', error.message);
      }
    }

    return params;
  }

  /**
   * 使用LLM生成参数
   */
  async generateParamsByLLM(skill, intent, context) {
    const tools = await this.skillManager.getSkillTools(skill.id);

    const prompt = `根据用户意图生成技能执行参数：

技能: ${skill.name} (${skill.description})
包含工具: ${tools.map(t => t.name).join(', ')}
用户意图: ${JSON.stringify(intent)}
上下文: ${JSON.stringify(context)}

请生成合适的执行参数，返回JSON格式。`;

    const response = await this.llmService.chat(prompt);

    try {
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) ||
                       response.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        return JSON.parse(jsonStr);
      }

      return {};
    } catch (error) {
      console.error('[AIScheduler] 参数解析失败:', error);
      return {};
    }
  }

  /**
   * 从执行结果学习
   */
  learnFromExecution(userInput, skill, result) {
    this.executionHistory.push({
      userInput,
      skillId: skill.id,
      skillName: skill.name,
      success: result.success,
      timestamp: Date.now()
    });

    // 更新用户偏好
    if (result.success) {
      const currentPreference = this.userPreferences.get(skill.id) || 0;
      this.userPreferences.set(skill.id, currentPreference + 0.1);
    }

    // 限制历史记录数量
    if (this.executionHistory.length > 1000) {
      this.executionHistory.shift();
    }
  }

  /**
   * 获取用户偏好
   */
  getUserPreference(skillId) {
    return Math.min(this.userPreferences.get(skillId) || 0, 1.0);
  }

  /**
   * 构建意图-技能映射
   */
  buildIntentMapping() {
    return {
      // 创建类意图
      'create.web': 'skill_web_development',
      'create.code': 'skill_code_development',
      'create.project': 'skill_project_management',
      'create.document': 'skill_document_processing',

      // 分析类意图
      'analyze.data': 'skill_data_analysis',
      'analyze.image': 'skill_image_processing',

      // 搜索类意图
      'search.knowledge': 'skill_knowledge_search',
      'search.info': 'skill_network_requests',

      // 处理类意图
      'process.document': 'skill_document_processing',
      'process.image': 'skill_image_processing',
      'process.video': 'skill_video_processing',

      // AI类意图
      'chat': 'skill_ai_conversation',
      'automate': 'skill_automation_workflow'
    };
  }

  /**
   * 获取意图映射的技能
   */
  getSkillByIntentMapping(intent) {
    const key = `${intent.action}.${intent.target}`;
    return this.intentSkillMapping[key] || null;
  }

  /**
   * 批量处理用户请求
   */
  async processBatch(userInputs, context = {}) {
    console.log(`[AIScheduler] 批量处理 ${userInputs.length} 个请求`);

    const results = [];

    for (const input of userInputs) {
      const result = await this.smartSchedule(input, context);
      results.push({
        input,
        result
      });

      // 更新上下文（传递前一个任务的结果）
      if (result.success && result.result) {
        context = { ...context, ...result.result };
      }
    }

    return {
      success: true,
      total: userInputs.length,
      results
    };
  }

  /**
   * 获取推荐统计
   */
  getRecommendationStats() {
    const skillUsage = new Map();

    this.executionHistory.forEach(record => {
      const count = skillUsage.get(record.skillId) || 0;
      skillUsage.set(record.skillId, count + 1);
    });

    const topSkills = Array.from(skillUsage.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([skillId, count]) => ({
        skillId,
        count,
        percentage: (count / this.executionHistory.length * 100).toFixed(2)
      }));

    return {
      totalExecutions: this.executionHistory.length,
      uniqueSkills: skillUsage.size,
      topSkills
    };
  }
}

module.exports = AISkillScheduler;
