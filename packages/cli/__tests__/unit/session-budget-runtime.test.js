import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openSessionBudget,
  SessionBudgetSidecarStore,
  sessionBudgetRuntimeCount,
} from "../../src/lib/session-budget-runtime.js";
import { SessionResourceBudget } from "../../src/lib/session-resource-budget.js";

const temporaryDirectories = [];

async function flushObservationEvents() {
  await Promise.resolve();
  await Promise.resolve();
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error("expected callback to throw");
}

function snapshotWithWorkEntries(ids, { kind = "work", depth = 0 } = {}) {
  const budget = new SessionResourceBudget();
  const snapshot = budget.snapshot();
  budget.dispose();
  snapshot.inFlight.work = ids.map((id) => ({
    id,
    kind,
    depth,
    elapsedMs: 0,
  }));
  return snapshot;
}

function makeStore() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-session-budget-"),
  );
  temporaryDirectories.push(directory);
  return {
    directory,
    store: new SessionBudgetSidecarStore({
      resolvePath: (sessionId) =>
        path.join(directory, `${sessionId}.budget.json`),
      allowUnsupportedPlatformForTests: true,
    }),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("session budget runtime", () => {
  it("shares one object per session and only tightens later host limits", () => {
    const { store } = makeStore();
    const registry = new Map();
    const first = openSessionBudget("shared", {
      store,
      registry,
      limits: { maxTurns: 5, maxConcurrent: 4 },
    });
    const second = openSessionBudget("shared", {
      store,
      registry,
      limits: { maxTurns: 2, maxConcurrent: 20 },
    });

    expect(second.budget).toBe(first.budget);
    expect(second.budget.status()).toMatchObject({
      maxTurns: 2,
      maxConcurrent: 4,
    });
    expect(first.budget.consumeTurn({ id: "one" }).ok).toBe(true);
    expect(second.budget.consumeTurn({ id: "two" }).ok).toBe(true);
    expect(first.budget.consumeTurn({ id: "three" })).toMatchObject({
      ok: false,
      reason: "max-turns",
    });

    expect(sessionBudgetRuntimeCount(registry)).toBe(1);
    first.close();
    expect(sessionBudgetRuntimeCount(registry)).toBe(1);
    second.close();
    expect(sessionBudgetRuntimeCount(registry)).toBe(0);
    expect(store.read("shared").snapshot).toMatchObject({
      limits: { maxTurns: 2, maxConcurrent: 4 },
      totals: { turns: 2 },
    });
  });

  it("restores settled totals across host processes without loosening limits", () => {
    const { store } = makeStore();
    const first = openSessionBudget("resume", {
      store,
      registry: new Map(),
      limits: { maxTurns: 3, maxTokens: 20 },
    });
    first.budget.consumeTurn({ id: "turn-1" });
    first.budget.recordUsage({
      provider: "ollama",
      model: "local",
      usage: { input_tokens: 4, output_tokens: 2 },
    });
    first.close();

    const resumed = openSessionBudget("resume", {
      store,
      registry: new Map(),
      limits: { maxTurns: 30, maxTokens: 10 },
    });
    expect(resumed.budget.status()).toMatchObject({
      turns: 1,
      maxTurns: 3,
      tokens: 6,
      maxTokens: 10,
      recoveryRequired: false,
    });
    resumed.close();
  });

  it("revokes stale handles and leases only after the final snapshot is durable", () => {
    const { store } = makeStore();
    const registry = new Map();
    const handle = openSessionBudget("final-close-revoke", {
      store,
      registry,
      limits: { maxSpawns: 2, maxConcurrent: 2 },
    });
    const staleBudget = handle.budget;
    const lease = staleBudget.acquireWork({
      id: "background-child",
      kind: "background",
      depth: 1,
    });
    const stop = vi.fn();
    staleBudget.registerAbortable("background-child", stop);

    expect(handle.close()).toBe(true);
    expect(sessionBudgetRuntimeCount(registry)).toBe(0);
    expect(stop).toHaveBeenCalledOnce();
    expect(() => staleBudget.consumeTurn({ id: "stale-turn" })).toThrow(
      expect.objectContaining({ budgetReason: "runtime-closed" }),
    );
    expect(() => lease.release()).toThrow(
      expect.objectContaining({ budgetReason: "runtime-closed" }),
    );
    expect(() => handle.persist()).toThrow(
      expect.objectContaining({ budgetReason: "runtime-closed" }),
    );

    const resumed = openSessionBudget("final-close-revoke", {
      store,
      registry,
    });
    expect(resumed.budget).not.toBe(staleBudget);
    expect(resumed.budget.pendingRecovery()).toEqual([
      expect.objectContaining({ id: lease.authorityId }),
    ]);
    expect(
      resumed.budget.adjudicateRecovery({
        abandoned: [lease.authorityId],
      }),
    ).toMatchObject({ ok: true });
    resumed.close();
  });

  it("keeps a failed final close poisoned and registered without reopening an old revision", () => {
    const { store } = makeStore();
    const registry = new Map();
    let rejectWrites = false;
    const failingStore = {
      pathForSession: (sessionId) => store.pathForSession(sessionId),
      read: (sessionId) => store.read(sessionId),
      write: (...args) => {
        if (rejectWrites) throw new Error("close durability unavailable");
        return store.write(...args);
      },
    };
    const handle = openSessionBudget("final-close-failure", {
      store: failingStore,
      registry,
      limits: { maxSpawns: 2, maxConcurrent: 2 },
    });
    const lease = handle.budget.acquireWork({
      id: "active-child",
      kind: "background",
      depth: 1,
    });
    const stop = vi.fn();
    handle.budget.registerAbortable("active-child", stop);
    const durableBeforeClose = store.read("final-close-failure");
    rejectWrites = true;

    expect(() => handle.close()).toThrow(/close durability unavailable/);
    expect(stop).toHaveBeenCalledOnce();
    expect(sessionBudgetRuntimeCount(registry)).toBe(1);
    expect(store.read("final-close-failure")).toEqual(durableBeforeClose);
    expect(handle.budget.status()).toMatchObject({
      aborted: true,
      reason: "persistence-failed",
      active: 1,
    });
    expect(() => lease.release()).toThrow(/close durability unavailable/);
    expect(() => handle.budget.consumeTurn({ id: "stale-turn" })).toThrow(
      /close durability unavailable/,
    );
    expect(() =>
      openSessionBudget("final-close-failure", {
        store: failingStore,
        registry,
      }),
    ).toThrow(/close durability unavailable/);
    expect(() => handle.close()).toThrow(/close durability unavailable/);
    expect(sessionBudgetRuntimeCount(registry)).toBe(1);
  });

  it("blocks a dirty restore until every exact in-flight id is adjudicated", () => {
    const { store } = makeStore();
    const crashed = openSessionBudget("dirty", {
      store,
      registry: new Map(),
      limits: { maxSpawns: 5 },
    });
    const crashedLease = crashed.budget.acquireWork({
      id: "background:pid-7",
      kind: "background",
      depth: 1,
    });
    expect(crashedLease.ok).toBe(true);
    // Closing the runtime models process teardown without falsely settling the
    // still-live resource; the persisted snapshot must remain dirty.
    crashed.close();

    const dirtyRevision = store.read("dirty").revision;
    expect(() =>
      openSessionBudget("dirty", {
        store,
        registry: new Map(),
        recoverUnsettled: "abandon",
      }),
    ).toThrow(/requires explicit recovery adjudication/);
    expect(store.read("dirty").revision).toBe(dirtyRevision);

    const resumed = openSessionBudget("dirty", {
      store,
      registry: new Map(),
    });
    expect(resumed.budget.pendingRecovery()).toEqual([
      expect.objectContaining({ id: crashedLease.authorityId }),
    ]);
    expect(JSON.stringify(store.read("dirty"))).not.toContain(
      "background:pid-7",
    );
    expect(
      resumed.budget.acquireWork({ id: "new-work", depth: 1 }),
    ).toMatchObject({ ok: false, reason: "recovery-required" });
    expect(
      resumed.budget.adjudicateRecovery({
        abandoned: ["background:pid-7"],
      }),
    ).toMatchObject({
      ok: false,
      reason: "recovery-adjudication-incomplete",
    });
    expect(
      resumed.budget.adjudicateRecovery({
        abandoned: [crashedLease.authorityId],
      }),
    ).toMatchObject({ ok: true });
    expect(resumed.budget.acquireWork({ id: "new-work", depth: 1 }).ok).toBe(
      true,
    );
    resumed.close();
  });

  it.each([
    {
      name: "turn",
      admit: (budget) => budget.consumeTurn({ id: "lost-update-turn" }),
    },
    {
      name: "work",
      admit: (budget) =>
        budget.acquireWork({
          id: "lost-update-work",
          kind: "sub-agent",
          depth: 1,
        }),
    },
    {
      name: "tool",
      admit: (budget) =>
        budget.beginTool({ id: "lost-update-tool", kind: "mcp" }),
    },
  ])(
    "rejects the next $name admission after another process advances the revision",
    ({ name, admit }) => {
      const { store } = makeStore();
      const sessionId = `contended-${name}`;
      const first = openSessionBudget(sessionId, {
        store,
        registry: new Map(),
        limits: { maxTurns: 5, maxSpawns: 5 },
      });
      first.budget.start();
      const competing = openSessionBudget(sessionId, {
        store,
        registry: new Map(),
      });

      expect(admit(first.budget)).toMatchObject({
        ok: false,
        reason: "persistence-failed",
      });
      expect(first.budget.status()).toMatchObject({
        aborted: true,
        reason: "persistence-failed",
        turns: 0,
        spawns: 0,
        active: 0,
        activeTools: 0,
      });
      expect(first.budget.snapshot().inFlight).toEqual({
        work: [],
        tools: [],
      });
      expect(first.status().persistenceError).toContain("expected revision");
      expect(() => first.close()).toThrow(/Session budget conflict failed/);
      competing.close();
    },
  );

  it.each([
    {
      name: "work release",
      id: "contended-release-work",
      begin: (budget, id) => budget.acquireWork({ id, depth: 1 }),
      finish: (lease) => lease.release(),
      expected: (id) => ({
        work: [expect.objectContaining({ id })],
        tools: [],
      }),
    },
    {
      name: "tool end",
      id: "contended-end-tool",
      begin: (budget, id) => budget.beginTool({ id }),
      finish: (lease) => lease.end(),
      expected: (id) => ({
        work: [],
        tools: [expect.objectContaining({ id })],
      }),
    },
  ])(
    "keeps $name locally and durably unknown after a stale CAS",
    ({ name, id, begin, finish, expected }) => {
      const { store } = makeStore();
      const sessionId = `terminal-${name.replaceAll(" ", "-")}-${randomUUID()}`;
      const first = openSessionBudget(sessionId, {
        store,
        registry: new Map(),
      });
      const lease = begin(first.budget, id);
      expect(lease.ok).toBe(true);
      const competing = openSessionBudget(sessionId, {
        store,
        registry: new Map(),
      });

      expect(() => finish(lease)).toThrow(/expected revision/);
      expect(first.budget.status()).toMatchObject({
        aborted: true,
        reason: "persistence-failed",
      });
      expect(first.budget.snapshot().inFlight).toEqual(
        expected(lease.authorityId),
      );
      expect(store.read(sessionId).snapshot.inFlight).toEqual(
        expected(lease.authorityId),
      );
      expect(JSON.stringify(store.read(sessionId))).not.toContain(id);
      expect(() => first.close()).toThrow(/expected revision/);
      competing.close();
    },
  );

  it("rejects an authority mutation synchronously when persistence throws", async () => {
    const { store } = makeStore();
    let rejectWrites = false;
    const failingStore = {
      pathForSession: (id) => store.pathForSession(id),
      read: (id) => store.read(id),
      write: (...args) => {
        if (rejectWrites) throw new Error("durability unavailable");
        return store.write(...args);
      },
    };
    const events = [];
    const handle = openSessionBudget("persistence-throw", {
      store: failingStore,
      registry: new Map(),
      limits: { maxTurns: 5 },
      onEvent: (event) => events.push(event.type),
    });
    handle.budget.start();
    const durableBefore = store.read("persistence-throw");
    const stopped = [];
    handle.budget.registerAbortable("running-tool", () =>
      stopped.push("stopped"),
    );

    rejectWrites = true;
    expect(handle.budget.consumeTurn({ id: "must-not-succeed" })).toMatchObject(
      {
        ok: false,
        reason: "persistence-failed",
      },
    );

    expect(handle.budget.status()).toMatchObject({
      aborted: true,
      reason: "persistence-failed",
      turns: 0,
    });
    expect(stopped).toEqual(["stopped"]);
    expect(store.read("persistence-throw")).toEqual(durableBefore);
    await flushObservationEvents();
    expect(events).toContain("budget:authority-persistence-failed");
    expect(() => handle.close()).toThrow(/durability unavailable/);
  });

  it("rolls back an already-aborted retain when abort persistence fails", () => {
    const { store } = makeStore();
    const registry = new Map();
    const controller = new AbortController();
    controller.abort(new Error("already cancelled"));
    let writes = 0;
    const failingStore = {
      pathForSession: (id) => store.pathForSession(id),
      read: (id) => store.read(id),
      write: (...args) => {
        writes += 1;
        if (writes > 1) throw new Error("abort durability unavailable");
        return store.write(...args);
      },
    };
    const observed = [];

    expect(() =>
      openSessionBudget("aborted-retain", {
        store: failingStore,
        registry,
        signal: controller.signal,
        onEvent: (event) => observed.push(event.type),
      }),
    ).toThrow(/abort durability unavailable/);

    expect(sessionBudgetRuntimeCount(registry)).toBe(0);
    expect(observed).toEqual([]);
    expect(store.read("aborted-retain").snapshot.state.abort).toBeNull();
  });

  it("fails closed when authority persistence re-enters through its store", () => {
    const { store } = makeStore();
    let handle = null;
    let reenter = false;
    const reentrantStore = {
      pathForSession: (id) => store.pathForSession(id),
      read: (id) => store.read(id),
      write: (...args) => {
        if (reenter) {
          reenter = false;
          expect(() => handle.persist()).toThrow(/cannot re-enter/);
        }
        return store.write(...args);
      },
    };
    handle = openSessionBudget("reentrant-persistence", {
      store: reentrantStore,
      registry: new Map(),
      limits: { maxTurns: 2 },
    });

    reenter = true;
    expect(handle.budget.consumeTurn({ id: "must-fail" })).toMatchObject({
      ok: false,
      reason: "persistence-failed",
    });
    expect(handle.budget.status()).toMatchObject({
      aborted: true,
      reason: "persistence-failed",
      turns: 0,
    });
    expect(() => handle.close()).toThrow(/cannot re-enter/);
  });

  it("keeps throwing observers separate from durable authority commits", () => {
    const { store } = makeStore();
    const handle = openSessionBudget("observer", {
      store,
      registry: new Map(),
      limits: { maxTurns: 2 },
      onEvent: () => {
        throw new Error("observer bug");
      },
    });

    expect(handle.budget.consumeTurn({ id: "persisted-turn" })).toMatchObject({
      ok: true,
      turns: 1,
    });
    expect(store.read("observer").snapshot.totals.turns).toBe(1);
    handle.close();
  });

  it("rejects authority mutation from a deferred observation callback", async () => {
    const { store } = makeStore();
    let handle = null;
    const reentrantErrors = [];
    const observedEvents = [];
    handle = openSessionBudget("usage-observer", {
      store,
      registry: new Map(),
      limits: { maxTurns: 3, maxSpawns: 3 },
      onEvent: (event) => {
        if (event.type !== "budget:usage-settlement-started") return;
        observedEvents.push(event);
        for (const mutate of [
          () => handle.budget.consumeTurn({ id: "observer-turn" }),
          () =>
            handle.budget.acquireWork({
              id: "observer-work",
              kind: "sub-agent",
              depth: 1,
            }),
        ]) {
          try {
            mutate();
          } catch (error) {
            reentrantErrors.push(error);
          }
        }
      },
    });

    handle.budget.recordUsage({
      provider: "ollama",
      model: "local",
      usage: { input_tokens: 2, output_tokens: 1 },
    });
    await flushObservationEvents();

    expect(reentrantErrors).toHaveLength(2);
    expect(reentrantErrors).toEqual([
      expect.objectContaining({ budgetReason: "notification-reentrancy" }),
      expect.objectContaining({ budgetReason: "notification-reentrancy" }),
    ]);
    expect(observedEvents[0]).not.toHaveProperty("authorityId");
    expect(observedEvents[0]).not.toHaveProperty("id");
    expect(handle.budget.status()).toMatchObject({
      tokens: 3,
      turns: 0,
      spawns: 0,
      active: 0,
    });
    expect(
      fs.existsSync(store.usageUnknownPathForSession("usage-observer")),
    ).toBe(false);
    handle.close();
  });

  it("keeps work observers read-only before direct and await continuations", async () => {
    const { store } = makeStore();
    let handle = null;
    let phase = "direct";
    let knownAuthorityId = null;
    const observed = [];
    const errors = [];
    handle = openSessionBudget("work-observer-ordering", {
      store,
      registry: new Map(),
      limits: { maxSpawns: 4, maxConcurrent: 4 },
      onEvent: (event) => {
        if (event.type !== "budget:work-acquired") return;
        observed.push({ phase, event, knownAuthorityId });
        for (const mutate of [
          () => handle.budget.releaseWork(knownAuthorityId || event.id),
          () => handle.close(),
        ]) {
          try {
            mutate();
          } catch (error) {
            errors.push(error);
          }
        }
      },
    });

    const direct = handle.budget.acquireWork({
      id: "direct-business-label",
      depth: 1,
    });
    knownAuthorityId = direct.authorityId;
    await flushObservationEvents();

    expect(observed[0]).toMatchObject({
      phase: "direct",
      knownAuthorityId: direct.authorityId,
    });
    expect(handle.budget.status().active).toBe(1);
    expect(direct.release()).toBe(true);

    phase = "await";
    knownAuthorityId = null;
    const awaited = await Promise.resolve(
      handle.budget.acquireWork({
        id: "await-business-label",
        depth: 1,
      }),
    );
    knownAuthorityId = awaited.authorityId;
    await flushObservationEvents();

    expect(observed[1]).toMatchObject({
      phase: "await",
      knownAuthorityId: null,
    });
    expect(errors).toHaveLength(4);
    expect(errors).toEqual(
      Array.from({ length: 4 }, () =>
        expect.objectContaining({
          budgetReason: "notification-reentrancy",
        }),
      ),
    );
    for (const { event } of observed) {
      expect(event).toHaveProperty("eventId");
      expect(event).not.toHaveProperty("authorityId");
      expect(event.id).not.toMatch(/^(?:work|tool|usage)-[0-9a-f-]{36}$/);
    }
    expect(handle.budget.status().active).toBe(1);
    expect(awaited.release()).toBe(true);
    handle.close();
  });

  it("keeps await and timer descendants of an observer permanently read-only", async () => {
    const { store } = makeStore();
    const sessionId = "async-observer-context";
    let handle = null;
    let lease = null;
    let resolveObserver;
    let rejectObserver;
    const observerDone = new Promise((resolve, reject) => {
      resolveObserver = resolve;
      rejectObserver = reject;
    });
    let resolveObserverReady;
    const observerReady = new Promise((resolve) => {
      resolveObserverReady = resolve;
    });
    let resumeObserver;
    const observerResume = new Promise((resolve) => {
      resumeObserver = resolve;
    });
    const attempts = [];
    const attempt = (stage, mutate) => {
      try {
        mutate();
        attempts.push({ stage, error: null });
      } catch (error) {
        attempts.push({ stage, error });
      }
    };

    handle = openSessionBudget(sessionId, {
      store,
      registry: new Map(),
      limits: { maxSpawns: 2, maxConcurrent: 2 },
      onEvent: async (event) => {
        if (event.type !== "budget:work-acquired") return;
        try {
          await Promise.resolve();
          attempt("await-release", () => lease.release());
          resolveObserverReady();
          await observerResume;
          await new Promise((resolve) => {
            setTimeout(() => {
              attempt("timer-release", () =>
                handle.budget.releaseWork(lease.authorityId),
              );
              resolve();
            }, 0);
          });
          attempt("post-timer-persist", () => handle.persist());
          attempt("post-timer-close", () => handle.close());
          resolveObserver();
        } catch (error) {
          rejectObserver(error);
        }
      },
    });
    lease = handle.budget.acquireWork({
      id: "async-observer-business-label",
      depth: 1,
    });
    const revisionBeforeObserver = store.read(sessionId).revision;

    await observerReady;
    const externalPersistRevision = handle.persist();
    expect(externalPersistRevision).toBeGreaterThan(revisionBeforeObserver);
    resumeObserver();
    await observerDone;

    expect(attempts.map(({ stage }) => stage)).toEqual([
      "await-release",
      "timer-release",
      "post-timer-persist",
      "post-timer-close",
    ]);
    for (const { error } of attempts) {
      expect(error).toMatchObject({
        budgetReason: "notification-reentrancy",
      });
    }
    expect(handle.budget.status().active).toBe(1);
    expect(store.read(sessionId).revision).toBe(externalPersistRevision);

    // These continuations were registered outside the observer context.
    // Normal runtime persistence and lease ownership remain usable.
    expect(lease.release()).toBe(true);
    expect(store.read(sessionId).snapshot.inFlight.work).toEqual([]);
    expect(handle.persist()).toBeGreaterThan(externalPersistRevision);
    expect(handle.close()).toBe(true);
  });

  it("keeps observer thenable getters and assimilation jobs read-only", async () => {
    const { store } = makeStore();
    const sessionId = "observer-thenable-context";
    let handle = null;
    let lease = null;
    let mode = "getter";
    const attempts = [];
    const attemptAllMutations = (prefix) => {
      for (const [operation, mutate] of [
        ["release", () => lease.release()],
        ["persist", () => handle.persist()],
        ["close", () => handle.close()],
      ]) {
        try {
          mutate();
          attempts.push({ stage: `${prefix}-${operation}`, error: null });
        } catch (error) {
          attempts.push({ stage: `${prefix}-${operation}`, error });
        }
      }
    };
    let resolveThenMethod;
    const thenMethodDone = new Promise((resolve) => {
      resolveThenMethod = resolve;
    });

    handle = openSessionBudget(sessionId, {
      store,
      registry: new Map(),
      limits: { maxSpawns: 3, maxConcurrent: 2 },
      onEvent: (event) => {
        if (event.type !== "budget:work-acquired") return undefined;
        if (mode === "getter") {
          return Object.defineProperty({}, "then", {
            get() {
              attemptAllMutations("getter");
              throw new Error("observer then getter failed");
            },
          });
        }
        return {
          then(_resolve, reject) {
            attemptAllMutations("method");
            reject(new Error("observer then method rejected"));
            resolveThenMethod();
          },
        };
      },
    });

    lease = handle.budget.acquireWork({
      id: "then-getter-business-label",
      depth: 1,
    });
    const getterRevision = store.read(sessionId).revision;
    await flushObservationEvents();

    expect(attempts.map(({ stage }) => stage)).toEqual([
      "getter-release",
      "getter-persist",
      "getter-close",
    ]);
    expect(store.read(sessionId).revision).toBe(getterRevision);
    expect(handle.budget.status().active).toBe(1);
    expect(lease.release()).toBe(true);

    mode = "method";
    lease = handle.budget.acquireWork({
      id: "then-method-business-label",
      depth: 1,
    });
    const methodRevision = store.read(sessionId).revision;
    await thenMethodDone;
    await flushObservationEvents();

    expect(attempts.map(({ stage }) => stage)).toEqual([
      "getter-release",
      "getter-persist",
      "getter-close",
      "method-release",
      "method-persist",
      "method-close",
    ]);
    for (const { error } of attempts) {
      expect(error).toMatchObject({
        budgetReason: "notification-reentrancy",
      });
    }
    expect(store.read(sessionId).revision).toBe(methodRevision);
    expect(handle.budget.status()).toMatchObject({
      active: 1,
      aborted: false,
    });
    expect(lease.release()).toBe(true);
    expect(handle.persist()).toBeGreaterThan(methodRevision);
    expect(handle.close()).toBe(true);
  });

  it("treats maxCostUsd as a tighten-only alias of maxUsd", () => {
    const { store } = makeStore();
    const first = openSessionBudget("cost-alias", {
      store,
      registry: new Map(),
      limits: { maxUsd: 5, maxCostUsd: 4 },
    });
    expect(first.budget.status().maxUsd).toBe(4);
    first.close();

    const registry = new Map();
    const resumed = openSessionBudget("cost-alias", {
      store,
      registry,
      limits: { maxUsd: 20, maxCostUsd: 3 },
    });
    expect(resumed.budget.status().maxUsd).toBe(3);
    const stricterHost = openSessionBudget("cost-alias", {
      store,
      registry,
      limits: { maxCostUsd: 2 },
    });
    expect(stricterHost.budget).toBe(resumed.budget);
    expect(stricterHost.budget.status().maxUsd).toBe(2);
    resumed.close();
    stricterHost.close();
    expect(store.read("cost-alias").snapshot.limits.maxUsd).toBe(2);
  });

  it("refuses to increment an exhausted or unsafe revision", () => {
    const { store } = makeStore();
    const handle = openSessionBudget("revision", {
      store,
      registry: new Map(),
    });
    handle.close();
    const filePath = store.pathForSession("revision");
    const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
    envelope.revision = Number.MAX_SAFE_INTEGER;
    fs.writeFileSync(filePath, `${JSON.stringify(envelope)}\n`, "utf8");

    expect(() =>
      openSessionBudget("revision", { store, registry: new Map() }),
    ).toThrow(/revision is exhausted/);
    expect(() =>
      store.write("revision", envelope.snapshot, {
        expectedRevision: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(/positive safe integer/);
    expect(store.read("revision").revision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects excessive in-flight state and marker unions without revision drift", () => {
    const { store } = makeStore();
    const clean = snapshotWithWorkEntries([]);
    const sessionId = "in-flight-cap";
    const baseline = store.write(sessionId, clean);
    const excessive = snapshotWithWorkEntries(
      Array.from({ length: 1025 }, () => `work-${randomUUID()}`),
    );

    const countError = captureError(() =>
      store.write(sessionId, excessive, {
        expectedRevision: baseline.revision,
      }),
    );
    expect(countError).toMatchObject({
      code: "ERR_SESSION_BUDGET_IN_FLIGHT_LIMIT",
    });
    expect(countError.message).toContain(
      "in-flight resource count exceeds 1024",
    );
    expect(store.read(sessionId).revision).toBe(baseline.revision);

    const markerSessionId = "marker-union-cap";
    const firstMarker = snapshotWithWorkEntries(
      Array.from({ length: 600 }, () => `usage-${randomUUID()}`),
      { kind: "usage-settlement" },
    );
    const disjointMarker = snapshotWithWorkEntries(
      Array.from({ length: 600 }, () => `usage-${randomUUID()}`),
      { kind: "usage-settlement" },
    );
    store.markUsageUnknown(markerSessionId, firstMarker);
    const markerPath = store.usageUnknownPathForSession(markerSessionId);
    const markerBefore = fs.readFileSync(markerPath, "utf8");

    const unionError = captureError(() =>
      store.markUsageUnknown(markerSessionId, disjointMarker),
    );
    expect(unionError).toMatchObject({
      code: "ERR_SESSION_BUDGET_IN_FLIGHT_LIMIT",
    });
    expect(unionError.message).toContain(
      "in-flight resource count exceeds 1024",
    );
    expect(fs.readFileSync(markerPath, "utf8")).toBe(markerBefore);
    expect(JSON.parse(markerBefore).revision).toBe(1);
  });

  it("applies the UTF-8 envelope limit to main and marker writes", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-session-budget-byte-cap-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "unicode.budget.json");
    const store = new SessionBudgetSidecarStore({
      resolvePath: () => filePath,
      allowUnsupportedPlatformForTests: true,
    });
    const oversizedSessionId = "界".repeat(350_000);
    const clean = snapshotWithWorkEntries([]);

    const mainError = captureError(() =>
      store.write(oversizedSessionId, clean),
    );
    expect(mainError).toMatchObject({
      code: "ERR_SESSION_BUDGET_SIDECAR_TOO_LARGE",
    });
    expect(mainError.message).toContain("maximum UTF-8 byte size");
    expect(fs.existsSync(filePath)).toBe(false);

    const pendingUsage = snapshotWithWorkEntries([`usage-${randomUUID()}`], {
      kind: "usage-settlement",
    });
    const markerError = captureError(() =>
      store.markUsageUnknown(oversizedSessionId, pendingUsage),
    );
    expect(markerError).toMatchObject({
      code: "ERR_SESSION_BUDGET_SIDECAR_TOO_LARGE",
    });
    expect(markerError.message).toContain("maximum UTF-8 byte size");
    expect(
      fs.existsSync(store.usageUnknownPathForSession(oversizedSessionId)),
    ).toBe(false);
  });

  it("keeps a durable dirty intent when final usage persistence fails", () => {
    const { store } = makeStore();
    let intentCommitted = false;
    const failingStore = {
      pathForSession: (id) => store.pathForSession(id),
      read: (id) => store.read(id),
      write: (id, snapshot, options) => {
        const pending = snapshot.inFlight.work.some(
          (entry) => entry.kind === "usage-settlement",
        );
        if (intentCommitted && !pending) {
          throw new Error("final usage durability unavailable");
        }
        const result = store.write(id, snapshot, options);
        if (pending) intentCommitted = true;
        return result;
      },
      markUsageUnknown: (...args) => store.markUsageUnknown(...args),
      finalizeUsageUnknown: () => {
        throw new Error("final usage durability unavailable");
      },
    };
    const handle = openSessionBudget("usage-final-failure", {
      store: failingStore,
      registry: new Map(),
    });

    expect(() =>
      handle.budget.recordUsage({
        provider: "ollama",
        model: "local",
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
    ).toThrow(/final usage durability unavailable/);
    expect(handle.budget.status()).toMatchObject({
      aborted: true,
      reason: "persistence-failed",
    });
    expect(handle.budget.snapshot().inFlight.work).toEqual([
      expect.objectContaining({ kind: "usage-settlement" }),
    ]);
    const durable = store.read("usage-final-failure");
    expect(durable.snapshot.inFlight.work).toEqual([
      expect.objectContaining({ kind: "usage-settlement" }),
    ]);

    const resumed = openSessionBudget("usage-final-failure", {
      store,
      registry: new Map(),
    });
    expect(resumed.budget.status()).toMatchObject({
      recoveryRequired: true,
      reason: "recovery-required",
    });
    resumed.close();
    expect(() => handle.close()).toThrow(/final usage durability unavailable/);
  });

  it("durably settles concurrent known and unknown provider usage", () => {
    const { store } = makeStore();
    const sessionId = "concurrent-provider-usage";
    const handle = openSessionBudget(sessionId, {
      store,
      registry: new Map(),
      limits: { maxTokens: 20 },
    });

    const first = handle.budget.beginUsageSettlement({ id: "provider-a" });
    const second = handle.budget.beginUsageSettlement({ id: "provider-b" });
    expect(first.ok && second.ok).toBe(true);
    expect(store.read(sessionId)).toMatchObject({ usageUnknown: true });

    handle.budget.recordUsage({
      callId: "provider-a",
      provider: "ollama",
      model: "local",
      usage: { input_tokens: 4, output_tokens: 1 },
    });
    const afterKnown = store.read(sessionId);
    expect(afterKnown).toMatchObject({
      usageUnknown: true,
      snapshot: { totals: { tokens: 5 } },
    });
    expect(afterKnown.snapshot.inFlight.work).toEqual([
      expect.objectContaining({
        id: second.authorityId,
        kind: "usage-settlement",
      }),
    ]);

    handle.budget.markUsageUnknown({ callId: "provider-b" });
    expect(handle.close()).toBe(true);
    const durable = store.read(sessionId);
    expect(durable).toMatchObject({
      usageUnknown: true,
      snapshot: { totals: { tokens: 5 } },
    });
    expect(durable.snapshot.inFlight.work).toHaveLength(1);

    const resumed = openSessionBudget(sessionId, {
      store,
      registry: new Map(),
    });
    expect(resumed.budget.status()).toMatchObject({
      tokens: 5,
      recoveryRequired: true,
      pendingRecovery: 1,
    });
    expect(
      resumed.budget.adjudicateRecovery({
        abandoned: [second.authorityId],
      }),
    ).toMatchObject({ ok: true });
    expect(resumed.close()).toBe(true);
    const clean = store.read(sessionId);
    expect(clean).not.toHaveProperty("usageUnknown");
    expect(clean).toMatchObject({
      snapshot: {
        totals: { tokens: 5 },
        inFlight: { work: [] },
      },
    });
  });

  it("keeps the dirty marker when finalization fails after atomic replace", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-session-budget-post-rename-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "post-rename.budget.json");
    let injectAfterRename = false;
    let failNextCommittedStat = false;
    const faultFs = new Proxy(fs, {
      get(target, property) {
        if (property === "renameSync") {
          return (source, destination) => {
            const result = fs.renameSync(source, destination);
            if (
              injectAfterRename &&
              path.basename(destination) === path.basename(filePath)
            ) {
              injectAfterRename = false;
              failNextCommittedStat = true;
            }
            return result;
          };
        }
        if (property === "lstatSync") {
          return (candidate, ...args) => {
            if (
              failNextCommittedStat &&
              path.basename(candidate) === path.basename(filePath)
            ) {
              failNextCommittedStat = false;
              const error = new Error("post-rename verification failure");
              error.code = "EIO";
              throw error;
            }
            return fs.lstatSync(candidate, ...args);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const store = new SessionBudgetSidecarStore({
      resolvePath: () => filePath,
      fileSystem: faultFs,
      allowUnsupportedPlatformForTests: true,
    });
    const faultingRuntimeStore = {
      pathForSession: (id) => store.pathForSession(id),
      read: (id) => store.read(id),
      write: (...args) => store.write(...args),
      markUsageUnknown: (...args) => store.markUsageUnknown(...args),
      finalizeUsageUnknown: (...args) => {
        injectAfterRename = true;
        return store.finalizeUsageUnknown(...args);
      },
    };
    const handle = openSessionBudget("post-rename", {
      store: faultingRuntimeStore,
      registry: new Map(),
    });

    expect(() =>
      handle.budget.recordUsage({
        provider: "ollama",
        model: "local",
        usage: { input_tokens: 2, output_tokens: 2 },
      }),
    ).toThrow(/post-rename verification failure/);

    const markerPath = store.usageUnknownPathForSession("post-rename");
    expect(fs.existsSync(markerPath)).toBe(true);
    const uncertain = store.read("post-rename");
    expect(uncertain.usageUnknown).toBe(true);
    expect(uncertain.snapshot.inFlight.work).toEqual([
      expect.objectContaining({ kind: "usage-settlement" }),
    ]);
    expect(() => handle.close()).toThrow(/post-rename verification failure/);

    const resumed = openSessionBudget("post-rename", {
      store,
      registry: new Map(),
    });
    const pending = resumed.budget.pendingRecovery();
    expect(
      resumed.budget.adjudicateRecovery({ abandoned: [pending[0].id] }),
    ).toMatchObject({ ok: true });
    resumed.close();
  });

  it("does not apply usage when both durable intent paths are unavailable", () => {
    const { store } = makeStore();
    const failingMarkerStore = {
      pathForSession: (id) => store.pathForSession(id),
      read: (id) => store.read(id),
      write: (...args) => store.write(...args),
      markUsageUnknown: () => {
        throw new Error("usage marker unavailable");
      },
      finalizeUsageUnknown: (...args) => store.finalizeUsageUnknown(...args),
    };
    const handle = openSessionBudget("usage-no-intent", {
      store: failingMarkerStore,
      registry: new Map(),
    });

    expect(() =>
      handle.budget.recordUsage({
        provider: "ollama",
        model: "local",
        usage: { input_tokens: 7, output_tokens: 3 },
      }),
    ).toThrow(/usage marker unavailable/);
    expect(handle.budget.status()).toMatchObject({
      aborted: true,
      reason: "persistence-failed",
      tokens: 0,
    });
    expect(store.read("usage-no-intent").snapshot).toMatchObject({
      totals: { tokens: 0 },
      inFlight: { work: [], tools: [] },
    });
    expect(() => handle.close()).toThrow(/usage marker unavailable/);
  });

  it("records an independent dirty marker when usage intent CAS fails", () => {
    const { store } = makeStore();
    const sessionId = "usage-intent-conflict";
    const first = openSessionBudget(sessionId, {
      store,
      registry: new Map(),
    });
    first.budget.start();
    const competing = openSessionBudget(sessionId, {
      store,
      registry: new Map(),
    });

    expect(() =>
      first.budget.recordUsage({
        provider: "ollama",
        model: "local",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ).toThrow(/expected revision/);
    expect(first.budget.status()).toMatchObject({
      aborted: true,
      reason: "persistence-failed",
      tokens: 0,
    });
    const markerPath = store.usageUnknownPathForSession(sessionId);
    expect(fs.existsSync(markerPath)).toBe(true);

    const marked = store.read(sessionId);
    expect(marked.usageUnknown).toBe(true);
    expect(marked.snapshot.inFlight.work).toEqual([
      expect.objectContaining({ kind: "usage-settlement" }),
    ]);
    const clean = structuredClone(marked.snapshot);
    clean.inFlight.work = [];
    expect(() =>
      store.write(sessionId, clean, {
        expectedRevision: marked.revision,
      }),
    ).toThrow(/unknown usage must be adjudicated/);
    expect(store.read(sessionId).revision).toBe(marked.revision);

    expect(() => first.close()).toThrow(/expected revision/);
    expect(() => competing.close()).toThrow(
      /unknown usage must be adjudicated/,
    );

    const resumed = openSessionBudget(sessionId, {
      store,
      registry: new Map(),
    });
    const pending = resumed.budget.pendingRecovery();
    expect(pending).toEqual([
      expect.objectContaining({ kind: "usage-settlement" }),
    ]);
    expect(
      resumed.budget.adjudicateRecovery({
        abandoned: [pending[0].id],
      }),
    ).toMatchObject({ ok: true });
    expect(fs.existsSync(markerPath)).toBe(false);
    expect(store.read(sessionId).snapshot.inFlight.work).toEqual([]);
    resumed.close();
  });

  it("preserves marker additions that arrive after recovery observation", () => {
    const { store } = makeStore();
    const sessionId = "usage-marker-observation-race";
    const clean = new SessionResourceBudget().snapshot();
    const usageX = `usage-${randomUUID()}`;
    const usageY = `usage-${randomUUID()}`;
    const unknownUsage = (id) => ({
      ...structuredClone(clean),
      inFlight: {
        work: [
          {
            id,
            kind: "usage-settlement",
            depth: 0,
            elapsedMs: 0,
          },
        ],
        tools: [],
      },
    });

    store.write(sessionId, unknownUsage(usageX));
    store.markUsageUnknown(sessionId, unknownUsage(usageX));
    const recovering = openSessionBudget(sessionId, {
      store,
      registry: new Map(),
    });
    expect(
      recovering.budget.pendingRecovery().map((entry) => entry.id),
    ).toEqual([usageX]);
    const observedMainRevision = store.read(sessionId).revision;

    // A stale writer reports a second provider charge after the recovery host
    // captured marker X. The append itself is durable, but the writer fails
    // closed instead of authorizing either host to finalize an unseen union.
    expect(() =>
      store.markUsageUnknown(sessionId, unknownUsage(usageY)),
    ).toThrow(/marker changed after it was observed/);
    expect(
      store
        .read(sessionId)
        .snapshot.inFlight.work.map((entry) => entry.id)
        .sort(),
    ).toEqual([usageX, usageY].sort());

    expect(() =>
      recovering.budget.adjudicateRecovery({ abandoned: [usageX] }),
    ).toThrow(/marker changed after it was observed/);
    expect(
      recovering.budget.pendingRecovery().map((entry) => entry.id),
    ).toEqual([usageX]);
    const preserved = store.read(sessionId);
    expect(preserved.revision).toBe(observedMainRevision);
    expect(fs.existsSync(store.usageUnknownPathForSession(sessionId))).toBe(
      true,
    );
    expect(
      preserved.snapshot.inFlight.work.map((entry) => entry.id).sort(),
    ).toEqual([usageX, usageY].sort());
    expect(() => recovering.close()).toThrow(
      /marker changed after it was observed/,
    );

    const resumed = openSessionBudget(sessionId, {
      store,
      registry: new Map(),
    });
    expect(
      resumed.budget
        .pendingRecovery()
        .map((entry) => entry.id)
        .sort(),
    ).toEqual([usageX, usageY].sort());
    resumed.close();
  });

  it("uses distinct settlement identities across hosts with identical clocks", () => {
    const settlementIds = [];
    const settle = () => {
      const budget = new SessionResourceBudget({
        now: () => 1234,
        onAuthorityChange: (change) => {
          if (change.type !== "budget:usage-settlement-started") return;
          settlementIds.push(
            change.snapshot.inFlight.work.find(
              (entry) => entry.kind === "usage-settlement",
            ).id,
          );
        },
      });
      budget.recordUsage({
        provider: "ollama",
        model: "local",
        usage: { input_tokens: 1 },
      });
      budget.dispose();
    };

    settle();
    settle();
    expect(new Set(settlementIds).size).toBe(2);
  });

  it("fails closed for Windows durable stores without a test override", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-session-budget-win-unsupported-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "unsupported.budget.json");
    const store = new SessionBudgetSidecarStore({
      resolvePath: () => filePath,
      platform: "win32",
    });

    const readError = captureError(() => store.read("unsupported"));
    expect(readError).toMatchObject({
      code: "ERR_SESSION_BUDGET_DURABLE_STORE_UNSUPPORTED",
    });
    const writeError = captureError(() =>
      store.write("unsupported", snapshotWithWorkEntries([])),
    );
    expect(writeError).toMatchObject({
      code: "ERR_SESSION_BUDGET_DURABLE_STORE_UNSUPPORTED",
    });
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it.skipIf(process.platform !== "linux")(
    "binds child writes to a dirfd when the parent path is swapped",
    () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-session-budget-parent-swap-"),
      );
      temporaryDirectories.push(root);
      const stateDirectory = path.join(root, "state");
      const displacedDirectory = path.join(root, "displaced-state");
      const attackerDirectory = path.join(root, "attacker-state");
      fs.mkdirSync(stateDirectory, { mode: 0o700 });
      const filePath = path.join(stateDirectory, "parent-swap.budget.json");
      let swapped = false;
      const swappingFs = new Proxy(fs, {
        get(target, property) {
          if (property === "openSync") {
            return (candidate, ...args) => {
              if (
                !swapped &&
                String(candidate).startsWith("/proc/self/fd/") &&
                path.basename(String(candidate)).endsWith(".tmp")
              ) {
                fs.renameSync(stateDirectory, displacedDirectory);
                fs.mkdirSync(attackerDirectory, { mode: 0o700 });
                fs.symlinkSync(attackerDirectory, stateDirectory, "dir");
                swapped = true;
              }
              return fs.openSync(candidate, ...args);
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const store = new SessionBudgetSidecarStore({
        resolvePath: () => filePath,
        fileSystem: swappingFs,
      });

      try {
        expect(() =>
          store.write("parent-swap", snapshotWithWorkEntries([])),
        ).toThrow(/parent directory|regular non-symlink directory/);
        expect(swapped).toBe(true);
        expect(
          fs.existsSync(path.join(attackerDirectory, path.basename(filePath))),
        ).toBe(false);
      } finally {
        try {
          if (fs.lstatSync(stateDirectory).isSymbolicLink()) {
            fs.unlinkSync(stateDirectory);
          }
        } catch {
          // The exact test path may already have been restored.
        }
        if (
          fs.existsSync(displacedDirectory) &&
          !fs.existsSync(stateDirectory)
        ) {
          fs.renameSync(displacedDirectory, stateDirectory);
        }
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "detects a symlink swap between lstat and descriptor open",
    () => {
      const { directory, store } = makeStore();
      const handle = openSessionBudget("swap", {
        store,
        registry: new Map(),
      });
      handle.close();
      const filePath = store.pathForSession("swap");
      const displaced = path.join(directory, "displaced-budget.json");
      let swapped = false;
      const swappingFs = new Proxy(fs, {
        get(target, property) {
          if (property === "openSync") {
            return (candidate, ...args) => {
              if (
                !swapped &&
                path.basename(candidate) === path.basename(filePath)
              ) {
                swapped = true;
                fs.renameSync(filePath, displaced);
                fs.symlinkSync(displaced, filePath);
              }
              return fs.openSync(candidate, ...args);
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const guarded = new SessionBudgetSidecarStore({
        resolvePath: () => filePath,
        fileSystem: swappingFs,
        allowUnsupportedPlatformForTests: true,
      });

      expect(() => guarded.read("swap")).toThrow(/Session budget read failed/);
      expect(swapped).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a parent directory accessible to other users",
    () => {
      const { directory, store } = makeStore();
      fs.chmodSync(directory, 0o755);
      try {
        expect(() => store.read("missing")).toThrow(
          /directory permissions must not grant group\/other access/,
        );
      } finally {
        fs.chmodSync(directory, 0o700);
      }
    },
  );

  it("uses opaque authority ids and never persists caller business labels", () => {
    const { store } = makeStore();
    const sessionId = "opaque-authority-audit";
    const businessLabel = "customer-secret-reference";
    const handle = openSessionBudget(sessionId, {
      store,
      registry: new Map(),
      limits: { maxSpawns: 2, maxConcurrent: 2 },
    });
    const lease = handle.budget.acquireWork({
      id: businessLabel,
      kind: "background",
      depth: 1,
    });

    expect(lease).toMatchObject({
      ok: true,
      id: businessLabel,
    });
    expect(lease.authorityId).toMatch(
      /^work-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const durable = store.read(sessionId);
    expect(durable.snapshot.inFlight.work).toEqual([
      expect.objectContaining({ id: lease.authorityId }),
    ]);
    expect(JSON.stringify(durable)).not.toContain(businessLabel);

    expect(handle.budget.releaseWork(businessLabel)).toBe(false);
    expect(store.read(sessionId).revision).toBe(durable.revision);

    const durableBeforeForgery = structuredClone(durable);
    const smuggled = structuredClone(durable.snapshot);
    smuggled.inFlight.work[0].id = "secret-business-label";
    const smugglingError = captureError(() =>
      store.write(sessionId, smuggled, {
        expectedRevision: durable.revision,
      }),
    );
    expect(smugglingError).toMatchObject({
      code: "ERR_SESSION_BUDGET_NON_OPAQUE_AUTHORITY",
    });
    expect(store.read(sessionId)).toEqual(durableBeforeForgery);
    expect(handle.status().persistenceRevision).toBe(durable.revision);

    expect(handle.budget.releaseWork(lease.authorityId)).toBe(true);
    expect(store.read(sessionId).snapshot.inFlight.work).toEqual([]);
    handle.close();
  });

  it("canonicalizes and deep-copies snapshots without secret smuggling", () => {
    const { store } = makeStore();
    const source = new SessionResourceBudget({ maxTurns: 3 });
    const lease = source.acquireWork({
      id: "original-work",
      kind: "sub-agent",
      depth: 1,
    });
    const snapshot = source.snapshot();
    snapshot.secret = "TOP-SECRET";
    snapshot.limits.secret = "TOP-SECRET";
    snapshot.inFlight.work[0].secret = "TOP-SECRET";
    snapshot.state.secret = "TOP-SECRET";
    snapshot.state.abort = {
      reason: "unsafe reason containing TOP-SECRET",
      message: "TOP-SECRET",
    };
    snapshot.toJSON = () => ({ secret: "TOP-SECRET" });

    store.write("canonical", snapshot);
    snapshot.totals.turns = 999;
    snapshot.inFlight.work[0].id = "mutated-after-write";
    const stored = store.read("canonical");

    expect(stored.snapshot.totals.turns).toBe(0);
    expect(stored.snapshot.inFlight.work[0].id).toBe(lease.authorityId);
    expect(JSON.stringify(stored)).not.toContain("original-work");
    expect(JSON.stringify(stored)).not.toContain("TOP-SECRET");
    expect(stored.snapshot.state.abort).toEqual({
      reason: "session-aborted",
      message: "Session resource budget stopped: session-aborted",
    });
    expect(stored.snapshot).not.toHaveProperty("toJSON");
    source.dispose();
  });

  it("bounds resource identities and normalizes kind and abort metadata", () => {
    const { store } = makeStore();
    const source = new SessionResourceBudget({ maxSpawns: 3 });

    expect(() =>
      source.acquireWork({
        id: "TOP SECRET",
        kind: "sub-agent",
        depth: 1,
      }),
    ).toThrow(/invalid session budget work id/);
    expect(() => source.beginTool({ id: `tool-${"x".repeat(200)}` })).toThrow(
      /invalid session budget tool id/,
    );
    const lease = source.acquireWork({
      id: "bounded-work",
      kind: "api-key=TOP-SECRET",
      depth: 1,
    });
    expect(lease.ok).toBe(true);
    source.abort(new Error("TOP-SECRET"), {
      reason: "unsafe-TOP-SECRET",
    });

    store.write("bounded-metadata", source.snapshot());
    const stored = store.read("bounded-metadata");
    expect(stored.snapshot.inFlight.work[0]).toMatchObject({
      id: lease.authorityId,
      kind: "work",
    });
    expect(JSON.stringify(stored)).not.toContain("bounded-work");
    expect(stored.snapshot.state.abort).toEqual({
      reason: "session-aborted",
      message: "Session resource budget stopped: session-aborted",
    });
    expect(JSON.stringify(stored)).not.toContain("TOP-SECRET");
    source.dispose();
  });

  it("cascades a linked host abort through the shared authority", () => {
    const { store } = makeStore();
    const controller = new AbortController();
    const handle = openSessionBudget("abort", {
      store,
      registry: new Map(),
      signal: controller.signal,
    });
    const stopped = [];
    handle.budget.registerAbortable("child", () => stopped.push("child"));

    controller.abort(new Error("request cancelled"));

    expect(handle.budget.status()).toMatchObject({
      aborted: true,
      reason: "host-aborted",
    });
    expect(stopped).toEqual(["child"]);
    handle.close();
  });

  it("releases runtime references when custom signal cleanup throws", () => {
    const { store } = makeStore();
    const registry = new Map();
    const listeners = new Set();
    const signal = {
      aborted: false,
      addEventListener(_type, callback) {
        listeners.add(callback);
      },
      removeEventListener(_type, callback) {
        listeners.delete(callback);
        throw new Error("custom signal unlink failed");
      },
    };
    const handle = openSessionBudget("throwing-signal-cleanup", {
      store,
      registry,
      signal,
    });
    expect(listeners.size).toBe(1);

    expect(() => handle.close()).not.toThrow();
    expect(listeners.size).toBe(0);
    expect(sessionBudgetRuntimeCount(registry)).toBe(0);
  });

  it("uses BigInt identity and limits Windows device projection bridging to affected libuv", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-session-budget-zero-device-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "zero-device.budget.json");
    const identityCalls = [];
    const withDevice = (stat, dev) =>
      new Proxy(stat, {
        get(target, property) {
          if (property === "dev") return dev;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const projectedFs = new Proxy(fs, {
      get(target, property) {
        if (property === "lstatSync") {
          return (candidate, options) => {
            expect(options).toEqual({ bigint: true });
            identityCalls.push({ method: property, bigint: true });
            return withDevice(fs.lstatSync(candidate, options), 0n);
          };
        }
        if (property === "fstatSync") {
          return (descriptor, options) => {
            expect(options).toEqual({ bigint: true });
            identityCalls.push({ method: property, bigint: true });
            return withDevice(fs.fstatSync(descriptor, options), 73n);
          };
        }
        if (property === "statSync") {
          return (candidate, options) => {
            expect(options).toEqual({ bigint: true });
            identityCalls.push({ method: property, bigint: true });
            return withDevice(fs.statSync(candidate, options), 0n);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const snapshot = snapshotWithWorkEntries([]);
    const affected = new SessionBudgetSidecarStore({
      resolvePath: () => filePath,
      fileSystem: projectedFs,
      platform: "win32",
      uvVersion: "1.49.1",
      allowUnsupportedPlatformForTests: true,
    });

    expect(affected.write("zero-device", snapshot)).toMatchObject({
      revision: 1,
    });
    expect(affected.read("zero-device")).toMatchObject({ revision: 1 });
    expect(identityCalls.length).toBeGreaterThan(10);
    expect(identityCalls.every((entry) => entry.bigint)).toBe(true);

    const fixedRuntimePath = path.join(directory, "fixed-uv.budget.json");
    const fixedRuntime = new SessionBudgetSidecarStore({
      resolvePath: () => fixedRuntimePath,
      fileSystem: projectedFs,
      platform: "win32",
      uvVersion: "1.51.0",
      allowUnsupportedPlatformForTests: true,
    });
    expect(() => fixedRuntime.write("fixed-uv", snapshot)).toThrow(
      /parent directory identity changed during open/,
    );
  });

  it("writes a private atomic sidecar and refuses corrupt state", () => {
    const { directory, store } = makeStore();
    const handle = openSessionBudget("private", {
      store,
      registry: new Map(),
    });
    const filePath = store.pathForSession("private");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(
      fs.readdirSync(directory).filter((entry) => entry.endsWith(".tmp")),
    ).toEqual([]);
    if (process.platform !== "win32") {
      expect(fs.statSync(filePath).mode & 0o077).toBe(0);
    }
    handle.close();

    fs.writeFileSync(filePath, "{not-json\n", { mode: 0o600 });
    expect(() =>
      openSessionBudget("private", { store, registry: new Map() }),
    ).toThrow(/Session budget corrupt failed/);
  });
});
