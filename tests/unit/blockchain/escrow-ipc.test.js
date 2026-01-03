/**
 * Escrow IPC 单元测试
 * 测试托管管理 IPC 处理器的所有功能
 */

const { ipcMain } = require('electron');
const { registerEscrowIPC } = require('../../../desktop-app-vue/src/main/blockchain/escrow-ipc');

// Mock ipcMain
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
}));

describe('Escrow IPC Handlers', () => {
  let mockEscrowManager;
  let handlers = {};

  beforeEach(() => {
    // 清除所有 mocks
    jest.clearAllMocks();
    handlers = {};

    // 创建 mock 托管管理器
    mockEscrowManager = {
      getEscrow: jest.fn(),
      getEscrows: jest.fn(),
      getEscrowHistory: jest.fn(),
      disputeEscrow: jest.fn(),
      getStatistics: jest.fn(),
    };

    // 捕获所有注册的 handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 IPC handlers
    registerEscrowIPC(mockEscrowManager);
  });

  afterEach(() => {
    handlers = {};
  });

  // ============================================================
  // 托管查询测试
  // ============================================================

  describe('escrow:get', () => {
    it('should get escrow details successfully', async () => {
      const mockEscrow = {
        id: 'escrow-1',
        buyer: '0x123...',
        seller: '0x456...',
        amount: '1000000000000000000',
        status: 'locked',
        createdAt: 1640000000000,
      };

      mockEscrowManager.getEscrow.mockResolvedValue(mockEscrow);

      const handler = handlers['escrow:get'];
      const result = await handler(null, 'escrow-1');

      expect(mockEscrowManager.getEscrow).toHaveBeenCalledWith('escrow-1');
      expect(result).toEqual(mockEscrow);
    });

    it('should return null when escrow manager is not initialized', async () => {
      registerEscrowIPC(null);
      const handler = handlers['escrow:get'];

      const result = await handler(null, 'escrow-1');

      expect(mockEscrowManager.getEscrow).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should handle errors when getting escrow', async () => {
      const errorMessage = 'Database connection failed';
      mockEscrowManager.getEscrow.mockRejectedValue(new Error(errorMessage));

      const handler = handlers['escrow:get'];

      await expect(handler(null, 'escrow-1')).rejects.toThrow(errorMessage);
      expect(mockEscrowManager.getEscrow).toHaveBeenCalledWith('escrow-1');
    });

    it('should handle non-existent escrow', async () => {
      mockEscrowManager.getEscrow.mockResolvedValue(null);

      const handler = handlers['escrow:get'];
      const result = await handler(null, 'non-existent-escrow');

      expect(mockEscrowManager.getEscrow).toHaveBeenCalledWith('non-existent-escrow');
      expect(result).toBeNull();
    });
  });

  describe('escrow:get-list', () => {
    it('should get escrow list with filters successfully', async () => {
      const mockEscrows = [
        {
          id: 'escrow-1',
          buyer: '0x123...',
          seller: '0x456...',
          amount: '1000000000000000000',
          status: 'locked',
        },
        {
          id: 'escrow-2',
          buyer: '0x789...',
          seller: '0xabc...',
          amount: '2000000000000000000',
          status: 'released',
        },
      ];

      const filters = { status: 'locked', buyer: '0x123...' };
      mockEscrowManager.getEscrows.mockResolvedValue(mockEscrows);

      const handler = handlers['escrow:get-list'];
      const result = await handler(null, filters);

      expect(mockEscrowManager.getEscrows).toHaveBeenCalledWith(filters);
      expect(result).toEqual(mockEscrows);
    });

    it('should get all escrows without filters', async () => {
      const mockEscrows = [
        { id: 'escrow-1', status: 'locked' },
        { id: 'escrow-2', status: 'released' },
        { id: 'escrow-3', status: 'refunded' },
      ];

      mockEscrowManager.getEscrows.mockResolvedValue(mockEscrows);

      const handler = handlers['escrow:get-list'];
      const result = await handler(null, {});

      expect(mockEscrowManager.getEscrows).toHaveBeenCalledWith({});
      expect(result).toEqual(mockEscrows);
    });

    it('should return empty array when escrow manager is not initialized', async () => {
      registerEscrowIPC(null);
      const handler = handlers['escrow:get-list'];

      const result = await handler(null, {});

      expect(mockEscrowManager.getEscrows).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should handle errors when getting escrow list', async () => {
      const errorMessage = 'Query failed';
      mockEscrowManager.getEscrows.mockRejectedValue(new Error(errorMessage));

      const handler = handlers['escrow:get-list'];
      const filters = { status: 'locked' };

      await expect(handler(null, filters)).rejects.toThrow(errorMessage);
      expect(mockEscrowManager.getEscrows).toHaveBeenCalledWith(filters);
    });

    it('should handle undefined filters', async () => {
      const mockEscrows = [{ id: 'escrow-1' }];
      mockEscrowManager.getEscrows.mockResolvedValue(mockEscrows);

      const handler = handlers['escrow:get-list'];
      const result = await handler(null, undefined);

      expect(mockEscrowManager.getEscrows).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(mockEscrows);
    });
  });

  describe('escrow:get-history', () => {
    it('should get escrow history successfully', async () => {
      const mockHistory = [
        {
          id: 'history-1',
          escrowId: 'escrow-1',
          action: 'created',
          timestamp: 1640000000000,
          actor: '0x123...',
        },
        {
          id: 'history-2',
          escrowId: 'escrow-1',
          action: 'locked',
          timestamp: 1640001000000,
          actor: '0x123...',
        },
        {
          id: 'history-3',
          escrowId: 'escrow-1',
          action: 'released',
          timestamp: 1640002000000,
          actor: '0x456...',
        },
      ];

      mockEscrowManager.getEscrowHistory.mockResolvedValue(mockHistory);

      const handler = handlers['escrow:get-history'];
      const result = await handler(null, 'escrow-1');

      expect(mockEscrowManager.getEscrowHistory).toHaveBeenCalledWith('escrow-1');
      expect(result).toEqual(mockHistory);
    });

    it('should return empty array when escrow manager is not initialized', async () => {
      registerEscrowIPC(null);
      const handler = handlers['escrow:get-history'];

      const result = await handler(null, 'escrow-1');

      expect(mockEscrowManager.getEscrowHistory).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should handle errors when getting escrow history', async () => {
      const errorMessage = 'History retrieval failed';
      mockEscrowManager.getEscrowHistory.mockRejectedValue(new Error(errorMessage));

      const handler = handlers['escrow:get-history'];

      await expect(handler(null, 'escrow-1')).rejects.toThrow(errorMessage);
      expect(mockEscrowManager.getEscrowHistory).toHaveBeenCalledWith('escrow-1');
    });

    it('should return empty array for escrow with no history', async () => {
      mockEscrowManager.getEscrowHistory.mockResolvedValue([]);

      const handler = handlers['escrow:get-history'];
      const result = await handler(null, 'escrow-no-history');

      expect(mockEscrowManager.getEscrowHistory).toHaveBeenCalledWith('escrow-no-history');
      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // 托管操作测试
  // ============================================================

  describe('escrow:dispute', () => {
    it('should dispute escrow successfully', async () => {
      const mockDispute = {
        id: 'dispute-1',
        escrowId: 'escrow-1',
        reason: 'Product not as described',
        status: 'pending',
        createdAt: 1640000000000,
      };

      mockEscrowManager.disputeEscrow.mockResolvedValue(mockDispute);

      const handler = handlers['escrow:dispute'];
      const result = await handler(null, 'escrow-1', 'Product not as described');

      expect(mockEscrowManager.disputeEscrow).toHaveBeenCalledWith('escrow-1', 'Product not as described');
      expect(result).toEqual(mockDispute);
    });

    it('should throw error when escrow manager is not initialized', async () => {
      registerEscrowIPC(null);
      const handler = handlers['escrow:dispute'];

      await expect(handler(null, 'escrow-1', 'Reason')).rejects.toThrow('托管管理器未初始化');
      expect(mockEscrowManager.disputeEscrow).not.toHaveBeenCalled();
    });

    it('should handle errors when disputing escrow', async () => {
      const errorMessage = 'Escrow cannot be disputed in current state';
      mockEscrowManager.disputeEscrow.mockRejectedValue(new Error(errorMessage));

      const handler = handlers['escrow:dispute'];

      await expect(handler(null, 'escrow-1', 'Reason')).rejects.toThrow(errorMessage);
      expect(mockEscrowManager.disputeEscrow).toHaveBeenCalledWith('escrow-1', 'Reason');
    });

    it('should dispute escrow with detailed reason', async () => {
      const detailedReason = 'Product arrived damaged. Seller refuses to provide refund or replacement. I have photographic evidence.';
      const mockDispute = {
        id: 'dispute-2',
        escrowId: 'escrow-2',
        reason: detailedReason,
        status: 'pending',
      };

      mockEscrowManager.disputeEscrow.mockResolvedValue(mockDispute);

      const handler = handlers['escrow:dispute'];
      const result = await handler(null, 'escrow-2', detailedReason);

      expect(mockEscrowManager.disputeEscrow).toHaveBeenCalledWith('escrow-2', detailedReason);
      expect(result).toEqual(mockDispute);
    });

    it('should handle empty reason', async () => {
      const mockDispute = {
        id: 'dispute-3',
        escrowId: 'escrow-3',
        reason: '',
        status: 'pending',
      };

      mockEscrowManager.disputeEscrow.mockResolvedValue(mockDispute);

      const handler = handlers['escrow:dispute'];
      const result = await handler(null, 'escrow-3', '');

      expect(mockEscrowManager.disputeEscrow).toHaveBeenCalledWith('escrow-3', '');
      expect(result).toEqual(mockDispute);
    });
  });

  // ============================================================
  // 统计信息测试
  // ============================================================

  describe('escrow:get-statistics', () => {
    it('should get escrow statistics successfully', async () => {
      const mockStatistics = {
        total: 100,
        locked: 20,
        released: 60,
        refunded: 15,
        disputed: 5,
      };

      mockEscrowManager.getStatistics.mockResolvedValue(mockStatistics);

      const handler = handlers['escrow:get-statistics'];
      const result = await handler();

      expect(mockEscrowManager.getStatistics).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStatistics);
    });

    it('should return default statistics when escrow manager is not initialized', async () => {
      registerEscrowIPC(null);
      const handler = handlers['escrow:get-statistics'];

      const result = await handler();

      expect(mockEscrowManager.getStatistics).not.toHaveBeenCalled();
      expect(result).toEqual({
        total: 0,
        locked: 0,
        released: 0,
        refunded: 0,
        disputed: 0,
      });
    });

    it('should handle errors when getting statistics', async () => {
      const errorMessage = 'Statistics calculation failed';
      mockEscrowManager.getStatistics.mockRejectedValue(new Error(errorMessage));

      const handler = handlers['escrow:get-statistics'];

      await expect(handler()).rejects.toThrow(errorMessage);
      expect(mockEscrowManager.getStatistics).toHaveBeenCalledTimes(1);
    });

    it('should handle statistics with zero values', async () => {
      const mockStatistics = {
        total: 0,
        locked: 0,
        released: 0,
        refunded: 0,
        disputed: 0,
      };

      mockEscrowManager.getStatistics.mockResolvedValue(mockStatistics);

      const handler = handlers['escrow:get-statistics'];
      const result = await handler();

      expect(mockEscrowManager.getStatistics).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStatistics);
    });

    it('should handle partial statistics data', async () => {
      const mockStatistics = {
        total: 50,
        locked: 10,
        released: 30,
        refunded: 8,
        disputed: 2,
      };

      mockEscrowManager.getStatistics.mockResolvedValue(mockStatistics);

      const handler = handlers['escrow:get-statistics'];
      const result = await handler();

      expect(result.total).toBe(50);
      expect(result.locked).toBe(10);
      expect(result.released).toBe(30);
      expect(result.refunded).toBe(8);
      expect(result.disputed).toBe(2);
    });
  });

  // ============================================================
  // 注册测试
  // ============================================================

  describe('registerEscrowIPC', () => {
    it('should register all 5 IPC handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledTimes(5);

      const registeredChannels = ipcMain.handle.mock.calls.map(call => call[0]);

      expect(registeredChannels).toContain('escrow:get');
      expect(registeredChannels).toContain('escrow:get-list');
      expect(registeredChannels).toContain('escrow:get-history');
      expect(registeredChannels).toContain('escrow:dispute');
      expect(registeredChannels).toContain('escrow:get-statistics');
    });

    it('should handle registration with null manager', () => {
      jest.clearAllMocks();

      expect(() => {
        registerEscrowIPC(null);
      }).not.toThrow();

      expect(ipcMain.handle).toHaveBeenCalled();
    });

    it('should verify all handlers are registered in correct order', () => {
      const registeredChannels = ipcMain.handle.mock.calls.map(call => call[0]);

      expect(registeredChannels[0]).toBe('escrow:get');
      expect(registeredChannels[1]).toBe('escrow:get-list');
      expect(registeredChannels[2]).toBe('escrow:get-history');
      expect(registeredChannels[3]).toBe('escrow:dispute');
      expect(registeredChannels[4]).toBe('escrow:get-statistics');
    });
  });

  // ============================================================
  // 错误处理和边界情况测试
  // ============================================================

  describe('Error Handling and Edge Cases', () => {
    it('should handle concurrent requests to get escrow', async () => {
      const mockEscrow1 = { id: 'escrow-1', status: 'locked' };
      const mockEscrow2 = { id: 'escrow-2', status: 'released' };

      mockEscrowManager.getEscrow
        .mockResolvedValueOnce(mockEscrow1)
        .mockResolvedValueOnce(mockEscrow2);

      const handler = handlers['escrow:get'];

      const [result1, result2] = await Promise.all([
        handler(null, 'escrow-1'),
        handler(null, 'escrow-2'),
      ]);

      expect(result1).toEqual(mockEscrow1);
      expect(result2).toEqual(mockEscrow2);
      expect(mockEscrowManager.getEscrow).toHaveBeenCalledTimes(2);
    });

    it('should handle network timeout errors', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.code = 'ETIMEDOUT';
      mockEscrowManager.getEscrow.mockRejectedValue(timeoutError);

      const handler = handlers['escrow:get'];

      await expect(handler(null, 'escrow-1')).rejects.toThrow('Request timeout');
    });

    it('should handle invalid escrow ID format', async () => {
      const invalidError = new Error('Invalid escrow ID format');
      mockEscrowManager.getEscrow.mockRejectedValue(invalidError);

      const handler = handlers['escrow:get'];

      await expect(handler(null, 'invalid@id#123')).rejects.toThrow('Invalid escrow ID format');
    });

    it('should handle database connection errors', async () => {
      const dbError = new Error('Database connection lost');
      mockEscrowManager.getStatistics.mockRejectedValue(dbError);

      const handler = handlers['escrow:get-statistics'];

      await expect(handler()).rejects.toThrow('Database connection lost');
    });

    it('should handle permission denied errors', async () => {
      const permissionError = new Error('Permission denied');
      mockEscrowManager.disputeEscrow.mockRejectedValue(permissionError);

      const handler = handlers['escrow:dispute'];

      await expect(handler(null, 'escrow-1', 'Reason')).rejects.toThrow('Permission denied');
    });
  });

  // ============================================================
  // 集成场景测试
  // ============================================================

  describe('Integration Scenarios', () => {
    it('should handle complete escrow lifecycle', async () => {
      // Get initial escrow
      const mockEscrow = {
        id: 'escrow-1',
        status: 'locked',
        amount: '1000000000000000000',
      };
      mockEscrowManager.getEscrow.mockResolvedValue(mockEscrow);

      const getHandler = handlers['escrow:get'];
      const escrow = await getHandler(null, 'escrow-1');
      expect(escrow.status).toBe('locked');

      // Get history
      const mockHistory = [
        { action: 'created', timestamp: 1640000000000 },
        { action: 'locked', timestamp: 1640001000000 },
      ];
      mockEscrowManager.getEscrowHistory.mockResolvedValue(mockHistory);

      const historyHandler = handlers['escrow:get-history'];
      const history = await historyHandler(null, 'escrow-1');
      expect(history).toHaveLength(2);

      // Dispute escrow
      const mockDispute = { id: 'dispute-1', status: 'pending' };
      mockEscrowManager.disputeEscrow.mockResolvedValue(mockDispute);

      const disputeHandler = handlers['escrow:dispute'];
      const dispute = await disputeHandler(null, 'escrow-1', 'Issue with product');
      expect(dispute.status).toBe('pending');
    });

    it('should handle bulk escrow operations', async () => {
      const mockEscrows = Array.from({ length: 100 }, (_, i) => ({
        id: `escrow-${i}`,
        status: i % 2 === 0 ? 'locked' : 'released',
      }));

      mockEscrowManager.getEscrows.mockResolvedValue(mockEscrows);

      const handler = handlers['escrow:get-list'];
      const result = await handler(null, {});

      expect(result).toHaveLength(100);
      expect(mockEscrowManager.getEscrows).toHaveBeenCalledWith({});
    });

    it('should maintain consistency when getting statistics after operations', async () => {
      // Initial statistics
      let mockStats = { total: 10, locked: 5, released: 3, refunded: 2, disputed: 0 };
      mockEscrowManager.getStatistics.mockResolvedValue(mockStats);

      const statsHandler = handlers['escrow:get-statistics'];
      let stats = await statsHandler();
      expect(stats.disputed).toBe(0);

      // After dispute
      mockStats = { total: 10, locked: 5, released: 3, refunded: 2, disputed: 1 };
      mockEscrowManager.getStatistics.mockResolvedValue(mockStats);

      stats = await statsHandler();
      expect(stats.disputed).toBe(1);
    });
  });
});
