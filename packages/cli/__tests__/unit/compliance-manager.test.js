import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureComplianceTables,
  collectEvidence,
  generateReport,
  classifyData,
  scanCompliance,
  listPolicies,
  addPolicy,
  checkAccess,
  _resetState,
  EVIDENCE_STATUS_V2,
  POLICY_STATUS_V2,
  REPORT_STATUS_V2,
  SEVERITY_V2,
  FRAMEWORKS_V2,
  POLICY_TYPES_V2,
  COMPLIANCE_DEFAULT_MAX_ACTIVE_POLICIES,
  COMPLIANCE_DEFAULT_EVIDENCE_RETENTION_MS,
  COMPLIANCE_DEFAULT_REPORT_RETENTION_MS,
  setMaxActivePolicies,
  setEvidenceRetentionMs,
  setReportRetentionMs,
  getMaxActivePolicies,
  getEvidenceRetentionMs,
  getReportRetentionMs,
  getActivePolicyCount,
  registerEvidenceV2,
  getEvidenceStatusV2,
  setEvidenceStatusV2,
  autoExpireEvidence,
  registerPolicyV2,
  getPolicyStatusV2,
  setPolicyStatusV2,
  activatePolicy,
  registerReportV2,
  getReportStatusV2,
  setReportStatusV2,
  publishReport,
  autoArchiveStaleReports,
  getComplianceStatsV2,
} from "../../src/lib/compliance-manager.js";

describe("compliance-manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureComplianceTables(db);
  });

  describe("ensureComplianceTables", () => {
    it("creates all compliance tables", () => {
      expect(db.tables.has("compliance_evidence")).toBe(true);
      expect(db.tables.has("compliance_reports")).toBe(true);
      expect(db.tables.has("compliance_policies")).toBe(true);
    });

    it("is idempotent", () => {
      ensureComplianceTables(db);
      expect(db.tables.has("compliance_evidence")).toBe(true);
    });
  });

  describe("collectEvidence", () => {
    it("collects evidence for a framework", () => {
      const e = collectEvidence(
        db,
        "gdpr",
        "encryption",
        "AES-256 in use",
        "audit",
      );
      expect(e.id).toBeDefined();
      expect(e.framework).toBe("gdpr");
      expect(e.type).toBe("encryption");
      expect(e.status).toBe("collected");
    });

    it("throws on missing framework", () => {
      expect(() => collectEvidence(db, "")).toThrow("Framework is required");
    });

    it("throws on invalid framework", () => {
      expect(() => collectEvidence(db, "invalid")).toThrow("Unknown framework");
    });

    it("persists to database", () => {
      collectEvidence(db, "soc2", "access_control", "RBAC configured");
      const rows = db.data.get("compliance_evidence") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("generateReport", () => {
    it("generates a report", () => {
      const r = generateReport(db, "gdpr", "Q1 Report");
      expect(r.id).toBeDefined();
      expect(r.framework).toBe("gdpr");
      expect(r.title).toBe("Q1 Report");
      expect(r.score).toBeDefined();
    });

    it("throws on missing framework", () => {
      expect(() => generateReport(db, "")).toThrow("Framework is required");
    });

    it("uses default title", () => {
      const r = generateReport(db, "hipaa");
      expect(r.title).toContain("HIPAA");
    });

    it("persists to database", () => {
      generateReport(db, "gdpr");
      const rows = db.data.get("compliance_reports") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("classifyData", () => {
    it("detects PII (email)", () => {
      const r = classifyData("Contact: user@example.com");
      expect(r.hasClassifiedData).toBe(true);
      expect(r.classifications).toContain("pii");
    });

    it("detects PII (SSN pattern)", () => {
      const r = classifyData("SSN: 123-45-6789");
      expect(r.hasClassifiedData).toBe(true);
      expect(r.classifications).toContain("pii");
    });

    it("detects financial data", () => {
      const r = classifyData("Card: 4111 1111 1111 1111");
      expect(r.hasClassifiedData).toBe(true);
      expect(r.classifications).toContain("financial");
    });

    it("detects health data", () => {
      const r = classifyData("Patient diagnosis: hypertension");
      expect(r.hasClassifiedData).toBe(true);
      expect(r.classifications).toContain("health");
    });

    it("returns low sensitivity for clean content", () => {
      const r = classifyData("Hello world");
      expect(r.hasClassifiedData).toBe(false);
      expect(r.sensitivity).toBe("low");
    });

    it("returns high sensitivity for multiple classifications", () => {
      const r = classifyData("Patient email: doc@hospital.com diagnosis: flu");
      expect(r.sensitivity).toBe("high");
    });

    it("throws on missing content", () => {
      expect(() => classifyData("")).toThrow("Content is required");
    });
  });

  describe("scanCompliance", () => {
    it("returns zero score with no policies", () => {
      const r = scanCompliance(db, "gdpr");
      expect(r.score).toBe(0);
      expect(r.total).toBe(0);
    });

    it("scores based on evidence matching policy types", () => {
      addPolicy(db, "Encrypt Data", "encryption", "gdpr", {}, "high");
      collectEvidence(db, "gdpr", "encryption", "AES enabled");
      const r = scanCompliance(db, "gdpr");
      expect(r.score).toBe(100);
      expect(r.passed).toBe(1);
    });

    it("reports failures when no evidence matches", () => {
      addPolicy(db, "Retain Data", "retention", "gdpr", {});
      const r = scanCompliance(db, "gdpr");
      expect(r.failed).toBe(1);
      expect(r.score).toBe(0);
    });

    it("throws on missing framework", () => {
      expect(() => scanCompliance(db, "")).toThrow("Framework is required");
    });
  });

  describe("listPolicies / addPolicy", () => {
    it("returns empty initially", () => {
      expect(listPolicies(db)).toEqual([]);
    });

    it("adds and lists policies", () => {
      addPolicy(db, "Test", "encryption", "gdpr", {}, "high");
      expect(listPolicies(db).length).toBe(1);
    });

    it("filters by framework", () => {
      addPolicy(db, "A", "encryption", "gdpr", {});
      addPolicy(db, "B", "encryption", "hipaa", {});
      expect(listPolicies(db, { framework: "gdpr" }).length).toBe(1);
    });

    it("throws on invalid policy type", () => {
      expect(() => addPolicy(db, "Test", "invalid", "gdpr")).toThrow(
        "Invalid policy type",
      );
    });

    it("throws on invalid framework", () => {
      expect(() => addPolicy(db, "Test", "encryption", "invalid")).toThrow(
        "Invalid framework",
      );
    });
  });

  describe("checkAccess", () => {
    it("grants admin read access", () => {
      const r = checkAccess("notes", "read", "admin");
      expect(r.granted).toBe(true);
    });

    it("denies user delete access", () => {
      const r = checkAccess("notes", "delete", "user");
      expect(r.granted).toBe(false);
    });

    it("grants auditor audit access", () => {
      const r = checkAccess("logs", "audit", "auditor");
      expect(r.granted).toBe(true);
    });

    it("denies unknown role", () => {
      const r = checkAccess("notes", "read", "guest");
      expect(r.granted).toBe(false);
    });
  });

  /* ═════════════════════════════════════════════════════════════
     V2 SURFACE TESTS (Phase 19 canonical)
     ═════════════════════════════════════════════════════════════ */

  describe("V2 frozen enums", () => {
    it("EVIDENCE_STATUS_V2 has 4 states", () => {
      expect(Object.values(EVIDENCE_STATUS_V2).sort()).toEqual([
        "collected",
        "expired",
        "rejected",
        "verified",
      ]);
      expect(Object.isFrozen(EVIDENCE_STATUS_V2)).toBe(true);
    });
    it("POLICY_STATUS_V2 has 4 states", () => {
      expect(Object.values(POLICY_STATUS_V2).sort()).toEqual([
        "active",
        "deprecated",
        "draft",
        "suspended",
      ]);
      expect(Object.isFrozen(POLICY_STATUS_V2)).toBe(true);
    });
    it("REPORT_STATUS_V2 has 4 states", () => {
      expect(Object.values(REPORT_STATUS_V2).sort()).toEqual([
        "archived",
        "generating",
        "pending",
        "published",
      ]);
      expect(Object.isFrozen(REPORT_STATUS_V2)).toBe(true);
    });
    it("SEVERITY_V2 has 4 buckets", () => {
      expect(Object.values(SEVERITY_V2).sort()).toEqual([
        "critical",
        "high",
        "low",
        "medium",
      ]);
      expect(Object.isFrozen(SEVERITY_V2)).toBe(true);
    });
    it("FRAMEWORKS_V2 and POLICY_TYPES_V2 are frozen", () => {
      expect(Object.isFrozen(FRAMEWORKS_V2)).toBe(true);
      expect(Object.isFrozen(POLICY_TYPES_V2)).toBe(true);
      expect(FRAMEWORKS_V2).toContain("gdpr");
      expect(POLICY_TYPES_V2).toContain("encryption");
    });
    it("defaults exported", () => {
      expect(COMPLIANCE_DEFAULT_MAX_ACTIVE_POLICIES).toBe(20);
      expect(COMPLIANCE_DEFAULT_EVIDENCE_RETENTION_MS).toBe(180 * 86400000);
      expect(COMPLIANCE_DEFAULT_REPORT_RETENTION_MS).toBe(365 * 86400000);
    });
  });

  describe("V2 config mutators", () => {
    it("setMaxActivePolicies floors non-integer", () => {
      expect(setMaxActivePolicies(5.7)).toBe(5);
      expect(getMaxActivePolicies()).toBe(5);
    });
    it("setEvidenceRetentionMs rejects ≤0/NaN", () => {
      expect(() => setEvidenceRetentionMs(0)).toThrow("positive integer");
      expect(() => setEvidenceRetentionMs(NaN)).toThrow("positive integer");
      expect(() => setEvidenceRetentionMs(-1)).toThrow("positive integer");
    });
    it("setReportRetentionMs stores value", () => {
      expect(setReportRetentionMs(10_000)).toBe(10000);
      expect(getReportRetentionMs()).toBe(10000);
    });
    it("_resetState restores defaults", () => {
      setMaxActivePolicies(1);
      setEvidenceRetentionMs(100);
      setReportRetentionMs(200);
      _resetState();
      expect(getMaxActivePolicies()).toBe(
        COMPLIANCE_DEFAULT_MAX_ACTIVE_POLICIES,
      );
      expect(getEvidenceRetentionMs()).toBe(
        COMPLIANCE_DEFAULT_EVIDENCE_RETENTION_MS,
      );
      expect(getReportRetentionMs()).toBe(
        COMPLIANCE_DEFAULT_REPORT_RETENTION_MS,
      );
    });
  });

  describe("registerEvidenceV2", () => {
    it("tags evidence COLLECTED", () => {
      const e = registerEvidenceV2(db, {
        evidenceId: "ev1",
        framework: "gdpr",
        type: "encryption",
      });
      expect(e.status).toBe(EVIDENCE_STATUS_V2.COLLECTED);
      expect(e.framework).toBe("gdpr");
    });
    it("rejects missing evidenceId", () => {
      expect(() => registerEvidenceV2(db, { framework: "gdpr" })).toThrow(
        "evidenceId is required",
      );
    });
    it("rejects missing framework", () => {
      expect(() => registerEvidenceV2(db, { evidenceId: "e" })).toThrow(
        "framework is required",
      );
    });
    it("rejects invalid framework", () => {
      expect(() =>
        registerEvidenceV2(db, { evidenceId: "e", framework: "xxx" }),
      ).toThrow("Invalid framework");
    });
    it("rejects duplicate", () => {
      registerEvidenceV2(db, { evidenceId: "dup", framework: "gdpr" });
      expect(() =>
        registerEvidenceV2(db, { evidenceId: "dup", framework: "gdpr" }),
      ).toThrow("already registered");
    });
  });

  describe("setEvidenceStatusV2", () => {
    beforeEach(() => {
      registerEvidenceV2(db, { evidenceId: "e1", framework: "gdpr" });
    });
    it("COLLECTED → VERIFIED", () => {
      const r = setEvidenceStatusV2(db, "e1", EVIDENCE_STATUS_V2.VERIFIED);
      expect(r.status).toBe("verified");
    });
    it("COLLECTED → REJECTED with reason patch", () => {
      const r = setEvidenceStatusV2(db, "e1", EVIDENCE_STATUS_V2.REJECTED, {
        reason: "failed audit",
      });
      expect(r.status).toBe("rejected");
      expect(r.reason).toBe("failed audit");
    });
    it("rejects VERIFIED → COLLECTED", () => {
      setEvidenceStatusV2(db, "e1", EVIDENCE_STATUS_V2.VERIFIED);
      expect(() =>
        setEvidenceStatusV2(db, "e1", EVIDENCE_STATUS_V2.COLLECTED),
      ).toThrow("Invalid transition");
    });
    it("rejects terminal EXPIRED", () => {
      setEvidenceStatusV2(db, "e1", EVIDENCE_STATUS_V2.EXPIRED);
      expect(() =>
        setEvidenceStatusV2(db, "e1", EVIDENCE_STATUS_V2.VERIFIED),
      ).toThrow("terminal");
    });
    it("rejects unknown evidenceId", () => {
      expect(() =>
        setEvidenceStatusV2(db, "nope", EVIDENCE_STATUS_V2.VERIFIED),
      ).toThrow("not found");
    });
    it("rejects invalid status", () => {
      expect(() => setEvidenceStatusV2(db, "e1", "weird")).toThrow(
        "Invalid evidence status",
      );
    });
    it("patch merges metadata", () => {
      const r = setEvidenceStatusV2(db, "e1", EVIDENCE_STATUS_V2.VERIFIED, {
        metadata: { auditor: "alice" },
      });
      expect(r.metadata.auditor).toBe("alice");
    });
  });

  describe("autoExpireEvidence", () => {
    it("bulk-flips stale evidence to EXPIRED", () => {
      setEvidenceRetentionMs(1000);
      registerEvidenceV2(db, { evidenceId: "old", framework: "gdpr" });
      const expired = autoExpireEvidence(db, Date.now() + 2000);
      expect(expired.length).toBe(1);
      expect(expired[0].status).toBe("expired");
      expect(expired[0].reason).toBe("auto-expired: retention exceeded");
    });
    it("skips fresh evidence", () => {
      registerEvidenceV2(db, { evidenceId: "fresh", framework: "gdpr" });
      const expired = autoExpireEvidence(db, Date.now());
      expect(expired.length).toBe(0);
    });
  });

  describe("registerPolicyV2", () => {
    it("tags policy DRAFT", () => {
      const p = registerPolicyV2(db, {
        policyId: "p1",
        name: "Encrypt",
        type: "encryption",
        framework: "gdpr",
      });
      expect(p.status).toBe(POLICY_STATUS_V2.DRAFT);
      expect(p.severity).toBe("medium");
    });
    it("rejects missing policyId/name/type/framework", () => {
      expect(() => registerPolicyV2(db, {})).toThrow("policyId is required");
      expect(() => registerPolicyV2(db, { policyId: "p" })).toThrow(
        "name is required",
      );
      expect(() => registerPolicyV2(db, { policyId: "p", name: "n" })).toThrow(
        "Invalid policy type",
      );
      expect(() =>
        registerPolicyV2(db, {
          policyId: "p",
          name: "n",
          type: "encryption",
          framework: "x",
        }),
      ).toThrow("Invalid framework");
    });
    it("rejects invalid severity", () => {
      expect(() =>
        registerPolicyV2(db, {
          policyId: "p",
          name: "n",
          type: "encryption",
          framework: "gdpr",
          severity: "none",
        }),
      ).toThrow("Invalid severity");
    });
    it("rejects duplicate", () => {
      registerPolicyV2(db, {
        policyId: "p",
        name: "n",
        type: "encryption",
        framework: "gdpr",
      });
      expect(() =>
        registerPolicyV2(db, {
          policyId: "p",
          name: "n",
          type: "encryption",
          framework: "gdpr",
        }),
      ).toThrow("already registered");
    });
  });

  describe("setPolicyStatusV2", () => {
    beforeEach(() => {
      registerPolicyV2(db, {
        policyId: "p1",
        name: "X",
        type: "encryption",
        framework: "gdpr",
      });
    });
    it("DRAFT → ACTIVE via activatePolicy", () => {
      const r = activatePolicy(db, "p1");
      expect(r.status).toBe("active");
    });
    it("ACTIVE → SUSPENDED → ACTIVE cycle", () => {
      activatePolicy(db, "p1");
      setPolicyStatusV2(db, "p1", POLICY_STATUS_V2.SUSPENDED);
      const r = setPolicyStatusV2(db, "p1", POLICY_STATUS_V2.ACTIVE);
      expect(r.status).toBe("active");
    });
    it("rejects DRAFT → SUSPENDED (invalid transition)", () => {
      expect(() =>
        setPolicyStatusV2(db, "p1", POLICY_STATUS_V2.SUSPENDED),
      ).toThrow("Invalid transition");
    });
    it("rejects terminal DEPRECATED mutation", () => {
      setPolicyStatusV2(db, "p1", POLICY_STATUS_V2.DEPRECATED);
      expect(() =>
        setPolicyStatusV2(db, "p1", POLICY_STATUS_V2.ACTIVE),
      ).toThrow("terminal");
    });
    it("rejects unknown policyId", () => {
      expect(() =>
        setPolicyStatusV2(db, "nope", POLICY_STATUS_V2.ACTIVE),
      ).toThrow("not found");
    });
    it("rejects invalid status", () => {
      expect(() => setPolicyStatusV2(db, "p1", "weird")).toThrow(
        "Invalid policy status",
      );
    });
    it("enforces max-active cap on →ACTIVE", () => {
      setMaxActivePolicies(1);
      activatePolicy(db, "p1");
      registerPolicyV2(db, {
        policyId: "p2",
        name: "Y",
        type: "retention",
        framework: "gdpr",
      });
      expect(() => activatePolicy(db, "p2")).toThrow(
        "Max active policies reached",
      );
    });
    it("patch merges metadata and reason", () => {
      const r = setPolicyStatusV2(db, "p1", POLICY_STATUS_V2.ACTIVE, {
        reason: "go live",
        metadata: { owner: "sec" },
      });
      expect(r.reason).toBe("go live");
      expect(r.metadata.owner).toBe("sec");
    });
  });

  describe("getActivePolicyCount", () => {
    it("returns 0 initially", () => {
      expect(getActivePolicyCount()).toBe(0);
    });
    it("counts only ACTIVE", () => {
      registerPolicyV2(db, {
        policyId: "a",
        name: "A",
        type: "encryption",
        framework: "gdpr",
      });
      registerPolicyV2(db, {
        policyId: "b",
        name: "B",
        type: "retention",
        framework: "gdpr",
      });
      activatePolicy(db, "a");
      expect(getActivePolicyCount()).toBe(1);
      expect(getActivePolicyCount("gdpr")).toBe(1);
      expect(getActivePolicyCount("soc2")).toBe(0);
    });
  });

  describe("registerReportV2 + lifecycle", () => {
    it("tags PENDING", () => {
      const r = registerReportV2(db, { reportId: "r1", framework: "gdpr" });
      expect(r.status).toBe(REPORT_STATUS_V2.PENDING);
      expect(r.title).toContain("GDPR");
    });
    it("rejects missing reportId/framework", () => {
      expect(() => registerReportV2(db, {})).toThrow("reportId is required");
      expect(() => registerReportV2(db, { reportId: "r" })).toThrow(
        "framework is required",
      );
    });
    it("PENDING → GENERATING → PUBLISHED via publishReport", () => {
      registerReportV2(db, { reportId: "r1", framework: "gdpr" });
      const r = publishReport(db, "r1", { score: 88, summary: "OK" });
      expect(r.status).toBe("published");
      expect(r.score).toBe(88);
      expect(r.summary).toBe("OK");
      expect(r.publishedAt).toBeDefined();
    });
    it("rejects already-terminal ARCHIVED", () => {
      registerReportV2(db, { reportId: "r1", framework: "gdpr" });
      setReportStatusV2(db, "r1", REPORT_STATUS_V2.ARCHIVED);
      expect(() =>
        setReportStatusV2(db, "r1", REPORT_STATUS_V2.PUBLISHED),
      ).toThrow("terminal");
    });
    it("rejects invalid transition", () => {
      registerReportV2(db, { reportId: "r1", framework: "gdpr" });
      expect(() =>
        setReportStatusV2(db, "r1", REPORT_STATUS_V2.PUBLISHED),
      ).toThrow("Invalid transition");
    });
  });

  describe("autoArchiveStaleReports", () => {
    it("bulk-flips published reports past retention", () => {
      setReportRetentionMs(1000);
      registerReportV2(db, { reportId: "r1", framework: "gdpr" });
      publishReport(db, "r1");
      const archived = autoArchiveStaleReports(db, Date.now() + 2000);
      expect(archived.length).toBe(1);
      expect(archived[0].status).toBe("archived");
      expect(archived[0].reason).toBe("auto-archived: retention exceeded");
    });
    it("skips pending / fresh reports", () => {
      registerReportV2(db, { reportId: "r1", framework: "gdpr" });
      registerReportV2(db, { reportId: "r2", framework: "gdpr" });
      publishReport(db, "r2");
      const archived = autoArchiveStaleReports(db, Date.now());
      expect(archived.length).toBe(0);
    });
  });

  describe("getComplianceStatsV2", () => {
    it("returns zero-initialized shape when empty", () => {
      const s = getComplianceStatsV2();
      expect(s.totalEvidence).toBe(0);
      expect(s.evidenceByStatus).toEqual({
        collected: 0,
        verified: 0,
        rejected: 0,
        expired: 0,
      });
      expect(s.policyByStatus).toEqual({
        draft: 0,
        active: 0,
        suspended: 0,
        deprecated: 0,
      });
      expect(s.reportByStatus).toEqual({
        pending: 0,
        generating: 0,
        published: 0,
        archived: 0,
      });
      expect(s.policyBySeverity).toEqual({
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      });
    });
    it("aggregates by status / severity", () => {
      registerEvidenceV2(db, { evidenceId: "e1", framework: "gdpr" });
      registerEvidenceV2(db, { evidenceId: "e2", framework: "gdpr" });
      setEvidenceStatusV2(db, "e2", EVIDENCE_STATUS_V2.VERIFIED);
      registerPolicyV2(db, {
        policyId: "p1",
        name: "A",
        type: "encryption",
        framework: "gdpr",
        severity: SEVERITY_V2.HIGH,
      });
      activatePolicy(db, "p1");
      registerReportV2(db, { reportId: "r1", framework: "gdpr" });
      const s = getComplianceStatsV2();
      expect(s.totalEvidence).toBe(2);
      expect(s.evidenceByStatus.collected).toBe(1);
      expect(s.evidenceByStatus.verified).toBe(1);
      expect(s.policyByStatus.active).toBe(1);
      expect(s.policyBySeverity.high).toBe(1);
      expect(s.reportByStatus.pending).toBe(1);
      expect(s.activePolicies).toBe(1);
    });
  });
});
