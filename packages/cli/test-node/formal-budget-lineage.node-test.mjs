import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { FormalBudgetAuthority } from "../src/lib/formal-budget-authority.js";
import { FormalBudgetLineageRegistry } from "../src/lib/formal-budget-lineage-registry.js";
import { createFormalBudgetTransport } from "../src/lib/formal-budget-transport.js";
import {
  NOW,
  body,
  config,
  response,
  attest,
  verifyFixtureEvidence,
} from "./formal-budget-fixture.mjs";

const Database = createRequire(import.meta.url)("better-sqlite3");
const worker = fileURLToPath(
  new URL("./formal-budget-lineage-worker.mjs", import.meta.url),
);

function fixture(t, modify = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-budget-lineage-"));
  fs.mkdirSync(path.join(root, "host-registry"));
  fs.mkdirSync(path.join(root, "accounting"));
  const registryDescriptor = FormalBudgetLineageRegistry.initialize({
    filename: path.join(root, "host-registry/registry.sqlite"),
  });
  const registries = [],
    authorities = [];
  const openRegistry = () => {
    const value = new FormalBudgetLineageRegistry(registryDescriptor);
    registries.push(value);
    return value;
  };
  const registry = openRegistry();
  const cfg = config();
  modify(cfg);
  attest(cfg);
  const descriptor = FormalBudgetAuthority.initialize({
    filename: path.join(root, "accounting/authority.sqlite"),
    config: cfg,
    verifyEvidence: verifyFixtureEvidence,
    now: () => NOW,
    lineageRegistry: registry,
  });
  const open = (overrides = {}) => {
    const value = new FormalBudgetAuthority({
      ...descriptor,
      lineageRegistry: registry,
      verifyEvidence: verifyFixtureEvidence,
      now: () => NOW,
      ...overrides,
    });
    authorities.push(value);
    return value;
  };
  t.after(() => {
    for (const value of [...authorities, ...registries])
      try {
        value.close();
      } catch {
        /* Already closed. */
      }
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("cc-budget-lineage-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    cfg,
    registry,
    descriptor,
    registryDescriptor,
    open,
    openRegistry,
  };
}
const start = (a) =>
  a.beginRun({ taskId: "task-0", runId: "initial", phase: "initial" });
const reserve = (a, id = "call-1") =>
  a.reserve({ runId: "initial", callId: id, body });

function child(f, callId, { pause, filename } = {}) {
  const input = path.join(f.root, `${callId}.json`);
  fs.writeFileSync(
    input,
    JSON.stringify({
      registry: f.registryDescriptor,
      authority: { ...f.descriptor, ...(filename ? { filename } : {}) },
      pause,
    }),
  );
  const processChild = fork(worker, [input, callId], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });
  let diagnostic = "",
    last;
  processChild.stderr.on("data", (bytes) => {
    diagnostic += bytes;
  });
  const message = new Promise((resolve, reject) => {
    processChild.once("error", reject);
    processChild.once("message", (value) => {
      last = value;
      resolve(value);
    });
    processChild.once("exit", () => {
      if (!last)
        reject(
          new Error("Lineage worker exited without receipt: " + diagnostic),
        );
    });
  });
  const exited = new Promise((resolve) =>
    processChild.once("exit", (code) => resolve(code)),
  );
  return { processChild, message, exited };
}

test("guarded authority retains the original cap and history across independent host reopen", (t) => {
  const f = fixture(t),
    a = f.open();
  start(a);
  reserve(a);
  a.markDispatched("call-1", body);
  a.settle("call-1", response());
  const state = a.status(),
    head = f.registry.status(f.cfg.plan.lineageId);
  assert.equal(state.capUsdMicros, 99_000_000);
  assert.equal(state.exposureUsdMicros, 46);
  assert.equal(head.revision, 4);
  a.close();
  const next = f.open({ lineageRegistry: f.openRegistry() });
  assert.deepEqual(next.status(), state);
  next.settle("call-1", response());
  assert.equal(f.registry.status(f.cfg.plan.lineageId).revision, 4);
});

test("a registered lineage cannot initialize a second database or acquire new credit", (t) => {
  const f = fixture(t),
    other = path.join(f.root, "accounting/other.sqlite");
  assert.throws(
    () =>
      FormalBudgetAuthority.initialize({
        filename: other,
        config: f.cfg,
        verifyEvidence: verifyFixtureEvidence,
        now: () => NOW,
        lineageRegistry: f.registry,
      }),
    { code: "CC_BUDGET_LINEAGE_EXISTS" },
  );
  assert.equal(fs.existsSync(other), false);
});

test("guard omission, a different registry and a missing registry cannot downgrade protection", (t) => {
  const f = fixture(t);
  assert.throws(() => f.open({ lineageRegistry: undefined }), {
    code: "CC_BUDGET_LINEAGE_REQUIRED",
  });
  const otherDescriptor = FormalBudgetLineageRegistry.initialize({
    filename: path.join(f.root, "other-registry.sqlite"),
  });
  const other = new FormalBudgetLineageRegistry(otherDescriptor);
  try {
    assert.throws(() => f.open({ lineageRegistry: other }), {
      code: "CC_BUDGET_LINEAGE_IDENTITY",
    });
  } finally {
    other.close();
  }
  assert.throws(
    () =>
      new FormalBudgetLineageRegistry({
        ...f.registryDescriptor,
        filename: path.join(f.root, "missing.sqlite"),
      }),
  );
  assert.equal(fs.existsSync(path.join(f.root, "missing.sqlite")), false);
});

test("copying the current database to a new path cannot fork the same lineage", (t) => {
  const f = fixture(t),
    a = f.open();
  start(a);
  a.close();
  const clone = path.join(f.root, "accounting/clone.sqlite");
  fs.copyFileSync(f.descriptor.filename, clone);
  assert.throws(() => f.open({ filename: clone }), {
    code: "CC_BUDGET_LINEAGE_IDENTITY",
  });
  assert.equal(f.open().status().exposureUsdMicros, 0);
});

test("restoring an older authority in place cannot release settled spend or pending credit", (t) => {
  const f = fixture(t),
    a = f.open();
  start(a);
  a.close();
  const snapshot = path.join(f.root, "before.sqlite");
  fs.copyFileSync(f.descriptor.filename, snapshot);
  const active = f.open();
  reserve(active);
  active.markDispatched("call-1", body);
  active.settle("call-1", response());
  active.close();
  fs.copyFileSync(snapshot, f.descriptor.filename);
  assert.throws(() => f.open(), { code: "CC_BUDGET_LINEAGE_STATE" });
  assert.equal(f.registry.status(f.cfg.plan.lineageId).revision, 4);
});

test("same-event-count edits to accounting tables are detected on already-open handles", (t) => {
  const f = fixture(t),
    a = f.open();
  start(a);
  reserve(a);
  const db = new Database(f.descriptor.filename);
  try {
    db.prepare("UPDATE call SET reserved_usd=0 WHERE id='call-1'").run();
  } finally {
    db.close();
  }
  assert.throws(() => a.status(), { code: "CC_BUDGET_LINEAGE_STATE" });
  assert.throws(() => a.reservedContract("call-1"), {
    code: "CC_BUDGET_LINEAGE_STATE",
  });
  assert.throws(() => a.markDispatched("call-1", body), {
    code: "CC_BUDGET_LINEAGE_STATE",
  });
});

test("the production transport cannot read a credential or send after state drift", async (t) => {
  const f = fixture(t),
    a = f.open();
  start(a);
  const db = new Database(f.descriptor.filename);
  db.prepare(
    "UPDATE task SET historical_spent=0,slots=0 WHERE id='task-0'",
  ).run();
  db.close();
  let credentials = 0,
    requests = 0;
  const transport = createFormalBudgetTransport({
    authority: a,
    credentialProvider: () => {
      credentials++;
      return "FAKE-KEY";
    },
    fetchImpl: () => {
      requests++;
      throw new Error("No network");
    },
  });
  await assert.rejects(
    transport.dispatch({ runId: "initial", callId: "must-not-send", body }),
    { code: "CC_BUDGET_LINEAGE_STATE" },
  );
  assert.equal(credentials, 0);
  assert.equal(requests, 0);
});

test("separate processes sharing the registry grant exactly one reservation", async (t) => {
  const f = fixture(t),
    a = f.open();
  start(a);
  a.close();
  const children = [child(f, "process-1"), child(f, "process-2")];
  const receipts = await Promise.all(children.map((value) => value.message));
  await Promise.all(children.map((value) => value.exited));
  assert.equal(receipts.filter((row) => row.ok).length, 1);
  assert.deepEqual(
    receipts.filter((row) => !row.ok).map((row) => row.code),
    ["CC_BUDGET_PENDING"],
  );
  assert.equal(f.open().status().exposureUsdMicros, 1500);
});

for (const pause of ["before-head", "after-head"]) {
  test(`real process termination ${pause} never creates a second allowance`, async (t) => {
    const f = fixture(t),
      a = f.open();
    start(a);
    a.close();
    const value = child(f, "interrupted", { pause });
    try {
      assert.equal((await value.message).stage, pause);
    } finally {
      value.processChild.kill("SIGKILL");
      await value.exited;
    }
    if (pause === "before-head") {
      const next = f.open();
      assert.equal(next.status().exposureUsdMicros, 0);
      reserve(next, "after-clean-rollback");
      assert.equal(next.status().exposureUsdMicros, 1500);
    } else {
      assert.throws(() => f.open(), { code: "CC_BUDGET_LINEAGE_STATE" });
      assert.equal(f.registry.status(f.cfg.plan.lineageId).revision, 2);
    }
  });
}

test("a lineage mismatch does not poison another lineage using the same trusted registry", (t) => {
  const f = fixture(t),
    a = f.open();
  start(a);
  const db = new Database(f.descriptor.filename);
  db.prepare("DELETE FROM event WHERE kind='run-start'").run();
  db.close();
  assert.throws(() => a.status(), { code: "CC_BUDGET_LINEAGE_STATE" });
  const other = config();
  other.plan.lineageId = "different-lineage";
  other.history.lineageId = other.plan.lineageId;
  // Refresh only the offline fixture evidence for the intentionally separate lineage.
  attest(other);
  const descriptor = FormalBudgetAuthority.initialize({
    filename: path.join(f.root, "other-authority.sqlite"),
    config: other,
    verifyEvidence: verifyFixtureEvidence,
    now: () => NOW,
    lineageRegistry: f.registry,
  });
  const next = new FormalBudgetAuthority({
    ...descriptor,
    lineageRegistry: f.registry,
    verifyEvidence: verifyFixtureEvidence,
    now: () => NOW,
  });
  try {
    start(next);
    reserve(next);
    assert.equal(next.status().exposureUsdMicros, 1500);
  } finally {
    next.close();
  }
});

test("replacing a closed authority file with identical bytes does not replace its registered file identity", (t) => {
  const f = fixture(t),
    a = f.open();
  start(a);
  a.close();
  const old = path.join(f.root, "replaced.sqlite");
  fs.renameSync(f.descriptor.filename, old);
  fs.copyFileSync(old, f.descriptor.filename);
  assert.throws(() => f.open(), { code: "CC_BUDGET_LINEAGE_IDENTITY" });
});

test("a real registry write failure rolls back reservation before credentials or HTTP", async (t) => {
  const f = fixture(t),
    a = f.open();
  start(a);
  const db = new Database(f.registryDescriptor.filename);
  db.exec(
    "CREATE TRIGGER fail_head BEFORE UPDATE ON lineage BEGIN SELECT RAISE(ABORT,'offline-registry-write-failure'); END",
  );
  let credentials = 0,
    requests = 0;
  const transport = createFormalBudgetTransport({
    authority: a,
    credentialProvider: () => {
      credentials++;
      return "OFFLINE-FAKE-KEY";
    },
    fetchImpl: () => {
      requests++;
      throw new Error("No network expected");
    },
  });
  try {
    await assert.rejects(
      transport.dispatch({ runId: "initial", callId: "uncommitted", body }),
      { code: "CC_BUDGET_LINEAGE_STORAGE" },
    );
    assert.equal(credentials, 0);
    assert.equal(requests, 0);
  } finally {
    db.exec("DROP TRIGGER fail_head");
    db.close();
  }
  assert.equal(a.status().exposureUsdMicros, 0);
  assert.equal(f.registry.status(f.cfg.plan.lineageId).revision, 1);
});

test("a failure after the settlement head is durable retains full local liability and denies all further access", (t) => {
  const f = fixture(t),
    a = f.open();
  start(a);
  reserve(a);
  a.markDispatched("call-1", body);
  const coordinate = f.registry.coordinate.bind(f.registry);
  f.registry.coordinate = (binding, operation) =>
    coordinate(binding, (lease) => {
      const advance = lease.advance;
      lease.advance = (digest) => {
        advance(digest);
        throw new Error(
          "Offline failure after durable head, before local commit",
        );
      };
      return operation(lease);
    });
  assert.throws(() => a.settle("call-1", response()), {
    code: "CC_BUDGET_LINEAGE_STORAGE",
  });
  f.registry.coordinate = coordinate;
  const db = new Database(f.descriptor.filename);
  try {
    assert.deepEqual(
      db
        .prepare(
          "SELECT state,cost_usd,reserved_usd FROM call WHERE id='call-1'",
        )
        .get(),
      { state: "dispatched", cost_usd: null, reserved_usd: 1500 },
    );
  } finally {
    db.close();
  }
  assert.throws(() => a.status(), { code: "CC_BUDGET_LINEAGE_STATE" });
  assert.throws(() => reserve(a, "after-partial-commit"), {
    code: "CC_BUDGET_LINEAGE_STATE",
  });
  assert.equal(f.registry.status(f.cfg.plan.lineageId).revision, 4);
});

test("registered historical spend and used run slots are never a new per-run allowance", (t) => {
  const f = fixture(t, (cfg) => {
    cfg.history.tasks[0].spentUsdMicros = 1_200_000;
    cfg.history.tasks[0].runsUsed = 1;
  });
  const a = f.open();
  assert.throws(() => start(a), { code: "CC_BUDGET_RUN_LIMIT" });
  a.beginRun({ taskId: "task-0", runId: "remediation", phase: "remediation" });
  a.reserve({ runId: "remediation", callId: "remediation-call", body });
  assert.equal(a.status().exposureUsdMicros, 1_201_500);
  a.markDispatched("remediation-call", body);
  a.settle("remediation-call", response());
  a.finishRun("remediation");
  assert.equal(f.open().status().exposureUsdMicros, 1_200_046);
  assert.throws(
    () =>
      a.beginRun({
        taskId: "task-0",
        runId: "third-run",
        phase: "remediation",
      }),
    { code: "CC_BUDGET_RUN_LIMIT" },
  );
});

test("registering unresolved historical liability remains halted across registry reopen", (t) => {
  const f = fixture(t, (cfg) => {
    cfg.history.tasks[0].spentUsdMicros = 31;
    cfg.history.tasks[0].reservedUsdMicros = 1500;
    cfg.history.tasks[0].unknown = true;
  });
  const a = f.open();
  assert.equal(a.status().exposureUsdMicros, 1531);
  assert.equal(a.status().capUsdMicros, 99_000_000);
  assert.throws(() => start(a), { code: "CC_BUDGET_HALTED" });
  a.close();
  const next = f.open({ lineageRegistry: f.openRegistry() });
  assert.equal(next.status().exposureUsdMicros, 1531);
  assert.throws(() => start(next), { code: "CC_BUDGET_HALTED" });
});

test("successful production dispatch settles through the independent head with one physical attempt", async (t) => {
  const f = fixture(t),
    a = f.open();
  start(a);
  let credentials = 0,
    requests = 0;
  const transport = createFormalBudgetTransport({
    authority: a,
    credentialProvider: () => {
      credentials++;
      return "OFFLINE-FAKE-KEY";
    },
    fetchImpl: async () => {
      requests++;
      assert.equal(a.status().pending[0].state, "dispatched");
      return Response.json(response());
    },
  });
  const result = await transport.dispatch({
    runId: "initial",
    callId: "successful-dispatch",
    body,
  });
  assert.equal(result.cost.costUsdMicros, 46);
  assert.equal(credentials, 1);
  assert.equal(requests, 1);
  assert.equal(a.status().exposureUsdMicros, 46);
  assert.equal(f.open().status().pending.length, 0);
});
