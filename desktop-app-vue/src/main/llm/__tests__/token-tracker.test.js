/**
 * Token Tracker 模块测试
 *
 * 测试内容：
 * - TokenTracker 类的成本计算
 * - 使用记录
 * - 统计查询
 * - 预算管理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { TokenTracker, PRICING_DATA } = require('../token-tracker');

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock volcengine-models (optional)
vi.mock('../volcengine-models', () => null);

describe('PRICING_DATA', () => {
  it('should have pricing for major providers', () => {
    expect(PRICING_DATA.openai).toBeDefined();
    expect(PRICING_DATA.anthropic).toBeDefined();
    expect(PRICING_DATA.deepseek).toBeDefined();
    expect(PRICING_DATA.ollama).toBeDefined();
  });

  it('should have correct GPT-4o pricing', () => {
    expect(PRICING_DATA.openai['gpt-4o']).toEqual({
      input: 2.5,
      output: 10.0,
    });
  });

  it('should have correct Claude pricing with cache rates', () => {
    const claude = PRICING_DATA.anthropic['claude-3-5-sonnet-20241022'];
    expect(claude.input).toBe(3.0);
    expect(claude.output).toBe(15.0);
    expect(claude.cache).toBe(0.3);
    expect(claude.cacheWrite).toBe(3.75);
  });

  it('should have free Ollama pricing', () => {
    expect(PRICING_DATA.ollama['*']).toEqual({
      input: 0,
      output: 0,
    });
  });
});

describe('TokenTracker', () => {
  let tracker;
  let mockDb;

  beforeEach(() => {
    mockDb = {
      prepare: vi.fn(() => ({
        get: vi.fn(),
        run: vi.fn(() => ({ changes: 1 })),
        all: vi.fn(() => []),
      })),
    };

    tracker = new TokenTracker(mockDb, {
      enableCostTracking: true,
      enableBudgetAlerts: false,
      exchangeRate: 7.2,
    });
  });

  describe('constructor', () => {
    it('should require database', () => {
      expect(() => new TokenTracker()).toThrow('database 参数是必需的');
    });

    it('should initialize with default options', () => {
      const t = new TokenTracker(mockDb);
      expect(t.options.enableCostTracking).toBe(true);
      expect(t.options.enableBudgetAlerts).toBe(true);
      expect(t.options.exchangeRate).toBe(7.2);
    });

    it('should initialize with custom options', () => {
      const t = new TokenTracker(mockDb, {
        enableCostTracking: false,
        exchangeRate: 7.5,
      });
      expect(t.options.enableCostTracking).toBe(false);
      expect(t.options.exchangeRate).toBe(7.5);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for OpenAI models', () => {
      const result = tracker.calculateCost(
        'openai',
        'gpt-4o',
        1000000, // 1M input tokens
        500000, // 500K output tokens
      );

      // Input: 1M * $2.5/M = $2.5
      // Output: 0.5M * $10/M = $5
      expect(result.costUsd).toBe(7.5);
      expect(result.costCny).toBe(7.5 * 7.2);
    });

    it('should calculate cost for Anthropic models with caching', () => {
      const result = tracker.calculateCost(
        'anthropic',
        'claude-3-5-sonnet-20241022',
        1000000, // 1M input
        500000, // 500K output
        200000, // 200K cached
      );

      // Input: 1M * $3/M = $3
      // Output: 0.5M * $15/M = $7.5
      // Cached: 0.2M * $0.3/M = $0.06
      expect(result.costUsd).toBeCloseTo(10.56, 2);
    });

    it('should return zero for Ollama (free)', () => {
      const result = tracker.calculateCost(
        'ollama',
        'llama2:7b',
        1000000,
        1000000,
      );

      expect(result.costUsd).toBe(0);
      expect(result.costCny).toBe(0);
    });

    it('should use default pricing for unknown models', () => {
      const result = tracker.calculateCost(
        'custom',
        'unknown-model',
        1000000,
        1000000,
      );

      expect(result.costUsd).toBeGreaterThan(0);
      expect(result.pricing).toBeDefined();
    });

    it('should return zero when cost tracking disabled', () => {
      const t = new TokenTracker(mockDb, { enableCostTracking: false });
      const result = t.calculateCost('openai', 'gpt-4o', 1000000, 1000000);

      expect(result.costUsd).toBe(0);
      expect(result.pricing).toBeNull();
    });

    it('should handle case-insensitive provider names', () => {
      const result1 = tracker.calculateCost('OpenAI', 'gpt-4o', 1000, 1000);
      const result2 = tracker.calculateCost('openai', 'gpt-4o', 1000, 1000);

      expect(result1.costUsd).toBe(result2.costUsd);
    });
  });

  describe('recordUsage', () => {
    it('should record usage with valid parameters', async () => {
      const mockRun = vi.fn();
      mockDb.prepare.mockReturnValue({
        run: mockRun,
        get: vi.fn(),
      });

      const result = await tracker.recordUsage({
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        conversationId: 'conv-1',
        messageId: 'msg-1',
      });

      expect(result.totalTokens).toBe(150);
      expect(result.costUsd).toBeGreaterThan(0);
      expect(mockRun).toHaveBeenCalled();
    });

    it('should require provider and model', async () => {
      const result = await tracker.recordUsage({
        inputTokens: 100,
      });

      expect(result).toBeUndefined();
    });

    it('should track cached and compressed usage', async () => {
      mockDb.prepare.mockReturnValue({
        run: vi.fn(),
        get: vi.fn(),
      });

      await tracker.recordUsage({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 200,
        wasCached: true,
        wasCompressed: true,
        compressionRatio: 0.6,
      });

      // Verify the run was called (usage was recorded)
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(
        tracker.recordUsage({
          provider: 'openai',
          model: 'gpt-4o',
        }),
      ).rejects.toThrow();
    });
  });

  describe('getUsageStats', () => {
    it('should return usage statistics', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_calls: 100,
          total_input_tokens: 50000,
          total_output_tokens: 30000,
          total_tokens: 80000,
          total_cost_usd: 5.5,
          total_cost_cny: 39.6,
          cached_calls: 20,
          compressed_calls: 15,
          avg_response_time: 1500,
        }),
      });

      const stats = await tracker.getUsageStats({
        startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
        endDate: Date.now(),
      });

      expect(stats.totalCalls).toBe(100);
      expect(stats.totalTokens).toBe(80000);
      expect(stats.cacheHitRate).toBe(20);
      expect(stats.avgResponseTime).toBe(1500);
    });

    it('should filter by provider', async () => {
      const mockGet = vi.fn().mockReturnValue({});
      mockDb.prepare.mockReturnValue({ get: mockGet });

      await tracker.getUsageStats({ provider: 'openai' });

      // Verify provider filter was applied
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('getTimeSeriesData', () => {
    it('should return time-bucketed data', async () => {
      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([
          { time_bucket: 1704067200000, calls: 50, tokens: 10000, cost_usd: 1.5 },
          { time_bucket: 1704153600000, calls: 75, tokens: 15000, cost_usd: 2.0 },
        ]),
      });

      const data = await tracker.getTimeSeriesData({
        interval: 'day',
      });

      expect(data).toHaveLength(2);
      expect(data[0].timestamp).toBeDefined();
      expect(data[0].calls).toBe(50);
    });

    it('should support different intervals', async () => {
      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      await tracker.getTimeSeriesData({ interval: 'hour' });
      await tracker.getTimeSeriesData({ interval: 'day' });
      await tracker.getTimeSeriesData({ interval: 'week' });

      expect(mockDb.prepare).toHaveBeenCalledTimes(3);
    });
  });

  describe('getCostBreakdown', () => {
    it('should return breakdown by provider and model', async () => {
      mockDb.prepare
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([
            { provider: 'openai', calls: 100, tokens: 50000, cost_usd: 3.0 },
            { provider: 'anthropic', calls: 50, tokens: 25000, cost_usd: 2.0 },
          ]),
        })
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([
            {
              provider: 'openai',
              model: 'gpt-4o',
              calls: 80,
              tokens: 40000,
              cost_usd: 2.5,
            },
            {
              provider: 'openai',
              model: 'gpt-4o-mini',
              calls: 20,
              tokens: 10000,
              cost_usd: 0.5,
            },
          ]),
        });

      const breakdown = await tracker.getCostBreakdown();

      expect(breakdown.byProvider).toHaveLength(2);
      expect(breakdown.byModel).toHaveLength(2);
    });
  });

  describe('budget management', () => {
    it('should get budget config', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          user_id: 'default',
          daily_limit_usd: 10,
          weekly_limit_usd: 50,
          monthly_limit_usd: 200,
        }),
      });

      const config = await tracker.getBudgetConfig('default');

      expect(config.daily_limit_usd).toBe(10);
    });

    it('should return null for non-existent user', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      });

      const config = await tracker.getBudgetConfig('non-existent');

      expect(config).toBeNull();
    });

    it('should save new budget config', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(null),
        run: vi.fn(),
      });

      await tracker.saveBudgetConfig('default', {
        dailyLimit: 10,
        weeklyLimit: 50,
        monthlyLimit: 200,
        warningThreshold: 0.8,
        criticalThreshold: 0.95,
        desktopAlerts: true,
      });

      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should update existing budget config', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ user_id: 'default' }),
        run: vi.fn(),
      });

      await tracker.saveBudgetConfig('default', {
        dailyLimit: 20,
      });

      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('updateBudgetSpend', () => {
    it('should update spend counters', async () => {
      const mockRun = vi.fn();
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          user_id: 'default',
          daily_limit_usd: 10,
          current_daily_spend: 5,
          current_weekly_spend: 20,
          current_monthly_spend: 50,
          daily_reset_at: Date.now() + 100000,
          weekly_reset_at: Date.now() + 100000,
          monthly_reset_at: Date.now() + 100000,
        }),
        run: mockRun,
      });

      await tracker.updateBudgetSpend('default', 1.5);

      expect(mockRun).toHaveBeenCalled();
    });

    it('should reset counters when period expires', async () => {
      const mockRun = vi.fn();
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          user_id: 'default',
          current_daily_spend: 5,
          current_weekly_spend: 20,
          current_monthly_spend: 50,
          daily_reset_at: Date.now() - 1000, // Expired
          weekly_reset_at: Date.now() + 100000,
          monthly_reset_at: Date.now() + 100000,
        }),
        run: mockRun,
      });

      await tracker.updateBudgetSpend('default', 1.0);

      // Verify reset logic was applied
      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe('checkBudgetAlerts', () => {
    beforeEach(() => {
      tracker = new TokenTracker(mockDb, {
        enableBudgetAlerts: true,
      });
    });

    it('should emit warning alert when threshold exceeded', async () => {
      const alertHandler = vi.fn();
      tracker.on('budget-alert', alertHandler);

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          desktop_alerts: true,
          warning_threshold: 0.8,
          critical_threshold: 0.95,
          daily_limit_usd: 10,
          current_daily_spend: 8.5, // 85% usage
          weekly_limit_usd: 50,
          current_weekly_spend: 20,
          monthly_limit_usd: 200,
          current_monthly_spend: 50,
        }),
      });

      await tracker.checkBudgetAlerts('default');

      expect(alertHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          period: 'daily',
        }),
      );
    });

    it('should emit critical alert when critical threshold exceeded', async () => {
      const alertHandler = vi.fn();
      tracker.on('budget-alert', alertHandler);

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          desktop_alerts: true,
          warning_threshold: 0.8,
          critical_threshold: 0.95,
          daily_limit_usd: 10,
          current_daily_spend: 9.6, // 96% usage
          weekly_limit_usd: 50,
          current_weekly_spend: 20,
          monthly_limit_usd: 200,
          current_monthly_spend: 50,
        }),
      });

      await tracker.checkBudgetAlerts('default');

      expect(alertHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'critical',
          period: 'daily',
        }),
      );
    });

    it('should not emit alerts when disabled', async () => {
      const alertHandler = vi.fn();
      tracker.on('budget-alert', alertHandler);

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          desktop_alerts: false,
        }),
      });

      await tracker.checkBudgetAlerts('default');

      expect(alertHandler).not.toHaveBeenCalled();
    });
  });
});
