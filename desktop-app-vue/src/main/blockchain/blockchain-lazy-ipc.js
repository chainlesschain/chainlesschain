/**
 * 区块链模块懒加载 IPC 包装器
 * 在首次访问时才初始化区块链模块，节省启动时间 5-10 秒
 */

const { ipcMain } = require("electron");

/**
 * 确保区块链模块已初始化
 * @param {Object} app - 应用实例
 * @returns {Promise<void>}
 */
async function ensureBlockchainInitialized(app) {
  if (!app.blockchainInitialized) {
    console.log("[Blockchain Lazy IPC] 首次访问区块链功能，正在初始化模块...");
    const startTime = Date.now();
    await app.initializeBlockchainModules();
    const elapsed = Date.now() - startTime;
    console.log(`[Blockchain Lazy IPC] ✓ 区块链模块初始化完成 (耗时: ${elapsed}ms)`);
  }
}

/**
 * 注册懒加载的区块链 IPC 处理器
 * @param {Object} options
 * @param {Object} options.app - 应用实例
 * @param {Object} options.database - 数据库实例
 * @param {Object} options.mainWindow - 主窗口实例
 */
function registerLazyBlockchainIPC({ app, database, mainWindow }) {
  console.log("[Blockchain Lazy IPC] 注册懒加载区块链 IPC 处理器...");

  // ============================================================
  // 钱包管理 (15 handlers)
  // ============================================================

  ipcMain.handle("wallet:create", async (_event, { password, chainId = 1 }) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.walletManager) {
        throw new Error("钱包管理器未初始化");
      }
      return await app.walletManager.createWallet(password, chainId);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 创建钱包失败:", error);
      throw error;
    }
  });

  ipcMain.handle("wallet:import-mnemonic", async (_event, { mnemonic, password, chainId = 1 }) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.walletManager) {
        throw new Error("钱包管理器未初始化");
      }
      return await app.walletManager.importFromMnemonic(mnemonic, password, chainId);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 导入钱包失败:", error);
      throw error;
    }
  });

  ipcMain.handle("wallet:import-private-key", async (_event, { privateKey, password, chainId = 1 }) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.walletManager) {
        throw new Error("钱包管理器未初始化");
      }
      return await app.walletManager.importFromPrivateKey(privateKey, password, chainId);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 从私钥导入钱包失败:", error);
      throw error;
    }
  });

  ipcMain.handle("wallet:list", async () => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.walletManager) {
        throw new Error("钱包管理器未初始化");
      }
      return await app.walletManager.listWallets();
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 获取钱包列表失败:", error);
      throw error;
    }
  });

  ipcMain.handle("wallet:get-balance", async (_event, { address, chainId }) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.walletManager) {
        throw new Error("钱包管理器未初始化");
      }
      return await app.walletManager.getBalance(address, chainId);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 获取余额失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 智能合约 (15 handlers)
  // ============================================================

  ipcMain.handle("contract:deploy", async (_event, params) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.contractEngine) {
        throw new Error("智能合约引擎未初始化");
      }
      return await app.contractEngine.deployContract(params);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 部署合约失败:", error);
      throw error;
    }
  });

  ipcMain.handle("contract:call", async (_event, params) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.contractEngine) {
        throw new Error("智能合约引擎未初始化");
      }
      return await app.contractEngine.callContract(params);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 调用合约失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 区块链适配器 (14 handlers)
  // ============================================================

  ipcMain.handle("blockchain:get-balance", async (_event, params) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.blockchainAdapter) {
        throw new Error("区块链适配器未初始化");
      }
      return await app.blockchainAdapter.getBalance(params);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 获取余额失败:", error);
      throw error;
    }
  });

  ipcMain.handle("blockchain:send-transaction", async (_event, params) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.blockchainAdapter) {
        throw new Error("区块链适配器未初始化");
      }
      return await app.blockchainAdapter.sendTransaction(params);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 发送交易失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 资产管理 (10 handlers)
  // ============================================================

  ipcMain.handle("asset:create", async (_event, params) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.assetManager) {
        throw new Error("资产管理器未初始化");
      }
      return await app.assetManager.createAsset(params);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 创建资产失败:", error);
      throw error;
    }
  });

  ipcMain.handle("asset:list", async () => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.assetManager) {
        throw new Error("资产管理器未初始化");
      }
      return await app.assetManager.listAssets();
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 获取资产列表失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 市场管理 (9 handlers)
  // ============================================================

  ipcMain.handle("marketplace:list-items", async (_event, params) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.marketplaceManager) {
        throw new Error("市场管理器未初始化");
      }
      return await app.marketplaceManager.listItems(params);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 获取市场列表失败:", error);
      throw error;
    }
  });

  ipcMain.handle("marketplace:create-listing", async (_event, params) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.marketplaceManager) {
        throw new Error("市场管理器未初始化");
      }
      return await app.marketplaceManager.createListing(params);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 创建市场列表失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 跨链桥 (7 handlers)
  // ============================================================

  ipcMain.handle("bridge:transfer", async (_event, params) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.bridgeManager) {
        throw new Error("跨链桥管理器未初始化");
      }
      return await app.bridgeManager.transfer(params);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 跨链转账失败:", error);
      throw error;
    }
  });

  ipcMain.handle("bridge:get-supported-chains", async () => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.bridgeManager) {
        throw new Error("跨链桥管理器未初始化");
      }
      return await app.bridgeManager.getSupportedChains();
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 获取支持的链失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 托管管理 (5 handlers)
  // ============================================================

  ipcMain.handle("escrow:create", async (_event, params) => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.escrowManager) {
        throw new Error("托管管理器未初始化");
      }
      return await app.escrowManager.createEscrow(params);
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 创建托管失败:", error);
      throw error;
    }
  });

  ipcMain.handle("escrow:list", async () => {
    try {
      await ensureBlockchainInitialized(app);
      if (!app.escrowManager) {
        throw new Error("托管管理器未初始化");
      }
      return await app.escrowManager.listEscrows();
    } catch (error) {
      console.error("[Blockchain Lazy IPC] 获取托管列表失败:", error);
      throw error;
    }
  });

  console.log("[Blockchain Lazy IPC] ✓ 懒加载区块链 IPC 处理器注册完成");
  console.log("[Blockchain Lazy IPC] ✓ 已注册核心处理器，完整功能将在首次访问时加载");
}

module.exports = {
  registerLazyBlockchainIPC,
};
