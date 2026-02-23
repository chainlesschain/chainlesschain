/**
 * HSM 联合认证单元测试
 * 测试目标: src/main/ukey/hsm-federation.js
 * 覆盖场景: HSM管理、密钥分片、联合签名、审批流、审计日志
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

import { HsmFederation, HSM_STATE, HSM_TYPE, COSIGN_MODE, APPROVAL_POLICY } from '../../../src/main/ukey/hsm-federation.js';

describe('HsmFederation', () => {
  let federation;
  let mockSimkeySign;

  beforeEach(async () => {
    vi.clearAllMocks();
    federation = new HsmFederation({
      defaultCosignMode: COSIGN_MODE.THRESHOLD_2_OF_2,
      approvalPolicy: APPROVAL_POLICY.NONE,  // No approval needed in tests
      auditEnabled: true,
      failoverEnabled: true
    });
    await federation.initialize();

    mockSimkeySign = vi.fn().mockImplementation(async () => ({
      signature: Buffer.from('simkey-signature').toString('base64')
    }));
  });

  afterEach(async () => {
    await federation.close();
  });

  // ============================================================
  // 初始化
  // ============================================================

  describe('initialize()', () => {
    it('should initialize with a software HSM', async () => {
      const freshFed = new HsmFederation({});
      const result = await freshFed.initialize();
      expect(result).toBe(true);
      await freshFed.close();
    });

    it('should be idempotent', async () => {
      const result = await federation.initialize();
      expect(result).toBe(true);
    });

    it('should register a default software HSM', () => {
      const hsms = federation.listHSMs();
      expect(hsms.length).toBeGreaterThanOrEqual(1);
      expect(hsms[0].type).toBe(HSM_TYPE.SOFTWARE);
    });

    it('should have an active HSM after init', () => {
      const hsms = federation.listHSMs();
      const active = hsms.find(h => h.isActive);
      expect(active).toBeDefined();
    });
  });

  // ============================================================
  // HSM 管理
  // ============================================================

  describe('registerHSM()', () => {
    it('should register a new HSM', async () => {
      const result = await federation.registerHSM({
        id: 'test-luna-hsm',
        type: HSM_TYPE.THALES_LUNA,
        name: 'Thales Luna Test',
        endpoint: 'hsm.test.com:1792'
      });
      expect(result.success).toBe(true);
      expect(result.hsmId).toBe('test-luna-hsm');
    });

    it('should auto-connect after registration', async () => {
      const result = await federation.registerHSM({
        type: HSM_TYPE.THALES_LUNA,
        name: 'Auto Connect Test',
        endpoint: 'hsm.test.com:1792'
      });
      // Should be authenticated after registration
      expect(result.state).toBe(HSM_STATE.AUTHENTICATED);
    });

    it('should generate an ID if not provided', async () => {
      const result = await federation.registerHSM({
        type: HSM_TYPE.AWS_CLOUDHSM,
        name: 'AWS HSM Test'
      });
      expect(result.hsmId).toMatch(/^hsm-/);
    });

    it('should appear in listHSMs', async () => {
      await federation.registerHSM({
        id: 'listed-hsm',
        type: HSM_TYPE.JIANGNAN,
        name: '江南天安 Test'
      });
      const hsms = federation.listHSMs();
      expect(hsms.some(h => h.id === 'listed-hsm')).toBe(true);
    });
  });

  describe('setActiveHSM()', () => {
    it('should set a connected HSM as active', async () => {
      const reg = await federation.registerHSM({
        id: 'set-active-hsm',
        type: HSM_TYPE.SOFTWARE,
        name: 'Active Test'
      });
      federation.setActiveHSM('set-active-hsm');
      const hsms = federation.listHSMs();
      const active = hsms.find(h => h.id === 'set-active-hsm');
      expect(active.isActive).toBe(true);
    });

    it('should throw for non-existent HSM', () => {
      expect(() => federation.setActiveHSM('ghost-hsm')).toThrow('HSM 不存在');
    });
  });

  // ============================================================
  // 密钥分片
  // ============================================================

  describe('generateKeyShares()', () => {
    it('should generate 2-of-2 key shares', async () => {
      const result = await federation.generateKeyShares('test-key-001', COSIGN_MODE.THRESHOLD_2_OF_2);
      expect(result.success).toBe(true);
      expect(result.keyShareInfo).toHaveProperty('keyId', 'test-key-001');
      expect(result.keyShareInfo).toHaveProperty('mode', COSIGN_MODE.THRESHOLD_2_OF_2);
      expect(result.keyShareInfo).toHaveProperty('jointPublicKey');
      expect(result.keyShareInfo).toHaveProperty('simkeyShare');
      expect(result.keyShareInfo.simkeyShare).toHaveProperty('share');
      expect(result.keyShareInfo.simkeyShare).toHaveProperty('publicContribution');
    });

    it('should generate 2-of-3 key shares', async () => {
      const result = await federation.generateKeyShares('test-key-002', COSIGN_MODE.THRESHOLD_2_OF_3);
      expect(result.success).toBe(true);
      expect(result.keyShareInfo.totalShares).toBe(3);
      expect(result.keyShareInfo.threshold).toBe(2);
    });

    it('should add to audit log', async () => {
      await federation.generateKeyShares('audit-test-key', COSIGN_MODE.THRESHOLD_2_OF_2);
      const log = federation.getAuditLog();
      const entry = log.items.find(i => i.action === 'key_shares_generated');
      expect(entry).toBeDefined();
      expect(entry.details.keyId).toBe('audit-test-key');
    });
  });

  // ============================================================
  // 联合签名
  // ============================================================

  describe('coSign()', () => {
    let keyId;

    beforeEach(async () => {
      keyId = 'cosign-test-key';
      await federation.generateKeyShares(keyId, COSIGN_MODE.THRESHOLD_2_OF_2);
    });

    it('should perform parallel co-sign (THRESHOLD_2_OF_2)', async () => {
      const result = await federation.coSign(
        keyId,
        Buffer.from('transaction data'),
        mockSimkeySign,
        { amount: 1000 }
      );
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('simkeySignature');
      expect(result).toHaveProperty('hsmSignature');
      expect(result).toHaveProperty('combinedSignature');
      expect(result.keyId).toBe(keyId);
    });

    it('should call simkeySignFn exactly once', async () => {
      await federation.coSign(keyId, 'data', mockSimkeySign, { amount: 100 });
      expect(mockSimkeySign).toHaveBeenCalledTimes(1);
    });

    it('should update HSM stats after signing', async () => {
      await federation.coSign(keyId, 'data', mockSimkeySign, {});
      const hsms = federation.listHSMs();
      const active = hsms.find(h => h.isActive);
      expect(active.stats.totalSigns).toBeGreaterThan(0);
    });

    it('should add audit log entry', async () => {
      await federation.coSign(keyId, 'audited-data', mockSimkeySign, {});
      const log = federation.getAuditLog();
      const entry = log.items.find(i => i.action === 'co_sign');
      expect(entry).toBeDefined();
    });

    it('should throw for unknown key ID', async () => {
      await expect(federation.coSign('no-such-key', 'data', mockSimkeySign, {}))
        .rejects.toThrow('分片密钥不存在');
    });
  });

  describe('coSign() with sequential mode', () => {
    it('should perform sequential co-sign', async () => {
      const seqKeyId = 'seq-key';
      // Store a key with sequential mode
      await federation.generateKeyShares(seqKeyId, COSIGN_MODE.SEQUENTIAL);

      // Override to sequential mode
      const result = await federation.coSign(
        seqKeyId,
        'seq-data',
        mockSimkeySign,
        {}
      );
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // 仅 HSM 签名
  // ============================================================

  describe('hsmSign()', () => {
    it('should sign data using only HSM', async () => {
      const result = await federation.hsmSign(Buffer.from('hsm-only data'));
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('hsmId');
    });

    it('should sign string data', async () => {
      const result = await federation.hsmSign('string data');
      expect(result.success).toBe(true);
    });

    it('should update HSM stats', async () => {
      const before = federation.listHSMs().find(h => h.isActive).stats.totalSigns;
      await federation.hsmSign('data');
      const after = federation.listHSMs().find(h => h.isActive).stats.totalSigns;
      expect(after).toBe(before + 1);
    });
  });

  // ============================================================
  // 审批策略
  // ============================================================

  describe('approval policy', () => {
    it('should auto-approve when amount below threshold', async () => {
      const autoFed = new HsmFederation({
        approvalPolicy: APPROVAL_POLICY.AUTO,
        amountThreshold: 10000,
        auditEnabled: false
      });
      await autoFed.initialize();

      const keyId = 'auto-key';
      await autoFed.generateKeyShares(keyId, COSIGN_MODE.THRESHOLD_2_OF_2);

      const result = await autoFed.coSign(keyId, 'data', mockSimkeySign, { amount: 5000 });
      expect(result.success).toBe(true);

      await autoFed.close();
    });

    it('should require approval when amount above threshold', async () => {
      const manualFed = new HsmFederation({
        approvalPolicy: APPROVAL_POLICY.AUTO,
        amountThreshold: 10000,
        auditEnabled: false
      });
      await manualFed.initialize();

      const keyId = 'manual-key';
      await manualFed.generateKeyShares(keyId, COSIGN_MODE.THRESHOLD_2_OF_2);

      const result = await manualFed.coSign(keyId, 'data', mockSimkeySign, { amount: 50000 });
      expect(result.success).toBe(false);
      expect(result.pendingApproval).toBe(true);
      expect(result).toHaveProperty('requestId');

      await manualFed.close();
    });

    it('should list pending approvals', async () => {
      const pendingFed = new HsmFederation({
        approvalPolicy: APPROVAL_POLICY.MANUAL,
        auditEnabled: false
      });
      await pendingFed.initialize();

      const keyId = 'pending-key';
      await pendingFed.generateKeyShares(keyId, COSIGN_MODE.THRESHOLD_2_OF_2);
      await pendingFed.coSign(keyId, 'data', mockSimkeySign, {});

      const pending = pendingFed.getPendingApprovals();
      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0].status).toBe('pending');

      await pendingFed.close();
    });

    it('should approve a pending request', async () => {
      const pendingFed = new HsmFederation({
        approvalPolicy: APPROVAL_POLICY.MANUAL,
        auditEnabled: true
      });
      await pendingFed.initialize();

      const keyId = 'approve-key';
      await pendingFed.generateKeyShares(keyId, COSIGN_MODE.THRESHOLD_2_OF_2);
      const signResult = await pendingFed.coSign(keyId, 'data', mockSimkeySign, {});

      const result = await pendingFed.approveRequest(signResult.requestId, 'manager-001');
      expect(result.success).toBe(true);

      const pending = pendingFed.getPendingApprovals();
      expect(pending.find(p => p.requestId === signResult.requestId)).toBeUndefined();

      await pendingFed.close();
    });

    it('should reject a pending request', async () => {
      const pendingFed = new HsmFederation({
        approvalPolicy: APPROVAL_POLICY.MANUAL,
        auditEnabled: true
      });
      await pendingFed.initialize();

      const keyId = 'reject-key';
      await pendingFed.generateKeyShares(keyId, COSIGN_MODE.THRESHOLD_2_OF_2);
      const signResult = await pendingFed.coSign(keyId, 'data', mockSimkeySign, {});

      const result = await pendingFed.rejectRequest(signResult.requestId, 'auditor-001', '金额超限');
      expect(result.success).toBe(true);

      await pendingFed.close();
    });
  });

  // ============================================================
  // 审计日志
  // ============================================================

  describe('getAuditLog()', () => {
    it('should return audit log entries', async () => {
      await federation.hsmSign('logged-data');
      const log = federation.getAuditLog();
      expect(log).toHaveProperty('total');
      expect(log).toHaveProperty('items');
      expect(Array.isArray(log.items)).toBe(true);
    });

    it('should filter by action', async () => {
      await federation.hsmSign('data1');
      await federation.hsmSign('data2');
      const log = federation.getAuditLog({ action: 'hsm_sign' });
      for (const entry of log.items) {
        expect(entry.action).toBe('hsm_sign');
      }
    });

    it('should support limit parameter', async () => {
      for (let i = 0; i < 5; i++) await federation.hsmSign(`data-${i}`);
      const log = federation.getAuditLog({ limit: 2 });
      expect(log.items.length).toBeLessThanOrEqual(2);
    });

    it('should not log when auditEnabled is false', async () => {
      const noAuditFed = new HsmFederation({ auditEnabled: false });
      await noAuditFed.initialize();
      await noAuditFed.hsmSign('data');
      const log = noAuditFed.getAuditLog();
      expect(log.total).toBe(0);
      await noAuditFed.close();
    });
  });

  describe('exportAuditLog()', () => {
    it('should export as JSON', async () => {
      await federation.hsmSign('json-log');
      const exported = federation.exportAuditLog('json');
      const parsed = JSON.parse(exported);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('should export as CSV', async () => {
      await federation.hsmSign('csv-log');
      const exported = federation.exportAuditLog('csv');
      expect(exported).toContain('timestamp,action,details');
    });
  });

  // ============================================================
  // 故障转移
  // ============================================================

  describe('failover()', () => {
    it('should find a backup HSM when available', async () => {
      // Register a backup HSM
      await federation.registerHSM({
        id: 'backup-hsm',
        type: HSM_TYPE.AWS_CLOUDHSM,
        name: 'Backup HSM'
      });

      const result = await federation.failover();
      expect(result.success).toBe(true);
      expect(result.newActiveHsm).toBe('backup-hsm');
    });

    it('should fail when no backup available', async () => {
      // Only one HSM (default), no backup
      const singleFed = new HsmFederation({ failoverEnabled: true });
      await singleFed.initialize();
      const result = await singleFed.failover();
      expect(result.success).toBe(false);
      expect(result.reason).toContain('无可用备用 HSM');
      await singleFed.close();
    });

    it('should fail when failover is disabled', async () => {
      const noFOFed = new HsmFederation({ failoverEnabled: false });
      await noFOFed.initialize();
      const result = await noFOFed.failover();
      expect(result.success).toBe(false);
      expect(result.reason).toContain('故障转移未启用');
      await noFOFed.close();
    });

    it('should emit failover event', async () => {
      await federation.registerHSM({
        id: 'failover-backup',
        type: HSM_TYPE.AZURE_HSM,
        name: 'Azure Backup'
      });
      const events = [];
      federation.on('failover', (evt) => events.push(evt));
      await federation.failover();
      expect(events.length).toBe(1);
      expect(events[0]).toHaveProperty('from');
      expect(events[0]).toHaveProperty('to', 'failover-backup');
    });
  });

  // ============================================================
  // 关闭
  // ============================================================

  describe('close()', () => {
    it('should close without error', async () => {
      await expect(federation.close()).resolves.not.toThrow();
    });

    it('should clear key shares on close', async () => {
      await federation.generateKeyShares('cleanup-key', COSIGN_MODE.THRESHOLD_2_OF_2);
      await federation.close();
      // After close, coSign should throw since no active HSM
      await expect(federation.hsmSign('data')).rejects.toThrow();
    });
  });
});
