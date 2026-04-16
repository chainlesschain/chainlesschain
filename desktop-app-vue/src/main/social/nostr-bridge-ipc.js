/**
 * Nostr Bridge IPC 处理器
 * 负责处理 Nostr 协议相关的前后端通信
 *
 * @module social/nostr-bridge-ipc
 * @description 提供 Nostr relay 管理、事件发布、密钥生成、DID 映射等 IPC 接口
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const NOSTR_CHANNELS = [
  "nostr:list-relays",
  "nostr:add-relay",
  "nostr:publish-event",
  "nostr:get-events",
  "nostr:generate-keypair",
  "nostr:map-did",
  "nostr:publish-dm",
  "nostr:decrypt-dm",
  "nostr:publish-deletion",
  "nostr:publish-reaction",
];

/**
 * 注册 Nostr Bridge IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.nostrBridge - Nostr Bridge 实例
 * @param {Object} dependencies.nostrIdentity - Nostr Identity 实例
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象（可选，用于测试注入）
 * @param {Object} [dependencies.ipcGuard] - IPC Guard 模块（可选，用于测试注入）
 * @returns {Object} { handlerCount }
 */
function registerNostrBridgeIPC({
  nostrBridge,
  nostrIdentity,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  const ipcMain = injectedIpcMain || electronIpcMain;

  // 防止重复注册
  if (ipcGuard.isModuleRegistered("nostr-bridge-ipc")) {
    logger.info(
      "[Nostr IPC] Module already registered, cleaning up old handlers...",
    );
    try {
      for (const channel of NOSTR_CHANNELS) {
        ipcMain.removeHandler(channel);
      }
    } catch (_err) {
      // Intentionally empty - handlers may not exist
    }
    ipcGuard.unregisterModule("nostr-bridge-ipc");
  }

  logger.info("[Nostr IPC] Registering Nostr Bridge IPC handlers...");

  // ============================================================
  // Relay Management
  // ============================================================

  /**
   * List all Nostr relays
   * Channel: 'nostr:list-relays'
   */
  ipcMain.handle("nostr:list-relays", async () => {
    try {
      if (!nostrBridge) {
        throw new Error("Nostr Bridge 未初始化");
      }
      return await nostrBridge.listRelays();
    } catch (error) {
      logger.error("[Nostr IPC] 获取 relay 列表失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Add a Nostr relay
   * Channel: 'nostr:add-relay'
   */
  ipcMain.handle("nostr:add-relay", async (_event, { url }) => {
    try {
      if (!nostrBridge) {
        throw new Error("Nostr Bridge 未初始化");
      }
      return await nostrBridge.addRelay(url);
    } catch (error) {
      logger.error("[Nostr IPC] 添加 relay 失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Event Publishing & Retrieval
  // ============================================================

  /**
   * Publish a Nostr event
   * Channel: 'nostr:publish-event'
   */
  ipcMain.handle("nostr:publish-event", async (_event, params) => {
    try {
      if (!nostrBridge) {
        throw new Error("Nostr Bridge 未初始化");
      }
      return await nostrBridge.publishEvent(params);
    } catch (error) {
      logger.error("[Nostr IPC] 发布事件失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get Nostr events from local storage
   * Channel: 'nostr:get-events'
   */
  ipcMain.handle("nostr:get-events", async (_event, params) => {
    try {
      if (!nostrBridge) {
        throw new Error("Nostr Bridge 未初始化");
      }
      return await nostrBridge.getEvents(params);
    } catch (error) {
      logger.error("[Nostr IPC] 获取事件失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Identity Management
  // ============================================================

  /**
   * Generate a Nostr keypair
   * Channel: 'nostr:generate-keypair'
   */
  ipcMain.handle("nostr:generate-keypair", async () => {
    try {
      if (!nostrIdentity) {
        throw new Error("Nostr Identity 未初始化");
      }
      return await nostrIdentity.generateKeyPair();
    } catch (error) {
      logger.error("[Nostr IPC] 生成密钥对失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Map a DID to a Nostr identity
   * Channel: 'nostr:map-did'
   */
  ipcMain.handle("nostr:map-did", async (_event, params) => {
    try {
      if (!nostrIdentity) {
        throw new Error("Nostr Identity 未初始化");
      }
      return await nostrIdentity.mapDIDToNostr(params);
    } catch (error) {
      logger.error("[Nostr IPC] DID 映射失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // NIP-04 / NIP-09 / NIP-25 extensions
  // ============================================================

  /**
   * Publish a NIP-04 encrypted direct message
   * Channel: 'nostr:publish-dm'
   */
  ipcMain.handle("nostr:publish-dm", async (_event, params) => {
    try {
      if (!nostrBridge) {
        throw new Error("Nostr Bridge 未初始化");
      }
      return await nostrBridge.publishDirectMessage(params);
    } catch (error) {
      logger.error("[Nostr IPC] 发送加密 DM 失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Decrypt a NIP-04 encrypted direct message
   * Channel: 'nostr:decrypt-dm'
   */
  ipcMain.handle("nostr:decrypt-dm", async (_event, params) => {
    try {
      if (!nostrBridge) {
        throw new Error("Nostr Bridge 未初始化");
      }
      const plaintext = await nostrBridge.decryptDirectMessage(params);
      return { success: true, plaintext };
    } catch (error) {
      logger.error("[Nostr IPC] 解密 DM 失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Publish a NIP-09 deletion request
   * Channel: 'nostr:publish-deletion'
   */
  ipcMain.handle("nostr:publish-deletion", async (_event, params) => {
    try {
      if (!nostrBridge) {
        throw new Error("Nostr Bridge 未初始化");
      }
      return await nostrBridge.publishDeletion(params);
    } catch (error) {
      logger.error("[Nostr IPC] 发布删除请求失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Publish a NIP-25 reaction
   * Channel: 'nostr:publish-reaction'
   */
  ipcMain.handle("nostr:publish-reaction", async (_event, params) => {
    try {
      if (!nostrBridge) {
        throw new Error("Nostr Bridge 未初始化");
      }
      return await nostrBridge.publishReaction(params);
    } catch (error) {
      logger.error("[Nostr IPC] 发布 reaction 失败:", error);
      return { success: false, error: error.message };
    }
  });

  // Register with ipcGuard
  ipcGuard.registerModule("nostr-bridge-ipc", NOSTR_CHANNELS);

  logger.info(
    `[Nostr IPC] Registered ${NOSTR_CHANNELS.length} Nostr Bridge IPC handlers`,
  );
  return { handlerCount: NOSTR_CHANNELS.length };
}

/**
 * 注销所有 Nostr Bridge IPC 处理器
 * @param {Object} [options]
 * @param {Object} [options.ipcMain] - IPC 主进程对象（可选，用于测试注入）
 * @param {Object} [options.ipcGuard] - IPC Guard 模块（可选，用于测试注入）
 */
function unregisterNostrBridgeIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  const ipcMain = injectedIpcMain || electronIpcMain;

  for (const channel of NOSTR_CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch (_err) {
      // Intentionally empty - handler may not exist
    }
  }

  ipcGuard.unregisterModule("nostr-bridge-ipc");
  logger.info("[Nostr IPC] All Nostr Bridge IPC handlers unregistered");
}

export { registerNostrBridgeIPC, unregisterNostrBridgeIPC, NOSTR_CHANNELS };
