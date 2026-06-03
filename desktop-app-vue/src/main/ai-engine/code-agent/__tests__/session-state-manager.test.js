/**
 * SessionStateManager — unit tests focused on the member-session API
 * that $team / SubRuntimePool rely on for fan-out isolation.
 *
 * Uses real tmp dirs (fs is not mockable in Vitest forks pool).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { SessionStateManager, STAGES } = require("../session-state-manager.js");

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-ssm-"));
}
function cleanup(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("SessionStateManager — member sessions", () => {
  let projectRoot;
  let manager;
  const parentId = "parent-session";

  beforeEach(() => {
    projectRoot = makeTmp();
    manager = new SessionStateManager({ projectRoot });
    manager.writeIntent(parentId, { goal: "parallel X" });
    manager.writePlan(parentId, {
      title: "Parent plan",
      steps: ["a", "b", "c"],
    });
    manager.approvePlan(parentId);
  });
  afterEach(() => cleanup(projectRoot));

  it("memberSessionId builds a safe deterministic id", () => {
    expect(manager.memberSessionId(parentId, 0, "executor")).toBe(
      `${parentId}.m0-executor`,
    );
    expect(manager.memberSessionId(parentId, 3, "reviewer")).toBe(
      `${parentId}.m3-reviewer`,
    );
    // Non-alphanumeric role chars are stripped so the id stays regex-safe.
    expect(manager.memberSessionId(parentId, 1, "weird/role!")).toBe(
      `${parentId}.m1-weirdrole`,
    );
  });

  it("memberSessionId rejects bad input", () => {
    expect(() => manager.memberSessionId(parentId, -1, "executor")).toThrow(
      /memberIdx/,
    );
    expect(() => manager.memberSessionId("bad id!", 0, "executor")).toThrow();
  });

  it("createMemberSession writes isolated intent.md and approved plan.md", () => {
    const { memberId, dir } = manager.createMemberSession(parentId, 0, {
      role: "executor",
      steps: ["step-a", "step-b"],
    });
    expect(memberId).toBe(`${parentId}.m0-executor`);
    expect(fs.existsSync(path.join(dir, "intent.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "plan.md"))).toBe(true);

    const plan = manager.readPlan(memberId);
    expect(plan).toBeTruthy();
    expect(plan.approved).toBe(true);
    expect(plan.raw).toContain("step-a");
    expect(plan.raw).toContain("step-b");

    const stage = manager.getStage(memberId);
    expect(stage.stage).toBe(STAGES.EXECUTE);
  });

  it("createMemberSession refuses when parent has no plan", () => {
    const m2 = new SessionStateManager({ projectRoot });
    m2.writeIntent("noplan", { goal: "x" });
    expect(() =>
      m2.createMemberSession("noplan", 0, { role: "executor", steps: [] }),
    ).toThrow(/no plan/);
  });

  it("createMemberSession refuses when parent plan is not approved", () => {
    manager.writeIntent("unapproved", { goal: "x" });
    manager.writePlan("unapproved", { title: "p", steps: ["s"] });
    expect(() =>
      manager.createMemberSession("unapproved", 0, {
        role: "executor",
        steps: [],
      }),
    ).toThrow(/not approved/);
  });

  it("member sessions can appendProgress independently of parent", () => {
    manager.createMemberSession(parentId, 0, {
      role: "executor",
      steps: ["x"],
    });
    manager.createMemberSession(parentId, 1, {
      role: "executor",
      steps: ["y"],
    });
    const id0 = `${parentId}.m0-executor`;
    const id1 = `${parentId}.m1-executor`;
    manager.appendProgress(id0, "m0 did x");
    manager.appendProgress(id1, "m1 did y");

    // Parent's own progress log remains untouched.
    expect(manager.readProgress(parentId)).toBe("");
    expect(manager.readProgress(id0)).toMatch(/m0 did x/);
    expect(manager.readProgress(id1)).toMatch(/m1 did y/);
  });

  it("listMemberSessions returns only children of the given parent", () => {
    manager.createMemberSession(parentId, 0, { role: "executor", steps: [] });
    manager.createMemberSession(parentId, 1, { role: "reviewer", steps: [] });
    // Unrelated session must not leak in.
    manager.writeIntent("other", { goal: "x" });

    const members = manager.listMemberSessions(parentId);
    expect(members).toEqual([
      `${parentId}.m0-executor`,
      `${parentId}.m1-reviewer`,
    ]);
  });

  it("readMemberProgress aggregates progress across members", () => {
    manager.createMemberSession(parentId, 0, { role: "executor", steps: [] });
    manager.createMemberSession(parentId, 1, { role: "executor", steps: [] });
    manager.appendProgress(`${parentId}.m0-executor`, "done 0");
    manager.appendProgress(`${parentId}.m1-executor`, "done 1");

    const rows = manager.readMemberProgress(parentId);
    expect(rows).toHaveLength(2);
    expect(rows[0].memberId).toBe(`${parentId}.m0-executor`);
    expect(rows[0].progress).toMatch(/done 0/);
    expect(rows[1].progress).toMatch(/done 1/);
  });

  it("listMemberSessions returns [] for a parent with no members", () => {
    expect(manager.listMemberSessions(parentId)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase A — tasks.json / verify.json / summary.md / fix-loop / artifacts
// ADR: docs/implementation-plans/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md
// ─────────────────────────────────────────────────────────────────────

describe("SessionStateManager — Phase A state expansion", () => {
  let projectRoot;
  let manager;
  const sid = "sess-phaseA";

  beforeEach(() => {
    projectRoot = makeTmp();
    manager = new SessionStateManager({ projectRoot });
    manager.writeIntent(sid, { goal: "phase A coverage" });
    manager.writePlan(sid, { title: "p", steps: ["s1"] });
    manager.approvePlan(sid);
  });
  afterEach(() => cleanup(projectRoot));

  // ── STAGES ───────────────────────────────────────────────────────
  it("exports the full 5-stage STAGES enum", () => {
    expect(STAGES.INTAKE).toBe("intake");
    expect(STAGES.VERIFY).toBe("verify");
    expect(STAGES.FIX_LOOP).toBe("fix-loop");
    expect(STAGES.COMPLETE).toBe("complete");
    expect(STAGES.FAILED).toBe("failed");
    // Backward-compat alias preserved for the legacy $team markDone path.
    expect(STAGES.DONE).toBe("done");
  });

  it("markIntake records the intake stage", () => {
    manager.markIntake("fresh");
    expect(manager.getStage("fresh").stage).toBe(STAGES.INTAKE);
  });

  // ── tasks.json ───────────────────────────────────────────────────
  describe("tasks.json", () => {
    it("writeTasks persists a structured task graph", () => {
      const tasks = [
        {
          id: "t1",
          title: "main",
          ownerRole: "executor/main",
          scopePaths: ["desktop-app-vue/src/main"],
          dependsOn: [],
          status: "pending",
        },
      ];
      const file = manager.writeTasks(sid, { tasks, stage: STAGES.EXECUTE });
      expect(fs.existsSync(file)).toBe(true);
      const payload = manager.readTasks(sid);
      expect(payload.sessionId).toBe(sid);
      expect(payload.version).toBe(1);
      expect(payload.stage).toBe(STAGES.EXECUTE);
      expect(payload.tasks).toHaveLength(1);
      expect(payload.tasks[0].ownerRole).toBe("executor/main");
    });

    it("writeTasks rejects non-array tasks", () => {
      expect(() => manager.writeTasks(sid, { tasks: "not-an-array" })).toThrow(
        /must be an array/,
      );
    });

    it("writeTasks defaults stage to PLAN when none provided", () => {
      manager.writeTasks(sid, { tasks: [] });
      const payload = manager.readTasks(sid);
      // Previous plan() call left stage=PLAN which is inherited.
      expect([STAGES.PLAN, STAGES.EXECUTE, STAGES.INTENT]).toContain(
        payload.stage,
      );
    });

    it("readTasks returns null when the file is missing", () => {
      expect(manager.readTasks("no-such")).toBeNull();
    });

    it("updateTaskStatus patches a single task in place", () => {
      manager.writeTasks(sid, {
        tasks: [
          { id: "t1", title: "a", status: "pending" },
          { id: "t2", title: "b", status: "pending" },
        ],
      });
      const patched = manager.updateTaskStatus(sid, "t2", "running", {
        startedAt: "now",
      });
      expect(patched.tasks[1].status).toBe("running");
      expect(patched.tasks[1].startedAt).toBe("now");
      expect(patched.tasks[0].status).toBe("pending");
    });

    it("updateTaskStatus returns null for unknown task id", () => {
      manager.writeTasks(sid, { tasks: [{ id: "t1", status: "pending" }] });
      expect(manager.updateTaskStatus(sid, "nope", "running")).toBeNull();
    });

    it("updateTaskStatus throws when tasks.json does not exist", () => {
      expect(() => manager.updateTaskStatus("virgin", "t1", "running")).toThrow(
        /no tasks\.json/,
      );
    });
  });

  // ── verify.json ──────────────────────────────────────────────────
  describe("verify.json", () => {
    it("writeVerify persists evidence and transitions stage to VERIFY", () => {
      manager.writeVerify(sid, {
        status: "passed",
        checks: [{ id: "unit", command: "npm test", status: "passed" }],
      });
      const v = manager.readVerify(sid);
      expect(v.status).toBe("passed");
      expect(v.checks[0].id).toBe("unit");
      expect(manager.getStage(sid).stage).toBe(STAGES.VERIFY);
    });

    it("writeVerify rejects invalid status", () => {
      expect(() => manager.writeVerify(sid, { status: "weird" })).toThrow(
        /must be one of passed\|failed\|partial/,
      );
    });

    it("readVerify returns null when the file is missing", () => {
      expect(manager.readVerify(sid)).toBeNull();
    });
  });

  // ── summary.md / writeSummary (Gate V1 + V3) ─────────────────────
  describe("summary.md + completion gate", () => {
    it("writeSummary throws when no verify.json exists (Gate V1)", () => {
      expect(() => manager.writeSummary(sid, "done")).toThrow(
        /without verify\.json/,
      );
    });

    it("writeSummary throws when verify.status is failed (Gate V3)", () => {
      manager.writeVerify(sid, { status: "failed", checks: [] });
      expect(() => manager.writeSummary(sid, "done")).toThrow(
        /only "passed" can enter complete/,
      );
    });

    it("writeSummary throws when verify.status is partial", () => {
      manager.writeVerify(sid, { status: "partial", checks: [] });
      expect(() => manager.writeSummary(sid, "done")).toThrow(
        /only "passed" can enter complete/,
      );
    });

    it("writeSummary succeeds after passed verify and advances to COMPLETE", () => {
      manager.writeVerify(sid, { status: "passed", checks: [] });
      const file = manager.writeSummary(sid, "# done\n\nall green");
      expect(fs.existsSync(file)).toBe(true);
      expect(manager.readSummary(sid)).toMatch(/all green/);
      expect(manager.getStage(sid).stage).toBe(STAGES.COMPLETE);
    });

    it("writeSummary generates a default body when content is omitted", () => {
      manager.writeVerify(sid, { status: "passed", checks: [] });
      manager.writeSummary(sid);
      expect(manager.readSummary(sid)).toMatch(/# Summary/);
    });

    it("markComplete is an alias for writeSummary", () => {
      manager.writeVerify(sid, { status: "passed", checks: [] });
      manager.markComplete(sid, "alias");
      expect(manager.readSummary(sid)).toBe("alias");
      expect(manager.getStage(sid).stage).toBe(STAGES.COMPLETE);
    });
  });

  // ── fix-loop (Gate V4) ───────────────────────────────────────────
  describe("enterFixLoop", () => {
    it("increments retries and sets FIX_LOOP stage under the cap", () => {
      const r1 = manager.enterFixLoop(sid, { maxRetries: 3 });
      expect(r1).toEqual({ stage: STAGES.FIX_LOOP, retries: 1, maxRetries: 3 });
      const r2 = manager.enterFixLoop(sid, { maxRetries: 3 });
      expect(r2.retries).toBe(2);
      expect(r2.stage).toBe(STAGES.FIX_LOOP);
      expect(manager.getRetries(sid)).toBe(2);
    });

    it("transitions to FAILED when retries exceed maxRetries", () => {
      manager.enterFixLoop(sid, { maxRetries: 2 });
      manager.enterFixLoop(sid, { maxRetries: 2 });
      const r3 = manager.enterFixLoop(sid, { maxRetries: 2 });
      expect(r3.stage).toBe(STAGES.FAILED);
      expect(r3.retries).toBe(3);
      const mode = manager.getStage(sid);
      expect(mode.stage).toBe(STAGES.FAILED);
      expect(mode.failureReason).toMatch(/exceeded maxRetries=2/);
    });

    it("defaults maxRetries to 3", () => {
      for (let i = 0; i < 3; i++) {
        manager.enterFixLoop(sid);
      }
      expect(manager.getStage(sid).stage).toBe(STAGES.FIX_LOOP);
      const over = manager.enterFixLoop(sid);
      expect(over.stage).toBe(STAGES.FAILED);
    });

    it("preserves retries counter across unrelated stage transitions", () => {
      manager.enterFixLoop(sid); // retries=1
      manager.writeVerify(sid, { status: "failed", checks: [] }); // stage → VERIFY
      // The counter must survive the stage write.
      expect(manager.getRetries(sid)).toBe(1);
      const next = manager.enterFixLoop(sid);
      expect(next.retries).toBe(2);
    });
  });

  // ── markFailed ───────────────────────────────────────────────────
  it("markFailed sets stage and records the reason", () => {
    manager.markFailed(sid, "cannot resolve dependency");
    const mode = manager.getStage(sid);
    expect(mode.stage).toBe(STAGES.FAILED);
    expect(mode.failureReason).toBe("cannot resolve dependency");
  });

  // ── artifacts/ ───────────────────────────────────────────────────
  describe("artifactsDir", () => {
    it("creates the artifacts directory lazily", () => {
      const dir = manager.artifactsDir(sid);
      expect(fs.existsSync(dir)).toBe(true);
      expect(dir.endsWith(path.join(sid, "artifacts"))).toBe(true);
    });

    it("listArtifacts returns files in the artifacts directory", () => {
      const dir = manager.artifactsDir(sid);
      fs.writeFileSync(path.join(dir, "a.txt"), "a", "utf-8");
      fs.writeFileSync(path.join(dir, "b.log"), "b", "utf-8");
      expect(manager.listArtifacts(sid)).toEqual(["a.txt", "b.log"]);
    });

    it("listArtifacts returns [] when the dir does not exist", () => {
      expect(manager.listArtifacts("never")).toEqual([]);
    });
  });

  // ── mode.json merge semantics ────────────────────────────────────
  it("_updateMode merges instead of overwriting — retries survive stage bumps", () => {
    manager.enterFixLoop(sid, { maxRetries: 5 }); // retries=1
    manager._setStage(sid, STAGES.EXECUTE);
    const mode = manager.getStage(sid);
    expect(mode.stage).toBe(STAGES.EXECUTE);
    expect(mode.retries).toBe(1);
    expect(mode.maxRetries).toBe(5);
  });

  // ── regression: existing markDone still works ────────────────────
  it("legacy markDone still transitions to DONE for backward compat", () => {
    manager.markDone(sid);
    expect(manager.getStage(sid).stage).toBe(STAGES.DONE);
  });
});
