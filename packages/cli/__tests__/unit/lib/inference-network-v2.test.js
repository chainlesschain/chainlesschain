import { describe, test, expect, beforeEach } from "vitest";
import {
  INFERENCE_NODE_MATURITY_V2,
  INFERENCE_JOB_LIFECYCLE_V2,
  setMaxActiveInferenceNodesPerOperatorV2,
  getMaxActiveInferenceNodesPerOperatorV2,
  setMaxPendingInferenceJobsPerNodeV2,
  getMaxPendingInferenceJobsPerNodeV2,
  setInferenceNodeIdleMsV2,
  getInferenceNodeIdleMsV2,
  setInferenceJobStuckMsV2,
  getInferenceJobStuckMsV2,
  _resetStateInferenceNetworkV2,
  registerInferenceNodeV2,
  activateInferenceNodeV2,
  degradeInferenceNodeV2,
  decommissionInferenceNodeV2,
  touchInferenceNodeV2,
  getInferenceNodeV2,
  listInferenceNodesV2,
  createInferenceJobV2,
  startInferenceJobV2,
  completeInferenceJobV2,
  failInferenceJobV2,
  cancelInferenceJobV2,
  getInferenceJobV2,
  listInferenceJobsV2,
  autoDegradeIdleInferenceNodesV2,
  autoFailStuckInferenceJobsV2,
  getInferenceNetworkGovStatsV2,
} from "../../../src/lib/inference-network.js";

beforeEach(() => {
  _resetStateInferenceNetworkV2();
});

describe("Inference V2 enums", () => {
  test("node maturity", () => {
    expect(INFERENCE_NODE_MATURITY_V2.PENDING).toBe("pending");
    expect(INFERENCE_NODE_MATURITY_V2.ACTIVE).toBe("active");
    expect(INFERENCE_NODE_MATURITY_V2.DEGRADED).toBe("degraded");
    expect(INFERENCE_NODE_MATURITY_V2.DECOMMISSIONED).toBe("decommissioned");
  });
  test("job lifecycle", () => {
    expect(INFERENCE_JOB_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(INFERENCE_JOB_LIFECYCLE_V2.RUNNING).toBe("running");
    expect(INFERENCE_JOB_LIFECYCLE_V2.COMPLETED).toBe("completed");
    expect(INFERENCE_JOB_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(INFERENCE_JOB_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(INFERENCE_NODE_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(INFERENCE_JOB_LIFECYCLE_V2)).toBe(true);
  });
});

describe("Inference V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveInferenceNodesPerOperatorV2()).toBe(12);
    expect(getMaxPendingInferenceJobsPerNodeV2()).toBe(25);
    expect(getInferenceNodeIdleMsV2()).toBe(24 * 60 * 60 * 1000);
    expect(getInferenceJobStuckMsV2()).toBe(10 * 60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveInferenceNodesPerOperatorV2(3);
    expect(getMaxActiveInferenceNodesPerOperatorV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingInferenceJobsPerNodeV2(4);
    expect(getMaxPendingInferenceJobsPerNodeV2()).toBe(4);
  });
  test("set idle ms", () => {
    setInferenceNodeIdleMsV2(100);
    expect(getInferenceNodeIdleMsV2()).toBe(100);
  });
  test("set stuck ms", () => {
    setInferenceJobStuckMsV2(50);
    expect(getInferenceJobStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveInferenceNodesPerOperatorV2(0)).toThrow();
    expect(() => setMaxActiveInferenceNodesPerOperatorV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveInferenceNodesPerOperatorV2(5.9);
    expect(getMaxActiveInferenceNodesPerOperatorV2()).toBe(5);
  });
});

describe("Inference V2 node lifecycle", () => {
  test("register", () => {
    const n = registerInferenceNodeV2({ id: "n1", operator: "op1" });
    expect(n.status).toBe("pending");
    expect(n.model).toBe("default");
  });
  test("register with model", () => {
    const n = registerInferenceNodeV2({
      id: "n1",
      operator: "op1",
      model: "llama3",
    });
    expect(n.model).toBe("llama3");
  });
  test("register reject duplicate", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    expect(() =>
      registerInferenceNodeV2({ id: "n1", operator: "op1" }),
    ).toThrow();
  });
  test("register reject missing id", () => {
    expect(() => registerInferenceNodeV2({ operator: "op1" })).toThrow();
  });
  test("register reject missing operator", () => {
    expect(() => registerInferenceNodeV2({ id: "n1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    const n = activateInferenceNodeV2("n1");
    expect(n.status).toBe("active");
    expect(n.activatedAt).toBeTruthy();
  });
  test("degrade active → degraded", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    activateInferenceNodeV2("n1");
    const n = degradeInferenceNodeV2("n1");
    expect(n.status).toBe("degraded");
  });
  test("activate degraded → active (recovery)", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    const before = activateInferenceNodeV2("n1").activatedAt;
    degradeInferenceNodeV2("n1");
    const n = activateInferenceNodeV2("n1");
    expect(n.status).toBe("active");
    expect(n.activatedAt).toBe(before);
  });
  test("decommission from active", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    activateInferenceNodeV2("n1");
    const n = decommissionInferenceNodeV2("n1");
    expect(n.status).toBe("decommissioned");
    expect(n.decommissionedAt).toBeTruthy();
  });
  test("decommission from pending", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    const n = decommissionInferenceNodeV2("n1");
    expect(n.status).toBe("decommissioned");
  });
  test("terminal no transitions", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    decommissionInferenceNodeV2("n1");
    expect(() => activateInferenceNodeV2("n1")).toThrow();
    expect(() => degradeInferenceNodeV2("n1")).toThrow();
  });
  test("touch terminal throws", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    decommissionInferenceNodeV2("n1");
    expect(() => touchInferenceNodeV2("n1")).toThrow();
  });
  test("touch updates", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    activateInferenceNodeV2("n1");
    const n = touchInferenceNodeV2("n1");
    expect(n.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    expect(getInferenceNodeV2("n1").id).toBe("n1");
    expect(getInferenceNodeV2("nope")).toBeNull();
    expect(listInferenceNodesV2().length).toBe(1);
  });
});

describe("Inference V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveInferenceNodesPerOperatorV2(2);
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    registerInferenceNodeV2({ id: "n2", operator: "op1" });
    registerInferenceNodeV2({ id: "n3", operator: "op1" });
    activateInferenceNodeV2("n1");
    activateInferenceNodeV2("n2");
    expect(() => activateInferenceNodeV2("n3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveInferenceNodesPerOperatorV2(2);
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    registerInferenceNodeV2({ id: "n2", operator: "op1" });
    activateInferenceNodeV2("n1");
    activateInferenceNodeV2("n2");
    degradeInferenceNodeV2("n1");
    const n = activateInferenceNodeV2("n1");
    expect(n.status).toBe("active");
  });
  test("per-operator scope", () => {
    setMaxActiveInferenceNodesPerOperatorV2(1);
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    registerInferenceNodeV2({ id: "n2", operator: "op2" });
    activateInferenceNodeV2("n1");
    activateInferenceNodeV2("n2");
  });
});

describe("Inference V2 job lifecycle", () => {
  test("create", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    const j = createInferenceJobV2({ id: "j1", nodeId: "n1" });
    expect(j.status).toBe("queued");
    expect(j.prompt).toBe("");
  });
  test("create with prompt", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    const j = createInferenceJobV2({ id: "j1", nodeId: "n1", prompt: "hi" });
    expect(j.prompt).toBe("hi");
  });
  test("create rejects unknown node", () => {
    expect(() => createInferenceJobV2({ id: "j1", nodeId: "nope" })).toThrow();
  });
  test("create rejects duplicate", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    expect(() => createInferenceJobV2({ id: "j1", nodeId: "n1" })).toThrow();
  });
  test("start queued → running", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    const j = startInferenceJobV2("j1");
    expect(j.status).toBe("running");
    expect(j.startedAt).toBeTruthy();
  });
  test("complete running → completed", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    startInferenceJobV2("j1");
    const j = completeInferenceJobV2("j1");
    expect(j.status).toBe("completed");
    expect(j.settledAt).toBeTruthy();
  });
  test("fail running → failed", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    startInferenceJobV2("j1");
    const j = failInferenceJobV2("j1", "oops");
    expect(j.status).toBe("failed");
    expect(j.metadata.failReason).toBe("oops");
  });
  test("cancel queued → cancelled", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    const j = cancelInferenceJobV2("j1", "abort");
    expect(j.status).toBe("cancelled");
    expect(j.metadata.cancelReason).toBe("abort");
  });
  test("cancel running → cancelled", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    startInferenceJobV2("j1");
    const j = cancelInferenceJobV2("j1");
    expect(j.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    startInferenceJobV2("j1");
    completeInferenceJobV2("j1");
    expect(() => failInferenceJobV2("j1")).toThrow();
  });
  test("get / list", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    expect(getInferenceJobV2("j1").id).toBe("j1");
    expect(getInferenceJobV2("nope")).toBeNull();
    expect(listInferenceJobsV2().length).toBe(1);
  });
});

describe("Inference V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingInferenceJobsPerNodeV2(2);
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    createInferenceJobV2({ id: "j2", nodeId: "n1" });
    expect(() => createInferenceJobV2({ id: "j3", nodeId: "n1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingInferenceJobsPerNodeV2(2);
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    createInferenceJobV2({ id: "j2", nodeId: "n1" });
    startInferenceJobV2("j1");
    completeInferenceJobV2("j1");
    createInferenceJobV2({ id: "j3", nodeId: "n1" });
  });
  test("per-node scope", () => {
    setMaxPendingInferenceJobsPerNodeV2(1);
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    registerInferenceNodeV2({ id: "n2", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    createInferenceJobV2({ id: "j2", nodeId: "n2" });
  });
});

describe("Inference V2 auto flips", () => {
  test("autoDegradeIdleInferenceNodesV2", () => {
    setInferenceNodeIdleMsV2(100);
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    activateInferenceNodeV2("n1");
    const { count } = autoDegradeIdleInferenceNodesV2({
      now: Date.now() + 10000,
    });
    expect(count).toBe(1);
    expect(getInferenceNodeV2("n1").status).toBe("degraded");
  });
  test("autoFailStuckInferenceJobsV2", () => {
    setInferenceJobStuckMsV2(100);
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    startInferenceJobV2("j1");
    const { count } = autoFailStuckInferenceJobsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getInferenceJobV2("j1").status).toBe("failed");
    expect(getInferenceJobV2("j1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("Inference V2 stats", () => {
  test("empty defaults", () => {
    const s = getInferenceNetworkGovStatsV2();
    expect(s.totalInferenceNodesV2).toBe(0);
    expect(s.totalInferenceJobsV2).toBe(0);
    for (const k of ["pending", "active", "degraded", "decommissioned"])
      expect(s.nodesByStatus[k]).toBe(0);
    for (const k of ["queued", "running", "completed", "failed", "cancelled"])
      expect(s.jobsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerInferenceNodeV2({ id: "n1", operator: "op1" });
    activateInferenceNodeV2("n1");
    createInferenceJobV2({ id: "j1", nodeId: "n1" });
    startInferenceJobV2("j1");
    const s = getInferenceNetworkGovStatsV2();
    expect(s.totalInferenceNodesV2).toBe(1);
    expect(s.totalInferenceJobsV2).toBe(1);
    expect(s.nodesByStatus.active).toBe(1);
    expect(s.jobsByStatus.running).toBe(1);
  });
});
