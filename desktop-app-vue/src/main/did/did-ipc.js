const { logger } = require("../utils/logger.js");

/**
 * DID（去中心化身份）IPC 处理器
 * 负责处理 DID 身份管理相关的前后端通信
 *
 * @module did-ipc
 * @description 提供 DID 身份 CRUD、文档管理、DHT 发布、自动重新发布、助记词管理等 IPC 接口
 */

/**
 * 注册所有 DID IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.didManager - DID 管理器
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 */
function registerDIDIPC({ didManager, ipcMain: injectedIpcMain }) {
  // 支持依赖注入，用于测试
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info("[DID IPC] Registering DID IPC handlers...");

  // ============================================================
  // DID 身份管理 (Identity Management)
  // ============================================================

  /**
   * 创建 DID 身份
   * Channel: 'did:create-identity'
   */
  ipcMain.handle("did:create-identity", async (_event, profile, options) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return await didManager.createIdentity(profile, options);
    } catch (error) {
      logger.error("[DID IPC] 创建身份失败:", error);
      throw error;
    }
  });

  /**
   * 获取所有身份
   * Channel: 'did:get-all-identities'
   */
  ipcMain.handle("did:get-all-identities", async () => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return didManager.getAllIdentities();
    } catch (error) {
      logger.error("[DID IPC] 获取身份列表失败:", error);
      throw error;
    }
  });

  /**
   * 根据 DID 获取身份
   * Channel: 'did:get-identity'
   */
  ipcMain.handle("did:get-identity", async (_event, did) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return didManager.getIdentityByDID(did);
    } catch (error) {
      logger.error("[DID IPC] 获取身份失败:", error);
      throw error;
    }
  });

  /**
   * 获取当前身份
   * Channel: 'did:get-current-identity'
   */
  ipcMain.handle("did:get-current-identity", async () => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return didManager.getCurrentIdentity();
    } catch (error) {
      logger.error("[DID IPC] 获取当前身份失败:", error);
      throw error;
    }
  });

  /**
   * 设置默认身份
   * Channel: 'did:set-default-identity'
   */
  ipcMain.handle("did:set-default-identity", async (_event, did) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      await didManager.setDefaultIdentity(did);
      return { success: true };
    } catch (error) {
      logger.error("[DID IPC] 设置默认身份失败:", error);
      throw error;
    }
  });

  /**
   * 更新身份信息
   * Channel: 'did:update-identity'
   */
  ipcMain.handle("did:update-identity", async (_event, did, updates) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return await didManager.updateIdentityProfile(did, updates);
    } catch (error) {
      logger.error("[DID IPC] 更新身份失败:", error);
      throw error;
    }
  });

  /**
   * 删除身份
   * Channel: 'did:delete-identity'
   */
  ipcMain.handle("did:delete-identity", async (_event, did) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return await didManager.deleteIdentity(did);
    } catch (error) {
      logger.error("[DID IPC] 删除身份失败:", error);
      throw error;
    }
  });

  // ============================================================
  // DID 文档操作 (Document Operations)
  // ============================================================

  /**
   * 导出 DID 文档
   * Channel: 'did:export-document'
   */
  ipcMain.handle("did:export-document", async (_event, did) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return didManager.exportDIDDocument(did);
    } catch (error) {
      logger.error("[DID IPC] 导出DID文档失败:", error);
      throw error;
    }
  });

  /**
   * 生成 DID 二维码
   * Channel: 'did:generate-qrcode'
   */
  ipcMain.handle("did:generate-qrcode", async (_event, did) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return didManager.generateQRCodeData(did);
    } catch (error) {
      logger.error("[DID IPC] 生成二维码失败:", error);
      throw error;
    }
  });

  /**
   * 验证 DID 文档
   * Channel: 'did:verify-document'
   */
  ipcMain.handle("did:verify-document", async (_event, document) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return didManager.verifyDIDDocument(document);
    } catch (error) {
      logger.error("[DID IPC] 验证DID文档失败:", error);
      throw error;
    }
  });

  // ============================================================
  // DHT 发布操作 (DHT Publishing)
  // ============================================================

  /**
   * 发布 DID 到 DHT
   * Channel: 'did:publish-to-dht'
   */
  ipcMain.handle("did:publish-to-dht", async (_event, did) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return await didManager.publishToDHT(did);
    } catch (error) {
      logger.error("[DID IPC] 发布DID到DHT失败:", error);
      throw error;
    }
  });

  /**
   * 从 DHT 解析 DID
   * Channel: 'did:resolve-from-dht'
   */
  ipcMain.handle("did:resolve-from-dht", async (_event, did) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return await didManager.resolveFromDHT(did);
    } catch (error) {
      logger.error("[DID IPC] 从DHT解析DID失败:", error);
      throw error;
    }
  });

  /**
   * 从 DHT 取消发布 DID
   * Channel: 'did:unpublish-from-dht'
   */
  ipcMain.handle("did:unpublish-from-dht", async (_event, did) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return await didManager.unpublishFromDHT(did);
    } catch (error) {
      logger.error("[DID IPC] 从DHT取消发布DID失败:", error);
      throw error;
    }
  });

  /**
   * 检查 DID 是否已发布到 DHT
   * Channel: 'did:is-published-to-dht'
   */
  ipcMain.handle("did:is-published-to-dht", async (_event, did) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return await didManager.isPublishedToDHT(did);
    } catch (error) {
      logger.error("[DID IPC] 检查DID发布状态失败:", error);
      return false;
    }
  });

  // ============================================================
  // 自动重新发布 (Auto-republish)
  // ============================================================

  /**
   * 启动自动重新发布
   * Channel: 'did:start-auto-republish'
   */
  ipcMain.handle("did:start-auto-republish", async (_event, interval) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      didManager.startAutoRepublish(interval);
      return { success: true };
    } catch (error) {
      logger.error("[DID IPC] 启动自动重新发布失败:", error);
      throw error;
    }
  });

  /**
   * 停止自动重新发布
   * Channel: 'did:stop-auto-republish'
   */
  ipcMain.handle("did:stop-auto-republish", async () => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      didManager.stopAutoRepublish();
      return { success: true };
    } catch (error) {
      logger.error("[DID IPC] 停止自动重新发布失败:", error);
      throw error;
    }
  });

  /**
   * 获取自动重新发布状态
   * Channel: 'did:get-auto-republish-status'
   */
  ipcMain.handle("did:get-auto-republish-status", async () => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return didManager.getAutoRepublishStatus();
    } catch (error) {
      logger.error("[DID IPC] 获取自动重新发布状态失败:", error);
      return {
        enabled: false,
        interval: 0,
        intervalHours: 0,
      };
    }
  });

  /**
   * 设置自动重新发布间隔
   * Channel: 'did:set-auto-republish-interval'
   */
  ipcMain.handle(
    "did:set-auto-republish-interval",
    async (_event, interval) => {
      try {
        if (!didManager) {
          throw new Error("DID管理器未初始化");
        }

        didManager.setAutoRepublishInterval(interval);
        return { success: true };
      } catch (error) {
        logger.error("[DID IPC] 设置自动重新发布间隔失败:", error);
        throw error;
      }
    },
  );

  /**
   * 重新发布所有 DID
   * Channel: 'did:republish-all'
   */
  ipcMain.handle("did:republish-all", async () => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return await didManager.republishAllDIDs();
    } catch (error) {
      logger.error("[DID IPC] 重新发布所有DID失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 助记词管理 (Mnemonic Management)
  // ============================================================

  /**
   * 生成助记词
   * Channel: 'did:generate-mnemonic'
   */
  ipcMain.handle("did:generate-mnemonic", async (_event, strength) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return didManager.generateMnemonic(strength);
    } catch (error) {
      logger.error("[DID IPC] 生成助记词失败:", error);
      throw error;
    }
  });

  /**
   * 验证助记词
   * Channel: 'did:validate-mnemonic'
   */
  ipcMain.handle("did:validate-mnemonic", async (_event, mnemonic) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return didManager.validateMnemonic(mnemonic);
    } catch (error) {
      logger.error("[DID IPC] 验证助记词失败:", error);
      return false;
    }
  });

  /**
   * 从助记词创建身份
   * Channel: 'did:create-from-mnemonic'
   */
  ipcMain.handle(
    "did:create-from-mnemonic",
    async (_event, profile, mnemonic, options) => {
      try {
        if (!didManager) {
          throw new Error("DID管理器未初始化");
        }

        return await didManager.createIdentityFromMnemonic(
          profile,
          mnemonic,
          options,
        );
      } catch (error) {
        logger.error("[DID IPC] 从助记词创建身份失败:", error);
        throw error;
      }
    },
  );

  /**
   * 导出助记词
   * Channel: 'did:export-mnemonic'
   */
  ipcMain.handle("did:export-mnemonic", async (_event, did) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return didManager.exportMnemonic(did);
    } catch (error) {
      logger.error("[DID IPC] 导出助记词失败:", error);
      throw error;
    }
  });

  /**
   * 检查是否有助记词
   * Channel: 'did:has-mnemonic'
   */
  ipcMain.handle("did:has-mnemonic", async (_event, did) => {
    try {
      if (!didManager) {
        throw new Error("DID管理器未初始化");
      }

      return didManager.hasMnemonic(did);
    } catch (error) {
      logger.error("[DID IPC] 检查助记词失败:", error);
      return false;
    }
  });

  logger.info(
    "[DID IPC] ✓ All DID IPC handlers registered successfully (24 handlers)",
  );
}

module.exports = {
  registerDIDIPC,
};
