import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureDLPTables,
  scanContent,
  listIncidents,
  resolveIncident,
  getDLPStats,
  createPolicy,
  updatePolicy,
  deletePolicy,
  listDLPPolicies,
  _resetState,
} from "../../src/lib/dlp-engine.js";

describe("dlp-engine", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureDLPTables(db);
  });

  describe("ensureDLPTables", () => {
    it("creates dlp_incidents and dlp_policies tables", () => {
      expect(db.tables.has("dlp_incidents")).toBe(true);
      expect(db.tables.has("dlp_policies")).toBe(true);
    });

    it("is idempotent", () => {
      ensureDLPTables(db);
      expect(db.tables.has("dlp_incidents")).toBe(true);
    });
  });

  describe("createPolicy", () => {
    it("creates a policy with defaults", () => {
      const p = createPolicy(
        db,
        "SSN Detector",
        ["\\d{3}-\\d{2}-\\d{4}"],
        [],
        "block",
        "high",
      );
      expect(p.id).toBeDefined();
      expect(p.name).toBe("SSN Detector");
      expect(p.action).toBe("block");
      expect(p.severity).toBe("high");
      expect(p.enabled).toBe(true);
    });

    it("throws on missing name", () => {
      expect(() => createPolicy(db, "")).toThrow("Policy name is required");
    });

    it("persists to database", () => {
      createPolicy(db, "Test", [], [], "alert");
      const rows = db.data.get("dlp_policies") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("updatePolicy", () => {
    it("updates policy fields", () => {
      const p = createPolicy(db, "Test", [], [], "alert");
      const updated = updatePolicy(db, p.id, {
        name: "Updated",
        action: "block",
      });
      expect(updated.name).toBe("Updated");
      expect(updated.action).toBe("block");
    });

    it("throws on unknown policy", () => {
      expect(() => updatePolicy(db, "nonexistent", {})).toThrow(
        "Policy not found",
      );
    });
  });

  describe("deletePolicy", () => {
    it("deletes a policy", () => {
      const p = createPolicy(db, "Test", [], []);
      deletePolicy(db, p.id);
      expect(listDLPPolicies().length).toBe(0);
    });

    it("throws on unknown policy", () => {
      expect(() => deletePolicy(db, "nonexistent")).toThrow("Policy not found");
    });
  });

  describe("scanContent", () => {
    it("allows content when no policies match", () => {
      createPolicy(db, "SSN", ["\\d{3}-\\d{2}-\\d{4}"], [], "block");
      const r = scanContent(db, "Hello world", "email");
      expect(r.allowed).toBe(true);
      expect(r.matchedPolicies).toBe(0);
    });

    it("blocks content matching a regex pattern", () => {
      createPolicy(db, "SSN", ["\\d{3}-\\d{2}-\\d{4}"], [], "block", "high");
      const r = scanContent(db, "SSN: 123-45-6789", "email", "user1");
      expect(r.allowed).toBe(false);
      expect(r.action).toBe("block");
      expect(r.incidents.length).toBe(1);
    });

    it("alerts on keyword match", () => {
      createPolicy(db, "Confidential", [], ["confidential", "secret"], "alert");
      const r = scanContent(db, "This is confidential data", "chat");
      expect(r.allowed).toBe(true);
      expect(r.action).toBe("alert");
      expect(r.matchedPolicies).toBe(1);
    });

    it("throws on empty content", () => {
      expect(() => scanContent(db, "")).toThrow("Content is required");
    });

    it("allows when no policies exist", () => {
      const r = scanContent(db, "anything");
      expect(r.allowed).toBe(true);
      expect(r.matchedPolicies).toBe(0);
    });

    it("highest action wins when multiple policies match", () => {
      createPolicy(db, "Alert SSN", ["\\d{3}-\\d{2}-\\d{4}"], [], "alert");
      createPolicy(db, "Block SSN", ["\\d{3}-\\d{2}-\\d{4}"], [], "block");
      const r = scanContent(db, "SSN: 123-45-6789");
      expect(r.action).toBe("block");
    });

    it("creates incidents for each matched policy", () => {
      createPolicy(db, "P1", ["secret"], [], "alert");
      createPolicy(db, "P2", [], ["secret"], "alert");
      const r = scanContent(db, "secret data");
      expect(r.incidents.length).toBe(2);
    });
  });

  describe("listIncidents", () => {
    it("returns empty initially", () => {
      expect(listIncidents()).toEqual([]);
    });

    it("lists incidents after scan", () => {
      createPolicy(db, "Test", ["password"], [], "block");
      scanContent(db, "password123", "email");
      expect(listIncidents().length).toBe(1);
    });

    it("filters by channel", () => {
      createPolicy(db, "Test", ["secret"], [], "block");
      scanContent(db, "secret", "email");
      scanContent(db, "secret", "chat");
      expect(listIncidents({ channel: "email" }).length).toBe(1);
    });

    it("filters by severity", () => {
      createPolicy(db, "High", ["critical"], [], "block", "high");
      createPolicy(db, "Low", ["minor"], [], "alert", "low");
      scanContent(db, "critical issue");
      scanContent(db, "minor issue");
      expect(listIncidents({ severity: "high" }).length).toBe(1);
    });
  });

  describe("resolveIncident", () => {
    it("resolves an incident", () => {
      createPolicy(db, "Test", ["secret"], [], "block");
      const scan = scanContent(db, "secret data");
      const r = resolveIncident(db, scan.incidents[0].id, "false positive");
      expect(r.success).toBe(true);
      expect(r.resolution).toBe("false positive");
    });

    it("throws on unknown incident", () => {
      expect(() => resolveIncident(db, "nonexistent")).toThrow(
        "Incident not found",
      );
    });
  });

  describe("getDLPStats", () => {
    it("returns zeros initially", () => {
      const s = getDLPStats();
      expect(s.scanned).toBe(0);
      expect(s.blocked).toBe(0);
      expect(s.totalIncidents).toBe(0);
    });

    it("tracks scan and block counts", () => {
      createPolicy(db, "Test", ["secret"], [], "block");
      scanContent(db, "secret data");
      scanContent(db, "clean data");
      const s = getDLPStats();
      expect(s.scanned).toBe(2);
      expect(s.blocked).toBe(1);
      expect(s.totalIncidents).toBe(1);
    });

    it("tracks unresolved incidents", () => {
      createPolicy(db, "Test", ["secret"], [], "block");
      const scan = scanContent(db, "secret");
      expect(getDLPStats().unresolvedIncidents).toBe(1);
      resolveIncident(db, scan.incidents[0].id, "ok");
      expect(getDLPStats().unresolvedIncidents).toBe(0);
    });
  });
});
