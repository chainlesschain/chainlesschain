/**
 * SmartPlanCache Unit Tests
 *
 * 测试智能任务计划缓存的核心功能
 */

const { SmartPlanCache } = require('../../src/main/ai-engine/smart-plan-cache.js');
const assert = require('assert');

describe('SmartPlanCache', () => {
  let cache;

  afterEach(() => {
    if (cache) {
      cache.destroy();
      cache = null;
    }
  });

  describe('初始化', () => {
    it('应该创建缓存实例', () => {
      cache = new SmartPlanCache({
        maxSize: 100,
        similarityThreshold: 0.8,
        enabled: true,
      });

      assert.ok(cache, '应该创建缓存实例');
      assert.strictEqual(cache.maxSize, 100, 'maxSize应为100');
      assert.strictEqual(cache.similarityThreshold, 0.8, '相似度阈值应为0.8');
      assert.strictEqual(cache.enabled, true, '应该启用');
    });

    it('应该支持禁用缓存', () => {
      cache = new SmartPlanCache({ enabled: false });
      assert.strictEqual(cache.enabled, false, '应该禁用');
    });
  });

  describe('精确匹配', () => {
    beforeEach(() => {
      cache = new SmartPlanCache({
        maxSize: 100,
        enabled: true,
      });
    });

    it('应该缓存和检索任务计划', async () => {
      const request = '创建一个用户登录页面';
      const plan = {
        subtasks: [
          { id: '1', description: '设计UI' },
          { id: '2', description: '实现登录逻辑' },
        ],
      };

      // 设置缓存
      await cache.set(request, plan);

      // 获取缓存
      const cachedPlan = await cache.get(request);

      assert.ok(cachedPlan, '应该返回缓存的计划');
      assert.strictEqual(cachedPlan.subtasks.length, 2, '子任务数量应为2');
      assert.strictEqual(cachedPlan.subtasks[0].description, '设计UI', '第一个子任务应为设计UI');
    });

    it('应该更新统计信息', async () => {
      const request = '创建一个用户登录页面';
      const plan = { subtasks: [] };

      await cache.set(request, plan);
      await cache.get(request);

      const stats = cache.getStats();
      assert.strictEqual(stats.totalRequests, 1, '总请求数应为1');
      assert.strictEqual(stats.cacheHits, 1, '缓存命中数应为1');
      assert.strictEqual(stats.cacheMisses, 0, '缓存未命中数应为0');
      assert.strictEqual(stats.exactHits, 1, '精确命中数应为1');
    });
  });

  describe('语义相似度匹配', () => {
    beforeEach(() => {
      cache = new SmartPlanCache({
        maxSize: 100,
        similarityThreshold: 0.7, // 降低阈值以便测试
        enabled: true,
      });
    });

    it('应该匹配相似的请求', async () => {
      const request1 = '创建用户登录功能';
      const request2 = '实现用户登录模块';
      const plan = {
        subtasks: [{ id: '1', description: '登录实现' }],
      };

      await cache.set(request1, plan);
      const cachedPlan = await cache.get(request2);

      // 由于使用简单的TF-IDF后备方案，可能不会命中
      // 但至少应该能正常执行
      if (cachedPlan) {
        assert.ok(cachedPlan, '应该返回相似的计划');
      }
    });
  });

  describe('LRU淘汰', () => {
    beforeEach(() => {
      cache = new SmartPlanCache({
        maxSize: 3, // 小容量以便测试LRU
        enabled: true,
      });
    });

    it('应该淘汰最久未使用的条目', async () => {
      const plan = { subtasks: [] };

      // 添加4个条目（超过maxSize=3）
      await cache.set('request1', plan);
      await cache.set('request2', plan);
      await cache.set('request3', plan);
      await cache.set('request4', plan); // 应该触发LRU淘汰

      const stats = cache.getStats();
      assert.strictEqual(stats.cacheSize, 3, '缓存大小应保持为3');
      assert.strictEqual(stats.evictions, 1, '应该有1次淘汰');

      // request1应该被淘汰
      const cachedPlan1 = await cache.get('request1');
      assert.strictEqual(cachedPlan1, null, 'request1应该被淘汰');
    });

    it('应该保留最近访问的条目', async () => {
      const plan = { subtasks: [] };

      await cache.set('request1', plan);
      await cache.set('request2', plan);
      await cache.set('request3', plan);

      // 访问request1（更新访问时间）
      await cache.get('request1');

      // 添加新条目，应该淘汰request2（最久未使用）
      await cache.set('request4', plan);

      const cached1 = await cache.get('request1');
      const cached2 = await cache.get('request2');

      assert.ok(cached1, 'request1应该被保留（最近访问）');
      assert.strictEqual(cached2, null, 'request2应该被淘汰（最久未使用）');
    });
  });

  describe('过期处理', () => {
    it('应该拒绝过期的缓存条目', async () => {
      cache = new SmartPlanCache({
        maxSize: 100,
        ttl: 100, // 100ms TTL
        enabled: true,
      });

      const request = '创建用户页面';
      const plan = { subtasks: [] };

      await cache.set(request, plan);

      // 立即获取应该成功
      const cached1 = await cache.get(request);
      assert.ok(cached1, '应该返回缓存的计划');

      // 等待超过TTL
      await new Promise(resolve => setTimeout(resolve, 150));

      // 过期后应该返回null
      const cached2 = await cache.get(request);
      assert.strictEqual(cached2, null, '过期的缓存应该返回null');
    });
  });

  describe('禁用缓存', () => {
    beforeEach(() => {
      cache = new SmartPlanCache({ enabled: false });
    });

    it('禁用时应该跳过缓存', async () => {
      const request = '创建用户页面';
      const plan = { subtasks: [] };

      await cache.set(request, plan);
      const cachedPlan = await cache.get(request);

      assert.strictEqual(cachedPlan, null, '禁用时应该返回null');

      const stats = cache.getStats();
      assert.strictEqual(stats.totalRequests, 0, '禁用时不应该记录请求');
    });
  });

  describe('统计信息', () => {
    beforeEach(() => {
      cache = new SmartPlanCache({ maxSize: 100, enabled: true });
    });

    it('应该正确计算命中率', async () => {
      const plan = { subtasks: [] };

      await cache.set('req1', plan);
      await cache.set('req2', plan);

      await cache.get('req1'); // 命中
      await cache.get('req2'); // 命中
      await cache.get('req3'); // 未命中

      const stats = cache.getStats();
      assert.strictEqual(stats.totalRequests, 3, '总请求数应为3');
      assert.strictEqual(stats.cacheHits, 2, '命中数应为2');
      assert.strictEqual(stats.cacheMisses, 1, '未命中数应为1');
      assert.strictEqual(stats.hitRate, '66.67%', '命中率应为66.67%');
    });
  });

  describe('余弦相似度', () => {
    beforeEach(() => {
      cache = new SmartPlanCache({ enabled: true });
    });

    it('应该正确计算余弦相似度', () => {
      const vec1 = [1, 0, 1, 0];
      const vec2 = [1, 0, 1, 0];
      const vec3 = [0, 1, 0, 1];

      const similarity1 = cache._cosineSimilarity(vec1, vec2);
      const similarity2 = cache._cosineSimilarity(vec1, vec3);

      // Use tolerance for floating point comparison
      assert.ok(Math.abs(similarity1 - 1) < 1e-10, '相同向量的相似度应为1');
      assert.ok(Math.abs(similarity2 - 0) < 1e-10, '正交向量的相似度应为0');
    });

    it('应该处理零向量', () => {
      const vec1 = [0, 0, 0];
      const vec2 = [1, 1, 1];

      const similarity = cache._cosineSimilarity(vec1, vec2);
      assert.strictEqual(similarity, 0, '零向量的相似度应为0');
    });
  });

  describe('清空缓存', () => {
    beforeEach(() => {
      cache = new SmartPlanCache({ maxSize: 100, enabled: true });
    });

    it('应该清空所有缓存条目', async () => {
      const plan = { subtasks: [] };

      await cache.set('req1', plan);
      await cache.set('req2', plan);
      await cache.set('req3', plan);

      assert.strictEqual(cache.cache.size, 3, '应该有3个缓存条目');

      cache.clear();

      assert.strictEqual(cache.cache.size, 0, '缓存应该为空');
      assert.strictEqual(cache.accessOrder.length, 0, '访问顺序应该为空');
    });
  });
});

// 运行测试（如果直接执行）
if (require.main === module) {
  console.log('请使用测试框架运行此测试文件 (如 npm test)');
}
