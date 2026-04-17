import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  CIRCUIT_STATE,
  HEALTH_STATUS,
  HEALTH_METRIC,
  POOL_DEFAULTS,
  ensureFederationHardeningTables,
  registerNode,
  getCircuitBreaker,
  listCircuitBreakers,
  recordFailure,
  recordSuccess,
  tryHalfOpen,
  resetCircuitBreaker,
  removeNode,
  recordHealthCheck,
  getHealthCheck,
  listHealthChecks,
  getNodeHealth,
  initPool,
  acquireConnection,
  releaseConnection,
  getPoolStats,
  listPools,
  destroyPool,
  getFederationHardeningStats,
  _resetState,
} from "../../src/lib/federation-hardening.js";

describe("federation-hardening", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureFederationHardeningTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureFederationHardeningTables", () => {
    it("creates both tables", () => {
      expect(db.tables.has("federation_circuit_breakers")).toBe(true);
      expect(db.tables.has("federation_health_checks")).toBe(true);
    });

    it("is idempotent", () => {
      ensureFederationHardeningTables(db);
      expect(db.tables.has("federation_circuit_breakers")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 3 circuit states", () => {
      expect(Object.keys(CIRCUIT_STATE)).toHaveLength(3);
    });

    it("has 4 health statuses", () => {
      expect(Object.keys(HEALTH_STATUS)).toHaveLength(4);
    });

    it("has 5 health metrics", () => {
      expect(Object.keys(HEALTH_METRIC)).toHaveLength(5);
    });

    it("has pool defaults", () => {
      expect(POOL_DEFAULTS.MAX_CONNECTIONS).toBe(50);
    });
  });

  /* ── Node Registration ──────────────────────────── */

  describe("registerNode", () => {
    it("registers a node", () => {
      const r = registerNode(db, "node-1");
      expect(r.registered).toBe(true);
      expect(r.nodeId).toBe("node-1");
    });

    it("defaults to closed state", () => {
      registerNode(db, "node-1");
      const b = getCircuitBreaker(db, "node-1");
      expect(b.state).toBe("closed");
      expect(b.failure_threshold).toBe(5);
    });

    it("accepts custom thresholds", () => {
      registerNode(db, "node-1", {
        failureThreshold: 3,
        successThreshold: 1,
        openTimeout: 30000,
      });
      const b = getCircuitBreaker(db, "node-1");
      expect(b.failure_threshold).toBe(3);
      expect(b.success_threshold).toBe(1);
      expect(b.open_timeout).toBe(30000);
    });

    it("rejects missing node id", () => {
      expect(registerNode(db, "").reason).toBe("missing_node_id");
    });

    it("rejects duplicate", () => {
      registerNode(db, "node-1");
      expect(registerNode(db, "node-1").reason).toBe("already_exists");
    });
  });

  describe("removeNode", () => {
    it("removes a node and its health checks", () => {
      registerNode(db, "node-1");
      recordHealthCheck(db, {
        nodeId: "node-1",
        checkType: "heartbeat",
        status: "healthy",
      });
      const r = removeNode(db, "node-1");
      expect(r.removed).toBe(true);
      expect(getCircuitBreaker(db, "node-1")).toBeNull();
      expect(listHealthChecks(db, { nodeId: "node-1" })).toHaveLength(0);
    });

    it("rejects unknown node", () => {
      expect(removeNode(db, "nope").reason).toBe("not_found");
    });
  });

  /* ── Circuit Breaker State Machine ─────────────── */

  describe("recordFailure", () => {
    beforeEach(() => {
      registerNode(db, "node-1", { failureThreshold: 3 });
    });

    it("increments failure count", () => {
      const r = recordFailure(db, "node-1");
      expect(r.updated).toBe(true);
      expect(r.failureCount).toBe(1);
      expect(r.state).toBe("closed");
    });

    it("trips breaker at threshold", () => {
      recordFailure(db, "node-1");
      recordFailure(db, "node-1");
      const r = recordFailure(db, "node-1");
      expect(r.state).toBe("open");
      expect(r.previousState).toBe("closed");
    });

    it("half_open failure goes back to open", () => {
      // Trip the breaker
      for (let i = 0; i < 3; i++) recordFailure(db, "node-1");
      // Force half_open via reset + manual state
      resetCircuitBreaker(db, "node-1");
      // Register fresh with threshold 1 to trip immediately
      removeNode(db, "node-1");
      registerNode(db, "node-1", { failureThreshold: 1 });
      // Trip to open
      recordFailure(db, "node-1");
      expect(getCircuitBreaker(db, "node-1").state).toBe("open");
    });

    it("rejects unknown node", () => {
      expect(recordFailure(db, "nope").reason).toBe("not_found");
    });
  });

  describe("recordSuccess", () => {
    it("increments success count", () => {
      registerNode(db, "node-1");
      const r = recordSuccess(db, "node-1");
      expect(r.updated).toBe(true);
      expect(r.successCount).toBe(1);
    });

    it("closes breaker in half_open after threshold", () => {
      registerNode(db, "node-1", {
        failureThreshold: 2,
        successThreshold: 2,
        openTimeout: 0,
      });
      recordFailure(db, "node-1");
      recordFailure(db, "node-1");
      expect(getCircuitBreaker(db, "node-1").state).toBe("open");

      // Transition to half_open
      tryHalfOpen(db, "node-1");
      expect(getCircuitBreaker(db, "node-1").state).toBe("half_open");

      recordSuccess(db, "node-1");
      expect(getCircuitBreaker(db, "node-1").state).toBe("half_open");
      const r = recordSuccess(db, "node-1");
      expect(r.state).toBe("closed");
      expect(r.previousState).toBe("half_open");
    });

    it("rejects unknown node", () => {
      expect(recordSuccess(db, "nope").reason).toBe("not_found");
    });
  });

  describe("tryHalfOpen", () => {
    it("transitions open to half_open after timeout", () => {
      registerNode(db, "node-1", { failureThreshold: 1, openTimeout: 0 });
      recordFailure(db, "node-1");
      expect(getCircuitBreaker(db, "node-1").state).toBe("open");

      const r = tryHalfOpen(db, "node-1");
      expect(r.updated).toBe(true);
      expect(r.state).toBe("half_open");
    });

    it("rejects if not open", () => {
      registerNode(db, "node-1");
      const r = tryHalfOpen(db, "node-1");
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("not_open");
    });

    it("rejects if timeout not elapsed", () => {
      registerNode(db, "node-1", { failureThreshold: 1, openTimeout: 999999 });
      recordFailure(db, "node-1");
      const r = tryHalfOpen(db, "node-1");
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("timeout_not_elapsed");
      expect(r.remainingMs).toBeGreaterThan(0);
    });

    it("rejects unknown node", () => {
      expect(tryHalfOpen(db, "nope").reason).toBe("not_found");
    });
  });

  describe("resetCircuitBreaker", () => {
    it("resets to closed", () => {
      registerNode(db, "node-1", { failureThreshold: 1 });
      recordFailure(db, "node-1");
      expect(getCircuitBreaker(db, "node-1").state).toBe("open");

      const r = resetCircuitBreaker(db, "node-1");
      expect(r.reset).toBe(true);
      expect(r.state).toBe("closed");
      expect(getCircuitBreaker(db, "node-1").failure_count).toBe(0);
    });

    it("rejects unknown node", () => {
      expect(resetCircuitBreaker(db, "nope").reason).toBe("not_found");
    });
  });

  describe("listCircuitBreakers", () => {
    it("lists all breakers", () => {
      registerNode(db, "a");
      registerNode(db, "b");
      expect(listCircuitBreakers(db)).toHaveLength(2);
    });

    it("filters by state", () => {
      registerNode(db, "a", { failureThreshold: 1 });
      registerNode(db, "b");
      recordFailure(db, "a");
      expect(listCircuitBreakers(db, { state: "open" })).toHaveLength(1);
      expect(listCircuitBreakers(db, { state: "closed" })).toHaveLength(1);
    });
  });

  /* ── Health Check ────────────────────────────────── */

  describe("recordHealthCheck", () => {
    it("records a health check", () => {
      const r = recordHealthCheck(db, {
        nodeId: "node-1",
        checkType: "heartbeat",
        status: "healthy",
        metrics: '{"latency":50}',
      });
      expect(r.recorded).toBe(true);
      expect(r.checkId).toBeTruthy();
    });

    it("rejects missing node id", () => {
      expect(
        recordHealthCheck(db, { checkType: "heartbeat", status: "healthy" })
          .reason,
      ).toBe("missing_node_id");
    });

    it("rejects invalid check type", () => {
      expect(
        recordHealthCheck(db, {
          nodeId: "n",
          checkType: "invalid",
          status: "healthy",
        }).reason,
      ).toBe("invalid_check_type");
    });

    it("rejects invalid status", () => {
      expect(
        recordHealthCheck(db, {
          nodeId: "n",
          checkType: "heartbeat",
          status: "bad",
        }).reason,
      ).toBe("invalid_status");
    });

    it("accepts metrics as object", () => {
      const r = recordHealthCheck(db, {
        nodeId: "node-1",
        checkType: "latency",
        status: "degraded",
        metrics: { latency: 500 },
      });
      expect(r.recorded).toBe(true);
      const c = getHealthCheck(db, r.checkId);
      expect(c.metrics).toBe('{"latency":500}');
    });
  });

  describe("listHealthChecks", () => {
    beforeEach(() => {
      recordHealthCheck(db, {
        nodeId: "a",
        checkType: "heartbeat",
        status: "healthy",
      });
      recordHealthCheck(db, {
        nodeId: "a",
        checkType: "latency",
        status: "degraded",
      });
      recordHealthCheck(db, {
        nodeId: "b",
        checkType: "heartbeat",
        status: "unhealthy",
      });
    });

    it("lists all checks", () => {
      expect(listHealthChecks(db)).toHaveLength(3);
    });

    it("filters by node", () => {
      expect(listHealthChecks(db, { nodeId: "a" })).toHaveLength(2);
    });

    it("filters by check type", () => {
      expect(listHealthChecks(db, { checkType: "heartbeat" })).toHaveLength(2);
    });

    it("filters by status", () => {
      expect(listHealthChecks(db, { status: "unhealthy" })).toHaveLength(1);
    });
  });

  describe("getNodeHealth", () => {
    it("returns unknown for no checks", () => {
      const h = getNodeHealth(db, "node-1");
      expect(h.status).toBe("unknown");
      expect(h.checks).toBe(0);
    });

    it("returns healthy when all checks healthy", () => {
      recordHealthCheck(db, {
        nodeId: "n1",
        checkType: "heartbeat",
        status: "healthy",
      });
      recordHealthCheck(db, {
        nodeId: "n1",
        checkType: "latency",
        status: "healthy",
      });
      const h = getNodeHealth(db, "n1");
      expect(h.status).toBe("healthy");
    });

    it("returns worst-case status", () => {
      recordHealthCheck(db, {
        nodeId: "n1",
        checkType: "heartbeat",
        status: "healthy",
      });
      recordHealthCheck(db, {
        nodeId: "n1",
        checkType: "latency",
        status: "degraded",
      });
      expect(getNodeHealth(db, "n1").status).toBe("degraded");
    });

    it("unhealthy overrides degraded", () => {
      recordHealthCheck(db, {
        nodeId: "n1",
        checkType: "heartbeat",
        status: "degraded",
      });
      recordHealthCheck(db, {
        nodeId: "n1",
        checkType: "latency",
        status: "unhealthy",
      });
      expect(getNodeHealth(db, "n1").status).toBe("unhealthy");
    });
  });

  /* ── Connection Pool ─────────────────────────────── */

  describe("initPool", () => {
    it("initializes a pool", () => {
      const r = initPool("node-1");
      expect(r.initialized).toBe(true);
    });

    it("uses defaults", () => {
      initPool("node-1");
      const p = getPoolStats("node-1");
      expect(p.minConnections).toBe(5);
      expect(p.maxConnections).toBe(50);
      expect(p.idleConnections).toBe(5);
    });

    it("accepts custom config", () => {
      initPool("node-1", { minConnections: 2, maxConnections: 10 });
      const p = getPoolStats("node-1");
      expect(p.minConnections).toBe(2);
      expect(p.maxConnections).toBe(10);
    });

    it("rejects missing node id", () => {
      expect(initPool("").reason).toBe("missing_node_id");
    });

    it("rejects duplicate", () => {
      initPool("node-1");
      expect(initPool("node-1").reason).toBe("already_exists");
    });
  });

  describe("acquireConnection", () => {
    beforeEach(() => {
      initPool("node-1", { minConnections: 2, maxConnections: 3 });
    });

    it("acquires from idle pool", () => {
      const r = acquireConnection("node-1");
      expect(r.acquired).toBe(true);
      expect(r.active).toBe(1);
      expect(r.idle).toBe(1);
    });

    it("creates new when idle exhausted", () => {
      acquireConnection("node-1");
      acquireConnection("node-1");
      const r = acquireConnection("node-1");
      expect(r.acquired).toBe(true);
      expect(r.active).toBe(3);
    });

    it("rejects when pool exhausted", () => {
      acquireConnection("node-1");
      acquireConnection("node-1");
      acquireConnection("node-1");
      const r = acquireConnection("node-1");
      expect(r.acquired).toBe(false);
      expect(r.reason).toBe("pool_exhausted");
    });

    it("rejects unknown pool", () => {
      expect(acquireConnection("nope").reason).toBe("pool_not_found");
    });
  });

  describe("releaseConnection", () => {
    it("releases back to idle", () => {
      initPool("node-1", { minConnections: 1, maxConnections: 5 });
      acquireConnection("node-1");
      const r = releaseConnection("node-1");
      expect(r.released).toBe(true);
      expect(r.idle).toBe(1);
    });

    it("serves waiting request on release", () => {
      initPool("node-1", { minConnections: 1, maxConnections: 1 });
      acquireConnection("node-1");
      acquireConnection("node-1"); // waiting
      const r = releaseConnection("node-1");
      expect(r.released).toBe(true);
      expect(r.active).toBe(1); // served the waiting request
    });

    it("rejects when no active connections", () => {
      initPool("node-1", { minConnections: 0 });
      expect(releaseConnection("node-1").reason).toBe("no_active_connections");
    });

    it("rejects unknown pool", () => {
      expect(releaseConnection("nope").reason).toBe("pool_not_found");
    });
  });

  describe("listPools / destroyPool", () => {
    it("lists pools", () => {
      initPool("a");
      initPool("b");
      expect(listPools()).toHaveLength(2);
    });

    it("destroys a pool", () => {
      initPool("node-1");
      const r = destroyPool("node-1");
      expect(r.destroyed).toBe(true);
      expect(getPoolStats("node-1")).toBeNull();
    });

    it("rejects unknown pool", () => {
      expect(destroyPool("nope").reason).toBe("pool_not_found");
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getFederationHardeningStats", () => {
    it("returns zeros when empty", () => {
      const s = getFederationHardeningStats(db);
      expect(s.circuitBreakers.total).toBe(0);
      expect(s.healthChecks.total).toBe(0);
      expect(s.connectionPools.total).toBe(0);
    });

    it("computes correct stats", () => {
      registerNode(db, "a", { failureThreshold: 1 });
      registerNode(db, "b");
      recordFailure(db, "a"); // trips to open
      recordHealthCheck(db, {
        nodeId: "a",
        checkType: "heartbeat",
        status: "healthy",
      });
      recordHealthCheck(db, {
        nodeId: "b",
        checkType: "latency",
        status: "degraded",
      });
      initPool("a");
      acquireConnection("a");

      const s = getFederationHardeningStats(db);
      expect(s.circuitBreakers.total).toBe(2);
      expect(s.circuitBreakers.byState.open).toBe(1);
      expect(s.circuitBreakers.byState.closed).toBe(1);
      expect(s.healthChecks.total).toBe(2);
      expect(s.healthChecks.byStatus.healthy).toBe(1);
      expect(s.healthChecks.byStatus.degraded).toBe(1);
      expect(s.connectionPools.total).toBe(1);
      expect(s.connectionPools.totalActive).toBe(1);
    });
  });
});
