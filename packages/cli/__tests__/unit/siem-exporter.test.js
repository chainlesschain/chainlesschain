import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureSIEMTables,
  listTargets,
  addTarget,
  exportLogs,
  getSIEMStats,
  _resetState,
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
});
