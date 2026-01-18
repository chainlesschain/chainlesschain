/**
 * U-Key 硬件 IPC 处理器
 * 负责处理 U-Key 硬件设备相关的前后端通信
 *
 * @module ukey-ipc
 * @description 提供 U-Key 硬件检测、PIN验证、签名加密、认证等 IPC 接口
 */

/**
 * 注册所有 U-Key IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.ukeyManager - U-Key 管理器
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {Object} dependencies.ipcGuard - IPC Guard模块（可选，用于测试注入）
 */
function registerUKeyIPC({ ukeyManager, ipcMain: injectedIpcMain, ipcGuard: injectedIpcGuard }) {
  // 支持依赖注入，用于测试
  const ipcGuard = injectedIpcGuard || require('../ipc-guard');

  // 防止重复注册
  if (ipcGuard.isModuleRegistered('ukey-ipc')) {
    console.log('[UKey IPC] Handlers already registered, skipping...');
    return;
  }

  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  console.log('[UKey IPC] Registering U-Key IPC handlers...');

  // ============================================================
  // U-Key 硬件检测与管理
  // ============================================================

  /**
   * 检测 U-Key 设备
   * Channel: 'ukey:detect'
   */
  ipcMain.handle('ukey:detect', async () => {
    try {
      if (!ukeyManager) {
        return {
          detected: false,
          unlocked: false,
          error: 'U盾管理器未初始化',
        };
      }

      const result = await ukeyManager.detect();

      // 如果是驱动未初始化（非Windows平台），不记录错误日志
      if (result.reason === 'driver_not_initialized') {
        return result;
      }

      return result;
    } catch (error) {
      console.error('[UKey IPC] U盾检测失败:', error);
      return {
        detected: false,
        unlocked: false,
        error: error.message,
      };
    }
  });

  /**
   * 验证 PIN 码
   * Channel: 'ukey:verify-pin'
   */
  ipcMain.handle('ukey:verify-pin', async (_event, pin) => {
    try {
      if (!ukeyManager) {
        return {
          success: false,
          error: 'U盾管理器未初始化',
        };
      }

      return await ukeyManager.verifyPIN(pin);
    } catch (error) {
      console.error('[UKey IPC] PIN验证失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取设备信息
   * Channel: 'ukey:get-device-info'
   */
  ipcMain.handle('ukey:get-device-info', async () => {
    try {
      if (!ukeyManager) {
        throw new Error('U盾管理器未初始化');
      }

      return await ukeyManager.getDeviceInfo();
    } catch (error) {
      console.error('[UKey IPC] 获取设备信息失败:', error);
      throw error;
    }
  });

  /**
   * 数字签名
   * Channel: 'ukey:sign'
   */
  ipcMain.handle('ukey:sign', async (_event, data) => {
    try {
      if (!ukeyManager) {
        throw new Error('U盾管理器未初始化');
      }

      return await ukeyManager.sign(data);
    } catch (error) {
      console.error('[UKey IPC] 签名失败:', error);
      throw error;
    }
  });

  /**
   * 数据加密
   * Channel: 'ukey:encrypt'
   */
  ipcMain.handle('ukey:encrypt', async (_event, data) => {
    try {
      if (!ukeyManager) {
        throw new Error('U盾管理器未初始化');
      }

      return await ukeyManager.encrypt(data);
    } catch (error) {
      console.error('[UKey IPC] 加密失败:', error);
      throw error;
    }
  });

  /**
   * 数据解密
   * Channel: 'ukey:decrypt'
   */
  ipcMain.handle('ukey:decrypt', async (_event, encryptedData) => {
    try {
      if (!ukeyManager) {
        throw new Error('U盾管理器未初始化');
      }

      return await ukeyManager.decrypt(encryptedData);
    } catch (error) {
      console.error('[UKey IPC] 解密失败:', error);
      throw error;
    }
  });

  /**
   * 锁定 U-Key
   * Channel: 'ukey:lock'
   */
  ipcMain.handle('ukey:lock', async () => {
    try {
      if (!ukeyManager) {
        throw new Error('U盾管理器未初始化');
      }

      ukeyManager.lock();
      return true;
    } catch (error) {
      console.error('[UKey IPC] 锁定失败:', error);
      throw error;
    }
  });

  /**
   * 获取公钥
   * Channel: 'ukey:get-public-key'
   */
  ipcMain.handle('ukey:get-public-key', async () => {
    try {
      if (!ukeyManager) {
        throw new Error('U盾管理器未初始化');
      }

      return await ukeyManager.getPublicKey();
    } catch (error) {
      console.error('[UKey IPC] 获取公钥失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 备用认证（密码登录）
  // ============================================================

  /**
   * 密码认证（用于未检测到U盾时的备用登录方式）
   * Channel: 'auth:verify-password'
   */
  ipcMain.handle('auth:verify-password', async (_event, username, password) => {
    try {
      // 开发模式：默认用户名和密码
      const DEFAULT_USERNAME = process.env.DEFAULT_USERNAME || 'admin';
      const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || '123456';

      console.log('[UKey IPC] 收到登录请求 - 用户名:', username, '密码长度:', password?.length);
      console.log('[UKey IPC] 期望用户名:', DEFAULT_USERNAME, '期望密码:', DEFAULT_PASSWORD);

      // 简单的密码验证（生产环境应使用加密存储）
      if (username === DEFAULT_USERNAME && password === DEFAULT_PASSWORD) {
        console.log('[UKey IPC] 密码验证成功');
        return {
          success: true,
          userId: 'local-user',
          username: username,
        };
      }

      console.log('[UKey IPC] 密码验证失败: 用户名或密码错误');
      console.log('[UKey IPC] 用户名匹配:', username === DEFAULT_USERNAME, '密码匹配:', password === DEFAULT_PASSWORD);
      return {
        success: false,
        error: '用户名或密码错误',
      };
    } catch (error) {
      console.error('[UKey IPC] 密码验证异常:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered('ukey-ipc');

  console.log('[UKey IPC] ✓ All U-Key IPC handlers registered successfully (9 handlers)');
}

module.exports = {
  registerUKeyIPC
};
