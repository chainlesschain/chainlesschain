import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger paths used by source (CJS require path)
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: mockLogger,
  createLogger: () => mockLogger,
}));

vi.mock("../../../src/main/utils/logger", () => ({
  logger: mockLogger,
  createLogger: () => mockLogger,
}));

// Source is CJS (require/module.exports) — load via require for matching style
const {
  registerAuditIPC,
  unregisterAuditIPC,
  CHANNELS,
} = require("../../../src/main/audit/audit-ipc");

function createMockIpcMain() {
  return {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  };
}

function createMockAuditLogger() {
  return {
    query: vi
      .fn()
      .mockResolvedValue({ logs: [], total: 0, page: 1, pageSize: 20 }),
    getLogDetail: vi
      .fn()
      .mockResolvedValue({ id: "log-1", eventType: "login" }),
    exportLogs: vi
      .fn()
      .mockResolvedValue({
        filePath: "/tmp/audit.csv",
        format: "csv",
        count: 5,
      }),
    getStatistics: vi.fn().mockResolvedValue({ total: 100, byRiskLevel: {} }),
    applyRetentionPolicy: vi.fn().mockResolvedValue({ deleted: 42 }),
    previewRetentionDeletion: vi.fn().mockResolvedValue({ wouldDelete: 42 }),
  };
}

function createMockComplianceManager() {
  return {
    getPolicies: vi.fn().mockResolvedValue([{ id: "p1", framework: "GDPR" }]),
    createPolicy: vi.fn().mockResolvedValue({ id: "p2", framework: "SOC2" }),
    updatePolicy: vi
      .fn()
      .mockResolvedValue({ id: "p1", framework: "GDPR", updated: true }),
    deletePolicy: vi.fn().mockResolvedValue({ deleted: true }),
    checkCompliance: vi
      .fn()
      .mockResolvedValue({ score: 0.95, framework: "GDPR" }),
    generateReport: vi
      .fn()
      .mockResolvedValue({ reportId: "r1", framework: "SOC2" }),
  };
}

function createMockDataSubjectHandler() {
  return {
    createRequest: vi.fn().mockResolvedValue({ id: "dsr-1", type: "access" }),
    listRequests: vi.fn().mockResolvedValue([{ id: "dsr-1" }]),
    getRequestDetail: vi
      .fn()
      .mockResolvedValue({ id: "dsr-1", type: "access" }),
    processRequest: vi
      .fn()
      .mockResolvedValue({ id: "dsr-1", status: "processed" }),
    approveRequest: vi
      .fn()
      .mockResolvedValue({ id: "dsr-1", status: "approved" }),
    exportSubjectData: vi
      .fn()
      .mockResolvedValue({ filePath: "/tmp/subject.json" }),
  };
}

describe("audit-ipc", () => {
  let mockIpcMain;
  let mockAuditLogger;
  let mockComplianceManager;
  let mockDataSubjectHandler;
  let handlers;

  beforeEach(() => {
    vi.clearAllMocks();

    mockIpcMain = createMockIpcMain();
    mockAuditLogger = createMockAuditLogger();
    mockComplianceManager = createMockComplianceManager();
    mockDataSubjectHandler = createMockDataSubjectHandler();

    registerAuditIPC({
      database: {},
      auditLogger: mockAuditLogger,
      complianceManager: mockComplianceManager,
      dataSubjectHandler: mockDataSubjectHandler,
      ipcMain: mockIpcMain,
    });

    handlers = {};
    for (const call of mockIpcMain.handle.mock.calls) {
      handlers[call[0]] = call[1];
    }
  });

  // --- Registration ---

  it("should export CHANNELS with 18 entries", () => {
    expect(CHANNELS).toHaveLength(18);
  });

  it("should register all 18 IPC handlers", () => {
    expect(mockIpcMain.handle).toHaveBeenCalledTimes(18);
  });

  it("should register handlers for all defined channels", () => {
    const registered = mockIpcMain.handle.mock.calls.map((c) => c[0]);
    for (const channel of CHANNELS) {
      expect(registered).toContain(channel);
    }
  });

  it("should register all handlers as async functions", () => {
    for (const handler of Object.values(handlers)) {
      expect(handler.constructor.name).toBe("AsyncFunction");
    }
  });

  // --- Audit Log handlers ---

  it("audit:query-logs delegates to auditLogger.query", async () => {
    const result = await handlers["audit:query-logs"](
      {},
      { eventType: "login" },
    );
    expect(mockAuditLogger.query).toHaveBeenCalledWith({ eventType: "login" });
    expect(result).toEqual({
      success: true,
      data: { logs: [], total: 0, page: 1, pageSize: 20 },
    });
  });

  it("audit:get-log-detail delegates to auditLogger.getLogDetail", async () => {
    const result = await handlers["audit:get-log-detail"]({}, "log-1");
    expect(mockAuditLogger.getLogDetail).toHaveBeenCalledWith("log-1");
    expect(result.success).toBe(true);
  });

  it("audit:export-logs passes format + filters positionally", async () => {
    await handlers["audit:export-logs"]({}, "csv", { eventType: "login" });
    expect(mockAuditLogger.exportLogs).toHaveBeenCalledWith("csv", {
      eventType: "login",
    });
  });

  it("audit:get-statistics delegates to auditLogger.getStatistics", async () => {
    await handlers["audit:get-statistics"](
      {},
      { startTime: 100, endTime: 200 },
    );
    expect(mockAuditLogger.getStatistics).toHaveBeenCalledWith({
      startTime: 100,
      endTime: 200,
    });
  });

  // --- Compliance handlers (the renderer-facing ones the recent dead-handler bug exposed) ---

  it("compliance:get-policies delegates to complianceManager.getPolicies", async () => {
    const result = await handlers["compliance:get-policies"](
      {},
      { framework: "GDPR" },
    );
    expect(mockComplianceManager.getPolicies).toHaveBeenCalledWith({
      framework: "GDPR",
    });
    expect(result).toEqual({
      success: true,
      data: [{ id: "p1", framework: "GDPR" }],
    });
  });

  it("compliance:create-policy delegates to complianceManager.createPolicy", async () => {
    await handlers["compliance:create-policy"]({}, { framework: "SOC2" });
    expect(mockComplianceManager.createPolicy).toHaveBeenCalledWith({
      framework: "SOC2",
    });
  });

  it("compliance:update-policy passes id + updates positionally", async () => {
    await handlers["compliance:update-policy"]({}, "p1", { name: "v2" });
    expect(mockComplianceManager.updatePolicy).toHaveBeenCalledWith("p1", {
      name: "v2",
    });
  });

  it("compliance:delete-policy delegates to complianceManager.deletePolicy", async () => {
    await handlers["compliance:delete-policy"]({}, "p1");
    expect(mockComplianceManager.deletePolicy).toHaveBeenCalledWith("p1");
  });

  it("compliance:check-compliance delegates to complianceManager.checkCompliance", async () => {
    await handlers["compliance:check-compliance"]({}, "GDPR");
    expect(mockComplianceManager.checkCompliance).toHaveBeenCalledWith("GDPR");
  });

  it("compliance:generate-report passes framework + dateRange positionally", async () => {
    await handlers["compliance:generate-report"]({}, "SOC2", {
      startDate: 100,
      endDate: 200,
    });
    expect(mockComplianceManager.generateReport).toHaveBeenCalledWith("SOC2", {
      startDate: 100,
      endDate: 200,
    });
  });

  // --- DSR handlers ---

  it("dsr:create-request passes type + subjectDid + data positionally", async () => {
    await handlers["dsr:create-request"]({}, "access", "did:cc:123", {
      reason: "audit",
    });
    expect(mockDataSubjectHandler.createRequest).toHaveBeenCalledWith(
      "access",
      "did:cc:123",
      { reason: "audit" },
    );
  });

  it("dsr:list-requests delegates to dataSubjectHandler.listRequests", async () => {
    await handlers["dsr:list-requests"]({}, { status: "pending" });
    expect(mockDataSubjectHandler.listRequests).toHaveBeenCalledWith({
      status: "pending",
    });
  });

  it("dsr:approve-request passes id + responseData positionally", async () => {
    await handlers["dsr:approve-request"]({}, "dsr-1", { notes: "ok" });
    expect(mockDataSubjectHandler.approveRequest).toHaveBeenCalledWith(
      "dsr-1",
      {
        notes: "ok",
      },
    );
  });

  it("dsr:export-subject-data delegates to dataSubjectHandler.exportSubjectData", async () => {
    await handlers["dsr:export-subject-data"]({}, "did:cc:123");
    expect(mockDataSubjectHandler.exportSubjectData).toHaveBeenCalledWith(
      "did:cc:123",
    );
  });

  // --- Retention handlers ---

  it("retention:apply-policy delegates to auditLogger.applyRetentionPolicy", async () => {
    const result = await handlers["retention:apply-policy"]({}, "policy-1");
    expect(mockAuditLogger.applyRetentionPolicy).toHaveBeenCalledWith(
      "policy-1",
    );
    expect(result.data.deleted).toBe(42);
  });

  it("retention:preview-deletion delegates to auditLogger.previewRetentionDeletion", async () => {
    const result = await handlers["retention:preview-deletion"]({}, "policy-1");
    expect(mockAuditLogger.previewRetentionDeletion).toHaveBeenCalledWith(
      "policy-1",
    );
    expect(result.data.wouldDelete).toBe(42);
  });

  // --- Error wrapping ---

  it("returns { success: false, error: message } on handler errors", async () => {
    mockAuditLogger.query.mockRejectedValue(new Error("DB connection lost"));
    const result = await handlers["audit:query-logs"]({}, {});
    expect(result).toEqual({ success: false, error: "DB connection lost" });
  });

  // --- Lazy-init: inject overrides lazy require ---

  it("uses injected manager instances instead of lazy-loading from disk", async () => {
    // If injection failed, the handler would try to load enterprise-audit-logger.js
    // and construct a real instance with database={}, which would throw or hang.
    // The fact that mockAuditLogger.query is what gets called proves DI took over.
    await handlers["audit:query-logs"]({}, {});
    expect(mockAuditLogger.query).toHaveBeenCalledTimes(1);
  });

  // --- Unregister ---

  it("unregisterAuditIPC removes all 18 channels", () => {
    unregisterAuditIPC({ ipcMain: mockIpcMain });
    expect(mockIpcMain.removeHandler).toHaveBeenCalledTimes(18);
    const removed = mockIpcMain.removeHandler.mock.calls.map((c) => c[0]);
    for (const channel of CHANNELS) {
      expect(removed).toContain(channel);
    }
  });
});
