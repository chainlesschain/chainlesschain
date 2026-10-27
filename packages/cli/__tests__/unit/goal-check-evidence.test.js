import { describe, expect, it } from "vitest";
import {
  GoalCheckEvidence,
  buildGoalJudgePrompt,
  usableGoalEvidence,
  validateGoalJudgeVerdict,
} from "../../src/lib/goal-check-evidence.js";

function observe(evidence, tool, result, args = {}, isError = false) {
  const call = { tool, args };
  evidence.started(call);
  evidence.settled(call, result, isError);
  return evidence.snapshot().tools.at(-1).id;
}

describe("goal evidence grounded in the current turn", () => {
  it("rejects assistant-only, uncited and invented positive verdicts", () => {
    const evidence = new GoalCheckEvidence();
    const id = observe(evidence, "run_shell", {
      exitCode: 0,
      stdout: "3 tests passed",
    });
    for (const snapshot of [
      evidence.snapshot(),
      new GoalCheckEvidence().snapshot(),
    ]) {
      for (const verdict of [
        { met: true, reason: "assistant said done" },
        { met: true, evidenceIds: ["invented"] },
        { met: "true", evidenceIds: [id] },
      ])
        expect(validateGoalJudgeVerdict(verdict, snapshot).met).toBe(false);
    }
    expect(
      validateGoalJudgeVerdict(
        { met: true, evidenceIds: [id] },
        evidence.snapshot(),
      ),
    ).toMatchObject({ met: true, evidence: { toolIds: [id] } });
  });

  it.each([
    [{ exitCode: 1, stdout: "tests failed" }, false],
    [{ exitCode: null, stdout: "still running" }, false],
    [{ exitCode: "0" }, false],
    [{ stdout: "no confirmed exit" }, false],
    [{ exitCode: 0, signal: "SIGTERM" }, false],
    [{ exitCode: 0, has_more_output: true }, false],
    [{ exitCode: 0, running: true }, false],
    [{ success: false }, false],
    [{ isError: true }, false],
    [{ status: "running", task_id: "job-1" }, false],
    [{ exitCode: 0 }, true],
    [undefined, false],
  ])(
    "cannot cite a failed, unknown or background result: %j",
    (result, isError) => {
      const evidence = new GoalCheckEvidence();
      const id = observe(evidence, "run_shell", result, {}, isError);
      expect(
        validateGoalJudgeVerdict(
          { met: true, evidenceIds: [id] },
          evidence.snapshot(),
        ).met,
      ).toBe(false);
    },
  );

  it("makes old passing checks stale after a later mutation", () => {
    const evidence = new GoalCheckEvidence({ readOnlyTools: ["read_file"] });
    const oldTest = observe(
      evidence,
      "run_shell",
      { exitCode: 0 },
      { command: "npm test" },
    );
    observe(evidence, "edit_file", { success: true }, { path: "app.js" });
    expect(
      validateGoalJudgeVerdict(
        { met: true, evidenceIds: [oldTest] },
        evidence.snapshot(),
      ).met,
    ).toBe(false);
    const newTest = observe(
      evidence,
      "run_shell",
      { exitCode: 0 },
      { command: "npm test" },
    );
    expect(
      validateGoalJudgeVerdict(
        { met: true, evidenceIds: [newTest] },
        evidence.snapshot(),
      ).met,
    ).toBe(true);
  });

  it("rejects a read overlapping a mutation and any pending invocation", () => {
    const evidence = new GoalCheckEvidence({ readOnlyTools: ["read_file"] });
    const read = { tool: "read_file", args: { path: "app.js" } };
    evidence.started(read);
    const write = { tool: "write_file", args: { path: "app.js" } };
    evidence.started(write);
    evidence.settled(read, { content: "old code" }, false);
    expect(usableGoalEvidence(evidence.snapshot())).toEqual([]);
    evidence.settled(write, { success: true }, false);
    expect(evidence.snapshot().tools[0].current).toBe(false);
  });

  it("does not carry previous-turn checks into a new evaluation", () => {
    const evidence = new GoalCheckEvidence();
    observe(evidence, "run_shell", { exitCode: 0 });
    evidence.beginTurn();
    expect(usableGoalEvidence(evidence.snapshot())).toEqual([]);
    expect(evidence.snapshot().tools).toEqual([]);
  });

  it("bounds tool evidence while retaining the tail of long diagnostic output", () => {
    const evidence = new GoalCheckEvidence();
    for (let i = 0; i < 40; i++) {
      observe(evidence, "run_shell", {
        exitCode: 0,
        stdout: "x".repeat(100_000) + "FINAL TEST SUMMARY: PASSED",
      });
    }
    const snapshot = evidence.snapshot();
    expect(snapshot.omitted).toBe(16);
    expect(JSON.stringify(snapshot).length).toBeLessThan(110_000);
    const prompt = buildGoalJudgePrompt(
      { text: "tests pass" },
      {
        finalText: "x".repeat(20_000) + "ASSISTANT TAIL",
        goalEvidence: snapshot,
      },
    );
    expect(prompt).toContain("FINAL TEST SUMMARY: PASSED");
    expect(prompt).toContain("ASSISTANT TAIL");
    expect(prompt).toContain("claim, not proof");
  });
});
