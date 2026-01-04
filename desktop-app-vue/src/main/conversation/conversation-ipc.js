/**
 * 对话 IPC 处理器
 * 负责处理所有对话相关的前后端通信
 *
 * @module conversation-ipc
 * @description 提供对话创建、查询、更新、删除等 IPC 接口
 */

/**
 * 注册所有对话 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库实例
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 */
function registerConversationIPC({ database, ipcMain: injectedIpcMain }) {
  // 支持依赖注入，用于测试
  const ipcMain = injectedIpcMain || require('electron').ipcMain;

  console.log('[Conversation IPC] Registering Conversation IPC handlers...');

  // ============================================================
  // 对话查询 (Conversation Query)
  // ============================================================

  /**
   * 根据项目ID获取对话
   * Channel: 'conversation:get-by-project'
   *
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} { success: boolean, data?: Object[], error?: string }
   */
  ipcMain.handle('conversation:get-by-project', async (_event, projectId) => {
    try {
      if (!database) {
        return { success: false, error: '数据库未初始化' };
      }

      if (!projectId) {
        return { success: false, error: '项目ID不能为空' };
      }

      console.log('[Conversation IPC] 查询项目对话:', projectId);

      // 从 conversations 表查询对话元数据
      // 注意：project_conversations 是消息表，不是对话表
      let conversations = [];

      try {
        conversations = database.db.prepare(`
          SELECT * FROM conversations
          WHERE project_id = ?
          ORDER BY created_at DESC
        `).all(projectId);
      } catch (tableError) {
        console.error('[Conversation IPC] 查询对话表失败:', tableError.message);
        conversations = [];
      }

      console.log('[Conversation IPC] 找到对话数量:', conversations.length);
      return { success: true, data: conversations };
    } catch (error) {
      console.error('[Conversation IPC] 查询对话失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取对话详情
   * Channel: 'conversation:get-by-id'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }
   */
  ipcMain.handle('conversation:get-by-id', async (_event, conversationId) => {
    try {
      if (!database) {
        return { success: false, error: '数据库未初始化' };
      }

      if (!conversationId) {
        return { success: false, error: '对话ID不能为空' };
      }

      console.log('[Conversation IPC] 查询对话详情:', conversationId);

      // 从 conversations 表查询对话元数据
      let conversation = null;

      try {
        conversation = database.db.prepare(`
          SELECT * FROM conversations WHERE id = ?
        `).get(conversationId);
      } catch (tableError) {
        console.error('[Conversation IPC] 查询对话详情失败:', tableError.message);
        conversation = null;
      }

      if (!conversation) {
        return { success: false, error: '对话不存在' };
      }

      return { success: true, data: conversation };
    } catch (error) {
      console.error('[Conversation IPC] 查询对话详情失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 创建对话
   * Channel: 'conversation:create'
   *
   * @param {Object} conversationData - 对话数据
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }
   */
  ipcMain.handle('conversation:create', async (_event, conversationData) => {
    try {
      if (!database) {
        return { success: false, error: '数据库未初始化' };
      }

      const {
        id,
        project_id,
        title,
        context_type = 'project',
        context_data = null,
        created_at = Date.now(),
        updated_at = Date.now()
      } = conversationData;

      if (!id) {
        return { success: false, error: '缺少必要参数：id' };
      }

      console.log('[Conversation IPC] 创建对话:', id);

      // 插入对话到 conversations 表
      // 注意：conversations 表没有 messages 列，messages 存储在单独的表中
      database.db.prepare(`
        INSERT INTO conversations (id, project_id, title, context_type, context_data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        project_id || null,
        title || '新对话',
        context_type,
        context_data ? JSON.stringify(context_data) : null,
        created_at,
        updated_at
      );

      const conversationData_result = {
        id,
        project_id: project_id || null,
        title: title || '新对话',
        context_type,
        context_data,
        created_at,
        updated_at
      };

      return { success: true, data: conversationData_result };
    } catch (error) {
      console.error('[Conversation IPC] 创建对话失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新对话
   * Channel: 'conversation:update'
   *
   * @param {string} conversationId - 对话ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle('conversation:update', async (_event, conversationId, updates) => {
    try {
      if (!database) {
        return { success: false, error: '数据库未初始化' };
      }

      if (!conversationId) {
        return { success: false, error: '对话ID不能为空' };
      }

      console.log('[Conversation IPC] 更新对话:', conversationId);

      const { title, context_type, context_data } = updates;
      const updated_at = Date.now();

      // 更新对话元数据
      // 注意：conversations 表没有 messages 列，messages 存储在单独的表中
      database.db.prepare(`
        UPDATE conversations
        SET title = COALESCE(?, title),
            context_type = COALESCE(?, context_type),
            context_data = COALESCE(?, context_data),
            updated_at = ?
        WHERE id = ?
      `).run(
        title || null,
        context_type || null,
        context_data ? JSON.stringify(context_data) : null,
        updated_at,
        conversationId
      );

      return { success: true };
    } catch (error) {
      console.error('[Conversation IPC] 更新对话失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 删除对话
   * Channel: 'conversation:delete'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle('conversation:delete', async (_event, conversationId) => {
    try {
      if (!database) {
        return { success: false, error: '数据库未初始化' };
      }

      if (!conversationId) {
        return { success: false, error: '对话ID不能为空' };
      }

      console.log('[Conversation IPC] 删除对话:', conversationId);

      // 删除对话元数据
      database.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);

      // 注意：相关的消息应该通过外键级联删除或单独处理

      return { success: true };
    } catch (error) {
      console.error('[Conversation IPC] 删除对话失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 创建消息
   * Channel: 'conversation:create-message'
   *
   * @param {Object} messageData - 消息数据
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }
   */
  ipcMain.handle('conversation:create-message', async (_event, messageData) => {
    try {
      if (!database) {
        return { success: false, error: '数据库未初始化' };
      }

      // 确保数据是扁平的，不包含嵌套对象
      const flatData = {
        id: messageData.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        conversation_id: String(messageData.conversation_id || ''),
        role: String(messageData.role || 'user'),
        content: String(messageData.content || ''),
        timestamp: Number(messageData.timestamp || Date.now()),
        tokens: messageData.tokens ? Number(messageData.tokens) : null,
      };

      console.log('[Conversation IPC] 创建消息:', flatData.id);

      // 尝试使用 createMessage 方法
      try {
        if (database.createMessage) {
          const result = await database.createMessage(flatData);
          return { success: true, data: result };
        }
      } catch (methodError) {
        console.warn('[Conversation IPC] createMessage 方法不存在，尝试直接插入:', methodError.message);
      }

      // 如果方法不存在，直接插入数据库
      database.db.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, timestamp, tokens)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(flatData.id, flatData.conversation_id, flatData.role, flatData.content, flatData.timestamp, flatData.tokens);

      return { success: true, data: flatData };
    } catch (error) {
      console.error('[Conversation IPC] 创建消息失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取对话的所有消息
   * Channel: 'conversation:get-messages'
   *
   * @param {string} conversationId - 对话ID
   * @param {Object} options - 查询选项 (offset, limit)
   * @returns {Promise<Object>} { success: boolean, data?: Object[], total?: number, error?: string }
   */
  ipcMain.handle('conversation:get-messages', async (_event, conversationId, options = {}) => {
    try {
      if (!database) {
        return { success: false, error: '数据库未初始化' };
      }

      if (!conversationId) {
        return { success: false, error: '对话ID不能为空' };
      }

      console.log('[Conversation IPC] 获取对话消息:', conversationId);

      const { offset = 0, limit = 100 } = options;

      // 尝试使用 getMessagesByConversation 方法
      try {
        if (database.getMessagesByConversation) {
          const result = await database.getMessagesByConversation(conversationId, options);
          return { success: true, data: result.messages || result, total: result.total || result.length };
        }
      } catch (methodError) {
        console.warn('[Conversation IPC] getMessagesByConversation 方法不存在，尝试直接查询:', methodError.message);
      }

      // 如果方法不存在，直接查询数据库
      const messages = database.db.prepare(`
        SELECT * FROM messages
        WHERE conversation_id = ?
        ORDER BY timestamp ASC
        LIMIT ? OFFSET ?
      `).all(conversationId, limit, offset);

      console.log('[Conversation IPC] 找到消息数量:', messages.length);
      return { success: true, data: messages, total: messages.length };
    } catch (error) {
      console.error('[Conversation IPC] 获取对话消息失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Conversation IPC] Registered 7 conversation handlers');
  console.log('[Conversation IPC] - conversation:get-by-project');
  console.log('[Conversation IPC] - conversation:get-by-id');
  console.log('[Conversation IPC] - conversation:create');
  console.log('[Conversation IPC] - conversation:update');
  console.log('[Conversation IPC] - conversation:delete');
  console.log('[Conversation IPC] - conversation:create-message');
  console.log('[Conversation IPC] - conversation:get-messages');
}

module.exports = { registerConversationIPC };
