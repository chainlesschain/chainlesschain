/**
 * DeFi IPC Handlers - 去中心化金融IPC处理器
 *
 * 提供22个IPC处理器: 借贷(8) + 保险(8) + 原子互换(6)
 *
 * @module defi/defi-ipc
 * @version 1.0.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

function registerDeFiIPC({
  lendingManager,
  insurancePoolManager,
  atomicSwapManager,
}) {
  // ============================================================
  // 借贷 IPC (8 handlers)
  // ============================================================

  ipcMain.handle("defi:lending:create-pool", async (event, params) => {
    if (!lendingManager) throw new Error("LendingManager not initialized");
    return await lendingManager.createLendingPool(params);
  });

  ipcMain.handle("defi:lending:request-loan", async (event, params) => {
    if (!lendingManager) throw new Error("LendingManager not initialized");
    return await lendingManager.requestLoan(params);
  });

  ipcMain.handle("defi:lending:approve-loan", async (event, { loanId }) => {
    if (!lendingManager) throw new Error("LendingManager not initialized");
    return await lendingManager.approveLoan(loanId);
  });

  ipcMain.handle(
    "defi:lending:repay",
    async (event, { loanId, amount }) => {
      if (!lendingManager) throw new Error("LendingManager not initialized");
      return await lendingManager.repayLoan(loanId, amount);
    },
  );

  ipcMain.handle("defi:lending:get-pool", async (event, { poolId }) => {
    if (!lendingManager) return null;
    return lendingManager.getPool(poolId);
  });

  ipcMain.handle("defi:lending:list-pools", async (event, filters) => {
    if (!lendingManager) return { pools: [], total: 0 };
    return await lendingManager.listPools(filters);
  });

  ipcMain.handle(
    "defi:lending:list-loans",
    async (event, { userId, filters }) => {
      if (!lendingManager) return { loans: [], total: 0 };
      return await lendingManager.listLoans(userId, filters);
    },
  );

  ipcMain.handle("defi:lending:check-health", async () => {
    if (!lendingManager) return { checked: 0, unhealthy: 0 };
    return await lendingManager.checkLoanHealth();
  });

  // ============================================================
  // 保险池 IPC (8 handlers)
  // ============================================================

  ipcMain.handle("defi:insurance:create-pool", async (event, params) => {
    if (!insurancePoolManager)
      throw new Error("InsurancePoolManager not initialized");
    return await insurancePoolManager.createPool(params);
  });

  ipcMain.handle(
    "defi:insurance:join",
    async (event, { poolId, userId, contribution }) => {
      if (!insurancePoolManager)
        throw new Error("InsurancePoolManager not initialized");
      return await insurancePoolManager.joinPool(poolId, userId, contribution);
    },
  );

  ipcMain.handle(
    "defi:insurance:leave",
    async (event, { poolId, userId }) => {
      if (!insurancePoolManager)
        throw new Error("InsurancePoolManager not initialized");
      return await insurancePoolManager.leavePool(poolId, userId);
    },
  );

  ipcMain.handle("defi:insurance:submit-claim", async (event, params) => {
    if (!insurancePoolManager)
      throw new Error("InsurancePoolManager not initialized");
    return await insurancePoolManager.submitClaim(params);
  });

  ipcMain.handle(
    "defi:insurance:vote-claim",
    async (event, { claimId, voterId, approve }) => {
      if (!insurancePoolManager)
        throw new Error("InsurancePoolManager not initialized");
      return await insurancePoolManager.voteClaim(claimId, voterId, approve);
    },
  );

  ipcMain.handle(
    "defi:insurance:resolve-claim",
    async (event, { claimId }) => {
      if (!insurancePoolManager)
        throw new Error("InsurancePoolManager not initialized");
      return await insurancePoolManager.resolveClaim(claimId);
    },
  );

  ipcMain.handle("defi:insurance:list-pools", async (event, filters) => {
    if (!insurancePoolManager) return { pools: [], total: 0 };
    return await insurancePoolManager.listPools(filters);
  });

  ipcMain.handle(
    "defi:insurance:list-claims",
    async (event, { poolId, options }) => {
      if (!insurancePoolManager) return { claims: [], total: 0 };
      return await insurancePoolManager.listClaims(poolId, options);
    },
  );

  // ============================================================
  // 原子互换 IPC (6 handlers)
  // ============================================================

  ipcMain.handle("defi:swap:initiate", async (event, params) => {
    if (!atomicSwapManager)
      throw new Error("AtomicSwapManager not initialized");
    return await atomicSwapManager.initiateSwap(params);
  });

  ipcMain.handle(
    "defi:swap:accept",
    async (event, { swapId, counterpartyId }) => {
      if (!atomicSwapManager)
        throw new Error("AtomicSwapManager not initialized");
      return await atomicSwapManager.acceptSwap(swapId, counterpartyId);
    },
  );

  ipcMain.handle("defi:swap:claim", async (event, { swapId, secret }) => {
    if (!atomicSwapManager)
      throw new Error("AtomicSwapManager not initialized");
    return await atomicSwapManager.claimSwap(swapId, secret);
  });

  ipcMain.handle("defi:swap:refund", async (event, { swapId }) => {
    if (!atomicSwapManager)
      throw new Error("AtomicSwapManager not initialized");
    return await atomicSwapManager.refundSwap(swapId);
  });

  ipcMain.handle("defi:swap:list", async (event, { userId, filters }) => {
    if (!atomicSwapManager) return { swaps: [], total: 0 };
    return await atomicSwapManager.listSwaps(userId, filters);
  });

  ipcMain.handle("defi:swap:get-rates", async () => {
    if (!atomicSwapManager) return {};
    return await atomicSwapManager.getSwapRates();
  });

  logger.info("[DeFiIPC] 22个DeFi IPC处理器注册成功");
  logger.info("[DeFiIPC]   - 借贷: 8 handlers");
  logger.info("[DeFiIPC]   - 保险: 8 handlers");
  logger.info("[DeFiIPC]   - 原子互换: 6 handlers");
}

module.exports = { registerDeFiIPC };
