import { describe, expect, it } from "vitest";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";
import {
  TEAM_SCOPE_LOCK_ERROR_CODES,
  TeamScopeLock,
} from "../../src/lib/agent-team/team-scope-lock.js";

function freshRegistry() {
  return new TaskLeaseRegistry({
    now: () => 1000,
    defaultTtlMs: 1_000_000,
  });
}

function addScopedTask(registry, key, scopePaths) {
  expect(
    registry.addTask({
      key,
      title: key,
      metadata: { scopePaths },
    }),
  ).toMatchObject({ ok: true, key });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function within(promise, ms = 1000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("TeamRunner scope ownership", () => {
  it("does not execute overlapping directory scopes concurrently", async () => {
    const registry = freshRegistry();
    addScopedTask(registry, "parent", ["src/agent"]);
    addScopedTask(registry, "child", ["src/agent/worker.js"]);
    const scopeLock = new TeamScopeLock();
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const started = [];
    let active = 0;
    let peak = 0;

    const runner = new TeamRunner(registry, {
      teammates: 2,
      scopeLock,
      runTask: async ({ key }) => {
        active += 1;
        peak = Math.max(peak, active);
        started.push(key);
        if (started.length === 1) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        active -= 1;
        return key;
      },
    });

    const runPromise = runner.run();
    await within(firstStarted.promise);
    await delay(20);
    const startedWhileFirstHeld = [...started];
    const ownershipWhileFirstHeld = scopeLock.status();
    releaseFirst.resolve();
    const summary = await within(runPromise);

    expect(startedWhileFirstHeld).toHaveLength(1);
    expect(ownershipWhileFirstHeld).toMatchObject({
      count: 1,
      locks: [{ key: "parent", scopes: ["src/agent"] }],
    });
    expect(started).toEqual(["parent", "child"]);
    expect(peak).toBe(1);
    expect(summary.maxConcurrent).toBe(1);
    expect(summary.done).toBe(true);
    expect(scopeLock.status()).toEqual({ count: 0, locks: [] });
    expect(summary.scopeOwnership).toEqual({ count: 0, locks: [] });
  });

  it("executes non-overlapping scopes concurrently", async () => {
    const registry = freshRegistry();
    addScopedTask(registry, "source", ["src"]);
    addScopedTask(registry, "docs", ["docs"]);
    const scopeLock = new TeamScopeLock();
    const bothStarted = deferred();
    const releaseBoth = deferred();
    const started = [];
    let active = 0;
    let peak = 0;

    const runner = new TeamRunner(registry, {
      teammates: 2,
      scopeLock,
      runTask: async ({ key }) => {
        active += 1;
        peak = Math.max(peak, active);
        started.push(key);
        if (started.length === 2) bothStarted.resolve();
        await releaseBoth.promise;
        active -= 1;
        return key;
      },
    });

    const runPromise = runner.run();
    let readinessError = null;
    try {
      await within(bothStarted.promise);
    } catch (error) {
      readinessError = error;
    } finally {
      releaseBoth.resolve();
    }
    const summary = await within(runPromise);
    if (readinessError) throw readinessError;

    expect(new Set(started)).toEqual(new Set(["source", "docs"]));
    expect(peak).toBe(2);
    expect(summary.maxConcurrent).toBe(2);
    expect(summary.done).toBe(true);
    expect(scopeLock.status()).toEqual({ count: 0, locks: [] });
  });

  it("treats an empty scope list as an exclusive whole-workspace lock", async () => {
    const registry = freshRegistry();
    addScopedTask(registry, "exclusive", []);
    addScopedTask(registry, "writer", ["src/file.js"]);
    const scopeLock = new TeamScopeLock();
    const exclusiveStarted = deferred();
    const releaseExclusive = deferred();
    const started = [];
    let active = 0;
    let peak = 0;

    const runner = new TeamRunner(registry, {
      teammates: 2,
      scopeLock,
      runTask: async ({ key }) => {
        active += 1;
        peak = Math.max(peak, active);
        started.push(key);
        if (key === "exclusive") {
          exclusiveStarted.resolve();
          await releaseExclusive.promise;
        }
        active -= 1;
        return key;
      },
    });

    const runPromise = runner.run();
    await within(exclusiveStarted.promise);
    await delay(20);
    const startedWhileExclusive = [...started];
    const ownershipWhileExclusive = scopeLock.status();
    releaseExclusive.resolve();
    const summary = await within(runPromise);

    expect(startedWhileExclusive).toEqual(["exclusive"]);
    expect(ownershipWhileExclusive).toEqual({
      count: 1,
      locks: [
        {
          key: "exclusive",
          scopes: [],
          workspace: true,
        },
      ],
    });
    expect(started).toEqual(["exclusive", "writer"]);
    expect(peak).toBe(1);
    expect(summary.done).toBe(true);
    expect(scopeLock.status()).toEqual({ count: 0, locks: [] });
  });

  it("fails closed on an invalid task scope without claiming or executing it", async () => {
    const registry = freshRegistry();
    addScopedTask(registry, "unsafe", ["../outside"]);
    const scopeLock = new TeamScopeLock();
    let executions = 0;

    const runner = new TeamRunner(registry, {
      teammates: 2,
      scopeLock,
      runTask: async () => {
        executions += 1;
      },
    });

    await expect(runner.run()).rejects.toMatchObject({
      code: TEAM_SCOPE_LOCK_ERROR_CODES.INVALID_SCOPE_PATH,
    });
    expect(executions).toBe(0);
    expect(registry.getTask("unsafe")).toMatchObject({
      status: "pending",
      lease: null,
      assignee: null,
    });
    expect(scopeLock.status()).toEqual({ count: 0, locks: [] });
  });
});

describe("TeamRunner durable hook failures with scope ownership", () => {
  it("fails closed instead of waiting forever on an orphaned scope", async () => {
    const registry = freshRegistry();
    addScopedTask(registry, "next", ["src/next.js"]);
    const scopeLock = new TeamScopeLock();
    expect(scopeLock.acquire("orphan", ["src"]).ok).toBe(true);
    const runner = new TeamRunner(registry, {
      teammates: 2,
      scopeLock,
      runTask: async () => {},
    });

    await expect(runner.run()).rejects.toMatchObject({
      code: "TEAM_SCOPE_LOCK_ORPHANED",
    });
    expect(registry.getTask("next")).toMatchObject({
      status: "pending",
      lease: null,
    });
  });

  it("does not execute a task and releases lease/scope when beforeTask fails", async () => {
    const registry = freshRegistry();
    addScopedTask(registry, "persist-first", ["src"]);
    const scopeLock = new TeamScopeLock();
    let beforeCalls = 0;
    let executions = 0;

    const runner = new TeamRunner(registry, {
      teammates: 1,
      scopeLock,
      beforeTask: async () => {
        beforeCalls += 1;
        throw new Error("claim persistence failed");
      },
      runTask: async () => {
        executions += 1;
      },
    });

    await expect(runner.run()).rejects.toThrow("claim persistence failed");
    expect(beforeCalls).toBe(1);
    expect(executions).toBe(0);
    expect(registry.getTask("persist-first")).toMatchObject({
      status: "pending",
      lease: null,
      assignee: null,
    });
    expect(scopeLock.status()).toEqual({ count: 0, locks: [] });
  });

  it("stops claiming new tasks after afterTask persistence fails", async () => {
    const registry = freshRegistry();
    addScopedTask(registry, "first", ["src/first.js"]);
    addScopedTask(registry, "second", ["src/second.js"]);
    addScopedTask(registry, "third", ["src/third.js"]);
    const scopeLock = new TeamScopeLock();
    const executed = [];
    const settlements = [];

    const runner = new TeamRunner(registry, {
      teammates: 1,
      scopeLock,
      runTask: async ({ key }) => {
        executed.push(key);
        return `${key}-result`;
      },
      afterTask: async (settlement) => {
        settlements.push(settlement);
        throw new Error("settlement persistence failed");
      },
    });

    await expect(runner.run()).rejects.toThrow("settlement persistence failed");
    expect(executed).toEqual(["first"]);
    expect(settlements).toHaveLength(1);
    const [settlement] = settlements;
    expect(settlement).toMatchObject({
      key: "first",
      holder: "teammate-1",
      status: "completed",
      result: "first-result",
      lease: {
        holder: "teammate-1",
        leaseId: expect.any(String),
        fencingToken: expect.any(String),
      },
      task: {
        key: "first",
        assignee: "teammate-1",
        lease: {
          holder: "teammate-1",
          leaseId: expect.any(String),
          fencingToken: expect.any(String),
        },
      },
    });
    expect(settlement.lease.leaseId).toBe(settlement.task.lease.leaseId);
    expect(settlement.lease.fencingToken).toBe(
      settlement.task.lease.fencingToken,
    );
    expect(registry.getTask("first")).toMatchObject({
      status: "completed",
      lease: null,
    });
    for (const key of ["second", "third"]) {
      expect(registry.getTask(key)).toMatchObject({
        status: "pending",
        lease: null,
        assignee: null,
      });
    }
    expect(scopeLock.status()).toEqual({ count: 0, locks: [] });
  });
});
