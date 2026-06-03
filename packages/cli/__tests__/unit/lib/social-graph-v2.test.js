import { describe, test, expect, beforeEach } from "vitest";
import {
  SG_NODE_MATURITY_V2,
  SG_EDGE_LIFECYCLE_V2,
  setMaxActiveSgNodesPerOwnerV2,
  getMaxActiveSgNodesPerOwnerV2,
  setMaxPendingSgEdgesPerNodeV2,
  getMaxPendingSgEdgesPerNodeV2,
  setSgNodeIdleMsV2,
  getSgNodeIdleMsV2,
  setSgEdgeStuckMsV2,
  getSgEdgeStuckMsV2,
  _resetStateSocialGraphV2,
  registerSgNodeV2,
  activateSgNodeV2,
  deactivateSgNodeV2,
  removeSgNodeV2,
  touchSgNodeV2,
  getSgNodeV2,
  listSgNodesV2,
  createSgEdgeV2,
  establishSgEdgeV2,
  severSgEdgeV2,
  expireSgEdgeV2,
  cancelSgEdgeV2,
  getSgEdgeV2,
  listSgEdgesV2,
  autoDeactivateIdleSgNodesV2,
  autoExpireStaleSgEdgesV2,
  getSocialGraphGovStatsV2,
} from "../../../src/lib/social-graph.js";

beforeEach(() => {
  _resetStateSocialGraphV2();
});

describe("SocialGraph V2 enums", () => {
  test("node maturity", () => {
    expect(SG_NODE_MATURITY_V2.PENDING).toBe("pending");
    expect(SG_NODE_MATURITY_V2.ACTIVE).toBe("active");
    expect(SG_NODE_MATURITY_V2.INACTIVE).toBe("inactive");
    expect(SG_NODE_MATURITY_V2.REMOVED).toBe("removed");
  });
  test("edge lifecycle", () => {
    expect(SG_EDGE_LIFECYCLE_V2.PROPOSED).toBe("proposed");
    expect(SG_EDGE_LIFECYCLE_V2.ESTABLISHED).toBe("established");
    expect(SG_EDGE_LIFECYCLE_V2.SEVERED).toBe("severed");
    expect(SG_EDGE_LIFECYCLE_V2.EXPIRED).toBe("expired");
    expect(SG_EDGE_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(SG_NODE_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(SG_EDGE_LIFECYCLE_V2)).toBe(true);
  });
});

describe("SocialGraph V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveSgNodesPerOwnerV2()).toBe(50);
    expect(getMaxPendingSgEdgesPerNodeV2()).toBe(100);
    expect(getSgNodeIdleMsV2()).toBe(60 * 24 * 60 * 60 * 1000);
    expect(getSgEdgeStuckMsV2()).toBe(14 * 24 * 60 * 60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveSgNodesPerOwnerV2(3);
    expect(getMaxActiveSgNodesPerOwnerV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingSgEdgesPerNodeV2(4);
    expect(getMaxPendingSgEdgesPerNodeV2()).toBe(4);
  });
  test("set idle/stuck ms", () => {
    setSgNodeIdleMsV2(100);
    expect(getSgNodeIdleMsV2()).toBe(100);
    setSgEdgeStuckMsV2(50);
    expect(getSgEdgeStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveSgNodesPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveSgNodesPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveSgNodesPerOwnerV2(5.9);
    expect(getMaxActiveSgNodesPerOwnerV2()).toBe(5);
  });
});

describe("SocialGraph V2 node lifecycle", () => {
  test("register", () => {
    const n = registerSgNodeV2({ id: "n1", owner: "u1" });
    expect(n.status).toBe("pending");
    expect(n.handle).toBe("n1");
  });
  test("register with handle", () => {
    const n = registerSgNodeV2({ id: "n1", owner: "u1", handle: "alice" });
    expect(n.handle).toBe("alice");
  });
  test("register reject duplicate/missing", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    expect(() => registerSgNodeV2({ id: "n1", owner: "u1" })).toThrow();
    expect(() => registerSgNodeV2({ owner: "u1" })).toThrow();
    expect(() => registerSgNodeV2({ id: "n1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    const n = activateSgNodeV2("n1");
    expect(n.status).toBe("active");
    expect(n.activatedAt).toBeTruthy();
  });
  test("deactivate active → inactive", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    activateSgNodeV2("n1");
    const n = deactivateSgNodeV2("n1");
    expect(n.status).toBe("inactive");
  });
  test("activate inactive → active (recovery)", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    const before = activateSgNodeV2("n1").activatedAt;
    deactivateSgNodeV2("n1");
    const n = activateSgNodeV2("n1");
    expect(n.activatedAt).toBe(before);
  });
  test("remove from any non-terminal", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    const n = removeSgNodeV2("n1");
    expect(n.status).toBe("removed");
    expect(n.removedAt).toBeTruthy();
  });
  test("terminal no transitions", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    removeSgNodeV2("n1");
    expect(() => activateSgNodeV2("n1")).toThrow();
    expect(() => touchSgNodeV2("n1")).toThrow();
  });
  test("touch updates", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    activateSgNodeV2("n1");
    const n = touchSgNodeV2("n1");
    expect(n.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    expect(getSgNodeV2("n1").id).toBe("n1");
    expect(getSgNodeV2("nope")).toBeNull();
    expect(listSgNodesV2().length).toBe(1);
  });
});

describe("SocialGraph V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveSgNodesPerOwnerV2(2);
    registerSgNodeV2({ id: "n1", owner: "u1" });
    registerSgNodeV2({ id: "n2", owner: "u1" });
    registerSgNodeV2({ id: "n3", owner: "u1" });
    activateSgNodeV2("n1");
    activateSgNodeV2("n2");
    expect(() => activateSgNodeV2("n3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveSgNodesPerOwnerV2(2);
    registerSgNodeV2({ id: "n1", owner: "u1" });
    registerSgNodeV2({ id: "n2", owner: "u1" });
    activateSgNodeV2("n1");
    activateSgNodeV2("n2");
    deactivateSgNodeV2("n1");
    const n = activateSgNodeV2("n1");
    expect(n.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveSgNodesPerOwnerV2(1);
    registerSgNodeV2({ id: "n1", owner: "u1" });
    registerSgNodeV2({ id: "n2", owner: "u2" });
    activateSgNodeV2("n1");
    activateSgNodeV2("n2");
  });
});

describe("SocialGraph V2 edge lifecycle", () => {
  test("create", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    const e = createSgEdgeV2({ id: "e1", nodeId: "n1" });
    expect(e.status).toBe("proposed");
    expect(e.targetId).toBe("");
  });
  test("create with targetId", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    const e = createSgEdgeV2({ id: "e1", nodeId: "n1", targetId: "alice" });
    expect(e.targetId).toBe("alice");
  });
  test("create rejects unknown node/duplicate", () => {
    expect(() => createSgEdgeV2({ id: "e1", nodeId: "nope" })).toThrow();
    registerSgNodeV2({ id: "n1", owner: "u1" });
    createSgEdgeV2({ id: "e1", nodeId: "n1" });
    expect(() => createSgEdgeV2({ id: "e1", nodeId: "n1" })).toThrow();
  });
  test("establish proposed → established", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    createSgEdgeV2({ id: "e1", nodeId: "n1" });
    const e = establishSgEdgeV2("e1");
    expect(e.status).toBe("established");
    expect(e.settledAt).toBeTruthy();
  });
  test("sever established → severed", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    createSgEdgeV2({ id: "e1", nodeId: "n1" });
    establishSgEdgeV2("e1");
    const e = severSgEdgeV2("e1", "split");
    expect(e.status).toBe("severed");
    expect(e.metadata.severReason).toBe("split");
  });
  test("expire established → expired", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    createSgEdgeV2({ id: "e1", nodeId: "n1" });
    establishSgEdgeV2("e1");
    const e = expireSgEdgeV2("e1");
    expect(e.status).toBe("expired");
  });
  test("cancel proposed → cancelled", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    createSgEdgeV2({ id: "e1", nodeId: "n1" });
    const e = cancelSgEdgeV2("e1", "abort");
    expect(e.status).toBe("cancelled");
    expect(e.metadata.cancelReason).toBe("abort");
  });
  test("terminal no transitions", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    createSgEdgeV2({ id: "e1", nodeId: "n1" });
    cancelSgEdgeV2("e1");
    expect(() => establishSgEdgeV2("e1")).toThrow();
  });
  test("get / list", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    createSgEdgeV2({ id: "e1", nodeId: "n1" });
    expect(getSgEdgeV2("e1").id).toBe("e1");
    expect(getSgEdgeV2("nope")).toBeNull();
    expect(listSgEdgesV2().length).toBe(1);
  });
});

describe("SocialGraph V2 pending cap", () => {
  test("enforce at create (proposed only)", () => {
    setMaxPendingSgEdgesPerNodeV2(2);
    registerSgNodeV2({ id: "n1", owner: "u1" });
    createSgEdgeV2({ id: "e1", nodeId: "n1" });
    createSgEdgeV2({ id: "e2", nodeId: "n1" });
    expect(() => createSgEdgeV2({ id: "e3", nodeId: "n1" })).toThrow(
      /max pending/,
    );
  });
  test("established frees slot (only proposed counts)", () => {
    setMaxPendingSgEdgesPerNodeV2(2);
    registerSgNodeV2({ id: "n1", owner: "u1" });
    createSgEdgeV2({ id: "e1", nodeId: "n1" });
    createSgEdgeV2({ id: "e2", nodeId: "n1" });
    establishSgEdgeV2("e1");
    createSgEdgeV2({ id: "e3", nodeId: "n1" });
  });
});

describe("SocialGraph V2 auto flips", () => {
  test("autoDeactivateIdleSgNodesV2", () => {
    setSgNodeIdleMsV2(100);
    registerSgNodeV2({ id: "n1", owner: "u1" });
    activateSgNodeV2("n1");
    const { count } = autoDeactivateIdleSgNodesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getSgNodeV2("n1").status).toBe("inactive");
  });
  test("autoExpireStaleSgEdgesV2", () => {
    setSgEdgeStuckMsV2(100);
    registerSgNodeV2({ id: "n1", owner: "u1" });
    createSgEdgeV2({ id: "e1", nodeId: "n1" });
    const { count } = autoExpireStaleSgEdgesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getSgEdgeV2("e1").status).toBe("cancelled");
    expect(getSgEdgeV2("e1").metadata.cancelReason).toBe("auto-cancel-stale");
  });
});

describe("SocialGraph V2 stats", () => {
  test("empty defaults", () => {
    const s = getSocialGraphGovStatsV2();
    expect(s.totalSgNodesV2).toBe(0);
    expect(s.totalSgEdgesV2).toBe(0);
    for (const k of ["pending", "active", "inactive", "removed"])
      expect(s.nodesByStatus[k]).toBe(0);
    for (const k of [
      "proposed",
      "established",
      "severed",
      "expired",
      "cancelled",
    ])
      expect(s.edgesByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerSgNodeV2({ id: "n1", owner: "u1" });
    activateSgNodeV2("n1");
    createSgEdgeV2({ id: "e1", nodeId: "n1" });
    establishSgEdgeV2("e1");
    const s = getSocialGraphGovStatsV2();
    expect(s.nodesByStatus.active).toBe(1);
    expect(s.edgesByStatus.established).toBe(1);
  });
});
