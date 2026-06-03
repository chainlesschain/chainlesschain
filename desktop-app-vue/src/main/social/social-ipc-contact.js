/**
 * Social IPC handlers — contact group.
 * Split verbatim from social-ipc.js registerSocialIPC(); ipcMain + managers via ctx.
 *
 * @module social/social-ipc-contact
 */
import { logger } from "../utils/logger.js";

export function registerContactHandlers(ctx) {
  const { ipcMain, contactManager, friendManager } = ctx;

  // ============================================================
  // 联系人管理 (Contact Management) - 9 handlers
  // ============================================================

  /**
   * 添加联系人
   * Channel: 'contact:add'
   */
  ipcMain.handle("contact:add", async (_event, contact) => {
    try {
      if (!contactManager) {
        throw new Error("联系人管理器未初始化");
      }

      return await contactManager.addContact(contact);
    } catch (error) {
      logger.error("[Social IPC] 添加联系人失败:", error);
      throw error;
    }
  });

  /**
   * 从二维码添加联系人
   * Channel: 'contact:add-from-qr'
   */
  ipcMain.handle("contact:add-from-qr", async (_event, qrData) => {
    try {
      if (!contactManager) {
        throw new Error("联系人管理器未初始化");
      }

      return await contactManager.addContactFromQR(qrData);
    } catch (error) {
      logger.error("[Social IPC] 从二维码添加联系人失败:", error);
      throw error;
    }
  });

  /**
   * 获取所有联系人
   * Channel: 'contact:get-all'
   */
  ipcMain.handle("contact:get-all", async () => {
    try {
      if (!contactManager) {
        return {
          success: true,
          contacts: [],
        };
      }

      const contacts = contactManager.getAllContacts();
      return {
        success: true,
        contacts: contacts || [],
      };
    } catch (error) {
      logger.error("[Social IPC] 获取联系人列表失败:", error);
      return {
        success: false,
        contacts: [],
        error: error.message,
      };
    }
  });

  /**
   * 根据 DID 获取联系人
   * Channel: 'contact:get'
   */
  ipcMain.handle("contact:get", async (_event, did) => {
    try {
      if (!contactManager) {
        return null;
      }

      return contactManager.getContactByDID(did);
    } catch (error) {
      logger.error("[Social IPC] 获取联系人失败:", error);
      return null;
    }
  });

  /**
   * 更新联系人信息
   * Channel: 'contact:update'
   */
  ipcMain.handle("contact:update", async (_event, did, updates) => {
    try {
      if (!contactManager) {
        throw new Error("联系人管理器未初始化");
      }

      return await contactManager.updateContact(did, updates);
    } catch (error) {
      logger.error("[Social IPC] 更新联系人失败:", error);
      throw error;
    }
  });

  /**
   * 删除联系人
   * Channel: 'contact:delete'
   */
  ipcMain.handle("contact:delete", async (_event, did) => {
    try {
      if (!contactManager) {
        throw new Error("联系人管理器未初始化");
      }

      return await contactManager.deleteContact(did);
    } catch (error) {
      logger.error("[Social IPC] 删除联系人失败:", error);
      throw error;
    }
  });

  /**
   * 搜索联系人
   * Channel: 'contact:search'
   */
  ipcMain.handle("contact:search", async (_event, query) => {
    try {
      if (!contactManager) {
        return [];
      }

      return contactManager.searchContacts(query);
    } catch (error) {
      logger.error("[Social IPC] 搜索联系人失败:", error);
      return [];
    }
  });

  /**
   * 获取好友列表（通过联系人管理器）
   * Channel: 'contact:get-friends'
   */
  ipcMain.handle("contact:get-friends", async () => {
    try {
      if (!contactManager) {
        return [];
      }

      return contactManager.getFriends();
    } catch (error) {
      logger.error("[Social IPC] 获取好友列表失败:", error);
      return [];
    }
  });

  /**
   * 获取联系人统计信息
   * Channel: 'contact:get-statistics'
   */
  ipcMain.handle("contact:get-statistics", async () => {
    try {
      if (!contactManager) {
        return {
          success: true,
          statistics: { total: 0, friends: 0, byRelationship: {} },
        };
      }

      const statistics = contactManager.getStatistics();
      return {
        success: true,
        statistics: statistics || { total: 0, friends: 0, byRelationship: {} },
      };
    } catch (error) {
      logger.error("[Social IPC] 获取统计信息失败:", error);
      return {
        success: false,
        statistics: { total: 0, friends: 0, byRelationship: {} },
        error: error.message,
      };
    }
  });

  // ============================================================
  // 好友管理 (Friend Management) - 9 handlers
  // ============================================================

  /**
   * 发送好友请求
   * Channel: 'friend:send-request'
   */
  ipcMain.handle("friend:send-request", async (_event, targetDid, message) => {
    try {
      if (!friendManager) {
        throw new Error("好友管理器未初始化");
      }

      return await friendManager.sendFriendRequest(targetDid, message);
    } catch (error) {
      logger.error("[Social IPC] 发送好友请求失败:", error);
      throw error;
    }
  });

  /**
   * 接受好友请求
   * Channel: 'friend:accept-request'
   */
  ipcMain.handle("friend:accept-request", async (_event, requestId) => {
    try {
      if (!friendManager) {
        throw new Error("好友管理器未初始化");
      }

      return await friendManager.acceptFriendRequest(requestId);
    } catch (error) {
      logger.error("[Social IPC] 接受好友请求失败:", error);
      throw error;
    }
  });

  /**
   * 拒绝好友请求
   * Channel: 'friend:reject-request'
   */
  ipcMain.handle("friend:reject-request", async (_event, requestId) => {
    try {
      if (!friendManager) {
        throw new Error("好友管理器未初始化");
      }

      return await friendManager.rejectFriendRequest(requestId);
    } catch (error) {
      logger.error("[Social IPC] 拒绝好友请求失败:", error);
      throw error;
    }
  });

  /**
   * 获取待处理的好友请求
   * Channel: 'friend:get-pending-requests'
   */
  ipcMain.handle("friend:get-pending-requests", async () => {
    try {
      if (!friendManager) {
        return [];
      }

      return await friendManager.getPendingFriendRequests();
    } catch (error) {
      logger.error("[Social IPC] 获取待处理好友请求失败:", error);
      return [];
    }
  });

  /**
   * 获取好友列表（可按分组过滤）
   * Channel: 'friend:get-friends'
   */
  ipcMain.handle("friend:get-friends", async (_event, groupName) => {
    try {
      if (!friendManager) {
        return [];
      }

      return await friendManager.getFriends(groupName);
    } catch (error) {
      logger.error("[Social IPC] 获取好友列表失败:", error);
      return [];
    }
  });

  /**
   * 获取好友列表（返回包装格式，供前端使用）
   * Channel: 'friend:get-list'
   */
  ipcMain.handle("friend:get-list", async () => {
    try {
      if (!friendManager) {
        return { success: false, error: "好友管理器未初始化", friends: [] };
      }

      const friends = await friendManager.getFriends();
      return { success: true, friends: friends || [] };
    } catch (error) {
      logger.error("[Social IPC] 获取好友列表失败:", error);
      return { success: false, error: error.message, friends: [] };
    }
  });

  /**
   * 删除好友
   * Channel: 'friend:remove'
   */
  ipcMain.handle("friend:remove", async (_event, friendDid) => {
    try {
      if (!friendManager) {
        throw new Error("好友管理器未初始化");
      }

      return await friendManager.removeFriend(friendDid);
    } catch (error) {
      logger.error("[Social IPC] 删除好友失败:", error);
      throw error;
    }
  });

  /**
   * 更新好友备注
   * Channel: 'friend:update-nickname'
   */
  ipcMain.handle(
    "friend:update-nickname",
    async (_event, friendDid, nickname) => {
      try {
        if (!friendManager) {
          throw new Error("好友管理器未初始化");
        }

        return await friendManager.updateFriendNickname(friendDid, nickname);
      } catch (error) {
        logger.error("[Social IPC] 更新好友备注失败:", error);
        throw error;
      }
    },
  );

  /**
   * 更新好友分组
   * Channel: 'friend:update-group'
   */
  ipcMain.handle(
    "friend:update-group",
    async (_event, friendDid, groupName) => {
      try {
        if (!friendManager) {
          throw new Error("好友管理器未初始化");
        }

        return await friendManager.updateFriendGroup(friendDid, groupName);
      } catch (error) {
        logger.error("[Social IPC] 更新好友分组失败:", error);
        throw error;
      }
    },
  );

  /**
   * 获取好友统计信息
   * Channel: 'friend:get-statistics'
   */
  ipcMain.handle("friend:get-statistics", async () => {
    try {
      if (!friendManager) {
        return { total: 0, online: 0, offline: 0, byGroup: {} };
      }

      return await friendManager.getStatistics();
    } catch (error) {
      logger.error("[Social IPC] 获取好友统计失败:", error);
      return { total: 0, online: 0, offline: 0, byGroup: {} };
    }
  });

  // ============================================================
  // 信任评分 (Trust Scoring) - 3 handlers
  // ============================================================

  /**
   * 获取信任分
   * Channel: 'social:getTrustScore'
   */
  ipcMain.handle("social:getTrustScore", async (_event, friendDid) => {
    try {
      if (!friendManager) {
        return 0.5;
      }
      return await friendManager.getTrustScore(friendDid);
    } catch (error) {
      logger.error("[Social IPC] 获取信任分失败:", error);
      return 0.5;
    }
  });

  /**
   * 更新信任分
   * Channel: 'social:updateTrustScore'
   */
  ipcMain.handle(
    "social:updateTrustScore",
    async (_event, friendDid, score) => {
      try {
        if (!friendManager) {
          throw new Error("好友管理器未初始化");
        }
        await friendManager.updateTrustScore(friendDid, score);
        return { success: true };
      } catch (error) {
        logger.error("[Social IPC] 更新信任分失败:", error);
        throw error;
      }
    },
  );

  /**
   * 记录信任交互
   * Channel: 'social:recordTrustInteraction'
   */
  ipcMain.handle(
    "social:recordTrustInteraction",
    async (_event, friendDid, type, weight) => {
      try {
        if (!friendManager) {
          throw new Error("好友管理器未初始化");
        }
        await friendManager.recordTrustInteraction(friendDid, type, weight);
        return { success: true };
      } catch (error) {
        logger.error("[Social IPC] 记录信任交互失败:", error);
        throw error;
      }
    },
  );
}
