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
});
