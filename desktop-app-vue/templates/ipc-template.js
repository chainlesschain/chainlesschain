/**
 * IPC 模块开发模板
 * 提供两种模式：类模式（大模块 ≥ 15 handlers）和函数模式（小模块 < 15 handlers）
 *
 * 使用指南：
 * 1. 复制此模板到对应的模块目录（如 src/main/[module]/[module]-ipc.js）
 * 2. 根据模块大小选择合适的模式
 * 3. 替换模板中的占位符（[MODULE]、[Channel]等）
 * 4. 实现具体的 IPC handlers
 * 5. 在 ipc-registry.js 中注册该模块
 */

// ============================================================
// 模式 1: 类模式 (推荐用于大模块，handlers ≥ 15)
// ============================================================

/**
 * [MODULE] IPC 处理器
 * 负责处理 [MODULE] 相关的前后端通信
 *
 * @class [MODULE]IPC
 * @example
 * const [module]IPC = new [MODULE]IPC();
 * [module]IPC.setDependencies({ database, manager });
 * [module]IPC.registerHandlers();
 */
class ExampleModuleIPC_ClassMode {
  /**
   * 构造函数
   */
  constructor() {
    /**
     * 标记是否已注册，防止重复注册
     * @type {boolean}
     */
    this.handlersRegistered = false;

    /**
     * 依赖的管理器实例
     * @type {Object|null}
     */
    this.database = null;
    this.manager = null;
    this.mainWindow = null;
  }

  /**
   * 设置依赖项
   * @param {Object} dependencies - 依赖对象
   * @param {Object} dependencies.database - 数据库实例
   * @param {Object} dependencies.manager - 业务管理器
   * @param {Object} dependencies.mainWindow - 主窗口实例
   */
  setDependencies({ database, manager, mainWindow }) {
    this.database = database;
    this.manager = manager;
    this.mainWindow = mainWindow;
  }

  /**
   * 注册所有 IPC 处理器
   */
  registerHandlers() {
    // 防止重复注册
    if (this.handlersRegistered) {
      console.log('[ModuleIPC] Handlers already registered, skipping');
      return;
    }

    const { ipcMain } = require('electron');

    // ========================================
    // Handler 示例 1: 获取数据
    // ========================================

    /**
     * 获取所有数据
     * Channel: 'module:get-all'
     * @param {Electron.IpcMainInvokeEvent} event - IPC 事件
     * @param {Object} options - 查询选项
     * @returns {Promise<Object>} 返回结果
     */
    ipcMain.handle('module:get-all', async (event, options = {}) => {
      try {
        console.log('[ModuleIPC] Getting all data...', options);

        if (!this.manager) {
          throw new Error('Manager not initialized');
        }

        const result = await this.manager.getAll(options);

        return {
          success: true,
          data: result
        };
      } catch (error) {
        console.error('[ModuleIPC] Get all data failed:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // ========================================
    // Handler 示例 2: 创建数据
    // ========================================

    /**
     * 创建新数据
     * Channel: 'module:create'
     * @param {Electron.IpcMainInvokeEvent} event - IPC 事件
     * @param {Object} data - 要创建的数据
     * @returns {Promise<Object>} 返回结果
     */
    ipcMain.handle('module:create', async (event, data) => {
      try {
        console.log('[ModuleIPC] Creating data...', data);

        if (!this.manager) {
          throw new Error('Manager not initialized');
        }

        const result = await this.manager.create(data);

        return {
          success: true,
          data: result
        };
      } catch (error) {
        console.error('[ModuleIPC] Create data failed:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // ========================================
    // 更多 handlers...
    // ========================================

    // 标记为已注册
    this.handlersRegistered = true;
    console.log('[ModuleIPC] All IPC handlers registered successfully');
  }
}

// 导出类
// module.exports = ExampleModuleIPC_ClassMode;

// ============================================================
// 模式 2: 函数模式 (推荐用于小模块，handlers < 15)
// ============================================================

/**
 * 注册 [MODULE] IPC 处理器
 * 负责处理 [MODULE] 相关的前后端通信
 *
 * @function register[MODULE]IPC
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.manager - 业务管理器
 * @param {Object} [dependencies.mainWindow] - 主窗口实例（可选）
 * @example
 * register[MODULE]IPC({ manager, mainWindow });
 */
function registerExampleModuleIPC_FunctionMode({ manager, mainWindow }) {
  const { ipcMain } = require('electron');

  // ========================================
  // Handler 示例 1: 获取数据
  // ========================================

  /**
   * 获取所有数据
   * Channel: 'module:get-all'
   */
  ipcMain.handle('module:get-all', async (event, options = {}) => {
    try {
      console.log('[ModuleIPC] Getting all data...', options);

      if (!manager) {
        throw new Error('Manager not initialized');
      }

      const result = await manager.getAll(options);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('[ModuleIPC] Get all data failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // ========================================
  // Handler 示例 2: 创建数据
  // ========================================

  /**
   * 创建新数据
   * Channel: 'module:create'
   */
  ipcMain.handle('module:create', async (event, data) => {
    try {
      console.log('[ModuleIPC] Creating data...', data);

      if (!manager) {
        throw new Error('Manager not initialized');
      }

      const result = await manager.create(data);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('[ModuleIPC] Create data failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // ========================================
  // 更多 handlers...
  // ========================================

  console.log('[ModuleIPC] All IPC handlers registered successfully');
}

// 导出函数
// module.exports = { registerExampleModuleIPC_FunctionMode };

// ============================================================
// 通用最佳实践
// ============================================================

/**
 * 1. Channel 命名规范:
 *    - 格式: '[module]:[action]'
 *    - 示例: 'llm:chat', 'project:create', 'ukey:detect'
 *    - 使用小写字母和连字符，避免驼峰命名
 *
 * 2. 错误处理:
 *    - 所有 handler 必须包含 try-catch
 *    - 返回统一格式: { success: boolean, data?: any, error?: string }
 *    - 错误信息应该清晰明确，便于调试
 *
 * 3. 参数验证:
 *    - 验证必需参数是否存在
 *    - 验证参数类型是否正确
 *    - 提供默认值（如 options = {}）
 *
 * 4. 日志记录:
 *    - 使用统一的日志前缀（如 [ModuleIPC]）
 *    - 记录关键操作和错误
 *    - 避免记录敏感信息（密码、密钥等）
 *
 * 5. 依赖注入:
 *    - 类模式：通过 setDependencies() 方法
 *    - 函数模式：通过函数参数
 *    - 始终检查依赖是否已初始化
 *
 * 6. 测试:
 *    - 为每个模块编写单元测试
 *    - 测试文件命名: [module]-ipc.test.js
 *    - 模拟 ipcMain 和依赖管理器
 *
 * 7. 文档:
 *    - 使用 JSDoc 注释
 *    - 说明每个 handler 的用途、参数和返回值
 *    - 提供使用示例
 */

// ============================================================
// 示例：如何在 ipc-registry.js 中注册
// ============================================================

/**
 * 类模式注册:
 *
 * const ExampleModuleIPC = require('./module/module-ipc');
 * const moduleIPC = new ExampleModuleIPC();
 * moduleIPC.setDependencies({ database, manager, mainWindow });
 * moduleIPC.registerHandlers();
 * registeredModules.moduleIPC = moduleIPC;
 */

/**
 * 函数模式注册:
 *
 * const { registerExampleModuleIPC } = require('./module/module-ipc');
 * registerExampleModuleIPC({ manager, mainWindow });
 */

// ============================================================
// 示例：前端如何调用 IPC
// ============================================================

/**
 * 在 Vue 组件或前端代码中:
 *
 * const { ipcRenderer } = window.require('electron');
 *
 * // 获取所有数据
 * const result = await ipcRenderer.invoke('module:get-all', { page: 1 });
 * if (result.success) {
 *   console.log('Data:', result.data);
 * } else {
 *   console.error('Error:', result.error);
 * }
 *
 * // 创建数据
 * const createResult = await ipcRenderer.invoke('module:create', {
 *   name: 'Example',
 *   value: 123
 * });
 */

module.exports = {
  ExampleModuleIPC_ClassMode,
  registerExampleModuleIPC_FunctionMode
};
