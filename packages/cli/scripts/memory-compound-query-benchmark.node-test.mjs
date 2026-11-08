import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createCompoundFixture,
  compoundScenarios,
  oracleMatches,
  oraclePage,
} from "./memory-compound-query-fixture.mjs";
import {
  atomicCheckpoint,
  assertGitIdentity,
  runMemoryCompoundBenchmark,
} from "./memory-compound-query-benchmark.mjs";

const { state, metadata } = createCompoundFixture(1000);
const records = Object.values(state.records);
const record = (index) =>
  state.records["compound-memory-" + String(index).padStart(6, "0")];
const rootFor = (t) => {
  const parent = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "cc-compound-checks-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith("cc-compound-checks-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
};

test("independent oracle rejects each high-ranked decoy and preserves tied pages", () => {
  const scenarios = compoundScenarios();
  for (const scenario of scenarios) {
    const expected = oraclePage(records, scenario.query, scenario.offset);
    const start = scenario.name === "tag-narrow" ? 64 : scenario.offset;
    assert.deepEqual(
      expected.entries.map((entry) => entry.id),
      Array.from({ length: 20 }, (_, i) => record(start + i).memoryId),
    );
    const rejected =
      metadata.rejected[scenario.offset ? "category-narrow" : scenario.name];
    for (const id of rejected)
      assert.equal(oracleMatches(state.records[id], scenario.query), false);
    assert.equal(expected.hasNext, true);
  }
  assert.deepEqual(oraclePage(records, scenarios[0].query).entries[1], {
    id: record(1).memoryId,
    content: record(1).content,
    category: "rare",
    importance: 3,
    source: "compound-query-fixture",
    created_at: "2026-11-08T00:00:00.000Z",
    updated_at: "2026-11-08T00:00:00.000Z",
    scope: "user",
    scope_id: "shared",
    state: "reinforced",
    revision: 2,
    digest: record(1).digest,
  });
});

test("oracle uses tag OR, exact scopes, wildcard sink, and distinct empty-array rules", () => {
  assert.equal(oracleMatches(record(64), { tags: ["rare-a"] }), false);
  assert.equal(oracleMatches(record(65), { tags: ["rare-a"] }), true);
  assert.equal(oracleMatches(record(66), { tags: ["rare-a", "rare-b"] }), true);
  assert.equal(
    oracleMatches(record(1), {
      scopeAdmissions: [{ scope: "project", scopeId: "shared" }],
    }),
    false,
  );
  assert.equal(
    oracleMatches(record(2), {
      scopeAdmissions: [{ scope: "global", scopeId: null }],
    }),
    true,
  );
  assert.equal(oracleMatches(record(1), { sink: "provider.unknown" }), true);
  assert.equal(oracleMatches(record(0), { sink: "provider.unknown" }), false);
  assert.equal(oracleMatches(record(0), { scopeAdmissions: [] }), false);
  assert.equal(oracleMatches(record(0), { states: [] }), false);
  assert.equal(oracleMatches(record(0), { tags: [] }), true);
});

test("fixture lifecycle uses real reducer tombstones and full audit events", () => {
  assert.equal(metadata.storeRevision, state.events.length);
  assert.equal(record(138).state, "deleted");
  assert.equal(record(138).revision, 2);
  assert.equal(record(139).state, "purged");
  assert.equal(record(139).revision, 3);
  for (const row of [record(138), record(139)]) {
    assert.equal(row.content, "");
    assert.equal(row.category, "deleted");
    assert.deepEqual(row.tags, []);
    assert.deepEqual(row.allowedSinks, ["kernel.tombstone"]);
    assert.equal(oracleMatches(row, { states: [row.state] }), false);
    assert.equal(
      oracleMatches(row, {
        category: "deleted",
        sink: "kernel.tombstone",
        tags: [],
        states: ["deleted", "purged"],
        includeTombstones: true,
      }),
      true,
    );
    assert.equal(
      state.events.filter((event) => event.memoryId === row.memoryId).length,
      row.revision,
    );
  }
  for (const index of [140, 141, 142, 143])
    assert.equal(oracleMatches(record(index)), true);
});

test("atomic checkpoint replaces a report without leaving a partial temporary file", (t) => {
  const root = rootFor(t),
    output = path.join(root, "report.json");
  fs.writeFileSync(output, '{"complete":false}');
  atomicCheckpoint(output, { complete: false, samples: [1] });
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), {
    complete: false,
    samples: [1],
  });
  assert.deepEqual(fs.readdirSync(root), ["report.json"]);
});

test("atomic checkpoint preserves primary rename and unlink failures together", (t) => {
  const root = rootFor(t),
    output = path.join(root, "report.json");
  fs.writeFileSync(output, '{"complete":false,"samples":[1]}');
  const primary = new Error("injected rename failure");
  const cleanup = new Error("injected temporary cleanup failure");
  const renameMock = t.mock.method(fs, "renameSync", () => {
    throw primary;
  });
  const unlinkMock = t.mock.method(fs, "unlinkSync", () => {
    throw cleanup;
  });
  try {
    assert.throws(
      () => atomicCheckpoint(output, { complete: true }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [primary, cleanup]);
        return true;
      },
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), {
      complete: false,
      samples: [1],
    });
  } finally {
    renameMock.mock.restore();
    unlinkMock.mock.restore();
  }
});

test("an initial source failure leaves a durable failed, incomplete report", async (t) => {
  const root = rootFor(t),
    output = path.join(root, "report.json");
  const originalRead = fs.readFileSync;
  const primary = Object.assign(new Error("injected source read failure"), {
    code: "SOURCE_READ_FAILED",
  });
  const readMock = t.mock.method(fs, "readFileSync", function (file, ...args) {
    if (
      typeof file === "string" &&
      /memory-compound-query-fixture\.mjs$/u.test(file)
    )
      throw primary;
    return originalRead.call(this, file, ...args);
  });
  try {
    await assert.rejects(
      runMemoryCompoundBenchmark({
        counts: [1000],
        samples: 1,
        output,
        loadContext: "parallel-preflight",
      }),
      (error) => error === primary,
    );
  } finally {
    readMock.mock.restore();
  }
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(report.complete, false);
  assert.equal(report.stage, "failed");
  assert.equal(report.failure.code, "SOURCE_READ_FAILED");
  assert.equal(report.cleanupComplete, true);
  assert.equal(report.performanceAccepted, false);
  assert.deepEqual(report.tiers, []);
});

test("checkpoint plus scratch cleanup failure keeps both errors and cannot complete", async (t) => {
  const root = rootFor(t),
    output = path.join(root, "report.json");
  const originalRename = fs.renameSync,
    originalRemove = fs.rmSync;
  const primary = new Error("injected first checkpoint failure");
  const cleanup = new Error("injected scratch cleanup failure");
  const cleanupTargets = [];
  let renames = 0;
  const renameMock = t.mock.method(fs, "renameSync", function (...args) {
    if (++renames === 1) throw primary;
    return originalRename.apply(this, args);
  });
  const removeMock = t.mock.method(fs, "rmSync", function (target, ...args) {
    if (path.basename(target).startsWith("cc-memory-compound-")) {
      cleanupTargets.push(target);
      throw cleanup;
    }
    return originalRemove.call(this, target, ...args);
  });
  try {
    await assert.rejects(
      runMemoryCompoundBenchmark({
        counts: [1000],
        samples: 1,
        output,
        loadContext: "parallel-preflight",
      }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [primary, cleanup]);
        return true;
      },
    );
  } finally {
    renameMock.mock.restore();
    removeMock.mock.restore();
    for (const target of cleanupTargets) {
      assert.equal(
        path.dirname(path.resolve(target)),
        fs.realpathSync.native(os.tmpdir()),
      );
      assert.ok(path.basename(target).startsWith("cc-memory-compound-"));
      assert.equal(fs.realpathSync.native(target), path.resolve(target));
      originalRemove(target, { recursive: true, force: true });
    }
  }
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(report.complete, false);
  assert.equal(report.cleanupComplete, false);
  assert.equal(report.failure.message, primary.message);
  assert.equal(report.cleanupFailure.message, cleanup.message);
  assert.deepEqual(report.tiers, []);
});

test("invalid options and reused evidence paths never replace prior evidence", async (t) => {
  const root = rootFor(t),
    output = path.join(root, "report.json");
  const original = '{"complete":false,"failure":"preserved"}';
  fs.writeFileSync(output, original);
  await assert.rejects(
    runMemoryCompoundBenchmark({
      counts: [1000],
      samples: 0,
      output,
    }),
  );
  await assert.rejects(
    runMemoryCompoundBenchmark({
      counts: [1000],
      samples: 1,
      output,
    }),
    { code: "EEXIST" },
  );
  assert.equal(fs.readFileSync(output, "utf8"), original);
});

test("Git identity accepts an unchanged dirty preflight and rejects HEAD, branch or status drift", () => {
  const original = {
    sourceHead: "commit-a",
    sourceBranch: "feature/compound",
    workingTree: "includes-uncommitted-files",
    workingTreeStatusSha256: "sha256:status-a",
  };
  assert.doesNotThrow(() => assertGitIdentity(original, { ...original }));
  for (const changed of [
    { sourceHead: "commit-b" },
    { sourceBranch: "main" },
    { workingTreeStatusSha256: "sha256:status-b" },
  ])
    assert.throws(() =>
      assertGitIdentity(original, { ...original, ...changed }),
    );
  const clean = {
    ...original,
    workingTree: "clean",
    workingTreeStatusSha256: "sha256:empty",
  };
  assert.throws(() => assertGitIdentity(clean, original));
});
