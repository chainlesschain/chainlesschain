/**
 * quality-gate-manager 单元测试 —— 门禁注册/默认门禁、检查评分与阈值判定、
 * 失败 vs 缺失执行器的均分语义、阻塞标志、override/状态/重置、事件。
 */

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  QualityGateManager,
  GateStatus,
  CHECK_EXECUTORS,
} = require("../quality-gate-manager.js");

let mgr;
beforeEach(() => {
  mgr = new QualityGateManager();
});

describe("QualityGateManager registration", () => {
  it("initializes the six default gates and resolves by id and stage", () => {
    expect(mgr.getGate("gate_1_analysis")).toBeTruthy();
    expect(mgr.getGateByStage("stage_3").id).toBe("gate_3_generation");
    expect(mgr.getGate("nope")).toBeNull();
    expect(mgr.getGateByStage("nope")).toBeNull();
  });

  it("registers a custom gate", () => {
    mgr.registerGate({ id: "g", name: "G", stageId: "s", checks: [], threshold: 0.5 });
    expect(mgr.getGate("g").name).toBe("G");
  });
});

describe("QualityGateManager.check scoring", () => {
  it("passes by default for an unconfigured gate", async () => {
    const r = await mgr.check("ghost", {});
    expect(r).toMatchObject({ passed: true, score: 1, blocking: false });
  });

  it("passes when avg score >= threshold, fails below", async () => {
    mgr.registerGate({
      id: "g_real",
      name: "Real",
      stageId: "s_real",
      checks: ["preview_ready", "export_valid"],
      threshold: 0.75,
      blocking: true,
    });
    const pass = await mgr.check("g_real", { preview: true, export: "/x" });
    expect(pass.score).toBe(1);
    expect(pass.passed).toBe(true);
    expect(pass.blocking).toBe(true);
    expect(pass.passedChecks).toBe(2);

    const fail = await mgr.check("g_real", { preview: true }); // export_valid -> 0
    expect(fail.score).toBe(0.5);
    expect(fail.passed).toBe(false);
  });

  it("can resolve a gate by its stageId", async () => {
    mgr.registerGate({
      id: "g_stage",
      name: "Stage",
      stageId: "stageX",
      checks: ["preview_ready"],
      threshold: 0.5,
    });
    const r = await mgr.check("stageX", { preview: true });
    expect(r.gateId).toBe("g_stage");
    expect(r.passed).toBe(true);
  });

  describe("failed vs missing executor in the average", () => {
    afterEach(() => {
      delete CHECK_EXECUTORS.__throws__;
    });

    it("a throwing check counts as score 0 (drags the average down)", async () => {
      CHECK_EXECUTORS.__throws__ = async () => {
        throw new Error("executor blew up");
      };
      mgr.registerGate({
        id: "g_throw",
        name: "Throw",
        stageId: "s_throw",
        checks: ["preview_ready", "__throws__"],
        threshold: 0.6,
      });
      const r = await mgr.check("g_throw", { preview: true });
      // (1 + 0) / 2 = 0.5  -> below 0.6
      expect(r.score).toBe(0.5);
      expect(r.passed).toBe(false);
      expect(r.totalChecks).toBe(2);
      const failed = r.checks.find((c) => c.checkId === "__throws__");
      expect(failed.passed).toBe(false);
      expect(failed.error).toMatch(/blew up/);
    });

    it("a missing executor is skipped (not counted in the average)", async () => {
      mgr.registerGate({
        id: "g_missing",
        name: "Missing",
        stageId: "s_missing",
        checks: ["preview_ready", "__does_not_exist__"],
        threshold: 0.9,
      });
      const r = await mgr.check("g_missing", { preview: true });
      // only preview_ready counted: 1 / 1 = 1.0
      expect(r.score).toBe(1);
      expect(r.passed).toBe(true);
      expect(r.totalChecks).toBe(1);
    });
  });

  it("emits gate lifecycle events", async () => {
    mgr.registerGate({
      id: "g_ev",
      name: "Ev",
      stageId: "s_ev",
      checks: ["preview_ready"],
      threshold: 0.5,
    });
    const seen = [];
    mgr.on("gate-checking", () => seen.push("checking"));
    mgr.on("check-completed", () => seen.push("check"));
    mgr.on("gate-completed", () => seen.push("done"));
    await mgr.check("g_ev", { preview: true });
    expect(seen).toEqual(["checking", "check", "done"]);
  });
});

describe("QualityGateManager status / override / reset", () => {
  it("override marks a gate skipped; unknown gate returns false", () => {
    expect(mgr.override("gate_1_analysis", "manual")).toBe(true);
    expect(mgr.getAllStatuses().gate_1_analysis.status).toBe(GateStatus.SKIPPED);
    expect(mgr.override("nope")).toBe(false);
  });

  it("getCheckResult returns the stored result after a check", async () => {
    await mgr.check("gate_6_delivery", {
      preview: true,
      export: "/x",
      userConfirmed: true,
    });
    const stored = mgr.getCheckResult("gate_6_delivery");
    expect(stored).toBeTruthy();
    expect(stored.passed).toBe(true); // threshold 1.0, all three checks pass
  });

  it("reset reverts all statuses to pending and clears results", async () => {
    await mgr.check("gate_6_delivery", { preview: true });
    mgr.reset();
    expect(mgr.getAllStatuses().gate_6_delivery.status).toBe(GateStatus.PENDING);
    expect(mgr.getCheckResult("gate_6_delivery")).toBeNull();
  });

  it("resetGate reverts a single gate", async () => {
    await mgr.check("gate_6_delivery", { preview: true });
    mgr.resetGate("gate_6_delivery");
    expect(mgr.getAllStatuses().gate_6_delivery.status).toBe(GateStatus.PENDING);
    expect(mgr.getCheckResult("gate_6_delivery")).toBeNull();
  });
});
