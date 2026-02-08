const { logger } = require("../utils/logger.js");

/**
 * FeatureExtractor - 特征工程模块
 * P2智能层Phase 3 - ML工具匹配器
 *
 * 功能:
 * - 文本特征提取 (TF-IDF, 关键词)
 * - 上下文特征提取 (项目类型, 文件类型, 任务阶段)
 * - 用户特征提取 (技能水平, 偏好, 历史成功率)
 * - 特征向量化
 *
 * Version: v0.23.0
 * Date: 2026-01-02
 */

class FeatureExtractor {
  constructor(config = {}) {
    this.config = {
      maxTextLength: 500, // 最大文本长度
      minKeywordLength: 3, // 最小关键词长度
      topKeywords: 10, // 提取关键词数量
      enableTFIDF: true, // 启用TF-IDF
      ...config,
    };

    // 停用词列表 (中英文)
    this.stopWords = new Set([
      // 中文停用词
      "的",
      "了",
      "在",
      "是",
      "我",
      "有",
      "和",
      "就",
      "不",
      "人",
      "都",
      "一",
      "一个",
      "上",
      "也",
      "很",
      "到",
      "说",
      "要",
      "去",
      "你",
      "会",
      "着",
      "没有",
      "看",
      "好",
      // 英文停用词
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "from",
      "as",
      "is",
      "was",
      "are",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "should",
      "can",
      "could",
      "may",
      "might",
      "must",
      "this",
      "that",
      "these",
      "those",
      "i",
      "you",
      "he",
      "she",
      "it",
      "we",
      "they",
    ]);

    // 工具类别关键词映射
    this.categoryKeywords = {
      development: [
        "代码",
        "函数",
        "类",
        "变量",
        "code",
        "function",
        "class",
        "variable",
        "develop",
      ],
      data: [
        "数据",
        "分析",
        "图表",
        "统计",
        "data",
        "analysis",
        "chart",
        "statistics",
      ],
      design: ["设计", "UI", "UX", "界面", "样式", "design", "style", "layout"],
      writing: [
        "文档",
        "写作",
        "文章",
        "document",
        "write",
        "article",
        "markdown",
      ],
      testing: ["测试", "调试", "test", "debug", "unittest"],
      deployment: ["部署", "发布", "上线", "deploy", "release", "publish"],
    };

    this.db = null;
  }

  /**
   * 设置数据库连接
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * 提取所有特征
   * @param {Object} task - 任务对象
   * @param {string} userId - 用户ID
   * @returns {Object} 特征向量
   */
  async extractFeatures(task, userId) {
    const features = {
      text: this.extractTextFeatures(task.description || ""),
      context: this.extractContextFeatures(task),
      user: await this.extractUserFeatures(userId),
      timestamp: Date.now(),
    };

    // 生成特征向量 (用于ML模型)
    features.vector = this.vectorize(features);

    return features;
  }

  /**
   * 提取文本特征
   * @param {string} text - 任务描述文本
   * @returns {Object} 文本特征
   */
  extractTextFeatures(text) {
    // 文本预处理
    const cleanedText = this.preprocessText(text);

    // 分词
    const tokens = this.tokenize(cleanedText);

    // 提取关键词
    const keywords = this.extractKeywords(tokens);

    // TF-IDF特征
    const tfidf = this.config.enableTFIDF ? this.calculateTFIDF(tokens) : null;

    // 检测任务类别
    const detectedCategory = this.detectCategory(tokens);

    return {
      length: text.length,
      wordCount: tokens.length,
      keywords,
      tfidf,
      detectedCategory,
      complexity: this.calculateComplexity(tokens),
    };
  }

  /**
   * 提取上下文特征
   * @param {Object} task - 任务对象
   * @returns {Object} 上下文特征
   */
  extractContextFeatures(task) {
    return {
      projectType: task.projectType || "unknown",
      fileType: this.detectFileType(task.filePath || ""),
      taskPhase: task.taskPhase || "development",
      currentTools: task.currentTools || [],
      hasCode: Boolean(task.codeContext),
      hasFile: Boolean(task.filePath),
      language: task.language || this.detectLanguage(task.filePath || ""),
    };
  }

  /**
   * 提取用户特征
   * @param {string} userId - 用户ID
   * @returns {Object} 用户特征
   */
  async extractUserFeatures(userId) {
    if (!this.db) {
      return this.getDefaultUserFeatures();
    }

    try {
      // 从用户画像表获取特征
      const profile = this.db
        .prepare(
          `
        SELECT
          overall_skill_level,
          preferred_tools,
          total_tasks,
          success_rate,
          avg_task_duration
        FROM user_profiles
        WHERE user_id = ?
      `,
        )
        .get(userId);

      if (!profile) {
        return this.getDefaultUserFeatures();
      }

      // 获取最近工具使用统计
      const recentTools = this.db
        .prepare(
          `
        SELECT
          tool_name,
          COUNT(*) as usage_count,
          AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate
        FROM tool_usage_events
        WHERE user_id = ?
          AND timestamp >= datetime('now', '-7 days')
        GROUP BY tool_name
        ORDER BY usage_count DESC
        LIMIT 10
      `,
        )
        .all(userId);

      return {
        skillLevel: profile.overall_skill_level || "intermediate",
        preferredTools: profile.preferred_tools
          ? JSON.parse(profile.preferred_tools)
          : [],
        totalTasks: profile.total_tasks || 0,
        successRate: profile.success_rate || 0.5,
        avgTaskDuration: profile.avg_task_duration || 3000,
        recentTools: recentTools.map((t) => ({
          tool: t.tool_name,
          count: t.usage_count,
          successRate: t.success_rate,
        })),
        experience: this.calculateExperience(profile.total_tasks),
      };
    } catch (error) {
      logger.error("[FeatureExtractor] 提取用户特征失败:", error);
      return this.getDefaultUserFeatures();
    }
  }

  /**
   * 文本预处理
   */
  preprocessText(text) {
    return text
      .substring(0, this.config.maxTextLength)
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, " ") // 保留中文、英文、数字
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 分词 (简单实现)
   */
  tokenize(text) {
    const words = text.split(/\s+/);
    return words.filter(
      (word) =>
        word.length >= this.config.minKeywordLength &&
        !this.stopWords.has(word),
    );
  }

  /**
   * 提取关键词
   */
  extractKeywords(tokens) {
    // 统计词频
    const wordFreq = {};
    for (const token of tokens) {
      wordFreq[token] = (wordFreq[token] || 0) + 1;
    }

    // 按频次排序，取Top-K
    return Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.config.topKeywords)
      .map(([word, freq]) => ({ word, freq }));
  }

  /**
   * 计算TF-IDF (简化版本)
   */
  calculateTFIDF(tokens) {
    // 计算词频 (TF)
    const tf = {};
    for (const token of tokens) {
      tf[token] = (tf[token] || 0) + 1 / tokens.length;
    }

    // IDF需要文档集合，这里简化为使用词频的倒数
    // 真实场景应该从历史任务文档计算IDF
    const tfidf = {};
    for (const [word, freq] of Object.entries(tf)) {
      tfidf[word] = freq; // 简化：直接使用TF
    }

    return tfidf;
  }

  /**
   * 检测任务类别
   */
  detectCategory(tokens) {
    const categoryScores = {};

    for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
      let score = 0;
      for (const token of tokens) {
        if (keywords.some((keyword) => token.includes(keyword))) {
          score++;
        }
      }
      categoryScores[category] = score;
    }

    // 返回得分最高的类别
    const maxCategory = Object.entries(categoryScores).sort(
      (a, b) => b[1] - a[1],
    )[0];

    return maxCategory && maxCategory[1] > 0 ? maxCategory[0] : "general";
  }

  /**
   * 计算文本复杂度
   */
  calculateComplexity(tokens) {
    const uniqueWords = new Set(tokens).size;
    const avgWordLength =
      tokens.reduce((sum, t) => sum + t.length, 0) / tokens.length;

    // 复杂度 = 词汇多样性 * 平均词长
    const complexity = (uniqueWords / tokens.length) * avgWordLength;

    if (complexity > 8) {
      return "high";
    }
    if (complexity > 5) {
      return "medium";
    }
    return "low";
  }

  /**
   * 检测文件类型
   */
  detectFileType(filePath) {
    const ext = filePath.split(".").pop().toLowerCase();
    const typeMap = {
      js: "javascript",
      ts: "typescript",
      jsx: "react",
      tsx: "react-typescript",
      py: "python",
      java: "java",
      cpp: "cpp",
      c: "c",
      go: "go",
      rs: "rust",
      md: "markdown",
      txt: "text",
      json: "json",
      xml: "xml",
      html: "html",
      css: "css",
    };
    return typeMap[ext] || "unknown";
  }

  /**
   * 检测编程语言
   */
  detectLanguage(filePath) {
    const ext = filePath.split(".").pop().toLowerCase();
    const langMap = {
      js: "JavaScript",
      ts: "TypeScript",
      jsx: "React",
      tsx: "React",
      py: "Python",
      java: "Java",
      cpp: "C++",
      c: "C",
      go: "Go",
      rs: "Rust",
    };
    return langMap[ext] || "Unknown";
  }

  /**
   * 计算用户经验等级
   */
  calculateExperience(totalTasks) {
    if (totalTasks >= 1000) {
      return "expert";
    }
    if (totalTasks >= 500) {
      return "advanced";
    }
    if (totalTasks >= 100) {
      return "intermediate";
    }
    if (totalTasks >= 20) {
      return "beginner";
    }
    return "novice";
  }

  /**
   * 获取默认用户特征
   */
  getDefaultUserFeatures() {
    return {
      skillLevel: "intermediate",
      preferredTools: [],
      totalTasks: 0,
      successRate: 0.5,
      avgTaskDuration: 3000,
      recentTools: [],
      experience: "novice",
    };
  }

  /**
   * 特征向量化 (用于ML模型)
   * @param {Object} features - 特征对象
   * @returns {Array} 特征向量
   */
  vectorize(features) {
    const vector = [];

    // 文本特征 (5维)
    vector.push(
      features.text.length / 100, // 文本长度归一化
      features.text.wordCount / 50, // 词数归一化
      features.text.keywords.length / 10, // 关键词数归一化
      this.complexityToNumber(features.text.complexity), // 复杂度
      this.categoryToNumber(features.text.detectedCategory), // 类别编码
    );

    // 上下文特征 (4维)
    vector.push(
      features.context.hasCode ? 1 : 0,
      features.context.hasFile ? 1 : 0,
      features.context.currentTools.length / 5,
      this.fileTypeToNumber(features.context.fileType),
    );

    // 用户特征 (5维)
    vector.push(
      this.skillLevelToNumber(features.user.skillLevel),
      features.user.totalTasks / 100,
      features.user.successRate,
      features.user.avgTaskDuration / 5000,
      this.experienceToNumber(features.user.experience),
    );

    return vector;
  }

  /**
   * 辅助函数: 复杂度转数值
   */
  complexityToNumber(complexity) {
    const map = { low: 0.33, medium: 0.66, high: 1.0 };
    return map[complexity] || 0.5;
  }

  /**
   * 辅助函数: 类别转数值
   */
  categoryToNumber(category) {
    const categories = [
      "development",
      "data",
      "design",
      "writing",
      "testing",
      "deployment",
      "general",
    ];
    return categories.indexOf(category) / categories.length;
  }

  /**
   * 辅助函数: 文件类型转数值
   */
  fileTypeToNumber(fileType) {
    const hash = fileType
      .split("")
      .reduce((sum, c) => sum + c.charCodeAt(0), 0);
    return (hash % 100) / 100;
  }

  /**
   * 辅助函数: 技能水平转数值
   */
  skillLevelToNumber(skillLevel) {
    const map = {
      beginner: 0.25,
      intermediate: 0.5,
      advanced: 0.75,
      expert: 1.0,
    };
    return map[skillLevel] || 0.5;
  }

  /**
   * 辅助函数: 经验等级转数值
   */
  experienceToNumber(experience) {
    const map = {
      novice: 0.2,
      beginner: 0.4,
      intermediate: 0.6,
      advanced: 0.8,
      expert: 1.0,
    };
    return map[experience] || 0.5;
  }

  /**
   * 批量提取特征
   * @param {Array} tasks - 任务数组
   * @param {string} userId - 用户ID
   * @returns {Array} 特征数组
   */
  async extractBatchFeatures(tasks, userId) {
    const features = [];
    for (const task of tasks) {
      try {
        const feature = await this.extractFeatures(task, userId);
        features.push(feature);
      } catch (error) {
        logger.error("[FeatureExtractor] 批量提取失败:", error);
      }
    }
    return features;
  }
}

module.exports = FeatureExtractor;
