import { describe, it, expect } from "vitest";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";
import { TeamBudget } from "../../src/lib/agent-team/team-budget.js";
import { TeamMailbox } from "../../src/lib/agent-team/team-mailbox.js";

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

describe("TeamRunner team budget", () => {
  it("stops claiming once the team token budget is exhausted", async () => {
    const reg = freshRegistry();
    for (let i = 0; i < 10; i++) reg.addTask({ key: `t${i}`, title: `t${i}` });
    let ran = 0;
    // Each task reports 1000 tokens; cap at 2500 → 3rd task trips it (record is
    // after completion, so the 3rd runs then the 4th claim is blocked).
    const budget = new TeamBudget({ maxTokens: 2500 });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      budget,
      runTask: async () => {
        ran++;
        return { usage: { input_tokens: 500, output_tokens: 500 } };
      },
    });
    const summary = await runner.run();
    expect(summary.done).toBe(false);
    expect(ran).toBe(3); // 3×1000 = 3000 ≥ 2500, stopped before the 4th
    expect(summary.budgetStopped).toBe(true);
    expect(summary.budgetReason).toBe("max-tokens");
  });

  it("counts a failed task against the budget so a doomed retry loop can't dodge it", async () => {
    const reg = freshRegistry();
    reg.maxAttempts = 100; // would retry forever without a budget
    reg.addTask({ key: "doomed", title: "doomed" });
    let ran = 0;
    const budget = new TeamBudget({ maxTasks: 4 });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      budget,
      runTask: async () => {
        ran++;
        throw new Error("always fails");
      },
    });
    const summary = await runner.run();
    expect(ran).toBe(4); // stopped by the task budget, not the attempt cap
    expect(summary.budgetReason).toBe("max-tasks");
  });
});

describe("TeamRunner directed messaging", () => {
  it("delivers a directed message to a teammate's inbox and posts via sendMessage", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "task", title: "task" });
    const mailbox = new TeamMailbox();
    // A coordinator directs a message at teammate-1 (the first worker) before the
    // run — deterministic regardless of scheduling.
    mailbox.send({ from: "coordinator", to: "teammate-1", body: "start-here" });
    let seenInbox = null;
    const runner = new TeamRunner(reg, {
      teammates: 1,
      mailbox,
      runTask: async ({ inbox, sendMessage }) => {
        seenInbox = inbox.map((m) => m.body);
        sendMessage("coordinator", "done"); // reply back
        return "ok";
      },
    });
    const summary = await runner.run();
    expect(seenInbox).toEqual(["start-here"]); // directed message delivered
    // The reply is in the shared log and drainable by the coordinator.
    expect(mailbox.drain("coordinator").map((m) => m.body)).toEqual(["done"]);
    expect(summary.messages).toBe(2);
  });

  it("delivers a broadcast from one teammate to a different teammate", async () => {
    const reg = freshRegistry();
    // Two independent tasks so both teammates are busy at once; each broadcasts
    // its key, and each records the broadcasts it received from the OTHER.
    reg.addTask({ key: "a", title: "a" });
    reg.addTask({ key: "b", title: "b" });
    const mailbox = new TeamMailbox();
    let anyCrossDelivery = false;
    const runner = new TeamRunner(reg, {
      teammates: 2,
      mailbox,
      runTask: async ({ holder, inbox, sendMessage }) => {
        if (inbox.some((m) => m.from && m.from !== holder)) {
          anyCrossDelivery = true;
        }
        sendMessage("*", `hello from ${holder}`);
        // Give the peer a chance to run and drain concurrently.
        await new Promise((r) => setTimeout(r, 2));
        return "ok";
      },
    });
    await runner.run();
    // Both broadcasts are in the log (2 messages), addressed to all.
    expect(mailbox.log().filter((m) => m.to === "*")).toHaveLength(2);
    // At least one teammate observed the other's broadcast in its inbox OR a
    // fresh drain now shows the cross-teammate broadcast is deliverable.
    const t1 = mailbox.peek("teammate-1");
    const t2 = mailbox.peek("teammate-2");
    expect(anyCrossDelivery || t1.length > 0 || t2.length > 0).toBe(true);
  });
});

describe("TeamRunner teammate lifecycle", () => {
  it("emits state transitions and ends every teammate in shutdown", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "a", title: "a" });
    reg.addTask({ key: "b", title: "b" });
    const states = [];
    const runner = new TeamRunner(reg, {
      teammates: 1,
      onEvent: (e) => {
        if (e.type === "teammate:state") states.push(e.state);
      },
      runTask: async () => "ok",
    });
    const summary = await runner.run();
    // idle at start → running while executing → shutdown when out of work.
    expect(states).toContain("running");
    expect(states[states.length - 1]).toBe("shutdown");
    const members = summary.members;
    expect(members).toHaveLength(1);
    expect(members[0].state).toBe("shutdown");
    expect(members[0].completed).toBe(2);
  });

  it("records a failed task on the teammate that ran it", async () => {
    const reg = freshRegistry();
    reg.maxAttempts = 1; // fail once → cancel
    reg.addTask({ key: "bad", title: "bad" });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      runTask: async () => {
        throw new Error("boom");
      },
    });
    const summary = await runner.run();
    expect(summary.members[0].failed).toBe(1);
    expect(summary.members[0].lastError).toBe("boom");
  });
});
