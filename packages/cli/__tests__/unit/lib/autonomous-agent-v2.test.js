import { describe, test, expect, beforeEach } from "vitest";
import {
  AUTOAGENT_MATURITY_V2,
  AUTOAGENT_RUN_LIFECYCLE_V2,
  setMaxActiveAutoAgentsPerOwnerV2,
  getMaxActiveAutoAgentsPerOwnerV2,
  setMaxPendingAutoAgentRunsPerAgentV2,
  getMaxPendingAutoAgentRunsPerAgentV2,
  setAutoAgentIdleMsV2,
  getAutoAgentIdleMsV2,
  setAutoAgentRunStuckMsV2,
  getAutoAgentRunStuckMsV2,
  _resetStateAutonomousAgentV2,
  registerAutoAgentV2,
  activateAutoAgentV2,
  pauseAutoAgentV2,
  archiveAutoAgentV2,
  touchAutoAgentV2,
  getAutoAgentV2,
  listAutoAgentsV2,
  createAutoAgentRunV2,
  startAutoAgentRunV2,
  completeAutoAgentRunV2,
  failAutoAgentRunV2,
  cancelAutoAgentRunV2,
  getAutoAgentRunV2,
  listAutoAgentRunsV2,
  autoPauseIdleAutoAgentsV2,
  autoFailStuckAutoAgentRunsV2,
  getAutonomousAgentGovStatsV2,
} from "../../../src/lib/autonomous-agent.js";

beforeEach(() => {
  _resetStateAutonomousAgentV2();
});

describe("AutoAgent V2 enums", () => {
  test("maturity", () => {
    expect(AUTOAGENT_MATURITY_V2.PENDING).toBe("pending");
    expect(AUTOAGENT_MATURITY_V2.ACTIVE).toBe("active");
    expect(AUTOAGENT_MATURITY_V2.PAUSED).toBe("paused");
    expect(AUTOAGENT_MATURITY_V2.ARCHIVED).toBe("archived");
  });
  test("run lifecycle", () => {
    expect(AUTOAGENT_RUN_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(AUTOAGENT_RUN_LIFECYCLE_V2.RUNNING).toBe("running");
    expect(AUTOAGENT_RUN_LIFECYCLE_V2.COMPLETED).toBe("completed");
    expect(AUTOAGENT_RUN_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(AUTOAGENT_RUN_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(AUTOAGENT_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(AUTOAGENT_RUN_LIFECYCLE_V2)).toBe(true);
  });
});

describe("AutoAgent V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveAutoAgentsPerOwnerV2()).toBe(5);
    expect(getMaxPendingAutoAgentRunsPerAgentV2()).toBe(10);
    expect(getAutoAgentIdleMsV2()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(getAutoAgentRunStuckMsV2()).toBe(30 * 60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveAutoAgentsPerOwnerV2(3);
    expect(getMaxActiveAutoAgentsPerOwnerV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingAutoAgentRunsPerAgentV2(5);
    expect(getMaxPendingAutoAgentRunsPerAgentV2()).toBe(5);
  });
  test("set idle ms", () => {
    setAutoAgentIdleMsV2(100);
    expect(getAutoAgentIdleMsV2()).toBe(100);
  });
  test("set stuck ms", () => {
    setAutoAgentRunStuckMsV2(50);
    expect(getAutoAgentRunStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveAutoAgentsPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveAutoAgentsPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveAutoAgentsPerOwnerV2(3.9);
    expect(getMaxActiveAutoAgentsPerOwnerV2()).toBe(3);
  });
});

describe("AutoAgent V2 agent lifecycle", () => {
  test("register", () => {
    const a = registerAutoAgentV2({ id: "a1", owner: "u1" });
    expect(a.status).toBe("pending");
    expect(a.goal).toBe("");
  });
  test("register with goal", () => {
    const a = registerAutoAgentV2({ id: "a1", owner: "u1", goal: "research" });
    expect(a.goal).toBe("research");
  });
  test("register reject duplicate", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    expect(() => registerAutoAgentV2({ id: "a1", owner: "u1" })).toThrow();
  });
  test("register reject missing id", () => {
    expect(() => registerAutoAgentV2({ owner: "u1" })).toThrow();
  });
  test("register reject missing owner", () => {
    expect(() => registerAutoAgentV2({ id: "a1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    const a = activateAutoAgentV2("a1");
    expect(a.status).toBe("active");
    expect(a.activatedAt).toBeTruthy();
  });
  test("pause active → paused", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    activateAutoAgentV2("a1");
    const a = pauseAutoAgentV2("a1");
    expect(a.status).toBe("paused");
  });
  test("activate paused → active (recovery)", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    const before = activateAutoAgentV2("a1").activatedAt;
    pauseAutoAgentV2("a1");
    const a = activateAutoAgentV2("a1");
    expect(a.status).toBe("active");
    expect(a.activatedAt).toBe(before);
  });
  test("archive from active", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    activateAutoAgentV2("a1");
    const a = archiveAutoAgentV2("a1");
    expect(a.status).toBe("archived");
    expect(a.archivedAt).toBeTruthy();
  });
  test("archive from pending", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    const a = archiveAutoAgentV2("a1");
    expect(a.status).toBe("archived");
  });
  test("terminal no transitions", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    archiveAutoAgentV2("a1");
    expect(() => activateAutoAgentV2("a1")).toThrow();
    expect(() => pauseAutoAgentV2("a1")).toThrow();
  });
  test("touch terminal throws", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    archiveAutoAgentV2("a1");
    expect(() => touchAutoAgentV2("a1")).toThrow();
  });
  test("touch updates", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    activateAutoAgentV2("a1");
    const a = touchAutoAgentV2("a1");
    expect(a.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    expect(getAutoAgentV2("a1").id).toBe("a1");
    expect(getAutoAgentV2("nope")).toBeNull();
    expect(listAutoAgentsV2().length).toBe(1);
  });
});

describe("AutoAgent V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveAutoAgentsPerOwnerV2(2);
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    registerAutoAgentV2({ id: "a2", owner: "u1" });
    registerAutoAgentV2({ id: "a3", owner: "u1" });
    activateAutoAgentV2("a1");
    activateAutoAgentV2("a2");
    expect(() => activateAutoAgentV2("a3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveAutoAgentsPerOwnerV2(2);
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    registerAutoAgentV2({ id: "a2", owner: "u1" });
    activateAutoAgentV2("a1");
    activateAutoAgentV2("a2");
    pauseAutoAgentV2("a1");
    const a = activateAutoAgentV2("a1");
    expect(a.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveAutoAgentsPerOwnerV2(1);
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    registerAutoAgentV2({ id: "a2", owner: "u2" });
    activateAutoAgentV2("a1");
    activateAutoAgentV2("a2");
  });
});

describe("AutoAgent V2 run lifecycle", () => {
  test("create", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    const r = createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    expect(r.status).toBe("queued");
    expect(r.prompt).toBe("");
  });
  test("create with prompt", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    const r = createAutoAgentRunV2({ id: "r1", agentId: "a1", prompt: "go" });
    expect(r.prompt).toBe("go");
  });
  test("create rejects unknown agent", () => {
    expect(() => createAutoAgentRunV2({ id: "r1", agentId: "nope" })).toThrow();
  });
  test("create rejects duplicate", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    expect(() => createAutoAgentRunV2({ id: "r1", agentId: "a1" })).toThrow();
  });
  test("start queued → running", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    const r = startAutoAgentRunV2("r1");
    expect(r.status).toBe("running");
    expect(r.startedAt).toBeTruthy();
  });
  test("complete running → completed", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    startAutoAgentRunV2("r1");
    const r = completeAutoAgentRunV2("r1");
    expect(r.status).toBe("completed");
    expect(r.settledAt).toBeTruthy();
  });
  test("fail running → failed", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    startAutoAgentRunV2("r1");
    const r = failAutoAgentRunV2("r1", "oops");
    expect(r.status).toBe("failed");
    expect(r.metadata.failReason).toBe("oops");
  });
  test("cancel queued → cancelled", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    const r = cancelAutoAgentRunV2("r1", "abort");
    expect(r.status).toBe("cancelled");
    expect(r.metadata.cancelReason).toBe("abort");
  });
  test("cancel running → cancelled", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    startAutoAgentRunV2("r1");
    const r = cancelAutoAgentRunV2("r1");
    expect(r.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    startAutoAgentRunV2("r1");
    completeAutoAgentRunV2("r1");
    expect(() => failAutoAgentRunV2("r1")).toThrow();
  });
  test("get / list", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    expect(getAutoAgentRunV2("r1").id).toBe("r1");
    expect(getAutoAgentRunV2("nope")).toBeNull();
    expect(listAutoAgentRunsV2().length).toBe(1);
  });
});

describe("AutoAgent V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingAutoAgentRunsPerAgentV2(2);
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    createAutoAgentRunV2({ id: "r2", agentId: "a1" });
    expect(() => createAutoAgentRunV2({ id: "r3", agentId: "a1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingAutoAgentRunsPerAgentV2(2);
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    createAutoAgentRunV2({ id: "r2", agentId: "a1" });
    startAutoAgentRunV2("r1");
    completeAutoAgentRunV2("r1");
    createAutoAgentRunV2({ id: "r3", agentId: "a1" });
  });
  test("per-agent scope", () => {
    setMaxPendingAutoAgentRunsPerAgentV2(1);
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    registerAutoAgentV2({ id: "a2", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    createAutoAgentRunV2({ id: "r2", agentId: "a2" });
  });
});

describe("AutoAgent V2 auto flips", () => {
  test("autoPauseIdleAutoAgentsV2", () => {
    setAutoAgentIdleMsV2(100);
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    activateAutoAgentV2("a1");
    const { count } = autoPauseIdleAutoAgentsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getAutoAgentV2("a1").status).toBe("paused");
  });
  test("autoFailStuckAutoAgentRunsV2", () => {
    setAutoAgentRunStuckMsV2(100);
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    startAutoAgentRunV2("r1");
    const { count } = autoFailStuckAutoAgentRunsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getAutoAgentRunV2("r1").status).toBe("failed");
    expect(getAutoAgentRunV2("r1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("AutoAgent V2 stats", () => {
  test("empty defaults", () => {
    const s = getAutonomousAgentGovStatsV2();
    expect(s.totalAutoAgentsV2).toBe(0);
    expect(s.totalAutoAgentRunsV2).toBe(0);
    for (const k of ["pending", "active", "paused", "archived"])
      expect(s.agentsByStatus[k]).toBe(0);
    for (const k of ["queued", "running", "completed", "failed", "cancelled"])
      expect(s.runsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerAutoAgentV2({ id: "a1", owner: "u1" });
    activateAutoAgentV2("a1");
    createAutoAgentRunV2({ id: "r1", agentId: "a1" });
    startAutoAgentRunV2("r1");
    const s = getAutonomousAgentGovStatsV2();
    expect(s.totalAutoAgentsV2).toBe(1);
    expect(s.totalAutoAgentRunsV2).toBe(1);
    expect(s.agentsByStatus.active).toBe(1);
    expect(s.runsByStatus.running).toBe(1);
  });
});
