/**
 * Canonical coding workflow — SessionStateManager + 4 workflow skills.
 *
 * Uses a real tmp dir (one per test) instead of mocking fs, which is
 * unreliable for CJS modules inlined by Vitest's forks pool.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fs = require("fs");
const os = require("os");
const path = require("path");

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  SessionStateManager,
  STAGES,
} = require("../../code-agent/session-state-manager.js");
const deepInterview = require("../skills/builtin/deep-interview/handler.js");
const ralplan = require("../skills/builtin/ralplan/handler.js");
const ralph = require("../skills/builtin/ralph/handler.js");
const team = require("../skills/builtin/team/handler.js");
const verify = require("../skills/builtin/verify/handler.js");
const complete = require("../skills/builtin/complete/handler.js");

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-workflow-"));
}

function cleanup(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("SessionStateManager", () => {
  let projectRoot;
  let manager;

  beforeEach(() => {
    projectRoot = makeTmpRoot();
    manager = new SessionStateManager({ projectRoot });
  });

  afterEach(() => cleanup(projectRoot));

  it("rejects construction without projectRoot", () => {
    expect(() => new SessionStateManager({})).toThrow(/projectRoot/);
  });

  it("rejects unsafe session IDs", () => {
    expect(() => manager.sessionDir("../evil")).toThrow(/sessionId/);
    expect(() => manager.sessionDir("a b")).toThrow(/sessionId/);
  });

  it("writes intent.md and sets stage=intent", () => {
    const file = manager.writeIntent("s1", {
      goal: "Add OAuth",
      clarifications: ["Which provider?"],
      nonGoals: ["UI redesign"],
    });
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("Add OAuth");
    expect(content).toContain("Which provider?");
    expect(content).toContain("UI redesign");
    expect(manager.getStage("s1").stage).toBe(STAGES.INTENT);
  });

  it("writePlan fails without intent.md", () => {
    expect(() => manager.writePlan("s1", { title: "P", steps: ["a"] })).toThrow(
      /deep-interview first/,
    );
  });

  it("writes plan.md with approved=false by default", () => {
    manager.writeIntent("s1", { goal: "g" });
    const file = manager.writePlan("s1", {
      title: "Test plan",
      steps: ["step one", "step two"],
      tradeoffs: ["perf vs readability"],
    });
    const plan = manager.readPlan("s1");
    expect(plan.approved).toBe(false);
    expect(plan.raw).toContain("step one");
    expect(plan.raw).toContain("perf vs readability");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("approvePlan flips frontmatter to approved=true", () => {
    manager.writeIntent("s1", { goal: "g" });
    manager.writePlan("s1", { title: "T", steps: ["a"] });
    manager.approvePlan("s1");
    expect(manager.readPlan("s1").approved).toBe(true);
  });

  it("appendProgress refuses if plan is not approved", () => {
    manager.writeIntent("s1", { goal: "g" });
    manager.writePlan("s1", { title: "T", steps: ["a"] });
    expect(() => manager.appendProgress("s1", "start")).toThrow(/not approved/);
  });

  it("appendProgress works after approval and sets stage=execute", () => {
    manager.writeIntent("s1", { goal: "g" });
    manager.writePlan("s1", { title: "T", steps: ["a"] });
    manager.approvePlan("s1");
    const file = manager.appendProgress("s1", "first note");
    expect(fs.readFileSync(file, "utf-8")).toContain("first note");
    expect(manager.getStage("s1").stage).toBe(STAGES.EXECUTE);
  });

  it("listSessions returns all session directories", () => {
    manager.writeIntent("alpha", { goal: "a" });
    manager.writeIntent("beta", { goal: "b" });
    const list = manager.listSessions().sort();
    expect(list).toEqual(["alpha", "beta"]);
  });
});

describe("$deep-interview handler", () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = makeTmpRoot();
  });
  afterEach(() => cleanup(projectRoot));

  it("rejects empty goal", async () => {
    const res = await deepInterview.execute({ params: {} }, { projectRoot });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/goal/);
  });

  it("writes intent.md and returns relative path", async () => {
    const res = await deepInterview.execute(
      { params: { goal: "Add OAuth", sessionId: "s1" } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.sessionId).toBe("s1");
    expect(res.result.stage).toBe("intent");
    expect(fs.existsSync(res.result.intentFile)).toBe(true);
  });

  it("auto-generates sessionId when not provided", async () => {
    const res = await deepInterview.execute(
      { params: { goal: "x" } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.sessionId).toMatch(/^session-\d+/);
  });

  it("attaches routingHint suggesting $ralph for single-scope work", async () => {
    const res = await deepInterview.execute(
      {
        params: {
          goal: "fix a typo in README",
          sessionId: "s-hint-ralph",
        },
      },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.routingHint).toBeTruthy();
    expect(res.result.routingHint.decision).toBe("ralph");
    expect(res.message).toMatch(/Routing hint: \$ralph/);
    expect(res.guidance).toMatch(/classifier suggests \$ralph/);
  });

  it("attaches routingHint suggesting $team for multi-scope work", async () => {
    const res = await deepInterview.execute(
      {
        params: {
          goal: "wire main and renderer for new feature",
          sessionId: "s-hint-team",
          scopePaths: [
            "desktop-app-vue/src/main/x.js",
            "desktop-app-vue/src/renderer/y.ts",
          ],
        },
      },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.routingHint.decision).toBe("team");
    expect(res.result.routingHint.scopeCount).toBe(2);
    expect(res.message).toMatch(/Routing hint: \$team/);
  });

  it("persists routingHint onto mode.json", async () => {
    const res = await deepInterview.execute(
      {
        params: {
          goal: "wire main and renderer",
          sessionId: "s-persist",
          scopePaths: [
            "desktop-app-vue/src/main/a.js",
            "desktop-app-vue/src/renderer/b.ts",
          ],
        },
      },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    const manager = new SessionStateManager({ projectRoot });
    const mode = manager.getStage("s-persist");
    expect(mode.routingHint).toBeTruthy();
    expect(mode.routingHint.decision).toBe("team");
    expect(mode.routingHint.scopeCount).toBe(2);
    // stage should still be "intent" — hint persistence must not change it
    expect(mode.stage).toBe("intent");
  });

  it("still succeeds when classifier throws (non-fatal)", async () => {
    const original = deepInterview._deps.classifyIntake;
    deepInterview._deps.classifyIntake = () => {
      throw new Error("boom");
    };
    try {
      const res = await deepInterview.execute(
        { params: { goal: "x", sessionId: "s-hint-fail" } },
        { projectRoot },
      );
      expect(res.success).toBe(true);
      expect(res.result.routingHint).toBeNull();
      expect(res.message).not.toMatch(/Routing hint/);
    } finally {
      deepInterview._deps.classifyIntake = original;
    }
  });
});

describe("$ralplan handler", () => {
  let projectRoot;
  const sessionId = "s1";

  beforeEach(() => {
    projectRoot = makeTmpRoot();
  });
  afterEach(() => cleanup(projectRoot));

  it("refuses to write plan without intent.md", async () => {
    const res = await ralplan.execute(
      { params: { sessionId, title: "T", steps: ["a"] } },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/intent\.md/);
  });

  it("requires sessionId", async () => {
    const res = await ralplan.execute({ params: {} }, { projectRoot });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sessionId/);
  });

  it("writes plan.md with approved=false after intent exists", async () => {
    await deepInterview.execute(
      { params: { goal: "g", sessionId } },
      { projectRoot },
    );
    const res = await ralplan.execute(
      {
        params: {
          sessionId,
          title: "Auth plan",
          steps: ["design", "implement", "test"],
          tradeoffs: ["speed vs safety"],
        },
      },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.approved).toBe(false);
    const plan = fs.readFileSync(res.result.planFile, "utf-8");
    expect(plan).toContain("Auth plan");
    expect(plan).toContain("implement");
  });

  it("approve=true flips the approved flag", async () => {
    await deepInterview.execute(
      { params: { goal: "g", sessionId } },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId, title: "T", steps: ["a"] } },
      { projectRoot },
    );
    const res = await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.approved).toBe(true);
    const mgr = new SessionStateManager({ projectRoot });
    expect(mgr.readPlan(sessionId).approved).toBe(true);
  });
});

describe("$ralph handler", () => {
  let projectRoot;
  const sessionId = "s1";

  beforeEach(async () => {
    projectRoot = makeTmpRoot();
    await deepInterview.execute(
      { params: { goal: "g", sessionId } },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId, title: "T", steps: ["a", "b"] } },
      { projectRoot },
    );
  });
  afterEach(() => cleanup(projectRoot));

  it("refuses when plan is not approved", async () => {
    const res = await ralph.execute(
      { params: { sessionId, note: "start" } },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/approved/);
  });

  it("appends progress after approval", async () => {
    await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
    const res = await ralph.execute(
      { params: { sessionId, note: "started executing" } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.mode).toBe("ralph");
    const log = fs.readFileSync(res.result.progressFile, "utf-8");
    expect(log).toContain("started executing");
    expect(log).toContain("[ralph]");
  });

  it("refuses without sessionId", async () => {
    const res = await ralph.execute({ params: {} }, { projectRoot });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sessionId/);
  });
});

describe("$team handler", () => {
  let projectRoot;
  let originalPoolCtor;
  const sessionId = "s1";

  // Fake pool that fulfills the dispatch contract without spawning anything.
  // Each assignment is reported as a successful member run.
  class FakeSubRuntimePool {
    constructor() {}
    async dispatch({ assignments }) {
      return assignments.map((a) => ({
        memberIdx: a.memberIdx,
        memberId: `${sessionId}.m${a.memberIdx}-${a.role}`,
        // Mirror the real pool's structured contract: propagate taskId so
        // $team can write status back into tasks.json.
        ...(a.taskId ? { taskId: a.taskId } : {}),
        success: true,
        progressEvents: a.steps.map((step, i) => ({
          type: "progress",
          step,
          index: i,
          total: a.steps.length,
        })),
      }));
    }
    async shutdown() {}
  }

  beforeEach(async () => {
    projectRoot = makeTmpRoot();
    originalPoolCtor = team._deps.SubRuntimePoolCtor;
    team._deps.SubRuntimePoolCtor = FakeSubRuntimePool;
    await deepInterview.execute(
      { params: { goal: "g", sessionId } },
      { projectRoot },
    );
    await ralplan.execute(
      {
        params: {
          sessionId,
          title: "T",
          steps: ["alpha", "beta", "gamma", "delta"],
        },
      },
      { projectRoot },
    );
  });
  afterEach(() => {
    team._deps.SubRuntimePoolCtor = originalPoolCtor;
    cleanup(projectRoot);
  });

  it("refuses without approved plan", async () => {
    const res = await team.execute(
      { params: { sessionId, size: 2, role: "executor" } },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/approved/);
  });

  it("parses N:role spec from task.action", async () => {
    await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
    const res = await team.execute(
      { action: "2:executor please dispatch", params: { sessionId } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.size).toBe(2);
    expect(res.result.role).toBe("executor");
    expect(res.result.assignments).toHaveLength(2);
    const allSteps = res.result.assignments.flatMap((a) => a.steps);
    expect(allSteps.sort()).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  it("rejects unknown role", async () => {
    await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
    const res = await team.execute(
      { params: { sessionId, size: 2, role: "wizard" } },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/role/);
  });

  it("caps size to MAX_SIZE=6", async () => {
    await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
    const res = await team.execute(
      { params: { sessionId, size: 99, role: "executor" } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.size).toBe(6);
  });

  it("parseSpec helper handles malformed input", () => {
    expect(team.parseSpec("")).toEqual({});
    expect(team.parseSpec("garbage")).toEqual({});
    expect(team.parseSpec("4:tester rest of the line")).toEqual({
      size: 4,
      role: "tester",
    });
  });

  it("distributeSteps spreads evenly round-robin", () => {
    const buckets = team.distributeSteps(["a", "b", "c", "d", "e"], 3);
    expect(buckets).toEqual([["a", "d"], ["b", "e"], ["c"]]);
  });

  // ── Phase B: structured-task path (tasks.json precedence) ────────
  describe("structured-task path (tasks.json)", () => {
    beforeEach(async () => {
      await ralplan.execute(
        { params: { sessionId, approve: true } },
        { projectRoot },
      );
    });

    it("prefers tasks.json over plan.md step distribution", async () => {
      const mgr = new SessionStateManager({ projectRoot });
      mgr.writeTasks(sessionId, {
        tasks: [
          {
            id: "t1",
            title: "build main",
            ownerRole: "executor/main",
            scopePaths: ["src/a"],
            dependsOn: [],
            status: "pending",
          },
          {
            id: "t2",
            title: "write tests",
            ownerRole: "tester/unit",
            scopePaths: ["src/b"],
            dependsOn: ["t1"],
            doneWhen: ["tests green"],
            status: "pending",
          },
        ],
      });

      const res = await team.execute(
        { params: { sessionId } },
        { projectRoot },
      );
      expect(res.success).toBe(true);
      expect(res.result.mode).toBe("team-structured");
      expect(res.result.structured).toBe(true);
      expect(res.result.taskCount).toBe(2);
      expect(res.result.role).toBe("mixed");
      // Each assignment carries taskId + ownerRole from tasks.json
      const ids = res.result.assignments.map((a) => a.taskId).sort();
      expect(ids).toEqual(["t1", "t2"]);
      const t2 = res.result.assignments.find((a) => a.taskId === "t2");
      expect(t2.ownerRole).toBe("tester/unit");
      expect(t2.role).toBe("tester");
      expect(t2.dependsOn).toEqual(["t1"]);
      // doneWhen entries are surfaced as verify: steps
      expect(t2.steps.some((s) => /verify: tests green/.test(s))).toBe(true);
    });

    it("writes per-task status back into tasks.json after dispatch", async () => {
      const mgr = new SessionStateManager({ projectRoot });
      mgr.writeTasks(sessionId, {
        tasks: [
          { id: "t1", title: "x", ownerRole: "executor", status: "pending" },
        ],
      });
      const res = await team.execute(
        { params: { sessionId } },
        { projectRoot },
      );
      expect(res.success).toBe(true);
      const payload = mgr.readTasks(sessionId);
      expect(payload.tasks[0].status).toBe("completed");
    });

    it("rejects unknown ownerRole base", async () => {
      const mgr = new SessionStateManager({ projectRoot });
      mgr.writeTasks(sessionId, {
        tasks: [
          {
            id: "t1",
            title: "x",
            ownerRole: "wizard/spells",
            status: "pending",
          },
        ],
      });
      const res = await team.execute(
        { params: { sessionId } },
        { projectRoot },
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/wizard/);
    });

    it("falls back to legacy path when tasks.json is empty", async () => {
      const mgr = new SessionStateManager({ projectRoot });
      mgr.writeTasks(sessionId, { tasks: [] });
      const res = await team.execute(
        {
          action: "2:executor",
          params: { sessionId },
        },
        { projectRoot },
      );
      expect(res.success).toBe(true);
      expect(res.result.mode).toBe("team");
      expect(res.result.structured).toBe(false);
    });

    it("buildStructuredAssignments derives base role and ownerRole", () => {
      const out = team.buildStructuredAssignments({
        tasks: [
          {
            id: "t1",
            title: "a",
            ownerRole: "executor/main",
            scopePaths: ["x"],
            dependsOn: [],
          },
          {
            id: "t2",
            title: "b",
            ownerRole: "reviewer",
            scopePaths: [],
            dependsOn: ["t1"],
          },
        ],
      });
      expect(out).toHaveLength(2);
      expect(out[0].role).toBe("executor");
      expect(out[0].ownerRole).toBe("executor/main");
      expect(out[1].role).toBe("reviewer");
      expect(out[1].dependsOn).toEqual(["t1"]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// Phase C — $verify + $complete (canonical workflow gate)
// ─────────────────────────────────────────────────────────────────

describe("$verify handler", () => {
  let projectRoot;
  let originalExecSync;
  const sessionId = "verify-sess";

  // Fake execSync driver: maps command substring → {exitCode, stdout}.
  // On non-zero exitCode we throw the same shape that child_process.execSync
  // throws on failure, so runCheck can extract err.status/stdout/stderr.
  function installFakeExec(map) {
    verify._deps.execSync = vi.fn((cmd) => {
      for (const [substr, outcome] of Object.entries(map)) {
        if (cmd.includes(substr)) {
          if (outcome.exitCode === 0) {
            return outcome.stdout || "";
          }
          const err = new Error(`fake failure: ${cmd}`);
          err.status = outcome.exitCode;
          err.stdout = outcome.stdout || "";
          err.stderr = outcome.stderr || "";
          throw err;
        }
      }
      // Default: pass silently
      return "";
    });
  }

  beforeEach(async () => {
    projectRoot = makeTmpRoot();
    originalExecSync = verify._deps.execSync;
    await deepInterview.execute(
      { params: { goal: "verify goal", sessionId } },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId, title: "T", steps: ["a", "b"] } },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
  });
  afterEach(() => {
    verify._deps.execSync = originalExecSync;
    cleanup(projectRoot);
  });

  it("refuses without sessionId", async () => {
    const res = await verify.execute({ params: {} }, { projectRoot });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sessionId/);
  });

  it("refuses when plan is not approved", async () => {
    await deepInterview.execute(
      { params: { goal: "g", sessionId: "unapproved" } },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId: "unapproved", title: "t", steps: ["s"] } },
      { projectRoot },
    );
    const res = await verify.execute(
      {
        params: {
          sessionId: "unapproved",
          checks: [{ id: "x", command: "echo" }],
        },
      },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/approved/);
  });

  it("writes verify.json with status=passed when all params.checks pass", async () => {
    installFakeExec({ pass: { exitCode: 0, stdout: "ok\n" } });
    const res = await verify.execute(
      {
        params: {
          sessionId,
          checks: [
            { id: "c1", command: "pass 1" },
            { id: "c2", command: "pass 2" },
          ],
        },
      },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.status).toBe("passed");
    expect(res.result.checkSource).toBe("params");
    expect(res.result.nextAction).toBe("complete");
    expect(res.result.checks).toHaveLength(2);
    expect(res.result.checks.every((c) => c.status === "passed")).toBe(true);

    const mgr = new SessionStateManager({ projectRoot });
    const payload = mgr.readVerify(sessionId);
    expect(payload.status).toBe("passed");
    expect(payload.checks).toHaveLength(2);
    expect(mgr.getStage(sessionId).stage).toBe(STAGES.VERIFY);
  });

  it("aggregates to partial when some pass and some fail, and enters fix-loop", async () => {
    installFakeExec({
      ok: { exitCode: 0, stdout: "ok" },
      fail: { exitCode: 1, stderr: "boom" },
    });
    const res = await verify.execute(
      {
        params: {
          sessionId,
          checks: [
            { id: "c-ok", command: "ok one" },
            { id: "c-fail", command: "fail one" },
          ],
        },
      },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.result.status).toBe("partial");
    expect(res.result.nextAction).toBe("fix-loop");
    expect(res.result.fixLoopState.stage).toBe(STAGES.FIX_LOOP);
    expect(res.result.fixLoopState.retries).toBe(1);

    const mgr = new SessionStateManager({ projectRoot });
    expect(mgr.getStage(sessionId).stage).toBe(STAGES.FIX_LOOP);
  });

  it("marks session FAILED when fix-loop retries exceed maxRetries", async () => {
    installFakeExec({ fail: { exitCode: 1, stderr: "nope" } });
    const mgr = new SessionStateManager({ projectRoot });
    // Push retries to the cap ahead of time.
    mgr.enterFixLoop(sessionId, { maxRetries: 2 });
    mgr.enterFixLoop(sessionId, { maxRetries: 2 }); // retries=2

    const res = await verify.execute(
      {
        params: {
          sessionId,
          maxRetries: 2,
          checks: [{ id: "c-fail", command: "fail now" }],
        },
      },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.result.status).toBe("failed");
    expect(res.result.fixLoopState.stage).toBe(STAGES.FAILED);
    expect(mgr.getStage(sessionId).stage).toBe(STAGES.FAILED);
  });

  it("honors autoFixLoop=false by not advancing the retries counter", async () => {
    installFakeExec({ fail: { exitCode: 1 } });
    const res = await verify.execute(
      {
        params: {
          sessionId,
          autoFixLoop: false,
          checks: [{ id: "c", command: "fail me" }],
        },
      },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.result.status).toBe("failed");
    expect(res.result.fixLoopState).toBeNull();
    const mgr = new SessionStateManager({ projectRoot });
    // Still at VERIFY stage because writeVerify sets it, fix-loop was skipped.
    expect(mgr.getStage(sessionId).stage).toBe(STAGES.VERIFY);
    expect(mgr.getRetries(sessionId) || 0).toBe(0);
  });

  it("collects checks from tasks.json verifyCommands when no params.checks", async () => {
    installFakeExec({ pass: { exitCode: 0 } });
    const mgr = new SessionStateManager({ projectRoot });
    mgr.writeTasks(sessionId, {
      tasks: [
        {
          id: "t1",
          title: "x",
          ownerRole: "executor",
          verifyCommands: ["pass first", "pass second"],
        },
        {
          id: "t2",
          title: "y",
          ownerRole: "tester",
          verifyCommands: [{ id: "custom", command: "pass three" }],
        },
      ],
    });
    const res = await verify.execute(
      { params: { sessionId } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.checkSource).toBe("tasks.json");
    expect(res.result.checks).toHaveLength(3);
    expect(res.result.checks.map((c) => c.id)).toContain("custom");
  });

  it("returns passed with no checks when nothing is configured", async () => {
    // Fresh projectRoot with no package.json → no heuristic checks
    const res = await verify.execute(
      { params: { sessionId } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.status).toBe("passed");
    expect(res.result.checks).toEqual([]);
    expect(res.result.checkSource).toBe("none");
  });

  it("detects npm test from package.json as a heuristic check", async () => {
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "p", scripts: { test: "echo t" } }),
      "utf-8",
    );
    installFakeExec({ "npm test": { exitCode: 0, stdout: "1 passed" } });
    const res = await verify.execute(
      { params: { sessionId } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.checkSource).toBe("heuristic");
    expect(res.result.checks[0].id).toBe("npm-test");
  });

  // ── Pure helpers ────────────────────────────────────────────────
  describe("helpers", () => {
    it("normalizeCheck accepts string and object forms", () => {
      expect(verify.normalizeCheck("echo hi", "x")).toMatchObject({
        id: "x",
        command: "echo hi",
      });
      expect(
        verify.normalizeCheck(
          { id: "c1", command: "pytest", timeout: 5000 },
          "fb",
        ),
      ).toEqual({ id: "c1", command: "pytest", timeout: 5000 });
      expect(verify.normalizeCheck("", "x")).toBeNull();
      expect(verify.normalizeCheck(null, "x")).toBeNull();
      expect(verify.normalizeCheck({}, "x")).toBeNull();
    });

    it("aggregateStatus returns passed for empty list", () => {
      expect(verify.aggregateStatus([])).toBe("passed");
    });
    it("aggregateStatus returns failed when all fail", () => {
      expect(
        verify.aggregateStatus([{ status: "failed" }, { status: "failed" }]),
      ).toBe("failed");
    });
    it("aggregateStatus returns partial on mixed results", () => {
      expect(
        verify.aggregateStatus([{ status: "passed" }, { status: "failed" }]),
      ).toBe("partial");
    });
    it("summarizeOutput keeps the tail and truncates", () => {
      const multiline = "line 1\nline 2\nline 3\nheadline result";
      expect(verify.summarizeOutput(multiline)).toContain("headline result");
      expect(verify.summarizeOutput("")).toBe("");
    });
  });
});

describe("$complete handler", () => {
  let projectRoot;
  const sessionId = "complete-sess";

  beforeEach(async () => {
    projectRoot = makeTmpRoot();
    await deepInterview.execute(
      { params: { goal: "g", sessionId } },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId, title: "T", steps: ["a"] } },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
  });
  afterEach(() => cleanup(projectRoot));

  it("refuses without verify.json (Gate V1)", async () => {
    const res = await complete.execute(
      { params: { sessionId, summary: "done" } },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/without verify\.json/);
  });

  it("refuses when verify.status is failed (Gate V3)", async () => {
    const mgr = new SessionStateManager({ projectRoot });
    mgr.writeVerify(sessionId, { status: "failed", checks: [] });
    const res = await complete.execute(
      { params: { sessionId, summary: "nope" } },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/only "passed" can enter complete/);
  });

  it("succeeds after passed verify and transitions to COMPLETE", async () => {
    const mgr = new SessionStateManager({ projectRoot });
    mgr.writeVerify(sessionId, { status: "passed", checks: [] });
    const res = await complete.execute(
      { params: { sessionId, summary: "# done\nall green" } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.stage).toBe("complete");
    expect(mgr.getStage(sessionId).stage).toBe(STAGES.COMPLETE);
    expect(mgr.readSummary(sessionId)).toMatch(/all green/);
  });
});

describe("lifecycle hook integration", () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = makeTmpRoot();
  });

  afterEach(() => {
    cleanup(projectRoot);
  });

  function writeHook(event, body) {
    const dir = path.join(projectRoot, ".chainlesschain", "hooks");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${event}.js`), body, "utf-8");
  }

  it("fires post-intent after $deep-interview writes intent.md", async () => {
    writeHook(
      "post-intent",
      `const fs = require("fs");
       const path = require("path");
       module.exports = async (ctx) => {
         fs.writeFileSync(
           path.join(ctx.projectRoot, "hook-intent.log"),
           ctx.sessionId,
         );
       };`,
    );
    const result = await deepInterview.execute(
      { params: { goal: "test", sessionId: "hooked" } },
      { projectRoot },
    );
    expect(result.success).toBe(true);
    const marker = fs.readFileSync(
      path.join(projectRoot, "hook-intent.log"),
      "utf-8",
    );
    expect(marker).toBe("hooked");
  });

  it("pre-plan veto aborts $ralplan writePlan", async () => {
    await deepInterview.execute(
      { params: { goal: "test", sessionId: "veto" } },
      { projectRoot },
    );
    writeHook(
      "pre-plan",
      `module.exports = async () => { throw new Error("policy: not in business hours"); };`,
    );
    const result = await ralplan.execute(
      { params: { sessionId: "veto", title: "t", steps: ["s1"] } },
      { projectRoot },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in business hours/);
    // plan.md must NOT have been written
    const planFile = path.join(
      projectRoot,
      ".chainlesschain",
      "sessions",
      "veto",
      "plan.md",
    );
    expect(fs.existsSync(planFile)).toBe(false);
  });

  it("pre-execute veto aborts $ralph progress append", async () => {
    await deepInterview.execute(
      { params: { goal: "g", sessionId: "blocked" } },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId: "blocked", title: "t", steps: ["s1"] } },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId: "blocked", approve: true } },
      { projectRoot },
    );
    writeHook(
      "pre-execute",
      `module.exports = async () => { throw new Error("lockdown"); };`,
    );
    const result = await ralph.execute(
      { params: { sessionId: "blocked", note: "start" } },
      { projectRoot },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lockdown/);
    const progressFile = path.join(
      projectRoot,
      ".chainlesschain",
      "sessions",
      "blocked",
      "progress.log",
    );
    expect(fs.existsSync(progressFile)).toBe(false);
  });

  it("pre-execute veto aborts $team dispatch", async () => {
    await deepInterview.execute(
      { params: { goal: "g", sessionId: "teamveto" } },
      { projectRoot },
    );
    await ralplan.execute(
      {
        params: {
          sessionId: "teamveto",
          title: "t",
          steps: ["s1", "s2", "s3"],
        },
      },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId: "teamveto", approve: true } },
      { projectRoot },
    );
    writeHook(
      "pre-execute",
      `module.exports = async () => { throw new Error("team blocked"); };`,
    );
    const result = await team.execute(
      { params: { sessionId: "teamveto", size: 3, role: "executor" } },
      { projectRoot },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/team blocked/);
  });
});
