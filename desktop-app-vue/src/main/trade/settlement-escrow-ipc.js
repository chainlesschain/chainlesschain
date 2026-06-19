"use strict";

/**
 * 结算 escrow IPC 处理器（settlement:*）。
 *
 * 把 trade-initializer 构造的 settlementEscrow facade（@chainlesschain/
 * core-settlement 联邦签名转账日志账本 + multisig 门控托管 escrow）暴露给渲染进程。
 *
 * ── 安全原则：私钥永不过 IPC ────────────────────────────────────────────────
 * 开 hold 需买方对「buyer→custodian 押款」转账签名。
 *  - 买方 = 本机身份：由主进程用本机 DID 私钥就地签名（私钥不出主进程）。
 *  - 跨设备买方：渲染层须传入对方设备预签的 `fund`（{nonce, alg, sig}），
 *    主进程不持有、也不需要对方私钥。
 * 渲染层任何路径都不会、也无法拿到任何成员私钥。
 *
 * 详见 ./settlement-escrow.js。
 */

const { logger } = require("../utils/logger.js");
const { naclIdentityToMember } = require("./settlement-escrow.js");

/**
 * 注册结算 escrow 相关 IPC 处理器。
 * @param {object} context
 * @param {object} context.settlementEscrow  trade-initializer 的 settlementEscrow 实例
 * @param {object} context.didManager        本机 DID 管理器（取本机身份签名）
 * @param {object} [context.ipcMain]         （测试用）注入 mock ipcMain
 */
function registerSettlementEscrowIPC(context) {
  const {
    settlementEscrow,
    didManager,
    ipcMain: injectedIpcMain,
  } = context || {};
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  const requireReady = () => {
    if (!settlementEscrow) {
      throw new Error("结算 escrow 未初始化（请先创建 DID 身份后重启）");
    }
  };

  // 1. 查询余额（只读）
  ipcMain.handle("settlement:get-balance", async (_event, did) => {
    try {
      if (!settlementEscrow) {
        return null;
      }
      if (!did || typeof did !== "string") {
        throw new TypeError("did 必须为非空字符串");
      }
      return settlementEscrow.balanceOf(did);
    } catch (error) {
      logger.error("[Settlement IPC] 查询余额失败:", error);
      throw error;
    }
  });

  // 2. 查询托管 hold（只读）
  ipcMain.handle("settlement:get-hold", async (_event, holdId) => {
    try {
      if (!settlementEscrow) {
        return null;
      }
      if (!holdId || typeof holdId !== "string") {
        throw new TypeError("holdId 必须为非空字符串");
      }
      return settlementEscrow.getHold(holdId);
    } catch (error) {
      logger.error("[Settlement IPC] 查询托管失败:", error);
      throw error;
    }
  });

  // 3. 注册成员公钥（counterparty 加入账本验签册；仅公钥、无私钥）
  ipcMain.handle("settlement:register-member", async (_event, member) => {
    try {
      requireReady();
      if (!member || !member.did || !member.pubkeyJwk) {
        throw new TypeError("member 须含 { did, alg, pubkeyJwk }");
      }
      settlementEscrow.registerMember({
        did: member.did,
        alg: member.alg,
        pubkeyJwk: member.pubkeyJwk,
      });
      return { ok: true };
    } catch (error) {
      logger.error("[Settlement IPC] 注册成员失败:", error);
      throw error;
    }
  });

  // 4. 发放 credits（genesis 铸币；单节点联邦本机即 genesis）
  ipcMain.handle("settlement:grant", async (_event, payload) => {
    try {
      requireReady();
      const { to, amount, nonce } = payload || {};
      if (!to || typeof to !== "string") {
        throw new TypeError("to 须为 did 字符串");
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new TypeError("amount 须为正数");
      }
      return settlementEscrow.grant({ to, amount, nonce });
    } catch (error) {
      logger.error("[Settlement IPC] 发放 credits 失败:", error);
      throw error;
    }
  });

  // 5. 为交易开托管 hold（买方押款 buyer→custodian）。
  //    - 无预签 fund → 买方必须是本机当前身份，主进程就地签名（私钥不过 IPC）。
  //    - 有预签 fund → 跨设备买方，原样转交 core-settlement 验签。
  ipcMain.handle("settlement:open-hold", async (_event, payload) => {
    try {
      requireReady();
      const { transactionId, buyer, seller, amount, proposalId, fund, nonce } =
        payload || {};
      if (!transactionId || !buyer || !seller) {
        throw new TypeError("transactionId / buyer / seller 必填");
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new TypeError("amount 须为正数");
      }

      let buyerSecretKey;
      if (!fund) {
        const identity =
          didManager &&
          typeof didManager.getCurrentIdentity === "function" &&
          didManager.getCurrentIdentity();
        if (!identity || identity.did !== buyer) {
          throw new Error(
            "无预签 fund 时买方必须为本机当前身份（私钥不经 IPC 传递；跨设备买方请传 fund）",
          );
        }
        buyerSecretKey = naclIdentityToMember(identity).secretKey;
      }

      return settlementEscrow.openHoldForTransaction({
        transactionId,
        buyer,
        seller,
        amount,
        proposalId,
        fund,
        buyerSecretKey,
        nonce,
      });
    } catch (error) {
      logger.error("[Settlement IPC] 开托管失败:", error);
      throw error;
    }
  });

  // 6. 放款给卖方（custodian 动作；经 M-of-N 多签门控 fail-closed）
  ipcMain.handle("settlement:release", async (_event, holdId) => {
    try {
      requireReady();
      if (!holdId || typeof holdId !== "string") {
        throw new TypeError("holdId 须为非空字符串");
      }
      return settlementEscrow.release(holdId);
    } catch (error) {
      logger.error("[Settlement IPC] 放款失败:", error);
      throw error;
    }
  });

  // 7. 退款给买方（custodian 动作）
  ipcMain.handle("settlement:refund", async (_event, holdId) => {
    try {
      requireReady();
      if (!holdId || typeof holdId !== "string") {
        throw new TypeError("holdId 须为非空字符串");
      }
      return settlementEscrow.refund(holdId);
    } catch (error) {
      logger.error("[Settlement IPC] 退款失败:", error);
      throw error;
    }
  });

  logger.info("[IPC] ✓ Settlement Escrow IPC 注册完成 (7 handlers)");
}

module.exports = { registerSettlementEscrowIPC };
