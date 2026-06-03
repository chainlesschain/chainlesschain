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
  BASELINE_MATURITY_V2,
  INVESTIGATION_V2,
  UEBA_DEFAULT_MAX_ACTIVE_BASELINES_PER_OWNER,
  UEBA_DEFAULT_MAX_OPEN_INVESTIGATIONS_PER_ANALYST,
  UEBA_DEFAULT_BASELINE_STALE_MS,
  UEBA_DEFAULT_INVESTIGATION_STUCK_MS,
  getMaxActiveBaselinesPerOwnerV2,
  setMaxActiveBaselinesPerOwnerV2,
  getMaxOpenInvestigationsPerAnalystV2,
  setMaxOpenInvestigationsPerAnalystV2,
  getBaselineStaleMsV2,
  setBaselineStaleMsV2,
  getInvestigationStuckMsV2,
  setInvestigationStuckMsV2,
  getActiveBaselineCountV2,
  getOpenInvestigationCountV2,
  createBaselineV2,
  getBaselineV2,
  listBaselinesV2,
  setBaselineMaturityV2,
  activateBaselineV2,
  markBaselineStaleV2,
  archiveBaselineV2,
  refreshBaselineV2,
  openInvestigationV2,
  getInvestigationV2,
  listInvestigationsV2,
  setInvestigationStatusV2,
  startInvestigationV2,
  closeInvestigationV2,
  dismissInvestigationV2,
  escalateInvestigationV2,
  autoMarkStaleBaselinesV2,
  autoEscalateStuckInvestigationsV2,
  getUebaStatsV2,
  _resetStateUebaV2,
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

/* ═══ UEBA V2 ═══ */

describe("ueba V2", () => {
  beforeEach(() => {
    _resetStateUebaV2();
  });

  it("enums are frozen", () => {
    expect(Object.isFrozen(BASELINE_MATURITY_V2)).toBe(true);
    expect(Object.values(BASELINE_MATURITY_V2).sort()).toEqual([
      "active",
      "archived",
      "draft",
      "stale",
    ]);
    expect(Object.isFrozen(INVESTIGATION_V2)).toBe(true);
    expect(Object.values(INVESTIGATION_V2).sort()).toEqual([
      "closed",
      "dismissed",
      "escalated",
      "investigating",
      "open",
    ]);
  });

  it("defaults exposed", () => {
    expect(UEBA_DEFAULT_MAX_ACTIVE_BASELINES_PER_OWNER).toBe(20);
    expect(UEBA_DEFAULT_MAX_OPEN_INVESTIGATIONS_PER_ANALYST).toBe(10);
    expect(UEBA_DEFAULT_BASELINE_STALE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(UEBA_DEFAULT_INVESTIGATION_STUCK_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("config setters accept/reject", () => {
    expect(setMaxActiveBaselinesPerOwnerV2(5)).toBe(5);
    expect(setMaxOpenInvestigationsPerAnalystV2(3)).toBe(3);
    expect(setBaselineStaleMsV2(1000)).toBe(1000);
    expect(setInvestigationStuckMsV2(500)).toBe(500);
    expect(getMaxActiveBaselinesPerOwnerV2()).toBe(5);
    expect(getMaxOpenInvestigationsPerAnalystV2()).toBe(3);
    expect(getBaselineStaleMsV2()).toBe(1000);
    expect(getInvestigationStuckMsV2()).toBe(500);
    expect(() => setMaxActiveBaselinesPerOwnerV2(0)).toThrow(/positive/);
    expect(() => setMaxOpenInvestigationsPerAnalystV2(NaN)).toThrow(/positive/);
  });

  it("createBaselineV2 creates draft", () => {
    const b = createBaselineV2({ id: "b1", owner: "alice", entity: "user-42" });
    expect(b.status).toBe(BASELINE_MATURITY_V2.DRAFT);
    expect(b.activatedAt).toBeNull();
  });

  it("createBaselineV2 requires id/owner/entity", () => {
    expect(() => createBaselineV2({ owner: "a", entity: "e" })).toThrow(/id/);
    expect(() => createBaselineV2({ id: "b", entity: "e" })).toThrow(/owner/);
    expect(() => createBaselineV2({ id: "b", owner: "a" })).toThrow(/entity/);
  });

  it("createBaselineV2 rejects duplicate", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    expect(() =>
      createBaselineV2({ id: "b1", owner: "a", entity: "e" }),
    ).toThrow(/already/);
  });

  it("baseline state machine draft→active→stale→active→archived", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    const a = activateBaselineV2("b1");
    expect(a.status).toBe(BASELINE_MATURITY_V2.ACTIVE);
    expect(a.activatedAt).toBeTypeOf("number");
    markBaselineStaleV2("b1");
    const a2 = activateBaselineV2("b1");
    expect(a2.activatedAt).toBe(a.activatedAt);
    archiveBaselineV2("b1");
    expect(() => activateBaselineV2("b1")).toThrow(/cannot transition/);
  });

  it("baseline draft→stale is invalid", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    expect(() => markBaselineStaleV2("b1")).toThrow(/cannot transition/);
  });

  it("refreshBaselineV2 updates lastRefreshedAt", async () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    activateBaselineV2("b1");
    const before = getBaselineV2("b1").lastRefreshedAt;
    await new Promise((r) => setTimeout(r, 5));
    const after = refreshBaselineV2("b1").lastRefreshedAt;
    expect(after).toBeGreaterThan(before);
  });

  it("refreshBaselineV2 throws on terminal", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    archiveBaselineV2("b1");
    expect(() => refreshBaselineV2("b1")).toThrow(/terminal/);
  });

  it("active-baseline cap excludes draft+archived", () => {
    setMaxActiveBaselinesPerOwnerV2(2);
    for (let i = 1; i <= 3; i++)
      createBaselineV2({ id: `b${i}`, owner: "a", entity: "e" });
    activateBaselineV2("b1");
    activateBaselineV2("b2");
    expect(() => activateBaselineV2("b3")).toThrow(/max active baseline/);
    expect(getActiveBaselineCountV2("a")).toBe(2);
  });

  it("getActiveBaselineCountV2 requires owner", () => {
    expect(() => getActiveBaselineCountV2()).toThrow(/owner/);
  });

  it("listBaselinesV2 filters", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e1" });
    createBaselineV2({ id: "b2", owner: "b", entity: "e2" });
    activateBaselineV2("b1");
    expect(listBaselinesV2({ owner: "a" })).toHaveLength(1);
    expect(
      listBaselinesV2({ status: BASELINE_MATURITY_V2.ACTIVE }),
    ).toHaveLength(1);
  });

  it("openInvestigationV2 requires baseline existence", () => {
    expect(() =>
      openInvestigationV2({ id: "i1", analyst: "eve", baselineId: "nope" }),
    ).toThrow(/baseline nope not found/);
  });

  it("openInvestigationV2 creates open", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    const i = openInvestigationV2({
      id: "i1",
      analyst: "eve",
      baselineId: "b1",
      summary: "odd",
    });
    expect(i.status).toBe(INVESTIGATION_V2.OPEN);
    expect(i.startedAt).toBeNull();
  });

  it("openInvestigationV2 rejects duplicate", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    openInvestigationV2({ id: "i1", analyst: "eve", baselineId: "b1" });
    expect(() =>
      openInvestigationV2({ id: "i1", analyst: "eve", baselineId: "b1" }),
    ).toThrow(/already/);
  });

  it("investigation state machine open→investigating→closed", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    openInvestigationV2({ id: "i1", analyst: "eve", baselineId: "b1" });
    const s = startInvestigationV2("i1");
    expect(s.status).toBe(INVESTIGATION_V2.INVESTIGATING);
    expect(s.startedAt).toBeTypeOf("number");
    const c = closeInvestigationV2("i1");
    expect(c.status).toBe(INVESTIGATION_V2.CLOSED);
    expect(c.closedAt).toBeTypeOf("number");
  });

  it("open → dismissed terminal", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    openInvestigationV2({ id: "i1", analyst: "eve", baselineId: "b1" });
    const d = dismissInvestigationV2("i1");
    expect(d.status).toBe(INVESTIGATION_V2.DISMISSED);
  });

  it("investigating → escalated", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    openInvestigationV2({ id: "i1", analyst: "eve", baselineId: "b1" });
    startInvestigationV2("i1");
    const e = escalateInvestigationV2("i1");
    expect(e.status).toBe(INVESTIGATION_V2.ESCALATED);
  });

  it("terminal investigations do not transition", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    openInvestigationV2({ id: "i1", analyst: "eve", baselineId: "b1" });
    startInvestigationV2("i1");
    closeInvestigationV2("i1");
    expect(() => startInvestigationV2("i1")).toThrow(/cannot transition/);
  });

  it("open investigation cap", () => {
    setMaxOpenInvestigationsPerAnalystV2(2);
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    for (let i = 1; i <= 3; i++) {
      if (i <= 2)
        openInvestigationV2({ id: `i${i}`, analyst: "eve", baselineId: "b1" });
    }
    expect(() =>
      openInvestigationV2({ id: "i3", analyst: "eve", baselineId: "b1" }),
    ).toThrow(/max open investigation/);
    expect(getOpenInvestigationCountV2("eve")).toBe(2);
  });

  it("getOpenInvestigationCountV2 requires analyst", () => {
    expect(() => getOpenInvestigationCountV2()).toThrow(/analyst/);
  });

  it("closing frees the slot", () => {
    setMaxOpenInvestigationsPerAnalystV2(1);
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    openInvestigationV2({ id: "i1", analyst: "eve", baselineId: "b1" });
    expect(() =>
      openInvestigationV2({ id: "i2", analyst: "eve", baselineId: "b1" }),
    ).toThrow(/max open/);
    dismissInvestigationV2("i1");
    expect(() =>
      openInvestigationV2({ id: "i2", analyst: "eve", baselineId: "b1" }),
    ).not.toThrow();
  });

  it("listInvestigationsV2 filters by analyst/status/baselineId", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    createBaselineV2({ id: "b2", owner: "a", entity: "e" });
    openInvestigationV2({ id: "i1", analyst: "eve", baselineId: "b1" });
    openInvestigationV2({ id: "i2", analyst: "bob", baselineId: "b2" });
    startInvestigationV2("i1");
    expect(listInvestigationsV2({ analyst: "eve" })).toHaveLength(1);
    expect(listInvestigationsV2({ baselineId: "b2" })).toHaveLength(1);
    expect(
      listInvestigationsV2({ status: INVESTIGATION_V2.INVESTIGATING }),
    ).toHaveLength(1);
  });

  it("autoMarkStaleBaselinesV2 flips only active past threshold", () => {
    setBaselineStaleMsV2(500);
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    activateBaselineV2("b1");
    createBaselineV2({ id: "b2", owner: "a", entity: "e" }); // draft
    const now = Date.now() + 5000;
    expect(autoMarkStaleBaselinesV2({ now })).toEqual(["b1"]);
    expect(getBaselineV2("b2").status).toBe(BASELINE_MATURITY_V2.DRAFT);
  });

  it("autoEscalateStuckInvestigationsV2 escalates only investigating", () => {
    setInvestigationStuckMsV2(500);
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    openInvestigationV2({ id: "i1", analyst: "eve", baselineId: "b1" });
    startInvestigationV2("i1");
    openInvestigationV2({ id: "i2", analyst: "eve", baselineId: "b1" }); // open, untouched
    const now = Date.now() + 5000;
    const out = autoEscalateStuckInvestigationsV2({ now });
    expect(out).toEqual(["i1"]);
    expect(getInvestigationV2("i1").status).toBe(INVESTIGATION_V2.ESCALATED);
    expect(getInvestigationV2("i1").reason).toMatch(/auto-escalate/);
    expect(getInvestigationV2("i2").status).toBe(INVESTIGATION_V2.OPEN);
  });

  it("getUebaStatsV2 zero-initialized", () => {
    const s = getUebaStatsV2();
    expect(s.totalBaselinesV2).toBe(0);
    expect(s.totalInvestigationsV2).toBe(0);
    expect(s.baselinesByStatus.draft).toBe(0);
    expect(s.baselinesByStatus.active).toBe(0);
    expect(s.investigationsByStatus.open).toBe(0);
    expect(s.investigationsByStatus.escalated).toBe(0);
  });

  it("getUebaStatsV2 counts mutations", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    activateBaselineV2("b1");
    openInvestigationV2({ id: "i1", analyst: "eve", baselineId: "b1" });
    const s = getUebaStatsV2();
    expect(s.baselinesByStatus.active).toBe(1);
    expect(s.investigationsByStatus.open).toBe(1);
  });

  it("_resetStateUebaV2 clears and restores defaults", () => {
    createBaselineV2({ id: "b1", owner: "a", entity: "e" });
    setMaxActiveBaselinesPerOwnerV2(99);
    _resetStateUebaV2();
    expect(getUebaStatsV2().totalBaselinesV2).toBe(0);
    expect(getMaxActiveBaselinesPerOwnerV2()).toBe(20);
  });
});
