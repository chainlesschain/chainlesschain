/**
 * LoadBalancer unit tests — src/main/ai-engine/cowork/load-balancer.js
 *
 * Critical multi-agent task-scheduling logic (composite load scoring, health
 * classification, least-loaded agent selection, load shedding) that previously
 * had NO test coverage. No bug was found on review — this suite locks in the
 * scoring/selection contract against regressions.
 *
 * Constructor takes no timers/DB at construction, so it's fully offline-testable
 * by populating the internal _metrics map directly.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  LoadBalancer,
  HealthStatus,
} from "../../../src/main/ai-engine/cowork/load-balancer.js";

const lb = (config) => new LoadBalancer(null, null, null, config || {});
const setAgent = (b, id, m) =>
  b._metrics.set(id, {
    health: HealthStatus.HEALTHY,
    activeTasks: 0,
    loadScore: 0,
    ...m,
  });

describe("LoadBalancer._calculateLoadScore", () => {
  it("returns 0 for an idle agent", () => {
    expect(lb()._calculateLoadScore({})).toBe(0);
  });

  it("clamps every component and weights them (weights sum to 1)", () => {
    const s = lb()._calculateLoadScore({
      activeTasks: 100,
      queueDepth: 1000,
      errorRate: 5,
      avgResponseMs: 1e9,
    });
    expect(s).toBe(1);
  });

  it("computes partial weighted scores per component", () => {
    const b = lb();
    expect(b._calculateLoadScore({ activeTasks: 5 })).toBe(0.4); // taskLoad weight
    expect(b._calculateLoadScore({ errorRate: 0.5 })).toBe(0.1); // errorRate weight
  });
});

describe("LoadBalancer.calculateLoadScore (by id)", () => {
  it("returns 0 for an unknown agent", () => {
    expect(lb().calculateLoadScore("ghost")).toBe(0);
  });

  it("scores a known agent from its metrics", () => {
    const b = lb();
    setAgent(b, "a", { activeTasks: 5 });
    expect(b.calculateLoadScore("a")).toBe(0.4);
  });
});

describe("LoadBalancer._determineHealth", () => {
  const now = Date.now();

  it("healthy for a fresh, low-load agent", () => {
    expect(
      lb()._determineHealth({
        lastHeartbeat: now,
        errorRate: 0,
        loadScore: 0.1,
      }),
    ).toBe(HealthStatus.HEALTHY);
  });

  it("degraded on moderate error rate or load", () => {
    expect(
      lb()._determineHealth({
        lastHeartbeat: now,
        errorRate: 0.3,
        loadScore: 0,
      }),
    ).toBe(HealthStatus.DEGRADED);
    expect(
      lb()._determineHealth({
        lastHeartbeat: now,
        errorRate: 0,
        loadScore: 0.85,
      }),
    ).toBe(HealthStatus.DEGRADED);
  });

  it("unhealthy on high error rate or load", () => {
    expect(
      lb()._determineHealth({
        lastHeartbeat: now,
        errorRate: 0.6,
        loadScore: 0,
      }),
    ).toBe(HealthStatus.UNHEALTHY);
    expect(
      lb()._determineHealth({
        lastHeartbeat: now,
        errorRate: 0,
        loadScore: 0.96,
      }),
    ).toBe(HealthStatus.UNHEALTHY);
  });

  it("unresponsive when the heartbeat is stale (> 3x interval)", () => {
    expect(
      lb()._determineHealth({
        lastHeartbeat: now - 100000, // default heartbeatInterval 30s * 3 = 90s
        errorRate: 0,
        loadScore: 0,
      }),
    ).toBe(HealthStatus.UNRESPONSIVE);
  });
});

describe("LoadBalancer.suggestAssignment", () => {
  it("returns no agent when the pool is empty", () => {
    const r = lb().suggestAssignment({});
    expect(r.agentId).toBeNull();
    expect(r.reason).toMatch(/No available agents/);
  });

  it("picks the least-loaded healthy agent", () => {
    const b = lb();
    setAgent(b, "busy", { loadScore: 0.7 });
    setAgent(b, "idle", { loadScore: 0.1 });
    expect(b.suggestAssignment({}).agentId).toBe("idle");
  });

  it("excludes unhealthy and unresponsive agents", () => {
    const b = lb();
    setAgent(b, "down", { loadScore: 0, health: HealthStatus.UNRESPONSIVE });
    setAgent(b, "sick", { loadScore: 0, health: HealthStatus.UNHEALTHY });
    setAgent(b, "ok", { loadScore: 0.5, health: HealthStatus.HEALTHY });
    // 'ok' is more loaded but is the only selectable agent
    expect(b.suggestAssignment({}).agentId).toBe("ok");
  });

  it("warns when even the least-loaded agent is overloaded", () => {
    const b = lb();
    setAgent(b, "a", { loadScore: 0.85 });
    const r = b.suggestAssignment({});
    expect(r.agentId).toBe("a");
    expect(r.warning).toBe(true);
  });

  it("rejects assignment while load shedding is active", () => {
    const b = lb();
    b._loadSheddingActive = true;
    setAgent(b, "a", { loadScore: 0.1 });
    const r = b.suggestAssignment({});
    expect(r.rejected).toBe(true);
    expect(r.agentId).toBeNull();
  });
});
