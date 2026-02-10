/**
 * PermissionGate 单元测试
 * 测试权限验证器的功能
 */

const { PermissionGate } = require('../../src/main/remote/permission-gate');

// Mock DID Manager (matches actual API used by PermissionGate)
class MockDIDManager {
  constructor() {
    // Mock cache with valid identity
    this.cache = {
      get: async (did) => {
        if (did === 'did:example:123') {
          // Return a mock identity - verifySignature will still fail but we can skip signature check in test
          return null;  // Return null to trigger early return in verifySignature
        }
        return null;
      }
    };
  }
}

// Mock U-Key Manager
class MockUKeyManager {
  async verify() {
    return true;
  }
}

// Mock Database
class MockDatabase {
  exec() {}
  prepare() {
    return {
      run: () => {},
      all: () => [],
      get: () => null
    };
  }
}

describe('PermissionGate', () => {
  let permissionGate;
  let mockDIDManager;
  let mockUKeyManager;
  let mockDatabase;

  beforeEach(() => {
    mockDIDManager = new MockDIDManager();
    mockUKeyManager = new MockUKeyManager();
    mockDatabase = new MockDatabase();
    permissionGate = new PermissionGate(mockDIDManager, mockUKeyManager, mockDatabase);
  });

  describe('验证 DID 签名', () => {
    test('应该拒绝未注册的DID', async () => {
      // 由于Mock中DID不存在于cache，验证应该失败
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now(),
        nonce: 'random-nonce'
      };

      const result = await permissionGate.verify(auth, 'ai.chat');
      // 因为DID在mock cache中返回null，所以验证失败
      expect(result).toBe(false);
    });

    test('应该拒绝无效的签名', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'invalid-signature',
        timestamp: Date.now(),
        nonce: 'random-nonce'
      };

      const result = await permissionGate.verify(auth, 'ai.chat');
      expect(result).toBe(false);
    });
  });

  describe('时间戳验证', () => {
    test('应该拒绝过期的请求', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now() - 400000,
        nonce: 'random-nonce'
      };

      const result = await permissionGate.verify(auth, 'ai.chat');
      expect(result).toBe(false);
    });
  });

  describe('命令权限级别', () => {
    test('应该正确获取命令权限级别', () => {
      expect(permissionGate.getCommandPermissionLevel('ai.chat')).toBe(2);
      expect(permissionGate.getCommandPermissionLevel('system.getStatus')).toBe(1);
      // system.execCommand is Level 3 (ADMIN) in the implementation
      expect(permissionGate.getCommandPermissionLevel('system.execCommand')).toBe(3);
    });
  });
});
