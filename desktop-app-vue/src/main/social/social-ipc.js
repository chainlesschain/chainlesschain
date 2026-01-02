/**
 * Social IPC 处理器
 * 负责处理社交网络相关的前后端通信
 *
 * @module social-ipc
 * @description 提供联系人管理、好友关系、动态发布、聊天消息等社交功能的 IPC 接口
 */

const { ipcMain } = require('electron');

/**
 * 注册所有 Social IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.contactManager - 联系人管理器
 * @param {Object} dependencies.friendManager - 好友管理器
 * @param {Object} dependencies.postManager - 动态管理器
 * @param {Object} dependencies.database - 数据库管理器（用于聊天功能）
 */
function registerSocialIPC({ contactManager, friendManager, postManager, database }) {
  console.log('[Social IPC] Registering Social IPC handlers...');

  // ============================================================
  // 联系人管理 (Contact Management) - 9 handlers
  // ============================================================

  /**
   * 添加联系人
   * Channel: 'contact:add'
   */
  ipcMain.handle('contact:add', async (_event, contact) => {
    try {
      if (!contactManager) {
        throw new Error('联系人管理器未初始化');
      }

      return await contactManager.addContact(contact);
    } catch (error) {
      console.error('[Social IPC] 添加联系人失败:', error);
      throw error;
    }
  });

  /**
   * 从二维码添加联系人
   * Channel: 'contact:add-from-qr'
   */
  ipcMain.handle('contact:add-from-qr', async (_event, qrData) => {
    try {
      if (!contactManager) {
        throw new Error('联系人管理器未初始化');
      }

      return await contactManager.addContactFromQR(qrData);
    } catch (error) {
      console.error('[Social IPC] 从二维码添加联系人失败:', error);
      throw error;
    }
  });

  /**
   * 获取所有联系人
   * Channel: 'contact:get-all'
   */
  ipcMain.handle('contact:get-all', async () => {
    try {
      if (!contactManager) {
        return [];
      }

      return contactManager.getAllContacts();
    } catch (error) {
      console.error('[Social IPC] 获取联系人列表失败:', error);
      return [];
    }
  });

  /**
   * 根据 DID 获取联系人
   * Channel: 'contact:get'
   */
  ipcMain.handle('contact:get', async (_event, did) => {
    try {
      if (!contactManager) {
        return null;
      }

      return contactManager.getContactByDID(did);
    } catch (error) {
      console.error('[Social IPC] 获取联系人失败:', error);
      return null;
    }
  });

  /**
   * 更新联系人信息
   * Channel: 'contact:update'
   */
  ipcMain.handle('contact:update', async (_event, did, updates) => {
    try {
      if (!contactManager) {
        throw new Error('联系人管理器未初始化');
      }

      return await contactManager.updateContact(did, updates);
    } catch (error) {
      console.error('[Social IPC] 更新联系人失败:', error);
      throw error;
    }
  });

  /**
   * 删除联系人
   * Channel: 'contact:delete'
   */
  ipcMain.handle('contact:delete', async (_event, did) => {
    try {
      if (!contactManager) {
        throw new Error('联系人管理器未初始化');
      }

      return await contactManager.deleteContact(did);
    } catch (error) {
      console.error('[Social IPC] 删除联系人失败:', error);
      throw error;
    }
  });

  /**
   * 搜索联系人
   * Channel: 'contact:search'
   */
  ipcMain.handle('contact:search', async (_event, query) => {
    try {
      if (!contactManager) {
        return [];
      }

      return contactManager.searchContacts(query);
    } catch (error) {
      console.error('[Social IPC] 搜索联系人失败:', error);
      return [];
    }
  });

  /**
   * 获取好友列表（通过联系人管理器）
   * Channel: 'contact:get-friends'
   */
  ipcMain.handle('contact:get-friends', async () => {
    try {
      if (!contactManager) {
        return [];
      }

      return contactManager.getFriends();
    } catch (error) {
      console.error('[Social IPC] 获取好友列表失败:', error);
      return [];
    }
  });

  /**
   * 获取联系人统计信息
   * Channel: 'contact:get-statistics'
   */
  ipcMain.handle('contact:get-statistics', async () => {
    try {
      if (!contactManager) {
        return { total: 0, friends: 0, byRelationship: {} };
      }

      return contactManager.getStatistics();
    } catch (error) {
      console.error('[Social IPC] 获取统计信息失败:', error);
      return { total: 0, friends: 0, byRelationship: {} };
    }
  });

  // ============================================================
  // 好友管理 (Friend Management) - 9 handlers
  // ============================================================

  /**
   * 发送好友请求
   * Channel: 'friend:send-request'
   */
  ipcMain.handle('friend:send-request', async (_event, targetDid, message) => {
    try {
      if (!friendManager) {
        throw new Error('好友管理器未初始化');
      }

      return await friendManager.sendFriendRequest(targetDid, message);
    } catch (error) {
      console.error('[Social IPC] 发送好友请求失败:', error);
      throw error;
    }
  });

  /**
   * 接受好友请求
   * Channel: 'friend:accept-request'
   */
  ipcMain.handle('friend:accept-request', async (_event, requestId) => {
    try {
      if (!friendManager) {
        throw new Error('好友管理器未初始化');
      }

      return await friendManager.acceptFriendRequest(requestId);
    } catch (error) {
      console.error('[Social IPC] 接受好友请求失败:', error);
      throw error;
    }
  });

  /**
   * 拒绝好友请求
   * Channel: 'friend:reject-request'
   */
  ipcMain.handle('friend:reject-request', async (_event, requestId) => {
    try {
      if (!friendManager) {
        throw new Error('好友管理器未初始化');
      }

      return await friendManager.rejectFriendRequest(requestId);
    } catch (error) {
      console.error('[Social IPC] 拒绝好友请求失败:', error);
      throw error;
    }
  });

  /**
   * 获取待处理的好友请求
   * Channel: 'friend:get-pending-requests'
   */
  ipcMain.handle('friend:get-pending-requests', async () => {
    try {
      if (!friendManager) {
        return [];
      }

      return await friendManager.getPendingFriendRequests();
    } catch (error) {
      console.error('[Social IPC] 获取待处理好友请求失败:', error);
      return [];
    }
  });

  /**
   * 获取好友列表（可按分组过滤）
   * Channel: 'friend:get-friends'
   */
  ipcMain.handle('friend:get-friends', async (_event, groupName) => {
    try {
      if (!friendManager) {
        return [];
      }

      return await friendManager.getFriends(groupName);
    } catch (error) {
      console.error('[Social IPC] 获取好友列表失败:', error);
      return [];
    }
  });

  /**
   * 删除好友
   * Channel: 'friend:remove'
   */
  ipcMain.handle('friend:remove', async (_event, friendDid) => {
    try {
      if (!friendManager) {
        throw new Error('好友管理器未初始化');
      }

      return await friendManager.removeFriend(friendDid);
    } catch (error) {
      console.error('[Social IPC] 删除好友失败:', error);
      throw error;
    }
  });

  /**
   * 更新好友备注
   * Channel: 'friend:update-nickname'
   */
  ipcMain.handle('friend:update-nickname', async (_event, friendDid, nickname) => {
    try {
      if (!friendManager) {
        throw new Error('好友管理器未初始化');
      }

      return await friendManager.updateFriendNickname(friendDid, nickname);
    } catch (error) {
      console.error('[Social IPC] 更新好友备注失败:', error);
      throw error;
    }
  });

  /**
   * 更新好友分组
   * Channel: 'friend:update-group'
   */
  ipcMain.handle('friend:update-group', async (_event, friendDid, groupName) => {
    try {
      if (!friendManager) {
        throw new Error('好友管理器未初始化');
      }

      return await friendManager.updateFriendGroup(friendDid, groupName);
    } catch (error) {
      console.error('[Social IPC] 更新好友分组失败:', error);
      throw error;
    }
  });

  /**
   * 获取好友统计信息
   * Channel: 'friend:get-statistics'
   */
  ipcMain.handle('friend:get-statistics', async () => {
    try {
      if (!friendManager) {
        return { total: 0, online: 0, offline: 0, byGroup: {} };
      }

      return await friendManager.getStatistics();
    } catch (error) {
      console.error('[Social IPC] 获取好友统计失败:', error);
      return { total: 0, online: 0, offline: 0, byGroup: {} };
    }
  });

  // ============================================================
  // 动态管理 (Post/Feed Management) - 10 handlers
  // ============================================================

  /**
   * 发布动态
   * Channel: 'post:create'
   */
  ipcMain.handle('post:create', async (_event, options) => {
    try {
      if (!postManager) {
        throw new Error('动态管理器未初始化');
      }

      return await postManager.createPost(options);
    } catch (error) {
      console.error('[Social IPC] 发布动态失败:', error);
      throw error;
    }
  });

  /**
   * 获取动态流
   * Channel: 'post:get-feed'
   */
  ipcMain.handle('post:get-feed', async (_event, options) => {
    try {
      if (!postManager) {
        return [];
      }

      return await postManager.getFeed(options);
    } catch (error) {
      console.error('[Social IPC] 获取动态流失败:', error);
      throw error;
    }
  });

  /**
   * 获取单条动态
   * Channel: 'post:get'
   */
  ipcMain.handle('post:get', async (_event, postId) => {
    try {
      if (!postManager) {
        return null;
      }

      return await postManager.getPost(postId);
    } catch (error) {
      console.error('[Social IPC] 获取动态失败:', error);
      throw error;
    }
  });

  /**
   * 删除动态
   * Channel: 'post:delete'
   */
  ipcMain.handle('post:delete', async (_event, postId) => {
    try {
      if (!postManager) {
        throw new Error('动态管理器未初始化');
      }

      return await postManager.deletePost(postId);
    } catch (error) {
      console.error('[Social IPC] 删除动态失败:', error);
      throw error;
    }
  });

  /**
   * 点赞动态
   * Channel: 'post:like'
   */
  ipcMain.handle('post:like', async (_event, postId) => {
    try {
      if (!postManager) {
        throw new Error('动态管理器未初始化');
      }

      return await postManager.likePost(postId);
    } catch (error) {
      console.error('[Social IPC] 点赞失败:', error);
      throw error;
    }
  });

  /**
   * 取消点赞
   * Channel: 'post:unlike'
   */
  ipcMain.handle('post:unlike', async (_event, postId) => {
    try {
      if (!postManager) {
        throw new Error('动态管理器未初始化');
      }

      return await postManager.unlikePost(postId);
    } catch (error) {
      console.error('[Social IPC] 取消点赞失败:', error);
      throw error;
    }
  });

  /**
   * 获取点赞列表
   * Channel: 'post:get-likes'
   */
  ipcMain.handle('post:get-likes', async (_event, postId) => {
    try {
      if (!postManager) {
        return [];
      }

      return await postManager.getLikes(postId);
    } catch (error) {
      console.error('[Social IPC] 获取点赞列表失败:', error);
      return [];
    }
  });

  /**
   * 添加评论
   * Channel: 'post:add-comment'
   */
  ipcMain.handle('post:add-comment', async (_event, postId, content, parentId) => {
    try {
      if (!postManager) {
        throw new Error('动态管理器未初始化');
      }

      return await postManager.addComment(postId, content, parentId);
    } catch (error) {
      console.error('[Social IPC] 添加评论失败:', error);
      throw error;
    }
  });

  /**
   * 获取评论列表
   * Channel: 'post:get-comments'
   */
  ipcMain.handle('post:get-comments', async (_event, postId) => {
    try {
      if (!postManager) {
        return [];
      }

      return await postManager.getComments(postId);
    } catch (error) {
      console.error('[Social IPC] 获取评论列表失败:', error);
      return [];
    }
  });

  /**
   * 删除评论
   * Channel: 'post:delete-comment'
   */
  ipcMain.handle('post:delete-comment', async (_event, commentId) => {
    try {
      if (!postManager) {
        throw new Error('动态管理器未初始化');
      }

      return await postManager.deleteComment(commentId);
    } catch (error) {
      console.error('[Social IPC] 删除评论失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 聊天会话管理 (Chat/Messaging) - 5 handlers
  // ============================================================

  /**
   * 获取聊天会话列表
   * Channel: 'chat:get-sessions'
   */
  ipcMain.handle('chat:get-sessions', async () => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }
      const sessions = database.db
        .prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC')
        .all();
      return sessions;
    } catch (error) {
      console.error('[Social IPC] 获取聊天会话列表失败:', error);
      throw error;
    }
  });

  /**
   * 获取聊天消息
   * Channel: 'chat:get-messages'
   */
  ipcMain.handle('chat:get-messages', async (_event, sessionId, limit = 50, offset = 0) => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }
      const messages = database.db
        .prepare(
          'SELECT * FROM p2p_chat_messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
        )
        .all(sessionId, limit, offset);
      return messages;
    } catch (error) {
      console.error('[Social IPC] 获取聊天消息失败:', error);
      throw error;
    }
  });

  /**
   * 保存聊天消息
   * Channel: 'chat:save-message'
   */
  ipcMain.handle('chat:save-message', async (_event, message) => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }

      // 保存消息
      database.db.prepare(`
        INSERT INTO p2p_chat_messages (
          id, session_id, sender_did, receiver_did, content,
          message_type, file_path, encrypted, status, device_id, timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.id,
        message.sessionId,
        message.senderDid,
        message.receiverDid,
        message.content,
        message.messageType || 'text',
        message.filePath || null,
        message.encrypted !== undefined ? message.encrypted : 1,
        message.status || 'sent',
        message.deviceId || null,
        message.timestamp || Date.now()
      );

      // 更新会话
      const session = database.db
        .prepare('SELECT * FROM chat_sessions WHERE id = ?')
        .get(message.sessionId);

      if (session) {
        database.db.prepare(`
          UPDATE chat_sessions
          SET last_message = ?, last_message_time = ?, updated_at = ?
          WHERE id = ?
        `).run(
          message.content,
          message.timestamp || Date.now(),
          Date.now(),
          message.sessionId
        );
      } else {
        // 创建新会话
        database.db.prepare(`
          INSERT INTO chat_sessions (
            id, participant_did, friend_nickname, last_message,
            last_message_time, unread_count, is_pinned, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          message.sessionId,
          message.senderDid === message.receiverDid ? message.senderDid : message.receiverDid,
          null,
          message.content,
          message.timestamp || Date.now(),
          0,
          0,
          Date.now(),
          Date.now()
        );
      }

      database.saveToFile();
      return { success: true };
    } catch (error) {
      console.error('[Social IPC] 保存消息失败:', error);
      throw error;
    }
  });

  /**
   * 更新消息状态
   * Channel: 'chat:update-message-status'
   */
  ipcMain.handle('chat:update-message-status', async (_event, messageId, status) => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }
      database.db.prepare('UPDATE p2p_chat_messages SET status = ? WHERE id = ?').run(status, messageId);
      database.saveToFile();
      return { success: true };
    } catch (error) {
      console.error('[Social IPC] 更新消息状态失败:', error);
      throw error;
    }
  });

  /**
   * 标记会话为已读
   * Channel: 'chat:mark-as-read'
   */
  ipcMain.handle('chat:mark-as-read', async (_event, sessionId) => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }
      database.db.prepare('UPDATE chat_sessions SET unread_count = 0 WHERE id = ?').run(sessionId);
      database.saveToFile();
      return { success: true };
    } catch (error) {
      console.error('[Social IPC] 标记已读失败:', error);
      throw error;
    }
  });

  console.log('[Social IPC] ✓ All Social IPC handlers registered successfully (33 handlers)');
}

module.exports = {
  registerSocialIPC
};
