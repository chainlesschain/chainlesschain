import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openSessionBudget,
  SessionBudgetSidecarStore,
  sessionBudgetRuntimeCount,
} from "../../src/lib/session-budget-runtime.js";
import { SessionResourceBudget } from "../../src/lib/session-resource-budget.js";

const temporaryDirectories = [];

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

  it("blocks a dirty restore until every exact in-flight id is adjudicated", () => {
    const { store } = makeStore();
    const crashed = openSessionBudget("dirty", {
      store,
      registry: new Map(),
      limits: { maxSpawns: 5 },
    });
    expect(
      crashed.budget.acquireWork({
        id: "background:pid-7",
        kind: "background",
        depth: 1,
      }).ok,
    ).toBe(true);
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
      expect.objectContaining({ id: "background:pid-7" }),
    ]);
    expect(
      resumed.budget.acquireWork({ id: "new-work", depth: 1 }),
    ).toMatchObject({ ok: false, reason: "recovery-required" });
    expect(resumed.budget.adjudicateRecovery({ abandoned: [] })).toMatchObject({
      ok: false,
    });
    expect(
      resumed.budget.adjudicateRecovery({ abandoned: ["background:pid-7"] }),
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
    ({ id, begin, finish, expected }) => {
      const { store } = makeStore();
      const sessionId = `terminal-${id}`;
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
      expect(first.budget.snapshot().inFlight).toEqual(expected(id));
      expect(store.read(sessionId).snapshot.inFlight).toEqual(expected(id));
      expect(() => first.close()).toThrow(/expected revision/);
      competing.close();
    },
  );

  it("rejects an authority mutation synchronously when persistence throws", () => {
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

  it("denies observer re-entry while usage settlement is pending", () => {
    const { store } = makeStore();
    let handle = null;
    const reentrantAdmissions = [];
    handle = openSessionBudget("usage-observer", {
      store,
      registry: new Map(),
      limits: { maxTurns: 3, maxSpawns: 3 },
      onEvent: (event) => {
        if (event.type !== "budget:usage-settlement-started") return;
        reentrantAdmissions.push(
          handle.budget.consumeTurn({ id: "observer-turn" }),
          handle.budget.acquireWork({
            id: "observer-work",
            kind: "sub-agent",
            depth: 1,
          }),
        );
      },
    });

    handle.budget.recordUsage({
      provider: "ollama",
      model: "local",
      usage: { input_tokens: 2, output_tokens: 1 },
    });

    expect(reentrantAdmissions).toEqual([
      expect.objectContaining({
        ok: false,
        reason: "usage-settlement-pending",
      }),
      expect.objectContaining({
        ok: false,
        reason: "usage-settlement-pending",
      }),
    ]);
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
              path.resolve(destination) === path.resolve(filePath)
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
              path.resolve(candidate) === path.resolve(filePath)
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

    store.write(sessionId, unknownUsage("usage-x"));
    store.markUsageUnknown(sessionId, unknownUsage("usage-x"));
    const recovering = openSessionBudget(sessionId, {
      store,
      registry: new Map(),
    });
    expect(
      recovering.budget.pendingRecovery().map((entry) => entry.id),
    ).toEqual(["usage-x"]);
    const observedMainRevision = store.read(sessionId).revision;

    // A stale writer reports a second provider charge after the recovery host
    // captured marker X. The append itself is durable, but the writer fails
    // closed instead of authorizing either host to finalize an unseen union.
    expect(() =>
      store.markUsageUnknown(sessionId, unknownUsage("usage-y")),
    ).toThrow(/marker changed after it was observed/);
    expect(
      store
        .read(sessionId)
        .snapshot.inFlight.work.map((entry) => entry.id)
        .sort(),
    ).toEqual(["usage-x", "usage-y"]);

    expect(() =>
      recovering.budget.adjudicateRecovery({ abandoned: ["usage-x"] }),
    ).toThrow(/marker changed after it was observed/);
    expect(
      recovering.budget.pendingRecovery().map((entry) => entry.id),
    ).toEqual(["usage-x"]);
    const preserved = store.read(sessionId);
    expect(preserved.revision).toBe(observedMainRevision);
    expect(fs.existsSync(store.usageUnknownPathForSession(sessionId))).toBe(
      true,
    );
    expect(
      preserved.snapshot.inFlight.work.map((entry) => entry.id).sort(),
    ).toEqual(["usage-x", "usage-y"]);
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
    ).toEqual(["usage-x", "usage-y"]);
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
                path.resolve(candidate) === path.resolve(filePath)
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

  it("canonicalizes and deep-copies snapshots without secret smuggling", () => {
    const { store } = makeStore();
    const source = new SessionResourceBudget({ maxTurns: 3 });
    source.acquireWork({ id: "original-work", kind: "sub-agent", depth: 1 });
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
    expect(stored.snapshot.inFlight.work[0].id).toBe("original-work");
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
    expect(
      source.acquireWork({
        id: "bounded-work",
        kind: "api-key=TOP-SECRET",
        depth: 1,
      }).ok,
    ).toBe(true);
    source.abort(new Error("TOP-SECRET"), {
      reason: "unsafe-TOP-SECRET",
    });

    store.write("bounded-metadata", source.snapshot());
    const stored = store.read("bounded-metadata");
    expect(stored.snapshot.inFlight.work[0]).toMatchObject({
      id: "bounded-work",
      kind: "work",
    });
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
