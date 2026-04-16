/**
 * Tests for src/lib/ueba.js — baseline construction, anomaly
 * scoring, top-entity ranking, and Map↔dict persistence.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  buildBaseline,
  scoreEvent,
  detectAnomalies,
  rankEntities,
  serializeBaseline,
  deserializeBaseline,
  ensureUebaTables,
  saveBaselines,
  loadBaseline,
  loadAllBaselines,
} from "../../src/lib/ueba.js";

function ev(entity, overrides = {}) {
  return {
    entity,
    action: "read",
    resource: "note:42",
    // Default to 10:00 UTC to keep ad-hoc tests in a single hour slot.
    timestamp: "2026-04-16T10:00:00Z",
    success: true,
    ...overrides,
  };
}

describe("ueba", () => {
  describe("buildBaseline", () => {
    it("returns an empty Map for non-array input", () => {
      expect(buildBaseline(null)).toBeInstanceOf(Map);
      expect(buildBaseline(null).size).toBe(0);
      expect(buildBaseline(undefined).size).toBe(0);
      expect(buildBaseline("nope").size).toBe(0);
    });

    it("ignores events without an entity", () => {
      const m = buildBaseline([{ action: "read" }, ev("alice")]);
      expect(m.size).toBe(1);
      expect(m.has("alice")).toBe(true);
    });

    it("aggregates per-entity counts and unique surfaces", () => {
      const m = buildBaseline([
        ev("alice", { action: "read", resource: "note:1" }),
        ev("alice", { action: "read", resource: "note:2" }),
        ev("alice", { action: "write", resource: "note:1" }),
        ev("bob", { action: "read", resource: "note:3" }),
      ]);
      const a = m.get("alice");
      expect(a.eventCount).toBe(3);
      expect(a.uniqueActions).toBe(2);
      expect(a.uniqueResources).toBe(2);
      expect(a.actions).toEqual({ read: 2, write: 1 });
      expect(a.resources).toEqual({ "note:1": 2, "note:2": 1 });

      const b = m.get("bob");
      expect(b.eventCount).toBe(1);
    });

    it("builds a 24-slot UTC hour histogram", () => {
      const m = buildBaseline([
        ev("alice", { timestamp: "2026-04-16T03:15:00Z" }),
        ev("alice", { timestamp: "2026-04-16T03:45:00Z" }),
        ev("alice", { timestamp: "2026-04-16T21:00:00Z" }),
      ]);
      const a = m.get("alice");
      expect(a.hourCounts).toHaveLength(24);
      expect(a.hourCounts[3]).toBe(2);
      expect(a.hourCounts[21]).toBe(1);
    });

    it("tracks success/failure and derives failureRate", () => {
      const m = buildBaseline([
        ev("alice", { success: true }),
        ev("alice", { success: false }),
        ev("alice", { success: true }),
        ev("alice", { success: true }),
      ]);
      const a = m.get("alice");
      expect(a.successCount).toBe(3);
      expect(a.failureCount).toBe(1);
      expect(a.failureRate).toBeCloseTo(0.25, 5);
    });

    it("treats missing success as success", () => {
      const m = buildBaseline([{ entity: "alice", action: "read" }]);
      expect(m.get("alice").successCount).toBe(1);
      expect(m.get("alice").failureCount).toBe(0);
    });

    it("captures firstSeen/lastSeen as epoch ms", () => {
      const m = buildBaseline([
        ev("alice", { timestamp: "2026-04-16T10:00:00Z" }),
        ev("alice", { timestamp: "2026-04-16T12:00:00Z" }),
        ev("alice", { timestamp: "2026-04-16T08:00:00Z" }),
      ]);
      const a = m.get("alice");
      expect(a.firstSeen).toBe(new Date("2026-04-16T08:00:00Z").getTime());
      expect(a.lastSeen).toBe(new Date("2026-04-16T12:00:00Z").getTime());
    });

    it("tolerates invalid timestamps", () => {
      const m = buildBaseline([
        ev("alice", { timestamp: "not-a-date" }),
        ev("alice", { timestamp: 1712000000000 }),
      ]);
      const a = m.get("alice");
      expect(a.eventCount).toBe(2);
      // The numeric ms should make it into firstSeen/lastSeen.
      expect(a.firstSeen).toBe(1712000000000);
    });
  });

  describe("scoreEvent", () => {
    it("returns score 0 for missing event", () => {
      const r = scoreEvent({ eventCount: 5 }, null);
      expect(r.score).toBe(0);
      expect(r.reasons).toEqual([]);
    });

    it("scores 1 against an empty baseline", () => {
      const r = scoreEvent({ eventCount: 0 }, ev("alice"));
      expect(r.score).toBe(1);
      expect(r.reasons[0]).toMatch(/no prior activity/);
    });

    it("scores near 0 for a matching event", () => {
      const baseline = buildBaseline([
        ev("alice", {
          action: "read",
          resource: "note:1",
          timestamp: "2026-04-16T10:00:00Z",
        }),
      ]).get("alice");
      const r = scoreEvent(
        baseline,
        ev("alice", {
          action: "read",
          resource: "note:1",
          timestamp: "2026-04-16T10:30:00Z",
        }),
      );
      // One-event baseline → surprise for every feature is 1 - 1/1 = 0.
      expect(r.score).toBe(0);
      expect(r.reasons).toEqual([]);
    });

    it("flags an unseen hour", () => {
      const baseline = buildBaseline([
        ev("alice", { timestamp: "2026-04-16T10:00:00Z" }),
      ]).get("alice");
      const r = scoreEvent(
        baseline,
        ev("alice", { timestamp: "2026-04-16T03:00:00Z" }),
      );
      expect(r.score).toBeGreaterThan(0);
      expect(r.reasons.some((x) => /unseen hour 3/.test(x))).toBe(true);
    });

    it("flags an unseen action", () => {
      const baseline = buildBaseline([ev("alice", { action: "read" })]).get(
        "alice",
      );
      const r = scoreEvent(baseline, ev("alice", { action: "delete" }));
      expect(r.reasons.some((x) => /unseen action "delete"/.test(x))).toBe(
        true,
      );
    });

    it("flags an unseen resource", () => {
      const baseline = buildBaseline([ev("alice", { resource: "note:1" })]).get(
        "alice",
      );
      const r = scoreEvent(baseline, ev("alice", { resource: "note:999" }));
      expect(r.reasons.some((x) => /unseen resource "note:999"/.test(x))).toBe(
        true,
      );
    });

    it("adds a failure bonus against a low-failure baseline", () => {
      // 20 matching successful events → baseline failure rate is 0.
      const events = [];
      for (let i = 0; i < 20; i++) {
        events.push(
          ev("alice", {
            action: "read",
            resource: "note:1",
            timestamp: "2026-04-16T10:00:00Z",
            success: true,
          }),
        );
      }
      const baseline = buildBaseline(events).get("alice");

      const matching = scoreEvent(
        baseline,
        ev("alice", {
          action: "read",
          resource: "note:1",
          timestamp: "2026-04-16T10:00:00Z",
          success: true,
        }),
      );
      expect(matching.score).toBe(0);

      const failing = scoreEvent(
        baseline,
        ev("alice", {
          action: "read",
          resource: "note:1",
          timestamp: "2026-04-16T10:00:00Z",
          success: false,
        }),
      );
      expect(failing.score).toBeGreaterThanOrEqual(0.3);
      expect(failing.reasons.some((x) => /failure/.test(x))).toBe(true);
    });

    it("never exceeds 1.0", () => {
      const baseline = buildBaseline([
        ev("alice", {
          action: "read",
          resource: "note:1",
          timestamp: "2026-04-16T10:00:00Z",
        }),
      ]).get("alice");
      const r = scoreEvent(
        baseline,
        ev("alice", {
          action: "delete",
          resource: "note:999",
          timestamp: "2026-04-16T03:00:00Z",
          success: false,
        }),
      );
      expect(r.score).toBeLessThanOrEqual(1);
    });
  });

  describe("detectAnomalies", () => {
    it("returns [] for non-array input or non-Map baseline", () => {
      expect(detectAnomalies(new Map(), "nope")).toEqual([]);
      expect(detectAnomalies({}, [ev("alice")])).toEqual([]);
    });

    it("filters by threshold and sorts by descending score", () => {
      const baseEvents = [];
      for (let i = 0; i < 10; i++) {
        baseEvents.push(
          ev("alice", {
            action: "read",
            resource: "note:1",
            timestamp: "2026-04-16T10:00:00Z",
          }),
        );
      }
      const baselineMap = buildBaseline(baseEvents);

      const candidates = [
        ev("alice", {
          action: "read",
          resource: "note:1",
          timestamp: "2026-04-16T10:30:00Z",
        }),
        ev("alice", {
          action: "delete",
          resource: "note:999",
          timestamp: "2026-04-16T03:00:00Z",
        }),
        ev("carol", { action: "anything" }),
      ];
      const hits = detectAnomalies(baselineMap, candidates, { threshold: 0.7 });

      expect(hits.length).toBeGreaterThanOrEqual(2);
      // Sorted descending.
      for (let i = 1; i < hits.length; i++) {
        expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
      }
      // Known-unseen carol should be in there.
      expect(hits.some((h) => h.event.entity === "carol")).toBe(true);
    });

    it("skips candidates without an entity", () => {
      const baselineMap = buildBaseline([ev("alice")]);
      const hits = detectAnomalies(baselineMap, [{}, null], { threshold: 0 });
      expect(hits).toEqual([]);
    });
  });

  describe("rankEntities", () => {
    it("returns [] for empty input", () => {
      expect(rankEntities([])).toEqual([]);
    });

    it("sorts descending by riskScore and applies topK", () => {
      const events = [
        // Alice: all successful, spread over 3 hours.
        ev("alice", { timestamp: "2026-04-16T08:00:00Z", success: true }),
        ev("alice", { timestamp: "2026-04-16T09:00:00Z", success: true }),
        ev("alice", { timestamp: "2026-04-16T10:00:00Z", success: true }),
        // Bob: 3 failures in a single hour, all different resources.
        ev("bob", {
          timestamp: "2026-04-16T03:00:00Z",
          resource: "note:1",
          success: false,
        }),
        ev("bob", {
          timestamp: "2026-04-16T03:10:00Z",
          resource: "note:2",
          success: false,
        }),
        ev("bob", {
          timestamp: "2026-04-16T03:20:00Z",
          resource: "note:3",
          success: false,
        }),
      ];
      const rows = rankEntities(events, { topK: 5 });
      expect(rows).toHaveLength(2);
      expect(rows[0].entity).toBe("bob");
      expect(rows[0].riskScore).toBeGreaterThan(rows[1].riskScore);
      // Bob's composite should be meaningfully above zero.
      expect(rows[0].riskScore).toBeGreaterThan(50);
    });

    it("respects topK=0 by returning everything", () => {
      const rows = rankEntities([ev("alice"), ev("bob"), ev("carol")], {
        topK: 0,
      });
      expect(rows).toHaveLength(3);
    });
  });

  describe("serialize/deserialize roundtrip", () => {
    it("preserves counts, rates, hours, first/last seen through a JSON trip", () => {
      const events = [
        ev("alice", {
          action: "read",
          resource: "note:1",
          timestamp: "2026-04-16T03:00:00Z",
        }),
        ev("alice", {
          action: "write",
          resource: "note:2",
          timestamp: "2026-04-16T10:00:00Z",
          success: false,
        }),
      ];
      const original = buildBaseline(events);
      const roundtripped = deserializeBaseline(
        JSON.parse(JSON.stringify(serializeBaseline(original))),
      );

      const a = roundtripped.get("alice");
      expect(a.eventCount).toBe(2);
      expect(a.failureCount).toBe(1);
      expect(a.uniqueActions).toBe(2);
      expect(a.uniqueResources).toBe(2);
      expect(a.hourCounts[3]).toBe(1);
      expect(a.hourCounts[10]).toBe(1);
      expect(a.firstSeen).toBe(new Date("2026-04-16T03:00:00Z").getTime());
      expect(a.actionCounts.get("read")).toBe(1);
      expect(a.resourceCounts.get("note:2")).toBe(1);

      // scoreEvent should behave the same against the rehydrated baseline.
      const r = scoreEvent(
        a,
        ev("alice", {
          action: "read",
          resource: "note:1",
          timestamp: "2026-04-16T03:00:00Z",
        }),
      );
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    });

    it("deserialize tolerates junk shape", () => {
      expect(deserializeBaseline(null).size).toBe(0);
      expect(deserializeBaseline("nope").size).toBe(0);
    });
  });

  describe("persistence (SQLite)", () => {
    let db;

    beforeEach(() => {
      db = new MockDatabase();
      ensureUebaTables(db);
    });

    it("creates the baselines table", () => {
      expect(db.tables.has("ueba_baselines")).toBe(true);
    });

    it("is idempotent", () => {
      ensureUebaTables(db);
      ensureUebaTables(db);
      expect(db.tables.has("ueba_baselines")).toBe(true);
    });

    it("saves and reloads a single baseline", () => {
      const events = [
        ev("alice", {
          action: "read",
          resource: "note:1",
          timestamp: "2026-04-16T10:00:00Z",
        }),
        ev("alice", {
          action: "write",
          resource: "note:1",
          timestamp: "2026-04-16T10:05:00Z",
          success: false,
        }),
      ];
      const baselineMap = buildBaseline(events);
      const saved = saveBaselines(db, baselineMap);
      expect(saved).toBe(1);

      const loaded = loadBaseline(db, "alice");
      expect(loaded).not.toBeNull();
      expect(loaded.eventCount).toBe(2);
      expect(loaded.failureCount).toBe(1);
      expect(loaded.actionCounts.get("read")).toBe(1);
    });

    it("returns null for a missing entity", () => {
      expect(loadBaseline(db, "ghost")).toBeNull();
    });

    it("upserts on second save", () => {
      saveBaselines(db, buildBaseline([ev("alice")]));
      saveBaselines(db, buildBaseline([ev("alice"), ev("alice"), ev("alice")]));
      const loaded = loadBaseline(db, "alice");
      expect(loaded.eventCount).toBe(3);
      // Still only one row.
      expect(loadAllBaselines(db).size).toBe(1);
    });

    it("loads every saved baseline via loadAllBaselines", () => {
      saveBaselines(db, buildBaseline([ev("alice"), ev("bob"), ev("carol")]));
      const all = loadAllBaselines(db);
      expect(all.size).toBe(3);
      expect(all.get("alice").eventCount).toBe(1);
      expect(all.get("bob").eventCount).toBe(1);
      expect(all.get("carol").eventCount).toBe(1);
    });
  });
});
