/**
 * Bridge IPC 单元测试
 * 测试跨链桥 IPC 处理器的所有功能
 */

const { ipcMain } = require('electron');
const { registerBridgeIPC } = require('../../../desktop-app-vue/src/main/blockchain/bridge-ipc');

// Mock ipcMain
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
}));

describe('Bridge IPC Handlers', () => {
  let mockBridgeManager;
  let handlers = {};

  beforeEach(() => {
    // 清除所有 mocks
    jest.clearAllMocks();
    handlers = {};

    // 创建 mock 跨链桥管理器
    mockBridgeManager = {
      bridgeAsset: jest.fn(),
      getBridgeHistory: jest.fn(),
      getBridgeRecord: jest.fn(),
      registerBridgeContract: jest.fn(),
      getAssetBalance: jest.fn(),
      getBatchBalances: jest.fn(),
      getLockedBalance: jest.fn(),
    };

    // 捕获所有注册的 handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 IPC handlers
    registerBridgeIPC(mockBridgeManager);
  });

  afterEach(() => {
    handlers = {};
  });

  // ============================================================
  // 桥接资产测试
  // ============================================================

  describe('bridge:transfer', () => {
    it('should bridge asset successfully', async () => {
      const options = {
        fromChainId: 1,
        toChainId: 56,
        tokenAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        amount: '1000000000000000000',
        recipient: '0x123456789abcdef123456789abcdef123456789a',
      };

      const mockResult = {
        bridgeId: 'bridge-123',
        txHash: '0xabc123...',
        status: 'pending',
        fromChainId: 1,
        toChainId: 56,
        amount: '1000000000000000000',
      };

      mockBridgeManager.bridgeAsset.mockResolvedValue(mockResult);

      const handler = handlers['bridge:transfer'];
      const result = await handler(null, options);

      expect(mockBridgeManager.bridgeAsset).toHaveBeenCalledWith(options);
      expect(result).toEqual(mockResult);
    });

    it('should handle bridge transfer with minimal options', async () => {
      const options = {
        fromChainId: 1,
        toChainId: 56,
        amount: '1000000000000000000',
      };

      const mockResult = {
        bridgeId: 'bridge-456',
        txHash: '0xdef456...',
        status: 'pending',
      };

      mockBridgeManager.bridgeAsset.mockResolvedValue(mockResult);

      const handler = handlers['bridge:transfer'];
      const result = await handler(null, options);

      expect(mockBridgeManager.bridgeAsset).toHaveBeenCalledWith(options);
      expect(result).toEqual(mockResult);
    });

    it('should throw error when bridge manager is not initialized', async () => {
      registerBridgeIPC(null);
      const handler = handlers['bridge:transfer'];

      const options = { fromChainId: 1, toChainId: 56, amount: '1000' };
      await expect(handler(null, options)).rejects.toThrow('跨链桥管理器未初始化');
    });

    it('should handle bridge transfer failure', async () => {
      const options = { fromChainId: 1, toChainId: 56, amount: '1000' };
      const error = new Error('Insufficient funds for bridge transfer');

      mockBridgeManager.bridgeAsset.mockRejectedValue(error);

      const handler = handlers['bridge:transfer'];
      await expect(handler(null, options)).rejects.toThrow('Insufficient funds for bridge transfer');
      expect(mockBridgeManager.bridgeAsset).toHaveBeenCalledWith(options);
    });
  });

  // ============================================================
  // 桥接历史查询测试
  // ============================================================

  describe('bridge:get-history', () => {
    it('should get bridge history without filters', async () => {
      const mockHistory = [
        {
          bridgeId: 'bridge-123',
          fromChainId: 1,
          toChainId: 56,
          amount: '1000000000000000000',
          status: 'completed',
          timestamp: Date.now(),
        },
        {
          bridgeId: 'bridge-456',
          fromChainId: 56,
          toChainId: 1,
          amount: '2000000000000000000',
          status: 'pending',
          timestamp: Date.now() - 3600000,
        },
      ];

      mockBridgeManager.getBridgeHistory.mockResolvedValue(mockHistory);

      const handler = handlers['bridge:get-history'];
      const result = await handler(null, {});

      expect(mockBridgeManager.getBridgeHistory).toHaveBeenCalledWith({});
      expect(result).toEqual(mockHistory);
    });

    it('should get bridge history with filters', async () => {
      const filters = {
        fromChainId: 1,
        toChainId: 56,
        status: 'completed',
        limit: 10,
        offset: 0,
      };

      const mockHistory = [
        {
          bridgeId: 'bridge-123',
          fromChainId: 1,
          toChainId: 56,
          status: 'completed',
        },
      ];

      mockBridgeManager.getBridgeHistory.mockResolvedValue(mockHistory);

      const handler = handlers['bridge:get-history'];
      const result = await handler(null, filters);

      expect(mockBridgeManager.getBridgeHistory).toHaveBeenCalledWith(filters);
      expect(result).toEqual(mockHistory);
    });

    it('should get empty history', async () => {
      mockBridgeManager.getBridgeHistory.mockResolvedValue([]);

      const handler = handlers['bridge:get-history'];
      const result = await handler(null, {});

      expect(result).toEqual([]);
    });

    it('should throw error when bridge manager is not initialized', async () => {
      registerBridgeIPC(null);
      const handler = handlers['bridge:get-history'];

      await expect(handler(null, {})).rejects.toThrow('跨链桥管理器未初始化');
    });

    it('should handle get history failure', async () => {
      const error = new Error('Database connection failed');
      mockBridgeManager.getBridgeHistory.mockRejectedValue(error);

      const handler = handlers['bridge:get-history'];
      await expect(handler(null, {})).rejects.toThrow('Database connection failed');
    });
  });

  // ============================================================
  // 桥接记录详情测试
  // ============================================================

  describe('bridge:get-record', () => {
    it('should get bridge record details successfully', async () => {
      const bridgeId = 'bridge-123';
      const mockRecord = {
        bridgeId: 'bridge-123',
        fromChainId: 1,
        toChainId: 56,
        tokenAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        amount: '1000000000000000000',
        recipient: '0x123456789abcdef123456789abcdef123456789a',
        status: 'completed',
        txHash: '0xabc123...',
        confirmations: 12,
        timestamp: Date.now(),
      };

      mockBridgeManager.getBridgeRecord.mockResolvedValue(mockRecord);

      const handler = handlers['bridge:get-record'];
      const result = await handler(null, { bridgeId });

      expect(mockBridgeManager.getBridgeRecord).toHaveBeenCalledWith(bridgeId);
      expect(result).toEqual(mockRecord);
    });

    it('should handle non-existent bridge record', async () => {
      const bridgeId = 'non-existent-id';
      mockBridgeManager.getBridgeRecord.mockResolvedValue(null);

      const handler = handlers['bridge:get-record'];
      const result = await handler(null, { bridgeId });

      expect(result).toBeNull();
    });

    it('should throw error when bridge manager is not initialized', async () => {
      registerBridgeIPC(null);
      const handler = handlers['bridge:get-record'];

      await expect(handler(null, { bridgeId: 'bridge-123' })).rejects.toThrow('跨链桥管理器未初始化');
    });

    it('should handle get record failure', async () => {
      const error = new Error('Failed to fetch bridge record');
      mockBridgeManager.getBridgeRecord.mockRejectedValue(error);

      const handler = handlers['bridge:get-record'];
      await expect(handler(null, { bridgeId: 'bridge-123' })).rejects.toThrow('Failed to fetch bridge record');
    });
  });

  // ============================================================
  // 注册桥接合约测试
  // ============================================================

  describe('bridge:register-contract', () => {
    it('should register bridge contract successfully', async () => {
      const chainId = 1;
      const contractAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';

      mockBridgeManager.registerBridgeContract.mockReturnValue(undefined);

      const handler = handlers['bridge:register-contract'];
      const result = await handler(null, { chainId, contractAddress });

      expect(mockBridgeManager.registerBridgeContract).toHaveBeenCalledWith(chainId, contractAddress);
      expect(result).toEqual({ success: true });
    });

    it('should register multiple bridge contracts', async () => {
      const contracts = [
        { chainId: 1, contractAddress: '0x111...' },
        { chainId: 56, contractAddress: '0x222...' },
        { chainId: 137, contractAddress: '0x333...' },
      ];

      mockBridgeManager.registerBridgeContract.mockReturnValue(undefined);

      const handler = handlers['bridge:register-contract'];

      for (const contract of contracts) {
        const result = await handler(null, contract);
        expect(result).toEqual({ success: true });
      }

      expect(mockBridgeManager.registerBridgeContract).toHaveBeenCalledTimes(3);
    });

    it('should throw error when bridge manager is not initialized', async () => {
      registerBridgeIPC(null);
      const handler = handlers['bridge:register-contract'];

      await expect(
        handler(null, { chainId: 1, contractAddress: '0x123...' })
      ).rejects.toThrow('跨链桥管理器未初始化');
    });

    it('should handle registration failure', async () => {
      const error = new Error('Invalid contract address');
      mockBridgeManager.registerBridgeContract.mockImplementation(() => {
        throw error;
      });

      const handler = handlers['bridge:register-contract'];
      await expect(
        handler(null, { chainId: 1, contractAddress: 'invalid' })
      ).rejects.toThrow('Invalid contract address');
    });
  });

  // ============================================================
  // 查询资产余额测试
  // ============================================================

  describe('bridge:get-balance', () => {
    it('should get native token balance', async () => {
      const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
      const chainId = 1;

      const mockBalance = {
        balance: '1000000000000000000',
        symbol: 'ETH',
        decimals: 18,
      };

      mockBridgeManager.getAssetBalance.mockResolvedValue(mockBalance);

      const handler = handlers['bridge:get-balance'];
      const result = await handler(null, { address, tokenAddress: null, chainId });

      expect(mockBridgeManager.getAssetBalance).toHaveBeenCalledWith(address, null, chainId);
      expect(result).toEqual(mockBalance);
    });

    it('should get ERC20 token balance', async () => {
      const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
      const tokenAddress = '0xdac17f958d2ee523a2206206994597c13d831ec7';
      const chainId = 1;

      const mockBalance = {
        balance: '5000000000',
        symbol: 'USDT',
        decimals: 6,
      };

      mockBridgeManager.getAssetBalance.mockResolvedValue(mockBalance);

      const handler = handlers['bridge:get-balance'];
      const result = await handler(null, { address, tokenAddress, chainId });

      expect(mockBridgeManager.getAssetBalance).toHaveBeenCalledWith(address, tokenAddress, chainId);
      expect(result).toEqual(mockBalance);
    });

    it('should throw error when bridge manager is not initialized', async () => {
      registerBridgeIPC(null);
      const handler = handlers['bridge:get-balance'];

      await expect(
        handler(null, { address: '0x123...', tokenAddress: null, chainId: 1 })
      ).rejects.toThrow('跨链桥管理器未初始化');
    });

    it('should handle balance query failure', async () => {
      const error = new Error('RPC connection failed');
      mockBridgeManager.getAssetBalance.mockRejectedValue(error);

      const handler = handlers['bridge:get-balance'];
      await expect(
        handler(null, { address: '0x123...', tokenAddress: null, chainId: 1 })
      ).rejects.toThrow('RPC connection failed');
    });
  });

  // ============================================================
  // 批量查询余额测试
  // ============================================================

  describe('bridge:get-batch-balances', () => {
    it('should get batch balances successfully', async () => {
      const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
      const assets = [
        { tokenAddress: null, chainId: 1 }, // ETH
        { tokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7', chainId: 1 }, // USDT
        { tokenAddress: null, chainId: 56 }, // BNB
      ];

      const mockBalances = [
        { balance: '1000000000000000000', symbol: 'ETH', decimals: 18 },
        { balance: '5000000000', symbol: 'USDT', decimals: 6 },
        { balance: '2000000000000000000', symbol: 'BNB', decimals: 18 },
      ];

      mockBridgeManager.getBatchBalances.mockResolvedValue(mockBalances);

      const handler = handlers['bridge:get-batch-balances'];
      const result = await handler(null, { address, assets });

      expect(mockBridgeManager.getBatchBalances).toHaveBeenCalledWith(address, assets);
      expect(result).toEqual(mockBalances);
      expect(result).toHaveLength(3);
    });

    it('should get empty batch balances', async () => {
      const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
      const assets = [];

      mockBridgeManager.getBatchBalances.mockResolvedValue([]);

      const handler = handlers['bridge:get-batch-balances'];
      const result = await handler(null, { address, assets });

      expect(result).toEqual([]);
    });

    it('should throw error when bridge manager is not initialized', async () => {
      registerBridgeIPC(null);
      const handler = handlers['bridge:get-batch-balances'];

      await expect(
        handler(null, { address: '0x123...', assets: [] })
      ).rejects.toThrow('跨链桥管理器未初始化');
    });

    it('should handle batch balance query failure', async () => {
      const error = new Error('One or more RPC calls failed');
      mockBridgeManager.getBatchBalances.mockRejectedValue(error);

      const handler = handlers['bridge:get-batch-balances'];
      await expect(
        handler(null, { address: '0x123...', assets: [] })
      ).rejects.toThrow('One or more RPC calls failed');
    });
  });

  // ============================================================
  // 查询锁定余额测试
  // ============================================================

  describe('bridge:get-locked-balance', () => {
    it('should get locked balance for native token', async () => {
      const tokenAddress = null;
      const chainId = 1;

      const mockLockedBalance = {
        lockedBalance: '500000000000000000',
        symbol: 'ETH',
        decimals: 18,
      };

      mockBridgeManager.getLockedBalance.mockResolvedValue(mockLockedBalance);

      const handler = handlers['bridge:get-locked-balance'];
      const result = await handler(null, { tokenAddress, chainId });

      expect(mockBridgeManager.getLockedBalance).toHaveBeenCalledWith(tokenAddress, chainId);
      expect(result).toEqual(mockLockedBalance);
    });

    it('should get locked balance for ERC20 token', async () => {
      const tokenAddress = '0xdac17f958d2ee523a2206206994597c13d831ec7';
      const chainId = 1;

      const mockLockedBalance = {
        lockedBalance: '10000000000',
        symbol: 'USDT',
        decimals: 6,
      };

      mockBridgeManager.getLockedBalance.mockResolvedValue(mockLockedBalance);

      const handler = handlers['bridge:get-locked-balance'];
      const result = await handler(null, { tokenAddress, chainId });

      expect(mockBridgeManager.getLockedBalance).toHaveBeenCalledWith(tokenAddress, chainId);
      expect(result).toEqual(mockLockedBalance);
    });

    it('should return zero locked balance', async () => {
      const tokenAddress = '0x123...';
      const chainId = 1;

      const mockLockedBalance = {
        lockedBalance: '0',
        symbol: 'TOKEN',
        decimals: 18,
      };

      mockBridgeManager.getLockedBalance.mockResolvedValue(mockLockedBalance);

      const handler = handlers['bridge:get-locked-balance'];
      const result = await handler(null, { tokenAddress, chainId });

      expect(result.lockedBalance).toBe('0');
    });

    it('should throw error when bridge manager is not initialized', async () => {
      registerBridgeIPC(null);
      const handler = handlers['bridge:get-locked-balance'];

      await expect(
        handler(null, { tokenAddress: null, chainId: 1 })
      ).rejects.toThrow('跨链桥管理器未初始化');
    });

    it('should handle locked balance query failure', async () => {
      const error = new Error('Contract call failed');
      mockBridgeManager.getLockedBalance.mockRejectedValue(error);

      const handler = handlers['bridge:get-locked-balance'];
      await expect(
        handler(null, { tokenAddress: null, chainId: 1 })
      ).rejects.toThrow('Contract call failed');
    });
  });

  // ============================================================
  // 注册测试
  // ============================================================

  describe('registerBridgeIPC', () => {
    it('should register all 7 IPC handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledTimes(7);

      const registeredChannels = ipcMain.handle.mock.calls.map(call => call[0]);

      expect(registeredChannels).toContain('bridge:transfer');
      expect(registeredChannels).toContain('bridge:get-history');
      expect(registeredChannels).toContain('bridge:get-record');
      expect(registeredChannels).toContain('bridge:register-contract');
      expect(registeredChannels).toContain('bridge:get-balance');
      expect(registeredChannels).toContain('bridge:get-batch-balances');
      expect(registeredChannels).toContain('bridge:get-locked-balance');
    });

    it('should handle registration with null manager', () => {
      jest.clearAllMocks();

      expect(() => {
        registerBridgeIPC(null);
      }).not.toThrow();

      expect(ipcMain.handle).toHaveBeenCalled();
    });

    it('should verify all handlers are async functions', () => {
      const handlerKeys = Object.keys(handlers);

      handlerKeys.forEach(channel => {
        expect(handlers[channel]).toBeInstanceOf(Function);
      });
    });
  });

  // ============================================================
  // 错误处理和边界情况测试
  // ============================================================

  describe('Error Handling and Edge Cases', () => {
    it('should handle undefined parameters gracefully', async () => {
      const handler = handlers['bridge:get-history'];

      // 不传参数应该使用默认空对象
      mockBridgeManager.getBridgeHistory.mockResolvedValue([]);
      const result = await handler(null);

      expect(mockBridgeManager.getBridgeHistory).toHaveBeenCalledWith({});
      expect(result).toEqual([]);
    });

    it('should handle network timeout errors', async () => {
      const error = new Error('Network timeout');
      error.code = 'ETIMEDOUT';

      mockBridgeManager.bridgeAsset.mockRejectedValue(error);

      const handler = handlers['bridge:transfer'];
      await expect(
        handler(null, { fromChainId: 1, toChainId: 56, amount: '1000' })
      ).rejects.toThrow('Network timeout');
    });

    it('should handle contract revert errors', async () => {
      const error = new Error('Transaction reverted: insufficient allowance');

      mockBridgeManager.bridgeAsset.mockRejectedValue(error);

      const handler = handlers['bridge:transfer'];
      await expect(
        handler(null, { fromChainId: 1, toChainId: 56, amount: '1000' })
      ).rejects.toThrow('Transaction reverted: insufficient allowance');
    });

    it('should handle large amounts correctly', async () => {
      const largeAmount = '999999999999999999999999999999';
      const options = {
        fromChainId: 1,
        toChainId: 56,
        amount: largeAmount,
      };

      mockBridgeManager.bridgeAsset.mockResolvedValue({
        bridgeId: 'bridge-large',
        amount: largeAmount,
      });

      const handler = handlers['bridge:transfer'];
      const result = await handler(null, options);

      expect(result.amount).toBe(largeAmount);
    });
  });
});
