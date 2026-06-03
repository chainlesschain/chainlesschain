/**
 * MLToolMatcher ML工具匹配器测试
 * 测试基于特征的工具推荐、多因子评分等功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MLToolMatcher - ML工具匹配器', () => {
  let MLToolMatcher;
  let matcher;
  let mockDatabase;
  let mockPrepareStmt;
  let mockGetStmt;
  let mockFeatureExtractor;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 动态导入模块
    const module = await import('../../../src/main/ai-engine/ml-tool-matcher.js');
    MLToolMatcher = module.default;

    // Mock数据库
    mockGetStmt = vi.fn(() => ({ total: 0, successes: 0 }));
    mockPrepareStmt = {
      get: mockGetStmt,
      run: vi.fn(),
      all: vi.fn(() => [])
    };
    mockDatabase = {
      prepare: vi.fn(() => mockPrepareStmt)
    };

    matcher = new MLToolMatcher();
    matcher.setDatabase(mockDatabase);

    // Mock FeatureExtractor
    mockFeatureExtractor = matcher.featureExtractor;
  });

  describe('配置和初始化', () => {
    it('应该使用默认配置初始化', () => {
      const m = new MLToolMatcher();
      expect(m.config.topK).toBe(5);
      expect(m.config.minConfidence).toBe(0.3);
      expect(m.config.enableML).toBe(false);
      expect(m.config.scoreWeights.textMatch).toBe(0.3);
      expect(m.config.scoreWeights.userPreference).toBe(0.35);
      expect(m.config.scoreWeights.historicalSuccess).toBe(0.25);
      expect(m.config.scoreWeights.recency).toBe(0.1);
    });

    it('应该接受自定义配置', () => {
      const m = new MLToolMatcher({
        topK: 10,
        minConfidence: 0.5,
        enableML: true,
        mlModelPath: '/path/to/model',
        scoreWeights: {
          textMatch: 0.4,
          userPreference: 0.3,
          historicalSuccess: 0.2,
          recency: 0.1
        }
      });

      expect(m.config.topK).toBe(10);
      expect(m.config.minConfidence).toBe(0.5);
      expect(m.config.enableML).toBe(true);
      expect(m.config.mlModelPath).toBe('/path/to/model');
      expect(m.config.scoreWeights.textMatch).toBe(0.4);
    });

    it('应该初始化统计信息', () => {
      expect(matcher.stats.totalRecommendations).toBe(0);
      expect(matcher.stats.acceptedRecommendations).toBe(0);
      expect(matcher.stats.rejectedRecommendations).toBe(0);
      expect(matcher.stats.avgConfidence).toBe(0);
    });

    it('应该创建FeatureExtractor实例', () => {
      expect(matcher.featureExtractor).toBeDefined();
    });

    it('应该设置数据库连接', () => {
      const newDb = { prepare: vi.fn() };
      matcher.setDatabase(newDb);
      expect(matcher.db).toBe(newDb);
    });

    it('应该设置工具注册表', () => {
      const mockRegistry = {
        getAllTools: vi.fn(() => [])
      };
      matcher.setToolRegistry(mockRegistry);
      expect(matcher.toolRegistry).toBe(mockRegistry);
    });
  });

  describe('工具推荐核心功能', () => {
    beforeEach(() => {
      vi.spyOn(mockFeatureExtractor, 'extractFeatures').mockResolvedValue({
        text: {
          detectedCategory: 'development',
          keywords: [{ word: 'code', weight: 1.0 }]
        },
        user: {
          preferredTools: ['codeGeneration'],
          recentTools: [{ tool: 'codeGeneration', count: 5, successRate: 0.9 }]
        }
      });
    });

    it('应该成功推荐工具', async () => {
      const task = { description: 'Generate code for feature' };
      const userId = 'user1';

      const result = await matcher.recommendTools(task, userId);

      expect(Array.isArray(result)).toBe(true);
      expect(mockFeatureExtractor.extractFeatures).toHaveBeenCalledWith(task, userId);
    });

    it('应该返回Top-K推荐', async () => {
      matcher.config.topK = 3;
      const task = { description: 'Test task' };

      const result = await matcher.recommendTools(task, 'user1');

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('应该过滤低置信度推荐', async () => {
      matcher.config.minConfidence = 0.8;
      const task = { description: 'Test task' };

      const result = await matcher.recommendTools(task, 'user1');

      for (const rec of result) {
        expect(rec.confidence).toBeGreaterThanOrEqual(0.8);
      }
    });

    it('应该按分数降序排序', async () => {
      const task = { description: 'Test task' };
      const result = await matcher.recommendTools(task, 'user1');

      for (let i = 1; i < result.length; i++) {
        expect(result[i].score).toBeLessThanOrEqual(result[i - 1].score);
      }
    });

    it('应该生成推荐解释', async () => {
      const task = { description: 'Test task' };
      const result = await matcher.recommendTools(task, 'user1');

      for (const rec of result) {
        expect(rec.reason).toBeDefined();
        expect(typeof rec.reason).toBe('string');
      }
    });

    it('应该更新统计信息', async () => {
      const initial = matcher.stats.totalRecommendations;
      const task = { description: 'Test task' };

      await matcher.recommendTools(task, 'user1');

      expect(matcher.stats.totalRecommendations).toBe(initial + 1);
      expect(matcher.stats.avgConfidence).toBeGreaterThanOrEqual(0);
    });

    it('应该处理特征提取失败', async () => {
      vi.spyOn(mockFeatureExtractor, 'extractFeatures').mockRejectedValue(
        new Error('Extraction failed')
      );

      const result = await matcher.recommendTools({ description: 'Test' }, 'user1');

      expect(result).toEqual([]);
    });

    it('应该返回空数组当推荐失败', async () => {
      vi.spyOn(mockFeatureExtractor, 'extractFeatures').mockRejectedValue(
        new Error('Failed')
      );

      const result = await matcher.recommendTools({ description: 'Test' }, 'user1');

      expect(result).toEqual([]);
    });
  });

  describe('候选工具获取', () => {
    it('应该返回默认工具列表', () => {
      const features = {
        text: { detectedCategory: 'development' },
        user: { preferredTools: [], recentTools: [] }
      };

      const candidates = matcher.getCandidateTools(features);

      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]).toHaveProperty('name');
      expect(candidates[0]).toHaveProperty('category');
    });

    it('应该包含10个默认工具', () => {
      const candidates = matcher.getCandidateTools({});
      expect(candidates.length).toBe(10);
    });

    it('应该从工具注册表获取工具', () => {
      const mockTools = [
        { name: 'tool1', category: 'cat1', description: 'desc1', keywords: ['key1'] },
        { name: 'tool2', category: 'cat2', description: 'desc2', keywords: ['key2'] }
      ];

      const mockRegistry = {
        getAllTools: vi.fn(() => mockTools)
      };

      matcher.setToolRegistry(mockRegistry);
      const candidates = matcher.getCandidateTools({});

      expect(mockRegistry.getAllTools).toHaveBeenCalled();
      expect(candidates.length).toBe(2);
      expect(candidates[0].name).toBe('tool1');
    });

    it('应该映射工具属性', () => {
      const mockTools = [
        { name: 'tool1', category: 'cat1', description: 'desc1', keywords: ['key1'] }
      ];

      matcher.setToolRegistry({
        getAllTools: () => mockTools
      });

      const candidates = matcher.getCandidateTools({});

      expect(candidates[0]).toHaveProperty('name');
      expect(candidates[0]).toHaveProperty('category');
      expect(candidates[0]).toHaveProperty('description');
      expect(candidates[0]).toHaveProperty('keywords');
    });
  });

  describe('工具评分', () => {
    it('应该为所有工具计算评分', async () => {
      const candidates = [
        { name: 'tool1', category: 'development' },
        { name: 'tool2', category: 'data' }
      ];

      const features = {
        text: { detectedCategory: 'development', keywords: [] },
        user: { preferredTools: [], recentTools: [] }
      };

      const result = await matcher.scoreTools(candidates, features, 'user1');

      expect(result.length).toBe(2);
      expect(result[0]).toHaveProperty('tool');
      expect(result[0]).toHaveProperty('score');
      expect(result[0]).toHaveProperty('confidence');
      expect(result[0]).toHaveProperty('breakdown');
    });

    it('应该包含时间戳', async () => {
      const candidates = [{ name: 'tool1', category: 'development' }];
      const features = {
        text: { detectedCategory: 'development', keywords: [] },
        user: { preferredTools: [], recentTools: [] }
      };

      const result = await matcher.scoreTools(candidates, features, 'user1');

      expect(result[0].timestamp).toBeDefined();
      expect(typeof result[0].timestamp).toBe('number');
    });

    it('应该包含类别信息', async () => {
      const candidates = [{ name: 'tool1', category: 'development' }];
      const features = {
        text: { detectedCategory: 'development', keywords: [] },
        user: { preferredTools: [], recentTools: [] }
      };

      const result = await matcher.scoreTools(candidates, features, 'user1');

      expect(result[0].category).toBe('development');
    });
  });

  describe('工具评分计算', () => {
    const mockFeatures = {
      text: { detectedCategory: 'development', keywords: [{ word: 'code' }] },
      user: {
        preferredTools: ['codeGeneration'],
        recentTools: [{ tool: 'codeGeneration', count: 5, successRate: 0.9 }]
      }
    };

    it('应该计算加权总分', async () => {
      const tool = { name: 'codeGeneration', category: 'development' };
      const score = await matcher.calculateToolScore(tool, mockFeatures, 'user1');

      expect(score).toHaveProperty('total');
      expect(score.total).toBeGreaterThan(0);
    });

    it('应该包含所有评分组成部分', async () => {
      const tool = { name: 'codeGeneration', category: 'development' };
      const score = await matcher.calculateToolScore(tool, mockFeatures, 'user1');

      expect(score).toHaveProperty('textMatch');
      expect(score).toHaveProperty('userPreference');
      expect(score).toHaveProperty('historicalSuccess');
      expect(score).toHaveProperty('recency');
    });

    it('应该应用配置的权重', async () => {
      matcher.config.scoreWeights = {
        textMatch: 0.5,
        userPreference: 0.3,
        historicalSuccess: 0.1,
        recency: 0.1
      };

      const tool = { name: 'tool1', category: 'development' };
      const score = await matcher.calculateToolScore(tool, mockFeatures, 'user1');

      expect(typeof score.total).toBe('number');
    });
  });

  describe('文本匹配评分', () => {
    it('应该对类别匹配给予高分', () => {
      const tool = { name: 'codeGeneration', category: 'development' };
      const textFeatures = {
        detectedCategory: 'development',
        keywords: []
      };

      const score = matcher.calculateTextMatchScore(tool, textFeatures);

      expect(score).toBeGreaterThanOrEqual(0.5);
    });

    it('应该对关键词匹配加分', () => {
      const tool = { name: 'codeGeneration', category: 'development' };
      const textFeatures = {
        detectedCategory: 'other',
        keywords: [{ word: 'code' }]
      };

      const score = matcher.calculateTextMatchScore(tool, textFeatures);

      expect(score).toBeGreaterThan(0);
    });

    it('应该对描述匹配加分', () => {
      const tool = {
        name: 'tool1',
        category: 'development',
        description: 'Code generation tool'
      };
      const textFeatures = {
        detectedCategory: 'other',
        keywords: [{ word: 'code' }]
      };

      const score = matcher.calculateTextMatchScore(tool, textFeatures);

      expect(score).toBeGreaterThan(0);
    });

    it('应该限制最大分数为1.0', () => {
      const tool = {
        name: 'codeGeneration',
        category: 'development',
        description: 'code code code'
      };
      const textFeatures = {
        detectedCategory: 'development',
        keywords: [{ word: 'code' }, { word: 'generation' }, { word: 'development' }]
      };

      const score = matcher.calculateTextMatchScore(tool, textFeatures);

      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('应该处理无关键词情况', () => {
      const tool = { name: 'tool1', category: 'development' };
      const textFeatures = {
        detectedCategory: 'other',
        keywords: []
      };

      const score = matcher.calculateTextMatchScore(tool, textFeatures);

      expect(score).toBe(0);
    });
  });

  describe('用户偏好评分', () => {
    it('应该对偏好工具给予高分', () => {
      const tool = { name: 'codeGeneration' };
      const userFeatures = {
        preferredTools: ['codeGeneration', 'fileWrite'],
        recentTools: []
      };

      const score = matcher.calculatePreferenceScore(tool, userFeatures);

      expect(score).toBeGreaterThan(0.5);
    });

    it('应该根据偏好顺序调整分数', () => {
      const tool1 = { name: 'tool1' };
      const tool2 = { name: 'tool2' };
      const userFeatures = {
        preferredTools: ['tool1', 'tool2'],
        recentTools: []
      };

      const score1 = matcher.calculatePreferenceScore(tool1, userFeatures);
      const score2 = matcher.calculatePreferenceScore(tool2, userFeatures);

      expect(score1).toBeGreaterThan(score2);
    });

    it('应该对最近使用的工具加分', () => {
      const tool = { name: 'tool1' };
      const userFeatures = {
        preferredTools: [],
        recentTools: [{ tool: 'tool1', count: 5, successRate: 0.9 }]
      };

      const score = matcher.calculatePreferenceScore(tool, userFeatures);

      expect(score).toBeGreaterThan(0);
    });

    it('应该综合偏好和最近使用', () => {
      const tool = { name: 'tool1' };
      const userFeatures = {
        preferredTools: ['tool1'],
        recentTools: [{ tool: 'tool1', count: 5, successRate: 0.9 }]
      };

      const score = matcher.calculatePreferenceScore(tool, userFeatures);

      expect(score).toBeGreaterThan(0.5);
    });

    it('应该限制最大分数为1.0', () => {
      const tool = { name: 'tool1' };
      const userFeatures = {
        preferredTools: ['tool1'],
        recentTools: [{ tool: 'tool1', count: 100, successRate: 1.0 }]
      };

      const score = matcher.calculatePreferenceScore(tool, userFeatures);

      expect(score).toBeLessThanOrEqual(1.0);
    });
  });

  describe('历史成功率评分', () => {
    it('应该查询数据库获取历史数据', async () => {
      mockGetStmt.mockReturnValue({ total: 10, successes: 8 });

      const score = await matcher.calculateHistoricalSuccessScore(
        'tool1',
        'user1',
        { text: { detectedCategory: 'development' } }
      );

      expect(mockDatabase.prepare).toHaveBeenCalled();
      expect(mockGetStmt).toHaveBeenCalledWith('user1', 'tool1', 'development');
    });

    it('应该计算成功率', async () => {
      mockGetStmt.mockReturnValue({ total: 10, successes: 8 });

      const score = await matcher.calculateHistoricalSuccessScore(
        'tool1',
        'user1',
        { text: { detectedCategory: 'development' } }
      );

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('应该应用贝叶斯平滑', async () => {
      // 少量数据应该接近先验值(0.7)
      mockGetStmt.mockReturnValue({ total: 1, successes: 1 });

      const score = await matcher.calculateHistoricalSuccessScore(
        'tool1',
        'user1',
        { text: { detectedCategory: 'development' } }
      );

      expect(score).toBeLessThan(1.0);
      expect(score).toBeCloseTo(0.7, 1);
    });

    it('应该返回默认值当无历史记录', async () => {
      mockGetStmt.mockReturnValue({ total: 0, successes: 0 });

      const score = await matcher.calculateHistoricalSuccessScore(
        'tool1',
        'user1',
        { text: { detectedCategory: 'development' } }
      );

      expect(score).toBe(0.5);
    });

    it('应该返回默认值当数据库未设置', async () => {
      const m = new MLToolMatcher();
      const score = await m.calculateHistoricalSuccessScore(
        'tool1',
        'user1',
        { text: { detectedCategory: 'development' } }
      );

      expect(score).toBe(0.5);
    });

    it('应该处理数据库查询错误', async () => {
      mockDatabase.prepare.mockImplementation(() => {
        throw new Error('DB error');
      });

      const score = await matcher.calculateHistoricalSuccessScore(
        'tool1',
        'user1',
        { text: { detectedCategory: 'development' } }
      );

      expect(score).toBe(0.5);
    });
  });

  describe('最近使用评分', () => {
    it('应该对最近使用的工具评分', () => {
      const tool = { name: 'tool1' };
      const userFeatures = {
        recentTools: [{ tool: 'tool1', count: 5, successRate: 0.9 }]
      };

      const score = matcher.calculateRecencyScore(tool, userFeatures);

      expect(score).toBeGreaterThan(0);
    });

    it('应该归一化使用次数', () => {
      const tool = { name: 'tool1' };
      const userFeatures = {
        recentTools: [{ tool: 'tool1', count: 20, successRate: 1.0 }]
      };

      const score = matcher.calculateRecencyScore(tool, userFeatures);

      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('应该考虑成功率', () => {
      const tool = { name: 'tool1' };
      const lowSuccess = {
        recentTools: [{ tool: 'tool1', count: 10, successRate: 0.3 }]
      };
      const highSuccess = {
        recentTools: [{ tool: 'tool1', count: 10, successRate: 0.9 }]
      };

      const lowScore = matcher.calculateRecencyScore(tool, lowSuccess);
      const highScore = matcher.calculateRecencyScore(tool, highSuccess);

      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('应该返回0当工具不在最近列表中', () => {
      const tool = { name: 'tool1' };
      const userFeatures = {
        recentTools: [{ tool: 'tool2', count: 5, successRate: 0.9 }]
      };

      const score = matcher.calculateRecencyScore(tool, userFeatures);

      expect(score).toBe(0);
    });
  });

  describe('评分转置信度', () => {
    it('应该使用Sigmoid函数转换', () => {
      const score = 0.5;
      const confidence = matcher.scoreToConfidence(score);

      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThan(1);
    });

    it('应该对高分给予高置信度', () => {
      const highConfidence = matcher.scoreToConfidence(0.9);
      const lowConfidence = matcher.scoreToConfidence(0.1);

      expect(highConfidence).toBeGreaterThan(lowConfidence);
    });

    it('应该在0.5时约为0.5', () => {
      const confidence = matcher.scoreToConfidence(0.5);
      expect(confidence).toBeCloseTo(0.5, 1);
    });

    it('应该处理极值', () => {
      const veryHigh = matcher.scoreToConfidence(1.0);
      const veryLow = matcher.scoreToConfidence(0.0);

      expect(veryHigh).toBeGreaterThan(0.9);
      expect(veryLow).toBeLessThan(0.1);
    });
  });

  describe('推荐解释生成', () => {
    const mockFeatures = {
      text: { detectedCategory: 'development' },
      user: { preferredTools: [], recentTools: [] }
    };

    it('应该生成文本匹配理由', () => {
      const rec = {
        breakdown: {
          textMatch: 0.6,
          userPreference: 0.0,
          historicalSuccess: 0.0,
          recency: 0.0
        }
      };

      const reason = matcher.generateExplanation(rec, mockFeatures);

      expect(reason).toContain('development');
    });

    it('应该生成用户偏好理由', () => {
      const rec = {
        breakdown: {
          textMatch: 0.0,
          userPreference: 0.7,
          historicalSuccess: 0.0,
          recency: 0.0
        }
      };

      const reason = matcher.generateExplanation(rec, mockFeatures);

      expect(reason).toContain('使用习惯');
    });

    it('应该生成历史成功率理由', () => {
      const rec = {
        breakdown: {
          textMatch: 0.0,
          userPreference: 0.0,
          historicalSuccess: 0.8,
          recency: 0.0
        }
      };

      const reason = matcher.generateExplanation(rec, mockFeatures);

      expect(reason).toContain('成功率');
      expect(reason).toContain('80%');
    });

    it('应该生成最近使用理由', () => {
      const rec = {
        breakdown: {
          textMatch: 0.0,
          userPreference: 0.0,
          historicalSuccess: 0.0,
          recency: 0.6
        }
      };

      const reason = matcher.generateExplanation(rec, mockFeatures);

      expect(reason).toContain('最近常用');
    });

    it('应该组合多个理由', () => {
      const rec = {
        breakdown: {
          textMatch: 0.6,
          userPreference: 0.7,
          historicalSuccess: 0.8,
          recency: 0.6
        }
      };

      const reason = matcher.generateExplanation(rec, mockFeatures);

      expect(reason).toContain(',');
    });

    it('应该返回默认解释', () => {
      const rec = {
        breakdown: {
          textMatch: 0.0,
          userPreference: 0.0,
          historicalSuccess: 0.0,
          recency: 0.0
        }
      };

      const reason = matcher.generateExplanation(rec, mockFeatures);

      expect(reason).toBe('系统推荐');
    });
  });

  describe('推荐记录', () => {
    it('应该记录推荐到数据库', async () => {
      const task = {
        description: 'Test task',
        sessionId: 'session1',
        context: { key: 'value' }
      };
      const recommendations = [
        { tool: 'tool1', score: 0.9, confidence: 0.85 },
        { tool: 'tool2', score: 0.7, confidence: 0.65 }
      ];

      await matcher.logRecommendation('user1', task, recommendations);

      expect(mockDatabase.prepare).toHaveBeenCalled();
      expect(mockPrepareStmt.run).toHaveBeenCalled();
    });

    it('应该处理缺失的任务属性', async () => {
      const task = {};
      const recommendations = [];

      await matcher.logRecommendation('user1', task, recommendations);

      expect(mockPrepareStmt.run).toHaveBeenCalled();
    });

    it('应该记录算法类型', async () => {
      matcher.config.enableML = true;
      const task = { description: 'Test' };
      const recommendations = [];

      await matcher.logRecommendation('user1', task, recommendations);

      expect(mockPrepareStmt.run).toHaveBeenCalledWith(
        'user1',
        'unknown',
        'Test',
        null,
        '[]',
        '[]',
        'ml_model'
      );
    });

    it('应该处理数据库错误', async () => {
      mockDatabase.prepare.mockImplementation(() => {
        throw new Error('DB error');
      });

      await expect(
        matcher.logRecommendation('user1', {}, [])
      ).resolves.not.toThrow();
    });

    it('应该处理未设置数据库', async () => {
      const m = new MLToolMatcher();
      await expect(
        m.logRecommendation('user1', {}, [])
      ).resolves.not.toThrow();
    });
  });

  describe('反馈处理', () => {
    it('应该记录接受的反馈', async () => {
      const feedback = {
        action: 'accepted',
        actualTools: ['tool1'],
        wasHelpful: true
      };

      await matcher.feedbackRecommendation(123, feedback);

      expect(mockDatabase.prepare).toHaveBeenCalled();
      expect(mockPrepareStmt.run).toHaveBeenCalled();
      expect(matcher.stats.acceptedRecommendations).toBe(1);
    });

    it('应该记录拒绝的反馈', async () => {
      const feedback = {
        action: 'rejected',
        actualTools: [],
        wasHelpful: false
      };

      await matcher.feedbackRecommendation(123, feedback);

      expect(matcher.stats.rejectedRecommendations).toBe(1);
    });

    it('应该处理未设置数据库', async () => {
      const m = new MLToolMatcher();
      await expect(
        m.feedbackRecommendation(123, { action: 'accepted' })
      ).resolves.not.toThrow();
    });

    it('应该处理数据库错误', async () => {
      mockDatabase.prepare.mockImplementation(() => {
        throw new Error('DB error');
      });

      await expect(
        matcher.feedbackRecommendation(123, { action: 'accepted' })
      ).resolves.not.toThrow();
    });
  });

  describe('统计信息', () => {
    it('应该返回完整统计信息', () => {
      matcher.stats.totalRecommendations = 10;
      matcher.stats.acceptedRecommendations = 7;
      matcher.stats.rejectedRecommendations = 3;

      const stats = matcher.getStats();

      expect(stats.totalRecommendations).toBe(10);
      expect(stats.acceptedRecommendations).toBe(7);
      expect(stats.rejectedRecommendations).toBe(3);
      expect(stats.acceptanceRate).toBeDefined();
    });

    it('应该计算接受率', () => {
      matcher.stats.totalRecommendations = 10;
      matcher.stats.acceptedRecommendations = 7;

      const stats = matcher.getStats();

      expect(stats.acceptanceRate).toBe('70.00%');
    });

    it('应该处理零推荐', () => {
      matcher.stats.totalRecommendations = 0;

      const stats = matcher.getStats();

      expect(stats.acceptanceRate).toBe('0%');
    });
  });

  describe('批量推荐', () => {
    beforeEach(() => {
      vi.spyOn(mockFeatureExtractor, 'extractFeatures').mockResolvedValue({
        text: { detectedCategory: 'development', keywords: [] },
        user: { preferredTools: [], recentTools: [] }
      });
    });

    it('应该处理多个任务', async () => {
      const tasks = [
        { description: 'Task 1' },
        { description: 'Task 2' }
      ];

      const result = await matcher.recommendBatch(tasks, 'user1');

      expect(result.length).toBe(2);
      expect(result[0]).toHaveProperty('task');
      expect(result[0]).toHaveProperty('recommendations');
    });

    it('应该保持任务顺序', async () => {
      const tasks = [
        { description: 'Task 1' },
        { description: 'Task 2' }
      ];

      const result = await matcher.recommendBatch(tasks, 'user1');

      expect(result[0].task.description).toBe('Task 1');
      expect(result[1].task.description).toBe('Task 2');
    });

    it('应该处理空任务列表', async () => {
      const result = await matcher.recommendBatch([], 'user1');

      expect(result).toEqual([]);
    });
  });

  describe('边缘情况和错误处理', () => {
    it('应该处理空任务描述', async () => {
      vi.spyOn(mockFeatureExtractor, 'extractFeatures').mockResolvedValue({
        text: { detectedCategory: 'general', keywords: [] },
        user: { preferredTools: [], recentTools: [] }
      });

      const result = await matcher.recommendTools({ description: '' }, 'user1');

      expect(Array.isArray(result)).toBe(true);
    });

    it('应该处理无效用户ID', async () => {
      vi.spyOn(mockFeatureExtractor, 'extractFeatures').mockResolvedValue({
        text: { detectedCategory: 'general', keywords: [] },
        user: { preferredTools: [], recentTools: [] }
      });

      const result = await matcher.recommendTools({ description: 'Test' }, null);

      expect(Array.isArray(result)).toBe(true);
    });

    it('应该处理特征提取返回null', async () => {
      vi.spyOn(mockFeatureExtractor, 'extractFeatures').mockResolvedValue(null);

      const result = await matcher.recommendTools({ description: 'Test' }, 'user1');

      expect(result).toEqual([]);
    });

    it('应该处理所有工具都低于阈值', async () => {
      matcher.config.minConfidence = 0.99;

      vi.spyOn(mockFeatureExtractor, 'extractFeatures').mockResolvedValue({
        text: { detectedCategory: 'unknown', keywords: [] },
        user: { preferredTools: [], recentTools: [] }
      });

      const result = await matcher.recommendTools({ description: 'Test' }, 'user1');

      expect(result.length).toBe(0);
    });
  });
});
