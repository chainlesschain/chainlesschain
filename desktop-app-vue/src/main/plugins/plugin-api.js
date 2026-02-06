const { logger, createLogger } = require('../utils/logger.js');

/**
 * PluginAPI - 插件API接口层
 *
 * 职责：
 * - 为插件提供安全的API访问
 * - 权限检查和API调用代理
 * - API调用统计和限流
 */

class PluginAPI {
  constructor(pluginId, permissionChecker, context = {}) {
    this.pluginId = pluginId;
    this.permissionChecker = permissionChecker;
    this.context = context; // { database, llmManager, ragManager, etc. }

    // API调用统计
    this.stats = {
      callCount: {},
      lastCalled: {},
      errors: {},
    };

    // 构建API对象
    this.api = this.buildAPI();
  }

  /**
   * 构建插件可访问的API对象
   * @returns {Object} API对象
   */
  buildAPI() {
    return {
      // 数据库API
      database: this.buildDatabaseAPI(),

      // LLM API
      llm: this.buildLLMAPI(),

      // RAG API
      rag: this.buildRAGAPI(),

      // UI API
      ui: this.buildUIAPI(),

      // 文件API
      file: this.buildFileAPI(),

      // 网络API
      network: this.buildNetworkAPI(),

      // 系统API
      system: this.buildSystemAPI(),

      // 存储API（插件专用）
      storage: this.buildStorageAPI(),

      // 工具API
      utils: this.buildUtilsAPI(),

      // 插件信息（只读）
      info: {
        pluginId: this.pluginId,
        version: '1.0.0', // TODO: 从manifest读取
      },
    };
  }

  /**
   * 数据库API
   */
  buildDatabaseAPI() {
    return {
      // 查询笔记
      query: this.createSecureMethod('database:read', async (options) => {
        const { database } = this.context;
        if (!database) {
          throw new Error('数据库服务不可用');
        }

        // 安全的查询方法（限制只能查询笔记）
        return database.searchNotes(options);
      }),

      // 获取单个笔记
      getNote: this.createSecureMethod('database:read', async (noteId) => {
        const { database } = this.context;
        if (!database) {
          throw new Error('数据库服务不可用');
        }

        return database.getNote(noteId);
      }),

      // 创建笔记
      createNote: this.createSecureMethod('database:write', async (noteData) => {
        const { database } = this.context;
        if (!database) {
          throw new Error('数据库服务不可用');
        }

        // 添加插件标记
        const data = {
          ...noteData,
          tags: [...(noteData.tags || []), `plugin:${this.pluginId}`],
        };

        return database.createNote(data);
      }),

      // 更新笔记
      updateNote: this.createSecureMethod('database:write', async (noteId, updates) => {
        const { database } = this.context;
        if (!database) {
          throw new Error('数据库服务不可用');
        }

        return database.updateNote(noteId, updates);
      }),

      // 删除笔记
      deleteNote: this.createSecureMethod('database:delete', async (noteId) => {
        const { database } = this.context;
        if (!database) {
          throw new Error('数据库服务不可用');
        }

        return database.deleteNote(noteId);
      }),
    };
  }

  /**
   * LLM API
   */
  buildLLMAPI() {
    return {
      // 查询LLM
      query: this.createSecureMethod('llm:query', async (prompt, options = {}) => {
        const { llmManager } = this.context;
        if (!llmManager) {
          throw new Error('LLM服务不可用');
        }

        // 限制输入长度
        if (prompt.length > 10000) {
          throw new Error('输入文本过长（最大10000字符）');
        }

        return llmManager.query(prompt, options);
      }),

      // 流式查询
      stream: this.createSecureMethod('llm:stream', async (prompt, onChunk, options = {}) => {
        const { llmManager } = this.context;
        if (!llmManager) {
          throw new Error('LLM服务不可用');
        }

        // 限制输入长度
        if (prompt.length > 10000) {
          throw new Error('输入文本过长（最大10000字符）');
        }

        return llmManager.stream(prompt, onChunk, options);
      }),
    };
  }

  /**
   * RAG API
   */
  buildRAGAPI() {
    return {
      // 搜索
      search: this.createSecureMethod('rag:search', async (query, options = {}) => {
        const { ragManager } = this.context;
        if (!ragManager) {
          throw new Error('RAG服务不可用');
        }

        return ragManager.search(query, options);
      }),

      // 生成嵌入向量
      embed: this.createSecureMethod('rag:embed', async (text) => {
        const { ragManager } = this.context;
        if (!ragManager) {
          throw new Error('RAG服务不可用');
        }

        return ragManager.embed(text);
      }),
    };
  }

  /**
   * UI API
   */
  buildUIAPI() {
    return {
      // 注册组件
      registerComponent: this.createSecureMethod('ui:component', async (componentDef) => {
        logger.info(`[PluginAPI] 注册组件:`, componentDef);

        const { pluginManager } = this.context;
        if (!pluginManager) {
          throw new Error('插件管理器不可用');
        }

        return await pluginManager.handleUIComponentExtension({
          pluginId: this.pluginId,
          config: componentDef,
        });
      }),

      // 注册页面
      registerPage: this.createSecureMethod('ui:page', async (pageDef) => {
        logger.info(`[PluginAPI] 注册页面:`, pageDef);

        const { pluginManager } = this.context;
        if (!pluginManager) {
          throw new Error('插件管理器不可用');
        }

        return await pluginManager.handleUIPageExtension({
          pluginId: this.pluginId,
          config: pageDef,
        });
      }),

      // 注册菜单
      registerMenu: this.createSecureMethod('ui:menu', async (menuDef) => {
        logger.info(`[PluginAPI] 注册菜单:`, menuDef);

        const { pluginManager } = this.context;
        if (!pluginManager) {
          throw new Error('插件管理器不可用');
        }

        return await pluginManager.handleUIMenuExtension({
          pluginId: this.pluginId,
          config: menuDef,
        });
      }),

      // 显示对话框
      showDialog: this.createSecureMethod('ui:dialog', (dialogOptions) => {
        const { dialog } = require('electron');
        return dialog.showMessageBox(dialogOptions);
      }),

      // 显示通知
      showNotification: this.createSecureMethod('ui:notification', (options) => {
        const { Notification } = require('electron');
        const notification = new Notification({
          title: options.title || this.pluginId,
          body: options.body || '',
          icon: options.icon,
        });
        notification.show();
        return { success: true };
      }),

      // 发送消息到渲染进程
      sendToRenderer: this.createSecureMethod('ui:ipc', (channel, data) => {
        const { mainWindow } = this.context;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`plugin:${this.pluginId}:${channel}`, data);
          return { success: true };
        }
        return { success: false, error: '主窗口不可用' };
      }),
    };
  }

  /**
   * 文件API
   */
  buildFileAPI() {
    const fs = require('fs').promises;
    const path = require('path');

    // 插件数据目录（隔离的）
    const { app } = require('electron');
    const pluginDataDir = path.join(app.getPath('userData'), 'plugin-data', this.pluginId);

    return {
      // 读取文件（限制在插件目录内）
      read: this.createSecureMethod('file:read', async (filePath) => {
        const safePath = this.getSafePath(pluginDataDir, filePath);
        return fs.readFile(safePath, 'utf-8');
      }),

      // 写入文件
      write: this.createSecureMethod('file:write', async (filePath, content) => {
        const safePath = this.getSafePath(pluginDataDir, filePath);

        // 确保目录存在
        await fs.mkdir(path.dirname(safePath), { recursive: true });

        return fs.writeFile(safePath, content, 'utf-8');
      }),

      // 删除文件
      delete: this.createSecureMethod('file:delete', async (filePath) => {
        const safePath = this.getSafePath(pluginDataDir, filePath);
        return fs.unlink(safePath);
      }),

      // 列出目录
      list: this.createSecureMethod('file:list', async (dirPath = '') => {
        const safePath = this.getSafePath(pluginDataDir, dirPath);
        return fs.readdir(safePath);
      }),
    };
  }

  /**
   * 网络API
   */
  buildNetworkAPI() {
    return {
      // HTTP请求
      fetch: this.createSecureMethod('network:http', async (url, options = {}) => {
        const fetch = require('node-fetch');

        // 限制只能访问HTTPS
        if (!url.startsWith('https://') && !url.startsWith('http://localhost')) {
          throw new Error('只允许HTTPS请求（或localhost）');
        }

        // 设置超时
        const timeout = Math.min(options.timeout || 30000, 60000);

        return fetch(url, {
          ...options,
          timeout,
        });
      }),
    };
  }

  /**
   * 系统API
   */
  buildSystemAPI() {
    return {
      // 发送通知
      notify: this.createSecureMethod('system:notification', (options) => {
        const { Notification } = require('electron');
        const notification = new Notification({
          title: options.title || 'ChainlessChain插件',
          body: options.body || '',
          ...options,
        });
        notification.show();
        return { success: true };
      }),

      // 访问剪贴板
      clipboard: this.createSecureMethod('system:clipboard', () => {
        const { clipboard } = require('electron');
        return {
          readText: () => clipboard.readText(),
          writeText: (text) => clipboard.writeText(text),
        };
      }),
    };
  }

  /**
   * 存储API（插件专用键值存储）
   */
  buildStorageAPI() {
    return {
      get: this.createSecureMethod('storage:read', async (key) => {
        const { database } = this.context;
        if (!database) {
          throw new Error('数据库服务不可用');
        }

        const stmt = database.db.prepare(
          'SELECT setting_value FROM plugin_settings WHERE plugin_id = ? AND setting_key = ?'
        );
        const row = stmt.get(this.pluginId, key);
        stmt.free();

        return row ? JSON.parse(row.setting_value) : null;
      }),

      set: this.createSecureMethod('storage:write', async (key, value) => {
        const { database } = this.context;
        if (!database) {
          throw new Error('数据库服务不可用');
        }

        const stmt = database.db.prepare(`
          INSERT OR REPLACE INTO plugin_settings (plugin_id, setting_key, setting_value, setting_type, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `);

        stmt.run(
          this.pluginId,
          key,
          JSON.stringify(value),
          typeof value,
          Date.now()
        );
        stmt.free();

        return { success: true };
      }),

      delete: this.createSecureMethod('storage:delete', async (key) => {
        const { database } = this.context;
        if (!database) {
          throw new Error('数据库服务不可用');
        }

        const stmt = database.db.prepare(
          'DELETE FROM plugin_settings WHERE plugin_id = ? AND setting_key = ?'
        );
        stmt.run(this.pluginId, key);
        stmt.free();

        return { success: true };
      }),

      keys: this.createSecureMethod('storage:read', async () => {
        const { database } = this.context;
        if (!database) {
          throw new Error('数据库服务不可用');
        }

        const stmt = database.db.prepare(
          'SELECT setting_key FROM plugin_settings WHERE plugin_id = ?'
        );
        const rows = stmt.all(this.pluginId);
        stmt.free();

        return rows.map(row => row.setting_key);
      }),
    };
  }

  /**
   * 工具API
   */
  buildUtilsAPI() {
    return {
      // 日志
      log: (...args) => {
        logger.info(`[Plugin:${this.pluginId}]`, ...args);
      },

      warn: (...args) => {
        logger.warn(`[Plugin:${this.pluginId}]`, ...args);
      },

      error: (...args) => {
        logger.error(`[Plugin:${this.pluginId}]`, ...args);
      },

      // 延迟
      sleep: (ms) => {
        return new Promise(resolve => setTimeout(resolve, Math.min(ms, 10000)));
      },

      // 生成UUID
      uuid: () => {
        return require('crypto').randomUUID();
      },
    };
  }

  /**
   * 创建带权限检查的安全方法
   * @param {string} permission - 需要的权限
   * @param {Function} fn - 实际执行的函数
   * @returns {Function} 安全包装的函数
   */
  createSecureMethod(permission, fn) {
    return async (...args) => {
      const methodName = fn.name || 'anonymous';

      try {
        // 1. 权限检查
        this.permissionChecker.requirePermission(this.pluginId, permission);

        // 2. 更新统计
        this.updateStats(methodName);

        // 3. 执行方法
        const startTime = Date.now();
        const result = await fn(...args);
        const duration = Date.now() - startTime;

        // 4. 记录成功调用
        this.logAPICall(methodName, permission, true, duration);

        return result;
      } catch (error) {
        // 记录错误
        this.stats.errors[methodName] = (this.stats.errors[methodName] || 0) + 1;
        this.logAPICall(methodName, permission, false, 0, error.message);

        throw error;
      }
    };
  }

  /**
   * 获取安全路径（防止路径穿越）
   * @param {string} baseDir - 基础目录
   * @param {string} filePath - 文件路径
   * @returns {string} 安全的绝对路径
   */
  getSafePath(baseDir, filePath) {
    const path = require('path');
    const resolvedPath = path.resolve(baseDir, filePath);

    // 确保路径在基础目录内
    if (!resolvedPath.startsWith(baseDir)) {
      throw new Error('非法路径：不允许访问插件目录之外的文件');
    }

    return resolvedPath;
  }

  /**
   * 更新API调用统计
   * @param {string} methodName - 方法名
   */
  updateStats(methodName) {
    this.stats.callCount[methodName] = (this.stats.callCount[methodName] || 0) + 1;
    this.stats.lastCalled[methodName] = Date.now();
  }

  /**
   * 记录API调用日志
   * @param {string} methodName - 方法名
   * @param {string} permission - 权限
   * @param {boolean} success - 是否成功
   * @param {number} duration - 耗时（毫秒）
   * @param {string} error - 错误信息
   */
  async logAPICall(methodName, permission, success, duration, error = '') {
    try {
      const { database } = this.context;
      if (!database) {
        return;
      }

      // 更新 plugin_api_stats 表
      const stmt = database.db.prepare(`
        INSERT INTO plugin_api_stats (plugin_id, api_method, call_count, last_called_at, total_duration_ms, error_count)
        VALUES (?, ?, 1, ?, ?, ?)
        ON CONFLICT(plugin_id, api_method) DO UPDATE SET
          call_count = call_count + 1,
          last_called_at = ?,
          total_duration_ms = total_duration_ms + ?,
          error_count = error_count + ?
      `);

      const now = Date.now();
      const errorIncrement = success ? 0 : 1;

      stmt.run(
        this.pluginId,
        methodName,
        now,
        duration,
        errorIncrement,
        now,
        duration,
        errorIncrement
      );
      stmt.free();
    } catch (err) {
      logger.error('[PluginAPI] 记录API调用失败:', err);
    }
  }

  /**
   * 获取API统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      pluginId: this.pluginId,
    };
  }

  /**
   * 获取API对象（供沙箱使用）
   * @returns {Object} API对象
   */
  getAPI() {
    return this.api;
  }
}

module.exports = PluginAPI;
