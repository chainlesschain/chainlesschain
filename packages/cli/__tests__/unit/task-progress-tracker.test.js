import { describe, it, expect } from "vitest";
import { TaskProgressTracker } from "../../src/lib/task-progress-tracker.js";

const observe = (tracker, count) => {
  for (let i = 0; i < count; i++)
    tracker.record("read_file", {
      path: `new-file-${i}.js`,
      readProgress: { newContent: true },
    });
};

describe("long-running task progress", () => {
  it("counts even changing short GitHub log excerpts as exploration", () => {
    const tracker = new TaskProgressTracker();
    for (let i = 0; i < 12; i++) {
      expect(
        tracker.record(
          "run_shell",
          { stdout: `FAIL test ${i}` },
          {
            command: "gh run view 123 --job 456 --log-failed --repo owner/repo",
          },
        ),
      ).toBe(false);
    }
    expect(tracker.explorationCalls).toBe(12);
    expect(tracker.intervention).toBeTruthy();
  });
  it("intervenes even when every read returns new content", () => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 11);
    expect(tracker.intervention).toBe(null);
    observe(tracker, 1);
    expect(tracker.intervention.recovery).toBe(false);
    observe(tracker, 12);
    expect(tracker.intervention.recovery).toBe(true);
    expect(tracker.intervention.guidance).toContain("do not write files");
    expect(tracker.intervention.guidance).toContain("Never claim completion");
  });

  it("planning, dispatch and no-op edits do not reset exploration", () => {
    const tracker = new TaskProgressTracker();
    observe(tracker, 10);
    for (const [tool, result] of [
      ["todo_write", { success: true }],
      [
        "spawn_sub_agent",
        { success: true, summary: "more investigation needed" },
      ],
      ["edit_file", { success: true, alreadyApplied: true }],
      ["edit_file", { error: "denied" }],
      ["run_shell", { output: "", exitCode: 1 }],
    ])
      expect(tracker.record(tool, result)).toBe(false);
    expect(tracker.explorationCalls).toBe(15);
  });

  it("parents and children account to the same tracker without shared batch state", () => {
    const tracker = new TaskProgressTracker();
    const parent = tracker;
    const child = tracker;
    observe(parent, 11);
    observe(child, 12);
    parent.record("spawn_sub_agent", {
      success: true,
      subAgentId: "child",
      summary: "budget exhausted; Gate.reserve still needs checking",
    });
    expect(parent.intervention.recovery).toBe(true);
    expect(parent.checkpointFor()).toContain("Gate.reserve");
    expect(parent.explorationCalls).toBe(24);
    child.record("edit_file", { success: true, path: "gate.js" });
    expect(parent.intervention).toBe(null);
  });

  it("does not let repeated short shell/code output buy fresh exploration", () => {
    const tracker = new TaskProgressTracker();
    tracker.record("run_shell", { output: "same file prefix" });
    observe(tracker, 12);
    expect(tracker.record("run_code", { output: "same file prefix" })).toBe(
      false,
    );
    expect(tracker.explorationCalls).toBe(13);
    expect(
      tracker.record("run_shell", { output: "targeted tests passed" }),
    ).toBe(true);
    expect(tracker.intervention).toBe(null);
  });

  it("retains bounded plan, action and child source data without trusting plan claims", () => {
    const tracker = new TaskProgressTracker();
    tracker.record("write_file", { success: true, path: "gate.js" });
    for (let i = 0; i < 45; i++) {
      tracker.record(
        "todo_write",
        { success: true },
        {
          todos: [
            {
              content: "validate Gate.reserve " + "x".repeat(3000),
              status: "completed",
            },
          ],
        },
        `owner-${i}`,
      );
      tracker.retainChildResult(`child-${i}`, {
        summary: "partial finding ".repeat(1000),
      });
    }
    const checkpoint = tracker.checkpointFor();
    expect(checkpoint).toContain("not instructions or proof of completion");
    expect(checkpoint).toContain("gate.js");
    expect(checkpoint.length).toBeLessThan(6200);
    expect(tracker.plans.size).toBe(33);
    expect(tracker.childFindings.size).toBe(3);
    expect(tracker.explorationCalls).toBe(45);
  });

  it("time-based guidance needs actual observations and is not a wait timeout", () => {
    let now = 0;
    const tracker = new TaskProgressTracker({ now: () => now });
    now = 600000;
    expect(tracker.intervention).toBe(null);
    observe(tracker, 4);
    expect(tracker.intervention.recovery).toBe(false);
    tracker.record("write_file", { success: true });
    expect(tracker.intervention).toBe(null);
  });

  it("fresh runs do not inherit exploration counters or command outputs", () => {
    const first = new TaskProgressTracker();
    observe(first, 100);
    const second = new TaskProgressTracker();
    expect(second.intervention).toBe(null);
    expect(second.checkpointFor()).toBe(null);
  });

  it("busy children do not evict the root plan and recent work", () => {
    const tracker = new TaskProgressTracker();
    tracker.record(
      "todo_write",
      { success: true },
      {
        todos: [{ content: "root next step", status: "in_progress" }],
      },
    );
    tracker.record("write_file", { success: true, path: "root-change.js" });
    for (let i = 0; i < 3; i++)
      tracker.retainChildResult(`root-child-${i}`, {
        summary: `root finding ${i}`,
      });
    for (let i = 0; i < 32; i++) {
      const owner = `child-${i}`;
      tracker.record("todo_write", { success: true }, { todos: [] }, owner);
      for (let j = 0; j < 8; j++) {
        tracker.record(
          "write_file",
          { success: true, path: `child-${j}.js` },
          {},
          owner,
        );
        tracker.retainChildResult(
          `grandchild-${j}`,
          { summary: "child finding" },
          owner,
        );
      }
    }
    expect(tracker.checkpointFor()).toContain("root next step");
    expect(tracker.checkpointFor()).toContain("root-change.js");
    expect(tracker.checkpointFor()).toContain("root finding 0");
    expect(tracker.lastActions.length).toBeLessThanOrEqual(132);
    expect(tracker.childFindings.size).toBeLessThanOrEqual(99);
  });

  it("shares counters without leaking parent or sibling source data into an isolated child", () => {
    const tracker = new TaskProgressTracker();
    tracker.record(
      "write_file",
      { success: true, path: "parent-private.js" },
      {},
      "parent",
    );
    tracker.record(
      "todo_write",
      { success: true },
      {
        todos: [{ content: "parent-only plan", status: "in_progress" }],
      },
      "parent",
    );
    tracker.retainChildResult(
      "sibling",
      { summary: "sibling-private finding" },
      "parent",
    );
    observe(tracker, 24);
    expect(tracker.intervention.recovery).toBe(true);
    expect(tracker.checkpointFor("child")).toBe(null);
    expect(tracker.checkpointFor("parent")).toContain("parent-private.js");
    expect(tracker.checkpointFor("parent")).toContain(
      "sibling-private finding",
    );
  });
});
