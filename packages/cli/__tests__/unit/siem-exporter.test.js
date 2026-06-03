import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureSIEMTables,
  listTargets,
  addTarget,
  exportLogs,
  getSIEMStats,
  _resetState,
  SIEM_FORMAT,
  SIEM_TARGET_TYPE,
  SIEM_SEVERITY,
  SIEM_TARGET_STATUS,
  SIEM_DEFAULT_BATCH_SIZE,
  severityToCEF,
  formatLogCEF,
  formatLogLEEF,
  formatLogJSON,
  formatLog,
  addTargetV2,
  removeTarget,
  setTargetStatus,
  exportLogsV2,
  getSIEMStatsV2,
  listTargetsByStatus,
} from "../../src/lib/siem-exporter.js";

describe("siem-exporter", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureSIEMTables(db);
  });

  describe("ensureSIEMTables", () => {
    it("creates siem_exports table", () => {
      expect(db.tables.has("siem_exports")).toBe(true);
    });

    it("is idempotent", () => {
      ensureSIEMTables(db);
      expect(db.tables.has("siem_exports")).toBe(true);
    });
  });

  describe("addTarget", () => {
    it("adds a SIEM target", () => {
      const t = addTarget(
        db,
        "splunk_hec",
        "https://splunk.example.com/hec",
        "json",
      );
      expect(t.id).toBeDefined();
      expect(t.type).toBe("splunk_hec");
      expect(t.url).toBe("https://splunk.example.com/hec");
      expect(t.format).toBe("json");
      expect(t.status).toBe("active");
      expect(t.exportedCount).toBe(0);
    });

    it("throws on missing type", () => {
      expect(() => addTarget(db, "", "https://url")).toThrow(
        "Target type is required",
      );
    });

    it("throws on missing URL", () => {
      expect(() => addTarget(db, "splunk_hec", "")).toThrow(
        "Target URL is required",
      );
    });

    it("throws on invalid type", () => {
      expect(() => addTarget(db, "invalid", "https://url")).toThrow(
        "Invalid target type",
      );
    });

    it("persists to database", () => {
      addTarget(db, "elasticsearch", "https://es.example.com");
      const rows = db.data.get("siem_exports") || [];
      expect(rows.length).toBe(1);
    });

    it("defaults format to json", () => {
      const t = addTarget(db, "splunk_hec", "https://url");
      expect(t.format).toBe("json");
    });
  });

  describe("listTargets", () => {
    it("returns empty initially", () => {
      expect(listTargets()).toEqual([]);
    });

    it("lists all targets", () => {
      addTarget(db, "splunk_hec", "https://a.com");
      addTarget(db, "elasticsearch", "https://b.com");
      expect(listTargets().length).toBe(2);
    });
  });

  describe("exportLogs", () => {
    it("exports logs to a target", () => {
      const t = addTarget(db, "splunk_hec", "https://splunk.com/hec");
      const logs = [{ id: "log-1" }, { id: "log-2" }];
      const r = exportLogs(db, t.id, logs);
      expect(r.exported).toBe(2);
      expect(r.lastId).toBe("log-2");
    });

    it("throws on unknown target", () => {
      expect(() => exportLogs(db, "nonexistent", [])).toThrow(
        "Target not found",
      );
    });

    it("increments export count", () => {
      const t = addTarget(db, "splunk_hec", "https://splunk.com/hec");
      exportLogs(db, t.id, [{ id: "1" }]);
      exportLogs(db, t.id, [{ id: "2" }, { id: "3" }]);
      const stats = getSIEMStats();
      expect(stats[0].exportedCount).toBe(3);
    });

    it("handles empty log batch", () => {
      const t = addTarget(db, "splunk_hec", "https://splunk.com/hec");
      const r = exportLogs(db, t.id, []);
      expect(r.exported).toBe(0);
    });
  });

  describe("getSIEMStats", () => {
    it("returns empty array with no targets", () => {
      expect(getSIEMStats()).toEqual([]);
    });

    it("returns stats for each target", () => {
      addTarget(db, "splunk_hec", "https://a.com");
      addTarget(db, "elasticsearch", "https://b.com");
      const stats = getSIEMStats();
      expect(stats.length).toBe(2);
      expect(stats[0].type).toBe("splunk_hec");
    });
  });

  // ═════════════════════════════════════════════════════════════
  // V2 Canonical Surface (Phase 51)
  // ═════════════════════════════════════════════════════════════

  describe("V2 frozen enums", () => {
    it("SIEM_FORMAT has json/cef/leef and is frozen", () => {
      expect(Object.isFrozen(SIEM_FORMAT)).toBe(true);
      expect(Object.values(SIEM_FORMAT).sort()).toEqual([
        "cef",
        "json",
        "leef",
      ]);
    });

    it("SIEM_TARGET_TYPE has 3 values", () => {
      expect(Object.isFrozen(SIEM_TARGET_TYPE)).toBe(true);
      expect(Object.values(SIEM_TARGET_TYPE).sort()).toEqual([
        "azure_sentinel",
        "elasticsearch",
        "splunk_hec",
      ]);
    });

    it("SIEM_SEVERITY has 6 levels", () => {
      expect(Object.isFrozen(SIEM_SEVERITY)).toBe(true);
      expect(Object.values(SIEM_SEVERITY).sort()).toEqual([
        "critical",
        "debug",
        "error",
        "fatal",
        "info",
        "warn",
      ]);
    });

    it("SIEM_TARGET_STATUS has 4 values", () => {
      expect(Object.isFrozen(SIEM_TARGET_STATUS)).toBe(true);
      expect(Object.values(SIEM_TARGET_STATUS).sort()).toEqual([
        "active",
        "disabled",
        "error",
        "paused",
      ]);
    });

    it("SIEM_DEFAULT_BATCH_SIZE is 100", () => {
      expect(SIEM_DEFAULT_BATCH_SIZE).toBe(100);
    });
  });

  describe("severityToCEF", () => {
    it("maps 6 severities to 1,3,5,7,9,10", () => {
      expect(severityToCEF("debug")).toBe(1);
      expect(severityToCEF("info")).toBe(3);
      expect(severityToCEF("warn")).toBe(5);
      expect(severityToCEF("error")).toBe(7);
      expect(severityToCEF("critical")).toBe(9);
      expect(severityToCEF("fatal")).toBe(10);
    });

    it("is case-insensitive", () => {
      expect(severityToCEF("INFO")).toBe(3);
      expect(severityToCEF("Error")).toBe(7);
    });

    it("throws on unknown severity", () => {
      expect(() => severityToCEF("whatever")).toThrow("Unknown severity");
    });
  });

  describe("formatLogCEF", () => {
    it("builds a CEF line with vendor/product/version and mapped severity", () => {
      const line = formatLogCEF({
        eventId: "evt-1",
        eventName: "login",
        severity: "warn",
        userId: "alice",
        ip: "10.0.0.1",
        message: "auth retry",
        timestamp: 1709100000000,
      });
      expect(line).toContain("CEF:0|ChainlessChain|CLI|1.0.0|evt-1|login|5|");
      expect(line).toContain("suser=alice");
      expect(line).toContain("src=10.0.0.1");
      expect(line).toContain("msg=auth retry");
      expect(line).toContain("rt=1709100000000");
    });

    it("escapes pipes in extension values", () => {
      const line = formatLogCEF({
        eventId: "x",
        message: "a|b",
        severity: "info",
      });
      expect(line).toContain("msg=a\\|b");
    });

    it("respects custom vendor/product/version opts", () => {
      const line = formatLogCEF(
        { eventId: "x", severity: "info" },
        {
          vendor: "Acme",
          product: "P",
          version: "9.9",
        },
      );
      expect(line).toMatch(/^CEF:0\|Acme\|P\|9\.9\|x\|/);
    });
  });

  describe("formatLogLEEF", () => {
    it("builds a LEEF 2.0 line with tab-separated pairs", () => {
      const line = formatLogLEEF({
        eventId: "evt-2",
        timestamp: 1709100000000,
        userId: "bob",
        action: "export",
        ip: "10.0.0.2",
        message: "data export",
      });
      expect(line).toMatch(/^LEEF:2\.0\|ChainlessChain\|CLI\|1\.0\.0\|evt-2\|/);
      expect(line).toContain("devTime=1709100000000");
      expect(line).toContain("usrName=bob");
      expect(line).toContain("action=export");
      expect(line).toContain("src=10.0.0.2");
    });
  });

  describe("formatLogJSON", () => {
    it("wraps the log in the canonical envelope", () => {
      const envelope = formatLogJSON({
        timestamp: 1709100000000,
        severity: "info",
        message: "hi",
        userId: "u1",
        action: "login",
      });
      expect(envelope.timestamp).toBe(1709100000000);
      expect(envelope.severity).toBe("INFO");
      expect(envelope.source).toBe("chainlesschain-cli");
      expect(envelope.message).toBe("hi");
      expect(envelope.metadata.userId).toBe("u1");
      expect(envelope.metadata.action).toBe("login");
    });

    it("fills eventId from log.id when eventId absent", () => {
      const envelope = formatLogJSON({ id: "log-7", message: "x" });
      expect(envelope.metadata.eventId).toBe("log-7");
    });
  });

  describe("formatLog dispatch", () => {
    it("dispatches cef/leef/json by format", () => {
      const log = { eventId: "e", severity: "info", message: "m" };
      expect(typeof formatLog(SIEM_FORMAT.CEF, log)).toBe("string");
      expect(typeof formatLog(SIEM_FORMAT.LEEF, log)).toBe("string");
      const js = formatLog(SIEM_FORMAT.JSON, log);
      expect(typeof js).toBe("object");
      expect(js.severity).toBe("INFO");
    });

    it("throws on invalid format", () => {
      expect(() => formatLog("xml", {})).toThrow("Invalid format");
    });
  });

  describe("addTargetV2", () => {
    it("creates a target via canonical options", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://splunk.example.com/hec",
        format: SIEM_FORMAT.CEF,
        config: { token: "secret" },
      });
      expect(t.type).toBe("splunk_hec");
      expect(t.format).toBe("cef");
      expect(t.config).toEqual({ token: "secret" });
    });

    it("throws without options object", () => {
      expect(() => addTargetV2(db)).toThrow("options object is required");
    });

    it("throws on invalid type", () => {
      expect(() => addTargetV2(db, { type: "unknown", url: "x" })).toThrow(
        "Invalid target type",
      );
    });

    it("throws on invalid format", () => {
      expect(() =>
        addTargetV2(db, {
          type: SIEM_TARGET_TYPE.SPLUNK_HEC,
          url: "x",
          format: "xml",
        }),
      ).toThrow("Invalid format");
    });

    it("throws without url", () => {
      expect(() =>
        addTargetV2(db, { type: SIEM_TARGET_TYPE.SPLUNK_HEC }),
      ).toThrow("Target URL is required");
    });

    it("defaults format=json", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.ELASTICSEARCH,
        url: "https://es.example.com",
      });
      expect(t.format).toBe("json");
    });
  });

  describe("removeTarget", () => {
    it("removes a target", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      expect(listTargets().length).toBe(1);
      removeTarget(db, t.id);
      expect(listTargets().length).toBe(0);
    });

    it("throws on unknown target", () => {
      expect(() => removeTarget(db, "nope")).toThrow("Target not found");
    });

    it("deletes the database row", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      removeTarget(db, t.id);
      const rows = db.data.get("siem_exports") || [];
      expect(rows.length).toBe(0);
    });
  });

  describe("setTargetStatus", () => {
    it("transitions active → paused → active", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      const paused = setTargetStatus(db, t.id, SIEM_TARGET_STATUS.PAUSED);
      expect(paused.status).toBe("paused");
      const active = setTargetStatus(db, t.id, SIEM_TARGET_STATUS.ACTIVE);
      expect(active.status).toBe("active");
    });

    it("allows active → disabled, disabled → active", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      setTargetStatus(db, t.id, SIEM_TARGET_STATUS.DISABLED);
      const re = setTargetStatus(db, t.id, SIEM_TARGET_STATUS.ACTIVE);
      expect(re.status).toBe("active");
    });

    it("rejects disabled → paused (must go via active)", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      setTargetStatus(db, t.id, SIEM_TARGET_STATUS.DISABLED);
      expect(() =>
        setTargetStatus(db, t.id, SIEM_TARGET_STATUS.PAUSED),
      ).toThrow("Invalid status transition");
    });

    it("same-status assignment is a no-op", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      const r = setTargetStatus(db, t.id, SIEM_TARGET_STATUS.ACTIVE);
      expect(r.status).toBe("active");
    });

    it("throws on invalid status value", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      expect(() => setTargetStatus(db, t.id, "zombie")).toThrow(
        "Invalid status",
      );
    });

    it("throws on unknown target", () => {
      expect(() =>
        setTargetStatus(db, "nope", SIEM_TARGET_STATUS.PAUSED),
      ).toThrow("Target not found");
    });
  });

  describe("exportLogsV2", () => {
    it("splits logs into batches of SIEM_DEFAULT_BATCH_SIZE", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      const logs = Array.from({ length: 250 }, (_, i) => ({ id: `l-${i}` }));
      const r = exportLogsV2(db, { targetId: t.id, logs });
      expect(r.batches).toBe(3); // 100 + 100 + 50
      expect(r.exported).toBe(250);
      expect(r.lastId).toBe("l-249");
    });

    it("respects custom batchSize", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      const logs = Array.from({ length: 10 }, (_, i) => ({ id: `l-${i}` }));
      const r = exportLogsV2(db, { targetId: t.id, logs, batchSize: 3 });
      expect(r.batches).toBe(4); // 3+3+3+1
      expect(r.exported).toBe(10);
    });

    it("skips non-active targets", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      setTargetStatus(db, t.id, SIEM_TARGET_STATUS.PAUSED);
      const r = exportLogsV2(db, {
        targetId: t.id,
        logs: [{ id: "1" }],
      });
      expect(r.skipped).toBe(true);
      expect(r.exported).toBe(0);
      expect(r.reason).toContain("paused");
    });

    it("throws on unknown target", () => {
      expect(() => exportLogsV2(db, { targetId: "nope", logs: [] })).toThrow(
        "Target not found",
      );
    });

    it("throws on invalid batchSize", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      expect(() =>
        exportLogsV2(db, { targetId: t.id, logs: [], batchSize: 0 }),
      ).toThrow("batchSize must be a positive integer");
      expect(() =>
        exportLogsV2(db, { targetId: t.id, logs: [], batchSize: -1 }),
      ).toThrow("batchSize must be a positive integer");
    });

    it("throws when logs is not an array", () => {
      const t = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://x.com",
      });
      expect(() =>
        exportLogsV2(db, { targetId: t.id, logs: "not-array" }),
      ).toThrow("logs must be an array");
    });

    it("throws without options object", () => {
      expect(() => exportLogsV2(db)).toThrow("options object is required");
    });
  });

  describe("getSIEMStatsV2", () => {
    it("returns zeroed breakdowns with no targets", () => {
      const s = getSIEMStatsV2();
      expect(s.totalTargets).toBe(0);
      expect(s.totalExported).toBe(0);
      expect(s.byFormat.json).toBe(0);
      expect(s.byType.splunk_hec).toBe(0);
      expect(s.byStatus.active).toBe(0);
      expect(s.targets).toEqual([]);
    });

    it("counts targets by format/type/status and total exported", () => {
      const a = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://a.com",
        format: SIEM_FORMAT.JSON,
      });
      addTargetV2(db, {
        type: SIEM_TARGET_TYPE.ELASTICSEARCH,
        url: "https://b.com",
        format: SIEM_FORMAT.CEF,
      });
      setTargetStatus(db, a.id, SIEM_TARGET_STATUS.PAUSED);
      exportLogs(db, a.id, [{ id: "1" }]);
      const s = getSIEMStatsV2();
      expect(s.totalTargets).toBe(2);
      expect(s.byFormat.json).toBe(1);
      expect(s.byFormat.cef).toBe(1);
      expect(s.byType.splunk_hec).toBe(1);
      expect(s.byType.elasticsearch).toBe(1);
      expect(s.byStatus.active).toBe(1);
      expect(s.byStatus.paused).toBe(1);
      expect(s.totalExported).toBe(1);
    });
  });

  describe("listTargetsByStatus", () => {
    it("filters by status", () => {
      const a = addTargetV2(db, {
        type: SIEM_TARGET_TYPE.SPLUNK_HEC,
        url: "https://a.com",
      });
      addTargetV2(db, {
        type: SIEM_TARGET_TYPE.ELASTICSEARCH,
        url: "https://b.com",
      });
      setTargetStatus(db, a.id, SIEM_TARGET_STATUS.PAUSED);
      expect(listTargetsByStatus(SIEM_TARGET_STATUS.ACTIVE).length).toBe(1);
      expect(listTargetsByStatus(SIEM_TARGET_STATUS.PAUSED).length).toBe(1);
    });

    it("throws on invalid status", () => {
      expect(() => listTargetsByStatus("nope")).toThrow("Invalid status");
    });
  });
});
