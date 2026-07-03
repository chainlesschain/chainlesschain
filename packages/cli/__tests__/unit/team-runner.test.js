import { describe, it, expect } from "vitest";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";

// The registry clock only governs lease expiry; the runner itself uses real
// async ticks. TTLs here are large so a lease never expires mid-run.
function freshRegistry() {
  let t = 1000;
  return new TaskLeaseRegistry({ now: () => t, defaultTtlMs: 1_000_000 });
}

describe("TeamRunner DAG execution", () => {
  it("runs a diamond DAG in dependency order, each task exactly once", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "root", title: "root" });
    reg.addTask({ key: "left", title: "left", dependsOn: ["root"] });
    reg.addTask({ key: "right", title: "right", dependsOn: ["root"] });
    reg.addTask({ key: "join", title: "join", dependsOn: ["left", "right"] });

    const runCount = {};
    const depStatusesAtRun = {};
    const runner = new TeamRunner(reg, {
      teammates: 3,
      runTask: async ({ key, task }) => {
        runCount[key] = (runCount[key] || 0) + 1;
        // Snapshot each dependency's status AT THE MOMENT this task runs — every
        // one must already be completed (DAG gating).
        depStatusesAtRun[key] = task.dependsOn.map(
          (d) => reg.getTask(d).status,
        );
        await new Promise((r) => setTimeout(r, 1));
        return `did ${key}`;
      },
    });

    const summary = await runner.run();
    expect(summary.done).toBe(true);
    // Exclusive lease → no task ran twice despite 3 racing teammates.
    expect(runCount).toEqual({ root: 1, left: 1, right: 1, join: 1 });
    // Every dependency was completed before its dependent ran.
    expect(depStatusesAtRun.left).toEqual(["completed"]);
    expect(depStatusesAtRun.join).toEqual(["completed", "completed"]);
    expect(summary.executions).toBe(4);
  });

  it("allows independent tasks to run concurrently up to the teammate count", async () => {
    const reg = freshRegistry();
    // Four independent tasks, two teammates → max 2 in flight.
    for (const k of ["a", "b", "c", "d"]) reg.addTask({ key: k, title: k });
    let concurrent = 0;
    let peak = 0;
    const runner = new TeamRunner(reg, {
      teammates: 2,
      runTask: async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        concurrent--;
      },
    });
    const summary = await runner.run();
    expect(summary.done).toBe(true);
    expect(peak).toBe(2); // exactly the teammate cap, not 4
    expect(summary.maxConcurrent).toBe(2);
  });
});

describe("TeamRunner failure handling", () => {
  it("retries a failing task then cancels it, and never runs its dependents", async () => {
    const reg = freshRegistry();
    reg.maxAttempts = 2;
    reg.addTask({ key: "build", title: "build" });
    reg.addTask({ key: "deploy", title: "deploy", dependsOn: ["build"] });

    const runCount = {};
    const runner = new TeamRunner(reg, {
      teammates: 2,
      runTask: async ({ key }) => {
        runCount[key] = (runCount[key] || 0) + 1;
        if (key === "build") throw new Error("compile error");
        return "ok";
      },
    });
    const summary = await runner.run();

    expect(summary.done).toBe(false); // deploy can never finish
    expect(reg.getTask("build").status).toBe("cancelled");
    expect(runCount.build).toBe(2); // retried up to the cap
    expect(runCount.deploy).toBeUndefined(); // dependent of a cancelled task never ran
    expect(reg.getTask("deploy").status).toBe("pending");
  });

  it("recovers a transient failure and completes on retry", async () => {
    const reg = freshRegistry();
    reg.maxAttempts = 3;
    reg.addTask({ key: "flaky", title: "flaky" });
    let n = 0;
    const runner = new TeamRunner(reg, {
      teammates: 1,
      runTask: async () => {
        n++;
        if (n === 1) throw new Error("transient");
        return "ok";
      },
    });
    const summary = await runner.run();
    expect(summary.done).toBe(true);
    expect(reg.getTask("flaky").status).toBe("completed");
    expect(n).toBe(2);
  });
});

describe("TeamRunner events + guards", () => {
  it("emits a machine-readable event stream", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "only", title: "only" });
    const events = [];
    const runner = new TeamRunner(reg, {
      teammates: 1,
      onEvent: (e) => events.push(e.type),
      runTask: async () => "done",
    });
    await runner.run();
    expect(events).toContain("run:start");
    expect(events).toContain("task:claimed");
    expect(events).toContain("task:completed");
    expect(events).toContain("run:end");
  });

  it("requires runTask", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "x", title: "x" });
    const runner = new TeamRunner(reg, { teammates: 1 });
    await expect(runner.run()).rejects.toThrow(/runTask is required/);
  });

  it("honors the maxTasks budget", async () => {
    const reg = freshRegistry();
    for (let i = 0; i < 10; i++) reg.addTask({ key: `t${i}`, title: `t${i}` });
    let ran = 0;
    const runner = new TeamRunner(reg, {
      teammates: 1,
      maxTasks: 3,
      runTask: async () => {
        ran++;
      },
    });
    const summary = await runner.run();
    expect(summary.done).toBe(false);
    expect(ran).toBe(3); // stopped at the budget
  });
});
