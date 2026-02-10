/**
 * PermissionGate 单元测试
 * 测试权限验证器的功能
 */

const { PermissionGate } = require('../../src/main/remote/permission-gate');

// Mock DID Manager
class MockDIDManager {
  async verifySignature(did, signature, data) {
    return signature === 'valid-signature';
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
    test('应该接受有效的签名', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now(),
        nonce: 'random-nonce'
      };

      const result = await permissionGate.verify(auth, 'ai.chat');
      expect(result).toBe(true);
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
