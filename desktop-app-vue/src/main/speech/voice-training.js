/**
 * 语音训练与个性化系统
 *
 * 提供用户语音配置文件、口音适应、自定义词汇学习和个性化命令建议
 */

const { logger, createLogger } = require('../utils/logger.js');
const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');

/**
 * 语音训练类
 */
class VoiceTraining extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      profilePath: config.profilePath || path.join(process.cwd(), 'data', 'voice-profiles'),
      enableAdaptation: config.enableAdaptation !== false,
      enableLearning: config.enableLearning !== false,
      minConfidenceThreshold: config.minConfidenceThreshold || 0.7,
      maxVocabularySize: config.maxVocabularySize || 10000,
      ...config
    };

    // 用户配置文件
    this.userProfile = null;
    this.currentUserId = null;

    // 学习数据
    this.customVocabulary = new Map();
    this.commandUsageStats = new Map();
    this.correctionHistory = [];
    this.accentPatterns = new Map();
  }

  /**
   * 初始化用户配置文件
   */
  async initialize(userId) {
    this.currentUserId = userId;
    await this.loadUserProfile(userId);
    logger.info(`[VoiceTraining] 已初始化用户配置: ${userId}`);
  }

  /**
   * 加载用户配置文件
   */
  async loadUserProfile(userId) {
    try {
      const profilePath = path.join(this.config.profilePath, `${userId}.json`);

      const exists = await fs.access(profilePath)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const data = await fs.readFile(profilePath, 'utf-8');
        this.userProfile = JSON.parse(data);

        // 加载自定义词汇
        if (this.userProfile.customVocabulary) {
          this.customVocabulary = new Map(Object.entries(this.userProfile.customVocabulary));
        }

        // 加载命令使用统计
        if (this.userProfile.commandUsageStats) {
          this.commandUsageStats = new Map(Object.entries(this.userProfile.commandUsageStats));
        }

        // 加载口音模式
        if (this.userProfile.accentPatterns) {
          this.accentPatterns = new Map(Object.entries(this.userProfile.accentPatterns));
        }

        // 加载纠正历史
        if (this.userProfile.correctionHistory) {
          this.correctionHistory = this.userProfile.correctionHistory;
        }

        logger.info(`[VoiceTraining] 已加载用户配置: ${userId}`);
      } else {
        // 创建新配置文件
        this.userProfile = this.createDefaultProfile(userId);
        await this.saveUserProfile();
        logger.info(`[VoiceTraining] 已创建新用户配置: ${userId}`);
      }
    } catch (error) {
      logger.error('[VoiceTraining] 加载配置文件失败:', error);
      this.userProfile = this.createDefaultProfile(userId);
    }
  }

  /**
   * 创建默认配置文件
   */
  createDefaultProfile(userId) {
    return {
      userId: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),

      // 语言偏好
      preferredLanguage: 'zh-CN',
      secondaryLanguages: [],

      // 口音信息
      accentInfo: {
        region: null,
        dialect: null,
        confidence: 0
      },

      // 自定义词汇
      customVocabulary: {},

      // 命令使用统计
      commandUsageStats: {},

      // 纠正历史
      correctionHistory: [],

      // 口音模式
      accentPatterns: {},

      // 学习统计
      learningStats: {
        totalTranscriptions: 0,
        totalCorrections: 0,
        totalCommands: 0,
        averageConfidence: 0,
        improvementRate: 0
      },

      // 个性化设置
      preferences: {
        autoCorrect: true,
        suggestCommands: true,
        adaptToAccent: true,
        learnVocabulary: true
      }
    };
  }

  /**
   * 保存用户配置文件
   */
  async saveUserProfile() {
    try {
      // 确保目录存在
      await fs.mkdir(this.config.profilePath, { recursive: true });

      // 更新时间戳
      this.userProfile.updatedAt = Date.now();

      // 转换 Map 为对象
      this.userProfile.customVocabulary = Object.fromEntries(this.customVocabulary);
      this.userProfile.commandUsageStats = Object.fromEntries(this.commandUsageStats);
      this.userProfile.accentPatterns = Object.fromEntries(this.accentPatterns);
      this.userProfile.correctionHistory = this.correctionHistory;

      const profilePath = path.join(this.config.profilePath, `${this.currentUserId}.json`);
      await fs.writeFile(profilePath, JSON.stringify(this.userProfile, null, 2), 'utf-8');

      logger.info('[VoiceTraining] 配置文件已保存');
      this.emit('profileSaved', this.userProfile);
    } catch (error) {
      logger.error('[VoiceTraining] 保存配置文件失败:', error);
    }
  }

  /**
   * 记录转录结果
   */
  async recordTranscription(result) {
    if (!this.config.enableLearning) {return;}

    try {
      // 更新统计
      this.userProfile.learningStats.totalTranscriptions++;

      // 更新平均置信度
      const currentAvg = this.userProfile.learningStats.averageConfidence;
      const totalCount = this.userProfile.learningStats.totalTranscriptions;
      this.userProfile.learningStats.averageConfidence =
        (currentAvg * (totalCount - 1) + result.confidence) / totalCount;

      // 学习新词汇
      if (result.text && result.confidence >= this.config.minConfidenceThreshold) {
        await this.learnVocabulary(result.text, result.language);
      }

      // 检测口音模式
      if (this.config.enableAdaptation && result.segments) {
        await this.detectAccentPatterns(result);
      }

      await this.saveUserProfile();
    } catch (error) {
      logger.error('[VoiceTraining] 记录转录失败:', error);
    }
  }

  /**
   * 学习词汇
   */
  async learnVocabulary(text, language) {
    if (!this.config.enableLearning) {return;}

    // 分词
    const words = this.tokenize(text, language);

    for (const word of words) {
      if (word.length < 2) {continue;} // 跳过太短的词

      // 更新词频
      const currentCount = this.customVocabulary.get(word) || 0;
      this.customVocabulary.set(word, currentCount + 1);
    }

    // 限制词汇表大小
    if (this.customVocabulary.size > this.config.maxVocabularySize) {
      this.pruneVocabulary();
    }

    logger.info(`[VoiceTraining] 学习了 ${words.length} 个词汇`);
  }

  /**
   * 分词
   */
  tokenize(text, language) {
    // 中文分词
    if (language && language.startsWith('zh')) {
      // 简单的中文分词（实际应用中应使用专业分词库）
      return text.match(/[\u4e00-\u9fa5]+/g) || [];
    }

    // 其他语言按空格分词
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  /**
   * 修剪词汇表
   */
  pruneVocabulary() {
    // 按词频排序
    const sorted = Array.from(this.customVocabulary.entries())
      .sort((a, b) => b[1] - a[1]);

    // 保留前 N 个高频词
    this.customVocabulary = new Map(
      sorted.slice(0, this.config.maxVocabularySize)
    );

    logger.info(`[VoiceTraining] 词汇表已修剪至 ${this.customVocabulary.size} 个词`);
  }

  /**
   * 检测口音模式
   */
  async detectAccentPatterns(result) {
    if (!result.segments || result.segments.length === 0) {return;}

    // 分析音素替换模式
    for (const segment of result.segments) {
      if (segment.alternatives && segment.alternatives.length > 1) {
        const primary = segment.alternatives[0];
        const secondary = segment.alternatives[1];

        // 记录替换模式
        const pattern = `${primary.text} -> ${secondary.text}`;
        const currentCount = this.accentPatterns.get(pattern) || 0;
        this.accentPatterns.set(pattern, currentCount + 1);
      }
    }

    // 更新口音信息
    if (this.accentPatterns.size > 10) {
      this.updateAccentInfo();
    }
  }

  /**
   * 更新口音信息
   */
  updateAccentInfo() {
    // 分析最常见的替换模式
    const topPatterns = Array.from(this.accentPatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // 基于模式推断口音特征
    // 这里是简化版本，实际应用中需要更复杂的分析
    this.userProfile.accentInfo.confidence = Math.min(
      topPatterns.reduce((sum, [, count]) => sum + count, 0) / 100,
      1.0
    );

    logger.info('[VoiceTraining] 口音信息已更新');
  }

  /**
   * 记录命令使用
   */
  async recordCommandUsage(commandName, success = true) {
    if (!this.config.enableLearning) {return;}

    try {
      // 获取当前统计
      const stats = this.commandUsageStats.get(commandName) || {
        count: 0,
        successCount: 0,
        lastUsed: 0,
        averageConfidence: 0
      };

      // 更新统计
      stats.count++;
      if (success) {stats.successCount++;}
      stats.lastUsed = Date.now();

      this.commandUsageStats.set(commandName, stats);

      // 更新总命令数
      this.userProfile.learningStats.totalCommands++;

      await this.saveUserProfile();
    } catch (error) {
      logger.error('[VoiceTraining] 记录命令使用失败:', error);
    }
  }

  /**
   * 记录纠正
   */
  async recordCorrection(original, corrected, context = {}) {
    if (!this.config.enableLearning) {return;}

    try {
      const correction = {
        original: original,
        corrected: corrected,
        context: context,
        timestamp: Date.now()
      };

      this.correctionHistory.push(correction);

      // 限制历史大小
      if (this.correctionHistory.length > 1000) {
        this.correctionHistory = this.correctionHistory.slice(-1000);
      }

      // 更新统计
      this.userProfile.learningStats.totalCorrections++;

      // 学习纠正模式
      await this.learnCorrectionPattern(original, corrected);

      await this.saveUserProfile();
      this.emit('correctionRecorded', correction);
    } catch (error) {
      logger.error('[VoiceTraining] 记录纠正失败:', error);
    }
  }

  /**
   * 学习纠正模式
   */
  async learnCorrectionPattern(original, corrected) {
    // 分析常见的纠正模式
    const pattern = this.extractCorrectionPattern(original, corrected);

    if (pattern) {
      const currentCount = this.accentPatterns.get(pattern) || 0;
      this.accentPatterns.set(pattern, currentCount + 1);
    }
  }

  /**
   * 提取纠正模式
   */
  extractCorrectionPattern(original, corrected) {
    // 简化版本：记录完整的替换
    // 实际应用中应该提取更细粒度的模式
    if (original.length < 50 && corrected.length < 50) {
      return `${original} => ${corrected}`;
    }
    return null;
  }

  /**
   * 获取命令建议
   */
  getCommandSuggestions(limit = 5) {
    if (!this.userProfile.preferences.suggestCommands) {
      return [];
    }

    // 按使用频率和最近使用时间排序
    const suggestions = Array.from(this.commandUsageStats.entries())
      .map(([name, stats]) => ({
        name: name,
        count: stats.count,
        successRate: stats.successCount / stats.count,
        lastUsed: stats.lastUsed,
        score: this.calculateCommandScore(stats)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return suggestions;
  }

  /**
   * 计算命令分数
   */
  calculateCommandScore(stats) {
    const frequencyScore = Math.log(stats.count + 1);
    const successScore = stats.successCount / stats.count;
    const recencyScore = Math.exp(-(Date.now() - stats.lastUsed) / (7 * 24 * 60 * 60 * 1000)); // 7天衰减

    return frequencyScore * 0.4 + successScore * 0.3 + recencyScore * 0.3;
  }

  /**
   * 获取自定义词汇
   */
  getCustomVocabulary(minFrequency = 2) {
    return Array.from(this.customVocabulary.entries())
      .filter(([, count]) => count >= minFrequency)
      .sort((a, b) => b[1] - a[1])
      .map(([word, count]) => ({ word, count }));
  }

  /**
   * 添加自定义词汇
   */
  async addCustomWord(word, frequency = 1) {
    const currentCount = this.customVocabulary.get(word) || 0;
    this.customVocabulary.set(word, currentCount + frequency);
    await this.saveUserProfile();
    logger.info(`[VoiceTraining] 添加自定义词汇: ${word}`);
  }

  /**
   * 删除自定义词汇
   */
  async removeCustomWord(word) {
    this.customVocabulary.delete(word);
    await this.saveUserProfile();
    logger.info(`[VoiceTraining] 删除自定义词汇: ${word}`);
  }

  /**
   * 获取学习统计
   */
  getLearningStats() {
    return {
      ...this.userProfile.learningStats,
      vocabularySize: this.customVocabulary.size,
      commandCount: this.commandUsageStats.size,
      correctionCount: this.correctionHistory.length,
      accentPatternsCount: this.accentPatterns.size
    };
  }

  /**
   * 获取改进建议
   */
  getImprovementSuggestions() {
    const suggestions = [];
    const stats = this.userProfile.learningStats;

    // 置信度建议
    if (stats.averageConfidence < 0.7) {
      suggestions.push({
        type: 'confidence',
        priority: 'high',
        message: '语音识别置信度较低，建议在安静环境中使用，或调整麦克风位置',
        action: 'improve_audio_quality'
      });
    }

    // 纠正率建议
    if (stats.totalCorrections > 0 && stats.totalTranscriptions > 0) {
      const correctionRate = stats.totalCorrections / stats.totalTranscriptions;
      if (correctionRate > 0.3) {
        suggestions.push({
          type: 'correction',
          priority: 'medium',
          message: '纠正率较高，建议进行语音训练以提高识别准确度',
          action: 'start_voice_training'
        });
      }
    }

    // 命令使用建议
    if (this.commandUsageStats.size < 5 && stats.totalCommands > 20) {
      suggestions.push({
        type: 'commands',
        priority: 'low',
        message: '您可以尝试使用更多语音命令来提高效率',
        action: 'explore_commands'
      });
    }

    return suggestions;
  }

  /**
   * 导出用户数据
   */
  async exportUserData() {
    return {
      profile: this.userProfile,
      customVocabulary: Array.from(this.customVocabulary.entries()),
      commandUsageStats: Array.from(this.commandUsageStats.entries()),
      accentPatterns: Array.from(this.accentPatterns.entries()),
      correctionHistory: this.correctionHistory
    };
  }

  /**
   * 导入用户数据
   */
  async importUserData(data) {
    try {
      if (data.profile) {
        this.userProfile = data.profile;
      }

      if (data.customVocabulary) {
        this.customVocabulary = new Map(data.customVocabulary);
      }

      if (data.commandUsageStats) {
        this.commandUsageStats = new Map(data.commandUsageStats);
      }

      if (data.accentPatterns) {
        this.accentPatterns = new Map(data.accentPatterns);
      }

      if (data.correctionHistory) {
        this.correctionHistory = data.correctionHistory;
      }

      await this.saveUserProfile();
      logger.info('[VoiceTraining] 用户数据已导入');
      this.emit('dataImported');
    } catch (error) {
      logger.error('[VoiceTraining] 导入用户数据失败:', error);
      throw error;
    }
  }

  /**
   * 重置用户数据
   */
  async resetUserData() {
    this.userProfile = this.createDefaultProfile(this.currentUserId);
    this.customVocabulary.clear();
    this.commandUsageStats.clear();
    this.accentPatterns.clear();
    this.correctionHistory = [];

    await this.saveUserProfile();
    logger.info('[VoiceTraining] 用户数据已重置');
    this.emit('dataReset');
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    return {
      totalTranscriptions: this.userProfile?.learningStats?.totalTranscriptions || 0,
      averageConfidence: this.userProfile?.learningStats?.averageConfidence || 0,
      vocabularySize: this.customVocabulary.size || 0,
      totalCorrections: this.userProfile?.learningStats?.totalCorrections || 0,
      totalCommands: this.userProfile?.learningStats?.totalCommands || 0
    };
  }

  /**
   * 导出配置文件
   */
  async exportProfile() {
    try {
      const exportData = {
        profile: this.userProfile,
        customVocabulary: Array.from(this.customVocabulary.entries()),
        commandUsageStats: Array.from(this.commandUsageStats.entries()),
        accentPatterns: Array.from(this.accentPatterns.entries()),
        correctionHistory: this.correctionHistory,
        exportedAt: Date.now()
      };

      const exportPath = path.join(this.config.profilePath, `${this.currentUserId}_export_${Date.now()}.json`);
      await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2), 'utf-8');

      logger.info('[VoiceTraining] 配置文件已导出:', exportPath);
      return { success: true, path: exportPath };
    } catch (error) {
      logger.error('[VoiceTraining] 导出配置文件失败:', error);
      throw error;
    }
  }

  /**
   * 导入配置文件
   */
  async importProfile(filePath) {
    try {
      if (!filePath) {
        // 如果没有提供路径,查找最新的导出文件
        const files = await fs.readdir(this.config.profilePath);
        const exportFiles = files.filter(f => f.includes('_export_'));
        if (exportFiles.length === 0) {
          throw new Error('没有找到导出文件');
        }
        exportFiles.sort().reverse();
        filePath = path.join(this.config.profilePath, exportFiles[0]);
      }

      const data = await fs.readFile(filePath, 'utf-8');
      const importData = JSON.parse(data);

      await this.importUserData(importData);

      logger.info('[VoiceTraining] 配置文件已导入:', filePath);
      return { success: true };
    } catch (error) {
      logger.error('[VoiceTraining] 导入配置文件失败:', error);
      throw error;
    }
  }

  /**
   * 重置配置文件
   */
  async resetProfile() {
    await this.resetUserData();
    return { success: true };
  }
}

module.exports = VoiceTraining;
