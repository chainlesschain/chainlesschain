/**
 * TEE 集成单元测试
 * 测试目标: src/main/ukey/tee-integration.js
 * 覆盖场景: TEE检测、密钥生成、签名、密封存储、远程证明
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// Mock logger FIRST
// ============================================================

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn()
};

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger)
}));

// ============================================================
// Import module under test
// ============================================================

import { TeeIntegration, TEE_TYPE, TEE_SECURITY_LEVEL, TEE_CAPABILITY } from '../../../src/main/ukey/tee-integration.js';

describe('TeeIntegration', () => {
  let tee;

  beforeEach(async () => {
    vi.clearAllMocks();
    tee = new TeeIntegration({ enableTrustedUI: true });
    await tee.initialize();
  });

  afterEach(async () => {
    await tee.close();
  });

  // ============================================================
  // 初始化
  // ============================================================

  describe('initialize()', () => {
    it('should initialize in simulation mode when no hardware TEE', async () => {
      const freshTee = new TeeIntegration({});
      const result = await freshTee.initialize();
      expect(result).toBe(true);
      await freshTee.close();
    });

    it('should be idempotent', async () => {
      const result = await tee.initialize();
      expect(result).toBe(true);
    });

    it('should return TEE info after initialization', () => {
      const info = tee.getTeeInfo();
      expect(info).toHaveProperty('type');
      expect(info).toHaveProperty('securityLevel');
      expect(info).toHaveProperty('capabilities');
      expect(Array.isArray(info.capabilities)).toBe(true);
    });
  });

  // ============================================================
  // 密钥生成
  // ============================================================

  describe('generateKeyInTee()', () => {
    it('should generate an EC-256 key in TEE', async () => {
      const keyHandle = await tee.generateKeyInTee({ algorithm: 'ec256' });
      expect(keyHandle).toHaveProperty('keyId');
      expect(keyHandle).toHaveProperty('algorithm', 'ec256');
      expect(keyHandle).toHaveProperty('publicKey');
      expect(keyHandle).toHaveProperty('privateKeyLocation', 'tee_secure_storage');
      expect(keyHandle.keyId).toMatch(/^tee-/);
    });

    it('should generate an EC-384 key in TEE', async () => {
      const keyHandle = await tee.generateKeyInTee({ algorithm: 'ec384' });
      expect(keyHandle.algorithm).toBe('ec384');
    });

    it('should set biometric binding flag', async () => {
      const keyHandle = await tee.generateKeyInTee({
        algorithm: 'ec256',
        biometricBound: true
      });
      expect(keyHandle.biometricBound).toBe(true);
    });

    it('should set requireAuth flag', async () => {
      const keyHandle = await tee.generateKeyInTee({
        algorithm: 'ec256',
        requireAuth: false
      });
      expect(keyHandle.requireAuth).toBe(false);
    });

    it('should store key handle for later use', async () => {
      const keyHandle = await tee.generateKeyInTee({ algorithm: 'ec256' });
      // Should be able to sign with it
      const sigResult = await tee.signInTee(keyHandle.keyId, Buffer.from('test'));
      expect(sigResult.success).toBe(true);
    });
  });

  // ============================================================
  // 签名
  // ============================================================

  describe('signInTee()', () => {
    let keyHandle;

    beforeEach(async () => {
      keyHandle = await tee.generateKeyInTee({ algorithm: 'ec256', requireAuth: false });
    });

    it('should sign Buffer data', async () => {
      const result = await tee.signInTee(keyHandle.keyId, Buffer.from('hello TEE'));
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('keyId', keyHandle.keyId);
      expect(result.algorithm).toBe('ec256');
    });

    it('should sign string data', async () => {
      const result = await tee.signInTee(keyHandle.keyId, 'string data');
      expect(result.success).toBe(true);
      expect(typeof result.signature).toBe('string');
    });

    it('should throw for non-existent key', async () => {
      await expect(tee.signInTee('non-existent-key', 'data')).rejects.toThrow('TEE 密钥不存在');
    });

    it('should include teeType in result', async () => {
      const result = await tee.signInTee(keyHandle.keyId, 'data');
      expect(result).toHaveProperty('teeType');
      expect(Object.values(TEE_TYPE)).toContain(result.teeType);
    });
  });

  // ============================================================
  // 加密
  // ============================================================

  describe('encryptInTee()', () => {
    let keyHandle;

    beforeEach(async () => {
      keyHandle = await tee.generateKeyInTee({ algorithm: 'ec256', requireAuth: false });
    });

    it('should encrypt data', async () => {
      const result = await tee.encryptInTee(keyHandle.keyId, Buffer.from('secret data'));
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('ciphertext');
      expect(result).toHaveProperty('iv');
      expect(result).toHaveProperty('authTag');
    });

    it('should encrypt string data', async () => {
      const result = await tee.encryptInTee(keyHandle.keyId, 'plaintext string');
      expect(result.success).toBe(true);
      expect(typeof result.ciphertext).toBe('string');
    });

    it('should throw for non-existent key', async () => {
      await expect(tee.encryptInTee('ghost', 'data')).rejects.toThrow('TEE 密钥不存在');
    });
  });

  // ============================================================
  // 双重签名
  // ============================================================

  describe('dualSign()', () => {
    it('should perform dual sign with SIMKey and TEE', async () => {
      const keyHandle = await tee.generateKeyInTee({ algorithm: 'ec256', requireAuth: false });
      const mockSimkeySign = vi.fn().mockResolvedValue({ signature: 'simkey-sig-base64' });

      const result = await tee.dualSign(keyHandle.keyId, mockSimkeySign, Buffer.from('tx-data'));
      expect(result.success).toBe(true);
      expect(result.dualSignature).toHaveProperty('tee');
      expect(result.dualSignature).toHaveProperty('simkey');
      expect(result.dualSignature.tee.keyId).toBe(keyHandle.keyId);
      expect(result.securityLevel).toBe('dual_hardware');
    });

    it('should call simkeySignFn with data', async () => {
      const keyHandle = await tee.generateKeyInTee({ algorithm: 'ec256', requireAuth: false });
      const mockSimkeySign = vi.fn().mockResolvedValue('raw-sig');
      const data = Buffer.from('dual-sign-data');
      await tee.dualSign(keyHandle.keyId, mockSimkeySign, data);
      expect(mockSimkeySign).toHaveBeenCalledWith(data);
    });
  });

  // ============================================================
  // 密封存储
  // ============================================================

  describe('sealData() / unsealData()', () => {
    it('should seal and unseal data', async () => {
      const original = { secret: 'my-secret', count: 42 };
      const sealed = await tee.sealData(original, 'test-label');

      expect(sealed).toHaveProperty('sealed');
      expect(sealed).toHaveProperty('iv');
      expect(sealed).toHaveProperty('authTag');
      expect(sealed.label).toBe('test-label');

      const unsealed = await tee.unsealData(sealed);
      const parsed = JSON.parse(unsealed.toString());
      expect(parsed).toEqual(original);
    });

    it('should seal Buffer data', async () => {
      const buf = Buffer.from('raw buffer data');
      const sealed = await tee.sealData(buf, 'buf-label');
      expect(sealed.sealed).toBeDefined();
    });

    it('should use different sealing keys for different labels', async () => {
      const data = { value: 'test' };
      const seal1 = await tee.sealData(data, 'label1');
      const seal2 = await tee.sealData(data, 'label2');
      // Different labels → different IVs/ciphertexts
      expect(seal1.iv).not.toBe(seal2.iv);
    });
  });

  // ============================================================
  // 远程证明
  // ============================================================

  describe('generateAttestationReport()', () => {
    it('should generate an attestation report', async () => {
      const report = await tee.generateAttestationReport('test-nonce-123');
      expect(report).toHaveProperty('version', '1.0');
      expect(report).toHaveProperty('teeType');
      expect(report).toHaveProperty('nonce', 'test-nonce-123');
      expect(report).toHaveProperty('measurements');
      expect(report).toHaveProperty('signature');
      expect(report.measurements.secureBootState).toBe(true);
      expect(report.measurements.tamperDetected).toBe(false);
    });

    it('should generate a nonce if not provided', async () => {
      const report = await tee.generateAttestationReport();
      expect(report.nonce).toBeDefined();
      expect(report.nonce.length).toBeGreaterThan(0);
    });
  });

  describe('verifyAttestationReport()', () => {
    it('should verify a valid report', async () => {
      const report = await tee.generateAttestationReport('nonce-verify');
      const result = await tee.verifyAttestationReport(report);
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('checks');
      expect(result).toHaveProperty('trustLevel');
    });

    it('should flag missing nonce', async () => {
      const report = await tee.generateAttestationReport('nonce-x');
      const badReport = { ...report, nonce: null };
      const result = await tee.verifyAttestationReport(badReport);
      expect(result.checks.nonceValid).toBe(false);
    });

    it('should flag stale timestamp', async () => {
      const report = await tee.generateAttestationReport('nonce-stale');
      const staleReport = { ...report, timestamp: new Date(Date.now() - 600000).toISOString() };
      const result = await tee.verifyAttestationReport(staleReport);
      expect(result.checks.timestampRecent).toBe(false);
    });
  });

  // ============================================================
  // Trusted UI
  // ============================================================

  describe('requestPinViaTrustedUI()', () => {
    it('should return a result object', async () => {
      const result = await tee.requestPinViaTrustedUI('请输入PIN');
      expect(result).toHaveProperty('success');
    });
  });

  // ============================================================
  // 关闭
  // ============================================================

  describe('close()', () => {
    it('should clean up resources', async () => {
      const freshTee = new TeeIntegration({});
      await freshTee.initialize();
      await freshTee.generateKeyInTee({ algorithm: 'ec256', requireAuth: false });
      await freshTee.close();
      // After close, should throw
      await expect(freshTee.signInTee('any-id', 'data')).rejects.toThrow('TEE 未初始化');
    });
  });
});
