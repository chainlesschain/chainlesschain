import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DynamicFewShotLearner 单元测试
 *
 * 测试动态Few-shot学习系统，包括:
 * - 用户历史示例提取
 * - 动态prompt构建
 * - 通用示例和硬编码示例
 * - 识别结果记录和学习
 * - 用户意图偏好统计
 * - 自适应示例数量调整
 * - 缓存管理
 * - 数据清理
 */

describe("DynamicFewShotLearner", () => {
  let DynamicFewShotLearner;
  let learner;
  let mockDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import("../../../src/main/ai-engine/dynamic-few-shot-learner.js");
    DynamicFewShotLearner = module.default;

    // Mock database
    mockDatabase = {
      all: vi.fn(),
      get: vi.fn(),
      run: vi.fn()
    };

    // Create instance
    learner = new DynamicFewShotLearner(mockDatabase);
  });

  describe("初始化", () => {
    it("应该正确初始化", () => {
      expect(learner.database).toBe(mockDatabase);
      expect(learner.exampleCache).toBeInstanceOf(Map);
      expect(learner.cacheConfig).toBeDefined();
      expect(learner.fewShotConfig).toBeDefined();
    });

    it("应该有正确的缓存配置", () => {
      expect(learner.cacheConfig.maxAge).toBe(3600000);  // 1小时
      expect(learner.cacheConfig.maxSize).toBe(100);
    });

    it("应该有正确的Few-shot配置", () => {
      expect(learner.fewShotConfig.minExamples).toBe(1);
      expect(learner.fewShotConfig.maxExamples).toBe(10);
      expect(learner.fewShotConfig.defaultExamples).toBe(3);
      expect(learner.fewShotConfig.minConfidence).toBe(0.85);
      expect(learner.fewShotConfig.minSuccessRate).toBe(0.9);
    });
  });

  describe("getUserExamples - 获取用户示例", () => {
    it("应该从数据库获取用户示例", async () => {
      const mockRows = [
        {
          user_input: '创建网站',
          intent: 'CREATE_FILE',
          entities: '{"fileType":"HTML"}',
          confidence: 0.9,
          created_at: Date.now()
        }
      ];

      mockDatabase.all.mockResolvedValue(mockRows);

      const examples = await learner.getUserExamples('user123');

      expect(mockDatabase.all).toHaveBeenCalled();
      expect(examples).toHaveLength(1);
      expect(examples[0].input).toBe('创建网站');
      expect(examples[0].output.intent).toBe('CREATE_FILE');
      expect(examples[0].output.entities.fileType).toBe('HTML');
    });

    it("应该使用缓存", async () => {
      const mockRows = [
        {
          user_input: '创建网站',
          intent: 'CREATE_FILE',
          entities: '{}',
          confidence: 0.9,
          created_at: Date.now()
        }
      ];

      mockDatabase.all.mockResolvedValue(mockRows);

      // 第一次调用
      await learner.getUserExamples('user123');
      // 第二次调用（应该使用缓存）
      await learner.getUserExamples('user123');

      expect(mockDatabase.all).toHaveBeenCalledTimes(1);
    });

    it("应该支持按意图类型过滤", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.getUserExamples('user123', 'CREATE_FILE');

      const query = mockDatabase.all.mock.calls[0][0];
      expect(query).toContain('AND intent = ?');
    });

    it("应该支持自定义限制数量", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.getUserExamples('user123', null, 5);

      const params = mockDatabase.all.mock.calls[0][1];
      expect(params[params.length - 1]).toBe(5);
    });

    it("应该过滤低置信度记录", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.getUserExamples('user123');

      const params = mockDatabase.all.mock.calls[0][1];
      expect(params[1]).toBe(0.85);  // minConfidence
    });

    it("应该在数据库错误时返回空数组", async () => {
      mockDatabase.all.mockRejectedValue(new Error('DB error'));

      const examples = await learner.getUserExamples('user123');

      expect(examples).toEqual([]);
    });

    it("应该解析entities JSON", async () => {
      const mockRows = [
        {
          user_input: '创建网站',
          intent: 'CREATE_FILE',
          entities: '{"fileType":"HTML","theme":"blog"}',
          confidence: 0.9,
          created_at: Date.now()
        }
      ];

      mockDatabase.all.mockResolvedValue(mockRows);

      const examples = await learner.getUserExamples('user123');

      expect(examples[0].output.entities).toEqual({
        fileType: 'HTML',
        theme: 'blog'
      });
    });

    it("应该处理空entities", async () => {
      const mockRows = [
        {
          user_input: '创建网站',
          intent: 'CREATE_FILE',
          entities: null,
          confidence: 0.9,
          created_at: Date.now()
        }
      ];

      mockDatabase.all.mockResolvedValue(mockRows);

      const examples = await learner.getUserExamples('user123');

      expect(examples[0].output.entities).toEqual({});
    });
  });

  describe("buildDynamicPrompt - 构建动态prompt", () => {
    it("应该构建包含用户示例的prompt", async () => {
      const mockExamples = [
        {
          input: '创建网站',
          output: { intent: 'CREATE_FILE', entities: { fileType: 'HTML' } },
          confidence: 0.9,
          timestamp: Date.now()
        }
      ];

      mockDatabase.all.mockResolvedValue([
        {
          user_input: '创建网站',
          intent: 'CREATE_FILE',
          entities: '{"fileType":"HTML"}',
          confidence: 0.9,
          created_at: Date.now()
        }
      ]);

      const prompt = await learner.buildDynamicPrompt('做个博客', 'user123');

      expect(prompt).toContain('你是一个智能意图识别助手');
      expect(prompt).toContain('参考示例');
      expect(prompt).toContain('创建网站');
      expect(prompt).toContain('现在识别');
      expect(prompt).toContain('做个博客');
    });

    it("应该在用户示例不足时补充通用示例", async () => {
      // 用户示例为空
      mockDatabase.all.mockResolvedValueOnce([]);

      // 通用示例
      mockDatabase.all.mockResolvedValueOnce([
        {
          user_input: '创建HTML',
          intent: 'CREATE_FILE',
          entities: '{}',
          avg_confidence: 0.9
        }
      ]);

      const prompt = await learner.buildDynamicPrompt('做个博客', 'user123');

      expect(prompt).toContain('创建HTML');
      expect(mockDatabase.all).toHaveBeenCalledTimes(2);
    });

    it("应该支持不包含系统提示", async () => {
      mockDatabase.all.mockResolvedValue([]);

      const prompt = await learner.buildDynamicPrompt('做个博客', 'user123', {
        includeSystemPrompt: false
      });

      expect(prompt).not.toContain('你是一个智能意图识别助手');
    });

    it("应该支持指定意图类型", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.buildDynamicPrompt('做个博客', 'user123', {
        includeIntent: 'CREATE_FILE'
      });

      const firstCall = mockDatabase.all.mock.calls[0];
      expect(firstCall[0]).toContain('AND intent = ?');
    });

    it("应该支持指定示例数量", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.buildDynamicPrompt('做个博客', 'user123', {
        exampleCount: 5
      });

      const params = mockDatabase.all.mock.calls[0][1];
      expect(params[params.length - 1]).toBe(5);
    });

    it("应该正确格式化示例", async () => {
      mockDatabase.all.mockResolvedValue([
        {
          user_input: '创建网站',
          intent: 'CREATE_FILE',
          entities: '{"fileType":"HTML"}',
          confidence: 0.9,
          created_at: Date.now()
        }
      ]);

      const prompt = await learner.buildDynamicPrompt('做个博客', 'user123');

      expect(prompt).toContain('示例1:');
      expect(prompt).toContain('输入: "创建网站"');
      expect(prompt).toContain('输出: {"intent":"CREATE_FILE","entities":{"fileType":"HTML"}}');
    });
  });

  describe("getGenericExamples - 获取通用示例", () => {
    it("应该从数据库获取通用示例", async () => {
      const mockRows = [
        {
          user_input: '创建网站',
          intent: 'CREATE_FILE',
          entities: '{"fileType":"HTML"}',
          avg_confidence: 0.9
        }
      ];

      mockDatabase.all.mockResolvedValue(mockRows);

      const examples = await learner.getGenericExamples();

      expect(examples).toHaveLength(1);
      expect(examples[0].isGeneric).toBe(true);
      expect(examples[0].confidence).toBe(0.9);
    });

    it("应该支持按意图类型过滤", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.getGenericExamples('CREATE_FILE', 5);

      const query = mockDatabase.all.mock.calls[0][0];
      expect(query).toContain('AND intent = ?');
    });

    it("应该在数据库错误时降级到硬编码示例", async () => {
      mockDatabase.all.mockRejectedValue(new Error('DB error'));

      const examples = await learner.getGenericExamples('CREATE_FILE', 3);

      expect(examples).toHaveLength(3);
      expect(examples[0].output.intent).toBe('CREATE_FILE');
    });
  });

  describe("getHardcodedExamples - 获取硬编码示例", () => {
    it("应该返回指定意图的示例", () => {
      const examples = learner.getHardcodedExamples('CREATE_FILE', 2);

      expect(examples).toHaveLength(2);
      examples.forEach(ex => {
        expect(ex.output.intent).toBe('CREATE_FILE');
      });
    });

    it("应该支持EDIT_FILE意图", () => {
      const examples = learner.getHardcodedExamples('EDIT_FILE', 2);

      expect(examples).toHaveLength(2);
      expect(examples[0].input).toContain('修改');
    });

    it("应该支持DEPLOY_PROJECT意图", () => {
      const examples = learner.getHardcodedExamples('DEPLOY_PROJECT', 2);

      expect(examples).toHaveLength(2);
      expect(examples[0].input).toContain('部署');
    });

    it("应该支持ANALYZE_DATA意图", () => {
      const examples = learner.getHardcodedExamples('ANALYZE_DATA', 2);

      expect(examples).toHaveLength(2);
      expect(examples[0].input).toContain('分析');
    });

    it("应该在未指定意图时返回混合示例", () => {
      const examples = learner.getHardcodedExamples(null, 5);

      expect(examples).toHaveLength(5);

      // 应该包含多种意图
      const intents = new Set(examples.map(ex => ex.output.intent));
      expect(intents.size).toBeGreaterThan(1);
    });

    it("应该限制返回数量", () => {
      const examples = learner.getHardcodedExamples('CREATE_FILE', 1);

      expect(examples).toHaveLength(1);
    });

    it("应该在未知意图时返回混合示例", () => {
      const examples = learner.getHardcodedExamples('UNKNOWN_INTENT', 3);

      expect(examples).toHaveLength(3);
    });
  });

  describe("recordRecognition - 记录识别结果", () => {
    it("应该记录成功的识别结果", async () => {
      mockDatabase.run.mockResolvedValue();

      await learner.recordRecognition('user123', '创建网站', {
        intent: 'CREATE_FILE',
        entities: { fileType: 'HTML' },
        confidence: 0.9
      }, true);

      expect(mockDatabase.run).toHaveBeenCalled();
      const args = mockDatabase.run.mock.calls[0][1];
      expect(args[0]).toBe('user123');
      expect(args[1]).toBe('创建网站');
      expect(args[2]).toBe('CREATE_FILE');
      expect(args[5]).toBe(1);  // success = 1
    });

    it("应该记录失败的识别结果", async () => {
      mockDatabase.run.mockResolvedValue();

      await learner.recordRecognition('user123', '创建网站', {
        intent: 'CREATE_FILE',
        entities: {},
        confidence: 0.5
      }, false);

      const args = mockDatabase.run.mock.calls[0][1];
      expect(args[5]).toBe(0);  // success = 0
    });

    it("应该序列化entities为JSON", async () => {
      mockDatabase.run.mockResolvedValue();

      await learner.recordRecognition('user123', '创建网站', {
        intent: 'CREATE_FILE',
        entities: { fileType: 'HTML', theme: 'blog' },
        confidence: 0.9
      });

      const args = mockDatabase.run.mock.calls[0][1];
      expect(args[3]).toBe('{"fileType":"HTML","theme":"blog"}');
    });

    it("应该处理缺失的entities", async () => {
      mockDatabase.run.mockResolvedValue();

      await learner.recordRecognition('user123', '创建网站', {
        intent: 'CREATE_FILE',
        confidence: 0.9
      });

      const args = mockDatabase.run.mock.calls[0][1];
      expect(args[3]).toBe('{}');
    });

    it("应该使用默认置信度0.5", async () => {
      mockDatabase.run.mockResolvedValue();

      await learner.recordRecognition('user123', '创建网站', {
        intent: 'CREATE_FILE'
      });

      const args = mockDatabase.run.mock.calls[0][1];
      expect(args[4]).toBe(0.5);
    });

    it("应该清除用户缓存", async () => {
      // 先设置缓存
      learner.setToCache('user123_all_3', []);
      expect(learner.exampleCache.size).toBe(1);

      mockDatabase.run.mockResolvedValue();

      await learner.recordRecognition('user123', '创建网站', {
        intent: 'CREATE_FILE'
      });

      expect(learner.exampleCache.size).toBe(0);
    });

    it("应该处理数据库错误", async () => {
      mockDatabase.run.mockRejectedValue(new Error('DB error'));

      // 不应该抛出错误
      await expect(
        learner.recordRecognition('user123', '创建网站', { intent: 'CREATE_FILE' })
      ).resolves.toBeUndefined();
    });
  });

  describe("getUserIntentPreference - 获取用户意图偏好", () => {
    it("应该返回用户意图偏好统计", async () => {
      const mockRows = [
        {
          intent: 'CREATE_FILE',
          usage_count: 10,
          avg_confidence: 0.9,
          last_used: Date.now()
        },
        {
          intent: 'EDIT_FILE',
          usage_count: 5,
          avg_confidence: 0.85,
          last_used: Date.now() - 1000
        }
      ];

      mockDatabase.all.mockResolvedValue(mockRows);

      const preferences = await learner.getUserIntentPreference('user123');

      expect(preferences).toHaveLength(2);
      expect(preferences[0].intent).toBe('CREATE_FILE');
      expect(preferences[0].usageCount).toBe(10);
      expect(preferences[0].avgConfidence).toBe(0.9);
      expect(preferences[1].intent).toBe('EDIT_FILE');
    });

    it("应该支持自定义限制数量", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.getUserIntentPreference('user123', 5);

      const params = mockDatabase.all.mock.calls[0][1];
      expect(params[1]).toBe(5);
    });

    it("应该在数据库错误时返回空数组", async () => {
      mockDatabase.all.mockRejectedValue(new Error('DB error'));

      const preferences = await learner.getUserIntentPreference('user123');

      expect(preferences).toEqual([]);
    });

    it("应该按使用次数降序排序", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.getUserIntentPreference('user123');

      const query = mockDatabase.all.mock.calls[0][0];
      expect(query).toContain('ORDER BY usage_count DESC');
    });
  });

  describe("adaptiveExampleCount - 自适应调整示例数量", () => {
    it("应该在成功率高时减少示例数", async () => {
      mockDatabase.get.mockResolvedValue({
        total: 100,
        successes: 95  // 95% 成功率
      });

      const count = await learner.adaptiveExampleCount('user123', 3);

      expect(count).toBe(2);  // 3 - 1
    });

    it("应该在成功率低时增加示例数", async () => {
      mockDatabase.get.mockResolvedValue({
        total: 100,
        successes: 65  // 65% 成功率
      });

      const count = await learner.adaptiveExampleCount('user123', 3);

      expect(count).toBe(5);  // 3 + 2
    });

    it("应该在成功率适中时保持不变", async () => {
      mockDatabase.get.mockResolvedValue({
        total: 100,
        successes: 80  // 80% 成功率
      });

      const count = await learner.adaptiveExampleCount('user123', 3);

      expect(count).toBe(3);  // 保持不变
    });

    it("应该在没有历史数据时返回基础值", async () => {
      mockDatabase.get.mockResolvedValue({ total: 0, successes: 0 });

      const count = await learner.adaptiveExampleCount('user123', 3);

      expect(count).toBe(3);
    });

    it("应该在数据库返回null时返回基础值", async () => {
      mockDatabase.get.mockResolvedValue(null);

      const count = await learner.adaptiveExampleCount('user123', 3);

      expect(count).toBe(3);
    });

    it("应该不低于最小示例数", async () => {
      mockDatabase.get.mockResolvedValue({
        total: 100,
        successes: 95  // 高成功率
      });

      const count = await learner.adaptiveExampleCount('user123', 1);

      expect(count).toBe(1);  // minExamples = 1
    });

    it("应该不超过最大示例数", async () => {
      mockDatabase.get.mockResolvedValue({
        total: 100,
        successes: 50  // 低成功率
      });

      const count = await learner.adaptiveExampleCount('user123', 9);

      expect(count).toBe(10);  // maxExamples = 10
    });

    it("应该在数据库错误时返回基础值", async () => {
      mockDatabase.get.mockRejectedValue(new Error('DB error'));

      const count = await learner.adaptiveExampleCount('user123', 3);

      expect(count).toBe(3);
    });
  });

  describe("cleanOldData - 清理旧数据", () => {
    it("应该删除旧记录", async () => {
      mockDatabase.run.mockResolvedValue({ changes: 10 });

      const deleted = await learner.cleanOldData(90);

      expect(deleted).toBe(10);
      expect(mockDatabase.run).toHaveBeenCalled();
    });

    it("应该计算正确的截止时间", async () => {
      mockDatabase.run.mockResolvedValue({ changes: 0 });

      await learner.cleanOldData(30);

      const params = mockDatabase.run.mock.calls[0][1];
      const cutoff = params[0];
      const expectedCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      expect(cutoff).toBeCloseTo(expectedCutoff, -3);
    });

    it("应该在数据库错误时返回0", async () => {
      mockDatabase.run.mockRejectedValue(new Error('DB error'));

      const deleted = await learner.cleanOldData(90);

      expect(deleted).toBe(0);
    });

    it("应该使用默认保留期90天", async () => {
      mockDatabase.run.mockResolvedValue({ changes: 5 });

      await learner.cleanOldData();

      const params = mockDatabase.run.mock.calls[0][1];
      const cutoff = params[0];
      const expectedCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
      expect(cutoff).toBeCloseTo(expectedCutoff, -3);
    });
  });

  describe("缓存管理", () => {
    describe("getFromCache", () => {
      it("应该从缓存获取数据", () => {
        const data = [{ test: 'data' }];
        learner.setToCache('test_key', data);

        const cached = learner.getFromCache('test_key');

        expect(cached).toEqual(data);
      });

      it("应该在缓存未命中时返回null", () => {
        const cached = learner.getFromCache('nonexistent');

        expect(cached).toBeNull();
      });

      it("应该在缓存过期时返回null", () => {
        const data = [{ test: 'data' }];
        learner.exampleCache.set('test_key', {
          data,
          timestamp: Date.now() - 3700000  // 超过1小时
        });

        const cached = learner.getFromCache('test_key');

        expect(cached).toBeNull();
        expect(learner.exampleCache.has('test_key')).toBe(false);
      });
    });

    describe("setToCache", () => {
      it("应该设置缓存", () => {
        const data = [{ test: 'data' }];
        learner.setToCache('test_key', data);

        expect(learner.exampleCache.has('test_key')).toBe(true);
        expect(learner.exampleCache.get('test_key').data).toEqual(data);
      });

      it("应该在超过最大大小时删除最旧的缓存", () => {
        // 设置maxSize为2便于测试
        learner.cacheConfig.maxSize = 2;

        learner.setToCache('key1', [1]);
        learner.setToCache('key2', [2]);
        learner.setToCache('key3', [3]);  // 应该删除key1

        expect(learner.exampleCache.size).toBe(2);
        expect(learner.exampleCache.has('key1')).toBe(false);
        expect(learner.exampleCache.has('key2')).toBe(true);
        expect(learner.exampleCache.has('key3')).toBe(true);
      });

      it("应该记录时间戳", () => {
        const before = Date.now();
        learner.setToCache('test_key', []);
        const after = Date.now();

        const cached = learner.exampleCache.get('test_key');
        expect(cached.timestamp).toBeGreaterThanOrEqual(before);
        expect(cached.timestamp).toBeLessThanOrEqual(after);
      });
    });

    describe("clearUserCache", () => {
      it("应该清除指定用户的所有缓存", () => {
        learner.setToCache('user123_all_3', [1]);
        learner.setToCache('user123_CREATE_FILE_5', [2]);
        learner.setToCache('user456_all_3', [3]);

        learner.clearUserCache('user123');

        expect(learner.exampleCache.has('user123_all_3')).toBe(false);
        expect(learner.exampleCache.has('user123_CREATE_FILE_5')).toBe(false);
        expect(learner.exampleCache.has('user456_all_3')).toBe(true);
      });

      it("应该处理不存在的用户", () => {
        learner.setToCache('user123_all_3', [1]);

        // 不应该抛出错误
        expect(() => learner.clearUserCache('nonexistent')).not.toThrow();
        expect(learner.exampleCache.has('user123_all_3')).toBe(true);
      });
    });

    describe("clearAllCache", () => {
      it("应该清除所有缓存", () => {
        learner.setToCache('key1', [1]);
        learner.setToCache('key2', [2]);
        learner.setToCache('key3', [3]);

        learner.clearAllCache();

        expect(learner.exampleCache.size).toBe(0);
      });
    });

    describe("getCacheStats", () => {
      it("应该返回缓存统计信息", () => {
        learner.setToCache('key1', [1]);
        learner.setToCache('key2', [2]);

        const stats = learner.getCacheStats();

        expect(stats.size).toBe(2);
        expect(stats.maxSize).toBe(100);
        expect(stats.maxAge).toBe(3600000);
      });
    });
  });

  describe("边界情况", () => {
    it("应该处理数据库返回空数组", async () => {
      mockDatabase.all.mockResolvedValue([]);

      const examples = await learner.getUserExamples('user123');

      expect(examples).toEqual([]);
    });

    it("应该处理超长用户输入", async () => {
      const longInput = 'x'.repeat(10000);
      mockDatabase.run.mockResolvedValue();

      await expect(
        learner.recordRecognition('user123', longInput, { intent: 'CREATE_FILE' })
      ).resolves.toBeUndefined();
    });

    it("应该处理无效的JSON entities", async () => {
      const mockRows = [
        {
          user_input: '创建网站',
          intent: 'CREATE_FILE',
          entities: 'invalid json',
          confidence: 0.9,
          created_at: Date.now()
        }
      ];

      mockDatabase.all.mockResolvedValue(mockRows);

      // 应该降级到空对象
      const examples = await learner.getUserExamples('user123');
      expect(examples[0].output.entities).toEqual({});
    });

    it("应该处理limit为0的情况", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.getUserExamples('user123', null, 0);

      const params = mockDatabase.all.mock.calls[0][1];
      expect(params[params.length - 1]).toBe(0);
    });

    it("应该处理用户ID包含特殊字符", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.getUserExamples('user_123-456@test.com');

      expect(mockDatabase.all).toHaveBeenCalled();
    });

    it("应该处理并发缓存操作", () => {
      // 模拟并发设置缓存
      for (let i = 0; i < 10; i++) {
        learner.setToCache(`key${i}`, [i]);
      }

      expect(learner.exampleCache.size).toBe(10);
    });

    it("应该处理空意图类型", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.getUserExamples('user123', '');

      const query = mockDatabase.all.mock.calls[0][0];
      expect(query).toContain('AND intent = ?');
    });

    it("应该处理负数limit", async () => {
      mockDatabase.all.mockResolvedValue([]);

      await learner.getUserExamples('user123', null, -1);

      // 应该使用默认值
      const params = mockDatabase.all.mock.calls[0][1];
      expect(params[params.length - 1]).toBeGreaterThan(0);
    });
  });

  describe("集成测试", () => {
    it("应该完整演示Few-shot学习流程", async () => {
      // 1. 记录用户识别结果
      mockDatabase.run.mockResolvedValue();
      await learner.recordRecognition('user123', '创建网站', {
        intent: 'CREATE_FILE',
        entities: { fileType: 'HTML' },
        confidence: 0.9
      });

      // 2. 获取用户示例
      mockDatabase.all.mockResolvedValue([
        {
          user_input: '创建网站',
          intent: 'CREATE_FILE',
          entities: '{"fileType":"HTML"}',
          confidence: 0.9,
          created_at: Date.now()
        }
      ]);

      const examples = await learner.getUserExamples('user123');
      expect(examples).toHaveLength(1);

      // 3. 构建动态prompt
      const prompt = await learner.buildDynamicPrompt('做个博客', 'user123');
      expect(prompt).toContain('创建网站');
      expect(prompt).toContain('做个博客');
    });

    it("应该正确处理无历史用户的情况", async () => {
      // 用户示例为空
      mockDatabase.all.mockResolvedValueOnce([]);

      // 通用示例也为空
      mockDatabase.all.mockResolvedValueOnce([]);

      const prompt = await learner.buildDynamicPrompt('创建网站', 'newuser');

      // 应该包含硬编码示例
      expect(prompt).toContain('现在识别');
      expect(prompt).toContain('创建网站');
    });
  });
});
