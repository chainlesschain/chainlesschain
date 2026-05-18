import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  DEAL_STATUS,
  ROUTE_TYPE,
  ROUTE_STATUS,
  ensureDecentralInfraTables,
  createDeal,
  updateDealStatus,
  renewDeal,
  getDeal,
  listDeals,
  addContentVersion,
  getContentVersion,
  listContentVersions,
  cacheVersion,
  addRoute,
  updateRouteStatus,
  removeRoute,
  getRoute,
  listRoutes,
  getConnectivityReport,
  getInfraStats,
  _resetState,

  // Phase 74-75 V2
  PROVIDER_MATURITY_V2,
  DEAL_LIFECYCLE_V2,
  DI_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OPERATOR,
  DI_DEFAULT_MAX_ACTIVE_DEALS_PER_PROVIDER,
  DI_DEFAULT_PROVIDER_IDLE_MS,
  DI_DEFAULT_DEAL_STUCK_MS,
  getDefaultMaxActiveProvidersPerOperatorV2,
  getMaxActiveProvidersPerOperatorV2,
  setMaxActiveProvidersPerOperatorV2,
  getDefaultMaxActiveDealsPerProviderV2,
  getMaxActiveDealsPerProviderV2,
  setMaxActiveDealsPerProviderV2,
  getDefaultProviderIdleMsV2,
  getProviderIdleMsV2,
  setProviderIdleMsV2,
  getDefaultDealStuckMsV2,
  getDealStuckMsV2,
  setDealStuckMsV2,
  registerProviderV2,
  getProviderV2,
  setProviderMaturityV2,
  activateProvider,
  degradeProvider,
  offlineProvider,
  retireProvider,
  touchProviderHeartbeat,
  enqueueDealV2,
  getDealV2,
  setDealStatusV2,
  activateDeal,
  completeDeal,
  failDeal,
  cancelDeal,
  getActiveProviderCount,
  getActiveDealCount,
  autoOfflineStaleProviders,
  autoFailStuckActiveDeals,
  getDecentralInfraStatsV2,
  _resetStateV2,
} from "../../src/lib/decentral-infra.js";

describe("decentral-infra", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureDecentralInfraTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureDecentralInfraTables", () => {
    it("creates all three tables", () => {
      expect(db.tables.has("filecoin_deals")).toBe(true);
      expect(db.tables.has("content_versions")).toBe(true);
      expect(db.tables.has("anti_censorship_routes")).toBe(true);
    });

    it("is idempotent", () => {
      ensureDecentralInfraTables(db);
      expect(db.tables.has("filecoin_deals")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 4 deal statuses", () => {
      expect(Object.keys(DEAL_STATUS)).toHaveLength(4);
    });

    it("has 5 route types", () => {
      expect(Object.keys(ROUTE_TYPE)).toHaveLength(5);
    });

    it("has 3 route statuses", () => {
      expect(Object.keys(ROUTE_STATUS)).toHaveLength(3);
    });
  });

  /* ── Phase 74: Filecoin Deals ───────────────────── */

  describe("createDeal", () => {
    it("creates a storage deal", () => {
      const r = createDeal(db, {
        cid: "bafy123",
        sizeBytes: 1024000,
        minerId: "f01234",
        priceFil: 0.5,
      });
      expect(r.dealId).toBeTruthy();
      const d = getDeal(db, r.dealId);
      expect(d.cid).toBe("bafy123");
      expect(d.status).toBe("pending");
      expect(d.miner_id).toBe("f01234");
      expect(d.price_fil).toBe(0.5);
    });

    it("rejects missing CID", () => {
      const r = createDeal(db, { sizeBytes: 1024 });
      expect(r.dealId).toBeNull();
      expect(r.reason).toBe("missing_cid");
    });

    it("rejects invalid size", () => {
      const r = createDeal(db, { cid: "bafy123", sizeBytes: 0 });
      expect(r.dealId).toBeNull();
      expect(r.reason).toBe("invalid_size");
    });
  });

  describe("updateDealStatus", () => {
    it("transitions pending → active", () => {
      const { dealId } = createDeal(db, { cid: "bafy1", sizeBytes: 100 });
      const r = updateDealStatus(db, dealId, "active");
      expect(r.updated).toBe(true);
      expect(getDeal(db, dealId).status).toBe("active");
      expect(getDeal(db, dealId).verified).toBe(1);
    });

    it("rejects invalid transition", () => {
      const { dealId } = createDeal(db, { cid: "bafy1", sizeBytes: 100 });
      const r = updateDealStatus(db, dealId, "expired");
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("invalid_transition");
    });

    it("supports retry (failed → pending)", () => {
      const { dealId } = createDeal(db, { cid: "bafy1", sizeBytes: 100 });
      updateDealStatus(db, dealId, "failed");
      const r = updateDealStatus(db, dealId, "pending");
      expect(r.updated).toBe(true);
    });

    it("returns not_found for unknown id", () => {
      const r = updateDealStatus(db, "nope", "active");
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("not_found");
    });
  });

  describe("renewDeal", () => {
    it("renews an active deal", () => {
      const { dealId } = createDeal(db, { cid: "bafy1", sizeBytes: 100 });
      updateDealStatus(db, dealId, "active");
      const r = renewDeal(db, dealId);
      expect(r.renewed).toBe(true);
      expect(r.renewalCount).toBe(1);
      expect(getDeal(db, dealId).renewal_count).toBe(1);
    });

    it("renews an expired deal", () => {
      const { dealId } = createDeal(db, { cid: "bafy1", sizeBytes: 100 });
      updateDealStatus(db, dealId, "active");
      updateDealStatus(db, dealId, "expired");
      const r = renewDeal(db, dealId);
      expect(r.renewed).toBe(true);
      expect(getDeal(db, dealId).status).toBe("active");
    });

    it("rejects renewal of pending deal", () => {
      const { dealId } = createDeal(db, { cid: "bafy1", sizeBytes: 100 });
      const r = renewDeal(db, dealId);
      expect(r.renewed).toBe(false);
      expect(r.reason).toBe("deal_not_renewable");
    });
  });

  describe("listDeals", () => {
    it("lists all deals", () => {
      createDeal(db, { cid: "bafy1", sizeBytes: 100 });
      createDeal(db, { cid: "bafy2", sizeBytes: 200 });
      expect(listDeals(db)).toHaveLength(2);
    });

    it("filters by status", () => {
      const { dealId } = createDeal(db, { cid: "bafy1", sizeBytes: 100 });
      createDeal(db, { cid: "bafy2", sizeBytes: 200 });
      updateDealStatus(db, dealId, "active");
      expect(listDeals(db, { status: "active" })).toHaveLength(1);
      expect(listDeals(db, { status: "pending" })).toHaveLength(1);
    });

    it("returns null for unknown id", () => {
      expect(getDeal(db, "nope")).toBeNull();
    });
  });

  /* ── Content Versions ───────────────────────────── */

  describe("addContentVersion", () => {
    it("creates first version", () => {
      const r = addContentVersion(db, { contentCid: "bafy-content-1" });
      expect(r.versionId).toBeTruthy();
      expect(r.version).toBe(1);
    });

    it("increments version number", () => {
      addContentVersion(db, { contentCid: "bafy-c1" });
      const r = addContentVersion(db, {
        contentCid: "bafy-c1-v2",
        parentCid: "bafy-c1",
      });
      expect(r.version).toBe(2);
    });

    it("stores parent CID and dag", () => {
      const { versionId } = addContentVersion(db, {
        contentCid: "bafy-c2",
        parentCid: "bafy-c1",
        dagStructure: '{"links":[]}',
        peerCount: 5,
      });
      const v = getContentVersion(db, versionId);
      expect(v.parent_cid).toBe("bafy-c1");
      expect(v.dag_structure).toBe('{"links":[]}');
      expect(v.peer_count).toBe(5);
    });

    it("rejects missing content CID", () => {
      const r = addContentVersion(db, {});
      expect(r.versionId).toBeNull();
    });
  });

  describe("listContentVersions", () => {
    it("lists by content CID", () => {
      addContentVersion(db, { contentCid: "bafy-a" });
      addContentVersion(db, { contentCid: "bafy-b" });
      expect(listContentVersions(db)).toHaveLength(2);
      expect(listContentVersions(db, { contentCid: "bafy-a" })).toHaveLength(1);
    });
  });

  describe("cacheVersion", () => {
    it("marks version as cached", () => {
      const { versionId } = addContentVersion(db, { contentCid: "bafy-x" });
      const r = cacheVersion(db, versionId);
      expect(r.cached).toBe(true);
      expect(getContentVersion(db, versionId).cached).toBe(1);
    });

    it("rejects unknown version", () => {
      const r = cacheVersion(db, "nope");
      expect(r.cached).toBe(false);
    });
  });

  /* ── Phase 75: Anti-Censorship Routes ───────────── */

  describe("addRoute", () => {
    it("adds a tor route", () => {
      const r = addRoute(db, {
        routeType: "tor",
        endpoint: "xyz.onion",
        latencyMs: 500,
      });
      expect(r.routeId).toBeTruthy();
      const route = getRoute(db, r.routeId);
      expect(route.route_type).toBe("tor");
      expect(route.status).toBe("active");
    });

    it("adds a domain_front route", () => {
      const r = addRoute(db, {
        routeType: "domain_front",
        endpoint: "cdn.example.com",
        reliability: 0.95,
      });
      const route = getRoute(db, r.routeId);
      expect(route.reliability).toBe(0.95);
    });

    it("clamps reliability to [0, 1]", () => {
      const r = addRoute(db, { routeType: "mesh_ble", reliability: 5 });
      expect(getRoute(db, r.routeId).reliability).toBe(1);
    });

    it("rejects invalid route type", () => {
      const r = addRoute(db, { routeType: "vpn" });
      expect(r.routeId).toBeNull();
      expect(r.reason).toBe("invalid_route_type");
    });
  });

  describe("updateRouteStatus", () => {
    it("updates status", () => {
      const { routeId } = addRoute(db, { routeType: "tor" });
      const r = updateRouteStatus(db, routeId, "inactive");
      expect(r.updated).toBe(true);
      expect(getRoute(db, routeId).status).toBe("inactive");
    });

    it("rejects invalid status", () => {
      const { routeId } = addRoute(db, { routeType: "tor" });
      const r = updateRouteStatus(db, routeId, "broken");
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("invalid_status");
    });

    it("rejects unknown route", () => {
      const r = updateRouteStatus(db, "nope", "active");
      expect(r.updated).toBe(false);
    });
  });

  describe("removeRoute", () => {
    it("removes a route", () => {
      const { routeId } = addRoute(db, { routeType: "mesh_wifi" });
      const r = removeRoute(db, routeId);
      expect(r.removed).toBe(true);
      expect(getRoute(db, routeId)).toBeNull();
    });

    it("rejects unknown route", () => {
      const r = removeRoute(db, "nope");
      expect(r.removed).toBe(false);
    });
  });

  describe("listRoutes", () => {
    it("lists with filters", () => {
      addRoute(db, { routeType: "tor" });
      addRoute(db, { routeType: "domain_front" });
      addRoute(db, { routeType: "tor" });
      expect(listRoutes(db)).toHaveLength(3);
      expect(listRoutes(db, { routeType: "tor" })).toHaveLength(2);
    });

    it("filters by status", () => {
      const { routeId } = addRoute(db, { routeType: "tor" });
      addRoute(db, { routeType: "mesh_ble" });
      updateRouteStatus(db, routeId, "inactive");
      expect(listRoutes(db, { status: "active" })).toHaveLength(1);
      expect(listRoutes(db, { status: "inactive" })).toHaveLength(1);
    });
  });

  describe("getConnectivityReport", () => {
    it("returns zeros when empty", () => {
      const r = getConnectivityReport(db);
      expect(r.totalRoutes).toBe(0);
      expect(r.activeRoutes).toBe(0);
      expect(r.avgLatencyMs).toBe(0);
    });

    it("computes report", () => {
      addRoute(db, { routeType: "tor", latencyMs: 300, reliability: 0.8 });
      addRoute(db, { routeType: "direct", latencyMs: 100, reliability: 1.0 });
      const r = getConnectivityReport(db);
      expect(r.totalRoutes).toBe(2);
      expect(r.activeRoutes).toBe(2);
      expect(r.avgLatencyMs).toBe(200);
      expect(r.avgReliability).toBe(0.9);
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getInfraStats", () => {
    it("returns zeros when empty", () => {
      const s = getInfraStats(db);
      expect(s.storage.totalDeals).toBe(0);
      expect(s.content.totalVersions).toBe(0);
      expect(s.connectivity.totalRoutes).toBe(0);
    });

    it("computes correct stats", () => {
      createDeal(db, { cid: "bafy1", sizeBytes: 1000, priceFil: 0.5 });
      const { dealId } = createDeal(db, {
        cid: "bafy2",
        sizeBytes: 2000,
        priceFil: 1.0,
      });
      updateDealStatus(db, dealId, "active");
      addContentVersion(db, { contentCid: "bafy-c1" });
      const { versionId } = addContentVersion(db, {
        contentCid: "bafy-c2",
      });
      cacheVersion(db, versionId);
      addRoute(db, { routeType: "tor", latencyMs: 200 });

      const s = getInfraStats(db);
      expect(s.storage.totalDeals).toBe(2);
      expect(s.storage.active).toBe(1);
      expect(s.storage.totalSizeBytes).toBe(3000);
      expect(s.storage.totalPriceFil).toBe(1.5);
      expect(s.content.totalVersions).toBe(2);
      expect(s.content.cached).toBe(1);
      expect(s.content.uniqueCids).toBe(2);
      expect(s.connectivity.totalRoutes).toBe(1);
    });
  });
});

/* ═════════════════════════════════════════════════════════ *
 *  Phase 74-75 V2 — Provider Maturity + Deal Lifecycle
 * ═════════════════════════════════════════════════════════ */

describe("decentral-infra V2 (Phase 74-75)", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  describe("enums", () => {
    it("PROVIDER_MATURITY_V2 has 5 frozen states", () => {
      expect(Object.keys(PROVIDER_MATURITY_V2)).toHaveLength(5);
      expect(Object.isFrozen(PROVIDER_MATURITY_V2)).toBe(true);
    });
    it("DEAL_LIFECYCLE_V2 has 5 frozen states", () => {
      expect(Object.keys(DEAL_LIFECYCLE_V2)).toHaveLength(5);
      expect(Object.isFrozen(DEAL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config + setters", () => {
    it("defaults + getters", () => {
      expect(getDefaultMaxActiveProvidersPerOperatorV2()).toBe(
        DI_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OPERATOR,
      );
      expect(getDefaultMaxActiveDealsPerProviderV2()).toBe(
        DI_DEFAULT_MAX_ACTIVE_DEALS_PER_PROVIDER,
      );
      expect(getDefaultProviderIdleMsV2()).toBe(DI_DEFAULT_PROVIDER_IDLE_MS);
      expect(getDefaultDealStuckMsV2()).toBe(DI_DEFAULT_DEAL_STUCK_MS);
      expect(getMaxActiveProvidersPerOperatorV2()).toBe(
        DI_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OPERATOR,
      );
    });
    it("setters validate positive", () => {
      expect(setMaxActiveProvidersPerOperatorV2(3)).toBe(3);
      expect(setMaxActiveDealsPerProviderV2(2)).toBe(2);
      expect(setProviderIdleMsV2(1000)).toBe(1000);
      expect(setDealStuckMsV2(500)).toBe(500);
      expect(() => setMaxActiveProvidersPerOperatorV2(0)).toThrow(/positive/);
      expect(() => setDealStuckMsV2(-1)).toThrow(/positive/);
    });
  });

  describe("registerProviderV2", () => {
    it("registers with onboarding default", () => {
      const r = registerProviderV2(null, {
        providerId: "p1",
        operatorId: "op1",
        kind: "filecoin",
      });
      expect(r.status).toBe("onboarding");
      expect(r.kind).toBe("filecoin");
    });

    it("validates required + duplicate + invalid/terminal initial", () => {
      expect(() => registerProviderV2(null, {})).toThrow(/providerId/);
      expect(() => registerProviderV2(null, { providerId: "p" })).toThrow(
        /operatorId/,
      );
      expect(() =>
        registerProviderV2(null, { providerId: "p", operatorId: "o" }),
      ).toThrow(/kind/);
      registerProviderV2(null, {
        providerId: "p1",
        operatorId: "o",
        kind: "k",
      });
      expect(() =>
        registerProviderV2(null, {
          providerId: "p1",
          operatorId: "o",
          kind: "k",
        }),
      ).toThrow(/already exists/);
      expect(() =>
        registerProviderV2(null, {
          providerId: "p2",
          operatorId: "o",
          kind: "k",
          initialStatus: "galaxy",
        }),
      ).toThrow(/Invalid initial/);
      expect(() =>
        registerProviderV2(null, {
          providerId: "p2",
          operatorId: "o",
          kind: "k",
          initialStatus: "retired",
        }),
      ).toThrow(/terminal/);
    });

    it("enforces active cap", () => {
      setMaxActiveProvidersPerOperatorV2(1);
      registerProviderV2(null, {
        providerId: "p1",
        operatorId: "o",
        kind: "k",
        initialStatus: "active",
      });
      expect(() =>
        registerProviderV2(null, {
          providerId: "p2",
          operatorId: "o",
          kind: "k",
          initialStatus: "active",
        }),
      ).toThrow(/cap/);
    });
  });

  describe("provider maturity + shortcuts", () => {
    beforeEach(() => {
      registerProviderV2(null, {
        providerId: "p1",
        operatorId: "o",
        kind: "k",
      });
    });

    it("onboarding→active→degraded→active", () => {
      activateProvider(null, "p1");
      degradeProvider(null, "p1");
      activateProvider(null, "p1");
      expect(getProviderV2("p1").status).toBe("active");
    });

    it("retire terminal; offline → active", () => {
      activateProvider(null, "p1");
      offlineProvider(null, "p1");
      activateProvider(null, "p1");
      retireProvider(null, "p1");
      expect(() => activateProvider(null, "p1")).toThrow(/Invalid transition/);
    });

    it("rejects unknown + invalid target", () => {
      expect(() => activateProvider(null, "nope")).toThrow(/Unknown/);
      expect(() => setProviderMaturityV2(null, "p1", "galaxy")).toThrow(
        /Invalid status/,
      );
    });

    it("cap enforced on re-activate", () => {
      setMaxActiveProvidersPerOperatorV2(1);
      activateProvider(null, "p1");
      registerProviderV2(null, {
        providerId: "p2",
        operatorId: "o",
        kind: "k",
      });
      expect(() => activateProvider(null, "p2")).toThrow(/cap/);
    });

    it("merges reason + metadata", () => {
      const r = setProviderMaturityV2(null, "p1", "active", {
        reason: "ready",
        metadata: { a: 1 },
      });
      expect(r.lastReason).toBe("ready");
      expect(r.metadata.a).toBe(1);
    });
  });

  describe("touchProviderHeartbeat", () => {
    it("updates lastHeartbeatAt", async () => {
      registerProviderV2(null, {
        providerId: "p1",
        operatorId: "o",
        kind: "k",
      });
      const before = getProviderV2("p1").lastHeartbeatAt;
      await new Promise((r) => setTimeout(r, 2));
      const r = touchProviderHeartbeat("p1");
      expect(r.lastHeartbeatAt).toBeGreaterThanOrEqual(before);
    });
    it("throws unknown", () => {
      expect(() => touchProviderHeartbeat("nope")).toThrow(/Unknown/);
    });
  });

  describe("deal lifecycle", () => {
    beforeEach(() => {
      registerProviderV2(null, {
        providerId: "p1",
        operatorId: "o",
        kind: "k",
      });
    });

    it("enqueue + queued", () => {
      const r = enqueueDealV2(null, {
        dealId: "d1",
        providerId: "p1",
        ownerId: "u",
      });
      expect(r.status).toBe("queued");
    });

    it("validates required + unknown provider + duplicate", () => {
      expect(() => enqueueDealV2(null, {})).toThrow(/dealId/);
      expect(() => enqueueDealV2(null, { dealId: "d" })).toThrow(/providerId/);
      expect(() =>
        enqueueDealV2(null, { dealId: "d", providerId: "p1" }),
      ).toThrow(/ownerId/);
      expect(() =>
        enqueueDealV2(null, { dealId: "d", providerId: "px", ownerId: "o" }),
      ).toThrow(/Unknown provider/);
      enqueueDealV2(null, { dealId: "d1", providerId: "p1", ownerId: "u" });
      expect(() =>
        enqueueDealV2(null, { dealId: "d1", providerId: "p1", ownerId: "u" }),
      ).toThrow(/already exists/);
    });

    it("queued → active → completed + stamp-once", () => {
      enqueueDealV2(null, { dealId: "d1", providerId: "p1", ownerId: "u" });
      const a = activateDeal(null, "d1");
      expect(a.status).toBe("active");
      expect(a.activatedAt).toBeGreaterThan(0);
      completeDeal(null, "d1");
      expect(getDealV2("d1").status).toBe("completed");
    });

    it("queued → failed / canceled both valid", () => {
      enqueueDealV2(null, { dealId: "d1", providerId: "p1", ownerId: "u" });
      failDeal(null, "d1");
      enqueueDealV2(null, { dealId: "d2", providerId: "p1", ownerId: "u" });
      cancelDeal(null, "d2");
    });

    it("terminals reject further transitions", () => {
      enqueueDealV2(null, { dealId: "d1", providerId: "p1", ownerId: "u" });
      activateDeal(null, "d1");
      completeDeal(null, "d1");
      expect(() => failDeal(null, "d1")).toThrow(/Invalid transition/);
    });

    it("active cap per provider", () => {
      setMaxActiveDealsPerProviderV2(1);
      enqueueDealV2(null, { dealId: "d1", providerId: "p1", ownerId: "u" });
      enqueueDealV2(null, { dealId: "d2", providerId: "p1", ownerId: "u" });
      activateDeal(null, "d1");
      expect(() => activateDeal(null, "d2")).toThrow(/cap/);
    });
  });

  describe("counts + auto-flips + stats", () => {
    it("counts", () => {
      registerProviderV2(null, {
        providerId: "p1",
        operatorId: "o1",
        kind: "k",
      });
      registerProviderV2(null, {
        providerId: "p2",
        operatorId: "o2",
        kind: "k",
      });
      activateProvider(null, "p1");
      activateProvider(null, "p2");
      expect(getActiveProviderCount()).toBe(2);
      expect(getActiveProviderCount("o1")).toBe(1);
      enqueueDealV2(null, { dealId: "d1", providerId: "p1", ownerId: "u" });
      activateDeal(null, "d1");
      expect(getActiveDealCount()).toBe(1);
      expect(getActiveDealCount("p1")).toBe(1);
      expect(getActiveDealCount("p2")).toBe(0);
    });

    it("autoOfflineStaleProviders flips active+degraded", () => {
      registerProviderV2(null, {
        providerId: "p1",
        operatorId: "o",
        kind: "k",
      });
      registerProviderV2(null, {
        providerId: "p2",
        operatorId: "o",
        kind: "k",
      });
      activateProvider(null, "p1");
      activateProvider(null, "p2");
      degradeProvider(null, "p2");
      const now = Date.now() + DI_DEFAULT_PROVIDER_IDLE_MS + 1;
      const r = autoOfflineStaleProviders(null, now);
      expect(r.count).toBe(2);
      expect(r.flipped.sort()).toEqual(["p1", "p2"]);
    });

    it("autoFailStuckActiveDeals only flips ACTIVE", () => {
      registerProviderV2(null, {
        providerId: "p1",
        operatorId: "o",
        kind: "k",
      });
      setMaxActiveDealsPerProviderV2(5);
      enqueueDealV2(null, { dealId: "d1", providerId: "p1", ownerId: "u" });
      enqueueDealV2(null, { dealId: "d2", providerId: "p1", ownerId: "u" });
      activateDeal(null, "d1");
      const now = Date.now() + DI_DEFAULT_DEAL_STUCK_MS + 1;
      const r = autoFailStuckActiveDeals(null, now);
      expect(r.count).toBe(1);
      expect(r.flipped).toEqual(["d1"]);
      expect(getDealV2("d2").status).toBe("queued");
    });

    it("stats zero-initializes", () => {
      const s = getDecentralInfraStatsV2();
      expect(s.totalProvidersV2).toBe(0);
      for (const k of Object.values(PROVIDER_MATURITY_V2))
        expect(s.providersByStatus[k]).toBe(0);
      for (const k of Object.values(DEAL_LIFECYCLE_V2))
        expect(s.dealsByStatus[k]).toBe(0);
    });
  });

  describe("_resetStateV2", () => {
    it("clears + restores defaults", () => {
      setMaxActiveProvidersPerOperatorV2(9);
      registerProviderV2(null, {
        providerId: "p1",
        operatorId: "o",
        kind: "k",
      });
      _resetStateV2();
      expect(getMaxActiveProvidersPerOperatorV2()).toBe(
        DI_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OPERATOR,
      );
      expect(getProviderV2("p1")).toBeNull();
    });
  });
});
