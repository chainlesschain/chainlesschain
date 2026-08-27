import { describe, it, expect, vi } from "vitest";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";
import { TeamBudget } from "../../src/lib/agent-team/team-budget.js";
import { TeamMailbox } from "../../src/lib/agent-team/team-mailbox.js";
import { TelemetryRecorder } from "../../src/lib/telemetry/span-recorder.js";

// The registry clock only governs lease expiry; the runner itself uses real
// async ticks. TTLs here are large so a lease never expires mid-run.
function freshRegistry() {
  let t = 1000;
  return new TaskLeaseRegistry({ now: () => t, defaultTtlMs: 1_000_000 });
}

function activeAttempt(runner, key) {
  const claim = runner.activeClaims().find((item) => item.key === key);
  if (!claim) throw new Error(`No active claim for ${key}`);
  return {
    holder: claim.holder,
    leaseId: claim.leaseId,
    fencingToken: claim.fencingToken,
  };
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

describe("TeamRunner OTel workflow tracing", () => {
  it("emits a team.task span per execution, tagged with the workflow attributes", async () => {
    // maxAttempts:1 → the failing task is NOT retried (one span per outcome).
    const reg = new TaskLeaseRegistry({
      now: () => 1000,
      defaultTtlMs: 1_000_000,
      maxAttempts: 1,
    });
    reg.addTask({ key: "ok", title: "ok" });
    reg.addTask({ key: "boom", title: "boom" });

    const recorder = new TelemetryRecorder({
      defaultAttributes: {
        "workflow.run_id": "team-run-1",
        "workflow.name": "graph.json",
      },
    });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      recorder,
      runTask: async ({ key }) => {
        if (key === "boom") throw new Error("kaput");
        return "done";
      },
    });
    await runner.run();

    const spans = recorder.spans().filter((s) => s.name === "team.task");
    expect(spans).toHaveLength(2);
    for (const s of spans) {
      expect(s.attributes["workflow.run_id"]).toBe("team-run-1");
      expect(s.attributes["workflow.name"]).toBe("graph.json");
      expect(s.attributes["team.holder"]).toBe("teammate-1");
    }
    const ok = spans.find((s) => s.attributes["team.task.key"] === "ok");
    const boom = spans.find((s) => s.attributes["team.task.key"] === "boom");
    expect(ok.status).toBe("ok");
    expect(boom.status).toBe("error");
    expect(boom.attributes["failure.category"]).toBe("task_failure");
  });

  it("is zero-cost without a recorder (no spans, run unchanged)", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "a", title: "a" });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      runTask: async () => "done",
    });
    const summary = await runner.run();
    expect(summary.done).toBe(true);
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

  it("does not report a phantom completion when the lease expired mid-run", async () => {
    // A task that outruns its lease TTL without renewing: complete() is rejected
    // by the registry, so the runner must NOT emit task:completed or bump the
    // teammate's completed counter — that would be a phantom success for work the
    // registry has no record of (it will be reclaimed + re-run).
    let t = 1000;
    const reg = new TaskLeaseRegistry({ now: () => t, defaultTtlMs: 100 });
    reg.addTask({ key: "slow", title: "slow" });
    const events = [];
    let runs = 0;
    const runner = new TeamRunner(reg, {
      teammates: 1,
      ttlMs: 100,
      maxTasks: 1, // one execution — we only assert on the first (rejected) complete
      onEvent: (e) => events.push(e.type),
      runTask: async () => {
        runs++;
        t += 5000; // blow past the 100ms lease before completing
        return "done";
      },
    });
    const summary = await runner.run();
    expect(runs).toBe(1);
    // Premise: the registry rejected the completion (lease gone).
    expect(reg.getTask("slow").status).not.toBe("completed");
    // The runner must be honest about it.
    expect(events).not.toContain("task:completed");
    expect(events).toContain("task:completion-discarded");
    expect(summary.members[0].completed).toBe(0);
  });

  it("heartbeat renews the lease so a long task is neither stolen nor double-run", async () => {
    // Real-clock registry with a TTL much shorter than the task duration.
    // Before the runner-level heartbeat, executors never renewed, so the lease
    // expired mid-run: a second teammate stole the task (the SAME task ran
    // twice concurrently) and the first completion was discarded.
    const reg = new TaskLeaseRegistry({ defaultTtlMs: 120 });
    reg.addTask({ key: "long", title: "long" });
    const events = [];
    let runs = 0;
    const runner = new TeamRunner(reg, {
      teammates: 2,
      ttlMs: 120,
      renewEveryMs: 30,
      onEvent: (e) => events.push(e.type),
      runTask: async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 400)); // outlives the 120ms TTL
        return "done";
      },
    });
    const summary = await runner.run();
    expect(runs).toBe(1); // never stolen → never double-run
    expect(reg.getTask("long").status).toBe("completed");
    expect(events).toContain("task:completed");
    expect(events).not.toContain("task:completion-discarded");
    expect(summary.members.reduce((n, m) => n + m.completed, 0)).toBe(1);
  });

  it("reacquires its own expired lease after a delayed heartbeat without a local double-run", async () => {
    let now = 1000;
    const reg = new TaskLeaseRegistry({
      now: () => now,
      defaultTtlMs: 100,
    });
    reg.addTask({ key: "stalled", title: "stalled" });
    let runs = 0;
    const runner = new TeamRunner(reg, {
      teammates: 2,
      ttlMs: 100,
      now: () => now,
      runTask: async ({ renew }) => {
        runs++;
        // Model an event-loop stall that carries the logical clock beyond the
        // lease before either the heartbeat or the peer loop gets CPU.
        now += 5000;
        await Promise.resolve();
        expect(renew()).toMatchObject({ ok: true });
        return "done";
      },
    });

    const summary = await runner.run();
    expect(runs).toBe(1);
    expect(reg.getTask("stalled")).toMatchObject({ status: "completed" });
    expect(summary.executions).toBe(1);
  });

  it("keeps a task fenced and heartbeating while beforeTask awaits", async () => {
    let now = 1000;
    const reg = new TaskLeaseRegistry({
      now: () => now,
      defaultTtlMs: 100,
    });
    reg.addTask({ key: "prepared", title: "prepared" });
    let runs = 0;
    const runner = new TeamRunner(reg, {
      teammates: 2,
      ttlMs: 100,
      renewEveryMs: 25,
      now: () => now,
      beforeTask: async () => {
        now += 1000;
        await new Promise((resolve) => setTimeout(resolve, 40));
      },
      runTask: async () => {
        runs += 1;
      },
    });

    const summary = await runner.run();
    expect(summary.done).toBe(true);
    expect(summary.executions).toBe(1);
    expect(runs).toBe(1);
  });

  it("exposes the settled task and exact lease to durable afterTask observers", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "observed", title: "observed task" });
    const settlements = [];
    const runner = new TeamRunner(reg, {
      teammates: 1,
      afterTask: (settlement) => settlements.push(settlement),
      runTask: async () => ({ output: "done" }),
    });

    const summary = await runner.run();

    expect(summary.done).toBe(true);
    expect(settlements).toEqual([
      expect.objectContaining({
        key: "observed",
        status: "completed",
        task: expect.objectContaining({
          key: "observed",
          title: "observed task",
        }),
        lease: expect.objectContaining({
          holder: expect.any(String),
          leaseId: expect.any(String),
          fencingToken: expect.any(String),
        }),
      }),
    ]);
  });

  it("does not persist a phantom failure after its fenced lease is stolen", async () => {
    let now = 1000;
    const reg = new TaskLeaseRegistry({
      now: () => now,
      defaultTtlMs: 100,
    });
    reg.addTask({ key: "stolen", title: "stolen" });
    const events = [];
    const settlements = [];
    const runner = new TeamRunner(reg, {
      teammates: 1,
      ttlMs: 100,
      maxTasks: 1,
      now: () => now,
      onEvent: (event) => events.push(event.type),
      afterTask: (settlement) => settlements.push(settlement),
      runTask: async () => {
        now += 1000;
        expect(reg.acquire("stolen", { holder: "external" }).ok).toBe(true);
        throw new Error("old executor failed late");
      },
    });

    const summary = await runner.run();
    expect(summary.done).toBe(false);
    expect(events).toContain("task:failure-discarded");
    expect(events).not.toContain("task:failed");
    expect(settlements).toEqual([
      expect.objectContaining({
        status: "failure-discarded",
        reason: "not_holder_or_expired",
      }),
    ]);
    expect(reg.getTask("stolen")).toMatchObject({
      status: "in_progress",
      lease: { holder: "external" },
    });
  });

  it("keeps workers alive while claims are in durable preparation", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "root", title: "root" });
    for (let index = 0; index < 8; index += 1) {
      reg.addTask({
        key: `leaf-${index}`,
        title: `leaf-${index}`,
        dependsOn: ["root"],
      });
    }
    let active = 0;
    let peak = 0;
    const runner = new TeamRunner(reg, {
      teammates: 8,
      beforeTask: async () => new Promise((resolve) => setImmediate(resolve)),
      runTask: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
      },
    });

    const summary = await runner.run();
    expect(summary.done).toBe(true);
    expect(peak).toBeGreaterThan(1);
  });

  it("abandons prepared reservations when a peer beforeTask fails", async () => {
    const reg = freshRegistry();
    for (const key of ["a", "b", "c"]) {
      reg.addTask({ key, title: key });
    }
    let releasePeers;
    const peerGate = new Promise((resolve) => {
      releasePeers = resolve;
    });
    let executions = 0;
    const runner = new TeamRunner(reg, {
      teammates: 3,
      beforeTask: async ({ key }) => {
        if (key === "a") {
          await Promise.resolve();
          throw new Error("durable claim failed");
        }
        await peerGate;
      },
      runTask: async () => {
        executions += 1;
      },
    });

    const running = runner.run();
    await new Promise((resolve) => setImmediate(resolve));
    releasePeers();
    await expect(running).rejects.toThrow("durable claim failed");
    expect(executions).toBe(0);
    for (const key of ["a", "b", "c"]) {
      expect(reg.getTask(key)).toMatchObject({
        status: "pending",
        lease: null,
      });
    }
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

  it("reserves maxTasks atomically across concurrent teammates", async () => {
    const reg = freshRegistry();
    for (let i = 0; i < 20; i++) {
      reg.addTask({ key: `t${i}`, title: `t${i}` });
    }
    let ran = 0;
    const runner = new TeamRunner(reg, {
      teammates: 16,
      maxTasks: 3,
      runTask: async () => {
        ran++;
        await new Promise((resolve) => setImmediate(resolve));
      },
    });

    const summary = await runner.run();
    expect(summary.done).toBe(false);
    expect(summary.executions).toBe(3);
    expect(ran).toBe(3);
  });
});

describe("TeamRunner team budget", () => {
  it("reserves a team task budget before concurrent claims", async () => {
    const reg = freshRegistry();
    for (let i = 0; i < 20; i++) {
      reg.addTask({ key: `t${i}`, title: `t${i}` });
    }
    let ran = 0;
    const budget = new TeamBudget({ maxTasks: 3 });
    const runner = new TeamRunner(reg, {
      teammates: 16,
      maxTasks: 100,
      budget,
      runTask: async () => {
        ran++;
        await new Promise((resolve) => setImmediate(resolve));
      },
    });

    const summary = await runner.run();
    expect(ran).toBe(3);
    expect(summary.executions).toBe(3);
    expect(summary.budgetReason).toBe("max-tasks");
  });

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

  it("accounts usage attached to a failed agent error", async () => {
    const reg = freshRegistry();
    reg.maxAttempts = 1;
    reg.addTask({ key: "bounded", title: "bounded" });
    const budget = new TeamBudget({ maxTokens: 5 });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      budget,
      runTask: async () => {
        const error = new Error("token limit");
        error.usage = { input_tokens: 3, output_tokens: 2 };
        error.provider = "openai";
        error.model = "test";
        throw error;
      },
    });

    await runner.run();
    expect(budget.status()).toMatchObject({
      tasks: 1,
      tokens: 5,
      reason: "max-tokens",
    });
  });

  it("bounds a concurrent frontier with per-claim token reservations", async () => {
    const reg = freshRegistry();
    for (let index = 0; index < 32; index += 1) {
      reg.addTask({ key: `bounded-${index}`, title: `bounded-${index}` });
    }
    const budget = new TeamBudget({ maxTokens: 160 });
    const observedLimits = [];
    const runner = new TeamRunner(reg, {
      teammates: 16,
      budget,
      budgetForTask: () => ({}),
      runTask: async ({ budgetReservation }) => {
        observedLimits.push(budgetReservation.maxTokens);
        await new Promise((resolve) => setImmediate(resolve));
        return {
          usage: {
            input_tokens: budgetReservation.maxTokens,
            output_tokens: 0,
          },
        };
      },
    });

    const summary = await runner.run();
    expect(summary.done).toBe(false);
    expect(observedLimits).toHaveLength(16);
    expect(observedLimits.reduce((total, limit) => total + limit, 0)).toBe(160);
    expect(budget.status()).toMatchObject({
      tokens: 160,
      reservedTokens: 0,
      reservations: 0,
      reason: "max-tokens",
    });
  });

  it("aborts in-flight task signals at the team wall-clock ceiling", async () => {
    const reg = freshRegistry();
    reg.maxAttempts = 1;
    reg.addTask({ key: "wall", title: "wall" });
    const budget = new TeamBudget({ maxWallMs: 10 });
    let aborted = false;
    const runner = new TeamRunner(reg, {
      teammates: 1,
      budget,
      runTask: ({ signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    });

    const summary = await runner.run();
    expect(aborted).toBe(true);
    expect(summary.budgetStopped).toBe(true);
    expect(summary.budgetReason).toBe("max-wall-ms");
  });

  it("uses only the remaining wall time after budget restore", async () => {
    let priorNow = 1000;
    const prior = new TeamBudget({
      maxWallMs: 500,
      now: () => priorNow,
    });
    prior.record({});
    priorNow = 1450;
    const budget = TeamBudget.restore(prior.snapshot(), {
      now: () => Date.now(),
    });
    const reg = freshRegistry();
    reg.maxAttempts = 1;
    reg.addTask({ key: "remaining-wall", title: "remaining-wall" });
    const startedAt = Date.now();
    const runner = new TeamRunner(reg, {
      teammates: 1,
      budget,
      runTask: ({ signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    });

    const summary = await runner.run();
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(summary.budgetReason).toBe("max-wall-ms");
  });

  it("abandons a prepared claim when beforeTask crosses the wall deadline", async () => {
    let now = 1000;
    const reg = new TaskLeaseRegistry({
      now: () => now,
      defaultTtlMs: 1_000_000,
    });
    reg.addTask({ key: "prepared-wall", title: "prepared-wall" });
    const budget = new TeamBudget({
      maxTokens: 100,
      maxWallMs: 10_000,
      now: () => now,
    });
    let enteredBeforeTask;
    const beforeTaskEntered = new Promise((resolve) => {
      enteredBeforeTask = resolve;
    });
    let releaseBeforeTask;
    const beforeTaskGate = new Promise((resolve) => {
      releaseBeforeTask = resolve;
    });
    const events = [];
    let executions = 0;
    const runner = new TeamRunner(reg, {
      teammates: 1,
      budget,
      onEvent: (event) => events.push(event),
      beforeTask: async () => {
        enteredBeforeTask();
        await beforeTaskGate;
      },
      runTask: async () => {
        executions += 1;
      },
    });

    const running = runner.run();
    await beforeTaskEntered;
    expect(budget.status()).toMatchObject({
      reservations: 1,
      reservedTokens: 100,
    });
    now += 10_000;
    releaseBeforeTask();

    const summary = await running;
    expect(executions).toBe(0);
    expect(summary).toMatchObject({
      done: false,
      executions: 0,
      budgetStopped: true,
      budgetReason: "max-wall-ms",
      stats: { pending: 1, completed: 0 },
      members: [
        expect.objectContaining({
          state: "shutdown",
        }),
      ],
    });
    expect(reg.getTask("prepared-wall")).toMatchObject({
      status: "pending",
      lease: null,
    });
    expect(budget.status()).toMatchObject({
      tasks: 0,
      reservations: 0,
      reservedTokens: 0,
      reason: "max-wall-ms",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run:budget-exhausted",
        reason: "max-wall-ms",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "teammate:state",
        state: "shutdown",
        reason: "max-wall-ms",
      }),
    );
  });

  it("rejects a late executor result after the wall deadline", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "late-wall", title: "late-wall" });
    const budget = new TeamBudget({
      maxWallMs: 10,
    });
    const events = [];
    let executions = 0;
    let signalWasAborted = false;
    const runner = new TeamRunner(reg, {
      teammates: 1,
      budget,
      onEvent: (event) => events.push(event),
      runTask: async ({ signal }) => {
        executions += 1;
        return new Promise((resolve) => {
          const returnLateResult = () => {
            signalWasAborted = signal.aborted;
            // Deliberately turn an abort into a successful-looking result.
            resolve("late result");
          };
          if (signal.aborted) {
            returnLateResult();
            return;
          }
          signal.addEventListener("abort", returnLateResult, { once: true });
        });
      },
    });

    const summary = await runner.run();
    expect(executions).toBe(1);
    expect(signalWasAborted).toBe(true);
    expect(summary).toMatchObject({
      done: false,
      success: false,
      executions: 1,
      budgetStopped: true,
      budgetReason: "max-wall-ms",
      stats: { pending: 1, completed: 0 },
    });
    expect(reg.getTask("late-wall")).toMatchObject({
      status: "pending",
      lease: null,
      metadata: {
        lastError: "Team wall-clock budget exhausted",
      },
    });
    expect(budget.status()).toMatchObject({
      tasks: 1,
      reservations: 0,
      reason: "max-wall-ms",
    });
    expect(events.some((event) => event.type === "task:completed")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "task:failed",
        retry: true,
        error: "Team wall-clock budget exhausted",
      }),
    );
  });

  it("does not complete a task whose USD-capped usage cannot be priced", async () => {
    const reg = freshRegistry();
    reg.maxAttempts = 3;
    reg.addTask({ key: "unpriced", title: "unpriced" });
    const budget = new TeamBudget({ maxUsd: 1 });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      budget,
      runTask: async () => ({
        provider: "unknown-remote",
        model: "unpriced-model",
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    });

    const summary = await runner.run();
    expect(summary).toMatchObject({
      done: true,
      success: false,
      budgetStopped: true,
      budgetReason: "unpriced-usage",
      stats: { cancelled: 1, completed: 0 },
    });
    expect(reg.getTask("unpriced").metadata.lastError).toMatch(
      /cannot account for unpriced remote usage/,
    );
  });

  it("does not retry an explicitly non-retryable failure", async () => {
    const reg = freshRegistry();
    reg.maxAttempts = 3;
    reg.addTask({ key: "unsafe", title: "unsafe" });
    let executions = 0;
    const runner = new TeamRunner(reg, {
      teammates: 1,
      runTask: async () => {
        executions += 1;
        const error = new Error("requires adjudication");
        error.retryable = false;
        throw error;
      },
    });

    const summary = await runner.run();
    expect(executions).toBe(1);
    expect(summary).toMatchObject({
      done: true,
      success: false,
      stats: { cancelled: 1 },
    });
  });
});

describe("TeamRunner human takeover", () => {
  it("interrupts an active task and fails it closed for adjudication", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "deploy", title: "deploy" });
    const events = [];
    let started;
    const taskStarted = new Promise((resolve) => {
      started = resolve;
    });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      onEvent: (event) => events.push(event),
      runTask: async ({ signal }) => {
        started();
        await new Promise((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason || new Error("aborted")),
            { once: true },
          );
        });
      },
    });

    const running = runner.run();
    await taskStarted;
    expect(runner.activeClaims()).toEqual([
      expect.objectContaining({
        key: "deploy",
        holder: "teammate-1",
        leaseId: expect.any(String),
        fencingToken: expect.any(String),
        interrupted: false,
      }),
    ]);
    const attempt = activeAttempt(runner, "deploy");
    expect(
      runner.interruptTask("deploy", {
        ...attempt,
        reason: "operator taking control",
        actor: "alice",
        requestId: "interrupt-1",
        evidenceDigest: "sha256:interrupt-evidence",
      }),
    ).toMatchObject({ ok: true });

    const summary = await running;
    expect(summary).toMatchObject({
      done: false,
      success: false,
      stats: {
        cancelled: 1,
        adjudicationRequired: 1,
      },
    });
    expect(reg.getTask("deploy")).toMatchObject({
      status: "cancelled",
      metadata: {
        adjudication: {
          required: true,
          code: "TEAM_TASK_HUMAN_INTERRUPTED",
          evidenceDigest: "sha256:interrupt-evidence",
        },
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "task:interrupt-requested",
        key: "deploy",
        requestId: "interrupt-1",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "task:failed",
        key: "deploy",
        retry: false,
        interrupted: true,
        requestId: "interrupt-1",
      }),
    );
    expect(runner.activeClaims()).toEqual([]);
  });

  it("rejects missing or stale attempt bindings without aborting current work", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "deploy", title: "deploy" });
    let started;
    const taskStarted = new Promise((resolve) => {
      started = resolve;
    });
    let taskSignal;
    const runner = new TeamRunner(reg, {
      teammates: 1,
      runTask: async ({ signal }) => {
        taskSignal = signal;
        started();
        await new Promise((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason || new Error("aborted")),
            { once: true },
          );
        });
      },
    });

    const running = runner.run();
    await taskStarted;
    const attempt = activeAttempt(runner, "deploy");
    expect(runner.interruptTask("deploy")).toEqual({
      ok: false,
      reason: "stale_attempt",
    });
    for (const stale of [
      { ...attempt, holder: "teammate-2" },
      { ...attempt, leaseId: `${attempt.leaseId}-old` },
      { ...attempt, fencingToken: 1 },
    ]) {
      expect(runner.interruptTask("deploy", stale)).toEqual({
        ok: false,
        reason: "stale_attempt",
      });
    }
    expect(taskSignal.aborted).toBe(false);

    expect(
      runner.interruptTask("deploy", {
        ...attempt,
        requestId: "interrupt-current-attempt",
      }),
    ).toMatchObject({ ok: true });
    await running;
    expect(taskSignal.aborted).toBe(true);
  });

  it("persists only a changed lease identity after expired-lease reacquire", async () => {
    let now = 1_000;
    const reg = new TaskLeaseRegistry({
      now: () => now,
      defaultTtlMs: 50,
    });
    reg.addTask({ key: "deploy", title: "deploy" });
    let started;
    const taskStarted = new Promise((resolve) => {
      started = resolve;
    });
    const leaseChanges = [];
    const runner = new TeamRunner(reg, {
      teammates: 1,
      ttlMs: 50,
      renewEveryMs: 1_000_000,
      onLeaseChanged: (change) => leaseChanges.push(change),
      runTask: async (context) => {
        started(context);
        await new Promise((resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(context.signal.reason || new Error("aborted")),
            { once: true },
          );
        });
      },
    });

    const running = runner.run();
    const context = await taskStarted;
    const initial = activeAttempt(runner, "deploy");
    expect(context.renew()).toMatchObject({ ok: true });
    expect(activeAttempt(runner, "deploy")).toEqual(initial);
    expect(leaseChanges).toEqual([]);

    now = 1_100;
    expect(context.renew()).toMatchObject({ ok: true });
    const reacquired = activeAttempt(runner, "deploy");
    expect(reacquired.leaseId).not.toBe(initial.leaseId);
    expect(reacquired.fencingToken).not.toBe(initial.fencingToken);
    expect(leaseChanges).toEqual([
      expect.objectContaining({
        key: "deploy",
        holder: reacquired.holder,
        previousLeaseId: initial.leaseId,
        leaseId: reacquired.leaseId,
        previousFencingToken: initial.fencingToken,
        fencingToken: reacquired.fencingToken,
      }),
    ]);

    expect(
      runner.interruptTask("deploy", {
        ...initial,
        requestId: "interrupt-old-attempt",
      }),
    ).toEqual({ ok: false, reason: "stale_attempt" });
    expect(
      runner.interruptTask("deploy", {
        ...reacquired,
        requestId: "interrupt-new-attempt",
      }),
    ).toMatchObject({ ok: true });
    await running;
  });

  it("fails closed when a changed lease identity cannot be persisted", async () => {
    let now = 1_000;
    const reg = new TaskLeaseRegistry({
      now: () => now,
      defaultTtlMs: 50,
    });
    reg.addTask({ key: "remote-write", title: "remote-write" });
    let started;
    const taskStarted = new Promise((resolve) => {
      started = resolve;
    });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      ttlMs: 50,
      renewEveryMs: 1_000_000,
      onLeaseChanged: () => {
        throw new Error("state persistence unavailable");
      },
      runTask: async (context) => {
        started(context);
        await new Promise((resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(context.signal.reason || new Error("aborted")),
            { once: true },
          );
        });
      },
    });

    const running = runner.run();
    const context = await taskStarted;
    now = 1_100;
    const renewal = context.renew();
    expect(renewal).toMatchObject({
      ok: false,
      reason: "lease_change_persist_failed",
      error: {
        code: "TEAM_LEASE_CHANGE_PERSIST_FAILED",
        retryable: false,
      },
    });
    expect(context.signal).toMatchObject({ aborted: true });
    expect(context.signal.reason).toMatchObject({
      code: "TEAM_LEASE_CHANGE_PERSIST_FAILED",
      adjudication: {
        code: "TEAM_LEASE_CHANGE_PERSIST_FAILED",
        leaseId: activeAttempt(runner, "remote-write").leaseId,
      },
    });
    await expect(running).rejects.toMatchObject({
      code: "TEAM_LEASE_CHANGE_PERSIST_FAILED",
    });
    expect(reg.getTask("remote-write")).toMatchObject({
      status: "cancelled",
      metadata: {
        adjudication: {
          required: true,
          code: "TEAM_LEASE_CHANGE_PERSIST_FAILED",
        },
      },
    });
  });

  it("fails closed when an executor ignores abort and returns a result", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "remote-write", title: "remote-write" });
    const budget = new TeamBudget({ maxTokens: 100 });
    let started;
    let finish;
    const taskStarted = new Promise((resolve) => {
      started = resolve;
    });
    const mayFinish = new Promise((resolve) => {
      finish = resolve;
    });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      budget,
      runTask: async () => {
        started();
        await mayFinish;
        return {
          usage: { input_tokens: 3, output_tokens: 2 },
          provider: "test",
          model: "test-model",
        };
      },
    });

    const running = runner.run();
    await taskStarted;
    const attempt = activeAttempt(runner, "remote-write");
    expect(
      runner.interruptTask("remote-write", {
        ...attempt,
        requestId: "interrupt-race",
      }),
    ).toMatchObject({ ok: true });
    expect(
      runner.interruptTask("remote-write", {
        ...attempt,
        requestId: "interrupt-race",
      }),
    ).toMatchObject({ ok: true, idempotent: true });
    expect(
      runner.interruptTask("remote-write", {
        ...attempt,
        requestId: "interrupt-conflict",
      }),
    ).toEqual({ ok: false, reason: "already_interrupted" });
    finish();

    await running;
    expect(reg.getTask("remote-write")).toMatchObject({
      status: "cancelled",
      metadata: {
        adjudication: { required: true },
      },
    });
    expect(budget.status()).toMatchObject({
      tasks: 1,
      tokens: 5,
    });
    expect(runner.interruptTask("remote-write")).toEqual({
      ok: false,
      reason: "not_active",
    });
  });

  it("aborts all active work fail-closed on a coordinator control failure", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "a", title: "a" });
    reg.addTask({ key: "b", title: "b" });
    let started = 0;
    let bothStarted;
    const ready = new Promise((resolve) => {
      bothStarted = resolve;
    });
    const runner = new TeamRunner(reg, {
      teammates: 2,
      runTask: ({ signal }) =>
        new Promise((resolve, reject) => {
          started += 1;
          if (started === 2) bothStarted();
          signal.addEventListener(
            "abort",
            () => reject(new Error("generic executor abort")),
            { once: true },
          );
        }),
    });

    const running = runner.run();
    await ready;
    const failure = new Error("control log rolled back");
    failure.code = "TEAM_CONTROL_ROLLBACK";
    expect(runner.abortRun(failure)).toEqual({
      ok: true,
      activeClaims: 2,
    });
    await expect(running).rejects.toThrow("control log rolled back");
    for (const key of ["a", "b"]) {
      expect(reg.getTask(key)).toMatchObject({
        status: "cancelled",
        metadata: {
          adjudication: {
            required: true,
            code: "TEAM_CONTROL_ROLLBACK",
          },
        },
      });
    }
  });

  it("waits for canonical run cancellation and fences legacy failure settlement", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "remote-write", title: "remote write" });
    let taskStarted;
    const started = new Promise((resolve) => {
      taskStarted = resolve;
    });
    let cancellationFinished;
    const finishCancellation = new Promise((resolve) => {
      cancellationFinished = resolve;
    });
    const canonicalSettlement = vi.fn();
    const canonicalCancellation = vi.fn(async () => {
      await finishCancellation;
      return { status: "reconciliation_required" };
    });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      canonicalSettlement,
      canonicalCancellation,
      runTask: ({ signal }) =>
        new Promise((resolve, reject) => {
          taskStarted();
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    });

    const running = runner.run();
    await started;
    const failure = new Error("control authority corrupt");
    failure.code = "TEAM_CONTROL_CORRUPT";
    runner.abortRun(failure);
    expect(canonicalCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "control authority corrupt",
        requireAdjudication: true,
      }),
    );
    let runSettled = false;
    running.catch(() => {
      runSettled = true;
    });
    await Promise.resolve();
    expect(runSettled).toBe(false);
    cancellationFinished();
    await expect(running).rejects.toThrow("control authority corrupt");
    expect(canonicalSettlement).not.toHaveBeenCalled();
    expect(reg.getTask("remote-write")).toMatchObject({
      status: "cancelled",
      metadata: { adjudication: { required: true } },
    });
  });

  it("fails closed when canonical run cancellation cannot be recorded", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "remote-write", title: "remote write" });
    let taskStarted;
    const started = new Promise((resolve) => {
      taskStarted = resolve;
    });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      canonicalCancellation: async () => {
        throw new Error("graph writer unavailable");
      },
      runTask: ({ signal }) =>
        new Promise((resolve, reject) => {
          taskStarted();
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    });

    const running = runner.run();
    await started;
    runner.abortRun(new Error("control authority corrupt"));
    await expect(running).rejects.toMatchObject({
      code: "CC_TEAM_GRAPH_CANCEL_FAILED",
      message: expect.stringContaining("graph writer unavailable"),
    });
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

  it("keeps real-time inbox messages pending until an attempt-bound ACK", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "task", title: "task" });
    const mailbox = new TeamMailbox({
      recipients: ["coordinator", "teammate-1"],
    });
    const message = mailbox.send({
      from: "coordinator",
      to: "teammate-1",
      body: "process me",
    });
    let authority = null;
    let authorityFn = null;
    const runner = new TeamRunner(reg, {
      teammates: 1,
      mailbox,
      realtimeMessaging: true,
      runTask: async ({
        inbox,
        sendMessage,
        messageAuthority,
        recipientState,
      }) => {
        authorityFn = messageAuthority;
        expect(inbox.map((entry) => entry.id)).toEqual([message.id]);
        expect(mailbox.peek("teammate-1")).toHaveLength(1);
        authority = messageAuthority();
        expect(
          sendMessage("coordinator", "attempt-bound", null, {
            senderAttempt: { taskKey: "forged" },
          }).senderAttempt,
        ).toEqual(authority);
        expect(recipientState("teammate-1")).toMatchObject({
          state: "running",
        });
        mailbox.acknowledge("teammate-1", {
          messageIds: [message.id],
          consumerKey: "task-consumer",
          recipientAttempt: authority,
        });
        return "ok";
      },
    });

    await expect(runner.run()).resolves.toMatchObject({ success: true });
    expect(authority).toMatchObject({
      holder: "teammate-1",
      taskKey: "task",
      leaseId: expect.any(String),
      fencingToken: expect.any(String),
    });
    expect(mailbox.peek("teammate-1")).toEqual([]);
    expect(() => authorityFn()).toThrowError(
      expect.objectContaining({ code: "TEAM_MESSAGE_BRIDGE_STALE_ATTEMPT" }),
    );
  });

  it("materializes an idle recipient follow-up as a targeted lease-bound turn", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "sender", title: "sender" });
    reg.addTask({ key: "receiver", title: "receiver" });
    const mailbox = new TeamMailbox();
    const persisted = [];
    const executions = [];
    let receiverWasRunning = false;
    let resolveReceiverIdle;
    const receiverIdle = new Promise((resolve) => {
      resolveReceiverIdle = resolve;
    });
    let wakeResult = null;
    const runner = new TeamRunner(reg, {
      teammates: 2,
      mailbox,
      realtimeMessaging: true,
      onFollowupMutation: (event) => persisted.push(event),
      onEvent: (event) => {
        if (
          event.type === "teammate:state" &&
          event.holder === "teammate-2" &&
          event.state === "running"
        ) {
          receiverWasRunning = true;
        }
        if (
          receiverWasRunning &&
          event.type === "teammate:state" &&
          event.holder === "teammate-2" &&
          event.state === "idle"
        ) {
          resolveReceiverIdle();
        }
      },
      runTask: async (context) => {
        executions.push({
          key: context.key,
          holder: context.holder,
          followup: context.task.metadata?.teamFollowup || null,
        });
        if (context.key === "receiver") return "receiver-ready";
        if (context.key === "sender") {
          await receiverIdle;
          const authority = context.messageAuthority();
          const message = context.sendMessage(
            "teammate-2",
            { request: "confirm" },
            "explicit follow-up",
            {
              mode: "followup",
              idempotencyKey: "idle-followup-v1",
            },
          );
          wakeResult = context.requestFollowupWake({
            to: "teammate-2",
            message,
            senderAttempt: authority,
          });
          return "sent";
        }
        const followup = context.task.metadata?.teamFollowup;
        expect(followup).toMatchObject({
          recipient: "teammate-2",
          sessionTaskKey: "receiver",
          wakeAttempt: 1,
        });
        expect(context.holder).toBe("teammate-2");
        const message = context.inbox.find(
          (candidate) => candidate.id === followup.messageId,
        );
        expect(message?.body).toEqual({ request: "confirm" });
        mailbox.acknowledge("teammate-2", {
          messageIds: [message.id],
          consumerKey: "receiver-followup-v1",
          recipientAttempt: context.messageAuthority(),
        });
        return "followup-processed";
      },
    });

    const summary = await runner.run();
    expect(summary.success).toBe(true);
    expect(summary.executions).toBe(3);
    expect(wakeResult).toMatchObject({
      wake: "turn_scheduled",
      recipients: [
        {
          recipient: "teammate-2",
          wake: "turn_scheduled",
          wakeAttempt: 1,
        },
      ],
    });
    expect(executions.find((execution) => execution.followup)?.holder).toBe(
      "teammate-2",
    );
    expect(persisted).toContainEqual(
      expect.objectContaining({ type: "followup:wake-scheduled" }),
    );
    expect(mailbox.peek("teammate-2")).toEqual([]);
  });

  it("reconciles a committed follow-up message into a new turn after restart", async () => {
    const reg = freshRegistry();
    for (const key of ["sender", "receiver"]) {
      reg.addTask({ key, title: key });
      const acquired = reg.acquire(key, { holder: `old-${key}` });
      reg.complete(key, {
        holder: `old-${key}`,
        leaseId: acquired.lease.leaseId,
        result: `${key}-done`,
      });
    }
    const mailbox = new TeamMailbox({
      recipients: ["teammate-1", "teammate-2"],
    });
    const followup = mailbox.send({
      from: "teammate-1",
      to: "teammate-2",
      body: "recover me",
      mode: "followup",
      idempotencyKey: "restart-followup-v1",
      senderAttempt: {
        holder: "teammate-1",
        taskKey: "sender",
        attempt: 1,
        leaseId: "old-sender-lease",
        fencingToken: "old-sender-fence",
      },
    });
    const persisted = [];
    const executed = [];
    const runner = new TeamRunner(reg, {
      teammates: 2,
      mailbox,
      realtimeMessaging: true,
      onFollowupMutation: (event) => persisted.push(event),
      runTask: async (context) => {
        executed.push({ key: context.key, holder: context.holder });
        expect(context.task.metadata.teamFollowup).toMatchObject({
          messageId: followup.id,
          sessionTaskKey: "receiver",
        });
        mailbox.acknowledge("teammate-2", {
          messageIds: [followup.id],
          consumerKey: "restart-consumer-v1",
          recipientAttempt: context.messageAuthority(),
        });
        return "recovered";
      },
    });
    runner.seedMembers([
      {
        holder: "teammate-1",
        state: "shutdown",
        completed: 1,
        failed: 0,
        lastTaskKey: "sender",
        sessionTaskKey: "sender",
      },
      {
        holder: "teammate-2",
        state: "shutdown",
        completed: 1,
        failed: 0,
        lastTaskKey: "receiver",
        sessionTaskKey: "receiver",
      },
    ]);

    const summary = await runner.run();
    expect(summary.success).toBe(true);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({ holder: "teammate-2" });
    expect(persisted).toContainEqual(
      expect.objectContaining({
        type: "followup:wake-scheduled",
        messageId: followup.id,
      }),
    );
    expect(mailbox.peek("teammate-2")).toEqual([]);
  });

  it("keeps a follow-up queued when the restored recipient is not resident", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "receiver", title: "receiver" });
    const acquired = reg.acquire("receiver", { holder: "old-receiver" });
    reg.complete("receiver", {
      holder: "old-receiver",
      leaseId: acquired.lease.leaseId,
    });
    const mailbox = new TeamMailbox({
      recipients: ["teammate-1", "teammate-2"],
    });
    const followup = mailbox.send({
      from: "coordinator",
      to: "teammate-2",
      body: "wait until this teammate is resident again",
      mode: "followup",
      idempotencyKey: "offline-followup-v1",
    });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      mailbox,
      realtimeMessaging: true,
      runTask: async () => {
        throw new Error(
          "an offline target must not be executed by another holder",
        );
      },
    });
    runner.seedMembers([
      {
        holder: "teammate-2",
        state: "shutdown",
        completed: 1,
        failed: 0,
        lastTaskKey: "receiver",
        sessionTaskKey: "receiver",
      },
    ]);

    await expect(runner.run()).resolves.toMatchObject({
      success: true,
      executions: 0,
      activeTeammates: 1,
    });
    expect(mailbox.peek("teammate-2").map((message) => message.id)).toEqual([
      followup.id,
    ]);
    expect(
      reg.list().filter((task) => task.metadata?.teamFollowup),
    ).toHaveLength(0);
  });

  it("dead-letters an unacknowledged follow-up after bounded wake turns", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "receiver", title: "receiver" });
    let dependency = "receiver";
    for (const key of ["receiver"]) {
      const acquired = reg.acquire(key, { holder: "old-receiver" });
      reg.complete(key, {
        holder: "old-receiver",
        leaseId: acquired.lease.leaseId,
      });
    }
    const mailbox = new TeamMailbox({ recipients: ["teammate-1"] });
    const followup = mailbox.send({
      from: "coordinator",
      to: "teammate-1",
      body: "poison follow-up",
      mode: "followup",
      idempotencyKey: "poison-followup-v1",
    });
    for (let wakeAttempt = 1; wakeAttempt <= 3; wakeAttempt++) {
      const key = `existing-wake-${wakeAttempt}`;
      reg.addTask({
        key,
        title: key,
        dependsOn: [dependency],
        metadata: {
          teamFollowup: {
            messageId: followup.id,
            recipient: "teammate-1",
            sessionTaskKey: "receiver",
            wakeAttempt,
          },
        },
      });
      const acquired = reg.acquire(key, { holder: "old-receiver" });
      reg.complete(key, {
        holder: "old-receiver",
        leaseId: acquired.lease.leaseId,
      });
      dependency = key;
    }
    const events = [];
    const runner = new TeamRunner(reg, {
      teammates: 1,
      mailbox,
      realtimeMessaging: true,
      maxFollowupWakes: 3,
      onEvent: (event) => events.push(event),
      runTask: async () => {
        throw new Error("no fourth wake turn should run");
      },
    });
    runner.seedMembers([
      {
        holder: "teammate-1",
        state: "shutdown",
        completed: 4,
        failed: 0,
        lastTaskKey: dependency,
        sessionTaskKey: "receiver",
      },
    ]);

    await expect(runner.run()).resolves.toMatchObject({ success: true });
    expect(mailbox.peek("teammate-1")).toEqual([]);
    expect(mailbox.status().counters.deadLetteredMessages).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "followup:dead-lettered",
        messageId: followup.id,
      }),
    );
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

  it("surfaces bounded mailbox backpressure without evicting messages", async () => {
    const reg = freshRegistry();
    reg.maxAttempts = 1;
    reg.addTask({ key: "noisy", title: "noisy" });
    const mailbox = new TeamMailbox({
      maxMessages: 1,
      maxMessageBytes: 512,
      maxTotalBytes: 1024,
      recipients: ["teammate-1", "coordinator"],
    });
    const events = [];
    const runner = new TeamRunner(reg, {
      teammates: 1,
      mailbox,
      onEvent: (event) => events.push(event),
      runTask: async ({ sendMessage }) => {
        sendMessage("coordinator", "first");
        sendMessage("coordinator", "second");
      },
    });

    const summary = await runner.run();
    expect(summary.done).toBe(true);
    expect(summary.success).toBe(false);
    expect(summary.stats.cancelled).toBe(1);
    expect(mailbox.log().map((message) => message.body)).toEqual(["first"]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "mailbox:backpressure",
        code: "TEAM_MAILBOX_CAPACITY_EXCEEDED",
      }),
    );
  });
});

describe("TeamRunner durable custody handoff", () => {
  const revisionDigest = `sha256:${"a".repeat(64)}`;
  const authorityDigest = `sha256:${"b".repeat(64)}`;

  it("runs offer/accept/commit on live attempts and dispatches only the target fence", async () => {
    const reg = freshRegistry();
    reg.addTask({ key: "source", title: "source" });
    reg.addTask({ key: "recipient-turn", title: "recipient turn" });
    const mailbox = new TeamMailbox({
      recipients: ["teammate-1", "teammate-2"],
    });
    const mutations = [];
    const events = [];
    let resolveOffered;
    let resolveAccepted;
    const offered = new Promise((resolve) => {
      resolveOffered = resolve;
    });
    const accepted = new Promise((resolve) => {
      resolveAccepted = resolve;
    });
    let sourceSignalAborted = false;
    let targetContext = null;

    const runner = new TeamRunner(reg, {
      teammates: 2,
      mailbox,
      realtimeMessaging: true,
      graphRevisionDigest: revisionDigest,
      graphAuthorityDigest: authorityDigest,
      onHandoffMutation: (event) => mutations.push(event),
      onEvent: (event) => events.push(event),
      runTask: async (context) => {
        if (context.key === "source" && context.holder === "teammate-1") {
          const result = context.requestHandoff({
            action: "offer",
            handoffId: "handoff-live",
            to: "teammate-2",
            artifactIds: ["artifact-1"],
            preconditions: { tests: "green" },
            summary: { next: "finish source" },
            ttlMs: 60_000,
          });
          resolveOffered(result);
          await accepted;
          context.requestHandoff({
            action: "commit",
            handoffId: "handoff-live",
          });
          sourceSignalAborted = context.signal.aborted;
          return { staleSourceResult: true };
        }
        if (context.key === "recipient-turn") {
          await offered;
          const result = context.requestHandoff({
            action: "accept",
            handoffId: "handoff-live",
          });
          resolveAccepted(result);
          return { accepted: true };
        }
        if (context.key === "source" && context.holder === "teammate-2") {
          targetContext = context;
          return { completedByTarget: true };
        }
        throw new Error(
          `unexpected execution ${context.key}/${context.holder}`,
        );
      },
    });

    const summary = await runner.run();
    expect(summary).toMatchObject({
      done: true,
      success: true,
      executions: 3,
    });
    expect(sourceSignalAborted).toBe(true);
    expect(targetContext).toMatchObject({
      key: "source",
      holder: "teammate-2",
    });
    expect(targetContext.inbox).toContainEqual(
      expect.objectContaining({
        subject: "Committed task custody handoff",
        body: expect.objectContaining({
          handoffId: "handoff-live",
          summary: { next: "finish source" },
          preconditions: { tests: "green" },
        }),
      }),
    );
    expect(reg.getTask("source")).toMatchObject({
      status: "completed",
      assignee: "teammate-2",
      metadata: { result: { completedByTarget: true } },
    });
    expect(reg.getTask("source").metadata.custodyHandoffs.at(-1)).toMatchObject(
      {
        id: "handoff-live",
        status: "committed",
        targetSettlement: "completed",
      },
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "task:failure-discarded",
        key: "source",
        holder: "teammate-1",
        reason: "not_holder_or_expired",
      }),
    );
    expect(mutations.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "handoff:offered",
        "handoff:accepted",
        "handoff:committed",
        "handoff:target-started",
      ]),
    );
  });

  it("recovers a committed-before-dispatch snapshot with a fresh target fence", async () => {
    let now = 1000;
    const original = new TaskLeaseRegistry({
      now: () => now,
      defaultTtlMs: 100,
    });
    original.addTask({ key: "source", title: "source" });
    const source = original.acquire("source", { holder: "teammate-1" });
    original.offerHandoff("source", {
      handoffId: "handoff-recovery",
      holder: "teammate-1",
      leaseId: source.lease.leaseId,
      toHolder: "teammate-2",
      revisionDigest,
      authorityDigest,
      ttlMs: 60_000,
    });
    original.acceptHandoff("handoff-recovery", { holder: "teammate-2" });
    const committed = original.commitHandoff("handoff-recovery", {
      holder: "teammate-1",
      leaseId: source.lease.leaseId,
      ttlMs: 100,
    });
    const snapshot = JSON.parse(JSON.stringify(original.snapshot()));
    now += 200;
    const restored = TaskLeaseRegistry.restore(snapshot, { now: () => now });
    const startedSnapshots = [];
    let execution = null;
    const runner = new TeamRunner(restored, {
      teammates: 2,
      ttlMs: 1000,
      graphRevisionDigest: revisionDigest,
      graphAuthorityDigest: authorityDigest,
      onHandoffMutation: (event) => {
        if (event.type === "handoff:target-started") {
          startedSnapshots.push(restored.snapshot());
        }
      },
      runTask: async (context) => {
        execution = {
          key: context.key,
          holder: context.holder,
          authority: context.messageAuthority(),
        };
        return { recovered: true };
      },
    });

    const summary = await runner.run();
    expect(summary).toMatchObject({ done: true, success: true, executions: 1 });
    expect(execution).toMatchObject({ key: "source", holder: "teammate-2" });
    expect(execution.authority).toMatchObject({
      holder: "teammate-2",
      taskKey: "source",
    });
    expect(execution.authority.leaseId).not.toBe(committed.lease.leaseId);
    expect(startedSnapshots).toHaveLength(1);
    const startedRegistry = TaskLeaseRegistry.restore(startedSnapshots[0], {
      now: () => now,
    });
    expect(
      startedRegistry.findHandoff("handoff-recovery").handoff.targetStartedAt,
    ).toBe(now);
    expect(
      restored.getTask("source").metadata.custodyHandoffs.at(-1),
    ).toMatchObject({
      status: "committed",
      targetSettledAt: now,
      targetSettlement: "completed",
    });
  });

  it("expires an uncommitted offer and dead-letters its wake notification", async () => {
    let now = 1000;
    const reg = new TaskLeaseRegistry({
      now: () => now,
      defaultTtlMs: 1_000_000,
    });
    reg.addTask({ key: "source", title: "source" });
    reg.addTask({ key: "recipient-turn", title: "recipient turn" });
    const mailbox = new TeamMailbox({
      now: () => now,
      recipients: ["teammate-1", "teammate-2"],
    });
    const mutations = [];
    let runner;
    runner = new TeamRunner(reg, {
      teammates: 2,
      now: () => now,
      mailbox,
      realtimeMessaging: true,
      graphRevisionDigest: revisionDigest,
      graphAuthorityDigest: authorityDigest,
      onHandoffMutation: (event) => mutations.push(event),
      runTask: async ({ key, holder, requestHandoff }) => {
        if (key === "source") {
          expect(holder).toBe("teammate-1");
          requestHandoff({
            action: "offer",
            handoffId: "handoff-expiry",
            to: "teammate-2",
            ttlMs: 10,
          });
          now += 10;
          runner._expireHandoffs();
        }
        return { ok: true };
      },
    });

    const summary = await runner.run();
    expect(summary).toMatchObject({ success: true, executions: 2 });
    expect(reg.findHandoff("handoff-expiry").handoff).toMatchObject({
      status: "expired",
      expiredAt: 1010,
    });
    expect(
      mailbox.snapshot().receipts.map(([, receipt]) => receipt),
    ).toContainEqual(
      expect.objectContaining({
        recipient: "teammate-2",
        status: "dead_letter",
        reason: "handoff_expired",
      }),
    );
    expect(mutations).toContainEqual(
      expect.objectContaining({
        type: "handoff:expired",
        handoffId: "handoff-expiry",
      }),
    );
    expect(
      reg
        .list()
        .filter((task) => task.metadata?.teamFollowup)
        .map((task) => task.key),
    ).toEqual([]);
  });
});

describe("TeamRunner teammate lifecycle", () => {
  it("emits TeammateIdle only for a real transition back to idle", () => {
    const reg = freshRegistry();
    const hooks = [];
    const runner = new TeamRunner(reg, {
      runTask: async () => "ok",
      emitHook: (event, context) => hooks.push({ event, context }),
    });

    runner._setState("teammate-1", "idle");
    runner._setState("teammate-1", "running", { key: "task-a" });
    runner._setState("teammate-1", "completed-task");
    runner._setState("teammate-1", "idle", { reason: "waiting-for-peer" });
    runner._setState("teammate-1", "idle");

    expect(hooks).toEqual([
      {
        event: "TeammateIdle",
        context: {
          schema_version: 1,
          holder: "teammate-1",
          state: "idle",
          previous_state: "running",
          completed: 1,
          failed: 0,
          reason: "waiting-for-peer",
        },
      },
    ]);
  });

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
