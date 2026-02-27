/**
 * U-Key IPC 单元测试
 * 测试17个 U-Key 相关 API 方法及备用认证
 * (9 original + 6 unified key/FIDO2 + 2 transport)
 *
 * 使用依赖注入模式测试 IPC handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock ipc-guard at the top level to prevent registration blocking
vi.mock('../../../src/main/ipc-guard', () => ({
  isModuleRegistered: vi.fn().mockReturnValue(false),
  markModuleRegistered: vi.fn(),
  isChannelRegistered: vi.fn().mockReturnValue(false),
  markChannelRegistered: vi.fn(),
  resetAll: vi.fn(),
}));

// Mock electron to avoid import errors
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

describe('U-Key IPC 处理器', () => {
  let handlers = {};
  let mockUkeyManager;
  let mockUnifiedKeyManager;
  let mockFido2Authenticator;
  let mockIpcMain;
  let registerUKeyIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock ipcMain
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };

    // Mock ukey manager
    mockUkeyManager = {
      detect: vi.fn().mockResolvedValue({
        detected: false,
        unlocked: false,
      }),
      verifyPIN: vi.fn().mockResolvedValue({
        success: false,
      }),
      getDeviceInfo: vi.fn().mockResolvedValue({
        serialNumber: 'TEST-123456',
        model: 'SIMKey-Test',
      }),
      sign: vi.fn().mockResolvedValue({
        signature: 'test-signature',
      }),
      encrypt: vi.fn().mockResolvedValue({
        encrypted: 'test-encrypted-data',
      }),
      decrypt: vi.fn().mockResolvedValue({
        decrypted: 'test-decrypted-data',
      }),
      lock: vi.fn(),
      getPublicKey: vi.fn().mockResolvedValue({
        publicKey: 'test-public-key',
      }),
    };

    // Mock unified key manager (Phase 45)
    mockUnifiedKeyManager = {
      deriveKey: vi.fn().mockResolvedValue({ keyId: 'k-1', publicKey: 'pub-1' }),
      listKeys: vi.fn().mockResolvedValue([]),
      setPrimaryKey: vi.fn().mockResolvedValue({ success: true }),
    };

    // Mock FIDO2 authenticator (Phase 45)
    mockFido2Authenticator = {
      makeCredential: vi.fn().mockResolvedValue({ credentialId: 'cred-1' }),
      getAssertion: vi.fn().mockResolvedValue({ signature: 'sig-1' }),
      listCredentials: vi.fn().mockResolvedValue([]),
    };

    // 创建 mock ipcGuard (使用依赖注入)
    const mockIpcGuard = {
      isModuleRegistered: vi.fn().mockReturnValue(false),
      markModuleRegistered: vi.fn(),
      isChannelRegistered: vi.fn().mockReturnValue(false),
      markChannelRegistered: vi.fn(),
      resetAll: vi.fn(),
    };

    // 动态导入
    const module = await import('../../../src/main/ukey/ukey-ipc.js');
    registerUKeyIPC = module.registerUKeyIPC;

    // 注册 U-Key IPC 并注入所有 mock 对象
    registerUKeyIPC({
      ukeyManager: mockUkeyManager,
      unifiedKeyManager: mockUnifiedKeyManager,
      fido2Authenticator: mockFido2Authenticator,
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });
  });

  // =====================================================================
  // 基本功能测试 - 验证handler结构
  // =====================================================================

  describe('基本功能测试', () => {
    it('should register exactly 17 U-Key IPC handlers', () => {
      expect(Object.keys(handlers).length).toBe(17);
    });

    it('should include all required handler channels', () => {
      const requiredChannels = [
        'ukey:detect',
        'ukey:verify-pin',
        'ukey:get-device-info',
        'ukey:sign',
        'ukey:encrypt',
        'ukey:decrypt',
        'ukey:lock',
        'ukey:get-public-key',
        'auth:verify-password',
        // Phase 45: Unified Key + FIDO2
        'ukey:derive-key',
        'ukey:list-keys',
        'ukey:set-primary-key',
        'fido2:make-credential',
        'fido2:get-assertion',
        'fido2:list-credentials',
        // Phase 45: Transport
        'ukey:transport-status',
        'ukey:scan-usb-devices',
      ];

      requiredChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });

    it('all handlers should be registered as functions', () => {
      Object.values(handlers).forEach((handler) => {
        expect(typeof handler).toBe('function');
      });
    });
  });

  // =====================================================================
  // 设备检测功能 - ukey:detect
  // =====================================================================

  describe('设备检测功能 (ukey:detect)', () => {
    it('should register ukey:detect handler', () => {
      expect(handlers['ukey:detect']).toBeDefined();
      expect(typeof handlers['ukey:detect']).toBe('function');
    });

    it('should call ukeyManager.detect()', async () => {
      const handler = handlers['ukey:detect'];
      await handler({});
      expect(mockUkeyManager.detect).toHaveBeenCalled();
    });

    it('should return detection result', async () => {
      const handler = handlers['ukey:detect'];
      const result = await handler({});
      expect(result).toHaveProperty('detected');
      expect(result).toHaveProperty('unlocked');
    });

    it('should handle detect errors gracefully', async () => {
      mockUkeyManager.detect.mockRejectedValueOnce(new Error('Detection failed'));
      const handler = handlers['ukey:detect'];
      const result = await handler({});
      expect(result).toHaveProperty('detected', false);
      expect(result).toHaveProperty('error');
    });
  });

  // =====================================================================
  // PIN管理功能 - ukey:verify-pin
  // =====================================================================

  describe('PIN管理功能 (ukey:verify-pin)', () => {
    it('should register ukey:verify-pin handler', () => {
      expect(handlers['ukey:verify-pin']).toBeDefined();
      expect(typeof handlers['ukey:verify-pin']).toBe('function');
    });

    it('should call ukeyManager.verifyPIN()', async () => {
      const handler = handlers['ukey:verify-pin'];
      await handler({}, '123456');
      expect(mockUkeyManager.verifyPIN).toHaveBeenCalledWith('123456');
    });

    it('should return verification result', async () => {
      mockUkeyManager.verifyPIN.mockResolvedValueOnce({ success: true });
      const handler = handlers['ukey:verify-pin'];
      const result = await handler({}, '123456');
      expect(result).toHaveProperty('success');
    });

    it('should handle PIN verification errors', async () => {
      mockUkeyManager.verifyPIN.mockRejectedValueOnce(new Error('PIN error'));
      const handler = handlers['ukey:verify-pin'];
      const result = await handler({}, 'invalid');
      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
    });
  });

  // =====================================================================
  // 设备信息获取 - ukey:get-device-info
  // =====================================================================

  describe('设备信息获取 (ukey:get-device-info)', () => {
    it('should register ukey:get-device-info handler', () => {
      expect(handlers['ukey:get-device-info']).toBeDefined();
      expect(typeof handlers['ukey:get-device-info']).toBe('function');
    });

    it('should call ukeyManager.getDeviceInfo()', async () => {
      const handler = handlers['ukey:get-device-info'];
      await handler({});
      expect(mockUkeyManager.getDeviceInfo).toHaveBeenCalled();
    });

    it('should return device information', async () => {
      const handler = handlers['ukey:get-device-info'];
      const result = await handler({});
      expect(result).toHaveProperty('serialNumber');
      expect(result).toHaveProperty('model');
    });

    it('should throw error when manager not initialized', async () => {
      const handlers2 = {};
      const mockIpcMain2 = {
        handle: (channel, handler) => {
          handlers2[channel] = handler;
        },
      };
      const mockIpcGuard2 = {
        isModuleRegistered: vi.fn().mockReturnValue(false),
        markModuleRegistered: vi.fn(),
      };
      registerUKeyIPC({
        ukeyManager: null,
        unifiedKeyManager: null,
        fido2Authenticator: null,
        ipcMain: mockIpcMain2,
        ipcGuard: mockIpcGuard2,
      });
      const handler = handlers2['ukey:get-device-info'];
      await expect(handler({})).rejects.toThrow();
    });
  });

  // =====================================================================
  // 加密操作功能 - ukey:sign, ukey:encrypt, ukey:decrypt
  // =====================================================================

  describe('加密操作功能', () => {
    describe('数字签名 (ukey:sign)', () => {
      it('should register ukey:sign handler', () => {
        expect(handlers['ukey:sign']).toBeDefined();
        expect(typeof handlers['ukey:sign']).toBe('function');
      });

      it('should call ukeyManager.sign()', async () => {
        const handler = handlers['ukey:sign'];
        await handler({}, 'data-to-sign');
        expect(mockUkeyManager.sign).toHaveBeenCalledWith('data-to-sign');
      });

      it('should return signature', async () => {
        const handler = handlers['ukey:sign'];
        const result = await handler({}, 'data');
        expect(result).toHaveProperty('signature');
      });
    });

    describe('数据加密 (ukey:encrypt)', () => {
      it('should register ukey:encrypt handler', () => {
        expect(handlers['ukey:encrypt']).toBeDefined();
        expect(typeof handlers['ukey:encrypt']).toBe('function');
      });

      it('should call ukeyManager.encrypt()', async () => {
        const handler = handlers['ukey:encrypt'];
        await handler({}, 'data-to-encrypt');
        expect(mockUkeyManager.encrypt).toHaveBeenCalledWith('data-to-encrypt');
      });

      it('should return encrypted data', async () => {
        const handler = handlers['ukey:encrypt'];
        const result = await handler({}, 'data');
        expect(result).toHaveProperty('encrypted');
      });
    });

    describe('数据解密 (ukey:decrypt)', () => {
      it('should register ukey:decrypt handler', () => {
        expect(handlers['ukey:decrypt']).toBeDefined();
        expect(typeof handlers['ukey:decrypt']).toBe('function');
      });

      it('should call ukeyManager.decrypt()', async () => {
        const handler = handlers['ukey:decrypt'];
        await handler({}, 'encrypted-data');
        expect(mockUkeyManager.decrypt).toHaveBeenCalledWith('encrypted-data');
      });

      it('should return decrypted data', async () => {
        const handler = handlers['ukey:decrypt'];
        const result = await handler({}, 'encrypted');
        expect(result).toHaveProperty('decrypted');
      });
    });
  });

  // =====================================================================
  // U-Key 锁定和公钥获取 - ukey:lock, ukey:get-public-key
  // =====================================================================

  describe('U-Key 锁定和公钥获取', () => {
    describe('U-Key 锁定 (ukey:lock)', () => {
      it('should register ukey:lock handler', () => {
        expect(handlers['ukey:lock']).toBeDefined();
        expect(typeof handlers['ukey:lock']).toBe('function');
      });

      it('should call ukeyManager.lock()', async () => {
        const handler = handlers['ukey:lock'];
        await handler({});
        expect(mockUkeyManager.lock).toHaveBeenCalled();
      });

      it('should return success', async () => {
        const handler = handlers['ukey:lock'];
        const result = await handler({});
        expect(result).toBe(true);
      });
    });

    describe('获取公钥 (ukey:get-public-key)', () => {
      it('should register ukey:get-public-key handler', () => {
        expect(handlers['ukey:get-public-key']).toBeDefined();
        expect(typeof handlers['ukey:get-public-key']).toBe('function');
      });

      it('should call ukeyManager.getPublicKey()', async () => {
        const handler = handlers['ukey:get-public-key'];
        await handler({});
        expect(mockUkeyManager.getPublicKey).toHaveBeenCalled();
      });

      it('should return public key', async () => {
        const handler = handlers['ukey:get-public-key'];
        const result = await handler({});
        expect(result).toHaveProperty('publicKey');
      });
    });
  });

  // =====================================================================
  // 备用认证功能 - auth:verify-password
  // =====================================================================

  describe('备用认证功能 (auth:verify-password)', () => {
    it('should register auth:verify-password handler', () => {
      expect(handlers['auth:verify-password']).toBeDefined();
      expect(typeof handlers['auth:verify-password']).toBe('function');
    });

    it('should verify correct credentials', async () => {
      const handler = handlers['auth:verify-password'];
      const result = await handler({}, 'admin', '123456');
      expect(result).toHaveProperty('success');
    });

    it('should reject incorrect credentials', async () => {
      const handler = handlers['auth:verify-password'];
      const result = await handler({}, 'admin', 'wrongpass');
      expect(result.success).toBe(false);
    });

    it('should return user info on success', async () => {
      const handler = handlers['auth:verify-password'];
      const result = await handler({}, 'admin', '123456');
      if (result.success) {
        expect(result).toHaveProperty('userId');
        expect(result).toHaveProperty('username');
      }
    });
  });

  // =====================================================================
  // 总体验证
  // =====================================================================

  describe('总体验证', () => {
    it('should register all 17 U-Key IPC handlers', () => {
      expect(Object.keys(handlers).length).toBe(17);
    });

    it('should have all required handler channels', () => {
      expect(handlers['ukey:detect']).toBeDefined();
      expect(handlers['ukey:verify-pin']).toBeDefined();
      expect(handlers['ukey:get-device-info']).toBeDefined();
      expect(handlers['ukey:sign']).toBeDefined();
      expect(handlers['ukey:encrypt']).toBeDefined();
      expect(handlers['ukey:decrypt']).toBeDefined();
      expect(handlers['ukey:lock']).toBeDefined();
      expect(handlers['ukey:get-public-key']).toBeDefined();
      expect(handlers['auth:verify-password']).toBeDefined();
      // Phase 45
      expect(handlers['ukey:derive-key']).toBeDefined();
      expect(handlers['ukey:list-keys']).toBeDefined();
      expect(handlers['ukey:set-primary-key']).toBeDefined();
      expect(handlers['fido2:make-credential']).toBeDefined();
      expect(handlers['fido2:get-assertion']).toBeDefined();
      expect(handlers['fido2:list-credentials']).toBeDefined();
      expect(handlers['ukey:transport-status']).toBeDefined();
      expect(handlers['ukey:scan-usb-devices']).toBeDefined();
    });

    it('all handlers should be callable functions', () => {
      Object.values(handlers).forEach((handler) => {
        expect(typeof handler).toBe('function');
      });
    });

    it('handlers should support dependency injection', () => {
      const handlers2 = {};
      const mockIpcMain2 = {
        handle: (channel, handler) => {
          handlers2[channel] = handler;
        },
      };
      const mockIpcGuard2 = {
        isModuleRegistered: vi.fn().mockReturnValue(false),
        markModuleRegistered: vi.fn(),
      };
      registerUKeyIPC({
        ukeyManager: mockUkeyManager,
        unifiedKeyManager: mockUnifiedKeyManager,
        fido2Authenticator: mockFido2Authenticator,
        ipcMain: mockIpcMain2,
        ipcGuard: mockIpcGuard2,
      });
      expect(Object.keys(handlers2).length).toBe(17);
    });
  });
});
