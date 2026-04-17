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
