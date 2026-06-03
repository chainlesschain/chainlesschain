import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * ContentRecommender 单元测试
 *
 * 测试基于内容的推荐算法，包括:
 * - 工具特征构建
 * - 特征向量创建
 * - 工具相似度计算
 * - 相似工具查找
 * - 工具链统计
 * - 内容推荐
 * - 工具链推荐
 * - 统计信息
 */

describe('ContentRecommender', () => {
  let ContentRecommender;
  let recommender;
  let mockDatabase;
  let mockPrepareStmt;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import('../../../src/main/ai-engine/content-recommender.js');
    ContentRecommender = module.default;

    // Mock database statement
    mockPrepareStmt = {
      all: vi.fn()
    };

    // Mock database
    mockDatabase = {
      prepare: vi.fn(() => mockPrepareStmt)
    };

    recommender = new ContentRecommender();
  });

  describe('构造函数和配置', () => {
    it('应该使用默认配置初始化', () => {
      const recommender = new ContentRecommender();
      expect(recommender.config.minSimilarity).toBe(0.2);
      expect(recommender.config.topKSimilar).toBe(5);
      expect(recommender.config.enableToolChain).toBe(true);
    });

    it('应该允许自定义配置', () => {
      const customConfig = {
        minSimilarity: 0.5,
        topKSimilar: 3,
        enableToolChain: false
      };
      const recommender = new ContentRecommender(customConfig);
      expect(recommender.config.minSimilarity).toBe(0.5);
      expect(recommender.config.topKSimilar).toBe(3);
      expect(recommender.config.enableToolChain).toBe(false);
    });

    it('应该初始化工具特征映射', () => {
      expect(recommender.toolFeatures).toBeInstanceOf(Map);
      expect(recommender.toolFeatures.size).toBe(0);
    });

    it('应该初始化工具相似度矩阵', () => {
      expect(recommender.toolSimilarity).toBeInstanceOf(Map);
      expect(recommender.toolSimilarity.size).toBe(0);
    });

    it('应该初始化工具链统计', () => {
      expect(recommender.toolChains).toBeInstanceOf(Map);
      expect(recommender.toolChains.size).toBe(0);
    });

    it('应该初始化统计信息', () => {
      expect(recommender.stats.totalRecommendations).toBe(0);
      expect(recommender.stats.toolChainRecommendations).toBe(0);
      expect(recommender.stats.avgSimilarity).toBe(0);
    });
  });

  describe('setDatabase', () => {
    it('应该设置数据库引用', () => {
      recommender.setDatabase(mockDatabase);
      expect(recommender.db).toBe(mockDatabase);
    });
  });

  describe('buildToolFeatures', () => {
    it('应该构建工具特征', async () => {
      const features = await recommender.buildToolFeatures();

      expect(features).toBeInstanceOf(Map);
      expect(features.size).toBeGreaterThan(0);
    });

    it('应该包含默认工具', async () => {
      await recommender.buildToolFeatures();

      expect(recommender.toolFeatures.has('codeGeneration')).toBe(true);
      expect(recommender.toolFeatures.has('fileWrite')).toBe(true);
      expect(recommender.toolFeatures.has('fileRead')).toBe(true);
      expect(recommender.toolFeatures.has('dataAnalysis')).toBe(true);
    });

    it('应该为每个工具创建特征对象', async () => {
      await recommender.buildToolFeatures();

      const feature = recommender.toolFeatures.get('codeGeneration');
      expect(feature).toHaveProperty('category');
      expect(feature).toHaveProperty('tags');
      expect(feature).toHaveProperty('description');
      expect(feature).toHaveProperty('vector');
    });

    it('应该将标签存储为Set', async () => {
      await recommender.buildToolFeatures();

      const feature = recommender.toolFeatures.get('codeGeneration');
      expect(feature.tags).toBeInstanceOf(Set);
      expect(feature.tags.size).toBeGreaterThan(0);
    });

    it('应该创建特征向量', async () => {
      await recommender.buildToolFeatures();

      const feature = recommender.toolFeatures.get('codeGeneration');
      expect(Array.isArray(feature.vector)).toBe(true);
      expect(feature.vector.length).toBeGreaterThan(0);
    });

    it('应该清空已有特征数据', async () => {
      recommender.toolFeatures.set('old_tool', {});
      await recommender.buildToolFeatures();

      expect(recommender.toolFeatures.has('old_tool')).toBe(false);
    });

    it('应该返回构建的特征映射', async () => {
      const features = await recommender.buildToolFeatures();

      expect(features).toBe(recommender.toolFeatures);
    });
  });

  describe('createFeatureVector', () => {
    it('应该创建特征向量', () => {
      const tool = {
        category: 'development',
        tags: ['code', 'generate', 'function'],
        description: 'Test tool'
      };

      const vector = recommender.createFeatureVector(tool);

      expect(Array.isArray(vector)).toBe(true);
      expect(vector.length).toBeGreaterThan(0);
    });

    it('应该编码类别特征', () => {
      const tool = {
        category: 'development',
        tags: [],
        description: 'Test'
      };

      const vector = recommender.createFeatureVector(tool);

      // categories = ['development', 'data', 'design', 'writing', 'testing', 'deployment']
      // 'development' 在索引0，所以前6个元素应该是 [1,0,0,0,0,0]
      expect(vector[0]).toBe(1);
      expect(vector[1]).toBe(0);
    });

    it('应该编码标签特征', () => {
      const tool = {
        category: 'development',
        tags: ['code', 'file'],
        description: 'Test'
      };

      const vector = recommender.createFeatureVector(tool);

      // 向量应该包含标签特征（在类别编码之后）
      expect(vector.length).toBeGreaterThan(6);
    });

    it('应该为不同工具生成不同向量', () => {
      const tool1 = {
        category: 'development',
        tags: ['code'],
        description: 'Tool 1'
      };
      const tool2 = {
        category: 'data',
        tags: ['data'],
        description: 'Tool 2'
      };

      const vector1 = recommender.createFeatureVector(tool1);
      const vector2 = recommender.createFeatureVector(tool2);

      expect(JSON.stringify(vector1)).not.toBe(JSON.stringify(vector2));
    });
  });

  describe('calculateToolSimilarity', () => {
    beforeEach(async () => {
      await recommender.buildToolFeatures();
    });

    it('应该计算工具相似度', () => {
      const similarity = recommender.calculateToolSimilarity('codeGeneration', 'formatCode');

      expect(typeof similarity).toBe('number');
      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it('应该为相同类别的工具返回较高相似度', () => {
      const sim1 = recommender.calculateToolSimilarity('codeGeneration', 'formatCode');
      const sim2 = recommender.calculateToolSimilarity('codeGeneration', 'dataAnalysis');

      // codeGeneration和formatCode都是development类别
      // codeGeneration和dataAnalysis是不同类别
      expect(sim1).toBeGreaterThan(sim2);
    });

    it('应该在工具不存在时返回0', () => {
      const similarity = recommender.calculateToolSimilarity('nonexistent1', 'nonexistent2');

      expect(similarity).toBe(0);
    });

    it('应该缓存相似度结果', () => {
      const sim1 = recommender.calculateToolSimilarity('codeGeneration', 'formatCode');
      const sim2 = recommender.calculateToolSimilarity('codeGeneration', 'formatCode');

      expect(sim1).toBe(sim2);
      expect(recommender.toolSimilarity.has('codeGeneration:formatCode')).toBe(true);
    });

    it('应该缓存对称性', () => {
      const sim1 = recommender.calculateToolSimilarity('codeGeneration', 'formatCode');
      const sim2 = recommender.calculateToolSimilarity('formatCode', 'codeGeneration');

      expect(sim1).toBe(sim2);
      expect(recommender.toolSimilarity.has('formatCode:codeGeneration')).toBe(true);
    });

    it('应该使用加权平均计算相似度', () => {
      // 测试相似度在合理范围内
      const similarity = recommender.calculateToolSimilarity('fileWrite', 'fileRead');

      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it('应该考虑标签相似度', () => {
      // fileWrite和fileRead都有'file'标签
      const sim1 = recommender.calculateToolSimilarity('fileWrite', 'fileRead');
      // codeGeneration没有'file'标签
      const sim2 = recommender.calculateToolSimilarity('codeGeneration', 'fileRead');

      expect(sim1).toBeGreaterThan(sim2);
    });
  });

  describe('findSimilarTools', () => {
    beforeEach(async () => {
      await recommender.buildToolFeatures();
    });

    it('应该查找相似工具', () => {
      const similarTools = recommender.findSimilarTools('codeGeneration');

      expect(Array.isArray(similarTools)).toBe(true);
      expect(similarTools.length).toBeGreaterThan(0);
    });

    it('应该过滤低相似度工具', () => {
      recommender.config.minSimilarity = 0.9;

      const similarTools = recommender.findSimilarTools('codeGeneration');

      for (const { similarity } of similarTools) {
        expect(similarity).toBeGreaterThanOrEqual(0.9);
      }
    });

    it('应该按相似度降序排序', () => {
      const similarTools = recommender.findSimilarTools('codeGeneration');

      for (let i = 1; i < similarTools.length; i++) {
        expect(similarTools[i - 1].similarity).toBeGreaterThanOrEqual(
          similarTools[i].similarity
        );
      }
    });

    it('应该限制返回Top-K工具', () => {
      recommender.config.topKSimilar = 2;

      const similarTools = recommender.findSimilarTools('codeGeneration');

      expect(similarTools.length).toBeLessThanOrEqual(2);
    });

    it('应该排除自己', () => {
      const similarTools = recommender.findSimilarTools('codeGeneration');

      const selfIncluded = similarTools.some(t => t.tool === 'codeGeneration');
      expect(selfIncluded).toBe(false);
    });

    it('应该在特征未构建时自动构建', () => {
      recommender.toolFeatures.clear();

      const similarTools = recommender.findSimilarTools('codeGeneration');

      expect(recommender.toolFeatures.size).toBeGreaterThan(0);
    });

    it('应该返回工具名和相似度', () => {
      const similarTools = recommender.findSimilarTools('codeGeneration');

      if (similarTools.length > 0) {
        expect(similarTools[0]).toHaveProperty('tool');
        expect(similarTools[0]).toHaveProperty('similarity');
        expect(typeof similarTools[0].similarity).toBe('number');
      }
    });

    it('应该处理不存在的工具', () => {
      const similarTools = recommender.findSimilarTools('nonexistent_tool');

      expect(similarTools).toEqual([]);
    });
  });

  describe('buildToolChains', () => {
    beforeEach(() => {
      recommender.setDatabase(mockDatabase);
    });

    it('应该在没有数据库时跳过', async () => {
      recommender.db = null;
      await recommender.buildToolChains();

      expect(recommender.toolChains.size).toBe(0);
    });

    it('应该构建工具链统计', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'fileRead', tool_name: 'dataAnalysis', count: 10 },
        { previous_tool: 'fileRead', tool_name: 'chartGeneration', count: 5 },
        { previous_tool: 'dataAnalysis', tool_name: 'chartGeneration', count: 8 }
      ]);

      await recommender.buildToolChains();

      expect(recommender.toolChains.size).toBeGreaterThan(0);
      expect(recommender.toolChains.has('fileRead')).toBe(true);
    });

    it('应该计算条件概率', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'tool1', tool_name: 'tool2', count: 10 },
        { previous_tool: 'tool1', tool_name: 'tool3', count: 5 }
      ]);

      await recommender.buildToolChains();

      const chain = recommender.toolChains.get('tool1');
      const total = 10 + 5;

      expect(chain[0].probability).toBeCloseTo(10 / total, 5);
      expect(chain[1].probability).toBeCloseTo(5 / total, 5);
    });

    it('应该清空已有工具链数据', async () => {
      recommender.toolChains.set('old_tool', []);
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'new_tool', tool_name: 'next_tool', count: 5 }
      ]);

      await recommender.buildToolChains();

      expect(recommender.toolChains.has('old_tool')).toBe(false);
      expect(recommender.toolChains.has('new_tool')).toBe(true);
    });

    it('应该处理空数据', async () => {
      mockPrepareStmt.all.mockReturnValue([]);

      await recommender.buildToolChains();

      expect(recommender.toolChains.size).toBe(0);
    });

    it('应该处理数据库错误', async () => {
      mockPrepareStmt.all.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(recommender.buildToolChains()).resolves.toBeUndefined();
    });

    it('应该为每个后续工具存储计数和概率', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'tool1', tool_name: 'tool2', count: 10 }
      ]);

      await recommender.buildToolChains();

      const chain = recommender.toolChains.get('tool1');
      expect(chain[0]).toHaveProperty('nextTool', 'tool2');
      expect(chain[0]).toHaveProperty('count', 10);
      expect(chain[0]).toHaveProperty('probability');
    });
  });

  describe('recommendTools', () => {
    beforeEach(async () => {
      recommender.setDatabase(mockDatabase);
      await recommender.buildToolFeatures();
    });

    it('应该在没有数据库时返回空数组', async () => {
      recommender.db = null;
      const recommendations = await recommender.recommendTools('user1', 5);

      expect(recommendations).toEqual([]);
    });

    it('应该推荐工具', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { tool_name: 'codeGeneration', last_used: '2026-01-25' },
        { tool_name: 'fileWrite', last_used: '2026-01-24' }
      ]);

      const recommendations = await recommender.recommendTools('user1', 5);

      expect(Array.isArray(recommendations)).toBe(true);
    });

    it('应该在用户无使用记录时返回空数组', async () => {
      mockPrepareStmt.all.mockReturnValue([]);

      const recommendations = await recommender.recommendTools('user1', 5);

      expect(recommendations).toEqual([]);
    });

    it('应该包含推荐元数据', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { tool_name: 'codeGeneration', last_used: '2026-01-25' }
      ]);

      const recommendations = await recommender.recommendTools('user1', 5);

      if (recommendations.length > 0) {
        const rec = recommendations[0];
        expect(rec).toHaveProperty('tool');
        expect(rec).toHaveProperty('score');
        expect(rec).toHaveProperty('confidence');
        expect(rec).toHaveProperty('reason');
        expect(rec).toHaveProperty('algorithm', 'content_based');
      }
    });

    it('应该按评分降序排序', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { tool_name: 'codeGeneration', last_used: '2026-01-25' },
        { tool_name: 'fileWrite', last_used: '2026-01-24' }
      ]);

      const recommendations = await recommender.recommendTools('user1', 5);

      for (let i = 1; i < recommendations.length; i++) {
        expect(recommendations[i - 1].score).toBeGreaterThanOrEqual(
          recommendations[i].score
        );
      }
    });

    it('应该限制推荐数量', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { tool_name: 'codeGeneration', last_used: '2026-01-25' }
      ]);

      const recommendations = await recommender.recommendTools('user1', 2);

      expect(recommendations.length).toBeLessThanOrEqual(2);
    });

    it('应该更新统计信息', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { tool_name: 'codeGeneration', last_used: '2026-01-25' }
      ]);

      const initialCount = recommender.stats.totalRecommendations;

      await recommender.recommendTools('user1', 5);

      expect(recommender.stats.totalRecommendations).toBe(initialCount + 1);
    });

    it('应该计算平均相似度', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { tool_name: 'codeGeneration', last_used: '2026-01-25' }
      ]);

      await recommender.recommendTools('user1', 5);

      if (recommender.stats.totalRecommendations > 0) {
        expect(recommender.stats.avgSimilarity).toBeGreaterThanOrEqual(0);
        expect(recommender.stats.avgSimilarity).toBeLessThanOrEqual(1);
      }
    });

    it('应该处理推荐失败', async () => {
      mockPrepareStmt.all.mockImplementation(() => {
        throw new Error('Database error');
      });

      const recommendations = await recommender.recommendTools('user1', 5);

      expect(recommendations).toEqual([]);
    });

    it('应该在特征未构建时自动构建', async () => {
      recommender.toolFeatures.clear();
      mockPrepareStmt.all.mockReturnValue([
        { tool_name: 'codeGeneration', last_used: '2026-01-25' }
      ]);

      await recommender.recommendTools('user1', 5);

      expect(recommender.toolFeatures.size).toBeGreaterThan(0);
    });

    it('应该基于多个最近使用的工具推荐', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { tool_name: 'codeGeneration', last_used: '2026-01-25' },
        { tool_name: 'fileWrite', last_used: '2026-01-24' },
        { tool_name: 'testing', last_used: '2026-01-23' }
      ]);

      const recommendations = await recommender.recommendTools('user1', 5);

      // 应该基于多个工具生成推荐
      expect(recommendations.length).toBeGreaterThan(0);
    });

    it('应该计算置信度', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { tool_name: 'codeGeneration', last_used: '2026-01-25' }
      ]);

      const recommendations = await recommender.recommendTools('user1', 5);

      if (recommendations.length > 0) {
        expect(recommendations[0].confidence).toBeGreaterThanOrEqual(0);
        expect(recommendations[0].confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('recommendNextTools', () => {
    beforeEach(() => {
      recommender.setDatabase(mockDatabase);
    });

    it('应该推荐后续工具', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'fileRead', tool_name: 'dataAnalysis', count: 10 },
        { previous_tool: 'fileRead', tool_name: 'chartGeneration', count: 5 }
      ]);

      await recommender.buildToolChains();
      const recommendations = await recommender.recommendNextTools('fileRead', 3);

      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBeGreaterThan(0);
    });

    it('应该在工具链未构建时自动构建', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'tool1', tool_name: 'tool2', count: 5 }
      ]);

      const recommendations = await recommender.recommendNextTools('tool1', 3);

      expect(recommender.toolChains.size).toBeGreaterThan(0);
    });

    it('应该在没有后续工具时返回空数组', async () => {
      mockPrepareStmt.all.mockReturnValue([]);
      await recommender.buildToolChains();

      const recommendations = await recommender.recommendNextTools('unknown_tool', 3);

      expect(recommendations).toEqual([]);
    });

    it('应该限制推荐数量', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'tool1', tool_name: 'tool2', count: 10 },
        { previous_tool: 'tool1', tool_name: 'tool3', count: 8 },
        { previous_tool: 'tool1', tool_name: 'tool4', count: 6 },
        { previous_tool: 'tool1', tool_name: 'tool5', count: 4 }
      ]);

      await recommender.buildToolChains();
      const recommendations = await recommender.recommendNextTools('tool1', 2);

      expect(recommendations.length).toBeLessThanOrEqual(2);
    });

    it('应该包含推荐元数据', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'tool1', tool_name: 'tool2', count: 10 }
      ]);

      await recommender.buildToolChains();
      const recommendations = await recommender.recommendNextTools('tool1', 3);

      if (recommendations.length > 0) {
        const rec = recommendations[0];
        expect(rec).toHaveProperty('tool');
        expect(rec).toHaveProperty('score');
        expect(rec).toHaveProperty('confidence');
        expect(rec).toHaveProperty('reason');
        expect(rec).toHaveProperty('algorithm', 'tool_chain');
      }
    });

    it('应该使用概率作为评分', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'tool1', tool_name: 'tool2', count: 10 },
        { previous_tool: 'tool1', tool_name: 'tool3', count: 5 }
      ]);

      await recommender.buildToolChains();
      const recommendations = await recommender.recommendNextTools('tool1', 3);

      expect(recommendations[0].score).toBeCloseTo(10 / 15, 5);
      expect(recommendations[1].score).toBeCloseTo(5 / 15, 5);
    });

    it('应该更新工具链推荐统计', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'tool1', tool_name: 'tool2', count: 10 }
      ]);

      await recommender.buildToolChains();
      const initialCount = recommender.stats.toolChainRecommendations;

      await recommender.recommendNextTools('tool1', 3);

      expect(recommender.stats.toolChainRecommendations).toBe(initialCount + 1);
    });

    it('应该生成包含百分比的推荐理由', async () => {
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'tool1', tool_name: 'tool2', count: 10 }
      ]);

      await recommender.buildToolChains();
      const recommendations = await recommender.recommendNextTools('tool1', 3);

      if (recommendations.length > 0) {
        expect(recommendations[0].reason).toMatch(/\d+%/);
        expect(recommendations[0].reason).toContain('tool1');
      }
    });
  });

  describe('generateReason', () => {
    it('应该生成推荐理由', () => {
      const basedOnTools = [
        { tool: 'codeGeneration', similarity: 0.85 },
        { tool: 'formatCode', similarity: 0.75 }
      ];

      const reason = recommender.generateReason(basedOnTools);

      expect(reason).toContain('codeGeneration');
      expect(reason).toContain('85%');
    });

    it('应该处理空工具列表', () => {
      const reason = recommender.generateReason([]);

      expect(reason).toBe('基于内容推荐');
    });

    it('应该格式化相似度百分比', () => {
      const basedOnTools = [
        { tool: 'testTool', similarity: 0.456 }
      ];

      const reason = recommender.generateReason(basedOnTools);

      expect(reason).toContain('46%'); // 四舍五入
    });

    it('应该只使用第一个工具', () => {
      const basedOnTools = [
        { tool: 'tool1', similarity: 0.9 },
        { tool: 'tool2', similarity: 0.8 }
      ];

      const reason = recommender.generateReason(basedOnTools);

      expect(reason).toContain('tool1');
      expect(reason).not.toContain('tool2');
    });
  });

  describe('getStats', () => {
    it('应该返回统计信息', () => {
      const stats = recommender.getStats();

      expect(stats).toHaveProperty('totalRecommendations');
      expect(stats).toHaveProperty('toolChainRecommendations');
      expect(stats).toHaveProperty('avgSimilarity');
      expect(stats).toHaveProperty('toolCount');
      expect(stats).toHaveProperty('toolChainCount');
    });

    it('应该包含工具数量', async () => {
      await recommender.buildToolFeatures();
      const stats = recommender.getStats();

      expect(stats.toolCount).toBeGreaterThan(0);
    });

    it('应该包含工具链数量', async () => {
      recommender.setDatabase(mockDatabase);
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'tool1', tool_name: 'tool2', count: 5 }
      ]);
      await recommender.buildToolChains();

      const stats = recommender.getStats();

      expect(stats.toolChainCount).toBeGreaterThan(0);
    });

    it('应该格式化平均相似度为百分比', () => {
      recommender.stats.avgSimilarity = 0.75;

      const stats = recommender.getStats();

      expect(stats.avgSimilarity).toBe('75.0%');
    });

    it('应该在没有数据时返回0', () => {
      const stats = recommender.getStats();

      expect(stats.totalRecommendations).toBe(0);
      expect(stats.toolChainRecommendations).toBe(0);
      expect(stats.toolCount).toBe(0);
      expect(stats.toolChainCount).toBe(0);
    });
  });

  describe('边界情况和错误处理', () => {
    it('应该处理空特征向量', () => {
      const tool = {
        category: 'unknown',
        tags: [],
        description: 'Test'
      };

      const vector = recommender.createFeatureVector(tool);

      expect(Array.isArray(vector)).toBe(true);
      expect(vector.length).toBeGreaterThan(0);
    });

    it('应该处理相同工具的相似度计算', async () => {
      await recommender.buildToolFeatures();

      const similarity = recommender.calculateToolSimilarity('codeGeneration', 'codeGeneration');

      // 不应该返回相同工具的相似度（会在findSimilarTools中过滤）
      expect(similarity).toBeGreaterThanOrEqual(0);
    });

    it('应该处理高相似度阈值', async () => {
      await recommender.buildToolFeatures();
      recommender.config.minSimilarity = 0.99;

      const similarTools = recommender.findSimilarTools('codeGeneration');

      // 可能没有符合条件的工具
      expect(Array.isArray(similarTools)).toBe(true);
    });

    it('应该处理单个工具链', async () => {
      recommender.setDatabase(mockDatabase);
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'tool1', tool_name: 'tool2', count: 100 }
      ]);

      await recommender.buildToolChains();
      const chain = recommender.toolChains.get('tool1');

      expect(chain[0].probability).toBe(1.0);
    });

    it('应该处理极端概率', async () => {
      recommender.setDatabase(mockDatabase);
      mockPrepareStmt.all.mockReturnValue([
        { previous_tool: 'tool1', tool_name: 'tool2', count: 1 },
        { previous_tool: 'tool1', tool_name: 'tool3', count: 999 }
      ]);

      await recommender.buildToolChains();
      const chain = recommender.toolChains.get('tool1');

      const probSum = chain.reduce((sum, t) => sum + t.probability, 0);
      expect(probSum).toBeCloseTo(1.0, 5);
    });
  });
});
