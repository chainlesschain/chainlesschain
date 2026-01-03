/**
 * IPC 权限管理集成示例
 *
 * 展示如何在主进程的 IPC handlers 中使用权限管理器
 */

const { ipcMain } = require('electron');
const { getIPCPermissionManager, PermissionLevel } = require('./ipc-permission-manager');

/**
 * 初始化 IPC 权限管理
 */
async function initializeIPCPermissions(app) {
  const permissionManager = getIPCPermissionManager();
  await permissionManager.initialize();

  console.log('[Security] IPC 权限管理系统已初始化');

  // 监听用户认证事件
  ipcMain.handle('auth:login', async (event, username, password) => {
    // 验证用户身份（这里是示例）
    const isValid = await validateUser(username, password);

    if (isValid) {
      // 用户认证成功，设置权限级别
      permissionManager.authenticate();
      console.log('[Security] 用户已认证，权限级别：AUTHENTICATED');
      return { success: true };
    }

    return { success: false, error: '用户名或密码错误' };
  });

  // 监听用户登出事件
  ipcMain.handle('auth:logout', async (event) => {
    permissionManager.logout();
    console.log('[Security] 用户已登出，权限级别：PUBLIC');
    return { success: true };
  });

  // 返回权限管理器实例，供其他模块使用
  return permissionManager;
}

/**
 * 创建受保护的 IPC handler
 *
 * 自动应用权限检查和参数清理
 */
function createSecureIPCHandler(channel, handler) {
  const permissionManager = getIPCPermissionManager();

  return async (event, ...args) => {
    try {
      // 应用权限中间件
      const sanitizedArgs = permissionManager.middleware(channel, args);

      // 调用实际的处理器
      return await handler(event, ...sanitizedArgs);
    } catch (error) {
      console.error(`[Security] IPC handler error for ${channel}:`, error);
      throw error;
    }
  };
}

/**
 * 批量注册安全的 IPC handlers
 */
function registerSecureHandlers(handlers) {
  for (const [channel, handler] of Object.entries(handlers)) {
    const secureHandler = createSecureIPCHandler(channel, handler);
    ipcMain.handle(channel, secureHandler);
    console.log(`[Security] 已注册安全 IPC handler: ${channel}`);
  }
}

/**
 * 使用示例
 */
async function example() {
  // 1. 初始化权限管理
  const permissionManager = await initializeIPCPermissions();

  // 2. 注册安全的 IPC handlers
  registerSecureHandlers({
    // 知识库操作 (需要认证)
    'knowledge:create': async (event, item) => {
      console.log('[知识库] 创建条目:', item.title);
      // 实际的业务逻辑
      return { success: true, id: 'xxx' };
    },

    'knowledge:update': async (event, id, updates) => {
      console.log('[知识库] 更新条目:', id);
      // 实际的业务逻辑
      return { success: true };
    },

    'knowledge:delete': async (event, id) => {
      console.log('[知识库] 删除条目:', id);
      // 实际的业务逻辑
      return { success: true };
    },

    // 文件导入 (需要认证)
    'import:import-file': async (event, filePath, options) => {
      console.log('[文件导入] 导入文件:', filePath);
      // FileValidator 已在 file-importer 中集成
      // 这里只需要调用 FileImporter
      return { success: true };
    },

    // 图片上传 (需要认证)
    'image:upload': async (event, imagePath, options) => {
      console.log('[图片上传] 上传图片:', imagePath);
      // FileValidator 已在 image-uploader 中集成
      // 这里只需要调用 ImageUploader
      return { success: true };
    },

    // 数据库配置 (需要管理员权限)
    'database:migrate': async (event, newPath) => {
      console.log('[数据库] 迁移数据库:', newPath);
      // 只有管理员才能执行
      return { success: true };
    },
  });

  // 3. 查看统计信息
  setInterval(() => {
    const stats = permissionManager.getStatistics();
    console.log('[Security] 权限统计:', stats);
  }, 60000); // 每分钟输出一次
}

/**
 * 辅助函数：验证用户
 */
async function validateUser(username, password) {
  // 这里应该连接数据库验证
  // 示例：简单的硬编码验证
  return username === 'admin' && password === 'password';
}

module.exports = {
  initializeIPCPermissions,
  createSecureIPCHandler,
  registerSecureHandlers,
};
