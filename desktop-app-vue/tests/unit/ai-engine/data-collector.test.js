import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * DataCollector 单元测试
 *
 * 测试数据收集模块，包括:
 * - 工具使用事件收集
 * - 推荐记录收集
 * - 用户画像管理
 * - 批量写入优化
 * - 数据验证与清洗
 * - 匿名化处理
 * - 定时刷新机制
 */

describe('DataCollector', () => {
  let DataCollector;
  let collector;
  let mockDatabase;
  let mockPrepareStmt;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Dynamic import
    const module = await import('../../../src/main/ai-engine/data-collector.js');
    DataCollector = module.default;

    // Mock database statement
    mockPrepareStmt = {
      run: vi.fn(),
      get: vi.fn()
    };

    // Mock database
    mockDatabase = {
      prepare: vi.fn(() => mockPrepareStmt),
      transaction: vi.fn((fn) => {
        return (events) => fn(events);
      })
    };

    collector = new DataCollector();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('构造函数和配置', () => {
    it('应该使用默认配置初始化', () => {
      const collector = new DataCollector();
      expect(collector.config.enableCollection).toBe(true);
      expect(collector.config.batchSize).toBe(50);
      expect(collector.config.flushInterval).toBe(5000);
      expect(collector.config.enableValidation).toBe(true);
      expect(collector.config.enableAnonymization).toBe(false);
    });

    it('应该允许自定义配置', () => {
      const customConfig = {
        enableCollection: false,
        batchSize: 100,
        flushInterval: 10000,
        enableAnonymization: true
      };
      const collector = new DataCollector(customConfig);
      expect(collector.config.enableCollection).toBe(false);
      expect(collector.config.batchSize).toBe(100);
      expect(collector.config.flushInterval).toBe(10000);
      expect(collector.config.enableAnonymization).toBe(true);
    });

    it('应该初始化空事件缓冲区', () => {
      expect(collector.eventBuffer).toEqual([]);
    });

    it('应该初始化统计信息', () => {
      expect(collector.stats.totalEvents).toBe(0);
      expect(collector.stats.successfulWrites).toBe(0);
      expect(collector.stats.failedWrites).toBe(0);
      expect(collector.stats.validationErrors).toBe(0);
    });

    it('应该初始化flushTimer为null', () => {
      expect(collector.flushTimer).toBeNull();
    });
  });

  describe('setDatabase', () => {
    it('应该设置数据库引用', () => {
      collector.setDatabase(mockDatabase);
      expect(collector.db).toBe(mockDatabase);
    });

    it('应该在启用收集时启动定时刷新', () => {
      const startFlushTimerSpy = vi.spyOn(collector, 'startFlushTimer');
      collector.config.enableCollection = true;

      collector.setDatabase(mockDatabase);

      expect(startFlushTimerSpy).toHaveBeenCalled();
    });

    it('应该在禁用收集时不启动定时刷新', () => {
      const startFlushTimerSpy = vi.spyOn(collector, 'startFlushTimer');
      collector.config.enableCollection = false;

      collector.setDatabase(mockDatabase);

      expect(startFlushTimerSpy).not.toHaveBeenCalled();
    });
  });

  describe('validateToolUsageEvent', () => {
    it('应该验证通过有效的事件', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'html_generator',
        success: true
      };

      const result = collector.validateToolUsageEvent(event);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('应该拒绝缺少userId的事件', () => {
      const event = {
        sessionId: 'session456',
        toolName: 'html_generator',
        success: true
      };

      const result = collector.validateToolUsageEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少userId');
    });

    it('应该拒绝缺少sessionId的事件', () => {
      const event = {
        userId: 'user123',
        toolName: 'html_generator',
        success: true
      };

      const result = collector.validateToolUsageEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少sessionId');
    });

    it('应该拒绝缺少toolName的事件', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        success: true
      };

      const result = collector.validateToolUsageEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少toolName');
    });

    it('应该拒绝缺少success状态的事件', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'html_generator'
      };

      const result = collector.validateToolUsageEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少success状态');
    });

    it('应该允许success=false的事件', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'html_generator',
        success: false
      };

      const result = collector.validateToolUsageEvent(event);

      expect(result.valid).toBe(true);
    });
  });

  describe('validateRecommendation', () => {
    it('应该验证通过有效的推荐', () => {
      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Generate HTML page',
        recommendedTools: ['html_generator', 'css_generator']
      };

      const result = collector.validateRecommendation(rec);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('应该拒绝缺少userId的推荐', () => {
      const rec = {
        sessionId: 'session456',
        taskDescription: 'Test',
        recommendedTools: ['tool1']
      };

      const result = collector.validateRecommendation(rec);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少userId');
    });

    it('应该拒绝缺少sessionId的推荐', () => {
      const rec = {
        userId: 'user123',
        taskDescription: 'Test',
        recommendedTools: ['tool1']
      };

      const result = collector.validateRecommendation(rec);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少sessionId');
    });

    it('应该拒绝缺少taskDescription的推荐', () => {
      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        recommendedTools: ['tool1']
      };

      const result = collector.validateRecommendation(rec);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少taskDescription');
    });

    it('应该拒绝缺少recommendedTools的推荐', () => {
      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Test'
      };

      const result = collector.validateRecommendation(rec);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少recommendedTools');
    });

    it('应该拒绝recommendedTools为空数组的推荐', () => {
      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Test',
        recommendedTools: []
      };

      const result = collector.validateRecommendation(rec);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少recommendedTools');
    });
  });

  describe('anonymizeIfNeeded', () => {
    it('应该在禁用匿名化时返回原始userId', () => {
      collector.config.enableAnonymization = false;
      const userId = 'user123';

      const result = collector.anonymizeIfNeeded(userId);

      expect(result).toBe('user123');
    });

    it('应该在启用匿名化时返回匿名化的userId', () => {
      collector.config.enableAnonymization = true;
      const userId = 'user123';

      const result = collector.anonymizeIfNeeded(userId);

      expect(result).toMatch(/^anon_/);
      expect(result).not.toBe('user123');
    });

    it('应该对相同userId生成相同的匿名化结果', () => {
      collector.config.enableAnonymization = true;
      const userId = 'user123';

      const result1 = collector.anonymizeIfNeeded(userId);
      const result2 = collector.anonymizeIfNeeded(userId);

      expect(result1).toBe(result2);
    });

    it('应该对不同userId生成不同的匿名化结果', () => {
      collector.config.enableAnonymization = true;

      const result1 = collector.anonymizeIfNeeded('user1');
      const result2 = collector.anonymizeIfNeeded('user2');

      expect(result1).not.toBe(result2);
    });
  });

  describe('sanitizeContext', () => {
    it('应该返回null对于null context', () => {
      const result = collector.sanitizeContext(null);
      expect(result).toBeNull();
    });

    it('应该返回null对于undefined context', () => {
      const result = collector.sanitizeContext(undefined);
      expect(result).toBeNull();
    });

    it('应该移除password字段', () => {
      const context = { data: 'test', password: 'secret123' };
      const result = collector.sanitizeContext(context);

      expect(result.data).toBe('test');
      expect(result.password).toBeUndefined();
    });

    it('应该移除apiKey字段', () => {
      const context = { data: 'test', apiKey: 'key123' };
      const result = collector.sanitizeContext(context);

      expect(result.data).toBe('test');
      expect(result.apiKey).toBeUndefined();
    });

    it('应该移除token字段', () => {
      const context = { data: 'test', token: 'token123' };
      const result = collector.sanitizeContext(context);

      expect(result.data).toBe('test');
      expect(result.token).toBeUndefined();
    });

    it('应该保留其他字段', () => {
      const context = {
        data: 'test',
        userInput: 'input',
        settings: { theme: 'dark' },
        password: 'secret'
      };
      const result = collector.sanitizeContext(context);

      expect(result.data).toBe('test');
      expect(result.userInput).toBe('input');
      expect(result.settings).toEqual({ theme: 'dark' });
    });
  });

  describe('cleanToolUsageEvent', () => {
    it('应该清洗工具使用事件', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: '  html_generator  ',
        success: 1,
        executionTime: 1500,
        timestamp: '2026-01-25T10:00:00Z'
      };

      const result = collector.cleanToolUsageEvent(event);

      expect(result.userId).toBe('user123');
      expect(result.toolName).toBe('html_generator'); // trimmed
      expect(result.success).toBe(true); // boolean
      expect(result.executionTime).toBe(1500);
    });

    it('应该限制errorMessage长度为500字符', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: false,
        errorMessage: 'x'.repeat(1000)
      };

      const result = collector.cleanToolUsageEvent(event);

      expect(result.errorMessage.length).toBe(500);
    });

    it('应该限制explicitRating在1-5之间', () => {
      const event1 = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: true,
        explicitRating: 10
      };

      const result1 = collector.cleanToolUsageEvent(event1);
      expect(result1.explicitRating).toBe(5);

      const event2 = { ...event1, explicitRating: -5 };
      const result2 = collector.cleanToolUsageEvent(event2);
      expect(result2.explicitRating).toBe(1);
    });

    it('应该确保executionTime非负', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: true,
        executionTime: -100
      };

      const result = collector.cleanToolUsageEvent(event);

      expect(result.executionTime).toBe(0);
    });

    it('应该清理taskContext', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: true,
        taskContext: { data: 'test', password: 'secret' }
      };

      const result = collector.cleanToolUsageEvent(event);

      expect(result.taskContext.data).toBe('test');
      expect(result.taskContext.password).toBeUndefined();
    });

    it('应该在启用匿名化时匿名化userId', () => {
      collector.config.enableAnonymization = true;

      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: true
      };

      const result = collector.cleanToolUsageEvent(event);

      expect(result.userId).toMatch(/^anon_/);
    });

    it('应该添加timestamp如果缺失', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: true
      };

      const result = collector.cleanToolUsageEvent(event);

      expect(result.timestamp).toBeDefined();
    });
  });

  describe('cleanRecommendation', () => {
    it('应该清洗推荐记录', () => {
      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Test description',
        recommendedTools: ['tool1', 'tool2'],
        timeToAction: 5000
      };

      const result = collector.cleanRecommendation(rec);

      expect(result.userId).toBe('user123');
      expect(result.taskDescription).toBe('Test description');
      expect(result.recommendedTools).toEqual(['tool1', 'tool2']);
      expect(result.timeToAction).toBe(5000);
    });

    it('应该限制taskDescription长度为1000字符', () => {
      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'x'.repeat(2000),
        recommendedTools: ['tool1']
      };

      const result = collector.cleanRecommendation(rec);

      expect(result.taskDescription.length).toBe(1000);
    });

    it('应该确保timeToAction非负', () => {
      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Test',
        recommendedTools: ['tool1'],
        timeToAction: -500
      };

      const result = collector.cleanRecommendation(rec);

      expect(result.timeToAction).toBe(0);
    });

    it('应该清理taskContext', () => {
      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Test',
        recommendedTools: ['tool1'],
        taskContext: { data: 'test', apiKey: 'key123' }
      };

      const result = collector.cleanRecommendation(rec);

      expect(result.taskContext.data).toBe('test');
      expect(result.taskContext.apiKey).toBeUndefined();
    });

    it('应该在启用匿名化时匿名化userId', () => {
      collector.config.enableAnonymization = true;

      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Test',
        recommendedTools: ['tool1']
      };

      const result = collector.cleanRecommendation(rec);

      expect(result.userId).toMatch(/^anon_/);
    });
  });

  describe('collectToolUsage', () => {
    beforeEach(() => {
      collector.setDatabase(mockDatabase);
    });

    it('应该在禁用收集时跳过', async () => {
      collector.config.enableCollection = false;

      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: true
      };

      await collector.collectToolUsage(event);

      expect(collector.eventBuffer.length).toBe(0);
      expect(collector.stats.totalEvents).toBe(0);
    });

    it('应该在没有数据库时跳过', async () => {
      collector.db = null;

      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: true
      };

      await collector.collectToolUsage(event);

      expect(collector.eventBuffer.length).toBe(0);
    });

    it('应该验证并收集有效事件', async () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: true
      };

      await collector.collectToolUsage(event);

      expect(collector.eventBuffer.length).toBe(1);
      expect(collector.eventBuffer[0].type).toBe('tool_usage');
      expect(collector.stats.totalEvents).toBe(1);
    });

    it('应该拒绝无效事件', async () => {
      const event = {
        userId: 'user123'
        // 缺少必需字段
      };

      await collector.collectToolUsage(event);

      expect(collector.eventBuffer.length).toBe(0);
      expect(collector.stats.validationErrors).toBe(1);
    });

    it('应该在禁用验证时跳过验证', async () => {
      collector.config.enableValidation = false;

      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: true
        // 提供基本字段以通过清洗步骤
      };

      await collector.collectToolUsage(event);

      // 不验证，直接添加
      expect(collector.eventBuffer.length).toBe(1);
    });

    it('应该在缓冲区满时自动刷新', async () => {
      collector.config.batchSize = 2;
      const flushSpy = vi.spyOn(collector, 'flush').mockResolvedValue();

      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: true
      };

      await collector.collectToolUsage(event);
      expect(flushSpy).not.toHaveBeenCalled();

      await collector.collectToolUsage(event);
      expect(flushSpy).toHaveBeenCalled();
    });
  });

  describe('collectRecommendation', () => {
    beforeEach(() => {
      collector.setDatabase(mockDatabase);
    });

    it('应该在禁用收集时跳过', async () => {
      collector.config.enableCollection = false;

      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Test',
        recommendedTools: ['tool1']
      };

      await collector.collectRecommendation(rec);

      expect(collector.eventBuffer.length).toBe(0);
    });

    it('应该验证并收集有效推荐', async () => {
      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Generate HTML',
        recommendedTools: ['html_generator']
      };

      await collector.collectRecommendation(rec);

      expect(collector.eventBuffer.length).toBe(1);
      expect(collector.eventBuffer[0].type).toBe('recommendation');
      expect(collector.stats.totalEvents).toBe(1);
    });

    it('应该拒绝无效推荐', async () => {
      const rec = {
        userId: 'user123'
        // 缺少必需字段
      };

      await collector.collectRecommendation(rec);

      expect(collector.eventBuffer.length).toBe(0);
      expect(collector.stats.validationErrors).toBe(1);
    });

    it('应该在缓冲区满时自动刷新', async () => {
      collector.config.batchSize = 2;
      const flushSpy = vi.spyOn(collector, 'flush').mockResolvedValue();

      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Test',
        recommendedTools: ['tool1']
      };

      await collector.collectRecommendation(rec);
      expect(flushSpy).not.toHaveBeenCalled();

      await collector.collectRecommendation(rec);
      expect(flushSpy).toHaveBeenCalled();
    });
  });

  describe('updateUserProfile', () => {
    beforeEach(() => {
      collector.setDatabase(mockDatabase);
    });

    it('应该在没有数据库时跳过', async () => {
      collector.db = null;
      await collector.updateUserProfile('user123', { taskIncrement: 1 });
      // 不应该抛出错误
      expect(true).toBe(true);
    });

    it('应该更新已存在的用户画像', async () => {
      mockPrepareStmt.get.mockReturnValue({
        user_id: 'user123',
        success_rate: 0.8,
        avg_task_duration: 5000
      });

      await collector.updateUserProfile('user123', {
        taskIncrement: 1,
        successRate: 0.85
      });

      expect(mockDatabase.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_profiles')
      );
      expect(mockPrepareStmt.run).toHaveBeenCalled();
      expect(collector.stats.successfulWrites).toBe(1);
    });

    it('应该为新用户创建画像', async () => {
      mockPrepareStmt.get.mockReturnValue(null);
      const createProfileSpy = vi.spyOn(collector, 'createUserProfile').mockResolvedValue();

      await collector.updateUserProfile('user123', {
        taskIncrement: 1
      });

      expect(createProfileSpy).toHaveBeenCalledWith('user123', {
        taskIncrement: 1
      });
    });

    it('应该处理数据库错误', async () => {
      mockPrepareStmt.get.mockImplementation(() => {
        throw new Error('Database error');
      });

      await collector.updateUserProfile('user123', {});

      expect(collector.stats.failedWrites).toBe(1);
    });
  });

  describe('createUserProfile', () => {
    beforeEach(() => {
      collector.setDatabase(mockDatabase);
    });

    it('应该创建新用户画像', async () => {
      await collector.createUserProfile('user123', {
        skillLevel: 'advanced',
        preferredWorkflow: 'parallel',
        totalTasks: 10,
        successRate: 0.9
      });

      expect(mockDatabase.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_profiles')
      );
      expect(mockPrepareStmt.run).toHaveBeenCalledWith(
        'user123',
        'advanced',
        'parallel',
        expect.anything(),
        10,
        0.9
      );
      expect(collector.stats.successfulWrites).toBe(1);
    });

    it('应该使用默认值创建用户画像', async () => {
      await collector.createUserProfile('user456');

      expect(mockPrepareStmt.run).toHaveBeenCalledWith(
        'user456',
        'intermediate',
        'sequential',
        'balanced',
        0,
        0
      );
    });

    it('应该处理数据库错误', async () => {
      mockPrepareStmt.run.mockImplementation(() => {
        throw new Error('Insert failed');
      });

      await collector.createUserProfile('user123');

      expect(collector.stats.failedWrites).toBe(1);
    });
  });

  describe('flush', () => {
    beforeEach(() => {
      collector.setDatabase(mockDatabase);
    });

    it('应该在没有数据库时跳过', async () => {
      collector.db = null;
      collector.eventBuffer.push({ type: 'tool_usage', data: {} });

      await collector.flush();

      expect(collector.eventBuffer.length).toBe(1); // 未清空
    });

    it('应该在缓冲区为空时跳过', async () => {
      await collector.flush();

      expect(mockDatabase.transaction).not.toHaveBeenCalled();
    });

    it('应该批量写入事件', async () => {
      const writeToolSpy = vi.spyOn(collector, 'writeToolUsageEvent');
      const writeRecSpy = vi.spyOn(collector, 'writeRecommendation');

      collector.eventBuffer.push(
        { type: 'tool_usage', data: { userId: 'user1' } },
        { type: 'recommendation', data: { userId: 'user2' } }
      );

      await collector.flush();

      expect(mockDatabase.transaction).toHaveBeenCalled();
      expect(writeToolSpy).toHaveBeenCalledWith({ userId: 'user1' });
      expect(writeRecSpy).toHaveBeenCalledWith({ userId: 'user2' });
      expect(collector.eventBuffer.length).toBe(0);
      expect(collector.stats.successfulWrites).toBe(2);
    });

    it('应该在失败时将事件放回缓冲区', async () => {
      mockDatabase.transaction.mockImplementation(() => {
        throw new Error('Transaction failed');
      });

      collector.eventBuffer.push(
        { type: 'tool_usage', data: { userId: 'user1' } },
        { type: 'tool_usage', data: { userId: 'user2' } }
      );

      await collector.flush();

      expect(collector.eventBuffer.length).toBe(2); // 放回缓冲区
      expect(collector.stats.failedWrites).toBe(2);
    });
  });

  describe('startFlushTimer', () => {
    it('应该启动定时刷新', () => {
      collector.startFlushTimer();

      expect(collector.flushTimer).toBeDefined();
      expect(collector.flushTimer).not.toBeNull();
    });

    it('应该清除已存在的定时器', () => {
      const oldTimer = setInterval(() => {}, 1000);
      collector.flushTimer = oldTimer;

      collector.startFlushTimer();

      expect(collector.flushTimer).not.toBe(oldTimer);
    });

    it('应该按配置的间隔执行刷新', () => {
      const flushSpy = vi.spyOn(collector, 'flush').mockResolvedValue();
      collector.config.flushInterval = 1000;

      collector.startFlushTimer();

      expect(flushSpy).not.toHaveBeenCalled();

      // Advance timers once by the flush interval
      vi.advanceTimersByTime(1000);

      expect(flushSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStats', () => {
    it('应该返回统计信息', () => {
      const stats = collector.getStats();

      expect(stats).toHaveProperty('totalEvents');
      expect(stats).toHaveProperty('successfulWrites');
      expect(stats).toHaveProperty('failedWrites');
      expect(stats).toHaveProperty('validationErrors');
      expect(stats).toHaveProperty('bufferSize');
      expect(stats).toHaveProperty('collectionRate');
      expect(stats).toHaveProperty('errorRate');
    });

    it('应该包含当前缓冲区大小', () => {
      collector.eventBuffer.push({ type: 'tool_usage', data: {} });
      collector.eventBuffer.push({ type: 'recommendation', data: {} });

      const stats = collector.getStats();

      expect(stats.bufferSize).toBe(2);
    });

    it('应该计算收集率', () => {
      collector.stats.totalEvents = 100;
      collector.stats.successfulWrites = 90;

      const stats = collector.getStats();

      expect(stats.collectionRate).toBe('90.00%');
    });

    it('应该计算错误率', () => {
      collector.stats.totalEvents = 100;
      collector.stats.failedWrites = 5;

      const stats = collector.getStats();

      expect(stats.errorRate).toBe('5.00%');
    });

    it('应该在没有事件时返回0%', () => {
      const stats = collector.getStats();

      expect(stats.collectionRate).toBe('0%');
      expect(stats.errorRate).toBe('0%');
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      collector.setDatabase(mockDatabase);
    });

    it('应该停止定时器', async () => {
      collector.startFlushTimer();
      const timer = collector.flushTimer;

      await collector.cleanup();

      expect(collector.flushTimer).toBeNull();
    });

    it('应该刷新剩余事件', async () => {
      const flushSpy = vi.spyOn(collector, 'flush').mockResolvedValue();
      collector.eventBuffer.push({ type: 'tool_usage', data: {} });

      await collector.cleanup();

      expect(flushSpy).toHaveBeenCalled();
    });

    it('应该清空数据库引用', async () => {
      await collector.cleanup();

      expect(collector.db).toBeNull();
    });

    it('应该允许多次调用cleanup', async () => {
      await collector.cleanup();
      await expect(collector.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('writeToolUsageEvent', () => {
    beforeEach(() => {
      collector.setDatabase(mockDatabase);
    });

    it('应该写入完整的工具使用事件', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'html_generator',
        toolCategory: 'generation',
        taskType: 'web_development',
        taskContext: { type: 'landing_page' },
        executionTime: 1500,
        success: true,
        errorMessage: null,
        userFeedback: 'great',
        explicitRating: 5,
        previousTool: 'css_generator',
        nextTool: 'file_writer',
        isRecommended: true,
        timestamp: '2026-01-25T10:00:00Z'
      };

      collector.writeToolUsageEvent(event);

      expect(mockDatabase.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tool_usage_events')
      );
      expect(mockPrepareStmt.run).toHaveBeenCalled();
    });

    it('应该正确转换success为1/0', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: true
      };

      collector.writeToolUsageEvent(event);

      const callArgs = mockPrepareStmt.run.mock.calls[0];
      expect(callArgs[7]).toBe(1); // success position
    });

    it('应该正确转换isRecommended为1/0', () => {
      const event = {
        userId: 'user123',
        sessionId: 'session456',
        toolName: 'test_tool',
        success: false,
        isRecommended: true
      };

      collector.writeToolUsageEvent(event);

      const callArgs = mockPrepareStmt.run.mock.calls[0];
      expect(callArgs[13]).toBe(1); // isRecommended position
    });
  });

  describe('writeRecommendation', () => {
    beforeEach(() => {
      collector.setDatabase(mockDatabase);
    });

    it('应该写入推荐记录', () => {
      const rec = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Generate landing page',
        taskContext: { type: 'marketing' },
        recommendedTools: ['html_generator', 'css_generator'],
        recommendationScores: [0.9, 0.8],
        algorithmUsed: 'hybrid',
        recommendationReasons: ['high_match', 'user_preference'],
        userAction: 'accepted',
        actualToolsUsed: ['html_generator'],
        timeToAction: 5000,
        recommendationQuality: 0.85,
        wasHelpful: true
      };

      collector.writeRecommendation(rec);

      expect(mockDatabase.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tool_recommendations')
      );
      expect(mockPrepareStmt.run).toHaveBeenCalled();
    });

    it('应该正确转换wasHelpful为1/0/null', () => {
      const rec1 = {
        userId: 'user123',
        sessionId: 'session456',
        taskDescription: 'Test',
        recommendedTools: ['tool1'],
        wasHelpful: true
      };

      collector.writeRecommendation(rec1);

      const callArgs1 = mockPrepareStmt.run.mock.calls[0];
      expect(callArgs1[12]).toBe(1); // wasHelpful position

      const rec2 = { ...rec1, wasHelpful: false };
      collector.writeRecommendation(rec2);

      const callArgs2 = mockPrepareStmt.run.mock.calls[1];
      expect(callArgs2[12]).toBe(0);

      const rec3 = { ...rec1, wasHelpful: undefined };
      collector.writeRecommendation(rec3);

      const callArgs3 = mockPrepareStmt.run.mock.calls[2];
      expect(callArgs3[12]).toBeNull();
    });
  });
});
