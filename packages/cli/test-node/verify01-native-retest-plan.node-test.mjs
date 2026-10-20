import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_NATIVE_PACKAGE_SET,
  NATIVE_EVIDENCE_ROOT,
  assertUnfinishedNativeSamples,
  createNativeRetestPlan,
  loadVerifiedNativeAcceptedSamples,
  nativeExecutionShards,
  unfinishedNativeGroups,
  validateNativePackageSetFile,
  validateNextNativePackageSet,
  readNativeRetestChain,
  assertCurrentNativeRetestChain,
} from "../scripts/verify01-native-retest-plan.mjs";

test("explicit chain rejects duplicates, traversal and omitted current rounds", () => {
  const reference = {
    planPath: `${NATIVE_EVIDENCE_ROOT}/next-package-105-plan.json`,
    ledgerPath: `${NATIVE_EVIDENCE_ROOT}/next-package-105.json`,
    planDigest: "sha256:" + "a".repeat(64),
    ledgerDigest: "sha256:" + "b".repeat(64),
  };
  const read = () => Buffer.from(JSON.stringify([reference]));
  assert.deepEqual(readNativeRetestChain(read), [reference]);
  assert.doesNotThrow(() => assertCurrentNativeRetestChain([reference], read));
  assert.throws(() => assertCurrentNativeRetestChain([], read), /omitted/);
  assert.throws(
    () => assertUnfinishedNativeSamples(["verify-12"], { priorRounds: [] }),
    /current complete round chain/,
  );
  for (const rows of [
    [reference, reference],
    [{ ...reference, planPath: "../escape" }],
    [{ ...reference, ledgerDigest: "forged" }],
  ]) {
    assert.throws(() =>
      readNativeRetestChain(() => Buffer.from(JSON.stringify(rows))),
    );
  }
  assert.deepEqual(
    readNativeRetestChain(() => {
      throw Object.assign(new Error(), { code: "ENOENT" });
    }),
    [],
  );
});

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const packageRelative =
  "docs/research/cli/verify01-package-sets/new-release.json";
const pinned = JSON.parse(
  fs.readFileSync(path.join(repository, DEFAULT_NATIVE_PACKAGE_SET)),
);
const plan = JSON.parse(
  fs.readFileSync(
    path.join(
      repository,
      "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
    ),
  ),
);

function temporaryRepository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-retest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("paid retests reject the original release even if its manifest bytes change", () => {
  const previous = validateNativePackageSetFile();
  assert.throws(
    () => validateNextNativePackageSet(previous, previous),
    /new package set/,
  );
  const changedBytes = {
    ...previous,
    packageSetDigest: "sha256:" + "a".repeat(64),
  };
  assert.throws(
    () => validateNextNativePackageSet(changedBytes, previous),
    /newer published CLI/,
  );
  const next = {
    ...changedBytes,
    versions: { ...previous.versions, cli: "0.166.105" },
  };
  assert.doesNotThrow(() => validateNextNativePackageSet(next, previous));
  assert.throws(
    () =>
      validateNextNativePackageSet(
        { ...next, versions: { ...next.versions, jetbrains: "0.4.1" } },
        previous,
      ),
    /must not regress/,
  );
});

test("a separate pinned manifest selects new versions without changing the original", (t) => {
  const root = temporaryRepository(t);
  const target = path.join(root, packageRelative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const updated = {
    ...pinned,
    versions: { ...pinned.versions, cli: "0.166.105" },
  };
  fs.writeFileSync(target, JSON.stringify(updated));
  const result = validateNativePackageSetFile(packageRelative, root);
  assert.equal(result.versions.cli, "0.166.105");
  assert.match(result.packageSetDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    validateNativePackageSetFile().versions.cli,
    pinned.versions.cli,
  );
  assert.throws(() =>
    validateNativePackageSetFile(
      packageRelative.replace("new-release", "missing"),
      root,
    ),
  );
  fs.writeFileSync(
    target,
    JSON.stringify({
      ...updated,
      versions: { ...updated.versions, cli: "latest" },
    }),
  );
  assert.throws(
    () => validateNativePackageSetFile(packageRelative, root),
    /exact cli/,
  );
});

test("manifest selection rejects arbitrary paths, traversal, and linked directories", (t) => {
  for (const invalid of [
    "../../secrets.json",
    "C:/secrets.json",
    "/secrets.json",
    "docs/research/cli/verify01-package-sets/../other.json",
    "docs/research/cli/verify01-package-sets/subdir/new.json",
    "docs/research/cli/verify01-package-sets/a.json\n",
    "docs/research/cli/verify01-package-sets/a.json;echo bad",
  ])
    assert.throws(() => validateNativePackageSetFile(invalid));
  const root = temporaryRepository(t);
  const parent = path.join(root, "docs/research/cli");
  fs.mkdirSync(parent, { recursive: true });
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(
    path.join(outside, "new-release.json"),
    JSON.stringify(pinned),
  );
  fs.symlinkSync(
    outside,
    path.join(parent, "verify01-package-sets"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => validateNativePackageSetFile(packageRelative, root),
    /links/,
  );
});

test("strict existing validators bind accepted files before selecting unfinished groups", () => {
  // Partial original collection is inspected offline here; paid dispatch and
  // new round preparation require complete=true and cannot use this allowance.
  const state = loadVerifiedNativeAcceptedSamples({ requireComplete: false });
  assert.ok(
    state.acceptedIds.has("verify-33"),
    "candidate acceptance survives an independent native UI failure",
  );
  assert.ok(state.acceptedIds.has("first-run-win32-vscode"));
  const groups = unfinishedNativeGroups(plan, state.acceptedIds);
  const ids = groups.flatMap((group) => group.sampleIds);
  assert.equal(ids.length + state.acceptedIds.size, 45);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of state.acceptedIds) assert.ok(!ids.includes(id));
  assert.equal(
    state.baselineEvidence.length,
    3 + state.priorRounds.length * 2,
  );
  for (const row of state.baselineEvidence)
    assert.match(row.digest, /^sha256:[a-f0-9]{64}$/u);
  assert.throws(
    () => unfinishedNativeGroups(plan, new Set(["not-planned"])),
    /outside frozen plan/,
  );
});

test("JetBrains execution shards isolate each unfinished sample without losing other groups", () => {
  const accepted = new Set([
    "verify-33",
    "verify-03",
    "first-run-win32-vscode",
  ]);
  const groups = unfinishedNativeGroups(plan, accepted);
  const before = JSON.stringify(groups);
  const shards = nativeExecutionShards(groups);
  assert.equal(JSON.stringify(groups), before);
  assert.equal(
    new Set(shards.map((shard) => shard.shardId)).size,
    shards.length,
  );
  assert.deepEqual(
    shards.flatMap((shard) => shard.sampleIds).sort(),
    groups.flatMap((group) => group.sampleIds).sort(),
  );
  for (const shard of shards) {
    assert.ok(shard.sampleIds.every((id) => !accepted.has(id)));
    if (shard.group.endsWith("-jetbrains")) {
      assert.equal(shard.sampleIds.length, 1);
      assert.equal(shard.shardId, `${shard.group}--${shard.sampleIds[0]}`);
    } else {
      assert.equal(shard.shardId, shard.group);
      assert.deepEqual(
        shard.sampleIds,
        groups.find((group) => group.group === shard.group).sampleIds,
      );
    }
  }
});

test("an acceptance boolean without its bound checker evidence cannot suppress a task", (t) => {
  const ledgerPath = path.join(
    repository,
    NATIVE_EVIDENCE_ROOT,
    "latest-package-round.json",
  );
  const ledger = JSON.parse(fs.readFileSync(ledgerPath));
  const failed = ledger.samples.find(
    (sample) => sample.candidateAcceptancePassed === false,
  );
  assert.ok(failed);
  failed.candidateAcceptancePassed = true;
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...args) =>
    path.resolve(String(file)) === ledgerPath
      ? Buffer.from(JSON.stringify(ledger))
      : read(file, ...args),
  );
  assert.throws(() =>
    loadVerifiedNativeAcceptedSamples({ requireComplete: false }),
  );
});

test("changed historical source binding cannot be reused as an accepted delivery", (t) => {
  const ledgerPath = path.join(
    repository,
    NATIVE_EVIDENCE_ROOT,
    "native-verified-deliveries.json",
  );
  const deliveries = JSON.parse(fs.readFileSync(ledgerPath));
  const accepted = deliveries.find(
    (row) => row.candidateAcceptancePassed === true,
  );
  assert.ok(accepted);
  accepted.sourceSummaryDigest = "sha256:" + "0".repeat(64);
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...args) =>
    path.resolve(String(file)) === ledgerPath
      ? Buffer.from(JSON.stringify(deliveries))
      : read(file, ...args),
  );
  assert.throws(() =>
    loadVerifiedNativeAcceptedSamples({ requireComplete: false }),
  );
});

test("generation rejects omitted IDs and every previously accepted candidate", () => {
  assert.throws(
    () => assertUnfinishedNativeSamples(undefined),
    /explicit unfinished/,
  );
  assert.throws(() => assertUnfinishedNativeSamples([]), /explicit unfinished/);
  assert.throws(
    () =>
      assertUnfinishedNativeSamples(["verify-33"], { requireComplete: false }),
    /Reuse already accepted deliverables/,
  );
});

test("next-round preparation cannot overwrite an old round name or reuse the original packages", () => {
  for (const roundName of [
    "latest-package-round",
    "../latest-package-round",
    "next-package-../old",
  ]) {
    assert.throws(() =>
      createNativeRetestPlan({
        versionsFile: DEFAULT_NATIVE_PACKAGE_SET,
        roundName,
      }),
    );
  }
  assert.throws(
    () =>
      createNativeRetestPlan({
        versionsFile: DEFAULT_NATIVE_PACKAGE_SET,
        roundName: "next-package-retest",
      }),
    /latest package round incomplete|require a new package set|newer published CLI version/,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        repository,
        NATIVE_EVIDENCE_ROOT,
        "next-package-retest-plan.json",
      ),
    ),
    false,
  );
});
