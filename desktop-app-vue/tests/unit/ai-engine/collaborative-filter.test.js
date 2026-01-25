import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * CollaborativeFilter 单元测试
 *
 * 测试协同过滤推荐算法，包括:
 * - 用户-工具矩阵构建
 * - 余弦相似度计算
 * - 相似用户查找
 * - 工具推荐生成
 * - 评分预测
 * - 缓存机制
 * - 统计信息
 */

describe('CollaborativeFilter', () => {
  let CollaborativeFilter;
  let filter;
  let mockDatabase;
  let mockPrepareStmt;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import('../../../src/main/ai-engine/collaborative-filter.js');
    CollaborativeFilter = module.default;

    // Mock database statement
    mockPrepareStmt = {
      all: vi.fn()
    };

    // Mock database
    mockDatabase = {
      prepare: vi.fn(() => mockPrepareStmt)
    };

    filter = new CollaborativeFilter();
  });

  describe('构造函数和配置', () => {
    it('应该使用默认配置初始化', () => {
      const filter = new CollaborativeFilter();
      expect(filter.config.minSimilarity).toBe(0.1);
      expect(filter.config.topKUsers).toBe(10);
      expect(filter.config.minCommonTools).toBe(2);
      expect(filter.config.enableCache).toBe(true);
    });

    it('应该允许自定义配置', () => {
      const customConfig = {
        minSimilarity: 0.3,
        topKUsers: 5,
        minCommonTools: 3,
        enableCache: false
      };
      const filter = new CollaborativeFilter(customConfig);
      expect(filter.config.minSimilarity).toBe(0.3);
      expect(filter.config.topKUsers).toBe(5);
      expect(filter.config.minCommonTools).toBe(3);
      expect(filter.config.enableCache).toBe(false);
    });

    it('应该初始化用户-工具矩阵', () => {
      expect(filter.userToolMatrix).toBeInstanceOf(Map);
      expect(filter.userToolMatrix.size).toBe(0);
    });

    it('应该初始化相似度缓存', () => {
      expect(filter.similarityCache).toBeInstanceOf(Map);
      expect(filter.similarityCache.size).toBe(0);
    });

    it('应该初始化统计信息', () => {
      expect(filter.stats.totalRecommendations).toBe(0);
      expect(filter.stats.cacheHits).toBe(0);
      expect(filter.stats.cacheMisses).toBe(0);
      expect(filter.stats.avgSimilarity).toBe(0);
    });
  });

  describe('setDatabase', () => {
    it('应该设置数据库引用', () => {
      filter.setDatabase(mockDatabase);
      expect(filter.db).toBe(mockDatabase);
    });
  });

  describe('buildUserToolMatrix', () => {
    beforeEach(() => {
      filter.setDatabase(mockDatabase);
    });

    it('应该在没有数据库时抛出错误', async () => {
      filter.db = null;
      await expect(filter.buildUserToolMatrix()).rejects.toThrow('数据库未设置');
    });

    it('应该构建用户-工具矩阵', async () => {
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'user1',
          tool_name: 'html_generator',
          usage_count: 10,
          success_rate: 0.9,
          avg_time: 1500
        },
        {
          user_id: 'user1',
          tool_name: 'css_generator',
          usage_count: 5,
          success_rate: 0.8,
          avg_time: 1200
        },
        {
          user_id: 'user2',
          tool_name: 'html_generator',
          usage_count: 8,
          success_rate: 0.85,
          avg_time: 1600
        }
      ]);

      const matrix = await filter.buildUserToolMatrix();

      expect(matrix.size).toBe(2);
      expect(matrix.has('user1')).toBe(true);
      expect(matrix.has('user2')).toBe(true);
      expect(matrix.get('user1').size).toBe(2);
      expect(matrix.get('user2').size).toBe(1);
    });

    it('应该计算评分 (使用次数 * 成功率)', async () => {
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'user1',
          tool_name: 'html_generator',
          usage_count: 10,
          success_rate: 1.0,
          avg_time: 1500
        }
      ]);

      await filter.buildUserToolMatrix();

      const userTools = filter.userToolMatrix.get('user1');
      const toolData = userTools.get('html_generator');

      expect(toolData).toHaveProperty('rating');
      expect(toolData).toHaveProperty('usageCount', 10);
      expect(toolData).toHaveProperty('successRate', 1.0);
      expect(toolData).toHaveProperty('avgTime', 1500);
    });

    it('应该限制评分在1-5范围内', async () => {
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'user1',
          tool_name: 'tool1',
          usage_count: 1,
          success_rate: 0.1,
          avg_time: 100
        },
        {
          user_id: 'user2',
          tool_name: 'tool2',
          usage_count: 1000,
          success_rate: 1.0,
          avg_time: 100
        }
      ]);

      await filter.buildUserToolMatrix();

      const rating1 = filter.userToolMatrix.get('user1').get('tool1').rating;
      const rating2 = filter.userToolMatrix.get('user2').get('tool2').rating;

      expect(rating1).toBeGreaterThanOrEqual(1);
      expect(rating1).toBeLessThanOrEqual(5);
      expect(rating2).toBeGreaterThanOrEqual(1);
      expect(rating2).toBeLessThanOrEqual(5);
    });

    it('应该清空已有矩阵数据', async () => {
      filter.userToolMatrix.set('old_user', new Map());
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'new_user',
          tool_name: 'tool1',
          usage_count: 5,
          success_rate: 0.8,
          avg_time: 1000
        }
      ]);

      await filter.buildUserToolMatrix();

      expect(filter.userToolMatrix.has('old_user')).toBe(false);
      expect(filter.userToolMatrix.has('new_user')).toBe(true);
    });

    it('应该处理空数据', async () => {
      mockPrepareStmt.all.mockReturnValue([]);

      const matrix = await filter.buildUserToolMatrix();

      expect(matrix.size).toBe(0);
    });

    it('应该处理数据库错误', async () => {
      mockPrepareStmt.all.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(filter.buildUserToolMatrix()).rejects.toThrow('Database error');
    });
  });

  describe('calculateUserSimilarity', () => {
    beforeEach(() => {
      // 设置测试数据
      const user1Tools = new Map([
        ['tool1', { rating: 5, usageCount: 10, successRate: 0.9, avgTime: 1000 }],
        ['tool2', { rating: 4, usageCount: 8, successRate: 0.8, avgTime: 1200 }],
        ['tool3', { rating: 3, usageCount: 5, successRate: 0.7, avgTime: 1500 }]
      ]);

      const user2Tools = new Map([
        ['tool1', { rating: 4, usageCount: 9, successRate: 0.85, avgTime: 1100 }],
        ['tool2', { rating: 5, usageCount: 10, successRate: 0.9, avgTime: 1000 }],
        ['tool4', { rating: 3, usageCount: 4, successRate: 0.6, avgTime: 1800 }]
      ]);

      filter.userToolMatrix.set('user1', user1Tools);
      filter.userToolMatrix.set('user2', user2Tools);
    });

    it('应该计算余弦相似度', () => {
      const similarity = filter.calculateUserSimilarity('user1', 'user2');

      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it('应该在没有共同工具时返回0', () => {
      const user3Tools = new Map([
        ['tool5', { rating: 5, usageCount: 10, successRate: 0.9, avgTime: 1000 }]
      ]);
      filter.userToolMatrix.set('user3', user3Tools);

      const similarity = filter.calculateUserSimilarity('user1', 'user3');

      expect(similarity).toBe(0);
    });

    it('应该在共同工具数不足时返回0', () => {
      filter.config.minCommonTools = 3;

      // user1和user2只有2个共同工具 (tool1, tool2)
      const similarity = filter.calculateUserSimilarity('user1', 'user2');

      expect(similarity).toBe(0);
    });

    it('应该在用户不存在时返回0', () => {
      const similarity1 = filter.calculateUserSimilarity('user1', 'nonexistent');
      const similarity2 = filter.calculateUserSimilarity('nonexistent', 'user2');

      expect(similarity1).toBe(0);
      expect(similarity2).toBe(0);
    });

    it('应该使用缓存', () => {
      filter.config.enableCache = true;

      const similarity1 = filter.calculateUserSimilarity('user1', 'user2');
      const similarity2 = filter.calculateUserSimilarity('user1', 'user2');

      expect(similarity1).toBe(similarity2);
      expect(filter.stats.cacheHits).toBe(1);
      expect(filter.stats.cacheMisses).toBe(1);
    });

    it('应该缓存对称性', () => {
      filter.config.enableCache = true;

      const similarity1 = filter.calculateUserSimilarity('user1', 'user2');
      const similarity2 = filter.calculateUserSimilarity('user2', 'user1');

      expect(similarity1).toBe(similarity2);
      expect(filter.stats.cacheHits).toBe(1);
    });

    it('应该在禁用缓存时不使用缓存', () => {
      filter.config.enableCache = false;

      filter.calculateUserSimilarity('user1', 'user2');
      filter.calculateUserSimilarity('user1', 'user2');

      expect(filter.stats.cacheHits).toBe(0);
      expect(filter.stats.cacheMisses).toBe(2);
    });

    it('应该处理norm为0的情况', () => {
      const user4Tools = new Map([
        ['tool1', { rating: 0, usageCount: 0, successRate: 0, avgTime: 0 }]
      ]);
      filter.userToolMatrix.set('user4', user4Tools);

      const similarity = filter.calculateUserSimilarity('user1', 'user4');

      expect(similarity).toBe(0);
    });
  });

  describe('findSimilarUsers', () => {
    beforeEach(async () => {
      filter.setDatabase(mockDatabase);
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'user1',
          tool_name: 'tool1',
          usage_count: 10,
          success_rate: 0.9,
          avg_time: 1000
        },
        {
          user_id: 'user1',
          tool_name: 'tool2',
          usage_count: 8,
          success_rate: 0.8,
          avg_time: 1100
        },
        {
          user_id: 'user2',
          tool_name: 'tool1',
          usage_count: 9,
          success_rate: 0.85,
          avg_time: 1100
        },
        {
          user_id: 'user2',
          tool_name: 'tool2',
          usage_count: 7,
          success_rate: 0.75,
          avg_time: 1200
        },
        {
          user_id: 'user3',
          tool_name: 'tool1',
          usage_count: 8,
          success_rate: 0.8,
          avg_time: 1200
        },
        {
          user_id: 'user3',
          tool_name: 'tool2',
          usage_count: 6,
          success_rate: 0.7,
          avg_time: 1300
        }
      ]);

      await filter.buildUserToolMatrix();
    });

    it('应该查找相似用户', async () => {
      filter.config.minSimilarity = 0.1;

      const similarUsers = await filter.findSimilarUsers('user1');

      expect(Array.isArray(similarUsers)).toBe(true);
      expect(similarUsers.length).toBeGreaterThan(0);
    });

    it('应该过滤低相似度用户', async () => {
      filter.config.minSimilarity = 0.99; // 很高的阈值

      const similarUsers = await filter.findSimilarUsers('user1');

      // 由于user1、user2、user3都有相同的工具且评分相似，相似度很高
      // 所以即使阈值是0.99，也可能有相似用户
      // 验证返回的用户相似度都大于等于阈值
      for (const user of similarUsers) {
        expect(user.similarity).toBeGreaterThanOrEqual(0.99);
      }
    });

    it('应该按相似度降序排序', async () => {
      const similarUsers = await filter.findSimilarUsers('user1');

      for (let i = 1; i < similarUsers.length; i++) {
        expect(similarUsers[i - 1].similarity).toBeGreaterThanOrEqual(
          similarUsers[i].similarity
        );
      }
    });

    it('应该限制返回Top-K用户', async () => {
      filter.config.topKUsers = 1;

      const similarUsers = await filter.findSimilarUsers('user1');

      expect(similarUsers.length).toBeLessThanOrEqual(1);
    });

    it('应该排除自己', async () => {
      const similarUsers = await filter.findSimilarUsers('user1');

      const selfIncluded = similarUsers.some(u => u.userId === 'user1');
      expect(selfIncluded).toBe(false);
    });

    it('应该在矩阵为空时构建矩阵', async () => {
      filter.userToolMatrix.clear();

      const similarUsers = await filter.findSimilarUsers('user1');

      expect(filter.userToolMatrix.size).toBeGreaterThan(0);
    });

    it('应该返回用户ID和相似度', async () => {
      const similarUsers = await filter.findSimilarUsers('user1');

      if (similarUsers.length > 0) {
        expect(similarUsers[0]).toHaveProperty('userId');
        expect(similarUsers[0]).toHaveProperty('similarity');
        expect(typeof similarUsers[0].similarity).toBe('number');
      }
    });
  });

  describe('recommendTools', () => {
    beforeEach(async () => {
      filter.setDatabase(mockDatabase);
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'user1',
          tool_name: 'tool1',
          usage_count: 10,
          success_rate: 0.9,
          avg_time: 1000
        },
        {
          user_id: 'user2',
          tool_name: 'tool1',
          usage_count: 9,
          success_rate: 0.85,
          avg_time: 1100
        },
        {
          user_id: 'user2',
          tool_name: 'tool2',
          usage_count: 8,
          success_rate: 0.8,
          avg_time: 1200
        }
      ]);

      await filter.buildUserToolMatrix();
    });

    it('应该推荐工具', async () => {
      const recommendations = await filter.recommendTools('user1', 5);

      expect(Array.isArray(recommendations)).toBe(true);
    });

    it('应该排除已使用的工具', async () => {
      const recommendations = await filter.recommendTools('user1', 5);

      const includesTool1 = recommendations.some(r => r.tool === 'tool1');
      expect(includesTool1).toBe(false);
    });

    it('应该包含推荐元数据', async () => {
      const recommendations = await filter.recommendTools('user1', 5);

      if (recommendations.length > 0) {
        const rec = recommendations[0];
        expect(rec).toHaveProperty('tool');
        expect(rec).toHaveProperty('score');
        expect(rec).toHaveProperty('confidence');
        expect(rec).toHaveProperty('supportingUsers');
        expect(rec).toHaveProperty('reason');
        expect(rec).toHaveProperty('algorithm', 'collaborative_filtering');
      }
    });

    it('应该按评分降序排序', async () => {
      const recommendations = await filter.recommendTools('user1', 5);

      for (let i = 1; i < recommendations.length; i++) {
        expect(recommendations[i - 1].score).toBeGreaterThanOrEqual(
          recommendations[i].score
        );
      }
    });

    it('应该限制推荐数量', async () => {
      const recommendations = await filter.recommendTools('user1', 2);

      expect(recommendations.length).toBeLessThanOrEqual(2);
    });

    it('应该在没有相似用户时返回空数组', async () => {
      filter.config.minSimilarity = 0.99;

      const recommendations = await filter.recommendTools('user1', 5);

      expect(recommendations).toEqual([]);
    });

    it('应该更新统计信息', async () => {
      // 为了确保有相似用户和推荐，添加更多测试数据
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'user1',
          tool_name: 'tool1',
          usage_count: 10,
          success_rate: 0.9,
          avg_time: 1000
        },
        {
          user_id: 'user1',
          tool_name: 'tool2',
          usage_count: 8,
          success_rate: 0.8,
          avg_time: 1100
        },
        {
          user_id: 'user2',
          tool_name: 'tool1',
          usage_count: 9,
          success_rate: 0.85,
          avg_time: 1100
        },
        {
          user_id: 'user2',
          tool_name: 'tool2',
          usage_count: 7,
          success_rate: 0.75,
          avg_time: 1200
        },
        {
          user_id: 'user2',
          tool_name: 'tool3',
          usage_count: 6,
          success_rate: 0.7,
          avg_time: 1300
        }
      ]);
      await filter.buildUserToolMatrix();

      const initialCount = filter.stats.totalRecommendations;

      await filter.recommendTools('user1', 5);

      expect(filter.stats.totalRecommendations).toBe(initialCount + 1);
    });

    it('应该计算平均相似度', async () => {
      await filter.recommendTools('user1', 5);

      if (filter.stats.totalRecommendations > 0) {
        expect(filter.stats.avgSimilarity).toBeGreaterThanOrEqual(0);
        expect(filter.stats.avgSimilarity).toBeLessThanOrEqual(1);
      }
    });

    it('应该处理推荐失败', async () => {
      filter.buildUserToolMatrix = vi.fn().mockRejectedValue(new Error('Build failed'));
      filter.userToolMatrix.clear();

      const recommendations = await filter.recommendTools('user1', 5);

      expect(recommendations).toEqual([]);
    });

    it('应该计算置信度', async () => {
      const recommendations = await filter.recommendTools('user1', 5);

      if (recommendations.length > 0) {
        expect(recommendations[0].confidence).toBeGreaterThanOrEqual(0);
        expect(recommendations[0].confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('predictRating', () => {
    beforeEach(async () => {
      filter.setDatabase(mockDatabase);
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'user1',
          tool_name: 'tool1',
          usage_count: 10,
          success_rate: 0.9,
          avg_time: 1000
        },
        {
          user_id: 'user2',
          tool_name: 'tool1',
          usage_count: 9,
          success_rate: 0.85,
          avg_time: 1100
        },
        {
          user_id: 'user2',
          tool_name: 'tool2',
          usage_count: 8,
          success_rate: 0.8,
          avg_time: 1200
        }
      ]);

      await filter.buildUserToolMatrix();
    });

    it('应该预测评分', async () => {
      const rating = await filter.predictRating('user1', 'tool2');

      expect(typeof rating).toBe('number');
      expect(rating).toBeGreaterThanOrEqual(1);
      expect(rating).toBeLessThanOrEqual(5);
    });

    it('应该在没有相似用户时返回默认评分3', async () => {
      filter.config.minSimilarity = 0.99;

      const rating = await filter.predictRating('user1', 'tool2');

      expect(rating).toBe(3);
    });

    it('应该在没有相关数据时返回默认评分3', async () => {
      const rating = await filter.predictRating('user1', 'nonexistent_tool');

      expect(rating).toBe(3);
    });

    it('应该基于相似用户的加权评分', async () => {
      const rating = await filter.predictRating('user1', 'tool2');

      // 应该是加权平均值
      expect(rating).toBeGreaterThan(0);
      expect(rating).toBeLessThanOrEqual(5);
    });
  });

  describe('generateReason', () => {
    it('应该生成推荐理由', () => {
      const similarUsers = [
        { userId: 'user1', similarity: 0.85, rating: 4.5 },
        { userId: 'user2', similarity: 0.75, rating: 4.0 }
      ];

      const reason = filter.generateReason(similarUsers);

      expect(reason).toContain('2个相似用户推荐');
      expect(reason).toContain('85%');
    });

    it('应该处理空相似用户列表', () => {
      const reason = filter.generateReason([]);

      expect(reason).toBe('基于协同过滤推荐');
    });

    it('应该格式化相似度百分比', () => {
      const similarUsers = [
        { userId: 'user1', similarity: 0.456, rating: 4.5 }
      ];

      const reason = filter.generateReason(similarUsers);

      expect(reason).toContain('46%'); // 四舍五入
    });
  });

  describe('getMatrixStats', () => {
    it('应该返回矩阵统计信息', () => {
      const user1Tools = new Map([
        ['tool1', { rating: 5 }],
        ['tool2', { rating: 4 }]
      ]);
      const user2Tools = new Map([
        ['tool1', { rating: 4 }],
        ['tool2', { rating: 5 }],
        ['tool3', { rating: 3 }]
      ]);

      filter.userToolMatrix.set('user1', user1Tools);
      filter.userToolMatrix.set('user2', user2Tools);

      const stats = filter.getMatrixStats();

      expect(stats.userCount).toBe(2);
      expect(stats.totalEntries).toBe(5);
      expect(stats.avgToolsPerUser).toBe('2.5');
      expect(stats.maxToolsPerUser).toBe(3);
      expect(stats.minToolsPerUser).toBe(2);
      expect(stats).toHaveProperty('matrixDensity');
    });

    it('应该处理空矩阵', () => {
      const stats = filter.getMatrixStats();

      expect(stats.userCount).toBe(0);
      expect(stats.totalEntries).toBe(0);
      expect(stats.avgToolsPerUser).toBe('0.0');
      expect(stats.maxToolsPerUser).toBe(0);
      expect(stats.minToolsPerUser).toBe(0);
    });

    it('应该计算矩阵密度', () => {
      const user1Tools = new Map([['tool1', { rating: 5 }]]);
      filter.userToolMatrix.set('user1', user1Tools);

      const stats = filter.getMatrixStats();

      expect(stats.matrixDensity).toMatch(/%$/);
    });
  });

  describe('getStats', () => {
    it('应该返回统计信息', () => {
      const stats = filter.getStats();

      expect(stats).toHaveProperty('totalRecommendations');
      expect(stats).toHaveProperty('cacheHits');
      expect(stats).toHaveProperty('cacheMisses');
      expect(stats).toHaveProperty('avgSimilarity');
      expect(stats).toHaveProperty('cacheHitRate');
      expect(stats).toHaveProperty('matrixStats');
    });

    it('应该计算缓存命中率', () => {
      filter.stats.cacheHits = 8;
      filter.stats.cacheMisses = 2;

      const stats = filter.getStats();

      expect(stats.cacheHitRate).toBe('80.00%');
    });

    it('应该在没有缓存访问时返回0%', () => {
      const stats = filter.getStats();

      expect(stats.cacheHitRate).toBe('0%');
    });

    it('应该格式化平均相似度为百分比', () => {
      filter.stats.avgSimilarity = 0.75;

      const stats = filter.getStats();

      expect(stats.avgSimilarity).toBe('75.0%');
    });
  });

  describe('clearCache', () => {
    it('应该清除相似度缓存', () => {
      filter.similarityCache.set('user1:user2', 0.85);
      filter.similarityCache.set('user2:user1', 0.85);

      filter.clearCache();

      expect(filter.similarityCache.size).toBe(0);
    });

    it('应该重置缓存统计', () => {
      filter.stats.cacheHits = 10;
      filter.stats.cacheMisses = 5;

      filter.clearCache();

      expect(filter.stats.cacheHits).toBe(0);
      expect(filter.stats.cacheMisses).toBe(0);
    });
  });

  describe('refreshMatrix', () => {
    beforeEach(() => {
      filter.setDatabase(mockDatabase);
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'user1',
          tool_name: 'tool1',
          usage_count: 10,
          success_rate: 0.9,
          avg_time: 1000
        }
      ]);
    });

    it('应该清空矩阵', async () => {
      filter.userToolMatrix.set('old_user', new Map());

      await filter.refreshMatrix();

      expect(filter.userToolMatrix.has('old_user')).toBe(false);
    });

    it('应该清除缓存', async () => {
      filter.similarityCache.set('key', 0.5);

      await filter.refreshMatrix();

      expect(filter.similarityCache.size).toBe(0);
    });

    it('应该重新构建矩阵', async () => {
      await filter.refreshMatrix();

      expect(filter.userToolMatrix.size).toBeGreaterThan(0);
    });
  });

  describe('边界情况和错误处理', () => {
    it('应该处理单个用户的矩阵', async () => {
      filter.setDatabase(mockDatabase);
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'only_user',
          tool_name: 'tool1',
          usage_count: 5,
          success_rate: 0.8,
          avg_time: 1000
        }
      ]);

      await filter.buildUserToolMatrix();
      const similarUsers = await filter.findSimilarUsers('only_user');

      expect(similarUsers).toEqual([]);
    });

    it('应该处理完全相同的用户', () => {
      const userTools = new Map([
        ['tool1', { rating: 5, usageCount: 10, successRate: 0.9, avgTime: 1000 }],
        ['tool2', { rating: 4, usageCount: 8, successRate: 0.8, avgTime: 1200 }]
      ]);

      filter.userToolMatrix.set('user1', userTools);
      filter.userToolMatrix.set('user2', new Map(userTools));

      const similarity = filter.calculateUserSimilarity('user1', 'user2');

      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it('应该处理完全不同的用户', () => {
      const user1Tools = new Map([
        ['tool1', { rating: 5, usageCount: 10, successRate: 0.9, avgTime: 1000 }]
      ]);
      const user2Tools = new Map([
        ['tool2', { rating: 5, usageCount: 10, successRate: 0.9, avgTime: 1000 }]
      ]);

      filter.userToolMatrix.set('user1', user1Tools);
      filter.userToolMatrix.set('user2', user2Tools);

      const similarity = filter.calculateUserSimilarity('user1', 'user2');

      expect(similarity).toBe(0);
    });

    it('应该处理极端评分', async () => {
      filter.setDatabase(mockDatabase);
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'user1',
          tool_name: 'tool1',
          usage_count: 0,
          success_rate: 0,
          avg_time: 0
        }
      ]);

      await filter.buildUserToolMatrix();

      const userTools = filter.userToolMatrix.get('user1');
      const rating = userTools.get('tool1').rating;

      expect(rating).toBeGreaterThanOrEqual(1);
      expect(rating).toBeLessThanOrEqual(5);
    });

    it('应该处理空推荐结果', async () => {
      filter.setDatabase(mockDatabase);
      mockPrepareStmt.all.mockReturnValue([
        {
          user_id: 'user1',
          tool_name: 'tool1',
          usage_count: 5,
          success_rate: 0.8,
          avg_time: 1000
        }
      ]);

      await filter.buildUserToolMatrix();
      const recommendations = await filter.recommendTools('user1', 5);

      // user1没有相似用户，且自己已经使用了tool1
      expect(recommendations).toEqual([]);
    });
  });
});
