/**
 * resumeExecution regression suite.
 *
 * The original resumeExecution only flipped status to "running" and returned —
 * it never re-entered _executeStages, so a workflow paused at a breakpoint or
 * approval gate was stuck forever while the IPC reported success. Approval
 * pauses set status "waiting" (not "paused"), so they were additionally
 * rejected by the `status !== "paused"` check. executeWorkflow also overwrote
 * the "paused"/"waiting" status with "completed" after the early return.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return { exec: vi.fn(), prepare: vi.fn().mockReturnValue(prep), _prep: prep };
}

const { WorkflowEngine } = require("../workflow-engine");

describe("WorkflowEngine resumeExecution", () => {
  let engine;
  let db;

  beforeEach(async () => {
    engine = new WorkflowEngine();
    db = createMockDB();
    await engine.initialize(db);
  });

  it("executeWorkflow no longer reports 'completed' for a breakpoint-paused run", async () => {
    engine.createWorkflow({
      id: "wf-bp",
      name: "BP",
      stages: [
        { id: "s1", type: "action", name: "S1", next: ["s2"] },
        { id: "s2", type: "action", name: "S2", next: [] },
      ],
    });
    engine.setBreakpoint("wf-bp", "s2");
    const completedHandler = vi.fn();
    engine.on("workflow:completed", completedHandler);

    const exec = await engine.executeWorkflow("wf-bp");
    expect(exec.status).toBe("paused");
    expect(exec.currentStage).toBe("s2");
    expect(completedHandler).not.toHaveBeenCalled();
  });

  it("executeWorkflow reports 'waiting' (not 'completed') at an approval gate", async () => {
    engine.createWorkflow({
      id: "wf-appr",
      name: "Approval",
      stages: [
        { id: "s1", type: "action", name: "Work", next: ["gate"] },
        { id: "gate", type: "approval", name: "Approve", next: ["s3"] },
        { id: "s3", type: "action", name: "Finish", next: [] },
      ],
    });
    const exec = await engine.executeWorkflow("wf-appr");
    expect(exec.status).toBe("waiting");
  });

  it("resumes past a breakpoint and runs the remaining stages exactly once", async () => {
    engine.createWorkflow({
      id: "wf-bp",
      name: "BP",
      stages: [
        { id: "s1", type: "action", name: "S1", next: ["s2"] },
        { id: "s2", type: "action", name: "S2", next: ["s3"] },
        { id: "s3", type: "action", name: "S3", next: [] },
      ],
    });
    engine.setBreakpoint("wf-bp", "s2");
    const exec = await engine.executeWorkflow("wf-bp");
    expect(exec.status).toBe("paused");
    expect(exec.log.map((e) => e.stageId)).toEqual(["s1"]);

    const completedHandler = vi.fn();
    engine.on("workflow:completed", completedHandler);
    const resumed = await engine.resumeExecution(exec.id);

    expect(resumed.status).toBe("completed");
    expect(resumed.log.map((e) => e.stageId)).toEqual(["s1", "s2", "s3"]);
    expect(resumed.log.every((e) => e.status === "completed")).toBe(true);
    expect(completedHandler).toHaveBeenCalledWith({ executionId: exec.id });
  });

  it("resume steps over the paused breakpoint once but honors LATER breakpoints", async () => {
    engine.createWorkflow({
      id: "wf-bp2",
      name: "BP2",
      stages: [
        { id: "s1", type: "action", name: "S1", next: ["s2"] },
        { id: "s2", type: "action", name: "S2", next: ["s3"] },
        { id: "s3", type: "action", name: "S3", next: [] },
      ],
    });
    engine.setBreakpoint("wf-bp2", "s2");
    engine.setBreakpoint("wf-bp2", "s3");
    const exec = await engine.executeWorkflow("wf-bp2");
    expect(exec.status).toBe("paused");

    const afterFirstResume = await engine.resumeExecution(exec.id);
    // stepped over s2, then paused again on s3's breakpoint
    expect(afterFirstResume.status).toBe("paused");
    expect(afterFirstResume.currentStage).toBe("s3");
    expect(afterFirstResume.log.map((e) => e.stageId)).toEqual(["s1", "s2"]);

    const afterSecondResume = await engine.resumeExecution(exec.id);
    expect(afterSecondResume.status).toBe("completed");
    expect(afterSecondResume.log.map((e) => e.stageId)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("resumes a 'waiting' approval-gated workflow (approval granted) to completion", async () => {
    engine.createWorkflow({
      id: "wf-appr",
      name: "Approval",
      stages: [
        { id: "s1", type: "action", name: "Work", next: ["gate"] },
        { id: "gate", type: "approval", name: "Approve", next: ["s3"] },
        { id: "s3", type: "action", name: "Finish", next: [] },
      ],
    });
    const exec = await engine.executeWorkflow("wf-appr");
    expect(exec.status).toBe("waiting");
    expect(exec.log.find((e) => e.stageId === "gate").status).toBe(
      "awaiting_approval",
    );

    const resumed = await engine.resumeExecution(exec.id);
    expect(resumed.status).toBe("completed");
    const gateEntry = resumed.log.find((e) => e.stageId === "gate");
    expect(gateEntry.status).toBe("completed");
    expect(gateEntry.approved).toBe(true);
    expect(resumed.log.map((e) => e.stageId)).toEqual(["s1", "gate", "s3"]);
  });

  it("resumes a diamond paused mid-frontier without double-running any stage", async () => {
    // a → [b, c]; b → d; c → d. Breakpoint on b pauses before b/c ran.
    engine.createWorkflow({
      id: "wf-dia",
      name: "Diamond",
      stages: [
        { id: "a", type: "action", name: "A", next: ["b", "c"] },
        { id: "b", type: "action", name: "B", next: ["d"] },
        { id: "c", type: "action", name: "C", next: ["d"] },
        { id: "d", type: "action", name: "D", next: [] },
      ],
    });
    engine.setBreakpoint("wf-dia", "b");
    const exec = await engine.executeWorkflow("wf-dia");
    expect(exec.status).toBe("paused");
    expect(exec.log.map((e) => e.stageId)).toEqual(["a"]);

    const resumed = await engine.resumeExecution(exec.id);
    expect(resumed.status).toBe("completed");
    const order = resumed.log.map((e) => e.stageId);
    // every stage exactly once, d only after BOTH b and c
    expect([...order].sort()).toEqual(["a", "b", "c", "d"]);
    expect(order.indexOf("d")).toBeGreaterThan(order.indexOf("b"));
    expect(order.indexOf("d")).toBeGreaterThan(order.indexOf("c"));
  });

  it("second resume of a finished execution returns null", async () => {
    engine.createWorkflow({
      id: "wf-bp",
      name: "BP",
      stages: [
        { id: "s1", type: "action", name: "S1", next: ["s2"] },
        { id: "s2", type: "action", name: "S2", next: [] },
      ],
    });
    engine.setBreakpoint("wf-bp", "s2");
    const exec = await engine.executeWorkflow("wf-bp");
    await engine.resumeExecution(exec.id);
    expect(await engine.resumeExecution(exec.id)).toBeNull();
  });

  it("returns null when the workflow definition no longer exists", async () => {
    engine.createWorkflow({
      id: "wf-gone",
      name: "Gone",
      stages: [
        { id: "s1", type: "action", name: "S1", next: ["s2"] },
        { id: "s2", type: "action", name: "S2", next: [] },
      ],
    });
    engine.setBreakpoint("wf-gone", "s2");
    const exec = await engine.executeWorkflow("wf-gone");
    engine._workflows.delete("wf-gone");
    expect(await engine.resumeExecution(exec.id)).toBeNull();
  });

  it("persists the resumed execution", async () => {
    engine.createWorkflow({
      id: "wf-bp",
      name: "BP",
      stages: [
        { id: "s1", type: "action", name: "S1", next: ["s2"] },
        { id: "s2", type: "action", name: "S2", next: [] },
      ],
    });
    engine.setBreakpoint("wf-bp", "s2");
    const exec = await engine.executeWorkflow("wf-bp");
    db._prep.run.mockClear();
    await engine.resumeExecution(exec.id);
    expect(db._prep.run).toHaveBeenCalled();
  });
});
