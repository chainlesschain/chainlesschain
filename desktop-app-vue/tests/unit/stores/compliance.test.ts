/**
 * useComplianceStore -- Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Getters: complianceScore, evidenceCount, hasCriticalFindings
 *  - collectAuditEvidence()      -> compliance:collect-audit-evidence
 *  - collectAccessEvidence()     -> compliance:collect-access-evidence
 *  - collectConfigEvidence()     -> compliance:collect-config-evidence
 *  - generateReport()            -> compliance:generate-report
 *  - classifyContent()           -> compliance:classify-content
 *  - fetchClassificationHistory()-> compliance:get-classifications
 *  - fetchPolicies()             -> compliance:get-policies
 *  - getEvidenceByCriteria()     -> compliance:get-evidence
 *  - Loading state toggling
 *  - Error handling for each action
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useComplianceStore } from '../../../src/renderer/stores/compliance';

describe('useComplianceStore', () => {
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke = vi.fn();
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('Initial state', () => {
    it('evidence starts as empty array', () => {
      const store = useComplianceStore();
      expect(store.evidence).toEqual([]);
    });

    it('report starts as null', () => {
      const store = useComplianceStore();
      expect(store.report).toBeNull();
    });

    it('loading starts as false', () => {
      const store = useComplianceStore();
      expect(store.loading).toBe(false);
    });

    it('error starts as null', () => {
      const store = useComplianceStore();
      expect(store.error).toBeNull();
    });

    it('classificationResult starts as null', () => {
      const store = useComplianceStore();
      expect(store.classificationResult).toBeNull();
    });

    it('classificationHistory starts as empty array', () => {
      const store = useComplianceStore();
      expect(store.classificationHistory).toEqual([]);
    });

    it('policies starts as empty array', () => {
      const store = useComplianceStore();
      expect(store.policies).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  describe('Getters', () => {
    it('complianceScore returns 0 initially', () => {
      const store = useComplianceStore();
      expect(store.complianceScore).toBe(0);
    });

    it('complianceScore returns report complianceScore when set', () => {
      const store = useComplianceStore();
      store.report = {
        title: 'SOC 2 Report',
        generatedAt: Date.now(),
        complianceScore: 87,
        totalEvidence: 10,
        summary: { totalCriteria: 5, coveredCriteria: 4, missingCriteria: 1 },
        recommendations: [],
      };
      expect(store.complianceScore).toBe(87);
    });

    it('evidenceCount returns 0 initially', () => {
      const store = useComplianceStore();
      expect(store.evidenceCount).toBe(0);
    });

    it('evidenceCount returns length of evidence array', () => {
      const store = useComplianceStore();
      store.evidence = [
        { id: 'e1', criteria: 'security', evidence_type: 'audit', title: 'Test', description: '', data: '', status: 'collected', period_start: 0, period_end: 0, created_at: 0 },
        { id: 'e2', criteria: 'access', evidence_type: 'access', title: 'Test2', description: '', data: '', status: 'collected', period_start: 0, period_end: 0, created_at: 0 },
      ];
      expect(store.evidenceCount).toBe(2);
    });

    it('hasCriticalFindings returns false initially', () => {
      const store = useComplianceStore();
      expect(store.hasCriticalFindings).toBe(false);
    });

    it('hasCriticalFindings returns true when classificationResult severity is critical', () => {
      const store = useComplianceStore();
      store.classificationResult = {
        category: 'pii',
        detections: [{ type: 'ssn', category: 'pii', count: 1, severity: 'critical' }],
        severity: 'critical',
        confidence: 0.95,
      };
      expect(store.hasCriticalFindings).toBe(true);
    });

    it('hasCriticalFindings returns false when severity is not critical', () => {
      const store = useComplianceStore();
      store.classificationResult = {
        category: 'general',
        detections: [],
        severity: 'low',
        confidence: 0.5,
      };
      expect(store.hasCriticalFindings).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // collectAuditEvidence
  // ---------------------------------------------------------------------------

  describe('collectAuditEvidence()', () => {
    it('calls invoke and pushes to evidence array', async () => {
      const evidence = { id: 'ev-1', criteria: 'security', evidence_type: 'audit', title: 'Audit Log', description: '', data: '{}', status: 'collected', period_start: 0, period_end: 0, created_at: Date.now() };
      mockInvoke.mockResolvedValue({ success: true, evidence });

      const store = useComplianceStore();
      await store.collectAuditEvidence({ periodStart: 1000, periodEnd: 2000 });

      expect(mockInvoke).toHaveBeenCalledWith('compliance:collect-audit-evidence', { periodStart: 1000, periodEnd: 2000 });
      expect(store.evidence).toHaveLength(1);
      expect(store.evidence[0]).toEqual(evidence);
    });

    it('sets error when invoke throws', async () => {
      mockInvoke.mockRejectedValue(new Error('Audit collection failed'));

      const store = useComplianceStore();
      await expect(store.collectAuditEvidence()).rejects.toThrow('Audit collection failed');
      expect(store.error).toBe('Audit collection failed');
    });

    it('toggles loading state', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useComplianceStore();
      const promise = store.collectAuditEvidence();
      expect(store.loading).toBe(true);

      await promise;
      expect(store.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // collectAccessEvidence
  // ---------------------------------------------------------------------------

  describe('collectAccessEvidence()', () => {
    it('calls invoke and pushes evidence', async () => {
      const evidence = { id: 'ev-2', criteria: 'access', evidence_type: 'access', title: 'Access Log', description: '', data: '{}', status: 'collected', period_start: 0, period_end: 0, created_at: Date.now() };
      mockInvoke.mockResolvedValue({ success: true, evidence });

      const store = useComplianceStore();
      await store.collectAccessEvidence();

      expect(mockInvoke).toHaveBeenCalledWith('compliance:collect-access-evidence');
      expect(store.evidence).toHaveLength(1);
    });

    it('sets error when invoke throws', async () => {
      mockInvoke.mockRejectedValue(new Error('Access error'));

      const store = useComplianceStore();
      await expect(store.collectAccessEvidence()).rejects.toThrow('Access error');
      expect(store.error).toBe('Access error');
    });
  });

  // ---------------------------------------------------------------------------
  // collectConfigEvidence
  // ---------------------------------------------------------------------------

  describe('collectConfigEvidence()', () => {
    it('calls invoke and pushes evidence', async () => {
      const evidence = { id: 'ev-3', criteria: 'config', evidence_type: 'config', title: 'Config Audit', description: '', data: '{}', status: 'collected', period_start: 0, period_end: 0, created_at: Date.now() };
      mockInvoke.mockResolvedValue({ success: true, evidence });

      const store = useComplianceStore();
      await store.collectConfigEvidence();

      expect(mockInvoke).toHaveBeenCalledWith('compliance:collect-config-evidence');
      expect(store.evidence).toHaveLength(1);
    });

    it('sets error when invoke throws', async () => {
      mockInvoke.mockRejectedValue(new Error('Config error'));

      const store = useComplianceStore();
      await expect(store.collectConfigEvidence()).rejects.toThrow('Config error');
      expect(store.error).toBe('Config error');
    });
  });

  // ---------------------------------------------------------------------------
  // generateReport
  // ---------------------------------------------------------------------------

  describe('generateReport()', () => {
    it('calls invoke and sets report', async () => {
      const report = {
        title: 'SOC 2 Report',
        generatedAt: Date.now(),
        complianceScore: 92,
        totalEvidence: 15,
        summary: { totalCriteria: 5, coveredCriteria: 5, missingCriteria: 0 },
        recommendations: [],
      };
      mockInvoke.mockResolvedValue({ success: true, report });

      const store = useComplianceStore();
      await store.generateReport({ periodStart: 1000, periodEnd: 2000 });

      expect(mockInvoke).toHaveBeenCalledWith('compliance:generate-report', { periodStart: 1000, periodEnd: 2000 });
      expect(store.report).toEqual(report);
    });

    it('sets error when invoke throws', async () => {
      mockInvoke.mockRejectedValue(new Error('Report generation failed'));

      const store = useComplianceStore();
      await expect(store.generateReport()).rejects.toThrow('Report generation failed');
      expect(store.error).toBe('Report generation failed');
    });

    it('toggles loading state', async () => {
      mockInvoke.mockResolvedValue({ success: true, report: null });

      const store = useComplianceStore();
      const promise = store.generateReport();
      expect(store.loading).toBe(true);

      await promise;
      expect(store.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // classifyContent
  // ---------------------------------------------------------------------------

  describe('classifyContent()', () => {
    it('calls invoke and sets classificationResult', async () => {
      const result = {
        category: 'pii',
        detections: [{ type: 'email', category: 'pii', count: 2, severity: 'high' }],
        severity: 'high',
        confidence: 0.92,
      };
      mockInvoke.mockResolvedValue({ success: true, result });

      const store = useComplianceStore();
      await store.classifyContent('user@email.com is the contact');

      expect(mockInvoke).toHaveBeenCalledWith('compliance:classify-content', {
        content: 'user@email.com is the contact',
      });
      expect(store.classificationResult).toEqual(result);
    });

    it('sets error when invoke throws', async () => {
      mockInvoke.mockRejectedValue(new Error('Classification failed'));

      const store = useComplianceStore();
      await expect(store.classifyContent('test')).rejects.toThrow('Classification failed');
      expect(store.error).toBe('Classification failed');
    });
  });

  // ---------------------------------------------------------------------------
  // fetchClassificationHistory
  // ---------------------------------------------------------------------------

  describe('fetchClassificationHistory()', () => {
    it('calls invoke and sets classificationHistory', async () => {
      const records = [{ id: 'r1', category: 'pii', createdAt: Date.now() }];
      mockInvoke.mockResolvedValue({ success: true, records });

      const store = useComplianceStore();
      await store.fetchClassificationHistory({ limit: 10, category: 'pii' });

      expect(mockInvoke).toHaveBeenCalledWith('compliance:get-classifications', { limit: 10, category: 'pii' });
      expect(store.classificationHistory).toEqual(records);
    });

    it('sets error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('History error'));

      const store = useComplianceStore();
      const result = await store.fetchClassificationHistory();

      expect(store.error).toBe('History error');
      expect(result).toEqual({ success: false });
    });

    it('toggles loading state', async () => {
      mockInvoke.mockResolvedValue({ success: true, records: [] });

      const store = useComplianceStore();
      const promise = store.fetchClassificationHistory();
      expect(store.loading).toBe(true);

      await promise;
      expect(store.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchPolicies
  // ---------------------------------------------------------------------------

  describe('fetchPolicies()', () => {
    it('calls invoke and sets policies', async () => {
      const policies = [
        { id: 'p1', name: 'PII Policy', level: 'confidential', triggers: ['ssn'], description: 'Protect PII' },
      ];
      mockInvoke.mockResolvedValue({ success: true, policies });

      const store = useComplianceStore();
      await store.fetchPolicies();

      expect(mockInvoke).toHaveBeenCalledWith('compliance:get-policies');
      expect(store.policies).toEqual(policies);
    });

    it('sets error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Policies error'));

      const store = useComplianceStore();
      const result = await store.fetchPolicies();

      expect(store.error).toBe('Policies error');
      expect(result).toEqual({ success: false });
    });
  });

  // ---------------------------------------------------------------------------
  // getEvidenceByCriteria
  // ---------------------------------------------------------------------------

  describe('getEvidenceByCriteria()', () => {
    it('calls invoke and sets evidence', async () => {
      const evidence = [
        { id: 'e1', criteria: 'security', evidence_type: 'audit', title: 'Test', description: '', data: '', status: 'collected', period_start: 0, period_end: 0, created_at: 0 },
      ];
      mockInvoke.mockResolvedValue({ success: true, evidence });

      const store = useComplianceStore();
      await store.getEvidenceByCriteria('security');

      expect(mockInvoke).toHaveBeenCalledWith('compliance:get-evidence', { criteria: 'security' });
      expect(store.evidence).toEqual(evidence);
    });

    it('sets error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Evidence error'));

      const store = useComplianceStore();
      const result = await store.getEvidenceByCriteria('security');

      expect(store.error).toBe('Evidence error');
      expect(result).toEqual({ success: false });
    });

    it('toggles loading state', async () => {
      mockInvoke.mockResolvedValue({ success: true, evidence: [] });

      const store = useComplianceStore();
      const promise = store.getEvidenceByCriteria('security');
      expect(store.loading).toBe(true);

      await promise;
      expect(store.loading).toBe(false);
    });
  });
});
