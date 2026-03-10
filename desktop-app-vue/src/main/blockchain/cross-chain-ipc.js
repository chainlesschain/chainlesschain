/**
 * @module blockchain/cross-chain-ipc
 * Phase 89: Cross-Chain Bridge IPC handlers
 */
const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

function registerCrossChainIPC(deps) {
  const { crossChainBridge } = deps;

  ipcMain.handle("crosschain:bridge-asset", async (event, args) => {
    try {
      if (!crossChainBridge) {
        return { success: false, error: "Cross-chain bridge not available" };
      }
      const { fromChain, toChain, asset, amount, options } = args;
      const result = await crossChainBridge.bridgeAsset(
        fromChain,
        toChain,
        asset,
        amount,
        options,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CrossChainIPC] bridge-asset error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("crosschain:atomic-swap", async (event, args) => {
    try {
      if (!crossChainBridge) {
        return { success: false, error: "Cross-chain bridge not available" };
      }
      const { partyA, partyB, assetA, assetB, amountA, amountB } = args;
      const result = await crossChainBridge.atomicSwap(
        partyA,
        partyB,
        assetA,
        assetB,
        amountA,
        amountB,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CrossChainIPC] atomic-swap error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("crosschain:send-message", async (event, args) => {
    try {
      if (!crossChainBridge) {
        return { success: false, error: "Cross-chain bridge not available" };
      }
      const { fromChain, toChain, payload } = args;
      const result = await crossChainBridge.sendMessage(
        fromChain,
        toChain,
        payload,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CrossChainIPC] send-message error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("crosschain:get-balances", async (event, args) => {
    try {
      if (!crossChainBridge) {
        return { success: false, error: "Cross-chain bridge not available" };
      }
      const { address } = args;
      const result = crossChainBridge.getBalances(address);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CrossChainIPC] get-balances error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("crosschain:list-chains", async () => {
    try {
      if (!crossChainBridge) {
        return { success: false, error: "Cross-chain bridge not available" };
      }
      const result = crossChainBridge.listChains();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CrossChainIPC] list-chains error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("crosschain:estimate-fee", async (event, args) => {
    try {
      if (!crossChainBridge) {
        return { success: false, error: "Cross-chain bridge not available" };
      }
      const { fromChain, toChain, amount } = args;
      const result = crossChainBridge.estimateFee(fromChain, toChain, amount);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CrossChainIPC] estimate-fee error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("crosschain:get-tx-status", async (event, args) => {
    try {
      if (!crossChainBridge) {
        return { success: false, error: "Cross-chain bridge not available" };
      }
      const { transferId } = args;
      const result = crossChainBridge.getTransferStatus(transferId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CrossChainIPC] get-tx-status error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("crosschain:configure-chain", async (event, args) => {
    try {
      if (!crossChainBridge) {
        return { success: false, error: "Cross-chain bridge not available" };
      }
      const { chainId, config } = args;
      const result = crossChainBridge.configureChain(chainId, config);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CrossChainIPC] configure-chain error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[CrossChainIPC] Registered 8 handlers");
}

module.exports = { registerCrossChainIPC };
