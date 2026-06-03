/**
 * Agent Economy IPC Handlers
 * 10 IPC handlers for Phase 85: Agent Token Economy
 * @module blockchain/economy-ipc
 * @version 5.0.0
 */
const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * Register Agent Economy IPC handlers
 * @param {Object} agentEconomy - AgentEconomy instance
 */
function registerEconomyIPC(agentEconomy) {
  // Price a service
  ipcMain.handle("economy:price-service", async (_event, params) => {
    try {
      if (!agentEconomy) {
        return { success: false, error: "AgentEconomy not available" };
      }
      const result = agentEconomy.priceService(
        params.serviceId,
        params.price,
        params.metadata,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EconomyIPC] price-service error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Make a payment
  ipcMain.handle("economy:pay", async (_event, params) => {
    try {
      if (!agentEconomy) {
        return { success: false, error: "AgentEconomy not available" };
      }
      const result = await agentEconomy.pay(
        params.fromAgent,
        params.toAgent,
        params.amount,
        params.description,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EconomyIPC] pay error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Get balance
  ipcMain.handle("economy:get-balance", async (_event, params) => {
    try {
      if (!agentEconomy) {
        return { success: false, error: "AgentEconomy not available" };
      }
      const result = agentEconomy.getBalance(params.agentId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EconomyIPC] get-balance error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // List resource on market
  ipcMain.handle("economy:list-market", async (_event, params) => {
    try {
      if (!agentEconomy) {
        return { success: false, error: "AgentEconomy not available" };
      }
      if (params.resourceType) {
        // List a new resource
        const result = agentEconomy.listResource(
          params.resourceType,
          params.provider,
          params.price,
          params.available,
          params.unit,
        );
        return { success: true, data: result };
      }
      // Get market listings
      const result = agentEconomy.getMarketListings(params.filter || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EconomyIPC] list-market error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Trade a resource
  ipcMain.handle("economy:trade-resource", async (_event, params) => {
    try {
      if (!agentEconomy) {
        return { success: false, error: "AgentEconomy not available" };
      }
      const result = agentEconomy.tradeResource(
        params.listingId,
        params.buyer,
        params.quantity,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EconomyIPC] trade-resource error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Mint NFT
  ipcMain.handle("economy:mint-nft", async (_event, params) => {
    try {
      if (!agentEconomy) {
        return { success: false, error: "AgentEconomy not available" };
      }
      const result = agentEconomy.mintNFT(
        params.owner,
        params.type,
        params.metadata,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EconomyIPC] mint-nft error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Get contributions
  ipcMain.handle("economy:get-contributions", async (_event, params) => {
    try {
      if (!agentEconomy) {
        return { success: false, error: "AgentEconomy not available" };
      }
      const result = agentEconomy.getContributions(params.agentId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EconomyIPC] get-contributions error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Distribute revenue
  ipcMain.handle("economy:distribute-revenue", async (_event, params) => {
    try {
      if (!agentEconomy) {
        return { success: false, error: "AgentEconomy not available" };
      }
      const result = agentEconomy.distributeRevenue(
        params.pool,
        params.agentIds,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EconomyIPC] distribute-revenue error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Open payment channel
  ipcMain.handle("economy:open-channel", async (_event, params) => {
    try {
      if (!agentEconomy) {
        return { success: false, error: "AgentEconomy not available" };
      }
      const result = agentEconomy.openChannel(
        params.partyA,
        params.partyB,
        params.depositA,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EconomyIPC] open-channel error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Close payment channel
  ipcMain.handle("economy:close-channel", async (_event, params) => {
    try {
      if (!agentEconomy) {
        return { success: false, error: "AgentEconomy not available" };
      }
      const result = agentEconomy.closeChannel(params.channelId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EconomyIPC] close-channel error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[EconomyIPC] Registered 10 handlers");
  return { handlerCount: 10 };
}

module.exports = { registerEconomyIPC };
