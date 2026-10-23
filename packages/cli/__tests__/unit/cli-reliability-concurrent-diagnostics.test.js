import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  concurrentAgentScenario,
  retireConcurrentAgentChildren,
} from "../../scripts/cli-reliability-soak.mjs";

const profile = { concurrentAgents: 20, cleanupDeadlineMs: 10_000 };
const secret = "CC_PRIVATE_CONCURRENT_CANARY";
afterEach(() => vi.useRealTimers());

function child(index) {
  return Object.assign(new EventEmitter(), {
    pid: 100_000 + index,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}
function finish(
  child,
  result = { subtype: "success", is_error: false, result: "ok" },
) {
  child.stdout.write(JSON.stringify(result));
  child.emit("exit", 0, null);
  child.emit("close", 0, null);
}
function cohort(options = {}) {
  const children = Array.from({ length: 20 }, (_, index) => child(index));
  const snapshots = [];
  const spawnChild = vi.fn(() => children[spawnChild.mock.calls.length - 1]);
  const retireChildren = vi.fn(async (records, deadline) => {
    expect(deadline).toBe(10_000);
    for (const record of records) {
      if (record.child && !record.closed) finish(record.child);
    }
    return { confirmed: true };
  });
  const pending = concurrentAgentScenario(
    "http://localhost",
    "agents",
    profile,
    {
      spawnChild,
      retireChildren,
      checkpoint: (value) => snapshots.push(structuredClone(value)),
      ...options,
    },
  ).catch((error) => error);
  return { children, snapshots, spawnChild, retireChildren, pending };
}

describe("concurrent cohort failure evidence", () => {
  it("keeps twenty simultaneous agents and the original 120-second deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const run = cohort();
    expect(run.spawnChild).toHaveBeenCalledTimes(20);
    run.spawnChild.mock.calls.forEach(([args, options], index) => {
      expect(args.slice(-4)).toEqual([
        "-p",
        `agent-${index}`,
        "--output-format",
        "json",
      ]);
      expect(options.home).toMatch(new RegExp(`agent-${index}$`));
      expect(options.detached).toBe(process.platform !== "win32");
    });
    for (const entry of run.children.slice(1)) finish(entry);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(run.retireChildren).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const error = await run.pending;
    expect(error).toMatchObject({
      code: "CC_RELIABILITY_CHILD_TIMEOUT",
      childIndex: 0,
    });
    expect(error.message).toBe("child 100000 exceeded 120000ms");
    expect(run.retireChildren).toHaveBeenCalledOnce();
    expect(run.snapshots.at(-1).exits).toHaveLength(20);
    expect(run.snapshots.at(-1).exits[0]).toMatchObject({
      timedOut: true,
      code: 0,
    });
    expect(run.snapshots.at(-1).cleanup.confirmed).toBe(true);
    expect(
      run.children.every((entry) => entry.kill.mock.calls.length === 0),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for close and includes output delivered after exit", async () => {
    const run = cohort();
    for (const entry of run.children.slice(1)) finish(entry);
    run.children[0].emit("exit", 0, null);
    await Promise.resolve();
    expect(run.retireChildren).not.toHaveBeenCalled();
    run.children[0].stdout.write(
      JSON.stringify({ is_error: false, result: "late", subtype: "success" }),
    );
    run.children[0].emit("close", 0, null);
    const result = await run.pending;
    expect(result.pass).toBe(true);
    expect(run.retireChildren).not.toHaveBeenCalled();
    expect(result.cleanup).toEqual({
      scope: "direct-children",
      allClosed: true,
      treeTermination: "unverified",
    });
    expect(result.cleanup).not.toHaveProperty("confirmed");
    expect(result.cleanup).not.toHaveProperty("treeTerminated");
    expect(result.exits).toHaveLength(20);
    expect(result.exits[0]).toMatchObject({ resultLength: 4, code: 0 });
  });

  it.each(["unknown", "rejected"])(
    "preserves the timeout when cleanup is %s",
    async (mode) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const retireChildren = vi.fn(async () => {
        if (mode === "rejected") throw new Error(secret);
        return { confirmed: false };
      });
      const run = cohort({ retireChildren });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await run.pending).toMatchObject({
        code: "CC_RELIABILITY_CHILD_TIMEOUT",
        reliabilityCleanupIncomplete: true,
        reliabilityCleanupScenario: "concurrentAgents",
      });
      expect(run.snapshots.at(-1).exits).toHaveLength(20);
      expect(JSON.stringify(run.snapshots)).not.toContain(secret);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["synchronous", "event"])(
    "retires every acquired child after a %s spawn failure",
    async (mode) => {
      const children = Array.from({ length: 20 }, (_, index) => child(index));
      const spawnChild = vi.fn(() => {
        const index = spawnChild.mock.calls.length - 1;
        if (mode === "synchronous" && index === 7) throw new Error(secret);
        return children[index];
      });
      const run = cohort({ spawnChild });
      if (mode === "event") children[7].emit("error", new Error(secret));
      expect(await run.pending).toMatchObject({
        code: "CC_RELIABILITY_CHILD_FAILED",
        childIndex: 7,
      });
      expect(spawnChild).toHaveBeenCalledTimes(20);
      expect(run.retireChildren).toHaveBeenCalledOnce();
      expect(run.snapshots.at(-1).exits).toHaveLength(20);
      expect(JSON.stringify(run.snapshots)).not.toContain(secret);
    },
  );

  it("retains safe observations without copying arbitrary result or stderr contents", async () => {
    const run = cohort();
    run.children[0].stderr.write(secret);
    finish(run.children[0], {
      subtype: secret,
      is_error: false,
      result: secret,
    });
    for (const entry of run.children.slice(1)) finish(entry);
    const result = await run.pending;
    expect(result.pass).toBe(true);
    expect(result.exits[0]).toMatchObject({
      resultSubtype: null,
      resultLength: secret.length,
      stderrBytes: secret.length,
    });
    expect(JSON.stringify({ result, snapshots: run.snapshots })).not.toContain(
      secret,
    );
  });

  it("does not pass a cleanly retired cohort with invalid JSON", async () => {
    const run = cohort();
    run.children[0].stdout.write(secret);
    run.children[0].emit("exit", 0, null);
    run.children[0].emit("close", 0, null);
    for (const entry of run.children.slice(1)) finish(entry);
    expect(await run.pending).toMatchObject({ pass: false });
  });
});

function record(index, exited = true) {
  return {
    child: child(index),
    closed: exited,
    completion: {
      exit: () => (exited ? { code: 0 } : null),
      wait: vi.fn(async () => {}),
    },
  };
}
const absent = () => {
  throw Object.assign(new Error("absent"), { code: "ESRCH" });
};

describe("shared concurrent retirement deadline", () => {
  it("never claims retirement without close, even when tree termination succeeds", async () => {
    const entry = record(0, false);
    const result = await retireConcurrentAgentChildren([entry], 10_000, {
      retireChild: async () => ({ treeTerminated: true }),
    });
    expect(result).toMatchObject({
      confirmed: false,
      children: [{ closed: false, treeTerminated: true, confirmed: false }],
    });
  });

  it("settles every retirement even when one helper rejects", async () => {
    const records = [record(0, false), record(1, false)];
    const retireChild = vi.fn(async (child) => {
      if (child.pid === 100_000) throw new Error(secret);
      records[1].closed = true;
      return { treeTerminated: true };
    });
    const result = await retireConcurrentAgentChildren(records, 10_000, {
      retireChild,
    });
    expect(retireChild).toHaveBeenCalledTimes(2);
    expect(result.confirmed).toBe(false);
    expect(result.children).toMatchObject([
      { confirmed: false },
      { confirmed: true },
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("starts all active retirements together with one shrinking budget", async () => {
    let time = 0;
    const records = Array.from({ length: 20 }, (_, index) =>
      record(index, false),
    );
    const releases = [];
    const retireChild = vi.fn((_child, _completion, budget) => {
      expect(budget).toBe(10_000 - time);
      time += 10;
      return new Promise((resolve) => releases.push(resolve));
    });
    const pending = retireConcurrentAgentChildren(records, 10_000, {
      now: () => time,
      retireChild,
    });
    expect(retireChild).toHaveBeenCalledTimes(20);
    time = 10_000;
    releases.forEach((resolve, index) => {
      records[index].closed = true;
      resolve({ treeTerminated: true });
    });
    expect(await pending).toMatchObject({ confirmed: true, elapsedMs: 10_000 });
  });

  it("waits for an already exited child's close without signalling its PID", async () => {
    const entry = record(0);
    entry.closed = false;
    let close;
    entry.completion.wait = vi.fn(
      () =>
        new Promise((resolve) => {
          close = resolve;
        }),
    );
    const retireChild = vi.fn();
    const kill = vi.fn(absent);
    const pending = retireConcurrentAgentChildren([entry], 10_000, {
      platform: "linux",
      retireChild,
      kill,
    });
    expect(kill).not.toHaveBeenCalled();
    expect(retireChild).not.toHaveBeenCalled();
    entry.closed = true;
    close();
    expect((await pending).confirmed).toBe(true);
    expect(kill.mock.calls).toEqual([[-100_000, 0]]);
  });

  it("keeps exited Windows roots unknown even if a late process table looks empty", async () => {
    const kill = vi.fn(absent);
    const snapshot = vi.fn(() => ({ available: true, pids: [] }));
    const retireChild = vi.fn();
    const result = await retireConcurrentAgentChildren([record(0)], 10_000, {
      platform: "win32",
      kill,
      snapshot,
      retireChild,
    });
    expect(result).toMatchObject({
      confirmed: false,
      children: [{ closed: true, treeTerminated: false, confirmed: false }],
    });
    expect(retireChild).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("does not start a new snapshot budget after retirement exhausts the shared deadline", async () => {
    let time = 0;
    const entry = record(0, false);
    const snapshot = vi.fn();
    const run = vi.fn();
    const result = await retireConcurrentAgentChildren([entry], 10_000, {
      platform: "win32",
      now: () => time,
      snapshot,
      run,
      retireChild: async () => {
        time = 10_001;
        entry.closed = true;
        return { treeTerminated: false };
      },
    });
    expect(result).toMatchObject({ confirmed: false, deadlineExceeded: true });
    expect(snapshot).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
