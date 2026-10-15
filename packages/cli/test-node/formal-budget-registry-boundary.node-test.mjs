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
import {
  NOW,
  body,
  config,
  response,
  verifyFixtureEvidence,
} from "./formal-budget-fixture.mjs";

const Database = createRequire(import.meta.url)("better-sqlite3");
const worker = fileURLToPath(
  new URL("./formal-budget-lineage-worker.mjs", import.meta.url),
);
const fileIdentity = (filename) => {
  const stat = fs.statSync(filename, { bigint: true });
  return `${stat.dev}:${stat.ino}`;
};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-registry-boundary-"));
  const registryDescriptor = FormalBudgetLineageRegistry.initialize({
    filename: path.join(root, "registry.sqlite"),
  });
  const registries = [],
    authorities = [];
  const openRegistry = (options = {}) => {
    const value = new FormalBudgetLineageRegistry({
      ...registryDescriptor,
      ...options,
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
  const open = (selected = registry, overrides = {}) => {
    const value = new FormalBudgetAuthority({
      ...descriptor,
      lineageRegistry: selected,
      verifyEvidence: verifyFixtureEvidence,
      now: () => NOW,
      ...overrides,
    });
    authorities.push(value);
    return value;
  };
  const a = open();
  a.beginRun({ taskId: "task-0", runId: "initial", phase: "initial" });
  t.after(() => {
    for (const value of [...authorities, ...registries])
      try {
        value.close();
      } catch {
        /* Already closed. */
      }
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("cc-registry-boundary-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    cfg,
    registryDescriptor,
    descriptor,
    registry,
    openRegistry,
    open,
    a,
  };
}
function binding(f) {
  const row = f.registry.status(f.cfg.plan.lineageId);
  return { ...f.descriptor, bindingId: row.binding_id };
}
function snapshot(f) {
  f.a.close();
  const filename = path.join(f.root, "old-authority.sqlite");
  fs.copyFileSync(f.descriptor.filename, filename);
  const head = f.registry.status(f.cfg.plan.lineageId);
  f.a = f.open();
  return { filename, head };
}
function spend(f) {
  f.a.reserve({ runId: "initial", callId: "call-1", body });
  f.a.markDispatched("call-1", body);
  f.a.settle("call-1", response());
  assert.equal(f.a.status().exposureUsdMicros, 46);
}
function mutateRegistry(f, action) {
  const db = new Database(f.registryDescriptor.filename);
  try {
    action(db);
  } finally {
    db.close();
  }
}
function restore(f, saved) {
  f.a.close();
  fs.copyFileSync(saved.filename, f.descriptor.filename);
  mutateRegistry(f, (db) =>
    db
      .prepare(
        "UPDATE lineage SET state_digest=?,revision=? WHERE lineage_id=?",
      )
      .run(saved.head.state_digest, saved.head.revision, saved.head.lineage_id),
  );
}

test("registry descriptors require a pinned physical identity", (t) => {
  const f = fixture(t);
  for (const registryFileIdentity of [undefined, "0:0", "not-an-identity"])
    assert.throws(() => f.openRegistry({ registryFileIdentity }), {
      code: "CC_BUDGET_LINEAGE_IDENTITY",
    });
});

test("a copied registry UUID and a retargeted descriptor cannot substitute another physical registry", (t) => {
  const f = fixture(t);
  f.a.close();
  f.registry.close();
  const filename = path.join(f.root, "copied-registry.sqlite");
  fs.copyFileSync(f.registryDescriptor.filename, filename);
  assert.throws(() => f.openRegistry({ filename }), {
    code: "CC_BUDGET_LINEAGE_IDENTITY",
  });
  const copy = f.openRegistry({
    filename,
    registryFileIdentity: fileIdentity(filename),
  });
  assert.equal(copy.registryId, f.registryDescriptor.registryId);
  assert.throws(() => f.open(copy), { code: "CC_BUDGET_LINEAGE_IDENTITY" });
  assert.throws(
    () =>
      f.open(copy, {
        lineageRegistryFilename: copy.bindingIdentity.filename,
        lineageRegistryFileIdentity: copy.bindingIdentity.fileIdentity,
      }),
    { code: "CC_BUDGET_LINEAGE_IDENTITY" },
  );
});

test("replacement of a closed registry with identical bytes fails its pinned authority binding", (t) => {
  const f = fixture(t);
  f.a.close();
  f.registry.close();
  const old = path.join(f.root, "replaced-registry.sqlite");
  fs.renameSync(f.registryDescriptor.filename, old);
  fs.copyFileSync(old, f.registryDescriptor.filename);
  assert.throws(() => f.openRegistry(), { code: "CC_BUDGET_LINEAGE_IDENTITY" });
  const replacement = f.openRegistry({
    registryFileIdentity: fileIdentity(f.registryDescriptor.filename),
  });
  assert.throws(() => f.open(replacement), {
    code: "CC_BUDGET_LINEAGE_IDENTITY",
  });
});

test("a live registry rejects in-place restoration of both matching old databases", (t) => {
  const f = fixture(t),
    saved = snapshot(f);
  spend(f);
  restore(f, saved);
  assert.throws(() => f.registry.status(f.cfg.plan.lineageId), {
    code: "CC_BUDGET_LINEAGE_ROLLBACK",
  });
  assert.throws(() => f.open(), { code: "CC_BUDGET_LINEAGE_ROLLBACK" });
});

test("a same-revision head rewrite cannot replace an observed state digest", (t) => {
  const f = fixture(t);
  spend(f);
  mutateRegistry(f, (db) =>
    db
      .prepare("UPDATE lineage SET state_digest=? WHERE lineage_id=?")
      .run("b".repeat(64), f.cfg.plan.lineageId),
  );
  assert.throws(() => f.registry.status(f.cfg.plan.lineageId), {
    code: "CC_BUDGET_LINEAGE_ROLLBACK",
  });
});

test("a live handle cannot ignore changes to the pinned registry UUID", (t) => {
  const f = fixture(t);
  mutateRegistry(f, (db) =>
    db
      .prepare(
        "UPDATE registry_meta SET registry_id='another-registry' WHERE id=1",
      )
      .run(),
  );
  assert.throws(() => f.registry.status(f.cfg.plan.lineageId), {
    code: "CC_BUDGET_LINEAGE_IDENTITY",
  });
});

test("removing an observed registration cannot create a new allowance in the live service", (t) => {
  const f = fixture(t);
  mutateRegistry(f, (db) =>
    db
      .prepare("DELETE FROM lineage WHERE lineage_id=?")
      .run(f.cfg.plan.lineageId),
  );
  let initialized = 0;
  assert.throws(
    () =>
      f.registry.register(
        {
          ...f.descriptor,
          filename: path.join(f.root, "new-authority.sqlite"),
        },
        () => {
          initialized++;
          return "c".repeat(64);
        },
      ),
    { code: "CC_BUDGET_LINEAGE_ROLLBACK" },
  );
  assert.equal(initialized, 0);
  assert.equal(fs.existsSync(path.join(f.root, "new-authority.sqlite")), false);
});

test("a higher revision cannot change immutable lineage metadata", (t) => {
  const f = fixture(t);
  mutateRegistry(f, (db) =>
    db
      .prepare(
        "UPDATE lineage SET binding_id='replacement-binding',revision=revision+1 WHERE lineage_id=?",
      )
      .run(f.cfg.plan.lineageId),
  );
  assert.throws(() => f.registry.status(f.cfg.plan.lineageId), {
    code: "CC_BUDGET_LINEAGE_ROLLBACK",
  });
});

test("serializable trusted checkpoints allow legitimate later heads and cannot be mutated through returned objects", (t) => {
  const f = fixture(t),
    checkpoint = f.registry.checkpoint(f.cfg.plan.lineageId);
  assert.ok(
    Object.isFrozen(checkpoint) &&
      Object.isFrozen(checkpoint.registry) &&
      Object.isFrozen(checkpoint.head),
  );
  const serialized = JSON.parse(JSON.stringify(checkpoint));
  spend(f);
  const next = f.openRegistry({ trustedCheckpoints: [serialized] });
  assert.equal(f.open(next).status().exposureUsdMicros, 46);
  assert.equal(next.checkpoint(f.cfg.plan.lineageId).head.revision, 4);
});

test("restart with a separately pinned checkpoint rejects old matching stores; omission remains an explicit boundary", (t) => {
  const f = fixture(t),
    saved = snapshot(f);
  spend(f);
  const checkpoint = JSON.parse(
    JSON.stringify(f.registry.checkpoint(f.cfg.plan.lineageId)),
  );
  f.registry.close();
  restore(f, saved);
  assert.throws(() => f.openRegistry({ trustedCheckpoints: [checkpoint] }), {
    code: "CC_BUDGET_LINEAGE_ROLLBACK",
  });
  // This counterexample must stay visible: matching restored databases cannot
  // prove their own freshness when the host omits every external checkpoint.
  const withoutCheckpoint = f.openRegistry();
  assert.equal(f.open(withoutCheckpoint).status().exposureUsdMicros, 0);
});

test("a fresh process enforces a trusted checkpoint before opening the restored authority", async (t) => {
  const f = fixture(t),
    saved = snapshot(f);
  spend(f);
  const checkpoint = f.registry.checkpoint(f.cfg.plan.lineageId);
  f.registry.close();
  restore(f, saved);
  const input = path.join(f.root, "restart-input.json");
  fs.writeFileSync(
    input,
    JSON.stringify({
      registry: { ...f.registryDescriptor, trustedCheckpoints: [checkpoint] },
      authority: f.descriptor,
    }),
  );
  const child = fork(worker, [input, "must-not-reserve"], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const receipt = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Checkpoint worker timeout"));
    }, 30000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("message", (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Checkpoint worker exited before receipt"));
    });
  });
  await exited;
  assert.deepEqual(receipt, { ok: false, code: "CC_BUDGET_LINEAGE_ROLLBACK" });
});

test("malformed, duplicated or foreign checkpoints cannot silently become current state", (t) => {
  const f = fixture(t),
    original = f.registry.checkpoint(f.cfg.plan.lineageId);
  for (const mutate of [
    (c) => {
      c.schema = "untrusted-shape";
    },
    (c) => {
      c.registry.registryId = "another-registry";
    },
    (c) => {
      c.registry.fileIdentity = "0:0";
    },
    (c) => {
      c.head.state_digest = "not-a-digest";
    },
    (c) => {
      c.head.revision = -1;
    },
    (c) => {
      c.head.filename = "relative.sqlite";
    },
  ]) {
    const checkpoint = JSON.parse(JSON.stringify(original));
    mutate(checkpoint);
    assert.throws(() => f.openRegistry({ trustedCheckpoints: [checkpoint] }));
  }
  assert.throws(
    () => f.openRegistry({ trustedCheckpoints: [original, original] }),
    { code: "CC_BUDGET_LINEAGE_CHECKPOINT" },
  );
});

test("an old guard without registry physical binding is rejected without automatic schema migration", (t) => {
  const f = fixture(t);
  f.a.close();
  const db = new Database(f.descriptor.filename);
  try {
    const guard = db.prepare("SELECT * FROM lineage_guard WHERE id=1").get();
    db.exec(
      "DROP TABLE lineage_guard; CREATE TABLE lineage_guard(id INTEGER PRIMARY KEY,registry_id TEXT NOT NULL,binding_id TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO lineage_guard VALUES (1,?,?)").run(
      guard.registry_id,
      guard.binding_id,
    );
    assert.throws(() => f.open(), { code: "CC_BUDGET_LINEAGE_IDENTITY" });
    assert.equal(
      db.prepare("PRAGMA table_info(lineage_guard)").all().length,
      3,
    );
  } finally {
    db.close();
  }
});

test("a lease captured by a failed transaction cannot assert or publish after rollback", (t) => {
  const f = fixture(t),
    selected = binding(f),
    head = f.registry.status(f.cfg.plan.lineageId);
  let captured;
  assert.throws(
    () =>
      f.registry.coordinate(selected, (lease) => {
        captured = lease;
        lease.assertState(head.state_digest);
        throw new Error("Offline callback failure");
      }),
    { code: "CC_BUDGET_LINEAGE_STORAGE" },
  );
  assert.throws(() => captured.assertState(head.state_digest), {
    code: "CC_BUDGET_LINEAGE_LEASE_EXPIRED",
  });
  assert.throws(() => captured.advance("d".repeat(64)), {
    code: "CC_BUDGET_LINEAGE_LEASE_EXPIRED",
  });
  assert.equal(
    f.registry.status(f.cfg.plan.lineageId).state_digest,
    head.state_digest,
  );
});

test("an old lease stays expired even while another valid transaction is active", (t) => {
  const f = fixture(t),
    selected = binding(f),
    head = f.registry.status(f.cfg.plan.lineageId);
  let captured;
  f.registry.coordinate(selected, (lease) => {
    captured = lease;
    lease.assertState(head.state_digest);
    lease.advance(head.state_digest);
  });
  f.registry.coordinate(selected, (lease) => {
    assert.throws(() => captured.advance("d".repeat(64)), {
      code: "CC_BUDGET_LINEAGE_LEASE_EXPIRED",
    });
    lease.assertState(head.state_digest);
    lease.advance(head.state_digest);
  });
  assert.equal(f.registry.status(f.cfg.plan.lineageId).revision, head.revision);
});

test("async and generator callbacks are rejected before invocation or initializer side effects", (t) => {
  const f = fixture(t),
    selected = binding(f);
  let invoked = 0;
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
  ]) {
    assert.throws(() => f.registry.coordinate(selected, operation), {
      code: "CC_BUDGET_LINEAGE_ASYNC",
    });
    assert.throws(
      () =>
        f.registry.register(
          { ...selected, lineageId: "new-lineage" },
          operation,
        ),
      { code: "CC_BUDGET_LINEAGE_ASYNC" },
    );
  }
  assert.equal(invoked, 0);
});

test("a promise returned by an ordinary callback expires its captured lease before deferred use", (t) => {
  const f = fixture(t),
    selected = binding(f);
  let captured;
  assert.throws(
    () =>
      f.registry.coordinate(selected, (lease) => {
        captured = lease;
        return Promise.resolve();
      }),
    { code: "CC_BUDGET_LINEAGE_ASYNC" },
  );
  assert.throws(() => captured.advance("e".repeat(64)), {
    code: "CC_BUDGET_LINEAGE_LEASE_EXPIRED",
  });
});
