/**
 * U-Key IPC 单元测试
 * 测试 U-Key 硬件 IPC 处理器的所有功能
 */

const { ipcMain } = require('electron');
const { registerUKeyIPC } = require('../../../desktop-app-vue/src/main/ukey/ukey-ipc');

// Mock ipcMain
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
}));

describe('U-Key IPC Handlers', () => {
  let mockUKeyManager;
  let handlers = {};

  beforeEach(() => {
    // 清除所有 mocks
    jest.clearAllMocks();
    handlers = {};

    // 创建 mock U-Key 管理器
    mockUKeyManager = {
      detect: jest.fn(),
      verifyPIN: jest.fn(),
      getDeviceInfo: jest.fn(),
      sign: jest.fn(),
      encrypt: jest.fn(),
      decrypt: jest.fn(),
      lock: jest.fn(),
      getPublicKey: jest.fn(),
    };

    // 捕获所有注册的 handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 IPC handlers
    registerUKeyIPC({ ukeyManager: mockUKeyManager });
  });

  afterEach(() => {
    handlers = {};
  });

  // ============================================================
  // U-Key 硬件检测与管理测试
  // ============================================================

  describe('ukey:detect', () => {
    it('should detect U-Key device successfully', async () => {
      const mockDetectResult = {
        detected: true,
        unlocked: false,
        deviceInfo: {
          model: 'SIMKey',
          version: '1.0.0',
        },
      };

      mockUKeyManager.detect.mockResolvedValue(mockDetectResult);

      const handler = handlers['ukey:detect'];
      const result = await handler();

      expect(mockUKeyManager.detect).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockDetectResult);
    });

    it('should return error when U-Key manager is not initialized', async () => {
      registerUKeyIPC({ ukeyManager: null });
      const handler = handlers['ukey:detect'];
      const result = await handler();

      expect(result).toEqual({
        detected: false,
        unlocked: false,
        error: 'U盾管理器未初始化',
      });
    });

    it('should handle detection errors gracefully', async () => {
      mockUKeyManager.detect.mockRejectedValue(new Error('设备未连接'));

      const handler = handlers['ukey:detect'];
      const result = await handler();

      expect(result).toEqual({
        detected: false,
        unlocked: false,
        error: '设备未连接',
      });
    });
  });

  describe('ukey:verify-pin', () => {
    it('should verify PIN successfully', async () => {
      const mockVerifyResult = {
        success: true,
        unlocked: true,
      };

      mockUKeyManager.verifyPIN.mockResolvedValue(mockVerifyResult);

      const handler = handlers['ukey:verify-pin'];
      const result = await handler(null, '123456');

      expect(mockUKeyManager.verifyPIN).toHaveBeenCalledWith('123456');
      expect(result).toEqual(mockVerifyResult);
    });

    it('should return error for incorrect PIN', async () => {
      const mockVerifyResult = {
        success: false,
        error: 'PIN码错误',
        remainingAttempts: 2,
      };

      mockUKeyManager.verifyPIN.mockResolvedValue(mockVerifyResult);

      const handler = handlers['ukey:verify-pin'];
      const result = await handler(null, '000000');

      expect(result).toEqual(mockVerifyResult);
    });

    it('should return error when U-Key manager is not initialized', async () => {
      registerUKeyIPC({ ukeyManager: null });
      const handler = handlers['ukey:verify-pin'];
      const result = await handler(null, '123456');

      expect(result).toEqual({
        success: false,
        error: 'U盾管理器未初始化',
      });
    });

    it('should handle PIN verification errors', async () => {
      mockUKeyManager.verifyPIN.mockRejectedValue(new Error('验证超时'));

      const handler = handlers['ukey:verify-pin'];
      const result = await handler(null, '123456');

      expect(result).toEqual({
        success: false,
        error: '验证超时',
      });
    });
  });

  describe('ukey:get-device-info', () => {
    it('should get device info successfully', async () => {
      const mockDeviceInfo = {
        model: 'SIMKey',
        version: '1.0.0',
        serialNumber: 'SK123456789',
        manufacturer: 'ChainlessChain',
      };

      mockUKeyManager.getDeviceInfo.mockResolvedValue(mockDeviceInfo);

      const handler = handlers['ukey:get-device-info'];
      const result = await handler();

      expect(mockUKeyManager.getDeviceInfo).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockDeviceInfo);
    });

    it('should throw error when U-Key manager is not initialized', async () => {
      registerUKeyIPC({ ukeyManager: null });
      const handler = handlers['ukey:get-device-info'];

      await expect(handler()).rejects.toThrow('U盾管理器未初始化');
    });

    it('should throw error when device info retrieval fails', async () => {
      mockUKeyManager.getDeviceInfo.mockRejectedValue(new Error('读取失败'));

      const handler = handlers['ukey:get-device-info'];

      await expect(handler()).rejects.toThrow('读取失败');
    });
  });

  // ============================================================
  // 加密签名功能测试
  // ============================================================

  describe('ukey:sign', () => {
    it('should sign data successfully', async () => {
      const testData = 'test-data-to-sign';
      const mockSignature = 'mock-signature-base64';

      mockUKeyManager.sign.mockResolvedValue(mockSignature);

      const handler = handlers['ukey:sign'];
      const result = await handler(null, testData);

      expect(mockUKeyManager.sign).toHaveBeenCalledWith(testData);
      expect(result).toBe(mockSignature);
    });

    it('should throw error when U-Key manager is not initialized', async () => {
      registerUKeyIPC({ ukeyManager: null });
      const handler = handlers['ukey:sign'];

      await expect(handler(null, 'test-data')).rejects.toThrow('U盾管理器未初始化');
    });

    it('should throw error when signing fails', async () => {
      mockUKeyManager.sign.mockRejectedValue(new Error('签名失败'));

      const handler = handlers['ukey:sign'];

      await expect(handler(null, 'test-data')).rejects.toThrow('签名失败');
    });
  });

  describe('ukey:encrypt', () => {
    it('should encrypt data successfully', async () => {
      const testData = 'sensitive-data';
      const mockEncrypted = 'encrypted-base64-string';

      mockUKeyManager.encrypt.mockResolvedValue(mockEncrypted);

      const handler = handlers['ukey:encrypt'];
      const result = await handler(null, testData);

      expect(mockUKeyManager.encrypt).toHaveBeenCalledWith(testData);
      expect(result).toBe(mockEncrypted);
    });

    it('should throw error when U-Key manager is not initialized', async () => {
      registerUKeyIPC({ ukeyManager: null });
      const handler = handlers['ukey:encrypt'];

      await expect(handler(null, 'test-data')).rejects.toThrow('U盾管理器未初始化');
    });

    it('should throw error when encryption fails', async () => {
      mockUKeyManager.encrypt.mockRejectedValue(new Error('加密失败'));

      const handler = handlers['ukey:encrypt'];

      await expect(handler(null, 'test-data')).rejects.toThrow('加密失败');
    });
  });

  describe('ukey:decrypt', () => {
    it('should decrypt data successfully', async () => {
      const encryptedData = 'encrypted-base64-string';
      const mockDecrypted = 'decrypted-sensitive-data';

      mockUKeyManager.decrypt.mockResolvedValue(mockDecrypted);

      const handler = handlers['ukey:decrypt'];
      const result = await handler(null, encryptedData);

      expect(mockUKeyManager.decrypt).toHaveBeenCalledWith(encryptedData);
      expect(result).toBe(mockDecrypted);
    });

    it('should throw error when U-Key manager is not initialized', async () => {
      registerUKeyIPC({ ukeyManager: null });
      const handler = handlers['ukey:decrypt'];

      await expect(handler(null, 'encrypted-data')).rejects.toThrow('U盾管理器未初始化');
    });

    it('should throw error when decryption fails', async () => {
      mockUKeyManager.decrypt.mockRejectedValue(new Error('解密失败'));

      const handler = handlers['ukey:decrypt'];

      await expect(handler(null, 'encrypted-data')).rejects.toThrow('解密失败');
    });
  });

  // ============================================================
  // U-Key 管理功能测试
  // ============================================================

  describe('ukey:lock', () => {
    it('should lock U-Key successfully', async () => {
      mockUKeyManager.lock.mockReturnValue(undefined);

      const handler = handlers['ukey:lock'];
      const result = await handler();

      expect(mockUKeyManager.lock).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('should throw error when U-Key manager is not initialized', async () => {
      registerUKeyIPC({ ukeyManager: null });
      const handler = handlers['ukey:lock'];

      await expect(handler()).rejects.toThrow('U盾管理器未初始化');
    });

    it('should throw error when lock operation fails', async () => {
      mockUKeyManager.lock.mockImplementation(() => {
        throw new Error('锁定失败');
      });

      const handler = handlers['ukey:lock'];

      await expect(handler()).rejects.toThrow('锁定失败');
    });
  });

  describe('ukey:get-public-key', () => {
    it('should get public key successfully', async () => {
      const mockPublicKey = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----';

      mockUKeyManager.getPublicKey.mockResolvedValue(mockPublicKey);

      const handler = handlers['ukey:get-public-key'];
      const result = await handler();

      expect(mockUKeyManager.getPublicKey).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockPublicKey);
    });

    it('should throw error when U-Key manager is not initialized', async () => {
      registerUKeyIPC({ ukeyManager: null });
      const handler = handlers['ukey:get-public-key'];

      await expect(handler()).rejects.toThrow('U盾管理器未初始化');
    });

    it('should throw error when public key retrieval fails', async () => {
      mockUKeyManager.getPublicKey.mockRejectedValue(new Error('读取公钥失败'));

      const handler = handlers['ukey:get-public-key'];

      await expect(handler()).rejects.toThrow('读取公钥失败');
    });
  });

  // ============================================================
  // 备用认证（密码登录）测试
  // ============================================================

  describe('auth:verify-password', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // 重置环境变量
      process.env = { ...originalEnv };
      process.env.DEFAULT_USERNAME = 'admin';
      process.env.DEFAULT_PASSWORD = '123456';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should verify password successfully with correct credentials', async () => {
      const handler = handlers['auth:verify-password'];
      const result = await handler(null, 'admin', '123456');

      expect(result).toEqual({
        success: true,
        userId: 'local-user',
        username: 'admin',
      });
    });

    it('should fail with incorrect username', async () => {
      const handler = handlers['auth:verify-password'];
      const result = await handler(null, 'wronguser', '123456');

      expect(result).toEqual({
        success: false,
        error: '用户名或密码错误',
      });
    });

    it('should fail with incorrect password', async () => {
      const handler = handlers['auth:verify-password'];
      const result = await handler(null, 'admin', 'wrongpassword');

      expect(result).toEqual({
        success: false,
        error: '用户名或密码错误',
      });
    });

    it('should use default credentials when env vars not set', async () => {
      delete process.env.DEFAULT_USERNAME;
      delete process.env.DEFAULT_PASSWORD;

      // 重新注册以应用新的环境变量
      jest.clearAllMocks();
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });
      registerUKeyIPC({ ukeyManager: mockUKeyManager });

      const handler = handlers['auth:verify-password'];
      const result = await handler(null, 'admin', '123456');

      expect(result.success).toBe(true);
    });

    it('should handle password verification errors', async () => {
      const handler = handlers['auth:verify-password'];

      // 模拟异常情况 - 传入 undefined
      const result = await handler(null, undefined, undefined);

      expect(result).toEqual({
        success: false,
        error: '用户名或密码错误',
      });
    });
  });

  // ============================================================
  // 注册测试
  // ============================================================

  describe('registerUKeyIPC', () => {
    it('should register all 9 IPC handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledTimes(9);

      const registeredChannels = ipcMain.handle.mock.calls.map(call => call[0]);

      expect(registeredChannels).toContain('ukey:detect');
      expect(registeredChannels).toContain('ukey:verify-pin');
      expect(registeredChannels).toContain('ukey:get-device-info');
      expect(registeredChannels).toContain('ukey:sign');
      expect(registeredChannels).toContain('ukey:encrypt');
      expect(registeredChannels).toContain('ukey:decrypt');
      expect(registeredChannels).toContain('ukey:lock');
      expect(registeredChannels).toContain('ukey:get-public-key');
      expect(registeredChannels).toContain('auth:verify-password');
    });

    it('should handle registration with null ukeyManager', () => {
      jest.clearAllMocks();

      expect(() => {
        registerUKeyIPC({ ukeyManager: null });
      }).not.toThrow();

      expect(ipcMain.handle).toHaveBeenCalled();
    });
  });
});
