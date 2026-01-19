/**
 * 技能推荐引擎
 * 基于用户意图和使用频率智能推荐技能
 */

class SkillRecommender {
  constructor(skillManager, toolManager) {
    this.skillManager = skillManager;
    this.toolManager = toolManager;

    // 意图关键词映射
    this.intentKeywords = {
      'code': ['代码', '编程', '开发', 'code', 'develop', 'program', '写代码', '修改代码', '生成代码'],
      'web': ['网页', 'html', 'css', 'js', 'javascript', 'web', '网站', '前端', 'frontend'],
      'data': ['数据', 'data', '分析', 'analyze', 'csv', 'excel', '表格', '统计'],
      'document': ['文档', 'document', 'word', 'pdf', 'ppt', 'markdown', 'md', '文章'],
      'image': ['图片', 'image', '照片', 'photo', '图像', '截图', 'png', 'jpg'],
      'video': ['视频', 'video', '录像', '影片', 'mp4'],
      'file': ['文件', 'file', '读取', 'read', '写入', 'write', '复制', 'copy'],
      'git': ['git', 'github', '版本', 'commit', 'push', 'pull', '仓库'],
      'search': ['搜索', 'search', '查找', 'find', '检索', '查询'],
      'automation': ['自动化', 'automation', '定时', 'schedule', '批量', 'batch']
    };

    // 技能分类到意图的映射
    this.categoryToIntent = {
      'code': ['code', 'git'],
      'web': ['web', 'code'],
      'data': ['data'],
      'content': ['document'],
      'document': ['document'],
      'media': ['image', 'video'],
      'file': ['file'],
      'system': ['file', 'automation'],
      'automation': ['automation'],
      'ai': ['search']
    };

    // 推荐缓存
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5分钟缓存
  }

  /**
   * 根据用户输入推荐技能
   * @param {string} userInput - 用户输入文本
   * @param {object} options - 推荐选项
   * @returns {Array} 推荐的技能列表
   */
  async recommendSkills(userInput, options = {}) {
    const {
      limit = 5,              // 返回的推荐数量
      threshold = 0.3,        // 相关度阈值
      includeUsageStats = true, // 是否考虑使用统计
      enabledOnly = true      // 只推荐已启用的技能
    } = options;

    // 检查缓存
    const cacheKey = `${userInput}_${limit}_${threshold}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
    }

    try {
      // 1. 分析用户意图
      const intents = this.analyzeIntent(userInput);

      // 2. 获取所有技能
      const allSkills = await this.skillManager.getAllSkills({
        enabled: enabledOnly ? 1 : undefined
      });

      // 3. 计算每个技能的相关度分数
      const scoredSkills = await Promise.all(
        allSkills.map(async skill => {
          const score = await this.calculateSkillScore(skill, intents, userInput, includeUsageStats);
          return { skill, score };
        })
      );

      // 4. 过滤并排序
      const recommendations = scoredSkills
        .filter(({ score }) => score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ skill, score }) => ({
          ...skill,
          recommendationScore: score,
          reason: this.generateReason(skill, intents, score)
        }));

      // 缓存结果
      this.cache.set(cacheKey, {
        data: recommendations,
        timestamp: Date.now()
      });

      return recommendations;
    } catch (error) {
      console.error('[SkillRecommender] 推荐失败:', error);
      return [];
    }
  }

  /**
   * 分析用户输入的意图
   * @param {string} userInput - 用户输入
   * @returns {Array} 意图列表及其置信度
   */
  analyzeIntent(userInput) {
    const input = userInput.toLowerCase();
    const intents = [];

    for (const [intent, keywords] of Object.entries(this.intentKeywords)) {
      let matchCount = 0;
      const matchedKeywords = [];

      for (const keyword of keywords) {
        if (input.includes(keyword.toLowerCase())) {
          matchCount++;
          matchedKeywords.push(keyword);
        }
      }

      if (matchCount > 0) {
        const confidence = Math.min(matchCount / 3, 1); // 最多3个关键词达到100%
        intents.push({
          intent,
          confidence,
          matchedKeywords
        });
      }
    }

    // 按置信度排序
    return intents.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 计算技能的相关度分数
   * @param {object} skill - 技能对象
   * @param {Array} intents - 意图列表
   * @param {string} userInput - 原始用户输入
   * @param {boolean} includeUsageStats - 是否包含使用统计
   * @returns {number} 相关度分数 (0-1)
   */
  async calculateSkillScore(skill, intents, userInput, includeUsageStats) {
    let score = 0;

    // 1. 意图匹配分数 (权重: 0.5)
    const intentScore = this.calculateIntentScore(skill, intents);
    score += intentScore * 0.5;

    // 2. 文本相似度分数 (权重: 0.3)
    const textScore = this.calculateTextSimilarity(skill, userInput);
    score += textScore * 0.3;

    // 3. 使用频率分数 (权重: 0.2)
    if (includeUsageStats) {
      const usageScore = this.calculateUsageScore(skill);
      score += usageScore * 0.2;
    }

    return Math.min(score, 1); // 确保分数在0-1之间
  }

  /**
   * 计算意图匹配分数
   */
  calculateIntentScore(skill, intents) {
    if (intents.length === 0) {return 0;}

    // 获取技能分类对应的意图
    const skillIntents = this.categoryToIntent[skill.category] || [];

    let maxScore = 0;
    for (const { intent, confidence } of intents) {
      if (skillIntents.includes(intent)) {
        maxScore = Math.max(maxScore, confidence);
      }
    }

    return maxScore;
  }

  /**
   * 计算文本相似度分数
   */
  calculateTextSimilarity(skill, userInput) {
    const input = userInput.toLowerCase();
    const skillName = skill.name.toLowerCase();
    const skillDesc = (skill.description || '').toLowerCase();

    let score = 0;

    // 技能名称完全匹配
    if (input.includes(skillName) || skillName.includes(input)) {
      score += 0.5;
    }

    // 描述匹配
    const inputWords = input.split(/\s+/);
    const matchingWords = inputWords.filter(word =>
      word.length > 1 && (skillName.includes(word) || skillDesc.includes(word))
    );

    if (matchingWords.length > 0) {
      score += (matchingWords.length / inputWords.length) * 0.5;
    }

    return Math.min(score, 1);
  }

  /**
   * 计算使用频率分数
   */
  calculateUsageScore(skill) {
    const { usage_count = 0, success_count = 0 } = skill;

    if (usage_count === 0) {return 0;}

    // 成功率
    const successRate = success_count / usage_count;

    // 使用次数归一化 (log scale)
    const normalizedUsage = Math.min(Math.log10(usage_count + 1) / 3, 1);

    // 综合分数
    return (successRate * 0.7) + (normalizedUsage * 0.3);
  }

  /**
   * 生成推荐理由
   */
  generateReason(skill, intents, score) {
    const reasons = [];

    // 意图匹配
    if (intents.length > 0) {
      const matchedIntent = intents.find(({ intent }) =>
        (this.categoryToIntent[skill.category] || []).includes(intent)
      );
      if (matchedIntent) {
        reasons.push(`与您的意图"${matchedIntent.intent}"相关`);
      }
    }

    // 使用频率
    if (skill.usage_count > 10) {
      reasons.push(`您经常使用此技能(${skill.usage_count}次)`);
    }

    // 成功率
    if (skill.usage_count > 0) {
      const successRate = (skill.success_count / skill.usage_count * 100).toFixed(0);
      if (successRate >= 80) {
        reasons.push(`成功率高(${successRate}%)`);
      }
    }

    // 相关度高
    if (score >= 0.8) {
      reasons.push('高度相关');
    }

    return reasons.length > 0 ? reasons.join('; ') : '可能相关';
  }

  /**
   * 获取热门技能
   * @param {number} limit - 返回数量
   * @returns {Array} 热门技能列表
   */
  async getPopularSkills(limit = 10) {
    const allSkills = await this.skillManager.getAllSkills({ enabled: 1 });

    return allSkills
      .filter(skill => skill.usage_count > 0)
      .sort((a, b) => {
        // 综合排序:使用次数 + 成功率
        const scoreA = a.usage_count * (a.success_count / Math.max(a.usage_count, 1));
        const scoreB = b.usage_count * (b.success_count / Math.max(b.usage_count, 1));
        return scoreB - scoreA;
      })
      .slice(0, limit)
      .map(skill => ({
        ...skill,
        popularity: this.calculatePopularityScore(skill)
      }));
  }

  /**
   * 获取推荐的相关技能
   * @param {string} skillId - 技能ID
   * @param {number} limit - 返回数量
   * @returns {Array} 相关技能列表
   */
  async getRelatedSkills(skillId, limit = 5) {
    const skill = await this.skillManager.getSkillById(skillId);
    if (!skill) {return [];}

    const allSkills = await this.skillManager.getAllSkills({
      enabled: 1
    });

    // 获取技能的工具
    const skillTools = await this.skillManager.getSkillTools(skillId);
    const toolIds = new Set(skillTools.map(st => st.tool_id));

    // 计算相关度
    const relatedSkills = await Promise.all(
      allSkills
        .filter(s => s.id !== skillId)
        .map(async otherSkill => {
          let score = 0;

          // 1. 相同分类 (+0.5)
          if (otherSkill.category === skill.category) {
            score += 0.5;
          }

          // 2. 共享工具 (+0.3 per tool)
          const otherTools = await this.skillManager.getSkillTools(otherSkill.id);
          const sharedTools = otherTools.filter(st => toolIds.has(st.tool_id));
          score += Math.min(sharedTools.length * 0.3, 0.5);

          return { skill: otherSkill, score };
        })
    );

    return relatedSkills
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ skill, score }) => ({
        ...skill,
        relationScore: score
      }));
  }

  /**
   * 计算热门度分数
   */
  calculatePopularityScore(skill) {
    const { usage_count = 0, success_count = 0 } = skill;
    if (usage_count === 0) {return 0;}

    const successRate = success_count / usage_count;
    const normalizedUsage = Math.min(usage_count / 100, 1);

    return (successRate * 0.6 + normalizedUsage * 0.4) * 100;
  }

  /**
   * 搜索技能
   * @param {string} query - 搜索关键词
   * @param {object} options - 搜索选项
   * @returns {Array} 搜索结果
   */
  async searchSkills(query, options = {}) {
    const { category, enabledOnly = true, limit = 20 } = options;

    const allSkills = await this.skillManager.getAllSkills({
      enabled: enabledOnly ? 1 : undefined,
      category
    });

    if (!query || query.trim() === '') {
      return allSkills.slice(0, limit);
    }

    const queryLower = query.toLowerCase();
    const searchResults = allSkills.map(skill => {
      let score = 0;

      // 名称匹配
      const nameLower = skill.name.toLowerCase();
      if (nameLower === queryLower) {
        score += 1.0;
      } else if (nameLower.includes(queryLower)) {
        score += 0.7;
      } else if (queryLower.includes(nameLower)) {
        score += 0.5;
      }

      // 描述匹配
      const descLower = (skill.description || '').toLowerCase();
      if (descLower.includes(queryLower)) {
        score += 0.3;
      }

      // ID匹配
      if (skill.id.toLowerCase().includes(queryLower)) {
        score += 0.2;
      }

      return { skill, score };
    });

    return searchResults
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ skill, score }) => ({
        ...skill,
        searchScore: score
      }));
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear();
    console.log('[SkillRecommender] 缓存已清除');
  }

  /**
   * 获取推荐统计
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      intentCategories: Object.keys(this.intentKeywords).length,
      totalKeywords: Object.values(this.intentKeywords).reduce((sum, arr) => sum + arr.length, 0)
    };
  }
}

module.exports = SkillRecommender;
