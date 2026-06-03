/**
 * SIMKey 零知识证明单元测试
 * 测试目标: src/main/ukey/simkey-zkp.js
 * 覆盖场景: 身份证明、范围证明、成员证明、选择性披露、证明验证
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

import { SimkeyZkp, ZKP_TYPE, ZKP_SCHEME } from '../../../src/main/ukey/simkey-zkp.js';

describe('SimkeyZkp', () => {
  let zkp;
  let mockSimkeySign;

  beforeEach(async () => {
    vi.clearAllMocks();
    zkp = new SimkeyZkp({ proofCacheSize: 20 });
    await zkp.initialize();

    // Standard mock for SIMKey sign function
    mockSimkeySign = vi.fn().mockImplementation(async (data) => ({
      signature: Buffer.from(`simkey-sig-${Date.now()}`).toString('base64')
    }));
  });

  afterEach(async () => {
    await zkp.close();
  });

  // ============================================================
  // 初始化
  // ============================================================

  describe('initialize()', () => {
    it('should initialize successfully', async () => {
      const freshZkp = new SimkeyZkp({});
      const result = await freshZkp.initialize();
      expect(result).toBe(true);
      await freshZkp.close();
    });

    it('should be idempotent', async () => {
      const result = await zkp.initialize();
      expect(result).toBe(true);
    });

    it('should throw when calling methods before init', async () => {
      const uninitZkp = new SimkeyZkp({});
      await expect(uninitZkp.proveIdentity('did:cc:test', 'challenge', mockSimkeySign))
        .rejects.toThrow('ZKP 模块未初始化');
      await uninitZkp.close();
    });
  });

  // ============================================================
  // 身份证明
  // ============================================================

  describe('proveIdentity()', () => {
    it('should generate an identity proof', async () => {
      const proof = await zkp.proveIdentity(
        'did:cc:Qm1234567890',
        'random-challenge-abc',
        mockSimkeySign
      );

      expect(proof).toHaveProperty('type', ZKP_TYPE.IDENTITY);
      expect(proof).toHaveProperty('scheme', ZKP_SCHEME.PLONK);
      expect(proof).toHaveProperty('commitment');
      expect(proof).toHaveProperty('challenge', 'random-challenge-abc');
      expect(proof).toHaveProperty('response');
      expect(proof).toHaveProperty('simkeySignature');
      expect(proof).toHaveProperty('did', 'did:cc:Qm1234567890');
      expect(proof).toHaveProperty('proofId');
      expect(proof.proofId).toMatch(/^zkp-/);
    });

    it('should call simkeySignFn with combined data', async () => {
      await zkp.proveIdentity('did:cc:test', 'challenge', mockSimkeySign);
      expect(mockSimkeySign).toHaveBeenCalledTimes(1);
      // The sign function receives a Buffer
      const callArg = mockSimkeySign.mock.calls[0][0];
      expect(Buffer.isBuffer(callArg)).toBe(true);
    });

    it('should cache the proof', async () => {
      const proof = await zkp.proveIdentity('did:cc:abc', 'ch', mockSimkeySign);
      const cached = zkp.getProof(proof.proofId);
      expect(cached).toBeDefined();
      expect(cached.proofId).toBe(proof.proofId);
    });
  });

  // ============================================================
  // 年龄范围证明
  // ============================================================

  describe('proveAgeRange()', () => {
    it('should prove age >= threshold when condition met', async () => {
      const result = await zkp.proveAgeRange(25, 18, mockSimkeySign);
      expect(result.success).toBe(true);
      expect(result.proof.type).toBe(ZKP_TYPE.AGE_RANGE);
      expect(result.proof.scheme).toBe(ZKP_SCHEME.BULLETPROOFS);
      expect(result.proof.threshold).toBe(18);
      expect(result.proof).toHaveProperty('rangeProof');
      expect(result.proof).toHaveProperty('simkeySignature');
    });

    it('should fail when age < threshold', async () => {
      const result = await zkp.proveAgeRange(16, 18, mockSimkeySign);
      expect(result.success).toBe(false);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('年龄不满足条件');
    });

    it('should succeed when age equals threshold exactly', async () => {
      const result = await zkp.proveAgeRange(18, 18, mockSimkeySign);
      expect(result.success).toBe(true);
    });

    it('should call simkeySignFn', async () => {
      await zkp.proveAgeRange(21, 18, mockSimkeySign);
      expect(mockSimkeySign).toHaveBeenCalledTimes(1);
    });

    it('should cache successful proof', async () => {
      const result = await zkp.proveAgeRange(25, 18, mockSimkeySign);
      const cached = zkp.getProof(result.proof.proofId);
      expect(cached).toBeDefined();
    });
  });

  // ============================================================
  // 资产范围证明
  // ============================================================

  describe('proveAssetRange()', () => {
    it('should prove asset >= minAmount', async () => {
      const result = await zkp.proveAssetRange(1500000, 1000000, 'CNY', mockSimkeySign);
      expect(result.success).toBe(true);
      expect(result.proof.type).toBe(ZKP_TYPE.ASSET_RANGE);
      expect(result.proof.assetType).toBe('CNY');
      expect(result.proof.minAmount).toBe(1000000);
    });

    it('should fail when amount < minAmount', async () => {
      const result = await zkp.proveAssetRange(500000, 1000000, 'CNY', mockSimkeySign);
      expect(result.success).toBe(false);
      expect(result.error).toContain('资产不满足条件');
    });

    it('should succeed with exact amount', async () => {
      const result = await zkp.proveAssetRange(1000000, 1000000, 'CNY', mockSimkeySign);
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // 成员证明
  // ============================================================

  describe('proveMembership()', () => {
    const buildMerkleTree = (leaves) => {
      const crypto = require('crypto');
      const hashes = leaves.map(l => crypto.createHash('sha256').update(l).digest());
      const root = (function buildRoot(h) {
        if (h.length === 1) return h[0];
        const next = [];
        for (let i = 0; i < h.length; i += 2) {
          const l = h[i], r = h[i + 1] || l;
          next.push(crypto.createHash('sha256').update(Buffer.concat([l, r].sort(Buffer.compare))).digest());
        }
        return buildRoot(next);
      })(hashes);
      return root.toString('hex');
    };

    it('should prove membership in a single-member set', async () => {
      // Single member: root = sha256(member), merklePath = []
      const members = ['alice'];
      const merkleRoot = buildMerkleTree(members);

      const result = await zkp.proveMembership('alice', merkleRoot, [], mockSimkeySign);
      expect(result.success).toBe(true);
      expect(result.proof.type).toBe(ZKP_TYPE.MEMBERSHIP);
      expect(result.proof.merkleRoot).toBe(merkleRoot);
      expect(result.proof).toHaveProperty('blindedMember');
    });

    it('should fail when member is not in the set', async () => {
      // 'charlie' is hashed separately; its hash ≠ sha256('alice')
      const merkleRoot = buildMerkleTree(['alice']);
      const result = await zkp.proveMembership('charlie', merkleRoot, [], mockSimkeySign);
      expect(result.success).toBe(false);
      expect(result.error).toContain('成员不在集合中');
    });
  });

  // ============================================================
  // 选择性披露
  // ============================================================

  describe('selectiveDisclose()', () => {
    const fullCredential = {
      credentialSubject: {
        name: '张三',
        school: '清华大学',
        degree: '硕士',
        gpa: '3.8',
        graduationYear: 2020
      }
    };

    it('should disclose only specified fields', async () => {
      const result = await zkp.selectiveDisclose(
        fullCredential,
        ['degree'],
        mockSimkeySign
      );
      expect(result.success).toBe(true);
      expect(result.proof.type).toBe(ZKP_TYPE.CREDENTIAL);
      expect(result.proof.scheme).toBe(ZKP_SCHEME.BBS_PLUS);
      expect(result.proof.disclosedView).toHaveProperty('degree', '硕士');
      expect(result.proof.disclosedView).not.toHaveProperty('name');
      expect(result.proof.disclosedView).not.toHaveProperty('gpa');
    });

    it('should create blind commitments for hidden fields', async () => {
      const result = await zkp.selectiveDisclose(fullCredential, ['degree'], mockSimkeySign);
      expect(result.proof.blindCommitments).toBeDefined();
      expect(Object.keys(result.proof.blindCommitments).length).toBeGreaterThan(0);
    });

    it('should track hidden field count', async () => {
      const result = await zkp.selectiveDisclose(
        fullCredential,
        ['degree', 'school'],
        mockSimkeySign
      );
      expect(result.proof.hiddenFieldCount).toBe(3); // 5 total - 2 disclosed = 3 hidden
    });

    it('should disclose multiple fields', async () => {
      const result = await zkp.selectiveDisclose(
        fullCredential,
        ['degree', 'graduationYear'],
        mockSimkeySign
      );
      expect(result.proof.disclosedView).toHaveProperty('degree');
      expect(result.proof.disclosedView).toHaveProperty('graduationYear');
    });
  });

  // ============================================================
  // 证明验证
  // ============================================================

  describe('verifyProof()', () => {
    it('should verify a valid identity proof', async () => {
      const proof = await zkp.proveIdentity('did:cc:test', 'ch', mockSimkeySign);
      const result = await zkp.verifyProof(proof);
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('checks');
      expect(result.checks.typeValid).toBe(true);
      expect(result.checks.schemeValid).toBe(true);
      expect(result.checks.hasSignature).toBe(true);
      expect(result.checks.timestampRecent).toBe(true);
    });

    it('should verify a valid age range proof', async () => {
      const ageResult = await zkp.proveAgeRange(25, 18, mockSimkeySign);
      const result = await zkp.verifyProof(ageResult.proof);
      expect(result.checks.rangeProofValid).toBe(true);
    });

    it('should reject proof with unknown type', async () => {
      const fakeProof = {
        type: 'unknown_type',
        scheme: ZKP_SCHEME.PLONK,
        simkeySignature: 'sig',
        createdAt: new Date().toISOString(),
        proofId: 'zkp-test'
      };
      const result = await zkp.verifyProof(fakeProof);
      expect(result.checks.typeValid).toBe(false);
    });

    it('should flag missing signature', async () => {
      const proof = await zkp.proveIdentity('did:cc:test', 'ch', mockSimkeySign);
      const badProof = { ...proof, simkeySignature: null };
      const result = await zkp.verifyProof(badProof);
      expect(result.checks.hasSignature).toBe(false);
    });
  });

  // ============================================================
  // 证明缓存
  // ============================================================

  describe('proof cache', () => {
    it('should list cached proofs', async () => {
      await zkp.proveIdentity('did:cc:list-test', 'ch', mockSimkeySign);
      const proofs = zkp.listProofs();
      expect(proofs.length).toBeGreaterThan(0);
    });

    it('should evict old proofs when cache is full', async () => {
      const smallCacheZkp = new SimkeyZkp({ proofCacheSize: 3 });
      await smallCacheZkp.initialize();
      for (let i = 0; i < 5; i++) {
        await smallCacheZkp.proveIdentity(`did:cc:${i}`, `ch${i}`, mockSimkeySign);
      }
      const proofs = smallCacheZkp.listProofs();
      expect(proofs.length).toBeLessThanOrEqual(3);
      await smallCacheZkp.close();
    });
  });

  // ============================================================
  // ZKP 常量
  // ============================================================

  describe('ZKP_TYPE and ZKP_SCHEME constants', () => {
    it('should have all expected proof types', () => {
      expect(ZKP_TYPE.IDENTITY).toBeDefined();
      expect(ZKP_TYPE.AGE_RANGE).toBeDefined();
      expect(ZKP_TYPE.ASSET_RANGE).toBeDefined();
      expect(ZKP_TYPE.MEMBERSHIP).toBeDefined();
      expect(ZKP_TYPE.CREDENTIAL).toBeDefined();
      expect(ZKP_TYPE.TRANSACTION).toBeDefined();
    });

    it('should have all expected schemes', () => {
      expect(ZKP_SCHEME.GROTH16).toBeDefined();
      expect(ZKP_SCHEME.PLONK).toBeDefined();
      expect(ZKP_SCHEME.STARK).toBeDefined();
      expect(ZKP_SCHEME.BULLETPROOFS).toBeDefined();
      expect(ZKP_SCHEME.BBS_PLUS).toBeDefined();
    });
  });
});
