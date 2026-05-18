/**
 * Trading Enhancement IPC Handlers - 交易增强IPC处理器
 *
 * 提供28个IPC处理器: 拍卖(8) + 团购(7) + 分期(7) + 闪电(6)
 *
 * @module trade/trading-enhancement-ipc
 * @version 1.0.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

function registerTradingEnhancementIPC({
  auctionManager,
  groupBuyingManager,
  installmentManager,
  lightningPaymentManager,
}) {
  // ============================================================
  // 拍卖 IPC (8 handlers)
  // ============================================================

  ipcMain.handle("trade:auction:create", async (event, params) => {
    if (!auctionManager) {throw new Error("AuctionManager not initialized");}
    return await auctionManager.createAuction(params);
  });

  ipcMain.handle(
    "trade:auction:bid",
    async (event, { auctionId, bidderId, amount }) => {
      if (!auctionManager) {throw new Error("AuctionManager not initialized");}
      return await auctionManager.placeBid(auctionId, bidderId, amount);
    },
  );

  ipcMain.handle("trade:auction:get", async (event, { auctionId }) => {
    if (!auctionManager) {return null;}
    return auctionManager.getAuction(auctionId);
  });

  ipcMain.handle("trade:auction:list", async (event, filters) => {
    if (!auctionManager) {return { auctions: [], total: 0 };}
    return await auctionManager.listAuctions(filters);
  });

  ipcMain.handle(
    "trade:auction:cancel",
    async (event, { auctionId, userId }) => {
      if (!auctionManager) {throw new Error("AuctionManager not initialized");}
      return await auctionManager.cancelAuction(auctionId, userId);
    },
  );

  ipcMain.handle("trade:auction:finalize", async (event, { auctionId }) => {
    if (!auctionManager) {throw new Error("AuctionManager not initialized");}
    return await auctionManager.finalizeAuction(auctionId);
  });

  ipcMain.handle(
    "trade:auction:buy-now",
    async (event, { auctionId, buyerId }) => {
      if (!auctionManager) {throw new Error("AuctionManager not initialized");}
      return await auctionManager.processBuyNow(auctionId, buyerId);
    },
  );

  ipcMain.handle(
    "trade:auction:my-bids",
    async (event, { userId, options }) => {
      if (!auctionManager) {return { bids: [], total: 0 };}
      return await auctionManager.getMyBids(userId, options);
    },
  );

  // ============================================================
  // 团购 IPC (7 handlers)
  // ============================================================

  ipcMain.handle("trade:group-buy:create", async (event, params) => {
    if (!groupBuyingManager)
      {throw new Error("GroupBuyingManager not initialized");}
    return await groupBuyingManager.createGroupBuy(params);
  });

  ipcMain.handle(
    "trade:group-buy:join",
    async (event, { groupId, userId, quantity }) => {
      if (!groupBuyingManager)
        {throw new Error("GroupBuyingManager not initialized");}
      return await groupBuyingManager.joinGroupBuy(groupId, userId, quantity);
    },
  );

  ipcMain.handle(
    "trade:group-buy:leave",
    async (event, { groupId, userId }) => {
      if (!groupBuyingManager)
        {throw new Error("GroupBuyingManager not initialized");}
      return await groupBuyingManager.leaveGroupBuy(groupId, userId);
    },
  );

  ipcMain.handle("trade:group-buy:get", async (event, { groupId }) => {
    if (!groupBuyingManager) {return null;}
    return groupBuyingManager.getGroupBuy(groupId);
  });

  ipcMain.handle("trade:group-buy:list", async (event, filters) => {
    if (!groupBuyingManager) {return { groupBuys: [], total: 0 };}
    return await groupBuyingManager.listGroupBuys(filters);
  });

  ipcMain.handle("trade:group-buy:finalize", async (event, { groupId }) => {
    if (!groupBuyingManager)
      {throw new Error("GroupBuyingManager not initialized");}
    return await groupBuyingManager.finalizeGroupBuy(groupId);
  });

  ipcMain.handle(
    "trade:group-buy:cancel",
    async (event, { groupId, userId }) => {
      if (!groupBuyingManager)
        {throw new Error("GroupBuyingManager not initialized");}
      return await groupBuyingManager.cancelGroupBuy(groupId, userId);
    },
  );

  // ============================================================
  // 分期付款 IPC (7 handlers)
  // ============================================================

  ipcMain.handle("trade:installment:create", async (event, params) => {
    if (!installmentManager)
      {throw new Error("InstallmentManager not initialized");}
    return await installmentManager.createPlan(params);
  });

  ipcMain.handle("trade:installment:approve", async (event, { planId }) => {
    if (!installmentManager)
      {throw new Error("InstallmentManager not initialized");}
    return await installmentManager.approvePlan(planId);
  });

  ipcMain.handle(
    "trade:installment:pay",
    async (event, { planId, amount }) => {
      if (!installmentManager)
        {throw new Error("InstallmentManager not initialized");}
      return await installmentManager.makePayment(planId, amount);
    },
  );

  ipcMain.handle("trade:installment:get", async (event, { planId }) => {
    if (!installmentManager) {return null;}
    return installmentManager.getPlan(planId);
  });

  ipcMain.handle(
    "trade:installment:list",
    async (event, { userId, filters }) => {
      if (!installmentManager) {return { plans: [], total: 0 };}
      return await installmentManager.listPlans(userId, filters);
    },
  );

  ipcMain.handle("trade:installment:check-overdue", async () => {
    if (!installmentManager) {return { checked: 0, overdue: 0 };}
    return await installmentManager.checkOverdue();
  });

  ipcMain.handle(
    "trade:installment:get-schedule",
    async (event, { planId }) => {
      if (!installmentManager) {return null;}
      return installmentManager.getSchedule(planId);
    },
  );

  // ============================================================
  // 闪电网络 IPC (6 handlers)
  // ============================================================

  ipcMain.handle("trade:lightning:create-channel", async (event, params) => {
    if (!lightningPaymentManager)
      {throw new Error("LightningPaymentManager not initialized");}
    return await lightningPaymentManager.createChannel(params);
  });

  ipcMain.handle(
    "trade:lightning:close-channel",
    async (event, { channelId }) => {
      if (!lightningPaymentManager)
        {throw new Error("LightningPaymentManager not initialized");}
      return await lightningPaymentManager.closeChannel(channelId);
    },
  );

  ipcMain.handle("trade:lightning:send", async (event, params) => {
    if (!lightningPaymentManager)
      {throw new Error("LightningPaymentManager not initialized");}
    return await lightningPaymentManager.sendPayment(params);
  });

  ipcMain.handle("trade:lightning:create-invoice", async (event, params) => {
    if (!lightningPaymentManager)
      {throw new Error("LightningPaymentManager not initialized");}
    return await lightningPaymentManager.createInvoice(params);
  });

  ipcMain.handle(
    "trade:lightning:pay-invoice",
    async (event, { invoiceId, payerId, channelId }) => {
      if (!lightningPaymentManager)
        {throw new Error("LightningPaymentManager not initialized");}
      return await lightningPaymentManager.payInvoice(
        invoiceId,
        payerId,
        channelId,
      );
    },
  );

  ipcMain.handle(
    "trade:lightning:list-channels",
    async (event, { userId, options }) => {
      if (!lightningPaymentManager) {return { channels: [], total: 0 };}
      return await lightningPaymentManager.listChannels(userId, options);
    },
  );

  logger.info("[TradingEnhancementIPC] 28个交易增强IPC处理器注册成功");
  logger.info("[TradingEnhancementIPC]   - 拍卖: 8 handlers");
  logger.info("[TradingEnhancementIPC]   - 团购: 7 handlers");
  logger.info("[TradingEnhancementIPC]   - 分期: 7 handlers");
  logger.info("[TradingEnhancementIPC]   - 闪电: 6 handlers");
}

module.exports = { registerTradingEnhancementIPC };
