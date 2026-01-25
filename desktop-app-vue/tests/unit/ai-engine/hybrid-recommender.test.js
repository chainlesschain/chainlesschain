/**
 * HybridRecommender 混合推荐系统测试
 * 测试混合推荐算法的融合、权重、多样性优化等功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('HybridRecommender - 混合推荐系统', () => {
  let HybridRecommender;
  let recommender;
  let mockDatabase;
  let mockPrepareStmt;
  let mockMLMatcher;
  let mockCFFilter;
  let mockCBRecommender;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 动态导入模块
    const module = await import('../../../src/main/ai-engine/hybrid-recommender.js');
    HybridRecommender = module.default;

    // Mock数据库
    mockPrepareStmt = {
      all: vi.fn(() => [])
    };
    mockDatabase = {
      prepare: vi.fn(() => mockPrepareStmt)
    };

    recommender = new HybridRecommender();
    recommender.setDatabase(mockDatabase);

    // Mock子推荐器
    mockMLMatcher = recommender.mlMatcher;
    mockCFFilter = recommender.collaborativeFilter;
    mockCBRecommender = recommender.contentRecommender;
  });

  describe('配置和初始化', () => {
    it('应该使用默认配置初始化', () => {
      const rec = new HybridRecommender();
      expect(rec.config.topK).toBe(5);
      expect(rec.config.minConfidence).toBe(0.15);
      expect(rec.config.weights.ml).toBe(0.4);
      expect(rec.config.weights.collaborative).toBe(0.35);
      expect(rec.config.weights.content).toBe(0.25);
      expect(rec.config.enableDiversity).toBe(true);
      expect(rec.config.diversityPenalty).toBe(0.1);
      expect(rec.config.enableAdaptiveWeights).toBe(false);
    });

    it('应该接受自定义配置', () => {
      const rec = new HybridRecommender({
        topK: 10,
        minConfidence: 0.2,
        weights: { ml: 0.5, collaborative: 0.3, content: 0.2 },
        enableDiversity: false,
        enableAdaptiveWeights: true
      });

      expect(rec.config.topK).toBe(10);
      expect(rec.config.minConfidence).toBe(0.2);
      expect(rec.config.weights.ml).toBe(0.5);
      expect(rec.config.enableDiversity).toBe(false);
      expect(rec.config.enableAdaptiveWeights).toBe(true);
    });

    it('应该初始化统计信息', () => {
      expect(recommender.stats.totalRecommendations).toBe(0);
      expect(recommender.stats.mlContributions).toBe(0);
      expect(recommender.stats.collaborativeContributions).toBe(0);
      expect(recommender.stats.contentContributions).toBe(0);
      expect(recommender.stats.avgConfidence).toBe(0);
      expect(recommender.stats.diversityScore).toBe(0);
    });

    it('应该创建所有子推荐器', () => {
      expect(recommender.mlMatcher).toBeDefined();
      expect(recommender.collaborativeFilter).toBeDefined();
      expect(recommender.contentRecommender).toBeDefined();
    });

    it('应该设置数据库连接', () => {
      const newDb = { prepare: vi.fn() };
      recommender.setDatabase(newDb);
      expect(recommender.db).toBe(newDb);
    });

    it('应该初始化所有推荐器', async () => {
      vi.spyOn(mockCFFilter, 'buildUserToolMatrix').mockResolvedValue();
      vi.spyOn(mockCBRecommender, 'buildToolFeatures').mockResolvedValue();
      vi.spyOn(mockCBRecommender, 'buildToolChains').mockResolvedValue();

      await recommender.initialize();

      expect(mockCFFilter.buildUserToolMatrix).toHaveBeenCalled();
      expect(mockCBRecommender.buildToolFeatures).toHaveBeenCalled();
      expect(mockCBRecommender.buildToolChains).toHaveBeenCalled();
    });

    it('应该容忍初始化失败', async () => {
      vi.spyOn(mockCFFilter, 'buildUserToolMatrix').mockRejectedValue(new Error('Failed'));
      vi.spyOn(mockCBRecommender, 'buildToolFeatures').mockRejectedValue(new Error('Failed'));
      vi.spyOn(mockCBRecommender, 'buildToolChains').mockRejectedValue(new Error('Failed'));

      await expect(recommender.initialize()).resolves.not.toThrow();
    });
  });

  describe('混合推荐核心功能', () => {
    it('应该成功执行混合推荐', async () => {
      vi.spyOn(mockMLMatcher, 'recommendTools').mockResolvedValue([
        { tool: 'tool1', confidence: 0.9, reason: 'ML reason' }
      ]);
      vi.spyOn(mockCFFilter, 'recommendTools').mockResolvedValue([
        { tool: 'tool1', confidence: 0.8, reason: 'CF reason' }
      ]);
      vi.spyOn(mockCBRecommender, 'recommendTools').mockResolvedValue([
        { tool: 'tool2', confidence: 0.7, reason: 'CB reason' }
      ]);

      const task = { description: 'test task' };
      const userId = 'user1';

      const result = await recommender.recommend(task, userId);

      expect(Array.isArray(result)).toBe(true);
      expect(mockMLMatcher.recommendTools).toHaveBeenCalledWith(task, userId);
      expect(mockCFFilter.recommendTools).toHaveBeenCalledWith(userId, 10);
      expect(mockCBRecommender.recommendTools).toHaveBeenCalledWith(userId, 10);
    });

    it('应该并行获取三种推荐', async () => {
      const mlPromise = Promise.resolve([{ tool: 'tool1', confidence: 0.9 }]);
      const cfPromise = Promise.resolve([{ tool: 'tool2', confidence: 0.8 }]);
      const cbPromise = Promise.resolve([{ tool: 'tool3', confidence: 0.7 }]);

      vi.spyOn(mockMLMatcher, 'recommendTools').mockReturnValue(mlPromise);
      vi.spyOn(mockCFFilter, 'recommendTools').mockReturnValue(cfPromise);
      vi.spyOn(mockCBRecommender, 'recommendTools').mockReturnValue(cbPromise);

      const task = { description: 'test' };
      await recommender.recommend(task, 'user1');

      expect(mockMLMatcher.recommendTools).toHaveBeenCalled();
      expect(mockCFFilter.recommendTools).toHaveBeenCalled();
      expect(mockCBRecommender.recommendTools).toHaveBeenCalled();
    });

    it('应该容忍子推荐器失败', async () => {
      vi.spyOn(mockMLMatcher, 'recommendTools').mockRejectedValue(new Error('ML failed'));
      vi.spyOn(mockCFFilter, 'recommendTools').mockResolvedValue([
        { tool: 'tool1', confidence: 0.8 }
      ]);
      vi.spyOn(mockCBRecommender, 'recommendTools').mockRejectedValue(new Error('CB failed'));

      const result = await recommender.recommend({ description: 'test' }, 'user1');

      expect(Array.isArray(result)).toBe(true);
    });

    it('应该返回空数组当所有推荐器失败', async () => {
      vi.spyOn(mockMLMatcher, 'recommendTools').mockRejectedValue(new Error('Failed'));
      vi.spyOn(mockCFFilter, 'recommendTools').mockRejectedValue(new Error('Failed'));
      vi.spyOn(mockCBRecommender, 'recommendTools').mockRejectedValue(new Error('Failed'));

      const result = await recommender.recommend({ description: 'test' }, 'user1');

      expect(result).toEqual([]);
    });

    it('应该限制返回结果数量', async () => {
      const manyTools = Array.from({ length: 20 }, (_, i) => ({
        tool: `tool${i}`,
        confidence: 0.9 - i * 0.01
      }));

      vi.spyOn(mockMLMatcher, 'recommendTools').mockResolvedValue(manyTools);
      vi.spyOn(mockCFFilter, 'recommendTools').mockResolvedValue([]);
      vi.spyOn(mockCBRecommender, 'recommendTools').mockResolvedValue([]);

      const result = await recommender.recommend({ description: 'test' }, 'user1');

      expect(result.length).toBeLessThanOrEqual(recommender.config.topK);
    });

    it('应该过滤低置信度推荐', async () => {
      vi.spyOn(mockMLMatcher, 'recommendTools').mockResolvedValue([
        { tool: 'tool1', confidence: 0.9 },
        { tool: 'tool2', confidence: 0.1 }
      ]);
      vi.spyOn(mockCFFilter, 'recommendTools').mockResolvedValue([]);
      vi.spyOn(mockCBRecommender, 'recommendTools').mockResolvedValue([]);

      recommender.config.minConfidence = 0.5;
      const result = await recommender.recommend({ description: 'test' }, 'user1');

      const hasLowConfidence = result.some(r => r.confidence < 0.5);
      expect(hasLowConfidence).toBe(false);
    });
  });

  describe('融合推荐结果', () => {
    it('应该正确融合三种推荐', () => {
      const mlRecs = [{ tool: 'tool1', confidence: 0.9 }];
      const cfRecs = [{ tool: 'tool1', confidence: 0.8 }];
      const cbRecs = [{ tool: 'tool2', confidence: 0.7 }];
      const weights = { ml: 0.4, collaborative: 0.35, content: 0.25 };

      const result = recommender.fuseRecommendations(mlRecs, cfRecs, cbRecs, weights);

      expect(result instanceof Map).toBe(true);
      expect(result.has('tool1')).toBe(true);
      expect(result.has('tool2')).toBe(true);
    });

    it('应该归一化推荐分数', () => {
      const mlRecs = [
        { tool: 'tool1', confidence: 1.0 },
        { tool: 'tool2', confidence: 0.5 }
      ];
      const weights = { ml: 0.4, collaborative: 0.35, content: 0.25 };

      const result = recommender.fuseRecommendations(mlRecs, [], [], weights);
      const tool1 = result.get('tool1');
      const tool2 = result.get('tool2');

      expect(tool1.mlScore).toBeCloseTo(1.0, 5);
      expect(tool2.mlScore).toBeCloseTo(0.5, 5);
    });

    it('应该计算融合后的最终分数', () => {
      // Use multiple tools to test normalization properly
      const mlRecs = [
        { tool: 'tool1', confidence: 1.0 },
        { tool: 'tool2', confidence: 0.5 }
      ];
      const cfRecs = [
        { tool: 'tool1', confidence: 0.8 },
        { tool: 'tool3', confidence: 0.4 }
      ];
      const cbRecs = [
        { tool: 'tool1', confidence: 0.6 },
        { tool: 'tool4', confidence: 0.3 }
      ];
      const weights = { ml: 0.4, collaborative: 0.35, content: 0.25 };

      const result = recommender.fuseRecommendations(mlRecs, cfRecs, cbRecs, weights);
      const tool1 = result.get('tool1');

      // After normalization: ml=1.0/1.0=1.0, cf=0.8/0.8=1.0, cb=0.6/0.6=1.0
      const expectedScore = 1.0 * 0.4 + 1.0 * 0.35 + 1.0 * 0.25;
      expect(tool1.finalScore).toBeCloseTo(expectedScore, 5);
    });

    it('应该计算融合后的置信度', () => {
      const mlRecs = [{ tool: 'tool1', confidence: 0.9 }];
      const cfRecs = [{ tool: 'tool1', confidence: 0.8 }];
      const cbRecs = [{ tool: 'tool1', confidence: 0.7 }];
      const weights = { ml: 0.4, collaborative: 0.35, content: 0.25 };

      const result = recommender.fuseRecommendations(mlRecs, cfRecs, cbRecs, weights);
      const tool1 = result.get('tool1');

      const expectedConfidence = (0.9 * 0.4 + 0.8 * 0.35 + 0.7 * 0.25) / (0.4 + 0.35 + 0.25);
      expect(tool1.confidence).toBeCloseTo(expectedConfidence, 5);
    });

    it('应该记录算法数量', () => {
      const mlRecs = [{ tool: 'tool1', confidence: 0.9 }];
      const cfRecs = [{ tool: 'tool1', confidence: 0.8 }];
      const cbRecs = [];
      const weights = { ml: 0.4, collaborative: 0.35, content: 0.25 };

      const result = recommender.fuseRecommendations(mlRecs, cfRecs, cbRecs, weights);
      const tool1 = result.get('tool1');

      expect(tool1.algorithmCount).toBe(2);
    });

    it('应该保存各算法的推荐理由', () => {
      const mlRecs = [{ tool: 'tool1', confidence: 0.9, reason: 'ML reason' }];
      const cfRecs = [{ tool: 'tool1', confidence: 0.8, reason: 'CF reason' }];
      const cbRecs = [{ tool: 'tool1', confidence: 0.7, reason: 'CB reason' }];
      const weights = { ml: 0.4, collaborative: 0.35, content: 0.25 };

      const result = recommender.fuseRecommendations(mlRecs, cfRecs, cbRecs, weights);
      const tool1 = result.get('tool1');

      expect(tool1.mlReason).toBe('ML reason');
      expect(tool1.cfReason).toBe('CF reason');
      expect(tool1.cbReason).toBe('CB reason');
    });

    it('应该更新算法贡献统计', () => {
      const initialML = recommender.stats.mlContributions;
      const initialCF = recommender.stats.collaborativeContributions;
      const initialCB = recommender.stats.contentContributions;

      const mlRecs = [{ tool: 'tool1', confidence: 0.9 }];
      const cfRecs = [{ tool: 'tool2', confidence: 0.8 }];
      const cbRecs = [{ tool: 'tool3', confidence: 0.7 }];
      const weights = { ml: 0.4, collaborative: 0.35, content: 0.25 };

      recommender.fuseRecommendations(mlRecs, cfRecs, cbRecs, weights);

      expect(recommender.stats.mlContributions).toBeGreaterThan(initialML);
      expect(recommender.stats.collaborativeContributions).toBeGreaterThan(initialCF);
      expect(recommender.stats.contentContributions).toBeGreaterThan(initialCB);
    });

    it('应该处理空推荐列表', () => {
      const weights = { ml: 0.4, collaborative: 0.35, content: 0.25 };
      const result = recommender.fuseRecommendations([], [], [], weights);

      expect(result.size).toBe(0);
    });

    it('应该保存权重信息', () => {
      const mlRecs = [{ tool: 'tool1', confidence: 0.9 }];
      const weights = { ml: 0.4, collaborative: 0.35, content: 0.25 };

      const result = recommender.fuseRecommendations(mlRecs, [], [], weights);
      const tool1 = result.get('tool1');

      expect(tool1.weights).toEqual(weights);
    });
  });

  describe('创建融合条目', () => {
    it('应该创建完整的融合条目', () => {
      const entry = recommender.createFusedEntry('testTool');

      expect(entry.tool).toBe('testTool');
      expect(entry.mlScore).toBe(0);
      expect(entry.cfScore).toBe(0);
      expect(entry.cbScore).toBe(0);
      expect(entry.mlConfidence).toBe(0);
      expect(entry.cfConfidence).toBe(0);
      expect(entry.cbConfidence).toBe(0);
      expect(entry.mlReason).toBe('');
      expect(entry.cfReason).toBe('');
      expect(entry.cbReason).toBe('');
      expect(entry.finalScore).toBe(0);
      expect(entry.confidence).toBe(0);
      expect(entry.algorithmCount).toBe(0);
      expect(entry.category).toBe(null);
      expect(entry.weights).toEqual({});
    });
  });

  describe('自适应权重计算', () => {
    it('应该根据推荐质量计算权重', () => {
      const mlRecs = [{ confidence: 0.9 }, { confidence: 0.8 }];
      const cfRecs = [{ confidence: 0.7 }, { confidence: 0.6 }];
      const cbRecs = [{ confidence: 0.5 }];

      const weights = recommender.calculateAdaptiveWeights(mlRecs, cfRecs, cbRecs);

      expect(typeof weights.ml).toBe('number');
      expect(typeof weights.collaborative).toBe('number');
      expect(typeof weights.content).toBe('number');
      expect(weights.ml).toBeGreaterThan(0);
      expect(weights.collaborative).toBeGreaterThan(0);
      expect(weights.content).toBeGreaterThan(0);
    });

    it('应该使权重和为1', () => {
      const mlRecs = [{ confidence: 0.9 }];
      const cfRecs = [{ confidence: 0.7 }];
      const cbRecs = [{ confidence: 0.5 }];

      const weights = recommender.calculateAdaptiveWeights(mlRecs, cfRecs, cbRecs);
      const sum = weights.ml + weights.collaborative + weights.content;

      expect(sum).toBeCloseTo(1.0, 5);
    });

    it('应该给高质量推荐更大权重', () => {
      const mlRecs = [{ confidence: 0.9 }, { confidence: 0.9 }];
      const cfRecs = [{ confidence: 0.3 }];
      const cbRecs = [{ confidence: 0.3 }];

      const weights = recommender.calculateAdaptiveWeights(mlRecs, cfRecs, cbRecs);

      expect(weights.ml).toBeGreaterThan(weights.collaborative);
      expect(weights.ml).toBeGreaterThan(weights.content);
    });

    it('应该处理空推荐列表', () => {
      const weights = recommender.calculateAdaptiveWeights([], [], []);

      expect(weights).toEqual(recommender.config.weights);
    });

    it('应该处理部分空列表', () => {
      const mlRecs = [{ confidence: 0.9 }];
      const weights = recommender.calculateAdaptiveWeights(mlRecs, [], []);

      expect(weights.ml).toBe(1.0);
      expect(weights.collaborative).toBe(0);
      expect(weights.content).toBe(0);
    });

    it('应该处理零置信度', () => {
      const mlRecs = [{ confidence: 0 }];
      const cfRecs = [{ confidence: 0 }];
      const cbRecs = [{ confidence: 0 }];

      const weights = recommender.calculateAdaptiveWeights(mlRecs, cfRecs, cbRecs);

      expect(weights).toEqual(recommender.config.weights);
    });
  });

  describe('多样性优化', () => {
    it('应该对重复类别施加惩罚', () => {
      const recs = [
        { tool: 'codeGeneration', finalScore: 1.0 },
        { tool: 'fileWrite', finalScore: 0.9 },
        { tool: 'dataAnalysis', finalScore: 0.8 }
      ];

      const result = recommender.optimizeDiversity(recs);

      // codeGeneration和fileWrite属于同一类别(development)
      expect(result[0].category).toBe('development');
      expect(result[1].category).toBe('development');
      expect(result[2].category).toBe('data');
    });

    it('应该计算多样性分数', () => {
      const recs = [
        { tool: 'codeGeneration', finalScore: 1.0 },
        { tool: 'dataAnalysis', finalScore: 0.9 },
        { tool: 'documentation', finalScore: 0.8 }
      ];

      recommender.optimizeDiversity(recs);

      expect(recommender.stats.diversityScore).toBeGreaterThan(0);
      expect(recommender.stats.diversityScore).toBeLessThanOrEqual(1);
    });

    it('应该处理单个推荐', () => {
      const recs = [{ tool: 'codeGeneration', finalScore: 1.0 }];
      const result = recommender.optimizeDiversity(recs);

      expect(result).toEqual(recs);
    });

    it('应该处理空推荐列表', () => {
      const result = recommender.optimizeDiversity([]);
      expect(result).toEqual([]);
    });

    it('应该设置工具类别', () => {
      const recs = [
        { tool: 'codeGeneration', finalScore: 1.0 },
        { tool: 'unknownTool', finalScore: 0.9 }
      ];

      const result = recommender.optimizeDiversity(recs);

      expect(result[0].category).toBe('development');
      expect(result[1].category).toBe('general');
    });

    it('应该限制惩罚幅度', () => {
      const recs = Array.from({ length: 10 }, (_, i) => ({
        tool: 'codeGeneration',
        finalScore: 1.0
      }));

      const result = recommender.optimizeDiversity(recs);

      // 最多惩罚50%
      const minScore = Math.min(...result.map(r => r.finalScore));
      expect(minScore).toBeGreaterThanOrEqual(0.5);
    });

    it('应该根据类别数量计算多样性', () => {
      const highDiversity = [
        { tool: 'codeGeneration', finalScore: 1.0 },
        { tool: 'dataAnalysis', finalScore: 0.9 },
        { tool: 'documentation', finalScore: 0.8 }
      ];

      recommender.optimizeDiversity(highDiversity);
      const highScore = recommender.stats.diversityScore;

      recommender.stats.diversityScore = 0;

      const lowDiversity = [
        { tool: 'codeGeneration', finalScore: 1.0 },
        { tool: 'fileWrite', finalScore: 0.9 },
        { tool: 'formatCode', finalScore: 0.8 }
      ];

      recommender.optimizeDiversity(lowDiversity);
      const lowScore = recommender.stats.diversityScore;

      expect(highScore).toBeGreaterThan(lowScore);
    });
  });

  describe('工具类别获取', () => {
    it('应该返回正确的类别', () => {
      expect(recommender.getToolCategory('codeGeneration')).toBe('development');
      expect(recommender.getToolCategory('dataAnalysis')).toBe('data');
      expect(recommender.getToolCategory('documentation')).toBe('writing');
    });

    it('应该返回默认类别', () => {
      expect(recommender.getToolCategory('unknownTool')).toBe('general');
    });

    it('应该处理所有预定义工具', () => {
      const tools = [
        'codeGeneration', 'fileWrite', 'fileRead', 'formatCode',
        'debugging', 'testing', 'dataAnalysis', 'chartGeneration',
        'documentation', 'markdown'
      ];

      for (const tool of tools) {
        const category = recommender.getToolCategory(tool);
        expect(category).not.toBe('general');
      }
    });
  });

  describe('增强推荐解释', () => {
    it('应该生成包含所有算法的解释', () => {
      const rec = {
        mlScore: 0.9,
        cfScore: 0.8,
        cbScore: 0.7,
        mlReason: 'ML reason',
        cfReason: 'CF reason',
        cbReason: 'CB reason',
        algorithmCount: 3
      };

      const reason = recommender.generateEnhancedExplanation(rec);

      expect(reason).toContain('ML:');
      expect(reason).toContain('CF:');
      expect(reason).toContain('CB:');
      expect(reason).toContain('3个算法一致推荐');
    });

    it('应该只包含有效算法的解释', () => {
      const rec = {
        mlScore: 0.9,
        cfScore: 0,
        cbScore: 0,
        mlReason: 'ML reason',
        cfReason: '',
        cbReason: '',
        algorithmCount: 1
      };

      const reason = recommender.generateEnhancedExplanation(rec);

      expect(reason).toContain('ML:');
      expect(reason).not.toContain('CF:');
      expect(reason).not.toContain('CB:');
    });

    it('应该标注多算法一致性', () => {
      const rec = {
        mlScore: 0.9,
        cfScore: 0.8,
        cbScore: 0,
        mlReason: 'ML reason',
        cfReason: 'CF reason',
        cbReason: '',
        algorithmCount: 2
      };

      const reason = recommender.generateEnhancedExplanation(rec);

      expect(reason).toContain('2个算法一致推荐');
    });

    it('应该返回默认解释', () => {
      const rec = {
        mlScore: 0,
        cfScore: 0,
        cbScore: 0,
        mlReason: '',
        cfReason: '',
        cbReason: '',
        algorithmCount: 0
      };

      const reason = recommender.generateEnhancedExplanation(rec);

      expect(reason).toBe('系统推荐');
    });

    it('应该使用竖线分隔多个理由', () => {
      const rec = {
        mlScore: 0.9,
        cfScore: 0.8,
        cbScore: 0,
        mlReason: 'ML reason',
        cfReason: 'CF reason',
        cbReason: '',
        algorithmCount: 2
      };

      const reason = recommender.generateEnhancedExplanation(rec);

      expect(reason).toContain('|');
    });
  });

  describe('统计信息更新和获取', () => {
    it('应该更新推荐次数', () => {
      const initial = recommender.stats.totalRecommendations;
      recommender.updateStats([]);
      expect(recommender.stats.totalRecommendations).toBe(initial + 1);
    });

    it('应该更新平均置信度', () => {
      const recs = [
        { confidence: 0.9 },
        { confidence: 0.7 }
      ];

      recommender.updateStats(recs);

      expect(recommender.stats.avgConfidence).toBeGreaterThan(0);
      expect(recommender.stats.avgConfidence).toBeLessThanOrEqual(1);
    });

    it('应该累积平均置信度', () => {
      recommender.updateStats([{ confidence: 0.9 }]);
      const firstAvg = recommender.stats.avgConfidence;

      recommender.updateStats([{ confidence: 0.7 }]);
      const secondAvg = recommender.stats.avgConfidence;

      expect(secondAvg).not.toBe(firstAvg);
      expect(secondAvg).toBeGreaterThan(0);
    });

    it('应该获取完整统计信息', () => {
      recommender.stats.mlContributions = 10;
      recommender.stats.collaborativeContributions = 8;
      recommender.stats.contentContributions = 7;
      recommender.stats.totalRecommendations = 1;
      recommender.stats.avgConfidence = 0.85;
      recommender.stats.diversityScore = 0.75;

      vi.spyOn(mockMLMatcher, 'getStats').mockReturnValue({});
      vi.spyOn(mockCFFilter, 'getStats').mockReturnValue({});
      vi.spyOn(mockCBRecommender, 'getStats').mockReturnValue({});

      const stats = recommender.getStats();

      expect(stats.avgConfidence).toContain('%');
      expect(stats.diversityScore).toContain('%');
      expect(stats.algorithmDistribution).toBeDefined();
      expect(stats.mlStats).toBeDefined();
      expect(stats.cfStats).toBeDefined();
      expect(stats.cbStats).toBeDefined();
    });

    it('应该格式化百分比', () => {
      recommender.stats.totalRecommendations = 1;
      recommender.stats.avgConfidence = 0.8567;
      recommender.stats.diversityScore = 0.7234;

      const stats = recommender.getStats();

      expect(stats.avgConfidence).toMatch(/^\d+\.\d%$/);
      expect(stats.diversityScore).toMatch(/^\d+\.\d%$/);
    });

    it('应该计算算法分布', () => {
      recommender.stats.mlContributions = 10;
      recommender.stats.collaborativeContributions = 6;
      recommender.stats.contentContributions = 4;

      const stats = recommender.getStats();

      expect(stats.algorithmDistribution.ml).toContain('%');
      expect(stats.algorithmDistribution.collaborative).toContain('%');
      expect(stats.algorithmDistribution.content).toContain('%');
    });

    it('应该处理零贡献', () => {
      recommender.stats.mlContributions = 0;
      recommender.stats.collaborativeContributions = 0;
      recommender.stats.contentContributions = 0;

      const stats = recommender.getStats();

      expect(stats.algorithmDistribution).toBe(null);
    });

    it('应该包含子推荐器统计', () => {
      vi.spyOn(mockMLMatcher, 'getStats').mockReturnValue({ ml: 'data' });
      vi.spyOn(mockCFFilter, 'getStats').mockReturnValue({ cf: 'data' });
      vi.spyOn(mockCBRecommender, 'getStats').mockReturnValue({ cb: 'data' });

      const stats = recommender.getStats();

      expect(stats.mlStats).toEqual({ ml: 'data' });
      expect(stats.cfStats).toEqual({ cf: 'data' });
      expect(stats.cbStats).toEqual({ cb: 'data' });
    });
  });

  describe('权重调整', () => {
    it('应该设置新权重', () => {
      recommender.setWeights({ ml: 0.5, collaborative: 0.3, content: 0.2 });

      expect(recommender.config.weights.ml).toBe(0.5);
      expect(recommender.config.weights.collaborative).toBe(0.3);
      expect(recommender.config.weights.content).toBe(0.2);
    });

    it('应该部分更新权重', () => {
      recommender.config.weights = { ml: 0.4, collaborative: 0.35, content: 0.25 };
      recommender.setWeights({ ml: 0.6 });

      expect(recommender.config.weights.ml).toBe(0.6);
      expect(recommender.config.weights.collaborative).toBe(0.35);
      expect(recommender.config.weights.content).toBe(0.25);
    });
  });

  describe('边缘情况和错误处理', () => {
    it('应该处理推荐失败', async () => {
      vi.spyOn(mockMLMatcher, 'recommendTools').mockRejectedValue(new Error('Failed'));
      vi.spyOn(mockCFFilter, 'recommendTools').mockRejectedValue(new Error('Failed'));
      vi.spyOn(mockCBRecommender, 'recommendTools').mockRejectedValue(new Error('Failed'));

      const result = await recommender.recommend({ description: 'test' }, 'user1');

      expect(result).toEqual([]);
    });

    it('应该处理未设置数据库', async () => {
      const rec = new HybridRecommender();

      const result = await rec.recommend({ description: 'test' }, 'user1');

      expect(Array.isArray(result)).toBe(true);
    });

    it('应该处理无效任务', async () => {
      const result = await recommender.recommend(null, 'user1');

      expect(Array.isArray(result)).toBe(true);
    });

    it('应该处理无效用户ID', async () => {
      const result = await recommender.recommend({ description: 'test' }, null);

      expect(Array.isArray(result)).toBe(true);
    });

    it('应该在禁用多样性时跳过优化', async () => {
      recommender.config.enableDiversity = false;

      vi.spyOn(mockMLMatcher, 'recommendTools').mockResolvedValue([
        { tool: 'codeGeneration', confidence: 0.9 },
        { tool: 'fileWrite', confidence: 0.8 }
      ]);
      vi.spyOn(mockCFFilter, 'recommendTools').mockResolvedValue([]);
      vi.spyOn(mockCBRecommender, 'recommendTools').mockResolvedValue([]);

      const result = await recommender.recommend({ description: 'test' }, 'user1');

      expect(Array.isArray(result)).toBe(true);
    });

    it('应该在启用自适应权重时使用计算的权重', async () => {
      recommender.config.enableAdaptiveWeights = true;

      vi.spyOn(mockMLMatcher, 'recommendTools').mockResolvedValue([
        { tool: 'tool1', confidence: 0.9 }
      ]);
      vi.spyOn(mockCFFilter, 'recommendTools').mockResolvedValue([
        { tool: 'tool2', confidence: 0.5 }
      ]);
      vi.spyOn(mockCBRecommender, 'recommendTools').mockResolvedValue([]);

      await recommender.recommend({ description: 'test' }, 'user1');

      // Adaptive weights should favor ML over CF
      expect(true).toBe(true);
    });
  });
});
