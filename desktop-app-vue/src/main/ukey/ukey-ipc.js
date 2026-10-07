import { createRequire } from 'module';
import { logger } from '../utils/logger.js';
import { ipcMain as electronIpcMain } from 'electron';
import ipcGuardModule from '../ipc/ipc-guard.js';

const require = createRequire(import.meta.url);
const goalAuth = require('../task/project-goal-auth-session.js');
const { validateSender } = require('../ipc/ipc-sender-guard.js');

function trustedAuthenticationSender(event) {
  try {
    return validateSender(event)?.trusted === true &&
      event?.sender?.isDestroyed?.() !== true;
  } catch {
    return false;
  }
}

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
function registerUKeyIPC({ ukeyManager, unifiedKeyManager, fido2Authenticator, ipcMain: injectedIpcMain, ipcGuard: injectedIpcGuard } = {}) {
  logger.info('[UKey IPC] >>> registerUKeyIPC ENTRY, ukeyManager:', !!ukeyManager);

  // 支持依赖注入，用于测试
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  const ipcMain = injectedIpcMain || electronIpcMain;

  logger.info('[UKey IPC] >>> ipcMain available:', !!ipcMain, ', ipcMain.handle type:', typeof ipcMain?.handle);

  // 防止重复注册 - 但始终先尝试清理可能存在的旧handler
  if (ipcGuard.isModuleRegistered('ukey-ipc')) {
    logger.info('[UKey IPC] Module already registered, checking handlers...');
    goalAuth.clearProjectGoalAuth();

    // 尝试清理可能存在的旧handler
    try {
      ipcMain.removeHandler('ukey:detect');
      ipcMain.removeHandler('ukey:verify-pin');
      ipcMain.removeHandler('ukey:get-device-info');
      ipcMain.removeHandler('ukey:sign');
      ipcMain.removeHandler('ukey:encrypt');
      ipcMain.removeHandler('ukey:decrypt');
      ipcMain.removeHandler('ukey:lock');
      ipcMain.removeHandler('ukey:get-public-key');
      ipcMain.removeHandler('auth:verify-password');
      ipcMain.removeHandler('auth:logout');
      // Phase 45 handlers
      ipcMain.removeHandler('ukey:derive-key');
      ipcMain.removeHandler('ukey:list-keys');
      ipcMain.removeHandler('ukey:set-primary-key');
      ipcMain.removeHandler('fido2:make-credential');
      ipcMain.removeHandler('fido2:get-assertion');
      ipcMain.removeHandler('fido2:list-credentials');
      ipcMain.removeHandler('ukey:transport-status');
      ipcMain.removeHandler('ukey:scan-usb-devices');
      // Phase 46-47 handlers
      ipcMain.removeHandler('ble-ukey:scan-devices');
      ipcMain.removeHandler('ble-ukey:pair-device');
      ipcMain.removeHandler('ble-ukey:connect');
      ipcMain.removeHandler('ble-ukey:disconnect');
      ipcMain.removeHandler('threshold-security:setup-keys');
      ipcMain.removeHandler('threshold-security:sign');
      ipcMain.removeHandler('threshold-security:bind-biometric');
      ipcMain.removeHandler('threshold-security:verify-biometric');
    } catch {
      // 忽略清理错误
    }

    // 清除注册标记以便重新注册
    ipcGuard.unregisterModule('ukey-ipc');
    logger.info('[UKey IPC] Cleared old registration, will re-register...');
  }

  logger.info('[UKey IPC] Registering U-Key IPC handlers...');

  // ============================================================
  // U-Key 硬件检测与管理
  // ============================================================

  /**
   * 检测 U-Key 设备
   * Channel: 'ukey:detect'
   */
  try {
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
        logger.error('[UKey IPC] U盾检测失败:', error);
        return {
          detected: false,
          unlocked: false,
          error: error.message,
        };
      }
    });
    logger.info('[UKey IPC] >>> ukey:detect handler registered successfully');
  } catch (error) {
    logger.error('[UKey IPC] >>> FAILED to register ukey:detect handler:', error);
  }

  /**
   * 验证 PIN 码
   * Channel: 'ukey:verify-pin'
   */
  ipcMain.handle('ukey:verify-pin', async (_event, pin) => {
    try {
      const attempt = trustedAuthenticationSender(_event)
        ? goalAuth.beginProjectGoalAuthentication() : null;
      if (!ukeyManager) {
        return {
          success: false,
          error: 'U盾管理器未初始化',
        };
      }

      const result = await ukeyManager.verifyPIN(pin);
      if (result?.success === true && trustedAuthenticationSender(_event)) {
        goalAuth.authenticateProjectGoalUKey(ukeyManager, attempt);
      }
      return result;
    } catch (error) {
      logger.error('[UKey IPC] PIN验证失败:', error);
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
      logger.error('[UKey IPC] 获取设备信息失败:', error);
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
      logger.error('[UKey IPC] 签名失败:', error);
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
      logger.error('[UKey IPC] 加密失败:', error);
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
      logger.error('[UKey IPC] 解密失败:', error);
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
      goalAuth.clearProjectGoalAuth('ukey');
      return true;
    } catch (error) {
      logger.error('[UKey IPC] 锁定失败:', error);
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
      logger.error('[UKey IPC] 获取公钥失败:', error);
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
      const attempt = trustedAuthenticationSender(_event)
        ? goalAuth.beginProjectGoalAuthentication() : null;
      // 开发模式：默认用户名和密码
      const DEFAULT_USERNAME = process.env.DEFAULT_USERNAME || 'admin';
      const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || '123456';

      // 简单的密码验证（生产环境应使用加密存储）
      if (username === DEFAULT_USERNAME && password === DEFAULT_PASSWORD) {
        logger.info('[UKey IPC] ✅ 密码验证成功');
        if (trustedAuthenticationSender(_event)) {
          goalAuth.authenticateProjectGoalPassword(attempt);
        }
        return {
          success: true,
          userId: 'local-user',
          username: username,
        };
      }

      logger.info('[UKey IPC] ❌ 密码验证失败');
      logger.info('[UKey IPC] 用户名匹配:', username === DEFAULT_USERNAME);
      logger.info('[UKey IPC] 密码匹配:', password === DEFAULT_PASSWORD);
      logger.info('[UKey IPC] 用户名严格相等:', username === DEFAULT_USERNAME, '宽松相等:', username === DEFAULT_USERNAME);
      logger.info('[UKey IPC] 密码严格相等:', password === DEFAULT_PASSWORD, '宽松相等:', password === DEFAULT_PASSWORD);
      return {
        success: false,
        error: '用户名或密码错误',
      };
    } catch (error) {
      logger.error('[UKey IPC] ❌ 密码验证异常:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  ipcMain.handle('auth:logout', async (event) => {
    if (!trustedAuthenticationSender(event)) {
      throw Object.assign(new Error('GOAL_UNTRUSTED_SENDER'), {
        code: 'GOAL_UNTRUSTED_SENDER',
      });
    }
    goalAuth.clearProjectGoalAuth();
  });

  // ============================================================
  // Unified Key + FIDO2 (Phase 45) - 6 handlers
  // ============================================================

  // unifiedKeyManager and fido2Authenticator are destructured from the function params above

  ipcMain.handle('ukey:derive-key', async (_event, { purpose, options }) => {
    try {
      if (!unifiedKeyManager) {throw new Error('UnifiedKeyManager not initialized');}
      return { success: true, key: await unifiedKeyManager.deriveKey(purpose, options) };
    } catch (error) {
      logger.error('[UKey IPC] Derive key failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ukey:list-keys', async () => {
    try {
      if (!unifiedKeyManager) {throw new Error('UnifiedKeyManager not initialized');}
      return { success: true, keys: await unifiedKeyManager.listKeys() };
    } catch (error) {
      logger.error('[UKey IPC] List keys failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ukey:set-primary-key', async (_event, { keyId }) => {
    try {
      if (!unifiedKeyManager) {throw new Error('UnifiedKeyManager not initialized');}
      return await unifiedKeyManager.setPrimaryKey(keyId);
    } catch (error) {
      logger.error('[UKey IPC] Set primary key failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fido2:make-credential', async (_event, options) => {
    try {
      if (!fido2Authenticator) {throw new Error('FIDO2Authenticator not initialized');}
      return { success: true, credential: await fido2Authenticator.makeCredential(options) };
    } catch (error) {
      logger.error('[UKey IPC] FIDO2 makeCredential failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fido2:get-assertion', async (_event, options) => {
    try {
      if (!fido2Authenticator) {throw new Error('FIDO2Authenticator not initialized');}
      return { success: true, assertion: await fido2Authenticator.getAssertion(options) };
    } catch (error) {
      logger.error('[UKey IPC] FIDO2 getAssertion failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fido2:list-credentials', async (_event, options) => {
    try {
      if (!fido2Authenticator) {throw new Error('FIDO2Authenticator not initialized');}
      return { success: true, credentials: await fido2Authenticator.listCredentials(options) };
    } catch (error) {
      logger.error('[UKey IPC] FIDO2 listCredentials failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Transport Status (Phase 45/WS6) - 2 handlers
  // ============================================================

  ipcMain.handle('ukey:transport-status', async () => {
    try {
      if (ukeyManager && ukeyManager.driverRegistry) {
        return { success: true, ...(ukeyManager.driverRegistry.getTransportStatus()) };
      }
      // Fallback
      const { getDriverRegistry } = require('./driver-registry');
      return { success: true, ...(getDriverRegistry().getTransportStatus()) };
    } catch (error) {
      logger.error('[UKey IPC] Transport status failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ukey:scan-usb-devices', async () => {
    try {
      const { getUSBTransport } = await import('./usb-transport.js');
      const transport = getUSBTransport();
      await transport.initialize();
      const devices = await transport.scanDevices();
      return { success: true, devices };
    } catch (error) {
      logger.error('[UKey IPC] USB scan failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // BLE U-Key (Phase 47) - 4 handlers
  // ============================================================

  ipcMain.handle('ble-ukey:scan-devices', async (_event, { timeout } = {}) => {
    try {
      const { getBLEDriver } = require('./ble-driver');
      const ble = getBLEDriver();
      const available = await ble.isAvailable();
      if (!available) {
        return { success: true, devices: [], warning: 'BLE not available' };
      }
      const result = await ble.scan(timeout);
      // Strip internal _peripheral references for IPC serialization
      const devices = (result.devices || []).map(d => ({
        id: d.id,
        name: d.name,
        rssi: d.rssi,
        distance: d.distance,
        paired: ble.getPairedDevices().some(p => p.id === d.id),
        connected: ble.getState() === 'connected' && ble._device?.id === d.id,
        lastSeen: Date.now(),
      }));
      return { success: true, devices };
    } catch (error) {
      logger.error('[UKey IPC] BLE scan failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ble-ukey:pair-device', async (_event, { deviceId }) => {
    try {
      if (!deviceId) {throw new Error('deviceId is required');}
      const { getBLEDriver } = require('./ble-driver');
      return await getBLEDriver().pair(deviceId);
    } catch (error) {
      logger.error('[UKey IPC] BLE pair failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ble-ukey:connect', async (_event, { deviceId }) => {
    try {
      if (!deviceId) {throw new Error('deviceId is required');}
      const { getBLEDriver } = require('./ble-driver');
      return await getBLEDriver().connect(deviceId);
    } catch (error) {
      logger.error('[UKey IPC] BLE connect failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ble-ukey:disconnect', async () => {
    try {
      const { getBLEDriver } = require('./ble-driver');
      await getBLEDriver().disconnect();
      return { success: true };
    } catch (error) {
      logger.error('[UKey IPC] BLE disconnect failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Threshold Security (Phase 46) - 4 handlers
  // ============================================================

  ipcMain.handle('threshold-security:setup-keys', async (_event, params) => {
    try {
      if (params?.action === 'list') {
        const { getThresholdSignatureManager } = require('./threshold-signature-manager');
        const mgr = getThresholdSignatureManager();
        if (!mgr.initialized && ukeyManager?.database) {
          mgr.database = ukeyManager.database;
          await mgr.initialize();
        }
        return { success: true, keys: await mgr.listKeys() };
      }
      const { getThresholdSignatureManager } = require('./threshold-signature-manager');
      const mgr = getThresholdSignatureManager();
      if (!mgr.initialized && ukeyManager?.database) {
        mgr.database = ukeyManager.database;
        await mgr.initialize();
      }
      return await mgr.setupKeys(params);
    } catch (error) {
      logger.error('[UKey IPC] Threshold setup failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('threshold-security:sign', async (_event, params) => {
    try {
      const { getThresholdSignatureManager } = require('./threshold-signature-manager');
      const mgr = getThresholdSignatureManager();
      return await mgr.sign(params);
    } catch (error) {
      logger.error('[UKey IPC] Threshold sign failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('threshold-security:bind-biometric', async (_event, params) => {
    try {
      if (params?.action === 'list') {
        const { getBiometricBinding } = require('./biometric-binding');
        const bb = getBiometricBinding();
        if (!bb.initialized && ukeyManager?.database) {
          bb.database = ukeyManager.database;
          await bb.initialize();
        }
        return { success: true, bindings: await bb.listBindings(params.keyId) };
      }
      const { getBiometricBinding } = require('./biometric-binding');
      const bb = getBiometricBinding();
      if (!bb.initialized && ukeyManager?.database) {
        bb.database = ukeyManager.database;
        await bb.initialize();
      }
      return await bb.bindBiometric(params);
    } catch (error) {
      logger.error('[UKey IPC] Biometric bind failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('threshold-security:verify-biometric', async (_event, params) => {
    try {
      const { getBiometricBinding } = require('./biometric-binding');
      const bb = getBiometricBinding();
      return await bb.verifyBiometric(params);
    } catch (error) {
      logger.error('[UKey IPC] Biometric verify failed:', error);
      return { success: false, error: error.message };
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered('ukey-ipc');

  logger.info('[UKey IPC] ✓ All U-Key IPC handlers registered successfully (26 handlers)');
}

export {
  registerUKeyIPC
};
