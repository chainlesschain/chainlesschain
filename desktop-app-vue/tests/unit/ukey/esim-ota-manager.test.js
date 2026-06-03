/**
 * eSIM OTA Manager 单元测试
 * 测试目标: src/main/ukey/esim-ota-manager.js
 * 覆盖场景: Profile管理、OTA密钥部署、批量部署、密钥轮换
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

import { ESimOtaManager, OTA_STATE, PROFILE_STATE } from '../../../src/main/ukey/esim-ota-manager.js';

describe('ESimOtaManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ESimOtaManager({
      smDpAddress: 'smdp.test.com',
      smDsAddress: 'smds.test.com',
      timeout: 5000,
      retryAttempts: 1,
      batchSize: 5
    });
  });

  afterEach(async () => {
    await manager.close();
  });

  // ============================================================
  // 初始化
  // ============================================================

  describe('initialize()', () => {
    it('should initialize successfully', async () => {
      const result = await manager.initialize();
      expect(result).toBe(true);
    });

    it('should be idempotent (second call returns true immediately)', async () => {
      await manager.initialize();
      const result = await manager.initialize();
      expect(result).toBe(true);
    });

    it('should set eUICC info after initialization', async () => {
      await manager.initialize();
      const info = manager.getEuiccInfo();
      expect(info).toBeDefined();
      expect(info).toHaveProperty('eid');
      expect(info).toHaveProperty('svn');
      expect(info).toHaveProperty('freeNonVolatileMemory');
    });

    it('should start in IDLE state', () => {
      expect(manager.getState()).toBe(OTA_STATE.IDLE);
    });
  });

  // ============================================================
  // Profile 管理
  // ============================================================

  describe('downloadProfile()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should download and install a profile', async () => {
      const result = await manager.downloadProfile('1$smdp.test.com$MATCHING-ID-001');
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('profileId');
      expect(result).toHaveProperty('iccid');
      expect(result).toHaveProperty('carrier');
    });

    it('should list the installed profile', async () => {
      await manager.downloadProfile('1$smdp.test.com$MATCHING-ID-002');
      const profiles = manager.listProfiles();
      expect(profiles.length).toBeGreaterThan(0);
      expect(profiles[0]).toHaveProperty('state', PROFILE_STATE.INSTALLED);
    });

    it('should emit download-progress events', async () => {
      const progressEvents = [];
      manager.on('download-progress', (evt) => progressEvents.push(evt));
      await manager.downloadProfile('1$smdp.test.com$MATCHING-ID-003');
      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents[progressEvents.length - 1].progress).toBe(100);
    });
  });

  describe('enableProfile()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should enable an installed profile', async () => {
      const dl = await manager.downloadProfile('1$smdp.test.com$MATCH-1');
      const result = await manager.enableProfile(dl.profileId);
      expect(result.success).toBe(true);
      const profiles = manager.listProfiles();
      const enabled = profiles.find(p => p.id === dl.profileId);
      expect(enabled.state).toBe(PROFILE_STATE.ENABLED);
    });

    it('should disable previously enabled profile when enabling another', async () => {
      const dl1 = await manager.downloadProfile('1$smdp.test.com$MATCH-A');
      const dl2 = await manager.downloadProfile('1$smdp.test.com$MATCH-B');
      await manager.enableProfile(dl1.profileId);
      await manager.enableProfile(dl2.profileId);
      const profiles = manager.listProfiles();
      const p1 = profiles.find(p => p.id === dl1.profileId);
      const p2 = profiles.find(p => p.id === dl2.profileId);
      expect(p1.state).toBe(PROFILE_STATE.DISABLED);
      expect(p2.state).toBe(PROFILE_STATE.ENABLED);
    });

    it('should throw when enabling a non-existent profile', async () => {
      await expect(manager.enableProfile('non-existent-id')).rejects.toThrow('Profile 不存在');
    });
  });

  describe('disableProfile()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should disable an enabled profile', async () => {
      const dl = await manager.downloadProfile('1$smdp.test.com$MATCH-DIS');
      await manager.enableProfile(dl.profileId);
      const result = await manager.disableProfile(dl.profileId);
      expect(result.success).toBe(true);
      const profiles = manager.listProfiles();
      const p = profiles.find(p => p.id === dl.profileId);
      expect(p.state).toBe(PROFILE_STATE.DISABLED);
    });
  });

  describe('deleteProfile()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should delete a disabled profile', async () => {
      const dl = await manager.downloadProfile('1$smdp.test.com$MATCH-DEL');
      const result = await manager.deleteProfile(dl.profileId);
      expect(result.success).toBe(true);
      const profiles = manager.listProfiles();
      expect(profiles.find(p => p.id === dl.profileId)).toBeUndefined();
    });

    it('should refuse to delete an enabled profile', async () => {
      const dl = await manager.downloadProfile('1$smdp.test.com$MATCH-DEL2');
      await manager.enableProfile(dl.profileId);
      await expect(manager.deleteProfile(dl.profileId)).rejects.toThrow('不能删除活跃的 Profile');
    });

    it('should throw when deleting a non-existent profile', async () => {
      await expect(manager.deleteProfile('ghost-id')).rejects.toThrow('Profile 不存在');
    });
  });

  // ============================================================
  // OTA 密钥部署
  // ============================================================

  describe('deployKey()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should deploy a new key successfully', async () => {
      const result = await manager.deployKey({
        targetEid: '89049032000001234567',
        keyType: 'ec256'
      });
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('keyId');
      expect(result).toHaveProperty('publicKeyInfo');
      expect(result).toHaveProperty('deployedAt');
      expect(result.publicKeyInfo).toHaveProperty('type', 'EcdsaSecp256r1VerificationKey2019');
    });

    it('should deploy ml-dsa-65 key type', async () => {
      const result = await manager.deployKey({
        targetEid: '89049032000001234568',
        keyType: 'ml-dsa-65'
      });
      expect(result.success).toBe(true);
      expect(result.publicKeyInfo.type).toBe('MLDSAVerificationKey2024');
    });

    it('should import existing key material', async () => {
      const result = await manager.deployKey({
        targetEid: '89049032000001234569',
        keyType: 'ec256',
        keyMaterial: { publicKey: 'AAAA+b64+pub+key==' }
      });
      expect(result.success).toBe(true);
      expect(result.publicKeyInfo.publicKeyMultibase).toBe('AAAA+b64+pub+key==');
    });

    it('should emit state-changed events during deployment', async () => {
      const states = [];
      manager.on('state-changed', ({ state }) => states.push(state));
      await manager.deployKey({ targetEid: 'EID-TEST', keyType: 'ec256' });
      expect(states).toContain(OTA_STATE.DEPLOYING_KEY);
      expect(states).toContain(OTA_STATE.COMPLETED);
    });
  });

  describe('batchDeploy()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should batch deploy to multiple targets', async () => {
      const targets = [
        { targetEid: 'EID-001', keyType: 'ec256' },
        { targetEid: 'EID-002', keyType: 'ec256' },
        { targetEid: 'EID-003', keyType: 'ec256' }
      ];
      const result = await manager.batchDeploy(targets);
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.summary.total).toBe(3);
      expect(result.summary.succeeded).toBeGreaterThan(0);
    });

    it('should emit batch-progress events', async () => {
      const progressEvents = [];
      manager.on('batch-progress', (evt) => progressEvents.push(evt));
      const targets = Array.from({ length: 3 }, (_, i) => ({
        targetEid: `EID-BATCH-${i}`,
        keyType: 'ec256'
      }));
      await manager.batchDeploy(targets);
      expect(progressEvents.length).toBeGreaterThan(0);
    });
  });

  describe('rotateKey()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should rotate a key successfully', async () => {
      const result = await manager.rotateKey('89049032000001234567', 'key-old-001');
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('oldKeyId', 'key-old-001');
      expect(result).toHaveProperty('newKeyId');
      expect(result).toHaveProperty('endorsement');
      expect(result.transitionPeriod).toBe('180d');
    });
  });

  // ============================================================
  // 状态管理
  // ============================================================

  describe('state management', () => {
    it('should start with IDLE state', () => {
      expect(manager.getState()).toBe(OTA_STATE.IDLE);
    });

    it('should return to COMPLETED state after successful deploy', async () => {
      await manager.initialize();
      await manager.deployKey({ targetEid: 'EID-STATE', keyType: 'ec256' });
      expect(manager.getState()).toBe(OTA_STATE.COMPLETED);
    });
  });

  // ============================================================
  // 关闭
  // ============================================================

  describe('close()', () => {
    it('should clean up resources on close', async () => {
      await manager.initialize();
      await manager.downloadProfile('1$smdp.test.com$MATCH-CLOSE');
      await manager.close();
      expect(manager.listProfiles()).toHaveLength(0);
    });
  });
});
