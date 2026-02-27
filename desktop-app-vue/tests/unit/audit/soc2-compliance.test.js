import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

describe('SOC2Compliance', () => {
  let SOC2Compliance, TRUST_SERVICE_CRITERIA, EVIDENCE_TYPES, EVIDENCE_STATUS;
  let soc2;
  let mockDb;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await import('../../../src/main/audit/soc2-compliance.js');
    SOC2Compliance = mod.SOC2Compliance;
    TRUST_SERVICE_CRITERIA = mod.TRUST_SERVICE_CRITERIA;
    EVIDENCE_TYPES = mod.EVIDENCE_TYPES;
    EVIDENCE_STATUS = mod.EVIDENCE_STATUS;

    mockDb = {
      db: {
        exec: vi.fn(),
        prepare: vi.fn(() => ({
          run: vi.fn(),
          get: vi.fn(() => null),
          all: vi.fn(() => []),
        })),
      },
      saveToFile: vi.fn(),
    };

    soc2 = new SOC2Compliance(mockDb, null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Constants ---

  it('should export TRUST_SERVICE_CRITERIA', () => {
    expect(TRUST_SERVICE_CRITERIA.SECURITY).toBe('security');
    expect(TRUST_SERVICE_CRITERIA.AVAILABILITY).toBe('availability');
    expect(TRUST_SERVICE_CRITERIA.PROCESSING_INTEGRITY).toBe('processing_integrity');
    expect(TRUST_SERVICE_CRITERIA.CONFIDENTIALITY).toBe('confidentiality');
    expect(TRUST_SERVICE_CRITERIA.PRIVACY).toBe('privacy');
  });

  it('should export EVIDENCE_TYPES', () => {
    expect(EVIDENCE_TYPES.AUDIT_LOG).toBe('audit_log');
    expect(EVIDENCE_TYPES.ACCESS_REVIEW).toBe('access_review');
    expect(EVIDENCE_TYPES.CHANGE_RECORD).toBe('change_record');
    expect(EVIDENCE_TYPES.CONFIGURATION).toBe('configuration');
  });

  it('should export EVIDENCE_STATUS', () => {
    expect(EVIDENCE_STATUS.COLLECTED).toBe('collected');
    expect(EVIDENCE_STATUS.VERIFIED).toBe('verified');
    expect(EVIDENCE_STATUS.EXPIRED).toBe('expired');
    expect(EVIDENCE_STATUS.MISSING).toBe('missing');
  });

  // --- Constructor ---

  it('should set database, auditLogger, and initialized=false', () => {
    expect(soc2.database).toBe(mockDb);
    expect(soc2.auditLogger).toBeNull();
    expect(soc2.initialized).toBe(false);
  });

  // --- initialize ---

  it('should create tables and set initialized on initialize()', async () => {
    await soc2.initialize();
    expect(soc2.initialized).toBe(true);
    expect(mockDb.db.exec).toHaveBeenCalled();
  });

  // --- collectAuditLogEvidence ---

  it('should create evidence with period from collectAuditLogEvidence()', async () => {
    const now = Date.now();
    const evidence = await soc2.collectAuditLogEvidence({
      periodStart: now - 1000,
      periodEnd: now,
    });
    expect(evidence).toHaveProperty('id');
    expect(evidence.criteria).toBe(TRUST_SERVICE_CRITERIA.SECURITY);
    expect(evidence.evidence_type).toBe(EVIDENCE_TYPES.AUDIT_LOG);
    expect(evidence.title).toBe('Audit Log Collection');
    expect(evidence.status).toBe(EVIDENCE_STATUS.COLLECTED);
    expect(evidence.period_start).toBe(now - 1000);
    expect(evidence.period_end).toBe(now);
  });

  it('should handle missing audit tables gracefully', async () => {
    mockDb.db.prepare.mockImplementation(() => ({
      run: vi.fn(),
      get: vi.fn(() => { throw new Error('no such table'); }),
      all: vi.fn(() => []),
    }));
    // Should not throw; the method catches inner errors
    const evidence = await soc2.collectAuditLogEvidence();
    expect(evidence).toHaveProperty('id');
    expect(evidence.status).toBe(EVIDENCE_STATUS.COLLECTED);
  });

  it('should use default 30-day period when no options given', async () => {
    const before = Date.now();
    const evidence = await soc2.collectAuditLogEvidence();
    const data = JSON.parse(evidence.data);
    expect(data.periodEnd).toBeGreaterThanOrEqual(before);
    expect(data.periodStart).toBeLessThan(data.periodEnd);
    // Approximately 30 days
    const diff = data.periodEnd - data.periodStart;
    expect(diff).toBeGreaterThanOrEqual(29 * 24 * 60 * 60 * 1000);
  });

  it('should emit evidence:collected event', async () => {
    const handler = vi.fn();
    soc2.on('evidence:collected', handler);
    await soc2.collectAuditLogEvidence();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // --- collectAccessControlEvidence ---

  it('should create access review evidence', async () => {
    const evidence = await soc2.collectAccessControlEvidence();
    expect(evidence.evidence_type).toBe(EVIDENCE_TYPES.ACCESS_REVIEW);
    expect(evidence.title).toBe('Access Control Review');
    expect(evidence.status).toBe(EVIDENCE_STATUS.COLLECTED);
    const data = JSON.parse(evidence.data);
    expect(data).toHaveProperty('totalUsers');
    expect(data).toHaveProperty('totalRoles');
    expect(data.rbacEnabled).toBe(true);
  });

  // --- collectConfigurationEvidence ---

  it('should create configuration evidence', async () => {
    const evidence = await soc2.collectConfigurationEvidence();
    expect(evidence.evidence_type).toBe(EVIDENCE_TYPES.CONFIGURATION);
    expect(evidence.title).toBe('System Configuration Evidence');
    const data = JSON.parse(evidence.data);
    expect(data.encryptionAtRest).toBe(true);
    expect(data.databaseEncryption).toBe('AES-256 (SQLCipher)');
    expect(data.p2pEncryption).toBe('Signal Protocol');
  });

  // --- generateReport ---

  it('should calculate compliance score in generateReport()', async () => {
    const report = await soc2.generateReport();
    expect(report).toHaveProperty('complianceScore');
    expect(report).toHaveProperty('totalEvidence');
    expect(report).toHaveProperty('byCriteria');
    expect(report).toHaveProperty('summary');
    expect(report.title).toBe('SOC 2 Type II Compliance Report');
  });

  it('should organize evidence by criteria', async () => {
    const report = await soc2.generateReport();
    expect(report.byCriteria).toHaveProperty(TRUST_SERVICE_CRITERIA.SECURITY);
    expect(report.byCriteria).toHaveProperty(TRUST_SERVICE_CRITERIA.AVAILABILITY);
    expect(report.byCriteria).toHaveProperty(TRUST_SERVICE_CRITERIA.PRIVACY);
  });

  it('should have 0% score when no evidence exists', async () => {
    const report = await soc2.generateReport();
    expect(report.complianceScore).toBe(0);
    expect(report.summary.coveredCriteria).toBe(0);
    expect(report.summary.missingCriteria).toBe(5);
  });

  it('should emit report:generated event', async () => {
    const handler = vi.fn();
    soc2.on('report:generated', handler);
    await soc2.generateReport();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // --- _generateRecommendations ---

  it('should create recommendations for missing criteria', () => {
    const byCriteria = {
      security: [{ id: '1', status: 'collected' }],
      availability: [],
      privacy: [],
    };
    const recs = soc2._generateRecommendations(byCriteria);
    expect(recs.length).toBe(2);
    expect(recs[0].priority).toBe('high');
    expect(recs[0].recommendation).toContain('No evidence collected');
  });

  it('should create recommendations for expired evidence', () => {
    const byCriteria = {
      security: [{ id: '1', status: 'expired' }],
    };
    const recs = soc2._generateRecommendations(byCriteria);
    expect(recs.length).toBe(1);
    expect(recs[0].priority).toBe('medium');
    expect(recs[0].recommendation).toContain('expired');
  });

  // --- verifyEvidence ---

  it('should update evidence status to verified', async () => {
    const result = await soc2.verifyEvidence('ev-123', 'admin@test.com');
    expect(result.success).toBe(true);
    expect(result.status).toBe(EVIDENCE_STATUS.VERIFIED);
    expect(result.evidenceId).toBe('ev-123');
    expect(mockDb.saveToFile).toHaveBeenCalled();
  });

  it('should throw when database not initialized for verifyEvidence', async () => {
    const noDbSoc2 = new SOC2Compliance(null, null);
    await expect(noDbSoc2.verifyEvidence('id', 'user')).rejects.toThrow('Database not initialized');
  });

  // --- getEvidenceByCriteria ---

  it('should query DB for getEvidenceByCriteria', async () => {
    const mockRecords = [{ id: 'e1', criteria: 'security' }];
    mockDb.db.prepare.mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => mockRecords),
    });
    const results = await soc2.getEvidenceByCriteria('security');
    expect(results).toEqual(mockRecords);
  });

  it('should return empty array when no database for getEvidenceByCriteria', async () => {
    const noDbSoc2 = new SOC2Compliance(null, null);
    const results = await noDbSoc2.getEvidenceByCriteria('security');
    expect(results).toEqual([]);
  });

  // --- close ---

  it('should reset state on close()', async () => {
    soc2.initialized = true;
    await soc2.close();
    expect(soc2.initialized).toBe(false);
  });
});
