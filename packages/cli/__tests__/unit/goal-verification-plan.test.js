import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseGoalCondition,
  GoalConditionEngine,
} from "../../src/lib/goal-condition-engine.js";
import {
  GOAL_VERIFICATION_SCHEMA,
  prepareGoalVerification,
  evaluateGoalVerification,
} from "../../src/lib/goal-verification-plan.js";

const parent = fs.realpathSync.native(os.tmpdir());
const roots = [];
const checker = `const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const subject = require(path.join(process.cwd(), 'subject.cjs'));
assert.equal(subject.add(2, 3), 5, 'independent arithmetic requirement');
assert.equal(JSON.parse(fs.readFileSync('result.json')).answer, 5, 'required artifact answer');
console.log('independent requirements passed');
`;
const receiptSource = `\nconsole.log('CC_GOAL_CHECK_RESULT ' + JSON.stringify({
  schema: 'chainlesschain.goal-check-result/v1', checkId: process.env.CC_GOAL_CHECK_ID,
  invocationId: process.env.CC_GOAL_CHECK_INVOCATION, requirements: [{id: 'acceptance', passed: true}]
}));\n`;
function fixture({
  script = checker,
  checks,
  artifacts = ["result.json"],
} = {}) {
  const root = fs.mkdtempSync(path.join(parent, "cc-goal-verify-"));
  roots.push(root);
  const cwd = path.join(root, "candidate"),
    acceptance = path.join(root, "acceptance");
  fs.mkdirSync(cwd);
  fs.mkdirSync(acceptance);
  fs.writeFileSync(
    path.join(cwd, "subject.cjs"),
    "exports.add = (a,b) => a+b;\n",
  );
  fs.writeFileSync(path.join(cwd, "result.json"), '{"answer":5}\n');
  const program = path.join(acceptance, "check.cjs"),
    manifestPath = path.join(acceptance, "goal.json");
  fs.writeFileSync(program, script + receiptSource);
  const manifest = {
    schema: GOAL_VERIFICATION_SCHEMA,
    artifacts,
    checks: checks || [
      {
        id: "correctness",
        executable: "node",
        args: [program],
        checkerFiles: ["check.cjs"],
        timeoutMs: 5000,
        requirements: ["acceptance"],
      },
    ],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return {
    root,
    cwd,
    program,
    manifestPath,
    manifest,
    prepare: () =>
      prepareGoalVerification(
        parseGoalCondition(`verify:${manifestPath}`),
        cwd,
      ),
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== parent ||
      !path.basename(root).startsWith("cc-goal-verify-")
    )
      throw Error("unsafe fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("independent Goal acceptance", () => {
  it("executes frozen host checks and binds every passing criterion to source and artifacts", async () => {
    const f = fixture(),
      condition = await f.prepare();
    expect(Object.isFrozen(condition.verification.checks[0].args)).toBe(true);
    const result = await evaluateGoalVerification(condition, { cwd: f.cwd });
    expect(result).toMatchObject({
      met: true,
      evidence: {
        kind: "verification",
        workspaceCurrent: true,
        coverage: { required: 1, executed: 1, passed: 1 },
        checks: [{ id: "correctness", exitCode: 0, status: "passed" }],
      },
    });
    expect(result.evidence.workspace.artifacts[0].artifacts[0].path).toBe(
      "result.json",
    );
    const engine = new GoalConditionEngine({ condition });
    expect(engine.evaluate(result).decision).toBe("complete");
    expect(
      GoalConditionEngine.fromSnapshot(engine.snapshot()).condition,
    ).toEqual(condition);
  });
  it("rejects an incorrect implementation even when the author claims all checks passed", async () => {
    const f = fixture(),
      condition = await f.prepare();
    fs.writeFileSync(
      path.join(f.cwd, "subject.cjs"),
      "exports.add = () => 99; // ALL TESTS PASSED\n",
    );
    const result = await evaluateGoalVerification(condition, { cwd: f.cwd });
    expect(result.met).toBe(false);
    expect(result.evidence.checks[0]).toMatchObject({
      status: "failed",
      exitCode: 1,
    });
    expect(result.evidence.checks[0].stderr.preview).toContain(
      "independent arithmetic requirement",
    );
  });
  it("rejects exit zero when the candidate exits before acceptance assertions and receipt", async () => {
    const f = fixture(),
      condition = await f.prepare();
    fs.writeFileSync(path.join(f.cwd, "subject.cjs"), "process.exit(0);\n");
    const result = await evaluateGoalVerification(condition, { cwd: f.cwd });
    expect(result).toMatchObject({
      met: false,
      evidence: { checks: [{ exitCode: 0, status: "receipt-invalid" }] },
    });
  });
  it("rejects stale, duplicate and incomplete structured checker receipts", async () => {
    const stale = `console.log('CC_GOAL_CHECK_RESULT ' + JSON.stringify({schema:'chainlesschain.goal-check-result/v1',checkId:process.env.CC_GOAL_CHECK_ID,invocationId:'old-invocation',requirements:[{id:'acceptance',passed:true}]})); process.exit(0);`;
    for (const script of [stale, receiptSource]) {
      const f = fixture({ script });
      const result = await evaluateGoalVerification(await f.prepare(), {
        cwd: f.cwd,
      });
      expect(result).toMatchObject({
        met: false,
        evidence: { checks: [{ exitCode: 0, status: "receipt-invalid" }] },
      });
    }
    const f = fixture();
    f.manifest.checks[0].requirements.push("second-required-criterion");
    fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
    expect(
      (await evaluateGoalVerification(await f.prepare(), { cwd: f.cwd })).met,
    ).toBe(false);
  });
  it("retains and rejects a failure printed after the first 2000 characters", async () => {
    const f = fixture({
      script:
        "console.log('x'.repeat(6000)); console.log('CRITICAL_ACCEPTANCE_FAILURE'); process.exitCode = 1;",
    });
    const result = await evaluateGoalVerification(await f.prepare(), {
      cwd: f.cwd,
    });
    expect(result.met).toBe(false);
    expect(result.evidence.checks[0].stdout.preview).toContain(
      "CRITICAL_ACCEPTANCE_FAILURE",
    );
  });
  it("rejects a late success when cancellation arrives before the checker result settles", async () => {
    const f = fixture(),
      condition = await f.prepare();
    const controller = new AbortController();
    await expect(
      evaluateGoalVerification(condition, {
        cwd: f.cwd,
        signal: controller.signal,
        runCommand: async () => {
          controller.abort();
          return { status: "passed", exitCode: 0, signal: null };
        },
      }),
    ).rejects.toMatchObject({
      goalVerificationFailure: true,
      endReason: "cancelled",
    });
  });
  it("does not reuse a successful result after the implementation changes", async () => {
    const f = fixture(),
      condition = await f.prepare();
    const first = await evaluateGoalVerification(condition, { cwd: f.cwd });
    expect(first.met).toBe(true);
    fs.writeFileSync(
      path.join(f.cwd, "subject.cjs"),
      "exports.add = () => -1;\n",
    );
    const second = await evaluateGoalVerification(condition, { cwd: f.cwd });
    expect(second.met).toBe(false);
    expect(second.evidence.workspace.source.digest).not.toBe(
      first.evidence.workspace.source.digest,
    );
    expect(second.evidence.coverage.executed).toBe(1);
  });
  it("never executes or accepts a missing required artifact", async () => {
    const f = fixture(),
      condition = await f.prepare(),
      runCommand = vi.fn();
    fs.unlinkSync(path.join(f.cwd, "result.json"));
    const result = await evaluateGoalVerification(condition, {
      cwd: f.cwd,
      runCommand,
    });
    expect(result.met).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
    expect(result.evidence.coverage).toEqual({
      required: 1,
      executed: 0,
      passed: 0,
    });
  });
  it("stops if the author weakens a checker after preparation", async () => {
    const f = fixture(),
      condition = await f.prepare(),
      runCommand = vi.fn();
    fs.writeFileSync(f.program, "process.exit(0);\n");
    await expect(
      evaluateGoalVerification(condition, { cwd: f.cwd, runCommand }),
    ).rejects.toMatchObject({ goalVerificationFailure: true });
    expect(runCommand).not.toHaveBeenCalled();
  });
  it("stops if a passing checker changes its own frozen definition", async () => {
    const f = fixture({
      script: "require('node:fs').appendFileSync(__filename, '\\n// changed');",
    });
    await expect(
      evaluateGoalVerification(await f.prepare(), { cwd: f.cwd }),
    ).rejects.toThrow(/inputs changed/);
  });
  it("rejects candidate mutation during a successful checker process", async () => {
    const f = fixture({
      script:
        "require('node:fs').writeFileSync('result.json', '{\"answer\":99}');",
    });
    const result = await evaluateGoalVerification(await f.prepare(), {
      cwd: f.cwd,
    });
    expect(result).toMatchObject({
      met: false,
      evidence: { workspaceCurrent: false, checks: [{ exitCode: 0 }] },
    });
  });
  it("requires every declared checker instead of selecting a passing subset", async () => {
    const f = fixture();
    f.manifest.checks.push({
      ...f.manifest.checks[0],
      id: "second",
      args: ["-e", "process.exit(1)"],
    });
    fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
    const result = await evaluateGoalVerification(await f.prepare(), {
      cwd: f.cwd,
    });
    expect(result.met).toBe(false);
    expect(result.evidence.coverage).toEqual({
      required: 2,
      executed: 2,
      passed: 1,
    });
  });
  it("cannot replace a frozen verification definition on resume", async () => {
    const f = fixture(),
      condition = await f.prepare();
    const restored = GoalConditionEngine.fromSnapshot(
      new GoalConditionEngine({ condition }).snapshot(),
    );
    expect(await prepareGoalVerification(restored.condition, f.cwd)).toEqual(
      condition,
    );
    f.manifest.checks[0].args = ["-e", "process.exit(0)"];
    fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
    await expect(
      prepareGoalVerification(restored.condition, f.cwd),
    ).rejects.toThrow(/definition changed/);
  });
  it("rejects a checkpoint whose independent definition was lost", async () => {
    const f = fixture(),
      condition = await f.prepare();
    const snap = JSON.parse(
      JSON.stringify(new GoalConditionEngine({ condition }).snapshot()),
    );
    delete snap.condition.verification;
    expect(() => GoalConditionEngine.fromSnapshot(snap)).toThrow(/checkpoint/);
  });
  it("does not dispatch after cancellation or the Goal time budget expires", async () => {
    const f = fixture(),
      condition = await f.prepare(),
      runCommand = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      evaluateGoalVerification(condition, {
        cwd: f.cwd,
        signal: controller.signal,
        runCommand,
      }),
    ).rejects.toMatchObject({ endReason: "cancelled" });
    expect(
      (
        await evaluateGoalVerification(condition, {
          cwd: f.cwd,
          deadline: Date.now() - 1,
          runCommand,
        })
      ).met,
    ).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
  });
  it("cancels a live real checker and never accepts a late process success", async () => {
    const f = fixture({
      script:
        "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'ready'), String(process.pid)); setInterval(() => {}, 1000);",
    });
    const condition = await f.prepare(),
      controller = new AbortController();
    const pending = evaluateGoalVerification(condition, {
      cwd: f.cwd,
      signal: controller.signal,
    });
    const outcome = expect(pending).rejects.toMatchObject({
      goalVerificationFailure: true,
    });
    const ready = path.join(path.dirname(f.program), "ready");
    try {
      await vi.waitFor(() => expect(fs.existsSync(ready)).toBe(true), {
        timeout: 5000,
        interval: 20,
      });
      controller.abort();
      await outcome;
      const pid = Number(fs.readFileSync(ready, "utf8"));
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), {
        timeout: 3000,
      });
    } finally {
      controller.abort();
      await pending.catch(() => {});
    }
  });
  it("enforces a finite command deadline and fails output overflow", async () => {
    for (const [script, expected] of [
      ["setInterval(() => {}, 1000)", "timed-out"],
      ["console.log('x'.repeat(150000))", "output-limit"],
    ]) {
      const f = fixture({ script });
      f.manifest.checks[0].timeoutMs = 500;
      fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
      const result = await evaluateGoalVerification(await f.prepare(), {
        cwd: f.cwd,
      }).catch((error) => {
        // A host unable to attest process-tree cleanup must halt the entire
        // run, rather than return an ordinary failed check that can re-drive.
        expect(error).toMatchObject({
          goalVerificationFailure: true,
          cleanup: { confirmed: false },
        });
        return null;
      });
      if (result) {
        expect(result.met).toBe(false);
        expect(result.evidence.checks[0].status).toBe(expected);
      }
    }
  });
  it("keeps provider credentials out of the checker environment", async () => {
    const prior = process.env.CC_ACCEPTANCE_TEST_SECRET;
    process.env.CC_ACCEPTANCE_TEST_SECRET = "synthetic-must-not-reach-child";
    try {
      const f = fixture({
        script:
          "require('node:assert/strict').equal(process.env.CC_ACCEPTANCE_TEST_SECRET, undefined);",
      });
      expect(
        (await evaluateGoalVerification(await f.prepare(), { cwd: f.cwd })).met,
      ).toBe(true);
    } finally {
      if (prior === undefined) delete process.env.CC_ACCEPTANCE_TEST_SECRET;
      else process.env.CC_ACCEPTANCE_TEST_SECRET = prior;
    }
  });
  it("rejects unsupported or empty acceptance definitions before execution", async () => {
    for (const patch of [
      { checks: [] },
      { artifacts: [] },
      { artifacts: ["../escape"] },
      { schema: "unknown" },
      { unexpected: true },
    ]) {
      const f = fixture();
      fs.writeFileSync(
        f.manifestPath,
        JSON.stringify({ ...f.manifest, ...patch }),
      );
      await expect(f.prepare()).rejects.toMatchObject({
        goalVerificationFailure: true,
      });
    }
    expect(() => parseGoalCondition("verify:")).toThrow(/manifest/);
  });
});
