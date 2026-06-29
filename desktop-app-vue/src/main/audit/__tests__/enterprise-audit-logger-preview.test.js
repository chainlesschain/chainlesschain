/**
 * EnterpriseAuditLogger.previewRetentionDeletion — dry-run
 *
 * Regression: the retention:preview-deletion IPC handler called
 * getAuditLogger().previewRetentionDeletion(policyId), but that method did not
 * exist on EnterpriseAuditLogger (only applyRetentionPolicy, which DELETES). So
 * the channel always threw and returned {success:false}. The new method mirrors
 * applyRetentionPolicy's predicates with COUNT instead of DELETE — and must
 * never delete.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { EnterpriseAuditLogger } = require("../enterprise-audit-logger.js");

describe("EnterpriseAuditLogger.previewRetentionDeletion (dry-run)", () => {
  it("counts what would be deleted without deleting (db-backed)", async () => {
    const run = vi.fn();
    const get = vi.fn((sql) => {
      if (/risk_level NOT IN/.test(sql)) {
        return { n: 40 };
      }
      if (/risk_level IN/.test(sql)) {
        return { n: 5 };
      }
      if (/COUNT\(\*\) as total/.test(sql)) {
        return { total: 100 };
      }
      return { n: 0 };
    });
    // Construct without a db so the constructor's async _initTable (which calls
    // db.run) doesn't pollute the run spy, then attach the mock db.
    const auditLogger = new EnterpriseAuditLogger({});
    auditLogger.db = { run, get };
    auditLogger._tableInitialized = true;

    const res = await auditLogger.previewRetentionDeletion({
      retentionDays: 90,
    });

    expect(res.success).toBe(true);
    expect(res.data.byTime).toBe(45); // 40 (normal) + 5 (high-risk)
    expect(res.data.byMaxRecords).toBe(0); // 100 - 45 = 55 < default maxRec
    expect(res.data.wouldDeleteCount).toBe(45);
    // A preview must NOT delete anything.
    expect(run).not.toHaveBeenCalled();
  });

  it("uses the memory buffer when there is no db", async () => {
    const auditLogger = new EnterpriseAuditLogger({});
    auditLogger.memoryBuffer = [
      { riskLevel: "low", timestamp: "2000-01-01T00:00:00.000Z" }, // old → deleted
      { riskLevel: "low", timestamp: new Date().toISOString() }, // recent → kept
    ];

    const res = await auditLogger.previewRetentionDeletion({
      retentionDays: 90,
    });

    expect(res.success).toBe(true);
    expect(res.data.source).toBe("memory");
    expect(res.data.wouldDeleteCount).toBe(1);
  });
});
