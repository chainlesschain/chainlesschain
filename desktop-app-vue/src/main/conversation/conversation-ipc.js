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

      // 查询对话列表（支持两种表结构）
      let conversations = [];

      // 尝试从 conversations 表查询
      try {
        conversations = database.db.prepare(`
          SELECT * FROM conversations
          WHERE project_id = ?
          ORDER BY created_at DESC
        `).all(projectId);

        if (conversations.length === 0) {
          // 如果 conversations 表没有数据，尝试 project_conversations 表
          conversations = database.db.prepare(`
            SELECT * FROM project_conversations
            WHERE project_id = ?
            ORDER BY created_at DESC
          `).all(projectId);
        }
      } catch (tableError) {
        console.warn('[Conversation IPC] 查询对话表失败，尝试其他表:', tableError.message);

        // 如果第一个表不存在，尝试第二个表
        try {
          conversations = database.db.prepare(`
            SELECT * FROM project_conversations
            WHERE project_id = ?
            ORDER BY created_at DESC
          `).all(projectId);
        } catch (secondError) {
          console.error('[Conversation IPC] 所有对话表查询失败:', secondError.message);
          conversations = [];
        }
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

      // 查询对话（支持两种表结构）
      let conversation = null;

      try {
        conversation = database.db.prepare(`
          SELECT * FROM conversations WHERE id = ?
        `).get(conversationId);

        if (!conversation) {
          conversation = database.db.prepare(`
            SELECT * FROM project_conversations WHERE id = ?
          `).get(conversationId);
        }
      } catch (tableError) {
        console.warn('[Conversation IPC] 查询对话详情失败，尝试其他表:', tableError.message);

        try {
          conversation = database.db.prepare(`
            SELECT * FROM project_conversations WHERE id = ?
          `).get(conversationId);
        } catch (secondError) {
          console.error('[Conversation IPC] 所有表查询失败:', secondError.message);
          conversation = null;
        }
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

      const { id, project_id, title, messages = '[]', created_at = Date.now(), updated_at = Date.now() } = conversationData;

      if (!id || !project_id) {
        return { success: false, error: '缺少必要参数：id 或 project_id' };
      }

      console.log('[Conversation IPC] 创建对话:', id);

      // 插入对话（优先使用 conversations 表）
      try {
        database.db.prepare(`
          INSERT INTO conversations (id, project_id, title, messages, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, project_id, title || '新对话', messages, created_at, updated_at);
      } catch (tableError) {
        console.warn('[Conversation IPC] 插入 conversations 表失败，尝试 project_conversations:', tableError.message);

        database.db.prepare(`
          INSERT INTO project_conversations (id, project_id, title, messages, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, project_id, title || '新对话', messages, created_at, updated_at);
      }

      return { success: true, data: { id, project_id, title, messages, created_at, updated_at } };
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

      const { title, messages } = updates;
      const updated_at = Date.now();

      // 更新对话（支持两种表结构）
      try {
        database.db.prepare(`
          UPDATE conversations
          SET title = COALESCE(?, title),
              messages = COALESCE(?, messages),
              updated_at = ?
          WHERE id = ?
        `).run(title, messages, updated_at, conversationId);
      } catch (tableError) {
        console.warn('[Conversation IPC] 更新 conversations 表失败，尝试 project_conversations:', tableError.message);

        database.db.prepare(`
          UPDATE project_conversations
          SET title = COALESCE(?, title),
              messages = COALESCE(?, messages),
              updated_at = ?
          WHERE id = ?
        `).run(title, messages, updated_at, conversationId);
      }

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

      // 删除对话（支持两种表结构）
      try {
        database.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
      } catch (tableError) {
        console.warn('[Conversation IPC] 从 conversations 表删除失败，尝试 project_conversations:', tableError.message);

        database.db.prepare('DELETE FROM project_conversations WHERE id = ?').run(conversationId);
      }

      return { success: true };
    } catch (error) {
      console.error('[Conversation IPC] 删除对话失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Conversation IPC] Registered 5 conversation: handlers');
  console.log('[Conversation IPC] - conversation:get-by-project');
  console.log('[Conversation IPC] - conversation:get-by-id');
  console.log('[Conversation IPC] - conversation:create');
  console.log('[Conversation IPC] - conversation:update');
  console.log('[Conversation IPC] - conversation:delete');
}

module.exports = { registerConversationIPC };
