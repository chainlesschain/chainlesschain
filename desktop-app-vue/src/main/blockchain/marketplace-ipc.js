/**
 * 交易市场 IPC
 * 处理订单创建、取消、匹配、交易等操作
 */
const { ipcMain } = require('electron');

function registerMarketplaceIPC({ marketplaceManager }) {
  console.log('[Marketplace IPC] Registering Marketplace IPC handlers...');

  // 创建订单
  ipcMain.handle('marketplace:create-order', async (_event, options) => {
    try {
      if (!marketplaceManager) {
        throw new Error('交易市场管理器未初始化');
      }

      return await marketplaceManager.createOrder(options);
    } catch (error) {
      console.error('[Main] 创建订单失败:', error);
      throw error;
    }
  });

  // 取消订单
  ipcMain.handle('marketplace:cancel-order', async (_event, orderId) => {
    try {
      if (!marketplaceManager) {
        throw new Error('交易市场管理器未初始化');
      }

      return await marketplaceManager.cancelOrder(orderId);
    } catch (error) {
      console.error('[Main] 取消订单失败:', error);
      throw error;
    }
  });

  // 获取订单列表
  ipcMain.handle('marketplace:get-orders', async (_event, filters) => {
    try {
      if (!marketplaceManager) {
        return [];
      }

      return await marketplaceManager.getOrders(filters);
    } catch (error) {
      console.error('[Main] 获取订单列表失败:', error);
      throw error;
    }
  });

  // 获取订单详情
  ipcMain.handle('marketplace:get-order', async (_event, orderId) => {
    try {
      if (!marketplaceManager) {
        return null;
      }

      return await marketplaceManager.getOrder(orderId);
    } catch (error) {
      console.error('[Main] 获取订单详情失败:', error);
      throw error;
    }
  });

  // 匹配订单（购买）
  ipcMain.handle('marketplace:match-order', async (_event, orderId, quantity) => {
    try {
      if (!marketplaceManager) {
        throw new Error('交易市场管理器未初始化');
      }

      return await marketplaceManager.matchOrder(orderId, quantity);
    } catch (error) {
      console.error('[Main] 匹配订单失败:', error);
      throw error;
    }
  });

  // 获取交易列表
  ipcMain.handle('marketplace:get-transactions', async (_event, filters) => {
    try {
      if (!marketplaceManager) {
        return [];
      }

      return await marketplaceManager.getTransactions(filters);
    } catch (error) {
      console.error('[Main] 获取交易列表失败:', error);
      throw error;
    }
  });

  // 确认交付
  ipcMain.handle('marketplace:confirm-delivery', async (_event, transactionId) => {
    try {
      if (!marketplaceManager) {
        throw new Error('交易市场管理器未初始化');
      }

      return await marketplaceManager.confirmDelivery(transactionId);
    } catch (error) {
      console.error('[Main] 确认交付失败:', error);
      throw error;
    }
  });

  // 申请退款
  ipcMain.handle('marketplace:request-refund', async (_event, transactionId, reason) => {
    try {
      if (!marketplaceManager) {
        throw new Error('交易市场管理器未初始化');
      }

      return await marketplaceManager.requestRefund(transactionId, reason);
    } catch (error) {
      console.error('[Main] 申请退款失败:', error);
      throw error;
    }
  });

  // 获取我的订单
  ipcMain.handle('marketplace:get-my-orders', async (_event, userDid) => {
    try {
      if (!marketplaceManager) {
        return { createdOrders: [], purchasedOrders: [] };
      }

      return await marketplaceManager.getMyOrders(userDid);
    } catch (error) {
      console.error('[Main] 获取我的订单失败:', error);
      throw error;
    }
  });

  console.log('[Marketplace IPC] ✓ 9 handlers registered');
}

module.exports = { registerMarketplaceIPC };
