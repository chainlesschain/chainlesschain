/**
 * Tests for src/lib/threat-intel.js — STIX bundle import,
 * indicator dedup, observable matching, stats.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureThreatIntelTables,
  importStixBundle,
  listIndicators,
  matchObservable,
  getStats,
  removeIndicator,
  clearAll,
} from "../../src/lib/threat-intel.js";

function mkIndicator(id, pattern, extras = {}) {
  return {
    type: "indicator",
    id,
    pattern,
    pattern_type: "stix",
    ...extras,
  };
}

function mkBundle(...objects) {
  return { type: "bundle", id: "bundle--test", objects };
}

describe("threat-intel", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    ensureThreatIntelTables(db);
  });

  describe("ensureThreatIntelTables", () => {
    it("creates the indicators table", () => {
      expect(db.tables.has("threat_intel_indicators")).toBe(true);
    });

    it("is idempotent", () => {
      ensureThreatIntelTables(db);
      ensureThreatIntelTables(db);
      expect(db.tables.has("threat_intel_indicators")).toBe(true);
    });
  });

  // ── importStixBundle ────────────────────────────────────────

  describe("importStixBundle", () => {
    it("throws without a db", () => {
      expect(() => importStixBundle(null, mkBundle())).toThrow(/Database/);
    });

    it("imports a bundle with mixed IoC types", () => {
      const bundle = mkBundle(
        mkIndicator("indicator--1", "[domain-name:value = 'evil.example']", {
          name: "Bad domain",
          indicator_types: ["malicious-activity"],
          confidence: 80,
        }),
        mkIndicator("indicator--2", "[ipv4-addr:value = '1.2.3.4']"),
        mkIndicator(
          "indicator--3",
          "[file:hashes.'SHA-256' = 'ABCDEF1234567890']",
        ),
      );
      const r = importStixBundle(db, bundle);
      expect(r.imported).toBe(3);
      expect(r.updated).toBe(0);
      expect(r.skipped).toBe(0);
      expect(r.total).toBe(3);
    });

    it("skips indicators with unsupported observable types", () => {
      const bundle = mkBundle(
        mkIndicator(
          "indicator--reg",
          "[windows-registry-key:key = 'HKLM\\\\Evil']",
        ),
        mkIndicator("indicator--ip", "[ipv4-addr:value = '1.1.1.1']"),
      );
      const r = importStixBundle(db, bundle);
      expect(r.imported).toBe(1);
      expect(r.skipped).toBe(1);
      expect(r.total).toBe(2);
    });

    it("skips non-stix pattern_type indicators", () => {
      const bundle = mkBundle(
        mkIndicator("indicator--snort", "alert tcp any any -> any any", {
          pattern_type: "snort",
        }),
        mkIndicator("indicator--ok", "[domain-name:value = 'a.example']"),
      );
      const r = importStixBundle(db, bundle);
      expect(r.imported).toBe(1);
      expect(r.skipped).toBe(1);
    });

    it("deduplicates on re-import (updates rather than inserts)", () => {
      const bundle = mkBundle(
        mkIndicator("indicator--1", "[domain-name:value = 'dup.example']"),
      );
      const first = importStixBundle(db, bundle);
      expect(first.imported).toBe(1);
      expect(first.updated).toBe(0);

      const second = importStixBundle(db, bundle);
      expect(second.imported).toBe(0);
      expect(second.updated).toBe(1);

      const all = listIndicators(db);
      expect(all).toHaveLength(1);
    });

    it("imports multiple indicators from a single OR-joined pattern", () => {
      const bundle = mkBundle(
        mkIndicator(
          "indicator--or",
          "[domain-name:value = 'a.example'] OR [domain-name:value = 'b.example']",
        ),
      );
      const r = importStixBundle(db, bundle);
      expect(r.imported).toBe(2);
      expect(listIndicators(db)).toHaveLength(2);
    });

    it("preserves labels + confidence on the stored row", () => {
      importStixBundle(
        db,
        mkBundle(
          mkIndicator("indicator--1", "[ipv4-addr:value = '9.9.9.9']", {
            name: "Botnet C2",
            indicator_types: ["malicious-activity", "c2"],
            confidence: 92,
            valid_from: "2026-01-01T00:00:00Z",
          }),
        ),
      );
      const [row] = listIndicators(db);
      expect(row.value).toBe("9.9.9.9");
      expect(row.labels).toEqual(["malicious-activity", "c2"]);
      expect(row.confidence).toBe(92);
      expect(row.sourceName).toBe("Botnet C2");
      expect(row.validFrom).toBe("2026-01-01T00:00:00Z");
    });

    it("accepts a loose array of STIX objects", () => {
      const r = importStixBundle(db, [
        mkIndicator("indicator--1", "[url:value = 'http://a.example']"),
      ]);
      expect(r.imported).toBe(1);
    });

    it("silently handles empty bundles", () => {
      const r = importStixBundle(db, mkBundle());
      expect(r).toEqual({ imported: 0, updated: 0, skipped: 0, total: 0 });
    });
  });

  // ── listIndicators ──────────────────────────────────────────

  describe("listIndicators", () => {
    beforeEach(() => {
      importStixBundle(
        db,
        mkBundle(
          mkIndicator("indicator--1", "[ipv4-addr:value = '1.1.1.1']"),
          mkIndicator("indicator--2", "[ipv4-addr:value = '2.2.2.2']"),
          mkIndicator("indicator--3", "[domain-name:value = 'x.example']"),
        ),
      );
    });

    it("returns all indicators by default", () => {
      expect(listIndicators(db)).toHaveLength(3);
    });

    it("filters by type", () => {
      const ips = listIndicators(db, { type: "ipv4" });
      expect(ips).toHaveLength(2);
      expect(ips.every((i) => i.type === "ipv4")).toBe(true);
    });

    it("throws on unknown type", () => {
      expect(() => listIndicators(db, { type: "bogus" })).toThrow(
        /Unknown IOC type/,
      );
    });

    it("respects the limit option", () => {
      expect(listIndicators(db, { limit: 2 })).toHaveLength(2);
    });
  });

  // ── matchObservable ─────────────────────────────────────────

  describe("matchObservable", () => {
    beforeEach(() => {
      importStixBundle(
        db,
        mkBundle(
          mkIndicator("indicator--ip", "[ipv4-addr:value = '1.2.3.4']"),
          mkIndicator("indicator--dom", "[domain-name:value = 'evil.example']"),
          mkIndicator(
            "indicator--hash",
            // 64-hex-char SHA-256, stored in mixed case to prove the
            // store normalizes to lowercase on insert.
            "[file:hashes.'SHA-256' = " +
              "'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456701']",
          ),
        ),
      );
    });

    it("flags a known ipv4", () => {
      const r = matchObservable(db, "1.2.3.4");
      expect(r.matched).toBe(true);
      expect(r.type).toBe("ipv4");
      expect(r.indicator.value).toBe("1.2.3.4");
    });

    it("flags a known domain", () => {
      const r = matchObservable(db, "evil.example");
      expect(r.matched).toBe(true);
      expect(r.type).toBe("domain");
    });

    it("flags a file hash case-insensitively (normalized to lowercase)", () => {
      // SHA-256 is 64 hex chars; the bundle stored a mixed-case variant
      // that the store normalized to lowercase on insert.
      const lower =
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456701";
      const r = matchObservable(db, lower);
      expect(r.matched).toBe(true);
      expect(r.type).toBe("file-sha256");
      expect(r.indicator.value).toBe(lower);
    });

    it("matches a known hash when supplied in uppercase", () => {
      const upper =
        "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456701";
      const r = matchObservable(db, upper);
      expect(r.matched).toBe(true);
      expect(r.indicator.value).toBe(upper.toLowerCase());
    });

    it("returns matched:false for a clean observable", () => {
      const r = matchObservable(db, "clean.example");
      expect(r.matched).toBe(false);
      expect(r.type).toBe("domain");
    });

    it("returns type:unknown for unclassifiable input", () => {
      const r = matchObservable(db, "!!garbage!!");
      expect(r.matched).toBe(false);
      expect(r.type).toBe("unknown");
    });
  });

  // ── getStats ────────────────────────────────────────────────

  describe("getStats", () => {
    it("returns zero when empty", () => {
      const s = getStats(db);
      expect(s.total).toBe(0);
      expect(s.byType).toEqual({});
    });

    it("counts by type", () => {
      importStixBundle(
        db,
        mkBundle(
          mkIndicator("indicator--1", "[ipv4-addr:value = '1.1.1.1']"),
          mkIndicator("indicator--2", "[ipv4-addr:value = '2.2.2.2']"),
          mkIndicator("indicator--3", "[domain-name:value = 'x.example']"),
        ),
      );
      const s = getStats(db);
      expect(s.total).toBe(3);
      expect(s.byType.ipv4).toBe(2);
      expect(s.byType.domain).toBe(1);
    });
  });

  // ── removeIndicator / clearAll ─────────────────────────────

  describe("removeIndicator", () => {
    it("removes a matching row", () => {
      importStixBundle(
        db,
        mkBundle(mkIndicator("indicator--1", "[ipv4-addr:value = '1.1.1.1']")),
      );
      expect(removeIndicator(db, "ipv4", "1.1.1.1")).toBe(true);
      expect(listIndicators(db)).toHaveLength(0);
    });

    it("returns false when no row matches", () => {
      expect(removeIndicator(db, "ipv4", "9.9.9.9")).toBe(false);
    });
  });

  describe("clearAll", () => {
    it("wipes every stored indicator", () => {
      importStixBundle(
        db,
        mkBundle(
          mkIndicator("indicator--1", "[ipv4-addr:value = '1.1.1.1']"),
          mkIndicator("indicator--2", "[ipv4-addr:value = '2.2.2.2']"),
        ),
      );
      const removed = clearAll(db);
      expect(removed).toBe(2);
      expect(listIndicators(db)).toHaveLength(0);
    });
  });
});
