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

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface Tests — feed maturity + indicator lifecycle
 * ═══════════════════════════════════════════════════════════════ */

import {
  FEED_MATURITY_V2,
  INDICATOR_LIFECYCLE_V2,
  TI_DEFAULT_MAX_ACTIVE_FEEDS_PER_OWNER,
  TI_DEFAULT_MAX_ACTIVE_INDICATORS_PER_FEED,
  TI_DEFAULT_FEED_IDLE_MS,
  TI_DEFAULT_INDICATOR_STALE_MS,
  getMaxActiveFeedsPerOwnerV2,
  setMaxActiveFeedsPerOwnerV2,
  getMaxActiveIndicatorsPerFeedV2,
  setMaxActiveIndicatorsPerFeedV2,
  getFeedIdleMsV2,
  setFeedIdleMsV2,
  getIndicatorStaleMsV2,
  setIndicatorStaleMsV2,
  getActiveFeedCountV2,
  getActiveIndicatorCountV2,
  registerFeedV2,
  getFeedV2,
  listFeedsV2,
  setFeedMaturityV2,
  trustFeedV2,
  deprecateFeedV2,
  retireFeedV2,
  touchFeedV2,
  createIndicatorV2,
  getIndicatorV2,
  listIndicatorsV2,
  setIndicatorStatusV2,
  activateIndicatorV2,
  expireIndicatorV2,
  revokeIndicatorV2,
  supersedeIndicatorV2,
  refreshIndicatorV2,
  autoDeprecateIdleFeedsV2,
  autoExpireStaleIndicatorsV2,
  getThreatIntelStatsV2,
  _resetStateThreatIntelV2,
} from "../../src/lib/threat-intel.js";

describe("threat-intel V2", () => {
  beforeEach(() => {
    _resetStateThreatIntelV2();
  });

  describe("enums + defaults", () => {
    it("exposes 4 feed maturities + 5 indicator statuses", () => {
      expect(Object.values(FEED_MATURITY_V2)).toHaveLength(4);
      expect(Object.values(INDICATOR_LIFECYCLE_V2)).toHaveLength(5);
    });

    it("defaults match exported constants", () => {
      expect(getMaxActiveFeedsPerOwnerV2()).toBe(
        TI_DEFAULT_MAX_ACTIVE_FEEDS_PER_OWNER,
      );
      expect(getMaxActiveIndicatorsPerFeedV2()).toBe(
        TI_DEFAULT_MAX_ACTIVE_INDICATORS_PER_FEED,
      );
      expect(getFeedIdleMsV2()).toBe(TI_DEFAULT_FEED_IDLE_MS);
      expect(getIndicatorStaleMsV2()).toBe(TI_DEFAULT_INDICATOR_STALE_MS);
    });
  });

  describe("config setters", () => {
    it("accepts positive integers + floors floats", () => {
      setMaxActiveFeedsPerOwnerV2(7.9);
      setMaxActiveIndicatorsPerFeedV2(123.4);
      setFeedIdleMsV2(1000.7);
      setIndicatorStaleMsV2(2000.9);
      expect(getMaxActiveFeedsPerOwnerV2()).toBe(7);
      expect(getMaxActiveIndicatorsPerFeedV2()).toBe(123);
      expect(getFeedIdleMsV2()).toBe(1000);
      expect(getIndicatorStaleMsV2()).toBe(2000);
    });

    it("rejects ≤0 / NaN", () => {
      expect(() => setMaxActiveFeedsPerOwnerV2(0)).toThrow(/positive/);
      expect(() => setMaxActiveFeedsPerOwnerV2(-1)).toThrow(/positive/);
      expect(() => setMaxActiveIndicatorsPerFeedV2(NaN)).toThrow(/positive/);
      expect(() => setFeedIdleMsV2(-5)).toThrow(/positive/);
      expect(() => setIndicatorStaleMsV2("nope")).toThrow(/positive/);
    });
  });

  describe("registerFeedV2", () => {
    it("creates a pending feed with metadata copy", () => {
      const f = registerFeedV2("f1", {
        owner: "alice",
        name: "Bad IP feed",
        metadata: { tier: "premium" },
      });
      expect(f.id).toBe("f1");
      expect(f.owner).toBe("alice");
      expect(f.maturity).toBe("pending");
      expect(f.activatedAt).toBeNull();
      expect(f.metadata).toEqual({ tier: "premium" });
    });

    it("rejects bad inputs + duplicates", () => {
      expect(() => registerFeedV2("", { owner: "a", name: "n" })).toThrow();
      expect(() => registerFeedV2("f", { owner: "", name: "n" })).toThrow();
      expect(() => registerFeedV2("f", { owner: "a", name: "" })).toThrow();
      registerFeedV2("dup", { owner: "a", name: "n" });
      expect(() => registerFeedV2("dup", { owner: "a", name: "n" })).toThrow(
        /already exists/,
      );
    });

    it("returns defensive copies — mutating returned object does not leak", () => {
      registerFeedV2("f", { owner: "a", name: "n", metadata: { x: 1 } });
      const got = getFeedV2("f");
      got.metadata.x = 999;
      expect(getFeedV2("f").metadata.x).toBe(1);
    });
  });

  describe("feed maturity transitions", () => {
    beforeEach(() => {
      registerFeedV2("f1", { owner: "alice", name: "Feed1" });
    });

    it("pending → trusted stamps activatedAt once", () => {
      const t1 = trustFeedV2("f1", { now: 1000 });
      expect(t1.maturity).toBe("trusted");
      expect(t1.activatedAt).toBe(1000);
      deprecateFeedV2("f1", { now: 2000 });
      const t2 = trustFeedV2("f1", { now: 3000 });
      expect(t2.activatedAt).toBe(1000);
    });

    it("trusted ↔ deprecated recovery works", () => {
      trustFeedV2("f1");
      deprecateFeedV2("f1");
      expect(getFeedV2("f1").maturity).toBe("deprecated");
      trustFeedV2("f1");
      expect(getFeedV2("f1").maturity).toBe("trusted");
    });

    it("retired is terminal", () => {
      trustFeedV2("f1");
      retireFeedV2("f1");
      expect(() => trustFeedV2("f1")).toThrow(/terminal/);
      expect(() => deprecateFeedV2("f1")).toThrow(/terminal/);
    });

    it("rejects unknown next state", () => {
      expect(() => setFeedMaturityV2("f1", "bogus")).toThrow(/unknown/);
    });

    it("rejects illegal transitions (pending → deprecated)", () => {
      expect(() => deprecateFeedV2("f1")).toThrow(/cannot transition/);
    });

    it("setFeedMaturityV2 throws on unknown id", () => {
      expect(() => trustFeedV2("nope")).toThrow(/not found/);
    });
  });

  describe("per-owner active-feed cap", () => {
    it("enforces cap on pending → trusted", () => {
      setMaxActiveFeedsPerOwnerV2(2);
      registerFeedV2("a", { owner: "x", name: "A" });
      registerFeedV2("b", { owner: "x", name: "B" });
      registerFeedV2("c", { owner: "x", name: "C" });
      trustFeedV2("a");
      trustFeedV2("b");
      expect(() => trustFeedV2("c")).toThrow(/cap/);
    });

    it("does not enforce cap on deprecated → trusted recovery", () => {
      setMaxActiveFeedsPerOwnerV2(1);
      registerFeedV2("a", { owner: "x", name: "A" });
      trustFeedV2("a");
      deprecateFeedV2("a");
      expect(() => trustFeedV2("a")).not.toThrow();
    });

    it("getActiveFeedCountV2 counts only trusted", () => {
      registerFeedV2("a", { owner: "x", name: "A" });
      registerFeedV2("b", { owner: "x", name: "B" });
      registerFeedV2("c", { owner: "x", name: "C" });
      trustFeedV2("a");
      trustFeedV2("b");
      deprecateFeedV2("b");
      expect(getActiveFeedCountV2("x")).toBe(1);
    });
  });

  describe("touchFeedV2", () => {
    it("updates lastSeenAt", () => {
      registerFeedV2("f", { owner: "a", name: "n" });
      const t = touchFeedV2("f", { now: 5000 });
      expect(t.lastSeenAt).toBe(5000);
    });

    it("throws on unknown id", () => {
      expect(() => touchFeedV2("nope")).toThrow(/not found/);
    });
  });

  describe("createIndicatorV2", () => {
    beforeEach(() => {
      registerFeedV2("f1", { owner: "alice", name: "Feed1" });
    });

    it("creates pending indicator under existing feed", () => {
      const i = createIndicatorV2("i1", {
        feedId: "f1",
        iocType: "ipv4-addr",
        value: "1.2.3.4",
      });
      expect(i.status).toBe("pending");
      expect(i.feedId).toBe("f1");
      expect(i.activatedAt).toBeNull();
    });

    it("rejects unknown feed", () => {
      expect(() =>
        createIndicatorV2("i", {
          feedId: "ghost",
          iocType: "ipv4-addr",
          value: "1.1.1.1",
        }),
      ).toThrow(/not found/);
    });

    it("rejects duplicate id + bad inputs", () => {
      createIndicatorV2("i", {
        feedId: "f1",
        iocType: "ipv4-addr",
        value: "1.1.1.1",
      });
      expect(() =>
        createIndicatorV2("i", {
          feedId: "f1",
          iocType: "ipv4-addr",
          value: "x",
        }),
      ).toThrow(/already exists/);
      expect(() =>
        createIndicatorV2("", {
          feedId: "f1",
          iocType: "ipv4-addr",
          value: "x",
        }),
      ).toThrow();
      expect(() =>
        createIndicatorV2("z", { feedId: "f1", iocType: "", value: "x" }),
      ).toThrow();
    });
  });

  describe("indicator lifecycle transitions", () => {
    beforeEach(() => {
      registerFeedV2("f1", { owner: "a", name: "F" });
      createIndicatorV2("i1", {
        feedId: "f1",
        iocType: "ipv4-addr",
        value: "9.9.9.9",
      });
    });

    it("pending → active stamps activatedAt once", () => {
      const r = activateIndicatorV2("i1", { now: 100 });
      expect(r.status).toBe("active");
      expect(r.activatedAt).toBe(100);
    });

    it("active → expired/revoked/superseded stamps resolvedAt", () => {
      activateIndicatorV2("i1");
      const r = expireIndicatorV2("i1", { now: 500 });
      expect(r.status).toBe("expired");
      expect(r.resolvedAt).toBe(500);
    });

    it("revoke from pending allowed (skips active)", () => {
      const r = revokeIndicatorV2("i1");
      expect(r.status).toBe("revoked");
      expect(r.resolvedAt).not.toBeNull();
    });

    it("supersede from pending allowed", () => {
      const r = supersedeIndicatorV2("i1");
      expect(r.status).toBe("superseded");
    });

    it("terminals are sticky — cannot transition out", () => {
      activateIndicatorV2("i1");
      expireIndicatorV2("i1");
      expect(() => activateIndicatorV2("i1")).toThrow(/terminal/);
      expect(() => revokeIndicatorV2("i1")).toThrow(/terminal/);
    });

    it("pending → expired forbidden", () => {
      expect(() => expireIndicatorV2("i1")).toThrow(/cannot transition/);
    });

    it("rejects unknown next state", () => {
      expect(() => setIndicatorStatusV2("i1", "bogus")).toThrow(/unknown/);
    });

    it("setIndicatorStatusV2 throws on unknown id", () => {
      expect(() => activateIndicatorV2("ghost")).toThrow(/not found/);
    });
  });

  describe("per-feed active-indicator cap", () => {
    beforeEach(() => {
      registerFeedV2("f1", { owner: "a", name: "F" });
    });

    it("enforces cap on pending → active", () => {
      setMaxActiveIndicatorsPerFeedV2(2);
      createIndicatorV2("a", {
        feedId: "f1",
        iocType: "ipv4-addr",
        value: "1.1.1.1",
      });
      createIndicatorV2("b", {
        feedId: "f1",
        iocType: "ipv4-addr",
        value: "2.2.2.2",
      });
      createIndicatorV2("c", {
        feedId: "f1",
        iocType: "ipv4-addr",
        value: "3.3.3.3",
      });
      activateIndicatorV2("a");
      activateIndicatorV2("b");
      expect(() => activateIndicatorV2("c")).toThrow(/cap/);
    });

    it("getActiveIndicatorCountV2 counts only active", () => {
      createIndicatorV2("a", {
        feedId: "f1",
        iocType: "ipv4-addr",
        value: "1.1.1.1",
      });
      createIndicatorV2("b", {
        feedId: "f1",
        iocType: "ipv4-addr",
        value: "2.2.2.2",
      });
      activateIndicatorV2("a");
      activateIndicatorV2("b");
      expireIndicatorV2("b");
      expect(getActiveIndicatorCountV2("f1")).toBe(1);
    });
  });

  describe("refreshIndicatorV2", () => {
    beforeEach(() => {
      registerFeedV2("f", { owner: "a", name: "F" });
      createIndicatorV2("i", {
        feedId: "f",
        iocType: "ipv4-addr",
        value: "1.1.1.1",
      });
    });

    it("updates lastSeenAt", () => {
      const r = refreshIndicatorV2("i", { now: 7000 });
      expect(r.lastSeenAt).toBe(7000);
    });

    it("rejects on terminal indicator", () => {
      revokeIndicatorV2("i");
      expect(() => refreshIndicatorV2("i")).toThrow(/terminal/);
    });

    it("throws on unknown id", () => {
      expect(() => refreshIndicatorV2("ghost")).toThrow(/not found/);
    });
  });

  describe("listFeedsV2 / listIndicatorsV2", () => {
    it("filters feeds by owner + maturity", () => {
      registerFeedV2("a", { owner: "x", name: "A" });
      registerFeedV2("b", { owner: "x", name: "B" });
      registerFeedV2("c", { owner: "y", name: "C" });
      trustFeedV2("a");
      expect(listFeedsV2({ owner: "x" })).toHaveLength(2);
      expect(listFeedsV2({ maturity: "trusted" })).toHaveLength(1);
      expect(listFeedsV2({ owner: "y", maturity: "pending" })).toHaveLength(1);
    });

    it("filters indicators by feed + status", () => {
      registerFeedV2("f", { owner: "a", name: "F" });
      createIndicatorV2("i1", {
        feedId: "f",
        iocType: "ipv4-addr",
        value: "1.1.1.1",
      });
      createIndicatorV2("i2", {
        feedId: "f",
        iocType: "ipv4-addr",
        value: "2.2.2.2",
      });
      activateIndicatorV2("i1");
      expect(listIndicatorsV2({ feedId: "f" })).toHaveLength(2);
      expect(listIndicatorsV2({ status: "active" })).toHaveLength(1);
      expect(listIndicatorsV2({ status: "pending" })).toHaveLength(1);
    });
  });

  describe("autoDeprecateIdleFeedsV2", () => {
    it("flips trusted feeds whose lastSeenAt exceeds idle window", () => {
      setFeedIdleMsV2(1000);
      registerFeedV2("a", { owner: "x", name: "A" });
      registerFeedV2("b", { owner: "x", name: "B" });
      trustFeedV2("a", { now: 0 });
      trustFeedV2("b", { now: 5000 });
      const flipped = autoDeprecateIdleFeedsV2({ now: 2000 });
      expect(flipped.map((f) => f.id)).toEqual(["a"]);
      expect(getFeedV2("a").maturity).toBe("deprecated");
      expect(getFeedV2("b").maturity).toBe("trusted");
    });

    it("ignores non-trusted feeds", () => {
      setFeedIdleMsV2(1);
      registerFeedV2("p", { owner: "x", name: "P" });
      const flipped = autoDeprecateIdleFeedsV2({ now: 1_000_000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoExpireStaleIndicatorsV2", () => {
    it("flips active indicators whose lastSeenAt exceeds stale window", () => {
      setIndicatorStaleMsV2(1000);
      registerFeedV2("f", { owner: "a", name: "F" });
      createIndicatorV2("i1", {
        feedId: "f",
        iocType: "ipv4-addr",
        value: "1.1.1.1",
      });
      createIndicatorV2("i2", {
        feedId: "f",
        iocType: "ipv4-addr",
        value: "2.2.2.2",
      });
      activateIndicatorV2("i1", { now: 0 });
      activateIndicatorV2("i2", { now: 5000 });
      const flipped = autoExpireStaleIndicatorsV2({ now: 2000 });
      expect(flipped.map((i) => i.id)).toEqual(["i1"]);
      expect(getIndicatorV2("i1").status).toBe("expired");
      expect(getIndicatorV2("i1").resolvedAt).toBe(2000);
      expect(getIndicatorV2("i2").status).toBe("active");
    });

    it("ignores non-active indicators", () => {
      setIndicatorStaleMsV2(1);
      registerFeedV2("f", { owner: "a", name: "F" });
      createIndicatorV2("p", {
        feedId: "f",
        iocType: "ipv4-addr",
        value: "1.1.1.1",
      });
      const flipped = autoExpireStaleIndicatorsV2({ now: 1_000_000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getThreatIntelStatsV2", () => {
    it("zero-init all enum buckets", () => {
      const s = getThreatIntelStatsV2();
      expect(s.totalFeedsV2).toBe(0);
      expect(s.totalIndicatorsV2).toBe(0);
      expect(s.feedsByMaturity).toEqual({
        pending: 0,
        trusted: 0,
        deprecated: 0,
        retired: 0,
      });
      expect(s.indicatorsByStatus).toEqual({
        pending: 0,
        active: 0,
        expired: 0,
        revoked: 0,
        superseded: 0,
      });
    });

    it("reflects live state", () => {
      registerFeedV2("f", { owner: "a", name: "F" });
      trustFeedV2("f");
      createIndicatorV2("i1", {
        feedId: "f",
        iocType: "ipv4-addr",
        value: "1.1.1.1",
      });
      createIndicatorV2("i2", {
        feedId: "f",
        iocType: "ipv4-addr",
        value: "2.2.2.2",
      });
      activateIndicatorV2("i1");
      revokeIndicatorV2("i2");
      const s = getThreatIntelStatsV2();
      expect(s.totalFeedsV2).toBe(1);
      expect(s.totalIndicatorsV2).toBe(2);
      expect(s.feedsByMaturity.trusted).toBe(1);
      expect(s.indicatorsByStatus.active).toBe(1);
      expect(s.indicatorsByStatus.revoked).toBe(1);
    });
  });

  describe("_resetStateThreatIntelV2", () => {
    it("clears Maps + restores default config", () => {
      registerFeedV2("f", { owner: "a", name: "F" });
      setMaxActiveFeedsPerOwnerV2(99);
      _resetStateThreatIntelV2();
      expect(getThreatIntelStatsV2().totalFeedsV2).toBe(0);
      expect(getMaxActiveFeedsPerOwnerV2()).toBe(
        TI_DEFAULT_MAX_ACTIVE_FEEDS_PER_OWNER,
      );
    });
  });
});
