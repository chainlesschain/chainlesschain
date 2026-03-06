import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

describe('compliance-ipc', () => {
  let registerComplianceIPC, CHANNELS;
  let mockIpcMain;
  let mockSoc2Compliance;
  let mockDataClassifier;
  let mockClassificationPolicy;
  let handlers;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await import('../../../src/main/audit/compliance-ipc.js');
    registerComplianceIPC = mod.registerComplianceIPC;
    CHANNELS = mod.CHANNELS;

    mockIpcMain = {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    };

    mockSoc2Compliance = {
      collectAuditLogEvidence: vi.fn().mockResolvedValue({ id: 'ev1', title: 'Audit' }),
      collectAccessControlEvidence: vi.fn().mockResolvedValue({ id: 'ev2', title: 'Access' }),
      collectConfigurationEvidence: vi.fn().mockResolvedValue({ id: 'ev3', title: 'Config' }),
      generateReport: vi.fn().mockResolvedValue({ title: 'Report', complianceScore: 80 }),
      verifyEvidence: vi.fn().mockResolvedValue({ success: true, status: 'verified' }),
      getEvidenceByCriteria: vi.fn().mockResolvedValue([{ id: 'ev1' }]),
    };

    mockDataClassifier = {
      classify: vi.fn().mockResolvedValue({ category: 'pii', severity: 'high' }),
      batchScan: vi.fn().mockResolvedValue({ results: [], summary: {} }),
      getHistory: vi.fn().mockResolvedValue([]),
    };

    mockClassificationPolicy = {
      autoTag: vi.fn().mockResolvedValue({ contentId: 'c1', level: 'confidential' }),
      getPolicies: vi.fn().mockReturnValue([{ id: 'p1' }]),
      checkAccess: vi.fn().mockReturnValue(true),
    };

    // Register and capture handlers
    registerComplianceIPC({
      soc2Compliance: mockSoc2Compliance,
      dataClassifier: mockDataClassifier,
      classificationPolicy: mockClassificationPolicy,
      ipcMain: mockIpcMain,
    });

    handlers = {};
    for (const call of mockIpcMain.handle.mock.calls) {
      handlers[call[0]] = call[1];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Registration ---

  it('should export CHANNELS with 12 entries', () => {
    expect(CHANNELS).toHaveLength(12);
  });

  it('should register all 12 IPC handlers', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledTimes(12);
  });

  it('should return handlerCount from registerComplianceIPC', () => {
    const result = registerComplianceIPC({
      soc2Compliance: mockSoc2Compliance,
      dataClassifier: mockDataClassifier,
      classificationPolicy: mockClassificationPolicy,
      ipcMain: mockIpcMain,
    });
    expect(result.handlerCount).toBe(12);
  });

  it('should register handlers for all defined channels', () => {
    const registeredChannels = mockIpcMain.handle.mock.calls.map((c) => c[0]);
    for (const channel of CHANNELS) {
      expect(registeredChannels).toContain(channel);
    }
  });

  it('should register all handlers as async functions', () => {
    for (const [, handler] of Object.entries(handlers)) {
      // AsyncFunction constructor name
      expect(handler.constructor.name).toBe('AsyncFunction');
    }
  });

  // --- collect-audit-evidence ---

  it('should call soc2Compliance.collectAuditLogEvidence for collect-audit-evidence', async () => {
    const result = await handlers['compliance:collect-audit-evidence']({}, { periodStart: 100 });
    expect(result.success).toBe(true);
    expect(result.evidence).toEqual({ id: 'ev1', title: 'Audit' });
    expect(mockSoc2Compliance.collectAuditLogEvidence).toHaveBeenCalledWith({ periodStart: 100 });
  });

  it('should return error when soc2Compliance is null for collect-audit-evidence', async () => {
    const localIpc = { handle: vi.fn(), removeHandler: vi.fn() };
    registerComplianceIPC({
      soc2Compliance: null,
      dataClassifier: mockDataClassifier,
      classificationPolicy: mockClassificationPolicy,
      ipcMain: localIpc,
    });
    const handler = localIpc.handle.mock.calls.find((c) => c[0] === 'compliance:collect-audit-evidence')[1];
    const result = await handler({}, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  // --- collect-access-evidence ---

  it('should call collectAccessControlEvidence for collect-access-evidence', async () => {
    const result = await handlers['compliance:collect-access-evidence']({});
    expect(result.success).toBe(true);
    expect(result.evidence).toEqual({ id: 'ev2', title: 'Access' });
  });

  // --- collect-config-evidence ---

  it('should call collectConfigurationEvidence for collect-config-evidence', async () => {
    const result = await handlers['compliance:collect-config-evidence']({});
    expect(result.success).toBe(true);
    expect(result.evidence).toEqual({ id: 'ev3', title: 'Config' });
  });

  // --- generate-report ---

  it('should call generateReport for generate-report', async () => {
    const result = await handlers['compliance:generate-report']({}, { periodStart: 0 });
    expect(result.success).toBe(true);
    expect(result.report.complianceScore).toBe(80);
  });

  // --- classify-content ---

  it('should call dataClassifier.classify for classify-content', async () => {
    const result = await handlers['compliance:classify-content']({}, { content: 'test@example.com', options: {} });
    expect(result.success).toBe(true);
    expect(result.result.category).toBe('pii');
    expect(mockDataClassifier.classify).toHaveBeenCalledWith('test@example.com', {});
  });

  it('should return error when dataClassifier is null', async () => {
    const localIpc = { handle: vi.fn(), removeHandler: vi.fn() };
    registerComplianceIPC({
      soc2Compliance: mockSoc2Compliance,
      dataClassifier: null,
      classificationPolicy: mockClassificationPolicy,
      ipcMain: localIpc,
    });
    const handler = localIpc.handle.mock.calls.find((c) => c[0] === 'compliance:classify-content')[1];
    const result = await handler({}, { content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  // --- get-policies ---

  it('should call classificationPolicy.getPolicies for get-policies', async () => {
    const result = await handlers['compliance:get-policies']({});
    expect(result.success).toBe(true);
    expect(result.policies).toEqual([{ id: 'p1' }]);
  });

  // --- check-access ---

  it('should call classificationPolicy.checkAccess for check-access', async () => {
    const result = await handlers['compliance:check-access']({}, { requiredLevel: 'confidential', userClearance: 'top_secret' });
    expect(result.success).toBe(true);
    expect(result.allowed).toBe(true);
    expect(mockClassificationPolicy.checkAccess).toHaveBeenCalledWith('confidential', 'top_secret');
  });

  // --- batch-scan ---

  it('should call dataClassifier.batchScan for batch-scan', async () => {
    const result = await handlers['compliance:batch-scan']({}, { items: [{ id: '1', content: 'test' }] });
    expect(result.success).toBe(true);
    expect(mockDataClassifier.batchScan).toHaveBeenCalledWith([{ id: '1', content: 'test' }]);
  });

  // --- auto-tag ---

  it('should call classificationPolicy.autoTag for auto-tag', async () => {
    const classResult = { category: 'pii', detections: [] };
    const result = await handlers['compliance:auto-tag']({}, { contentId: 'c1', classificationResult: classResult });
    expect(result.success).toBe(true);
    expect(result.tag.contentId).toBe('c1');
  });

  // --- error handling ---

  it('should return { success: false, error: message } on handler errors', async () => {
    mockSoc2Compliance.generateReport.mockRejectedValue(new Error('DB failure'));
    const result = await handlers['compliance:generate-report']({}, {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('DB failure');
  });

  it('should return error when classificationPolicy is null for check-access', async () => {
    const localIpc = { handle: vi.fn(), removeHandler: vi.fn() };
    registerComplianceIPC({
      soc2Compliance: mockSoc2Compliance,
      dataClassifier: mockDataClassifier,
      classificationPolicy: null,
      ipcMain: localIpc,
    });
    const handler = localIpc.handle.mock.calls.find((c) => c[0] === 'compliance:check-access')[1];
    const result = await handler({}, { requiredLevel: 'top_secret', userClearance: 'public' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });
});
