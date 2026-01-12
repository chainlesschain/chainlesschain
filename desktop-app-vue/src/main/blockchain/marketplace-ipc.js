/**
 * 交易市场 IPC
 * 处理订单创建、取消、匹配、交易等操作
 */
const { ipcMain, clipboard } = require('electron');
const crypto = require('crypto');

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

  // 更新订单
  ipcMain.handle('trade:update-order', async (_event, updateData) => {
    try {
      if (!marketplaceManager) {
        throw new Error('交易市场管理器未初始化');
      }

      const { orderId, ...updates } = updateData;

      // 获取原订单
      const order = await marketplaceManager.getOrder(orderId);
      if (!order) {
        return { success: false, error: '订单不存在' };
      }

      // 只允许更新开放状态的订单
      if (order.status !== 'open') {
        return { success: false, error: '只能编辑开放状态的订单' };
      }

      // 更新订单
      const updatedOrder = await marketplaceManager.updateOrder(orderId, updates);

      return { success: true, order: updatedOrder };
    } catch (error) {
      console.error('[Main] 更新订单失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 生成分享链接
  ipcMain.handle('trade:generate-share-link', async (_event, options) => {
    try {
      const { orderId, expiry, permission } = options;

      // 生成唯一的分享令牌
      const token = crypto.randomBytes(16).toString('hex');

      // 计算过期时间
      let expiryTimestamp = null;
      if (expiry !== 'never') {
        const now = Date.now();
        const expiryMap = {
          '1h': 60 * 60 * 1000,
          '24h': 24 * 60 * 60 * 1000,
          '7d': 7 * 24 * 60 * 60 * 1000,
          '30d': 30 * 24 * 60 * 60 * 1000,
        };
        expiryTimestamp = now + (expiryMap[expiry] || expiryMap['7d']);
      }

      // 存储分享链接信息（可以存储到数据库）
      // TODO: 实现分享链接的持久化存储

      // 生成链接
      const baseUrl = 'chainlesschain://order/';
      const link = `${baseUrl}${orderId}?token=${token}&permission=${permission}`;

      return { success: true, link, token, expiry: expiryTimestamp };
    } catch (error) {
      console.error('[Main] 生成分享链接失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 复制订单链接
  ipcMain.handle('trade:copy-order-link', async (_event, link) => {
    try {
      clipboard.writeText(link);
      return { success: true };
    } catch (error) {
      console.error('[Main] 复制链接失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 导出订单为 PDF
  ipcMain.handle('trade:export-order-pdf', async (_event, options) => {
    try {
      // TODO: 实现 PDF 导出功能
      // 可以使用 puppeteer 或 pdfkit 库
      console.log('[Main] PDF 导出功能待实现');
      return { success: false, error: 'PDF导出功能待实现' };
    } catch (error) {
      console.error('[Main] 导出 PDF 失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 导出订单为图片
  ipcMain.handle('trade:export-order-image', async (_event, options) => {
    try {
      // TODO: 实现图片导出功能
      // 可以使用 canvas 或 sharp 库
      console.log('[Main] 图片导出功能待实现');
      return { success: false, error: '图片导出功能待实现' };
    } catch (error) {
      console.error('[Main] 导出图片失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Marketplace IPC] ✓ 14 handlers registered');
}

module.exports = { registerMarketplaceIPC };
