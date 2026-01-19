/**
 * 交易市场 IPC
 * 处理订单创建、取消、匹配、交易等操作
 */
const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain, clipboard, dialog, shell } = require("electron");
const crypto = require("crypto");
const path = require("path");
const {
  exportOrderToPDF,
  exportOrderToImage,
  ShareLinkManager,
} = require("./order-export");

// 分享链接管理器实例
let shareLinkManager = null;

function registerMarketplaceIPC({ marketplaceManager, database }) {
  // 初始化分享链接管理器
  if (database && !shareLinkManager) {
    shareLinkManager = new ShareLinkManager(database);
  }
  logger.info("[Marketplace IPC] Registering Marketplace IPC handlers...");

  // 创建订单
  ipcMain.handle("marketplace:create-order", async (_event, options) => {
    try {
      if (!marketplaceManager) {
        throw new Error("交易市场管理器未初始化");
      }

      return await marketplaceManager.createOrder(options);
    } catch (error) {
      logger.error("[Main] 创建订单失败:", error);
      throw error;
    }
  });

  // 取消订单
  ipcMain.handle("marketplace:cancel-order", async (_event, orderId) => {
    try {
      if (!marketplaceManager) {
        throw new Error("交易市场管理器未初始化");
      }

      return await marketplaceManager.cancelOrder(orderId);
    } catch (error) {
      logger.error("[Main] 取消订单失败:", error);
      throw error;
    }
  });

  // 获取订单列表（支持分页和高级筛选）
  ipcMain.handle("marketplace:get-orders", async (_event, filters) => {
    try {
      if (!marketplaceManager) {
        return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
      }

      return await marketplaceManager.getOrders(filters);
    } catch (error) {
      logger.error("[Main] 获取订单列表失败:", error);
      throw error;
    }
  });

  // 高级搜索订单（分页+筛选+排序）
  ipcMain.handle("marketplace:search-orders", async (_event, options) => {
    try {
      if (!marketplaceManager) {
        return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
      }

      const {
        keyword,
        type,
        status = "open",
        priceMin,
        priceMax,
        createdAfter,
        createdBefore,
        sortBy,
        sortOrder,
        page,
        pageSize,
      } = options || {};

      return await marketplaceManager.getOrders({
        search: keyword,
        type,
        status,
        priceMin,
        priceMax,
        createdAfter,
        createdBefore,
        sortBy,
        sortOrder,
        page,
        pageSize,
      });
    } catch (error) {
      logger.error("[Main] 搜索订单失败:", error);
      throw error;
    }
  });

  // 获取搜索建议（自动补全）
  ipcMain.handle(
    "marketplace:get-search-suggestions",
    async (_event, prefix, limit = 10) => {
      try {
        if (!marketplaceManager) {
          return [];
        }

        return await marketplaceManager.getSearchSuggestions(prefix, limit);
      } catch (error) {
        logger.error("[Main] 获取搜索建议失败:", error);
        return [];
      }
    },
  );

  // 获取订单详情
  ipcMain.handle("marketplace:get-order", async (_event, orderId) => {
    try {
      if (!marketplaceManager) {
        return null;
      }

      return await marketplaceManager.getOrder(orderId);
    } catch (error) {
      logger.error("[Main] 获取订单详情失败:", error);
      throw error;
    }
  });

  // 匹配订单（购买）
  ipcMain.handle(
    "marketplace:match-order",
    async (_event, orderId, quantity) => {
      try {
        if (!marketplaceManager) {
          throw new Error("交易市场管理器未初始化");
        }

        return await marketplaceManager.matchOrder(orderId, quantity);
      } catch (error) {
        logger.error("[Main] 匹配订单失败:", error);
        throw error;
      }
    },
  );

  // 获取交易列表
  ipcMain.handle("marketplace:get-transactions", async (_event, filters) => {
    try {
      if (!marketplaceManager) {
        return [];
      }

      return await marketplaceManager.getTransactions(filters);
    } catch (error) {
      logger.error("[Main] 获取交易列表失败:", error);
      throw error;
    }
  });

  // 确认交付
  ipcMain.handle(
    "marketplace:confirm-delivery",
    async (_event, transactionId) => {
      try {
        if (!marketplaceManager) {
          throw new Error("交易市场管理器未初始化");
        }

        return await marketplaceManager.confirmDelivery(transactionId);
      } catch (error) {
        logger.error("[Main] 确认交付失败:", error);
        throw error;
      }
    },
  );

  // 申请退款
  ipcMain.handle(
    "marketplace:request-refund",
    async (_event, transactionId, reason) => {
      try {
        if (!marketplaceManager) {
          throw new Error("交易市场管理器未初始化");
        }

        return await marketplaceManager.requestRefund(transactionId, reason);
      } catch (error) {
        logger.error("[Main] 申请退款失败:", error);
        throw error;
      }
    },
  );

  // 获取我的订单
  ipcMain.handle("marketplace:get-my-orders", async (_event, userDid) => {
    try {
      if (!marketplaceManager) {
        return { createdOrders: [], purchasedOrders: [] };
      }

      return await marketplaceManager.getMyOrders(userDid);
    } catch (error) {
      logger.error("[Main] 获取我的订单失败:", error);
      throw error;
    }
  });

  // 更新订单
  ipcMain.handle("trade:update-order", async (_event, updateData) => {
    try {
      if (!marketplaceManager) {
        throw new Error("交易市场管理器未初始化");
      }

      const { orderId, ...updates } = updateData;

      // 获取原订单
      const order = await marketplaceManager.getOrder(orderId);
      if (!order) {
        return { success: false, error: "订单不存在" };
      }

      // 只允许更新开放状态的订单
      if (order.status !== "open") {
        return { success: false, error: "只能编辑开放状态的订单" };
      }

      // 更新订单
      const updatedOrder = await marketplaceManager.updateOrder(
        orderId,
        updates,
      );

      return { success: true, order: updatedOrder };
    } catch (error) {
      logger.error("[Main] 更新订单失败:", error);
      return { success: false, error: error.message };
    }
  });

  // 生成分享链接
  ipcMain.handle("trade:generate-share-link", async (_event, options) => {
    try {
      const { orderId, expiry, permission } = options;

      // 生成唯一的分享令牌
      const token = crypto.randomBytes(16).toString("hex");

      // 计算过期时间
      let expiryTimestamp = null;
      if (expiry !== "never") {
        const now = Date.now();
        const expiryMap = {
          "1h": 60 * 60 * 1000,
          "24h": 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000,
          "30d": 30 * 24 * 60 * 60 * 1000,
        };
        expiryTimestamp = now + (expiryMap[expiry] || expiryMap["7d"]);
      }

      // 持久化存储分享链接
      if (shareLinkManager) {
        const saveResult = await shareLinkManager.saveLink({
          orderId,
          token,
          permission,
          expiresAt: expiryTimestamp,
        });
        if (!saveResult.success) {
          logger.warn("[Main] 分享链接持久化失败:", saveResult.error);
        }
      }

      // 生成链接
      const baseUrl = "chainlesschain://order/";
      const link = `${baseUrl}${orderId}?token=${token}&permission=${permission}`;

      return { success: true, link, token, expiry: expiryTimestamp };
    } catch (error) {
      logger.error("[Main] 生成分享链接失败:", error);
      return { success: false, error: error.message };
    }
  });

  // 验证分享链接
  ipcMain.handle("trade:validate-share-link", async (_event, token) => {
    try {
      if (!shareLinkManager) {
        return { valid: false, error: "分享链接管理器未初始化" };
      }
      return await shareLinkManager.validateLink(token);
    } catch (error) {
      logger.error("[Main] 验证分享链接失败:", error);
      return { valid: false, error: error.message };
    }
  });

  // 撤销分享链接
  ipcMain.handle("trade:revoke-share-link", async (_event, orderId, token) => {
    try {
      if (!shareLinkManager) {
        return { success: false, error: "分享链接管理器未初始化" };
      }
      return await shareLinkManager.revokeLink(orderId, token);
    } catch (error) {
      logger.error("[Main] 撤销分享链接失败:", error);
      return { success: false, error: error.message };
    }
  });

  // 获取订单的分享链接列表
  ipcMain.handle("trade:get-share-links", async (_event, orderId) => {
    try {
      if (!shareLinkManager) {
        return [];
      }
      return await shareLinkManager.getLinksForOrder(orderId);
    } catch (error) {
      logger.error("[Main] 获取分享链接列表失败:", error);
      return [];
    }
  });

  // 复制订单链接
  ipcMain.handle("trade:copy-order-link", async (_event, link) => {
    try {
      clipboard.writeText(link);
      return { success: true };
    } catch (error) {
      logger.error("[Main] 复制链接失败:", error);
      return { success: false, error: error.message };
    }
  });

  // 导出订单为 PDF
  ipcMain.handle("trade:export-order-pdf", async (event, options) => {
    try {
      const { orderId, saveAs = true } = options;

      // 获取订单数据
      if (!marketplaceManager) {
        return { success: false, error: "交易市场管理器未初始化" };
      }

      const order = await marketplaceManager.getOrder(orderId);
      if (!order) {
        return { success: false, error: "订单不存在" };
      }

      // 如果需要选择保存路径
      let outputPath = options.outputPath;
      if (saveAs && !outputPath) {
        const { BrowserWindow } = require("electron");
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showSaveDialog(win, {
          title: "保存订单 PDF",
          defaultPath: `订单-${orderId}.pdf`,
          filters: [{ name: "PDF 文件", extensions: ["pdf"] }],
        });

        if (result.canceled) {
          return { success: false, error: "用户取消保存" };
        }
        outputPath = result.filePath;
      }

      // 导出 PDF
      const exportResult = await exportOrderToPDF(order, { outputPath });

      if (exportResult.success && options.openAfterExport) {
        shell.openPath(exportResult.filePath);
      }

      return exportResult;
    } catch (error) {
      logger.error("[Main] 导出 PDF 失败:", error);
      return { success: false, error: error.message };
    }
  });

  // 导出订单为图片
  ipcMain.handle("trade:export-order-image", async (event, options) => {
    try {
      const { orderId, format = "png", saveAs = true } = options;

      // 获取订单数据
      if (!marketplaceManager) {
        return { success: false, error: "交易市场管理器未初始化" };
      }

      const order = await marketplaceManager.getOrder(orderId);
      if (!order) {
        return { success: false, error: "订单不存在" };
      }

      // 如果需要选择保存路径
      let outputPath = options.outputPath;
      if (saveAs && !outputPath) {
        const { BrowserWindow } = require("electron");
        const win = BrowserWindow.fromWebContents(event.sender);

        const formatFilters = {
          png: { name: "PNG 图片", extensions: ["png"] },
          jpg: { name: "JPEG 图片", extensions: ["jpg", "jpeg"] },
          webp: { name: "WebP 图片", extensions: ["webp"] },
        };

        const result = await dialog.showSaveDialog(win, {
          title: "保存订单图片",
          defaultPath: `订单-${orderId}.${format}`,
          filters: [formatFilters[format] || formatFilters.png],
        });

        if (result.canceled) {
          return { success: false, error: "用户取消保存" };
        }
        outputPath = result.filePath;
      }

      // 导出图片
      const exportResult = await exportOrderToImage(order, {
        outputPath,
        format,
        quality: options.quality || 90,
        width: options.width,
        height: options.height,
        scale: options.scale || 2,
      });

      if (exportResult.success && options.openAfterExport) {
        shell.openPath(exportResult.filePath);
      }

      return exportResult;
    } catch (error) {
      logger.error("[Main] 导出图片失败:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[Marketplace IPC] ✓ 20 handlers registered");
}

module.exports = { registerMarketplaceIPC };
