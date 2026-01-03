/**
 * Credit Score IPC Handlers Unit Tests
 * 信用评分系统 IPC 处理器单元测试
 *
 * 测试所有7个信用评分相关的IPC处理器
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ===================== MOCKS =====================

// Create mock ipcMain instance
let mockIpcMain;

// Import credit-ipc (no need to mock electron - we use dependency injection)
const { registerCreditIPC } = require('../../../src/main/credit/credit-ipc');

// ===================== MOCK FACTORIES =====================

/**
 * Create mock ipcMain
 */
const createMockIpcMain = () => {
  const handlers = new Map();

  return {
    handle: vi.fn((channel, handler) => {
      handlers.set(channel, handler);
    }),
    // Helper method to get registered handler
    getHandler: (channel) => handlers.get(channel),
    // Helper to simulate IPC call
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      return handler({}, ...args);
    },
  };
};

/**
 * Create mock creditScoreManager
 */
const createMockCreditManager = () => ({
  getUserCredit: vi.fn().mockResolvedValue({
    user_did: 'did:example:123',
    credit_score: 750,
    credit_level: 'excellent',
    total_transactions: 100,
    successful_transactions: 95,
    failed_transactions: 5,
    total_volume: 50000,
    avg_transaction_value: 500,
    last_updated: '2026-01-03T00:00:00Z',
  }),
  calculateScore: vi.fn().mockResolvedValue({
    user_did: 'did:example:123',
    credit_score: 750,
    credit_level: 'excellent',
    score_breakdown: {
      transaction_history: 300,
      payment_reliability: 250,
      account_age: 100,
      transaction_volume: 100,
    },
  }),
  getScoreHistory: vi.fn().mockResolvedValue([
    {
      id: 1,
      user_did: 'did:example:123',
      credit_score: 750,
      timestamp: '2026-01-03T00:00:00Z',
    },
    {
      id: 2,
      user_did: 'did:example:123',
      credit_score: 720,
      timestamp: '2026-01-02T00:00:00Z',
    },
  ]),
  getCreditLevel: vi.fn().mockResolvedValue({
    level: 'excellent',
    min_score: 700,
    max_score: 850,
    benefits: [
      'Lower transaction fees',
      'Higher transaction limits',
      'Priority support',
      'Exclusive access to premium features',
    ],
    requirements: [
      'Maintain score above 700',
      'Complete at least 50 transactions',
      'Zero defaults in last 6 months',
    ],
  }),
  getLeaderboard: vi.fn().mockResolvedValue([
    {
      rank: 1,
      user_did: 'did:example:top1',
      credit_score: 850,
      username: 'TopTrader',
    },
    {
      rank: 2,
      user_did: 'did:example:top2',
      credit_score: 820,
      username: 'ProUser',
    },
    {
      rank: 3,
      user_did: 'did:example:top3',
      credit_score: 800,
      username: 'EliteTrader',
    },
  ]),
  getStatistics: vi.fn().mockResolvedValue({
    total_users: 10000,
    avg_score: 650,
    median_score: 680,
    score_distribution: {
      poor: 1000,
      fair: 2000,
      good: 3500,
      very_good: 2500,
      excellent: 1000,
    },
    total_transactions: 500000,
    total_volume: 25000000,
  }),
});

// ===================== TESTS =====================

describe('Credit IPC Handlers', () => {
  let mockCreditManager;
  let context;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create new mock ipcMain for each test
    mockIpcMain = createMockIpcMain();

    mockCreditManager = createMockCreditManager();
    context = {
      creditScoreManager: mockCreditManager,
      ipcMain: mockIpcMain, // ✅ 注入 mock ipcMain
    };

    // Mock console.log and console.error to avoid cluttering test output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('registerCreditIPC()', () => {
    it('should register all 7 IPC handlers', () => {
      registerCreditIPC(context);

      expect(mockIpcMain.handle).toHaveBeenCalledTimes(7);
    });

    it('should register all credit handlers', () => {
      registerCreditIPC(context);

      const creditHandlers = [
        'credit:get-user-credit',
        'credit:update-score',
        'credit:get-score-history',
        'credit:get-credit-level',
        'credit:get-leaderboard',
        'credit:get-benefits',
        'credit:get-statistics',
      ];

      creditHandlers.forEach(channel => {
        expect(mockIpcMain.getHandler(channel)).toBeDefined();
      });
    });

    it('should log registration message', () => {
      registerCreditIPC(context);

      expect(console.log).toHaveBeenCalledWith(
        '[Credit IPC] 已注册 7 个信用评分 IPC 处理器'
      );
    });
  });

  describe('credit:get-user-credit', () => {
    beforeEach(() => {
      registerCreditIPC(context);
    });

    it('should return user credit data when manager is available', async () => {
      const userDid = 'did:example:123';
      const result = await mockIpcMain.invoke('credit:get-user-credit', userDid);

      expect(mockCreditManager.getUserCredit).toHaveBeenCalledWith(userDid);
      expect(result).toBeDefined();
      expect(result.user_did).toBe(userDid);
      expect(result.credit_score).toBe(750);
      expect(result.credit_level).toBe('excellent');
    });

    it('should return null when manager is not available', async () => {
      const contextWithoutManager = { creditScoreManager: null, ipcMain: mockIpcMain };
      registerCreditIPC(contextWithoutManager);

      const result = await mockIpcMain.invoke('credit:get-user-credit', 'did:example:123');

      expect(result).toBeNull();
    });

    it('should return null and log error when getUserCredit fails', async () => {
      mockCreditManager.getUserCredit.mockRejectedValueOnce(new Error('Database error'));

      const result = await mockIpcMain.invoke('credit:get-user-credit', 'did:example:123');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        '[Credit IPC] 获取用户信用失败:',
        expect.any(Error)
      );
    });

    it('should handle missing user', async () => {
      mockCreditManager.getUserCredit.mockResolvedValueOnce(null);

      const result = await mockIpcMain.invoke('credit:get-user-credit', 'did:example:nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('credit:update-score', () => {
    beforeEach(() => {
      registerCreditIPC(context);
    });

    it('should calculate and return updated credit score', async () => {
      const userDid = 'did:example:123';
      const result = await mockIpcMain.invoke('credit:update-score', userDid);

      expect(mockCreditManager.calculateScore).toHaveBeenCalledWith(userDid);
      expect(result).toBeDefined();
      expect(result.credit_score).toBe(750);
      expect(result.score_breakdown).toBeDefined();
    });

    it('should throw error when manager is not initialized', async () => {
      const contextWithoutManager = { creditScoreManager: null, ipcMain: mockIpcMain };
      registerCreditIPC(contextWithoutManager);

      await expect(
        mockIpcMain.invoke('credit:update-score', 'did:example:123')
      ).rejects.toThrow('信用评分管理器未初始化');
    });

    it('should throw and log error when calculateScore fails', async () => {
      const error = new Error('Calculation failed');
      mockCreditManager.calculateScore.mockRejectedValueOnce(error);

      await expect(
        mockIpcMain.invoke('credit:update-score', 'did:example:123')
      ).rejects.toThrow('Calculation failed');

      expect(console.error).toHaveBeenCalledWith(
        '[Credit IPC] 更新信用评分失败:',
        error
      );
    });

    it('should handle invalid user DID', async () => {
      mockCreditManager.calculateScore.mockRejectedValueOnce(
        new Error('User not found')
      );

      await expect(
        mockIpcMain.invoke('credit:update-score', 'invalid:did')
      ).rejects.toThrow('User not found');
    });
  });

  describe('credit:get-score-history', () => {
    beforeEach(() => {
      registerCreditIPC(context);
    });

    it('should return score history with default limit', async () => {
      const userDid = 'did:example:123';
      const result = await mockIpcMain.invoke('credit:get-score-history', userDid);

      expect(mockCreditManager.getScoreHistory).toHaveBeenCalledWith(userDid, undefined);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].credit_score).toBe(750);
    });

    it('should return score history with custom limit', async () => {
      const userDid = 'did:example:123';
      const limit = 10;
      const result = await mockIpcMain.invoke('credit:get-score-history', userDid, limit);

      expect(mockCreditManager.getScoreHistory).toHaveBeenCalledWith(userDid, limit);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return empty array when manager is not available', async () => {
      const contextWithoutManager = { creditScoreManager: null, ipcMain: mockIpcMain };
      registerCreditIPC(contextWithoutManager);

      const result = await mockIpcMain.invoke('credit:get-score-history', 'did:example:123');

      expect(result).toEqual([]);
    });

    it('should return empty array and log error when getScoreHistory fails', async () => {
      mockCreditManager.getScoreHistory.mockRejectedValueOnce(new Error('Query error'));

      const result = await mockIpcMain.invoke('credit:get-score-history', 'did:example:123');

      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        '[Credit IPC] 获取评分历史失败:',
        expect.any(Error)
      );
    });

    it('should handle user with no history', async () => {
      mockCreditManager.getScoreHistory.mockResolvedValueOnce([]);

      const result = await mockIpcMain.invoke('credit:get-score-history', 'did:example:new');

      expect(result).toEqual([]);
    });
  });

  describe('credit:get-credit-level', () => {
    beforeEach(() => {
      registerCreditIPC(context);
    });

    it('should return credit level for given score', async () => {
      const score = 750;
      const result = await mockIpcMain.invoke('credit:get-credit-level', score);

      expect(mockCreditManager.getCreditLevel).toHaveBeenCalledWith(score);
      expect(result).toBeDefined();
      expect(result.level).toBe('excellent');
      expect(result.benefits).toBeDefined();
      expect(Array.isArray(result.benefits)).toBe(true);
    });

    it('should return null when manager is not available', async () => {
      const contextWithoutManager = { creditScoreManager: null, ipcMain: mockIpcMain };
      registerCreditIPC(contextWithoutManager);

      const result = await mockIpcMain.invoke('credit:get-credit-level', 750);

      expect(result).toBeNull();
    });

    it('should return null and log error when getCreditLevel fails', async () => {
      mockCreditManager.getCreditLevel.mockRejectedValueOnce(new Error('Invalid score'));

      const result = await mockIpcMain.invoke('credit:get-credit-level', -100);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        '[Credit IPC] 获取信用等级失败:',
        expect.any(Error)
      );
    });

    it('should handle different score ranges', async () => {
      const scores = [300, 500, 650, 750, 850];

      for (const score of scores) {
        mockCreditManager.getCreditLevel.mockResolvedValueOnce({
          level: 'test-level',
          min_score: score - 50,
          max_score: score + 50,
        });

        const result = await mockIpcMain.invoke('credit:get-credit-level', score);
        expect(result).toBeDefined();
        expect(result.level).toBe('test-level');
      }
    });
  });

  describe('credit:get-leaderboard', () => {
    beforeEach(() => {
      registerCreditIPC(context);
    });

    it('should return leaderboard with default limit', async () => {
      const result = await mockIpcMain.invoke('credit:get-leaderboard');

      expect(mockCreditManager.getLeaderboard).toHaveBeenCalledWith(undefined);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result[0].rank).toBe(1);
      expect(result[0].credit_score).toBe(850);
    });

    it('should return leaderboard with custom limit', async () => {
      const limit = 50;
      const result = await mockIpcMain.invoke('credit:get-leaderboard', limit);

      expect(mockCreditManager.getLeaderboard).toHaveBeenCalledWith(limit);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return empty array when manager is not available', async () => {
      const contextWithoutManager = { creditScoreManager: null, ipcMain: mockIpcMain };
      registerCreditIPC(contextWithoutManager);

      const result = await mockIpcMain.invoke('credit:get-leaderboard');

      expect(result).toEqual([]);
    });

    it('should return empty array and log error when getLeaderboard fails', async () => {
      mockCreditManager.getLeaderboard.mockRejectedValueOnce(new Error('Database error'));

      const result = await mockIpcMain.invoke('credit:get-leaderboard');

      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        '[Credit IPC] 获取排行榜失败:',
        expect.any(Error)
      );
    });

    it('should verify leaderboard ordering', async () => {
      const result = await mockIpcMain.invoke('credit:get-leaderboard');

      expect(result[0].credit_score).toBeGreaterThanOrEqual(result[1].credit_score);
      expect(result[1].credit_score).toBeGreaterThanOrEqual(result[2].credit_score);
    });
  });

  describe('credit:get-benefits', () => {
    beforeEach(() => {
      registerCreditIPC(context);
    });

    it('should return user benefits based on credit level', async () => {
      const userDid = 'did:example:123';
      const result = await mockIpcMain.invoke('credit:get-benefits', userDid);

      expect(mockCreditManager.getUserCredit).toHaveBeenCalledWith(userDid);
      expect(mockCreditManager.getCreditLevel).toHaveBeenCalledWith(750);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(4);
      expect(result).toContain('Lower transaction fees');
    });

    it('should return empty array when manager is not available', async () => {
      const contextWithoutManager = { creditScoreManager: null, ipcMain: mockIpcMain };
      registerCreditIPC(contextWithoutManager);

      const result = await mockIpcMain.invoke('credit:get-benefits', 'did:example:123');

      expect(result).toEqual([]);
    });

    it('should return empty array when user credit not found', async () => {
      mockCreditManager.getUserCredit.mockResolvedValueOnce(null);

      const result = await mockIpcMain.invoke('credit:get-benefits', 'did:example:nonexistent');

      expect(result).toEqual([]);
    });

    it('should return empty array when credit level not found', async () => {
      mockCreditManager.getCreditLevel.mockResolvedValueOnce(null);

      const result = await mockIpcMain.invoke('credit:get-benefits', 'did:example:123');

      expect(result).toEqual([]);
    });

    it('should return empty array and log error when operation fails', async () => {
      mockCreditManager.getUserCredit.mockRejectedValueOnce(new Error('Database error'));

      const result = await mockIpcMain.invoke('credit:get-benefits', 'did:example:123');

      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        '[Credit IPC] 获取信用权益失败:',
        expect.any(Error)
      );
    });

    it('should handle credit level with no benefits', async () => {
      mockCreditManager.getCreditLevel.mockResolvedValueOnce({
        level: 'poor',
        benefits: [],
      });

      const result = await mockIpcMain.invoke('credit:get-benefits', 'did:example:123');

      expect(result).toEqual([]);
    });
  });

  describe('credit:get-statistics', () => {
    beforeEach(() => {
      registerCreditIPC(context);
    });

    it('should return credit statistics', async () => {
      const result = await mockIpcMain.invoke('credit:get-statistics');

      expect(mockCreditManager.getStatistics).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.total_users).toBe(10000);
      expect(result.avg_score).toBe(650);
      expect(result.score_distribution).toBeDefined();
    });

    it('should return null when manager is not available', async () => {
      const contextWithoutManager = { creditScoreManager: null, ipcMain: mockIpcMain };
      registerCreditIPC(contextWithoutManager);

      const result = await mockIpcMain.invoke('credit:get-statistics');

      expect(result).toBeNull();
    });

    it('should return null and log error when getStatistics fails', async () => {
      mockCreditManager.getStatistics.mockRejectedValueOnce(new Error('Query failed'));

      const result = await mockIpcMain.invoke('credit:get-statistics');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        '[Credit IPC] 获取统计信息失败:',
        expect.any(Error)
      );
    });

    it('should verify statistics structure', async () => {
      const result = await mockIpcMain.invoke('credit:get-statistics');

      expect(result).toHaveProperty('total_users');
      expect(result).toHaveProperty('avg_score');
      expect(result).toHaveProperty('median_score');
      expect(result).toHaveProperty('score_distribution');
      expect(result).toHaveProperty('total_transactions');
      expect(result).toHaveProperty('total_volume');
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      registerCreditIPC(context);
    });

    it('should handle undefined context', () => {
      expect(() => registerCreditIPC(undefined)).toThrow();
    });

    it('should handle null context', () => {
      expect(() => registerCreditIPC(null)).toThrow();
    });

    it('should handle context without creditScoreManager', () => {
      const emptyContext = { ipcMain: mockIpcMain };
      expect(() => registerCreditIPC(emptyContext)).not.toThrow();
    });

    it('should handle async errors gracefully', async () => {
      mockCreditManager.getUserCredit.mockRejectedValueOnce(
        new Error('Unexpected error')
      );

      const result = await mockIpcMain.invoke('credit:get-user-credit', 'did:example:123');

      expect(result).toBeNull();
    });

    it('should handle network timeout errors', async () => {
      mockCreditManager.calculateScore.mockRejectedValueOnce(
        new Error('Network timeout')
      );

      await expect(
        mockIpcMain.invoke('credit:update-score', 'did:example:123')
      ).rejects.toThrow('Network timeout');
    });
  });

  describe('Integration Scenarios', () => {
    beforeEach(() => {
      registerCreditIPC(context);
    });

    it('should handle complete user credit workflow', async () => {
      const userDid = 'did:example:123';

      // 1. Get user credit
      const credit = await mockIpcMain.invoke('credit:get-user-credit', userDid);
      expect(credit).toBeDefined();

      // 2. Update score
      const updatedScore = await mockIpcMain.invoke('credit:update-score', userDid);
      expect(updatedScore).toBeDefined();

      // 3. Get score history
      const history = await mockIpcMain.invoke('credit:get-score-history', userDid, 10);
      expect(Array.isArray(history)).toBe(true);

      // 4. Get credit level
      const level = await mockIpcMain.invoke('credit:get-credit-level', credit.credit_score);
      expect(level).toBeDefined();

      // 5. Get benefits
      const benefits = await mockIpcMain.invoke('credit:get-benefits', userDid);
      expect(Array.isArray(benefits)).toBe(true);
    });

    it('should handle leaderboard and statistics together', async () => {
      const leaderboard = await mockIpcMain.invoke('credit:get-leaderboard', 10);
      const statistics = await mockIpcMain.invoke('credit:get-statistics');

      expect(leaderboard).toBeDefined();
      expect(statistics).toBeDefined();
      expect(Array.isArray(leaderboard)).toBe(true);
    });

    it('should verify all handlers are callable', async () => {
      const handlers = [
        ['credit:get-user-credit', 'did:example:123'],
        ['credit:update-score', 'did:example:123'],
        ['credit:get-score-history', 'did:example:123'],
        ['credit:get-credit-level', 750],
        ['credit:get-leaderboard', 10],
        ['credit:get-benefits', 'did:example:123'],
        ['credit:get-statistics'],
      ];

      for (const [channel, ...args] of handlers) {
        const handler = mockIpcMain.getHandler(channel);
        expect(handler).toBeDefined();
        const result = await handler({}, ...args);
        expect(result).toBeDefined();
      }
    });
  });
});
