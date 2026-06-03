/**
 * Social IPC handlers — group group.
 * Split verbatim from social-ipc.js registerSocialIPC(); ipcMain + managers via ctx.
 *
 * @module social/social-ipc-group
 */
import { logger } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

export function registerGroupHandlers(ctx) {
  const { ipcMain, database, groupChatManager } = ctx;

  // ============================================================
  // 群聊管理 (Group Chat Management) - 15 handlers
  // ============================================================

  /**
   * 创建群聊
   * Channel: 'group:create'
   */
  ipcMain.handle("group:create", async (_event, options) => {
    try {
      if (!groupChatManager) {
        throw new Error("群聊管理器未初始化");
      }
      return await groupChatManager.createGroup(options);
    } catch (error) {
      logger.error("[Social IPC] 创建群聊失败:", error);
      throw error;
    }
  });

  /**
   * 获取群聊列表
   * Channel: 'group:get-list'
   */
  ipcMain.handle("group:get-list", async () => {
    try {
      if (!groupChatManager) {
        return [];
      }
      return await groupChatManager.getGroups();
    } catch (error) {
      logger.error("[Social IPC] 获取群聊列表失败:", error);
      return [];
    }
  });

  /**
   * 获取群聊详情
   * Channel: 'group:get-details'
   */
  ipcMain.handle("group:get-details", async (_event, groupId) => {
    try {
      if (!groupChatManager) {
        throw new Error("群聊管理器未初始化");
      }
      return await groupChatManager.getGroupDetails(groupId);
    } catch (error) {
      logger.error("[Social IPC] 获取群聊详情失败:", error);
      throw error;
    }
  });

  /**
   * 更新群信息
   * Channel: 'group:update-info'
   */
  ipcMain.handle("group:update-info", async (_event, groupId, updates) => {
    try {
      if (!groupChatManager) {
        throw new Error("群聊管理器未初始化");
      }
      return await groupChatManager.updateGroupInfo(groupId, updates);
    } catch (error) {
      logger.error("[Social IPC] 更新群信息失败:", error);
      throw error;
    }
  });

  /**
   * 添加群成员
   * Channel: 'group:add-member'
   */
  ipcMain.handle(
    "group:add-member",
    async (_event, groupId, memberDid, role) => {
      try {
        if (!groupChatManager) {
          throw new Error("群聊管理器未初始化");
        }
        return await groupChatManager.addGroupMember(groupId, memberDid, role);
      } catch (error) {
        logger.error("[Social IPC] 添加群成员失败:", error);
        throw error;
      }
    },
  );

  /**
   * 移除群成员
   * Channel: 'group:remove-member'
   */
  ipcMain.handle("group:remove-member", async (_event, groupId, memberDid) => {
    try {
      if (!groupChatManager) {
        throw new Error("群聊管理器未初始化");
      }
      return await groupChatManager.removeGroupMember(groupId, memberDid);
    } catch (error) {
      logger.error("[Social IPC] 移除群成员失败:", error);
      throw error;
    }
  });

  /**
   * 退出群聊
   * Channel: 'group:leave'
   */
  ipcMain.handle("group:leave", async (_event, groupId) => {
    try {
      if (!groupChatManager) {
        throw new Error("群聊管理器未初始化");
      }
      return await groupChatManager.leaveGroup(groupId);
    } catch (error) {
      logger.error("[Social IPC] 退出群聊失败:", error);
      throw error;
    }
  });

  /**
   * 解散群聊
   * Channel: 'group:dismiss'
   */
  ipcMain.handle("group:dismiss", async (_event, groupId) => {
    try {
      if (!groupChatManager) {
        throw new Error("群聊管理器未初始化");
      }
      return await groupChatManager.dismissGroup(groupId);
    } catch (error) {
      logger.error("[Social IPC] 解散群聊失败:", error);
      throw error;
    }
  });

  /**
   * 发送群消息
   * Channel: 'group:send-message'
   */
  ipcMain.handle(
    "group:send-message",
    async (_event, groupId, content, options) => {
      try {
        if (!groupChatManager) {
          throw new Error("群聊管理器未初始化");
        }
        return await groupChatManager.sendGroupMessage(
          groupId,
          content,
          options,
        );
      } catch (error) {
        logger.error("[Social IPC] 发送群消息失败:", error);
        throw error;
      }
    },
  );

  /**
   * 获取群消息
   * Channel: 'group:get-messages'
   */
  ipcMain.handle(
    "group:get-messages",
    async (_event, groupId, limit, offset) => {
      try {
        if (!groupChatManager) {
          return [];
        }
        return await groupChatManager.getGroupMessages(groupId, limit, offset);
      } catch (error) {
        logger.error("[Social IPC] 获取群消息失败:", error);
        return [];
      }
    },
  );

  /**
   * 标记群消息为已读
   * Channel: 'group:mark-message-read'
   */
  ipcMain.handle(
    "group:mark-message-read",
    async (_event, messageId, groupId) => {
      try {
        if (!groupChatManager) {
          return { success: false };
        }
        return await groupChatManager.markMessageAsRead(messageId, groupId);
      } catch (error) {
        logger.error("[Social IPC] 标记群消息已读失败:", error);
        return { success: false };
      }
    },
  );

  /**
   * 邀请成员加入群聊
   * Channel: 'group:invite-member'
   */
  ipcMain.handle(
    "group:invite-member",
    async (_event, groupId, inviteeDid, message) => {
      try {
        if (!groupChatManager) {
          throw new Error("群聊管理器未初始化");
        }

        // 创建邀请记录
        const invitationId = uuidv4();
        const now = Date.now();
        const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7天后过期

        const stmt = database.prepare(`
        INSERT INTO group_invitations (
          id, group_id, inviter_did, invitee_did, message,
          status, created_at, expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

        stmt.run(
          invitationId,
          groupId,
          groupChatManager.currentUserDid,
          inviteeDid,
          message || "",
          "pending",
          now,
          expiresAt,
        );

        database.saveToFile();

        // 通过P2P发送邀请
        if (groupChatManager.p2pManager) {
          await groupChatManager.p2pManager.sendMessage(inviteeDid, {
            type: "group:invitation",
            invitationId,
            groupId,
            inviterDid: groupChatManager.currentUserDid,
            message,
          });
        }

        return { success: true, invitationId };
      } catch (error) {
        logger.error("[Social IPC] 邀请成员失败:", error);
        throw error;
      }
    },
  );

  /**
   * 接受群聊邀请
   * Channel: 'group:accept-invitation'
   */
  ipcMain.handle("group:accept-invitation", async (_event, invitationId) => {
    try {
      if (!groupChatManager || !database) {
        throw new Error("群聊管理器或数据库未初始化");
      }

      // 获取邀请信息
      const inviteStmt = database.prepare(
        "SELECT * FROM group_invitations WHERE id = ?",
      );
      const invitation = inviteStmt.get(invitationId);

      if (!invitation) {
        throw new Error("邀请不存在");
      }

      if (invitation.status !== "pending") {
        throw new Error("邀请已处理");
      }

      if (invitation.expires_at && invitation.expires_at < Date.now()) {
        throw new Error("邀请已过期");
      }

      // 添加为群成员
      await groupChatManager.addGroupMember(
        invitation.group_id,
        invitation.invitee_did,
        "member",
      );

      // 更新邀请状态
      const updateStmt = database.prepare(
        "UPDATE group_invitations SET status = ? WHERE id = ?",
      );
      updateStmt.run("accepted", invitationId);

      database.saveToFile();

      return { success: true, groupId: invitation.group_id };
    } catch (error) {
      logger.error("[Social IPC] 接受邀请失败:", error);
      throw error;
    }
  });

  /**
   * 拒绝群聊邀请
   * Channel: 'group:reject-invitation'
   */
  ipcMain.handle("group:reject-invitation", async (_event, invitationId) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const stmt = database.prepare(
        "UPDATE group_invitations SET status = ? WHERE id = ?",
      );
      stmt.run("rejected", invitationId);
      database.saveToFile();

      return { success: true };
    } catch (error) {
      logger.error("[Social IPC] 拒绝邀请失败:", error);
      throw error;
    }
  });

  /**
   * 获取群聊邀请列表
   * Channel: 'group:get-invitations'
   */
  ipcMain.handle("group:get-invitations", async (_event, inviteeDid) => {
    try {
      if (!database) {
        return [];
      }

      const stmt = database.prepare(`
        SELECT gi.*, gc.name as group_name, gc.avatar as group_avatar
        FROM group_invitations gi
        LEFT JOIN group_chats gc ON gi.group_id = gc.id
        WHERE gi.invitee_did = ? AND gi.status = 'pending'
        ORDER BY gi.created_at DESC
      `);

      return stmt.all(inviteeDid) || [];
    } catch (error) {
      logger.error("[Social IPC] 获取邀请列表失败:", error);
      return [];
    }
  });
}
