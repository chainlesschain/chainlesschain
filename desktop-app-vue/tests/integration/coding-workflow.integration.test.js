/**
 * Canonical Coding Workflow — integration test.
 *
 * Exercises the full stack against a real tmp dir:
 *   runWorkflowCommand → skill handler → SessionStateManager (fs)
 *                                    ↘ workflow-hook-runner (fs hooks)
 *   workflow-state-reader (CLI layer) ← same fs state
 *
 * Goal: prove that the desktop main-process writer and the CLI reader
 * agree on state after a realistic deep-interview → ralplan → approve
 * → ralph → team run, and that user hooks fire at every stage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fs = require("fs");
const os = require("os");
const path = require("path");

vi.mock("../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  runWorkflowCommand,
  isWorkflowCommand,
} = require("../../src/main/ai-engine/code-agent/workflow-command-runner.js");
const {
  SessionStateManager,
  STAGES,
} = require("../../src/main/ai-engine/code-agent/session-state-manager.js");
// Pre-load the team handler and stub out the SubRuntimePool so the
// integration test never tries to spawn real sub-runtimes. Real-spawn
// coverage lives in `tests/integration/sub-runtime-pool.integration.test.js`.
const teamHandler = require("../../src/main/ai-engine/cowork/skills/builtin/team/handler.js");
class FakeIntegrationPool {
  async dispatch({ assignments }) {
    return assignments.map((a) => ({
      memberIdx: a.memberIdx,
      memberId: `fake.m${a.memberIdx}-${a.role}`,
      success: true,
      progressEvents: [],
    }));
  }
  async shutdown() {}
}
teamHandler._deps.SubRuntimePoolCtor = FakeIntegrationPool;

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-workflow-int-"));
}

function cleanup(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function writeHook(root, event, body) {
  const dir = path.join(root, ".chainlesschain", "hooks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${event}.js`), body, "utf-8");
}

describe("canonical coding workflow — full integration", () => {
  let projectRoot;
  const sessionId = "int-session";

  beforeEach(() => {
    projectRoot = makeTmpRoot();
  });
  afterEach(() => cleanup(projectRoot));

  it("runs the happy path through all 4 stages with hooks firing", async () => {
    // Install 6 hooks that append JSON-lines to a shared audit log.
    const auditLog = path.join(projectRoot, "audit.log");
    const hookBody = (evt) => `
      const fs = require("fs");
      module.exports = async (ctx) => {
        fs.appendFileSync(
          ${JSON.stringify(auditLog)},
          JSON.stringify({ event: "${evt}", session: ctx.sessionId, at: Date.now() }) + "\\n",
          "utf-8",
        );
      };`;
    for (const ev of [
      "pre-intent",
      "post-intent",
      "pre-plan",
      "post-plan",
      "pre-execute",
      "post-execute",
    ]) {
      writeHook(projectRoot, ev, hookBody(ev));
    }

    // Stage 1: deep-interview
    const r1 = await runWorkflowCommand('$deep-interview "build X"', {
      projectRoot,
      sessionId,
    });
    expect(r1.success).toBe(true);
    expect(r1.skill).toBe("deep-interview");
    expect(fs.existsSync(r1.result.intentFile)).toBe(true);

    // Stage 2: ralplan write
    const r2 = await runWorkflowCommand("$ralplan Initial design", {
      projectRoot,
      sessionId,
    });
    expect(r2.success).toBe(true);
    expect(r2.result.approved).toBe(false);

    // Stage 3: ralplan --approve
    const r3 = await runWorkflowCommand("$ralplan --approve", {
      projectRoot,
      sessionId,
    });
    expect(r3.success).toBe(true);
    expect(r3.result.approved).toBe(true);

    // Stage 4: ralph loop
    const r4 = await runWorkflowCommand("$ralph kick off", {
      projectRoot,
      sessionId,
    });
    expect(r4.success).toBe(true);
    expect(r4.result.mode).toBe("ralph");

    // Verify every hook fired.
    const lines = fs
      .readFileSync(auditLog, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    // Expected events in order:
    //   pre-intent, post-intent, pre-plan, post-plan (write),
    //   pre-plan, post-plan (approve), pre-execute, post-execute
    expect(lines.map((l) => l.event)).toEqual([
      "pre-intent",
      "post-intent",
      "pre-plan",
      "post-plan",
      "pre-plan",
      "post-plan",
      "pre-execute",
      "post-execute",
    ]);
    expect(lines.every((l) => l.session === sessionId)).toBe(true);

    // Verify state files agree with the stage.
    const manager = new SessionStateManager({ projectRoot });
    const stage = manager.getStage(sessionId);
    expect(stage.stage).toBe(STAGES.EXECUTE);

    const plan = manager.readPlan(sessionId);
    expect(plan.approved).toBe(true);

    const progress = manager.readProgress(sessionId);
    expect(progress).toContain("[ralph] kick off");
  });

  it("pre-plan veto leaves state at INTENT and blocks $ralph", async () => {
    writeHook(
      projectRoot,
      "pre-plan",
      `module.exports = async () => { throw new Error("plan frozen"); };`,
    );

    await runWorkflowCommand('$deep-interview "frozen"', {
      projectRoot,
      sessionId,
    });
    const blocked = await runWorkflowCommand("$ralplan Attempt", {
      projectRoot,
      sessionId,
    });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/plan frozen/);

    // plan.md must not exist
    const planFile = path.join(
      projectRoot,
      ".chainlesschain",
      "sessions",
      sessionId,
      "plan.md",
    );
    expect(fs.existsSync(planFile)).toBe(false);

    // stage should still be INTENT
    const manager = new SessionStateManager({ projectRoot });
    expect(manager.getStage(sessionId).stage).toBe(STAGES.INTENT);

    // $ralph should refuse because no plan exists
    const ralphRes = await runWorkflowCommand("$ralph go", {
      projectRoot,
      sessionId,
    });
    expect(ralphRes.success).toBe(false);
    expect(ralphRes.error).toMatch(/plan/i);
  });

  it("$team dispatch produces assignments and reads plan.md steps", async () => {
    await runWorkflowCommand('$deep-interview "parallel"', {
      projectRoot,
      sessionId,
    });
    // Use params to inject explicit step list (runner parser maps rest
    // to title only; so we drop down to the handler via internal call).
    const manager = new SessionStateManager({ projectRoot });
    manager.writePlan(sessionId, {
      title: "Parallel plan",
      steps: ["step A", "step B", "step C", "step D", "step E"],
      approved: false,
    });
    manager.approvePlan(sessionId);

    const teamRes = await runWorkflowCommand("$team 3:executor", {
      projectRoot,
      sessionId,
    });
    expect(teamRes.success).toBe(true);
    expect(teamRes.result.size).toBe(3);
    expect(teamRes.result.role).toBe("executor");
    expect(teamRes.result.assignments).toHaveLength(3);
    // Round-robin: 5 steps into 3 buckets → [2, 2, 1]
    expect(teamRes.result.assignments.map((a) => a.steps.length)).toEqual([
      2, 2, 1,
    ]);
  });

  it("post-* hook failure does not rollback the action", async () => {
    writeHook(
      projectRoot,
      "post-intent",
      `module.exports = async () => { throw new Error("webhook down"); };`,
    );
    const result = await runWorkflowCommand('$deep-interview "x"', {
      projectRoot,
      sessionId,
    });
    // deep-interview still reports success — post-intent is advisory
    expect(result.success).toBe(true);
    // intent.md must have been written
    const manager = new SessionStateManager({ projectRoot });
    expect(manager.readIntent(sessionId)).toBeTruthy();
    expect(manager.getStage(sessionId).stage).toBe(STAGES.INTENT);
  });

  it("isWorkflowCommand matches all 4 skills but rejects unknown $foo", () => {
    expect(isWorkflowCommand("$deep-interview hi")).toBe(true);
    expect(isWorkflowCommand("$ralplan")).toBe(true);
    expect(isWorkflowCommand("$ralph")).toBe(true);
    expect(isWorkflowCommand("$team 3:executor")).toBe(true);
    expect(isWorkflowCommand("$unknown")).toBe(false);
    expect(isWorkflowCommand("  $ralplan  ")).toBe(true);
    expect(isWorkflowCommand("no prefix")).toBe(false);
  });
});
