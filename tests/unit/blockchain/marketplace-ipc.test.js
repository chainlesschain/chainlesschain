/**
 * Marketplace IPC 单元测试
 * 测试交易市场 IPC 处理器的所有功能
 */

const { ipcMain } = require('electron');
const { registerMarketplaceIPC } = require('../../../desktop-app-vue/src/main/blockchain/marketplace-ipc');

// Mock ipcMain
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
}));

describe('Marketplace IPC Handlers', () => {
  let mockMarketplaceManager;
  let handlers = {};

  beforeEach(() => {
    // 清除所有 mocks
    jest.clearAllMocks();
    handlers = {};

    // 创建 mock 交易市场管理器
    mockMarketplaceManager = {
      createOrder: jest.fn(),
      cancelOrder: jest.fn(),
      getOrders: jest.fn(),
      getOrder: jest.fn(),
      matchOrder: jest.fn(),
      getTransactions: jest.fn(),
      confirmDelivery: jest.fn(),
      requestRefund: jest.fn(),
      getMyOrders: jest.fn(),
    };

    // 捕获所有注册的 handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 IPC handlers
    registerMarketplaceIPC({
      marketplaceManager: mockMarketplaceManager,
    });
  });

  afterEach(() => {
    handlers = {};
  });

  // ============================================================
  // 订单创建和管理测试
  // ============================================================

  describe('marketplace:create-order', () => {
    it('should create order successfully', async () => {
      const orderOptions = {
        assetId: 'asset-123',
        price: '1000000000000000000',
        quantity: 5,
        type: 'sell',
      };

      const mockOrder = {
        id: 'order-1',
        ...orderOptions,
        status: 'active',
        createdAt: new Date().toISOString(),
      };

      mockMarketplaceManager.createOrder.mockResolvedValue(mockOrder);

      const handler = handlers['marketplace:create-order'];
      const result = await handler(null, orderOptions);

      expect(mockMarketplaceManager.createOrder).toHaveBeenCalledWith(orderOptions);
      expect(result).toEqual(mockOrder);
    });

    it('should create buy order successfully', async () => {
      const orderOptions = {
        assetId: 'asset-456',
        price: '500000000000000000',
        quantity: 10,
        type: 'buy',
      };

      const mockOrder = {
        id: 'order-2',
        ...orderOptions,
        status: 'active',
      };

      mockMarketplaceManager.createOrder.mockResolvedValue(mockOrder);

      const handler = handlers['marketplace:create-order'];
      const result = await handler(null, orderOptions);

      expect(mockMarketplaceManager.createOrder).toHaveBeenCalledWith(orderOptions);
      expect(result).toEqual(mockOrder);
    });

    it('should throw error when marketplace manager is not initialized', async () => {
      registerMarketplaceIPC({ marketplaceManager: null });
      const handler = handlers['marketplace:create-order'];

      await expect(handler(null, { assetId: 'asset-123', price: '1000', quantity: 1 }))
        .rejects.toThrow('交易市场管理器未初始化');
    });

    it('should throw error when createOrder fails', async () => {
      const error = new Error('Insufficient balance');
      mockMarketplaceManager.createOrder.mockRejectedValue(error);

      const handler = handlers['marketplace:create-order'];

      await expect(handler(null, { assetId: 'asset-123', price: '1000', quantity: 1 }))
        .rejects.toThrow('Insufficient balance');
    });
  });

  describe('marketplace:cancel-order', () => {
    it('should cancel order successfully', async () => {
      const orderId = 'order-1';
      const mockCancelledOrder = {
        id: orderId,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      };

      mockMarketplaceManager.cancelOrder.mockResolvedValue(mockCancelledOrder);

      const handler = handlers['marketplace:cancel-order'];
      const result = await handler(null, orderId);

      expect(mockMarketplaceManager.cancelOrder).toHaveBeenCalledWith(orderId);
      expect(result).toEqual(mockCancelledOrder);
    });

    it('should throw error when marketplace manager is not initialized', async () => {
      registerMarketplaceIPC({ marketplaceManager: null });
      const handler = handlers['marketplace:cancel-order'];

      await expect(handler(null, 'order-1')).rejects.toThrow('交易市场管理器未初始化');
    });

    it('should throw error when order not found', async () => {
      const error = new Error('Order not found');
      mockMarketplaceManager.cancelOrder.mockRejectedValue(error);

      const handler = handlers['marketplace:cancel-order'];

      await expect(handler(null, 'invalid-order')).rejects.toThrow('Order not found');
    });

    it('should throw error when order already completed', async () => {
      const error = new Error('Cannot cancel completed order');
      mockMarketplaceManager.cancelOrder.mockRejectedValue(error);

      const handler = handlers['marketplace:cancel-order'];

      await expect(handler(null, 'order-1')).rejects.toThrow('Cannot cancel completed order');
    });
  });

  // ============================================================
  // 订单查询测试
  // ============================================================

  describe('marketplace:get-orders', () => {
    it('should get all orders without filters', async () => {
      const mockOrders = [
        { id: 'order-1', assetId: 'asset-123', price: '1000', quantity: 5, type: 'sell', status: 'active' },
        { id: 'order-2', assetId: 'asset-456', price: '500', quantity: 10, type: 'buy', status: 'active' },
      ];

      mockMarketplaceManager.getOrders.mockResolvedValue(mockOrders);

      const handler = handlers['marketplace:get-orders'];
      const result = await handler(null, {});

      expect(mockMarketplaceManager.getOrders).toHaveBeenCalledWith({});
      expect(result).toEqual(mockOrders);
    });

    it('should get orders with filters', async () => {
      const filters = {
        assetId: 'asset-123',
        type: 'sell',
        status: 'active',
      };

      const mockOrders = [
        { id: 'order-1', assetId: 'asset-123', type: 'sell', status: 'active' },
      ];

      mockMarketplaceManager.getOrders.mockResolvedValue(mockOrders);

      const handler = handlers['marketplace:get-orders'];
      const result = await handler(null, filters);

      expect(mockMarketplaceManager.getOrders).toHaveBeenCalledWith(filters);
      expect(result).toEqual(mockOrders);
    });

    it('should return empty array when marketplace manager is not initialized', async () => {
      registerMarketplaceIPC({ marketplaceManager: null });
      const handler = handlers['marketplace:get-orders'];

      const result = await handler(null, {});

      expect(result).toEqual([]);
    });

    it('should handle price range filters', async () => {
      const filters = {
        minPrice: '1000000000000000000',
        maxPrice: '5000000000000000000',
      };

      const mockOrders = [
        { id: 'order-1', price: '2000000000000000000' },
        { id: 'order-2', price: '3000000000000000000' },
      ];

      mockMarketplaceManager.getOrders.mockResolvedValue(mockOrders);

      const handler = handlers['marketplace:get-orders'];
      const result = await handler(null, filters);

      expect(mockMarketplaceManager.getOrders).toHaveBeenCalledWith(filters);
      expect(result).toEqual(mockOrders);
    });

    it('should throw error when getOrders fails', async () => {
      const error = new Error('Database connection failed');
      mockMarketplaceManager.getOrders.mockRejectedValue(error);

      const handler = handlers['marketplace:get-orders'];

      await expect(handler(null, {})).rejects.toThrow('Database connection failed');
    });
  });

  describe('marketplace:get-order', () => {
    it('should get order details successfully', async () => {
      const orderId = 'order-1';
      const mockOrder = {
        id: orderId,
        assetId: 'asset-123',
        price: '1000000000000000000',
        quantity: 5,
        type: 'sell',
        status: 'active',
        createdAt: new Date().toISOString(),
        seller: 'did:example:seller123',
      };

      mockMarketplaceManager.getOrder.mockResolvedValue(mockOrder);

      const handler = handlers['marketplace:get-order'];
      const result = await handler(null, orderId);

      expect(mockMarketplaceManager.getOrder).toHaveBeenCalledWith(orderId);
      expect(result).toEqual(mockOrder);
    });

    it('should return null when marketplace manager is not initialized', async () => {
      registerMarketplaceIPC({ marketplaceManager: null });
      const handler = handlers['marketplace:get-order'];

      const result = await handler(null, 'order-1');

      expect(result).toBeNull();
    });

    it('should return null when order not found', async () => {
      mockMarketplaceManager.getOrder.mockResolvedValue(null);

      const handler = handlers['marketplace:get-order'];
      const result = await handler(null, 'non-existent-order');

      expect(result).toBeNull();
    });

    it('should throw error when getOrder fails', async () => {
      const error = new Error('Database error');
      mockMarketplaceManager.getOrder.mockRejectedValue(error);

      const handler = handlers['marketplace:get-order'];

      await expect(handler(null, 'order-1')).rejects.toThrow('Database error');
    });
  });

  // ============================================================
  // 订单匹配测试
  // ============================================================

  describe('marketplace:match-order', () => {
    it('should match order successfully with full quantity', async () => {
      const orderId = 'order-1';
      const quantity = 5;

      const mockMatchResult = {
        transactionId: 'tx-1',
        orderId,
        quantity,
        price: '1000000000000000000',
        totalAmount: '5000000000000000000',
        status: 'matched',
      };

      mockMarketplaceManager.matchOrder.mockResolvedValue(mockMatchResult);

      const handler = handlers['marketplace:match-order'];
      const result = await handler(null, orderId, quantity);

      expect(mockMarketplaceManager.matchOrder).toHaveBeenCalledWith(orderId, quantity);
      expect(result).toEqual(mockMatchResult);
    });

    it('should match order successfully with partial quantity', async () => {
      const orderId = 'order-2';
      const quantity = 3;

      const mockMatchResult = {
        transactionId: 'tx-2',
        orderId,
        quantity,
        price: '500000000000000000',
        totalAmount: '1500000000000000000',
        status: 'partial',
      };

      mockMarketplaceManager.matchOrder.mockResolvedValue(mockMatchResult);

      const handler = handlers['marketplace:match-order'];
      const result = await handler(null, orderId, quantity);

      expect(mockMarketplaceManager.matchOrder).toHaveBeenCalledWith(orderId, quantity);
      expect(result).toEqual(mockMatchResult);
    });

    it('should throw error when marketplace manager is not initialized', async () => {
      registerMarketplaceIPC({ marketplaceManager: null });
      const handler = handlers['marketplace:match-order'];

      await expect(handler(null, 'order-1', 5)).rejects.toThrow('交易市场管理器未初始化');
    });

    it('should throw error when order not available', async () => {
      const error = new Error('Order is no longer available');
      mockMarketplaceManager.matchOrder.mockRejectedValue(error);

      const handler = handlers['marketplace:match-order'];

      await expect(handler(null, 'order-1', 5)).rejects.toThrow('Order is no longer available');
    });

    it('should throw error when insufficient balance', async () => {
      const error = new Error('Insufficient balance for purchase');
      mockMarketplaceManager.matchOrder.mockRejectedValue(error);

      const handler = handlers['marketplace:match-order'];

      await expect(handler(null, 'order-1', 5)).rejects.toThrow('Insufficient balance for purchase');
    });

    it('should throw error when quantity exceeds available', async () => {
      const error = new Error('Requested quantity exceeds available amount');
      mockMarketplaceManager.matchOrder.mockRejectedValue(error);

      const handler = handlers['marketplace:match-order'];

      await expect(handler(null, 'order-1', 100)).rejects.toThrow('Requested quantity exceeds available amount');
    });
  });

  // ============================================================
  // 交易查询测试
  // ============================================================

  describe('marketplace:get-transactions', () => {
    it('should get all transactions without filters', async () => {
      const mockTransactions = [
        { id: 'tx-1', orderId: 'order-1', status: 'pending', amount: '5000000000000000000' },
        { id: 'tx-2', orderId: 'order-2', status: 'completed', amount: '2000000000000000000' },
      ];

      mockMarketplaceManager.getTransactions.mockResolvedValue(mockTransactions);

      const handler = handlers['marketplace:get-transactions'];
      const result = await handler(null, {});

      expect(mockMarketplaceManager.getTransactions).toHaveBeenCalledWith({});
      expect(result).toEqual(mockTransactions);
    });

    it('should get transactions with filters', async () => {
      const filters = {
        status: 'completed',
        userDid: 'did:example:user123',
      };

      const mockTransactions = [
        { id: 'tx-1', status: 'completed', buyer: 'did:example:user123' },
      ];

      mockMarketplaceManager.getTransactions.mockResolvedValue(mockTransactions);

      const handler = handlers['marketplace:get-transactions'];
      const result = await handler(null, filters);

      expect(mockMarketplaceManager.getTransactions).toHaveBeenCalledWith(filters);
      expect(result).toEqual(mockTransactions);
    });

    it('should return empty array when marketplace manager is not initialized', async () => {
      registerMarketplaceIPC({ marketplaceManager: null });
      const handler = handlers['marketplace:get-transactions'];

      const result = await handler(null, {});

      expect(result).toEqual([]);
    });

    it('should filter by date range', async () => {
      const filters = {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };

      const mockTransactions = [
        { id: 'tx-1', createdAt: '2024-06-15T10:00:00Z' },
      ];

      mockMarketplaceManager.getTransactions.mockResolvedValue(mockTransactions);

      const handler = handlers['marketplace:get-transactions'];
      const result = await handler(null, filters);

      expect(mockMarketplaceManager.getTransactions).toHaveBeenCalledWith(filters);
      expect(result).toEqual(mockTransactions);
    });

    it('should throw error when getTransactions fails', async () => {
      const error = new Error('Query execution failed');
      mockMarketplaceManager.getTransactions.mockRejectedValue(error);

      const handler = handlers['marketplace:get-transactions'];

      await expect(handler(null, {})).rejects.toThrow('Query execution failed');
    });
  });

  // ============================================================
  // 交易操作测试
  // ============================================================

  describe('marketplace:confirm-delivery', () => {
    it('should confirm delivery successfully', async () => {
      const transactionId = 'tx-1';

      const mockConfirmResult = {
        transactionId,
        status: 'completed',
        confirmedAt: new Date().toISOString(),
      };

      mockMarketplaceManager.confirmDelivery.mockResolvedValue(mockConfirmResult);

      const handler = handlers['marketplace:confirm-delivery'];
      const result = await handler(null, transactionId);

      expect(mockMarketplaceManager.confirmDelivery).toHaveBeenCalledWith(transactionId);
      expect(result).toEqual(mockConfirmResult);
    });

    it('should throw error when marketplace manager is not initialized', async () => {
      registerMarketplaceIPC({ marketplaceManager: null });
      const handler = handlers['marketplace:confirm-delivery'];

      await expect(handler(null, 'tx-1')).rejects.toThrow('交易市场管理器未初始化');
    });

    it('should throw error when transaction not found', async () => {
      const error = new Error('Transaction not found');
      mockMarketplaceManager.confirmDelivery.mockRejectedValue(error);

      const handler = handlers['marketplace:confirm-delivery'];

      await expect(handler(null, 'invalid-tx')).rejects.toThrow('Transaction not found');
    });

    it('should throw error when unauthorized', async () => {
      const error = new Error('Only buyer can confirm delivery');
      mockMarketplaceManager.confirmDelivery.mockRejectedValue(error);

      const handler = handlers['marketplace:confirm-delivery'];

      await expect(handler(null, 'tx-1')).rejects.toThrow('Only buyer can confirm delivery');
    });

    it('should throw error when transaction already completed', async () => {
      const error = new Error('Transaction already completed');
      mockMarketplaceManager.confirmDelivery.mockRejectedValue(error);

      const handler = handlers['marketplace:confirm-delivery'];

      await expect(handler(null, 'tx-1')).rejects.toThrow('Transaction already completed');
    });
  });

  describe('marketplace:request-refund', () => {
    it('should request refund successfully', async () => {
      const transactionId = 'tx-1';
      const reason = 'Item not as described';

      const mockRefundResult = {
        transactionId,
        status: 'refund_requested',
        refundReason: reason,
        requestedAt: new Date().toISOString(),
      };

      mockMarketplaceManager.requestRefund.mockResolvedValue(mockRefundResult);

      const handler = handlers['marketplace:request-refund'];
      const result = await handler(null, transactionId, reason);

      expect(mockMarketplaceManager.requestRefund).toHaveBeenCalledWith(transactionId, reason);
      expect(result).toEqual(mockRefundResult);
    });

    it('should request refund with different reason', async () => {
      const transactionId = 'tx-2';
      const reason = 'Did not receive item';

      const mockRefundResult = {
        transactionId,
        status: 'refund_requested',
        refundReason: reason,
      };

      mockMarketplaceManager.requestRefund.mockResolvedValue(mockRefundResult);

      const handler = handlers['marketplace:request-refund'];
      const result = await handler(null, transactionId, reason);

      expect(mockMarketplaceManager.requestRefund).toHaveBeenCalledWith(transactionId, reason);
      expect(result).toEqual(mockRefundResult);
    });

    it('should throw error when marketplace manager is not initialized', async () => {
      registerMarketplaceIPC({ marketplaceManager: null });
      const handler = handlers['marketplace:request-refund'];

      await expect(handler(null, 'tx-1', 'Some reason')).rejects.toThrow('交易市场管理器未初始化');
    });

    it('should throw error when transaction not found', async () => {
      const error = new Error('Transaction not found');
      mockMarketplaceManager.requestRefund.mockRejectedValue(error);

      const handler = handlers['marketplace:request-refund'];

      await expect(handler(null, 'invalid-tx', 'Some reason')).rejects.toThrow('Transaction not found');
    });

    it('should throw error when refund period expired', async () => {
      const error = new Error('Refund period has expired');
      mockMarketplaceManager.requestRefund.mockRejectedValue(error);

      const handler = handlers['marketplace:request-refund'];

      await expect(handler(null, 'tx-1', 'Some reason')).rejects.toThrow('Refund period has expired');
    });

    it('should throw error when unauthorized', async () => {
      const error = new Error('Only buyer can request refund');
      mockMarketplaceManager.requestRefund.mockRejectedValue(error);

      const handler = handlers['marketplace:request-refund'];

      await expect(handler(null, 'tx-1', 'Some reason')).rejects.toThrow('Only buyer can request refund');
    });
  });

  // ============================================================
  // 用户订单查询测试
  // ============================================================

  describe('marketplace:get-my-orders', () => {
    it('should get user orders successfully', async () => {
      const userDid = 'did:example:user123';

      const mockMyOrders = {
        createdOrders: [
          { id: 'order-1', type: 'sell', status: 'active' },
          { id: 'order-2', type: 'sell', status: 'completed' },
        ],
        purchasedOrders: [
          { id: 'order-3', type: 'buy', status: 'completed' },
        ],
      };

      mockMarketplaceManager.getMyOrders.mockResolvedValue(mockMyOrders);

      const handler = handlers['marketplace:get-my-orders'];
      const result = await handler(null, userDid);

      expect(mockMarketplaceManager.getMyOrders).toHaveBeenCalledWith(userDid);
      expect(result).toEqual(mockMyOrders);
    });

    it('should return empty arrays when marketplace manager is not initialized', async () => {
      registerMarketplaceIPC({ marketplaceManager: null });
      const handler = handlers['marketplace:get-my-orders'];

      const result = await handler(null, 'did:example:user123');

      expect(result).toEqual({ createdOrders: [], purchasedOrders: [] });
    });

    it('should return empty arrays when user has no orders', async () => {
      const mockEmptyOrders = {
        createdOrders: [],
        purchasedOrders: [],
      };

      mockMarketplaceManager.getMyOrders.mockResolvedValue(mockEmptyOrders);

      const handler = handlers['marketplace:get-my-orders'];
      const result = await handler(null, 'did:example:newuser');

      expect(result).toEqual(mockEmptyOrders);
    });

    it('should handle only created orders', async () => {
      const mockMyOrders = {
        createdOrders: [
          { id: 'order-1', type: 'sell' },
        ],
        purchasedOrders: [],
      };

      mockMarketplaceManager.getMyOrders.mockResolvedValue(mockMyOrders);

      const handler = handlers['marketplace:get-my-orders'];
      const result = await handler(null, 'did:example:seller');

      expect(result.createdOrders).toHaveLength(1);
      expect(result.purchasedOrders).toHaveLength(0);
    });

    it('should handle only purchased orders', async () => {
      const mockMyOrders = {
        createdOrders: [],
        purchasedOrders: [
          { id: 'order-1', type: 'buy' },
          { id: 'order-2', type: 'buy' },
        ],
      };

      mockMarketplaceManager.getMyOrders.mockResolvedValue(mockMyOrders);

      const handler = handlers['marketplace:get-my-orders'];
      const result = await handler(null, 'did:example:buyer');

      expect(result.createdOrders).toHaveLength(0);
      expect(result.purchasedOrders).toHaveLength(2);
    });

    it('should throw error when getMyOrders fails', async () => {
      const error = new Error('Database query failed');
      mockMarketplaceManager.getMyOrders.mockRejectedValue(error);

      const handler = handlers['marketplace:get-my-orders'];

      await expect(handler(null, 'did:example:user123')).rejects.toThrow('Database query failed');
    });
  });

  // ============================================================
  // 注册测试
  // ============================================================

  describe('registerMarketplaceIPC', () => {
    it('should register all 9 IPC handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledTimes(9);

      const registeredChannels = ipcMain.handle.mock.calls.map(call => call[0]);

      expect(registeredChannels).toContain('marketplace:create-order');
      expect(registeredChannels).toContain('marketplace:cancel-order');
      expect(registeredChannels).toContain('marketplace:get-orders');
      expect(registeredChannels).toContain('marketplace:get-order');
      expect(registeredChannels).toContain('marketplace:match-order');
      expect(registeredChannels).toContain('marketplace:get-transactions');
      expect(registeredChannels).toContain('marketplace:confirm-delivery');
      expect(registeredChannels).toContain('marketplace:request-refund');
      expect(registeredChannels).toContain('marketplace:get-my-orders');
    });

    it('should handle registration with null manager', () => {
      jest.clearAllMocks();

      expect(() => {
        registerMarketplaceIPC({ marketplaceManager: null });
      }).not.toThrow();

      expect(ipcMain.handle).toHaveBeenCalled();
    });

    it('should log registration messages', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      registerMarketplaceIPC({ marketplaceManager: mockMarketplaceManager });

      expect(consoleSpy).toHaveBeenCalledWith('[Marketplace IPC] Registering Marketplace IPC handlers...');
      expect(consoleSpy).toHaveBeenCalledWith('[Marketplace IPC] ✓ 9 handlers registered');

      consoleSpy.mockRestore();
    });
  });

  // ============================================================
  // 错误处理测试
  // ============================================================

  describe('Error Handling', () => {
    it('should log error when createOrder fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Create order failed');
      mockMarketplaceManager.createOrder.mockRejectedValue(error);

      const handler = handlers['marketplace:create-order'];

      await expect(handler(null, { assetId: 'asset-123' })).rejects.toThrow('Create order failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Main] 创建订单失败:', error);

      consoleErrorSpy.mockRestore();
    });

    it('should log error when cancelOrder fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Cancel order failed');
      mockMarketplaceManager.cancelOrder.mockRejectedValue(error);

      const handler = handlers['marketplace:cancel-order'];

      await expect(handler(null, 'order-1')).rejects.toThrow('Cancel order failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Main] 取消订单失败:', error);

      consoleErrorSpy.mockRestore();
    });

    it('should log error when matchOrder fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Match order failed');
      mockMarketplaceManager.matchOrder.mockRejectedValue(error);

      const handler = handlers['marketplace:match-order'];

      await expect(handler(null, 'order-1', 5)).rejects.toThrow('Match order failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Main] 匹配订单失败:', error);

      consoleErrorSpy.mockRestore();
    });

    it('should log error when confirmDelivery fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Confirm delivery failed');
      mockMarketplaceManager.confirmDelivery.mockRejectedValue(error);

      const handler = handlers['marketplace:confirm-delivery'];

      await expect(handler(null, 'tx-1')).rejects.toThrow('Confirm delivery failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Main] 确认交付失败:', error);

      consoleErrorSpy.mockRestore();
    });

    it('should log error when requestRefund fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Request refund failed');
      mockMarketplaceManager.requestRefund.mockRejectedValue(error);

      const handler = handlers['marketplace:request-refund'];

      await expect(handler(null, 'tx-1', 'reason')).rejects.toThrow('Request refund failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Main] 申请退款失败:', error);

      consoleErrorSpy.mockRestore();
    });
  });
});
