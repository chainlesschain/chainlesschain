/**
 * Social IPC 处理器
 * 负责处理社交网络相关的前后端通信
 *
 * @module social-ipc
 * @description 提供联系人管理、好友关系、动态发布、聊天消息、群聊等社交功能的 IPC 接口
 */

const { ipcMain } = require('electron');

/**
 * 注册所有 Social IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.contactManager - 联系人管理器
 * @param {Object} dependencies.friendManager - 好友管理器
 * @param {Object} dependencies.postManager - 动态管理器
 * @param {Object} dependencies.database - 数据库管理器（用于聊天功能）
 * @param {Object} dependencies.groupChatManager - 群聊管理器
 */
function registerSocialIPC({ contactManager, friendManager, postManager, database, groupChatManager }) {
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
      console.error('[Social IPC] 获取联系人列表失败:', error);
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
      console.error('[Social IPC] 获取统计信息失败:', error);
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
        console.warn('[Social IPC] 数据库未初始化，返回空数组');
        return [];
      }
      // 使用 DatabaseManager 的 prepare 方法，它有更好的错误处理
      const stmt = database.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
      const sessions = stmt.all();
      return sessions || [];
    } catch (error) {
      console.error('[Social IPC] 获取聊天会话列表失败:', error);
      // 返回空数组而不是抛出错误，防止前端崩溃
      return [];
    }
  });

  /**
   * 获取聊天消息
   * Channel: 'chat:get-messages'
   */
  ipcMain.handle('chat:get-messages', async (_event, sessionId, limit = 50, offset = 0) => {
    try {
      if (!database || !database.db) {
        console.warn('[Social IPC] 数据库未初始化，返回空数组');
        return [];
      }
      const stmt = database.prepare(
        'SELECT * FROM p2p_chat_messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
      );
      const messages = stmt.all(sessionId, limit, offset);
      return messages || [];
    } catch (error) {
      console.error('[Social IPC] 获取聊天消息失败:', error);
      return [];
    }
  });

  /**
   * 保存聊天消息
   * Channel: 'chat:save-message'
   */
  ipcMain.handle('chat:save-message', async (_event, message) => {
    try {
      if (!database || !database.db) {
        console.warn('[Social IPC] 数据库未初始化');
        return { success: false, error: '数据库未初始化' };
      }

      // 保存消息
      const insertStmt = database.prepare(`
        INSERT INTO p2p_chat_messages (
          id, session_id, sender_did, receiver_did, content,
          message_type, file_path, encrypted, status, device_id, timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(
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
      const sessionStmt = database.prepare('SELECT * FROM chat_sessions WHERE id = ?');
      const session = sessionStmt.get(message.sessionId);

      if (session) {
        const updateStmt = database.prepare(`
          UPDATE chat_sessions
          SET last_message = ?, last_message_time = ?, updated_at = ?
          WHERE id = ?
        `);
        updateStmt.run(
          message.content,
          message.timestamp || Date.now(),
          Date.now(),
          message.sessionId
        );
      } else {
        // 创建新会话
        const createStmt = database.prepare(`
          INSERT INTO chat_sessions (
            id, participant_did, friend_nickname, last_message,
            last_message_time, unread_count, is_pinned, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        createStmt.run(
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
      return { success: false, error: error.message };
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

  // ============================================================
  // 消息表情回应 (Message Reactions) - 4 handlers
  // ============================================================

  /**
   * 添加消息表情回应
   * Channel: 'chat:add-reaction'
   */
  ipcMain.handle('chat:add-reaction', async (_event, { messageId, userDid, emoji }) => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }

      const { v4: uuidv4 } = require('uuid');
      const id = uuidv4();
      const now = Date.now();

      const stmt = database.prepare(`
        INSERT OR REPLACE INTO message_reactions (id, message_id, user_did, emoji, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(id, messageId, userDid, emoji, now);
      database.saveToFile();

      return { success: true, reaction: { id, messageId, userDid, emoji, createdAt: now } };
    } catch (error) {
      console.error('[Social IPC] 添加表情回应失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 移除消息表情回应
   * Channel: 'chat:remove-reaction'
   */
  ipcMain.handle('chat:remove-reaction', async (_event, { messageId, userDid, emoji }) => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }

      const stmt = database.prepare(`
        DELETE FROM message_reactions
        WHERE message_id = ? AND user_did = ? AND emoji = ?
      `);
      stmt.run(messageId, userDid, emoji);
      database.saveToFile();

      return { success: true };
    } catch (error) {
      console.error('[Social IPC] 移除表情回应失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取消息的所有表情回应
   * Channel: 'chat:get-reactions'
   */
  ipcMain.handle('chat:get-reactions', async (_event, messageId) => {
    try {
      if (!database || !database.db) {
        return { success: true, reactions: [] };
      }

      const stmt = database.prepare(`
        SELECT * FROM message_reactions
        WHERE message_id = ?
        ORDER BY created_at ASC
      `);
      const reactions = stmt.all(messageId);

      return { success: true, reactions: reactions || [] };
    } catch (error) {
      console.error('[Social IPC] 获取表情回应失败:', error);
      return { success: false, reactions: [], error: error.message };
    }
  });

  /**
   * 获取消息的表情回应统计
   * Channel: 'chat:get-reaction-stats'
   */
  ipcMain.handle('chat:get-reaction-stats', async (_event, messageId) => {
    try {
      if (!database || !database.db) {
        return { success: true, stats: {} };
      }

      const stmt = database.prepare(`
        SELECT emoji, COUNT(*) as count, GROUP_CONCAT(user_did) as users
        FROM message_reactions
        WHERE message_id = ?
        GROUP BY emoji
        ORDER BY count DESC
      `);
      const rows = stmt.all(messageId);

      const stats = {};
      rows.forEach(row => {
        stats[row.emoji] = {
          count: row.count,
          users: row.users ? row.users.split(',') : []
        };
      });

      return { success: true, stats };
    } catch (error) {
      console.error('[Social IPC] 获取表情统计失败:', error);
      return { success: false, stats: {}, error: error.message };
    }
  });

  // ============================================================
  // 群聊管理 (Group Chat Management) - 15 handlers
  // ============================================================

  /**
   * 创建群聊
   * Channel: 'group:create'
   */
  ipcMain.handle('group:create', async (_event, options) => {
    try {
      if (!groupChatManager) {
        throw new Error('群聊管理器未初始化');
      }
      return await groupChatManager.createGroup(options);
    } catch (error) {
      console.error('[Social IPC] 创建群聊失败:', error);
      throw error;
    }
  });

  /**
   * 获取群聊列表
   * Channel: 'group:get-list'
   */
  ipcMain.handle('group:get-list', async () => {
    try {
      if (!groupChatManager) {
        return [];
      }
      return await groupChatManager.getGroups();
    } catch (error) {
      console.error('[Social IPC] 获取群聊列表失败:', error);
      return [];
    }
  });

  /**
   * 获取群聊详情
   * Channel: 'group:get-details'
   */
  ipcMain.handle('group:get-details', async (_event, groupId) => {
    try {
      if (!groupChatManager) {
        throw new Error('群聊管理器未初始化');
      }
      return await groupChatManager.getGroupDetails(groupId);
    } catch (error) {
      console.error('[Social IPC] 获取群聊详情失败:', error);
      throw error;
    }
  });

  /**
   * 更新群信息
   * Channel: 'group:update-info'
   */
  ipcMain.handle('group:update-info', async (_event, groupId, updates) => {
    try {
      if (!groupChatManager) {
        throw new Error('群聊管理器未初始化');
      }
      return await groupChatManager.updateGroupInfo(groupId, updates);
    } catch (error) {
      console.error('[Social IPC] 更新群信息失败:', error);
      throw error;
    }
  });

  /**
   * 添加群成员
   * Channel: 'group:add-member'
   */
  ipcMain.handle('group:add-member', async (_event, groupId, memberDid, role) => {
    try {
      if (!groupChatManager) {
        throw new Error('群聊管理器未初始化');
      }
      return await groupChatManager.addGroupMember(groupId, memberDid, role);
    } catch (error) {
      console.error('[Social IPC] 添加群成员失败:', error);
      throw error;
    }
  });

  /**
   * 移除群成员
   * Channel: 'group:remove-member'
   */
  ipcMain.handle('group:remove-member', async (_event, groupId, memberDid) => {
    try {
      if (!groupChatManager) {
        throw new Error('群聊管理器未初始化');
      }
      return await groupChatManager.removeGroupMember(groupId, memberDid);
    } catch (error) {
      console.error('[Social IPC] 移除群成员失败:', error);
      throw error;
    }
  });

  /**
   * 退出群聊
   * Channel: 'group:leave'
   */
  ipcMain.handle('group:leave', async (_event, groupId) => {
    try {
      if (!groupChatManager) {
        throw new Error('群聊管理器未初始化');
      }
      return await groupChatManager.leaveGroup(groupId);
    } catch (error) {
      console.error('[Social IPC] 退出群聊失败:', error);
      throw error;
    }
  });

  /**
   * 解散群聊
   * Channel: 'group:dismiss'
   */
  ipcMain.handle('group:dismiss', async (_event, groupId) => {
    try {
      if (!groupChatManager) {
        throw new Error('群聊管理器未初始化');
      }
      return await groupChatManager.dismissGroup(groupId);
    } catch (error) {
      console.error('[Social IPC] 解散群聊失败:', error);
      throw error;
    }
  });

  /**
   * 发送群消息
   * Channel: 'group:send-message'
   */
  ipcMain.handle('group:send-message', async (_event, groupId, content, options) => {
    try {
      if (!groupChatManager) {
        throw new Error('群聊管理器未初始化');
      }
      return await groupChatManager.sendGroupMessage(groupId, content, options);
    } catch (error) {
      console.error('[Social IPC] 发送群消息失败:', error);
      throw error;
    }
  });

  /**
   * 获取群消息
   * Channel: 'group:get-messages'
   */
  ipcMain.handle('group:get-messages', async (_event, groupId, limit, offset) => {
    try {
      if (!groupChatManager) {
        return [];
      }
      return await groupChatManager.getGroupMessages(groupId, limit, offset);
    } catch (error) {
      console.error('[Social IPC] 获取群消息失败:', error);
      return [];
    }
  });

  /**
   * 标记群消息为已读
   * Channel: 'group:mark-message-read'
   */
  ipcMain.handle('group:mark-message-read', async (_event, messageId, groupId) => {
    try {
      if (!groupChatManager) {
        return { success: false };
      }
      return await groupChatManager.markMessageAsRead(messageId, groupId);
    } catch (error) {
      console.error('[Social IPC] 标记群消息已读失败:', error);
      return { success: false };
    }
  });

  /**
   * 邀请成员加入群聊
   * Channel: 'group:invite-member'
   */
  ipcMain.handle('group:invite-member', async (_event, groupId, inviteeDid, message) => {
    try {
      if (!groupChatManager) {
        throw new Error('群聊管理器未初始化');
      }

      // 创建邀请记录
      const invitationId = require('uuid').v4();
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
        message || '',
        'pending',
        now,
        expiresAt
      );

      database.saveToFile();

      // 通过P2P发送邀请
      if (groupChatManager.p2pManager) {
        await groupChatManager.p2pManager.sendMessage(inviteeDid, {
          type: 'group:invitation',
          invitationId,
          groupId,
          inviterDid: groupChatManager.currentUserDid,
          message
        });
      }

      return { success: true, invitationId };
    } catch (error) {
      console.error('[Social IPC] 邀请成员失败:', error);
      throw error;
    }
  });

  /**
   * 接受群聊邀请
   * Channel: 'group:accept-invitation'
   */
  ipcMain.handle('group:accept-invitation', async (_event, invitationId) => {
    try {
      if (!groupChatManager || !database) {
        throw new Error('群聊管理器或数据库未初始化');
      }

      // 获取邀请信息
      const inviteStmt = database.prepare('SELECT * FROM group_invitations WHERE id = ?');
      const invitation = inviteStmt.get(invitationId);

      if (!invitation) {
        throw new Error('邀请不存在');
      }

      if (invitation.status !== 'pending') {
        throw new Error('邀请已处理');
      }

      if (invitation.expires_at && invitation.expires_at < Date.now()) {
        throw new Error('邀请已过期');
      }

      // 添加为群成员
      await groupChatManager.addGroupMember(invitation.group_id, invitation.invitee_did, 'member');

      // 更新邀请状态
      const updateStmt = database.prepare('UPDATE group_invitations SET status = ? WHERE id = ?');
      updateStmt.run('accepted', invitationId);

      database.saveToFile();

      return { success: true, groupId: invitation.group_id };
    } catch (error) {
      console.error('[Social IPC] 接受邀请失败:', error);
      throw error;
    }
  });

  /**
   * 拒绝群聊邀请
   * Channel: 'group:reject-invitation'
   */
  ipcMain.handle('group:reject-invitation', async (_event, invitationId) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }

      const stmt = database.prepare('UPDATE group_invitations SET status = ? WHERE id = ?');
      stmt.run('rejected', invitationId);
      database.saveToFile();

      return { success: true };
    } catch (error) {
      console.error('[Social IPC] 拒绝邀请失败:', error);
      throw error;
    }
  });

  /**
   * 获取群聊邀请列表
   * Channel: 'group:get-invitations'
   */
  ipcMain.handle('group:get-invitations', async (_event, inviteeDid) => {
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
      console.error('[Social IPC] 获取邀请列表失败:', error);
      return [];
    }
  });

  // ============================================================
  // 文件传输 (File Transfer in Chat) - 4 handlers
  // ============================================================

  /**
   * 发送文件消息（图片/文件）
   * Channel: 'chat:send-file'
   */
  ipcMain.handle('chat:send-file', async (_event, { sessionId, filePath, messageType }) => {
    try {
      const { dialog } = require('electron');
      const path = require('path');
      const fs = require('fs');

      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }

      // 如果没有提供文件路径，打开文件选择对话框
      if (!filePath) {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: messageType === 'image'
            ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
            : [{ name: 'All Files', extensions: ['*'] }]
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, error: '未选择文件' };
        }

        filePath = result.filePaths[0];
      }

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        throw new Error('文件不存在');
      }

      // 获取文件信息
      const stats = fs.statSync(filePath);
      const fileName = path.basename(filePath);
      const fileSize = stats.size;

      // 获取会话信息
      const sessionStmt = database.prepare('SELECT * FROM chat_sessions WHERE id = ?');
      const session = sessionStmt.get(sessionId);

      if (!session) {
        throw new Error('会话不存在');
      }

      // 复制文件到应用数据目录
      const { app } = require('electron');
      const uploadsDir = path.join(app.getPath('userData'), 'uploads', 'chat');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const timestamp = Date.now();
      const fileExt = path.extname(fileName);
      const newFileName = `${timestamp}-${Math.random().toString(36).substring(7)}${fileExt}`;
      const destPath = path.join(uploadsDir, newFileName);

      fs.copyFileSync(filePath, destPath);

      // 生成消息ID
      const messageId = `msg-${timestamp}-${Math.random().toString(36).substring(7)}`;

      // 获取当前用户DID
      const currentUserDid = session.participant_did; // 这里需要从实际的用户身份获取

      // 保存消息到数据库
      const insertStmt = database.prepare(`
        INSERT INTO p2p_chat_messages (
          id, session_id, sender_did, receiver_did, content,
          message_type, file_path, file_size, encrypted, status, timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        messageId,
        sessionId,
        currentUserDid,
        session.participant_did,
        fileName,
        messageType || 'file',
        destPath,
        fileSize,
        1,
        'sent',
        timestamp
      );

      // 更新会话
      const updateStmt = database.prepare(`
        UPDATE chat_sessions
        SET last_message = ?, last_message_time = ?, updated_at = ?
        WHERE id = ?
      `);

      const lastMessage = messageType === 'image' ? '[图片]' : `[文件] ${fileName}`;
      updateStmt.run(lastMessage, timestamp, timestamp, sessionId);

      database.saveToFile();

      // 通过P2P发送文件（如果P2P管理器可用）
      if (global.mainApp && global.mainApp.p2pEnhancedManager && global.mainApp.p2pEnhancedManager.fileTransferManager) {
        try {
          console.log('[Social IPC] 开始P2P文件传输...');

          // 使用FileTransferManager进行P2P传输
          const transferId = await global.mainApp.p2pEnhancedManager.fileTransferManager.uploadFile(
            session.participant_did,
            destPath,
            {
              messageId,
              sessionId,
              fileName,
              fileSize
            }
          );

          console.log('[Social IPC] ✅ P2P文件传输已启动:', transferId);

          // 更新消息状态为传输中
          const updateTransferStmt = database.prepare(`
            UPDATE p2p_chat_messages
            SET transfer_id = ?, status = 'transferring'
            WHERE id = ?
          `);
          updateTransferStmt.run(transferId, messageId);
          database.saveToFile();

        } catch (error) {
          console.error('[Social IPC] P2P文件传输失败:', error);
          // 即使P2P传输失败，消息仍然保存在本地
        }
      }

      return {
        success: true,
        message: {
          id: messageId,
          sessionId,
          senderDid: currentUserDid,
          receiverDid: session.participant_did,
          content: fileName,
          messageType: messageType || 'file',
          filePath: destPath,
          fileSize,
          timestamp
        }
      };
    } catch (error) {
      console.error('[Social IPC] 发送文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 选择并发送图片
   * Channel: 'chat:select-and-send-image'
   */
  ipcMain.handle('chat:select-and-send-image', async (_event, { sessionId }) => {
    return ipcMain.emit('chat:send-file', _event, { sessionId, messageType: 'image' });
  });

  /**
   * 选择并发送文件
   * Channel: 'chat:select-and-send-file'
   */
  ipcMain.handle('chat:select-and-send-file', async (_event, { sessionId }) => {
    return ipcMain.emit('chat:send-file', _event, { sessionId, messageType: 'file' });
  });

  /**
   * 下载文件
   * Channel: 'chat:download-file'
   */
  ipcMain.handle('chat:download-file', async (_event, { messageId, savePath }) => {
    try {
      const { dialog } = require('electron');
      const path = require('path');
      const fs = require('fs');

      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }

      // 获取消息信息
      const stmt = database.prepare('SELECT * FROM p2p_chat_messages WHERE id = ?');
      const message = stmt.get(messageId);

      if (!message) {
        throw new Error('消息不存在');
      }

      if (!message.file_path) {
        throw new Error('消息不包含文件');
      }

      // 如果没有提供保存路径，打开保存对话框
      if (!savePath) {
        const result = await dialog.showSaveDialog({
          defaultPath: message.content,
          filters: [{ name: 'All Files', extensions: ['*'] }]
        });

        if (result.canceled || !result.filePath) {
          return { success: false, error: '未选择保存位置' };
        }

        savePath = result.filePath;
      }

      // 复制文件
      fs.copyFileSync(message.file_path, savePath);

      return {
        success: true,
        filePath: savePath
      };
    } catch (error) {
      console.error('[Social IPC] 下载文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 转发消息
   * Channel: 'chat:forward-message'
   */
  ipcMain.handle('chat:forward-message', async (_event, { messageId, targetSessionIds }) => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }

      // 获取原始消息
      const originalStmt = database.prepare('SELECT * FROM p2p_chat_messages WHERE id = ?');
      const originalMessage = originalStmt.get(messageId);

      if (!originalMessage) {
        throw new Error('原始消息不存在');
      }

      // 更新原始消息的转发计数
      const updateStmt = database.prepare(`
        UPDATE p2p_chat_messages
        SET forward_count = forward_count + ?
        WHERE id = ?
      `);
      updateStmt.run(targetSessionIds.length, messageId);

      const forwardedMessages = [];

      // 为每个目标会话创建转发消息
      for (const targetSessionId of targetSessionIds) {
        // 获取目标会话信息
        const sessionStmt = database.prepare('SELECT * FROM chat_sessions WHERE id = ?');
        const session = sessionStmt.get(targetSessionId);

        if (!session) {
          console.warn(`[Social IPC] 会话不存在: ${targetSessionId}`);
          continue;
        }

        // 生成新消息ID
        const newMessageId = `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const timestamp = Date.now();

        // 如果是文件消息，需要复制文件
        let newFilePath = null;
        if (originalMessage.file_path) {
          const path = require('path');
          const fs = require('fs');
          const { app } = require('electron');

          const uploadsDir = path.join(app.getPath('userData'), 'uploads', 'chat');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }

          const fileExt = path.extname(originalMessage.file_path);
          const newFileName = `${timestamp}-${Math.random().toString(36).substring(7)}${fileExt}`;
          newFilePath = path.join(uploadsDir, newFileName);

          // 复制文件
          fs.copyFileSync(originalMessage.file_path, newFilePath);
        }

        // 插入转发消息
        const insertStmt = database.prepare(`
          INSERT INTO p2p_chat_messages (
            id, session_id, sender_did, receiver_did, content,
            message_type, file_path, file_size, encrypted, status,
            device_id, timestamp, forwarded_from_id, forward_count
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        insertStmt.run(
          newMessageId,
          targetSessionId,
          originalMessage.sender_did, // 保持原发送者
          session.participant_did,
          originalMessage.content,
          originalMessage.message_type,
          newFilePath || originalMessage.file_path,
          originalMessage.file_size,
          originalMessage.encrypted,
          'sent',
          originalMessage.device_id,
          timestamp,
          messageId, // 记录原始消息ID
          0 // 新消息的转发计数为0
        );

        // 更新会话
        const updateSessionStmt = database.prepare(`
          UPDATE chat_sessions
          SET last_message = ?, last_message_time = ?, updated_at = ?
          WHERE id = ?
        `);

        const lastMessage = originalMessage.message_type === 'text'
          ? `[转发] ${originalMessage.content}`
          : `[转发] ${originalMessage.message_type === 'image' ? '[图片]' : '[文件]'}`;

        updateSessionStmt.run(lastMessage, timestamp, timestamp, targetSessionId);

        forwardedMessages.push({
          id: newMessageId,
          sessionId: targetSessionId,
          originalMessageId: messageId
        });
      }

      database.saveToFile();

      return {
        success: true,
        forwardedMessages,
        count: forwardedMessages.length
      };
    } catch (error) {
      console.error('[Social IPC] 转发消息失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取文件传输进度
   * Channel: 'chat:get-transfer-progress'
   */
  ipcMain.handle('chat:get-transfer-progress', async (_event, { transferId }) => {
    try {
      if (!global.mainApp || !global.mainApp.p2pEnhancedManager || !global.mainApp.p2pEnhancedManager.fileTransferManager) {
        return { success: false, error: 'P2P文件传输管理器未初始化' };
      }

      const progress = global.mainApp.p2pEnhancedManager.fileTransferManager.getProgress(transferId);

      if (!progress) {
        return { success: false, error: '传输任务不存在' };
      }

      return {
        success: true,
        progress
      };
    } catch (error) {
      console.error('[Social IPC] 获取传输进度失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 取消文件传输
   * Channel: 'chat:cancel-transfer'
   */
  ipcMain.handle('chat:cancel-transfer', async (_event, { transferId }) => {
    try {
      if (!global.mainApp || !global.mainApp.p2pEnhancedManager || !global.mainApp.p2pEnhancedManager.fileTransferManager) {
        return { success: false, error: 'P2P文件传输管理器未初始化' };
      }

      await global.mainApp.p2pEnhancedManager.fileTransferManager.cancelTransfer(transferId);

      return { success: true };
    } catch (error) {
      console.error('[Social IPC] 取消传输失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 接受文件传输
   * Channel: 'chat:accept-transfer'
   */
  ipcMain.handle('chat:accept-transfer', async (_event, { transferId, savePath }) => {
    try {
      if (!global.mainApp || !global.mainApp.p2pEnhancedManager || !global.mainApp.p2pEnhancedManager.fileTransferManager) {
        return { success: false, error: 'P2P文件传输管理器未初始化' };
      }

      const { dialog } = require('electron');
      const path = require('path');

      // 如果没有提供保存路径,打开保存对话框
      if (!savePath) {
        const downloadTask = global.mainApp.p2pEnhancedManager.fileTransferManager.downloads.get(transferId);
        if (!downloadTask) {
          return { success: false, error: '传输任务不存在' };
        }

        const result = await dialog.showSaveDialog({
          defaultPath: downloadTask.fileName,
          filters: [{ name: 'All Files', extensions: ['*'] }]
        });

        if (result.canceled || !result.filePath) {
          return { success: false, error: '未选择保存位置' };
        }

        savePath = result.filePath;
      }

      // 开始下载
      const filePath = await global.mainApp.p2pEnhancedManager.fileTransferManager.downloadFile(
        null, // peerId will be retrieved from download task
        transferId,
        savePath
      );

      return {
        success: true,
        filePath
      };
    } catch (error) {
      console.error('[Social IPC] 接受传输失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 语音消息播放 (Voice Message Playback) - 1 handler
  // ============================================================

  /**
   * 播放语音消息
   * Channel: 'chat:play-voice-message'
   */
  ipcMain.handle('chat:play-voice-message', async (_event, { messageId }) => {
    try {
      if (!database || !database.db) {
        return { success: false, error: '数据库未初始化' };
      }

      // 获取消息信息
      const stmt = database.prepare('SELECT * FROM p2p_chat_messages WHERE id = ?');
      const message = stmt.get(messageId);

      if (!message) {
        return { success: false, error: '消息不存在' };
      }

      if (message.message_type !== 'voice') {
        return { success: false, error: '不是语音消息' };
      }

      if (!message.file_path) {
        return { success: false, error: '语音文件路径不存在' };
      }

      const fs = require('fs');
      if (!fs.existsSync(message.file_path)) {
        return { success: false, error: '语音文件不存在' };
      }

      // 返回文件路径，让前端使用HTML5 Audio API播放
      return {
        success: true,
        filePath: message.file_path,
        duration: message.duration || 0
      };
    } catch (error) {
      console.error('[Social IPC] 播放语音消息失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Social IPC] ✓ All Social IPC handlers registered successfully (57 handlers)');
}

module.exports = {
  registerSocialIPC
};
