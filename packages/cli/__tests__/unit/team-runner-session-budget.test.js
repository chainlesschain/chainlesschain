import { describe, expect, it } from "vitest";
import { TeamBudget } from "../../src/lib/agent-team/team-budget.js";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";
import { SessionResourceBudget } from "../../src/lib/session-resource-budget.js";

function registry(maxAttempts = 1) {
  return new TaskLeaseRegistry({
    now: () => 1000,
    defaultTtlMs: 1_000_000,
    maxAttempts,
  });
}

describe("TeamRunner shared session budget", () => {
  it("caps team concurrency through the same session authority", async () => {
    const tasks = registry();
    for (const key of ["a", "b", "c"]) {
      tasks.addTask({ key, title: key });
    }
    const sessionBudget = new SessionResourceBudget({
      maxConcurrent: 1,
      maxSpawns: 3,
    });
    let active = 0;
    let peak = 0;
    const runner = new TeamRunner(tasks, {
      teammates: 3,
      sessionBudget,
      runTask: async ({ sessionBudget: inherited }) => {
        expect(inherited).not.toBe(sessionBudget);
        expect(inherited.signal).toBe(sessionBudget.signal);
        expect(inherited.status().active).toBe(1);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return {};
      },
    });

    const summary = await runner.run();

    expect(summary.success).toBe(true);
    expect(peak).toBe(1);
    expect(sessionBudget.status()).toMatchObject({
      active: 0,
      spawns: 3,
      resources: 0,
    });
    sessionBudget.dispose();
  });

  it("fences executor side effects when the session aborts during beforeTask", async () => {
    const tasks = registry();
    tasks.addTask({ key: "write", title: "write" });
    const sessionBudget = new SessionResourceBudget({ maxConcurrent: 1 });
    let enteredBeforeTask;
    const beforeTaskEntered = new Promise((resolve) => {
      enteredBeforeTask = resolve;
    });
    let finishBeforeTask;
    const beforeTaskMayFinish = new Promise((resolve) => {
      finishBeforeTask = resolve;
    });
    let sideEffects = 0;
    const runner = new TeamRunner(tasks, {
      teammates: 1,
      sessionBudget,
      beforeTask: async () => {
        enteredBeforeTask();
        await beforeTaskMayFinish;
      },
      // Deliberately ignores AbortSignal. The authority fence, not executor
      // cooperation, must prevent the external write.
      runTask: async () => {
        sideEffects += 1;
      },
    });

    const running = runner.run();
    await beforeTaskEntered;
    sessionBudget.abort("operator stopped session", {
      reason: "operator-stop",
    });
    finishBeforeTask();
    const summary = await running;

    expect(sideEffects).toBe(0);
    expect(summary).toMatchObject({
      success: false,
      budgetStopped: true,
      budgetReason: "operator-stop",
    });
    expect(tasks.getTask("write")).toMatchObject({
      status: "pending",
      metadata: { lease: null },
    });
    expect(sessionBudget.status()).toMatchObject({
      active: 0,
      resources: 0,
    });
    sessionBudget.dispose();
  });

  it("rechecks the authority immediately before calling runTask", async () => {
    const tasks = registry();
    tasks.addTask({ key: "write", title: "write" });
    const sessionBudget = new SessionResourceBudget({ maxConcurrent: 1 });
    let sideEffects = 0;
    const runner = new TeamRunner(tasks, {
      teammates: 1,
      sessionBudget,
      onEvent: (event) => {
        if (event.type === "task:claimed") {
          sessionBudget.abort("observer stopped session", {
            reason: "observer-stop",
          });
        }
      },
      runTask: async () => {
        sideEffects += 1;
      },
    });

    const summary = await runner.run();

    expect(sideEffects).toBe(0);
    expect(summary).toMatchObject({
      success: false,
      budgetReason: "observer-stop",
    });
    expect(tasks.getTask("write")).toMatchObject({ status: "cancelled" });
    expect(sessionBudget.status()).toMatchObject({
      active: 0,
      resources: 0,
    });
    sessionBudget.dispose();
  });

  it("does not double-charge usage recorded through the inherited authority", async () => {
    const tasks = registry(2);
    tasks.addTask({ key: "retry", title: "retry" });
    const sessionBudget = new SessionResourceBudget({
      maxConcurrent: 1,
      maxSpawns: 3,
      maxTokens: 100,
    });
    let attempts = 0;
    const runner = new TeamRunner(tasks, {
      teammates: 1,
      sessionBudget,
      runTask: async ({ sessionBudget: inherited }) => {
        attempts += 1;
        const usage = { input_tokens: 1, output_tokens: 1 };
        inherited.recordUsage({ usage });
        if (attempts === 1) throw new Error("retry once");
        return { usage };
      },
    });

    const summary = await runner.run();

    expect(summary.success).toBe(true);
    expect(attempts).toBe(2);
    expect(sessionBudget.status()).toMatchObject({
      spawns: 2,
      tokens: 4,
      active: 0,
      resources: 0,
    });
    expect(tasks.getTask("retry")).toMatchObject({
      status: "completed",
      metadata: { attempts: 1 },
    });
    sessionBudget.dispose();
  });

  it("releases the task lease and team reservation when acquireWork throws", async () => {
    const tasks = registry();
    tasks.addTask({ key: "write", title: "write" });
    const teamBudget = new TeamBudget({ maxTokens: 100 });
    const controller = new AbortController();
    const sessionBudget = {
      signal: controller.signal,
      start() {},
      acquireWork() {
        throw new Error("session authority unavailable");
      },
      reason: () => null,
      status: () => ({}),
    };
    let executions = 0;
    const runner = new TeamRunner(tasks, {
      teammates: 1,
      budget: teamBudget,
      sessionBudget,
      runTask: async () => {
        executions += 1;
      },
    });

    await expect(runner.run()).rejects.toThrow("session authority unavailable");

    expect(executions).toBe(0);
    expect(runner.activeClaims()).toEqual([]);
    expect(tasks.getTask("write")).toMatchObject({
      status: "pending",
      metadata: { lease: null },
    });
    expect(teamBudget.reservedTokens).toBe(0);
  });

  it("releases acquired work when abortable registration fails", async () => {
    const tasks = registry();
    tasks.addTask({ key: "write", title: "write" });
    const controller = new AbortController();
    let releases = 0;
    const sessionBudget = {
      signal: controller.signal,
      start() {},
      acquireWork: () => ({
        ok: true,
        id: "team-task:test",
        release: () => {
          releases += 1;
          return true;
        },
      }),
      registerAbortable() {
        throw new Error("abort registry unavailable");
      },
      reason: () => null,
      status: () => ({}),
    };
    let executions = 0;
    const runner = new TeamRunner(tasks, {
      teammates: 1,
      sessionBudget,
      runTask: async () => {
        executions += 1;
      },
    });

    await expect(runner.run()).rejects.toThrow("abort registry unavailable");

    expect(executions).toBe(0);
    expect(releases).toBe(1);
    expect(runner.activeClaims()).toEqual([]);
    expect(tasks.getTask("write")).toMatchObject({
      status: "pending",
      metadata: { lease: null },
    });
  });

  it("does not start a retry once the shared spawn budget is exhausted", async () => {
    const tasks = registry(2);
    tasks.addTask({ key: "retry", title: "retry" });
    const sessionBudget = new SessionResourceBudget({
      maxConcurrent: 1,
      maxSpawns: 1,
    });
    let attempts = 0;
    const runner = new TeamRunner(tasks, {
      teammates: 1,
      sessionBudget,
      runTask: async () => {
        attempts += 1;
        throw new Error("retryable failure");
      },
    });

    const summary = await runner.run();

    expect(attempts).toBe(1);
    expect(summary).toMatchObject({
      success: false,
      budgetStopped: true,
      budgetReason: "max-spawns",
    });
    expect(tasks.getTask("retry")).toMatchObject({
      status: "pending",
      metadata: { attempts: 1, lease: null },
    });
    expect(sessionBudget.status()).toMatchObject({
      spawns: 1,
      active: 0,
      resources: 0,
    });
    sessionBudget.dispose();
  });

  it("cancels every in-flight teammate when usage exhausts the session", async () => {
    const tasks = registry();
    tasks.addTask({ key: "trigger", title: "trigger" });
    tasks.addTask({ key: "blocked", title: "blocked" });
    const sessionBudget = new SessionResourceBudget({
      maxConcurrent: 2,
      maxSpawns: 2,
      maxTokens: 10,
    });
    let startedCount = 0;
    let releaseBoth;
    const bothStarted = new Promise((resolve) => {
      releaseBoth = resolve;
    });
    const markStarted = () => {
      startedCount += 1;
      if (startedCount === 2) releaseBoth();
    };
    const observedAbort = [];
    const runner = new TeamRunner(tasks, {
      teammates: 2,
      sessionBudget,
      runTask: async ({ key, signal }) => {
        markStarted();
        if (key === "trigger") {
          await bothStarted;
          return {
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
            usage: { input_tokens: 6, output_tokens: 4 },
          };
        }
        return await new Promise((resolve, reject) => {
          const onAbort = () => {
            observedAbort.push(key);
            reject(signal.reason || new Error("aborted"));
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        });
      },
    });

    const summary = await runner.run();

    expect(observedAbort).toEqual(["blocked"]);
    expect(summary.success).toBe(false);
    expect(summary.budgetReason).toBe("max-tokens");
    expect(sessionBudget.status()).toMatchObject({
      aborted: true,
      reason: "max-tokens",
      active: 0,
      resources: 0,
      tokens: 10,
    });
    expect(tasks.stats()).toMatchObject({ cancelled: 2 });
    sessionBudget.dispose();
  });
});
