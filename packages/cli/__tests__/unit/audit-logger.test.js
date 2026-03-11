import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureAuditTables,
  logEvent,
  queryLogs,
  getStatistics,
  exportLogs,
  purgeLogs,
  getRecentEvents,
  assessRisk,
  sanitizeDetails,
  EVENT_TYPES,
  RISK_LEVELS,
} from "../../src/lib/audit-logger.js";

describe("Audit Logger", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  // ─── ensureAuditTables ────────────────────────────────────

  describe("ensureAuditTables", () => {
    it("should create audit_log table", () => {
      ensureAuditTables(db);
      expect(db.tables.has("audit_log")).toBe(true);
    });

    it("should be idempotent", () => {
      ensureAuditTables(db);
      ensureAuditTables(db);
      expect(db.tables.has("audit_log")).toBe(true);
    });
  });

  // ─── EVENT_TYPES / RISK_LEVELS ────────────────────────────

  describe("constants", () => {
    it("should have expected event types", () => {
      expect(EVENT_TYPES.AUTH).toBe("auth");
      expect(EVENT_TYPES.PERMISSION).toBe("permission");
      expect(EVENT_TYPES.DATA).toBe("data");
      expect(EVENT_TYPES.SYSTEM).toBe("system");
      expect(EVENT_TYPES.FILE).toBe("file");
      expect(EVENT_TYPES.DID).toBe("did");
      expect(EVENT_TYPES.CRYPTO).toBe("crypto");
      expect(EVENT_TYPES.API).toBe("api");
    });

    it("should have expected risk levels", () => {
      expect(RISK_LEVELS.LOW).toBe("low");
      expect(RISK_LEVELS.MEDIUM).toBe("medium");
      expect(RISK_LEVELS.HIGH).toBe("high");
      expect(RISK_LEVELS.CRITICAL).toBe("critical");
    });
  });

  // ─── assessRisk ───────────────────────────────────────────

  describe("assessRisk", () => {
    it("should return high for high-risk operations", () => {
      expect(assessRisk("permission", "grant_admin")).toBe("high");
      expect(assessRisk("system", "delete_role")).toBe("high");
      expect(assessRisk("crypto", "db_encrypt")).toBe("high");
    });

    it("should return medium for auth failures", () => {
      expect(assessRisk("auth", "login_fail")).toBe("medium");
    });

    it("should return medium for permission events", () => {
      expect(assessRisk("permission", "grant_viewer")).toBe("medium");
    });

    it("should return high for bulk operations", () => {
      expect(assessRisk("data", "bulk_update", { bulkCount: 200 })).toBe(
        "high",
      );
    });

    it("should return low for normal operations", () => {
      expect(assessRisk("data", "read_note")).toBe("low");
    });
  });

  // ─── sanitizeDetails ──────────────────────────────────────

  describe("sanitizeDetails", () => {
    it("should redact sensitive fields", () => {
      const details = {
        username: "alice",
        password: "secret123",
        secretKey: "sk_123",
        apiKey: "ak_456",
        token: "jwt_789",
        mnemonic: "word1 word2",
      };
      const sanitized = sanitizeDetails(details);
      expect(sanitized.username).toBe("alice");
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.secretKey).toBe("[REDACTED]");
      expect(sanitized.apiKey).toBe("[REDACTED]");
      expect(sanitized.token).toBe("[REDACTED]");
      expect(sanitized.mnemonic).toBe("[REDACTED]");
    });

    it("should handle null/undefined input", () => {
      expect(sanitizeDetails(null)).toBeNull();
      expect(sanitizeDetails(undefined)).toBeUndefined();
    });

    it("should not modify non-sensitive fields", () => {
      const details = { action: "read", target: "note-123" };
      const sanitized = sanitizeDetails(details);
      expect(sanitized).toEqual(details);
    });
  });

  // ─── logEvent ─────────────────────────────────────────────

  describe("logEvent", () => {
    it("should log an event and return ID", () => {
      const result = logEvent(db, {
        eventType: EVENT_TYPES.AUTH,
        operation: "login",
        actor: "did:chainless:alice",
      });
      expect(result.id).toBeDefined();
      expect(result.riskLevel).toBeDefined();
    });

    it("should auto-assess risk level", () => {
      const result = logEvent(db, {
        eventType: EVENT_TYPES.PERMISSION,
        operation: "grant_admin",
        actor: "did:chainless:admin",
      });
      expect(result.riskLevel).toBe("high");
    });

    it("should sanitize sensitive details", () => {
      logEvent(db, {
        eventType: EVENT_TYPES.AUTH,
        operation: "login",
        details: { password: "secret" },
      });

      const logs = db.data.get("audit_log");
      const parsed = JSON.parse(logs[0].details);
      expect(parsed.password).toBe("[REDACTED]");
    });

    it("should log failed events", () => {
      logEvent(db, {
        eventType: EVENT_TYPES.AUTH,
        operation: "login_fail",
        success: false,
        errorMessage: "Invalid password",
      });

      const logs = db.data.get("audit_log");
      expect(logs[0].success).toBe(0);
      expect(logs[0].error_message).toBe("Invalid password");
    });

    it("should handle null details", () => {
      const result = logEvent(db, {
        eventType: EVENT_TYPES.SYSTEM,
        operation: "startup",
      });
      expect(result.id).toBeDefined();
    });
  });

  // ─── queryLogs ────────────────────────────────────────────

  describe("queryLogs", () => {
    beforeEach(() => {
      logEvent(db, { eventType: "auth", operation: "login", actor: "alice" });
      logEvent(db, { eventType: "data", operation: "read_note", actor: "bob" });
      logEvent(db, {
        eventType: "auth",
        operation: "login_fail",
        actor: "charlie",
        success: false,
      });
    });

    it("should return all logs", () => {
      const logs = queryLogs(db);
      expect(logs).toHaveLength(3);
    });

    it("should filter by event type", () => {
      const logs = queryLogs(db, { eventType: "auth" });
      expect(logs).toHaveLength(2);
    });

    it("should filter by operation", () => {
      const logs = queryLogs(db, { operation: "login_fail" });
      expect(logs).toHaveLength(1);
    });

    it("should filter by actor", () => {
      const logs = queryLogs(db, { actor: "alice" });
      expect(logs).toHaveLength(1);
    });

    it("should respect limit", () => {
      const logs = queryLogs(db, { limit: 2 });
      expect(logs).toHaveLength(2);
    });

    it("should search by operation keyword", () => {
      const logs = queryLogs(db, { search: "login" });
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });

    it("should parse details as JSON", () => {
      logEvent(db, {
        eventType: "data",
        operation: "test",
        details: { key: "value" },
      });
      const logs = queryLogs(db, { operation: "test" });
      expect(logs[0].details).toEqual({ key: "value" });
    });

    it("should convert success to boolean", () => {
      const logs = queryLogs(db);
      for (const log of logs) {
        expect(typeof log.success).toBe("boolean");
      }
    });
  });

  // ─── getStatistics ────────────────────────────────────────

  describe("getStatistics", () => {
    it("should return zero stats for empty log", () => {
      const stats = getStatistics(db);
      expect(stats.total).toBe(0);
      expect(stats.failures).toBe(0);
      expect(stats.highRisk).toBe(0);
    });

    it("should count events correctly", () => {
      logEvent(db, { eventType: "auth", operation: "login" });
      logEvent(db, {
        eventType: "auth",
        operation: "login_fail",
        success: false,
      });
      logEvent(db, { eventType: "data", operation: "read" });

      const stats = getStatistics(db);
      expect(stats.total).toBe(3);
      expect(stats.failures).toBe(1);
    });

    it("should group by event type", () => {
      logEvent(db, { eventType: "auth", operation: "login" });
      logEvent(db, { eventType: "auth", operation: "logout" });
      logEvent(db, { eventType: "data", operation: "read" });

      const stats = getStatistics(db);
      expect(stats.byEventType.auth).toBe(2);
      expect(stats.byEventType.data).toBe(1);
    });
  });

  // ─── exportLogs ───────────────────────────────────────────

  describe("exportLogs", () => {
    beforeEach(() => {
      logEvent(db, { eventType: "auth", operation: "login", actor: "alice" });
      logEvent(db, { eventType: "data", operation: "read", actor: "bob" });
    });

    it("should export as JSON", () => {
      const json = exportLogs(db, "json");
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(2);
    });

    it("should export as CSV", () => {
      const csv = exportLogs(db, "csv");
      const lines = csv.split("\n");
      expect(lines[0]).toContain("id,event_type,operation");
      expect(lines.length).toBe(3); // header + 2 data rows
    });
  });

  // ─── purgeLogs ────────────────────────────────────────────

  describe("purgeLogs", () => {
    it("should not purge recent logs", () => {
      logEvent(db, { eventType: "auth", operation: "login" });
      const deleted = purgeLogs(db, 90);
      expect(deleted).toBe(0);
    });

    it("should purge old logs", () => {
      logEvent(db, { eventType: "auth", operation: "old" });
      // Manually set old date
      const rows = db.data.get("audit_log");
      rows[0].created_at = "2020-01-01 00:00:00";

      const deleted = purgeLogs(db, 1);
      expect(deleted).toBe(1);
    });
  });

  // ─── getRecentEvents ──────────────────────────────────────

  describe("getRecentEvents", () => {
    it("should return recent events", () => {
      logEvent(db, { eventType: "auth", operation: "login" });
      logEvent(db, { eventType: "data", operation: "read" });

      const recent = getRecentEvents(db, 10);
      expect(recent).toHaveLength(2);
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        logEvent(db, { eventType: "system", operation: `op${i}` });
      }

      const recent = getRecentEvents(db, 3);
      expect(recent).toHaveLength(3);
    });
  });
});
