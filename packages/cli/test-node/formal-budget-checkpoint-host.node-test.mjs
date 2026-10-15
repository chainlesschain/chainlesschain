import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { FormalBudgetAuthority } from "../src/lib/formal-budget-authority.js";
import {
  FormalBudgetLineageRegistry,
  lineageCheckpointDigest,
} from "../src/lib/formal-budget-lineage-registry.js";
import { createFormalBudgetTransport } from "../src/lib/formal-budget-transport.js";
import {
  NOW,
  attest,
  body,
  config,
  response,
  verifyFixtureEvidence,
} from "./formal-budget-fixture.mjs";

const Database = createRequire(import.meta.url)("better-sqlite3");
const worker = fileURLToPath(
  new URL("./formal-budget-lineage-worker.mjs", import.meta.url),
);
function sql(filename, action) {
  const db = new Database(filename);
  try {
    return action(db);
  } finally {
    db.close();
  }
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-checkpoint-host-"));
  const checkpointFile = path.join(root, "SYNTHETIC-HOST.json");
  fs.writeFileSync(checkpointFile, "[]");
  // This file is an offline fixture, never evidence of independently protected
  // production storage. The trusted real host must authenticate and keep latest
  // records outside both database restoration domains, with monotonic writes.
  const hooks = {},
    events = [];
  const host = {
    id: "fixture-independent-host",
    load() {
      if (hooks.load) return hooks.load();
      return JSON.parse(fs.readFileSync(checkpointFile, "utf8"));
    },
    publish(checkpoint, checkpointDigest) {
      events.push(`checkpoint:${checkpoint.head.revision}`);
      if (hooks.publish) return hooks.publish(checkpoint, checkpointDigest);
      persist(checkpoint);
      return { durable: true, checkpointDigest };
    },
  };
  function persist(checkpoint) {
    const heads = JSON.parse(fs.readFileSync(checkpointFile, "utf8"));
    const previous = heads.find(
      (c) => c.head.lineage_id === checkpoint.head.lineage_id,
    );
    assert.ok(!previous || previous.head.revision <= checkpoint.head.revision);
    if (previous?.head.revision === checkpoint.head.revision)
      assert.equal(
        lineageCheckpointDigest(previous),
        lineageCheckpointDigest(checkpoint),
      );
    const fd = fs.openSync(checkpointFile, "w");
    try {
      fs.writeFileSync(
        fd,
        JSON.stringify([
          ...heads.filter(
            (c) => c.head.lineage_id !== checkpoint.head.lineage_id,
          ),
          checkpoint,
        ]),
      );
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  const registryDescriptor = FormalBudgetLineageRegistry.initialize({
    filename: path.join(root, "registry.sqlite"),
    checkpointHostId: host.id,
  });
  const registries = [],
    authorities = [];
  const openRegistry = (overrides = {}) => {
    const value = new FormalBudgetLineageRegistry({
      ...registryDescriptor,
      checkpointHost: host,
      ...overrides,
    });
    registries.push(value);
    return value;
  };
  const registry = openRegistry(),
    cfg = config();
  const descriptor = FormalBudgetAuthority.initialize({
    filename: path.join(root, "authority.sqlite"),
    config: cfg,
    verifyEvidence: verifyFixtureEvidence,
    now: () => NOW,
    lineageRegistry: registry,
  });
  const openAuthority = (lineageRegistry = registry) => {
    const value = new FormalBudgetAuthority({
      ...descriptor,
      lineageRegistry,
      verifyEvidence: verifyFixtureEvidence,
      now: () => NOW,
    });
    authorities.push(value);
    return value;
  };
  const a = openAuthority();
  a.beginRun({ taskId: "task-0", runId: "initial", phase: "initial" });
  t.after(() => {
    for (const value of [...authorities, ...registries])
      try {
        value.close();
      } catch {
        /* Already closed. */
      }
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("cc-checkpoint-host-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const latest = () => JSON.parse(fs.readFileSync(checkpointFile, "utf8"))[0];
  return {
    root,
    checkpointFile,
    registryDescriptor,
    descriptor,
    registry,
    cfg,
    a,
    host,
    hooks,
    events,
    persist,
    latest,
    openRegistry,
    openAuthority,
  };
}
function transport(f, options = {}) {
  const calls = { credentials: 0, fetches: 0 };
  const value = createFormalBudgetTransport({
    authority: f.a,
    credentialProvider: () => {
      calls.credentials++;
      f.events.push("credential");
      return "OFFLINE-FAKE-KEY";
    },
    fetchImpl: () => {
      calls.fetches++;
      f.events.push("fetch");
      return Response.json(response());
    },
    ...options,
  });
  return { value, calls };
}
const dispatch = (value, callId = "call-1") =>
  value.dispatch({ runId: "initial", callId, body });
const reserve = (f, callId = "call-1") =>
  f.a.reserve({ runId: "initial", callId, body });
function rawCall(f) {
  return sql(f.descriptor.filename, (db) =>
    db
      .prepare("SELECT state,reserved_usd,cost_usd FROM call WHERE id='call-1'")
      .get(),
  );
}
async function child(
  f,
  overrides = {},
  callId = "child-call",
  terminate = false,
) {
  const input = path.join(f.root, `${callId}.json`);
  fs.writeFileSync(
    input,
    JSON.stringify({
      registry: f.registryDescriptor,
      authority: f.descriptor,
      checkpointFile: f.checkpointFile,
      ...overrides,
    }),
  );
  const p = fork(worker, [input, callId], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });
  const exited = new Promise((resolve) => p.once("exit", resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Offline checkpoint worker timed out")),
        30000,
      );
      p.once("message", (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      p.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      p.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Worker exited without a receipt"));
      });
    });
    if (terminate) p.kill("SIGKILL");
    await exited;
    return result;
  } finally {
    if (p.exitCode === null && p.signalCode === null) {
      p.kill("SIGKILL");
      await exited;
    }
  }
}

test("pinned host cannot be omitted or replaced even when descriptor host ID is omitted", (t) => {
  const f = fixture(t);
  for (const checkpointHost of [undefined, { ...f.host, id: "wrong-host" }])
    assert.throws(
      () => f.openRegistry({ checkpointHost, checkpointHostId: undefined }),
      { code: "CC_BUDGET_LINEAGE_HOST_REQUIRED" },
    );
  assert.throws(() => f.openRegistry({ checkpointHostId: "wrong-host" }), {
    code: "CC_BUDGET_LINEAGE_HOST_REQUIRED",
  });
});
test("direct async and generator host ports are rejected before invocation", (t) => {
  const f = fixture(t);
  let invoked = 0;
  for (const method of ["load", "publish"])
    for (const operation of [
      async () => {
        invoked++;
      },
      function* () {
        invoked++;
      },
      async function* () {
        invoked++;
      },
    ])
      assert.throws(
        () =>
          f.openRegistry({
            checkpointHost: { ...f.host, [method]: operation },
          }),
        { code: "CC_BUDGET_LINEAGE_HOST_ASYNC" },
      );
  assert.equal(invoked, 0);
});
test("promise-returning host reads are refused without executing thenables", (t) => {
  const f = fixture(t);
  let thenCalls = 0;
  for (const value of [
    Promise.resolve([]),
    Promise.reject(new Error("offline")),
    {
      then() {
        thenCalls++;
      },
    },
  ]) {
    f.hooks.load = () => value;
    assert.throws(() => f.openRegistry(), {
      code: "CC_BUDGET_LINEAGE_HOST_ASYNC",
    });
  }
  assert.equal(thenCalls, 0);
});
test("missing latest heads fail on open and before credential access", async (t) => {
  const f = fixture(t),
    { value, calls } = transport(f);
  f.hooks.load = () => [];
  assert.throws(() => f.openRegistry(), {
    code: "CC_BUDGET_LINEAGE_HOST_STALE",
  });
  await assert.rejects(dispatch(value), {
    code: "CC_BUDGET_LINEAGE_HOST_STALE",
    noReplay: true,
  });
  assert.deepEqual(calls, { credentials: 0, fetches: 0 });
  assert.equal(rawCall(f), undefined);
});
test("malformed, duplicate and foreign host records are refused", (t) => {
  const f = fixture(t),
    original = f.latest();
  for (const heads of [
    null,
    [original, original],
    [{ ...original, schema: "wrong" }],
    [
      {
        ...original,
        registry: { ...original.registry, registryId: "foreign" },
      },
    ],
  ]) {
    f.hooks.load = () => heads;
    assert.throws(() => f.openRegistry(), {
      code: "CC_BUDGET_LINEAGE_HOST_RECEIPT",
    });
  }
});
test("stale and future host revisions cannot silently seed or downgrade the registry", (t) => {
  const f = fixture(t),
    current = f.latest();
  for (const revision of [
    current.head.revision - 1,
    current.head.revision + 1,
  ]) {
    f.hooks.load = () => [{ ...current, head: { ...current.head, revision } }];
    assert.throws(() => f.openRegistry(), {
      code: "CC_BUDGET_LINEAGE_HOST_STALE",
    });
  }
});
test("host read exceptions keep all downstream sends and credentials at zero", async (t) => {
  const f = fixture(t),
    { value, calls } = transport(f);
  f.hooks.load = () => {
    throw new Error("offline storage failure");
  };
  await assert.rejects(dispatch(value), {
    code: "CC_BUDGET_LINEAGE_HOST_UNAVAILABLE",
    noReplay: true,
  });
  assert.deepEqual(calls, { credentials: 0, fetches: 0 });
});
test("reservation publication failure commits only the registry and denies retries without resetting", async (t) => {
  const f = fixture(t),
    { value, calls } = transport(f),
    before = f.latest();
  f.hooks.publish = () => {
    throw new Error("offline write failed");
  };
  await assert.rejects(dispatch(value), {
    code: "CC_BUDGET_LINEAGE_HOST_UNAVAILABLE",
  });
  assert.equal(rawCall(f), undefined);
  assert.equal(f.latest().head.revision, before.head.revision);
  assert.equal(
    sql(f.registryDescriptor.filename, (db) =>
      db.prepare("SELECT revision FROM lineage").get(),
    ).revision,
    before.head.revision + 1,
  );
  delete f.hooks.publish;
  await assert.rejects(dispatch(value, "retry"), {
    code: "CC_BUDGET_LINEAGE_HOST_STALE",
  });
  assert.deepEqual(calls, { credentials: 0, fetches: 0 });
});
for (const [name, receipt] of [
  ["missing", undefined],
  ["non-durable", { durable: false }],
  ["wrong digest", { durable: true, checkpointDigest: "0".repeat(64) }],
  ["async", Promise.resolve({ durable: true })],
]) {
  test(`a ${name} publication receipt cannot authorize a reservation`, async (t) => {
    const f = fixture(t),
      { value, calls } = transport(f);
    f.hooks.publish = () => receipt;
    await assert.rejects(dispatch(value), {
      code:
        name === "async"
          ? "CC_BUDGET_LINEAGE_HOST_ASYNC"
          : "CC_BUDGET_LINEAGE_HOST_RECEIPT",
    });
    assert.deepEqual(calls, { credentials: 0, fetches: 0 });
    assert.equal(rawCall(f), undefined);
  });
}
test("a matching acknowledgement without readback persistence cannot authorize sending", async (t) => {
  const f = fixture(t),
    { value, calls } = transport(f);
  f.hooks.publish = (_c, checkpointDigest) => ({
    durable: true,
    checkpointDigest,
  });
  await assert.rejects(dispatch(value), {
    code: "CC_BUDGET_LINEAGE_HOST_STALE",
  });
  assert.deepEqual(calls, { credentials: 0, fetches: 0 });
});
test("host failures during markDispatched retain the held liability and prevent physical fetch", async (t) => {
  const f = fixture(t),
    { value, calls } = transport(f);
  f.hooks.publish = (checkpoint, checkpointDigest) => {
    if (checkpoint.head.revision === 3)
      throw new Error("offline dispatch checkpoint failure");
    f.persist(checkpoint);
    return { durable: true, checkpointDigest };
  };
  await assert.rejects(dispatch(value), {
    code: "CC_BUDGET_TRANSPORT_UNKNOWN",
    noReplay: true,
  });
  assert.deepEqual(calls, { credentials: 1, fetches: 0 });
  assert.deepEqual(rawCall(f), {
    state: "held",
    reserved_usd: 1500,
    cost_usd: null,
  });
});
test("every physical send follows a durable dispatched checkpoint and local commit", async (t) => {
  const f = fixture(t),
    { value, calls } = transport(f, {
      fetchImpl: () => {
        calls.fetches++;
        f.events.push("fetch");
        assert.equal(f.latest().head.revision, 3);
        assert.equal(rawCall(f).state, "dispatched");
        return Response.json(response());
      },
    });
  f.events.length = 0;
  const result = await dispatch(value);
  assert.equal(result.cost.costUsdMicros, 46);
  assert.ok(f.events.indexOf("checkpoint:2") < f.events.indexOf("credential"));
  assert.ok(f.events.indexOf("checkpoint:3") < f.events.indexOf("fetch"));
  assert.equal(f.latest().head.revision, 4);
  assert.equal(f.a.status().exposureUsdMicros, 46);
  await assert.rejects(dispatch(value), { code: "CC_BUDGET_CALL_REPLAY" });
  assert.deepEqual(calls, { credentials: 1, fetches: 1 });
});
test("publisher observes registry commit before authority commit and receives immutable exact state", (t) => {
  const f = fixture(t);
  f.hooks.publish = (checkpoint, checkpointDigest) => {
    assert.equal(
      sql(f.registryDescriptor.filename, (db) =>
        db.prepare("SELECT revision FROM lineage").get(),
      ).revision,
      checkpoint.head.revision,
    );
    assert.equal(rawCall(f), undefined);
    assert.ok(
      Object.isFrozen(checkpoint) &&
        Object.isFrozen(checkpoint.head) &&
        Object.isFrozen(checkpoint.registry),
    );
    assert.equal(lineageCheckpointDigest(checkpoint), checkpointDigest);
    f.persist(checkpoint);
    return { durable: true, checkpointDigest };
  };
  reserve(f);
  assert.equal(rawCall(f).state, "held");
});
test("settlement publication failure withholds successful EOF and retains dispatched liability", async (t) => {
  const f = fixture(t),
    { value, calls } = transport(f);
  f.hooks.publish = (checkpoint, checkpointDigest) => {
    if (checkpoint.head.revision === 4)
      throw new Error("offline settlement checkpoint failure");
    f.persist(checkpoint);
    return { durable: true, checkpointDigest };
  };
  await assert.rejects(dispatch(value), {
    code: "CC_BUDGET_TRANSPORT_UNKNOWN",
  });
  assert.deepEqual(rawCall(f), {
    state: "dispatched",
    reserved_usd: 1500,
    cost_usd: null,
  });
  assert.deepEqual(calls, { credentials: 1, fetches: 1 });
  assert.throws(() => f.openRegistry(), {
    code: "CC_BUDGET_LINEAGE_HOST_STALE",
  });
});
test("after host durability but before local commit failure cannot grant new credit", (t) => {
  const f = fixture(t);
  f.hooks.publish = (checkpoint) => {
    f.persist(checkpoint);
    throw new Error("offline lost acknowledgement");
  };
  assert.throws(() => reserve(f), {
    code: "CC_BUDGET_LINEAGE_HOST_UNAVAILABLE",
  });
  assert.equal(f.latest().head.revision, 2);
  assert.equal(rawCall(f), undefined);
  delete f.hooks.publish;
  assert.throws(() => f.openAuthority(f.openRegistry()), {
    code: "CC_BUDGET_LINEAGE_STATE",
  });
});
test("deleting live host policy or opening a tampered policy cannot bypass authority guard", (t) => {
  const f = fixture(t);
  sql(f.registryDescriptor.filename, (db) =>
    db.exec("DROP TABLE checkpoint_policy"),
  );
  assert.throws(() => f.a.status(), {
    code: "CC_BUDGET_LINEAGE_HOST_REQUIRED",
  });
  assert.throws(() => f.openRegistry(), {
    code: "CC_BUDGET_LINEAGE_HOST_REQUIRED",
  });
  const unguarded = f.openRegistry({
    checkpointHostId: undefined,
    checkpointHost: undefined,
  });
  assert.throws(() => f.openAuthority(unguarded), {
    code: "CC_BUDGET_LINEAGE_IDENTITY",
  });
});
test("host callback methods are pinned and registry reentry cannot publish through an active operation", (t) => {
  const f = fixture(t);
  f.host.load = () => {
    throw new Error("must not replace pinned callback");
  };
  f.hooks.publish = (checkpoint, checkpointDigest) => {
    assert.throws(() => f.registry.status(f.cfg.plan.lineageId), {
      code: "CC_BUDGET_LINEAGE_BUSY",
    });
    f.persist(checkpoint);
    return { durable: true, checkpointDigest };
  };
  reserve(f);
  assert.equal(rawCall(f).state, "held");
});
test("a fresh real process cannot omit a pinned host", async (t) => {
  const f = fixture(t);
  assert.deepEqual(await child(f, { checkpointFile: null }), {
    ok: false,
    code: "CC_BUDGET_LINEAGE_HOST_REQUIRED",
  });
});
test("fresh processes reload latest host heads and do not consume a duplicate reservation", async (t) => {
  const f = fixture(t);
  assert.deepEqual(await child(f, {}, "same-call"), { ok: true });
  assert.deepEqual(await child(f, {}, "same-call"), {
    ok: false,
    code: "CC_BUDGET_PENDING",
  });
  assert.equal(f.latest().head.revision, 2);
  assert.equal(
    f.openAuthority(f.openRegistry()).status().exposureUsdMicros,
    1500,
  );
});
test("matching old databases restored in place are refused on real process restart by mandatory latest host", async (t) => {
  const f = fixture(t),
    old = f.latest();
  f.a.close();
  const snapshot = path.join(f.root, "old.sqlite");
  fs.copyFileSync(f.descriptor.filename, snapshot);
  const a = f.openAuthority();
  a.reserve({ runId: "initial", callId: "spent-call", body });
  a.markDispatched("spent-call", body);
  a.settle("spent-call", response());
  a.close();
  assert.equal(f.latest().head.revision, 4);
  fs.copyFileSync(snapshot, f.descriptor.filename);
  sql(f.registryDescriptor.filename, (db) =>
    db
      .prepare("UPDATE lineage SET state_digest=?,revision=?")
      .run(old.head.state_digest, old.head.revision),
  );
  assert.deepEqual(await child(f), {
    ok: false,
    code: "CC_BUDGET_LINEAGE_HOST_STALE",
  });
  assert.equal(f.latest().head.revision, 4);
});
test("real process death after durable checkpoint but before authority commit stays closed on restart", async (t) => {
  const f = fixture(t);
  assert.deepEqual(
    await child(f, { pause: "after-head" }, "crash-call", true),
    { stage: "after-head" },
  );
  assert.equal(f.latest().head.revision, 2);
  assert.deepEqual(await child(f, {}, "after-crash"), {
    ok: false,
    code: "CC_BUDGET_LINEAGE_STATE",
  });
});

test("registration publication failure never silently initializes another authority", (t) => {
  const f = fixture(t);
  const cfg = config();
  cfg.plan.lineageId = "second-fixture-lineage";
  cfg.history.lineageId = cfg.plan.lineageId;
  attest(cfg);
  const initialize = () =>
    FormalBudgetAuthority.initialize({
      filename: path.join(f.root, "second-authority.sqlite"),
      config: cfg,
      verifyEvidence: verifyFixtureEvidence,
      now: () => NOW,
      lineageRegistry: f.registry,
    });
  f.hooks.publish = () => {
    throw new Error("offline registration publication failed");
  };
  assert.throws(initialize, { code: "CC_BUDGET_LINEAGE_HOST_UNAVAILABLE" });
  assert.ok(fs.existsSync(path.join(f.root, "second-authority.sqlite")));
  delete f.hooks.publish;
  assert.throws(initialize, { code: "CC_BUDGET_LINEAGE_HOST_STALE" });
});

test("existing legacy registries cannot acquire a host policy merely through constructor injection", (t) => {
  const f = fixture(t);
  const descriptor = FormalBudgetLineageRegistry.initialize({
    filename: path.join(f.root, "legacy.sqlite"),
  });
  assert.throws(
    () =>
      new FormalBudgetLineageRegistry({
        ...descriptor,
        checkpointHost: f.host,
      }),
    { code: "CC_BUDGET_LINEAGE_HOST_REQUIRED" },
  );
});

test("simultaneous real processes using the host never obtain two reservations", async (t) => {
  const f = fixture(t);
  const results = await Promise.all([
    child(f, {}, "concurrent-a"),
    child(f, {}, "concurrent-b"),
  ]);
  assert.ok(results.filter((result) => result.ok).length <= 1);
  for (const result of results.filter((result) => !result.ok))
    assert.ok(
      [
        "CC_BUDGET_PENDING",
        "CC_BUDGET_LINEAGE_HOST_STALE",
        "CC_BUDGET_LINEAGE_STATE",
      ].includes(result.code),
      result.code,
    );
  const calls = sql(f.descriptor.filename, (db) =>
    db.prepare("SELECT reserved_usd FROM call").all(),
  );
  assert.ok(calls.length <= 1);
  assert.ok(calls.every((call) => call.reserved_usd === 1500));
});

test("rolling back the synthetic host together with both databases remains an explicit trust counterexample", (t) => {
  const f = fixture(t),
    old = f.latest();
  f.a.close();
  const snapshot = path.join(f.root, "all-stores-old.sqlite");
  fs.copyFileSync(f.descriptor.filename, snapshot);
  const a = f.openAuthority();
  a.reserve({ runId: "initial", callId: "spent-call", body });
  a.markDispatched("spent-call", body);
  a.settle("spent-call", response());
  assert.equal(a.status().exposureUsdMicros, 46);
  a.close();
  fs.copyFileSync(snapshot, f.descriptor.filename);
  sql(f.registryDescriptor.filename, (db) =>
    db
      .prepare("UPDATE lineage SET state_digest=?,revision=?")
      .run(old.head.state_digest, old.head.revision),
  );
  fs.writeFileSync(f.checkpointFile, JSON.stringify([old]));
  assert.equal(f.openAuthority(f.openRegistry()).status().exposureUsdMicros, 0);
});

test("latest host heads are checked again after credential await and before physical send", async (t) => {
  const f = fixture(t),
    old = f.latest();
  const { value, calls } = transport(f, {
    credentialProvider: async () => {
      calls.credentials++;
      await Promise.resolve();
      fs.writeFileSync(f.checkpointFile, JSON.stringify([old]));
      return "OFFLINE-FAKE-KEY";
    },
  });
  await assert.rejects(dispatch(value), {
    code: "CC_BUDGET_TRANSPORT_UNKNOWN",
  });
  assert.deepEqual(calls, { credentials: 1, fetches: 0 });
  assert.deepEqual(rawCall(f), {
    state: "held",
    reserved_usd: 1500,
    cost_usd: null,
  });
});

test("cancellation after a physical attempt checkpoints unknown liability without releasing it", async (t) => {
  const f = fixture(t),
    controller = new AbortController();
  const { value, calls } = transport(f, {
    fetchImpl: () => {
      calls.fetches++;
      controller.abort();
      return Response.json(response());
    },
  });
  await assert.rejects(
    value.dispatch({
      runId: "initial",
      callId: "call-1",
      body,
      signal: controller.signal,
    }),
    { code: "CC_BUDGET_TRANSPORT_UNKNOWN" },
  );
  assert.deepEqual(calls, { credentials: 1, fetches: 1 });
  assert.deepEqual(rawCall(f), {
    state: "unknown",
    reserved_usd: 1500,
    cost_usd: null,
  });
  assert.equal(f.latest().head.revision, 4);
  assert.equal(
    f.openAuthority(f.openRegistry()).status().exposureUsdMicros,
    1500,
  );
});
