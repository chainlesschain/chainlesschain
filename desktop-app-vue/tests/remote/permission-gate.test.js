/**
 * 权限验证器单元测试
 *
 * 测试 DID 签名验证、权限等级、时间戳验证、Nonce 防重放、限流等功能
 */

const { describe, it, expect, beforeEach, afterEach, vi } = require('vitest');
const PermissionGate = require('../../src/main/remote/permission-gate');
const crypto = require('crypto');

describe('PermissionGate', () => {
  let permissionGate;
  let mockDatabase;
  let mockUKeyManager;

  beforeEach(() => {
    // Mock database
    mockDatabase = {
      prepare: vi.fn((sql) => ({
        get: vi.fn(),
        all: vi.fn(),
        run: vi.fn()
      }))
    };

    // Mock U-Key manager
    mockUKeyManager = {
      verifyPIN: vi.fn(() => Promise.resolve(true)),
      isConnected: vi.fn(() => true)
    };

    permissionGate = new PermissionGate({
      database: mockDatabase,
      ukeyManager: mockUKeyManager,
      timestampWindow: 5 * 60 * 1000, // 5 minutes
      maxRequestsPerMinute: 60
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('verifySignature', () => {
    it('should verify valid HMAC signature', async () => {
      const method = 'ai.chat';
      const timestamp = Date.now();
      const nonce = '123456';
      const did = 'did:example:123';

      // Create valid signature
      const signData = JSON.stringify({ method, timestamp, nonce });
      const sharedSecret = 'test-secret-key';
      const signature = crypto
        .createHmac('sha256', sharedSecret)
        .update(signData)
        .digest('base64');

      const auth = { did, signature, timestamp, nonce };

      // Mock database to return device with shared secret
      mockDatabase.prepare().get.mockReturnValue({
        did,
        shared_secret: sharedSecret,
        permission_level: 2
      });

      const result = await permissionGate.verifySignature(auth, method);
      expect(result).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'invalid-signature',
        timestamp: Date.now(),
        nonce: '123456'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret-key',
        permission_level: 2
      });

      const result = await permissionGate.verifySignature(auth, 'ai.chat');
      expect(result).toBe(false);
    });

    it('should reject unknown device', async () => {
      const auth = {
        did: 'did:example:unknown',
        signature: 'some-signature',
        timestamp: Date.now(),
        nonce: '123456'
      };

      mockDatabase.prepare().get.mockReturnValue(null);

      const result = await permissionGate.verifySignature(auth, 'ai.chat');
      expect(result).toBe(false);
    });
  });

  describe('timestamp validation', () => {
    it('should accept timestamp within window', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now(), // Current time
        nonce: '123456'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 2
      });

      // Mock verifySignature to return true
      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);

      const result = await permissionGate.verify(auth, 'ai.chat');
      expect(result).toBe(true);
    });

    it('should reject old timestamp', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
        nonce: '123456'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 2
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);

      const result = await permissionGate.verify(auth, 'ai.chat');
      expect(result).toBe(false);
    });

    it('should reject future timestamp', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now() + 10 * 60 * 1000, // 10 minutes in future
        nonce: '123456'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 2
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);

      const result = await permissionGate.verify(auth, 'ai.chat');
      expect(result).toBe(false);
    });
  });

  describe('nonce validation (replay attack prevention)', () => {
    it('should accept new nonce', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now(),
        nonce: 'unique-nonce-12345'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 2
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);

      const result = await permissionGate.verify(auth, 'ai.chat');
      expect(result).toBe(true);
    });

    it('should reject reused nonce (replay attack)', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now(),
        nonce: 'reused-nonce'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 2
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);

      // First request should succeed
      const result1 = await permissionGate.verify(auth, 'ai.chat');
      expect(result1).toBe(true);

      // Second request with same nonce should fail
      const result2 = await permissionGate.verify(auth, 'ai.chat');
      expect(result2).toBe(false);
    });
  });

  describe('permission levels', () => {
    it('should allow PUBLIC command (level 1) for any device', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now(),
        nonce: 'nonce-1'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 1 // Public level
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);

      const result = await permissionGate.verify(auth, 'system.getInfo');
      expect(result).toBe(true);
    });

    it('should allow NORMAL command (level 2) for level 2+ device', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now(),
        nonce: 'nonce-2'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 2
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);

      const result = await permissionGate.verify(auth, 'ai.chat');
      expect(result).toBe(true);
    });

    it('should deny ADMIN command (level 3) for level 2 device', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now(),
        nonce: 'nonce-3'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 2 // Not admin
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);

      const result = await permissionGate.verify(auth, 'system.execCommand');
      expect(result).toBe(false);
    });

    it('should allow ROOT command (level 4) with valid U-Key', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now(),
        nonce: 'nonce-4'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 4 // Root level
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);
      mockUKeyManager.verifyPIN.mockResolvedValue(true);
      mockUKeyManager.isConnected.mockReturnValue(true);

      const result = await permissionGate.verify(auth, 'system.shutdown');
      expect(result).toBe(true);
      expect(mockUKeyManager.verifyPIN).toHaveBeenCalled();
    });

    it('should deny ROOT command without U-Key', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now(),
        nonce: 'nonce-5'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 4
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);
      mockUKeyManager.isConnected.mockReturnValue(false); // U-Key not connected

      const result = await permissionGate.verify(auth, 'system.shutdown');
      expect(result).toBe(false);
    });
  });

  describe('rate limiting', () => {
    it('should allow requests within rate limit', async () => {
      const did = 'did:example:123';

      mockDatabase.prepare().get.mockReturnValue({
        did,
        shared_secret: 'test-secret',
        permission_level: 2
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);

      // Send 30 requests (within 60 per minute limit)
      for (let i = 0; i < 30; i++) {
        const auth = {
          did,
          signature: 'valid-signature',
          timestamp: Date.now(),
          nonce: `nonce-${i}`
        };
        const result = await permissionGate.verify(auth, 'ai.chat');
        expect(result).toBe(true);
      }
    });

    it('should block requests exceeding rate limit', async () => {
      const did = 'did:example:123';

      mockDatabase.prepare().get.mockReturnValue({
        did,
        shared_secret: 'test-secret',
        permission_level: 2
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);

      // Send 65 requests (exceeds 60 per minute limit)
      let successCount = 0;
      let blockedCount = 0;

      for (let i = 0; i < 65; i++) {
        const auth = {
          did,
          signature: 'valid-signature',
          timestamp: Date.now(),
          nonce: `nonce-limit-${i}`
        };
        const result = await permissionGate.verify(auth, 'ai.chat');
        if (result) successCount++;
        else blockedCount++;
      }

      expect(successCount).toBeLessThanOrEqual(60);
      expect(blockedCount).toBeGreaterThan(0);
    });
  });

  describe('audit logging', () => {
    it('should log successful verification', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'valid-signature',
        timestamp: Date.now(),
        nonce: 'audit-nonce-1'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 2
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(true);

      const mockAuditLog = vi.fn();
      permissionGate.on('audit', mockAuditLog);

      await permissionGate.verify(auth, 'ai.chat');

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          did: 'did:example:123',
          method: 'ai.chat',
          result: 'success'
        })
      );
    });

    it('should log failed verification with reason', async () => {
      const auth = {
        did: 'did:example:123',
        signature: 'invalid-signature',
        timestamp: Date.now(),
        nonce: 'audit-nonce-2'
      };

      mockDatabase.prepare().get.mockReturnValue({
        did: 'did:example:123',
        shared_secret: 'test-secret',
        permission_level: 2
      });

      vi.spyOn(permissionGate, 'verifySignature').mockResolvedValue(false);

      const mockAuditLog = vi.fn();
      permissionGate.on('audit', mockAuditLog);

      await permissionGate.verify(auth, 'ai.chat');

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          did: 'did:example:123',
          method: 'ai.chat',
          result: 'failure',
          reason: expect.any(String)
        })
      );
    });
  });

  describe('device management', () => {
    it('should register new device', async () => {
      const deviceInfo = {
        did: 'did:example:new-device',
        name: 'Test Device',
        permissionLevel: 2,
        sharedSecret: 'new-secret-key'
      };

      mockDatabase.prepare().run.mockReturnValue({ changes: 1 });

      const result = await permissionGate.registerDevice(deviceInfo);
      expect(result).toBe(true);
      expect(mockDatabase.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO remote_devices')
      );
    });

    it('should revoke device access', async () => {
      const did = 'did:example:revoked';

      mockDatabase.prepare().run.mockReturnValue({ changes: 1 });

      const result = await permissionGate.revokeDevice(did);
      expect(result).toBe(true);
      expect(mockDatabase.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE remote_devices')
      );
    });

    it('should update device permission level', async () => {
      const did = 'did:example:update';
      const newLevel = 3;

      mockDatabase.prepare().run.mockReturnValue({ changes: 1 });

      const result = await permissionGate.updateDevicePermission(did, newLevel);
      expect(result).toBe(true);
    });
  });
});
