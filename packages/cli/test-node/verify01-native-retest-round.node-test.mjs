import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import {
  readNativeRetestArchive,
  retestHash,
  validateNativeRetestRun,
  validateRetestPlanBinding,
  nativeRetestExecutionShards,
  validateNativeRetestRunBindings,
} from "../scripts/verify01-native-retest-round.mjs";
import {
  NATIVE_EVIDENCE_ROOT,
  unfinishedNativeGroups,
  extendNativeRetestBaseline,
  assertCurrentNativeRetestChain,
  validateNextNativePackageSet,
} from "../scripts/verify01-native-retest-plan.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const json = (name) => JSON.parse(fs.readFileSync(path.join(repository, name)));
const original = json(`${NATIVE_EVIDENCE_ROOT}/latest-package-round.json`);
const frozenPlan = json(
  "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
);
const catalog = json(
  "docs/research/cli/verify01-plan-2026-10-13-volcengine/tasks.json",
);
const frozenPlanDigest = fs
  .readFileSync(
    path.join(
      repository,
      "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.sha256",
    ),
    "utf8",
  )
  .trim();

// Existing independently archived receipts are only read. Synthetic remote
// metadata supplies the new envelope; tests never launch candidates/providers.
function fixture(group = "linux-jetbrains") {
  const run = structuredClone(
    original.runs.find((item) => item.group === group),
  );
  assert.ok(run.generation && run.acceptance);
  const stem = "latest-package-round";
  const blobs = new Map();
  const read = (name) =>
    blobs.get(name) ?? fs.readFileSync(path.join(repository, name));
  const readArchive = (entry) =>
    readNativeRetestArchive(entry, { stem, runId: run.runId, read });
  const store = (value, existing) => {
    const bytes = Buffer.isBuffer(value)
      ? value
      : Buffer.from(JSON.stringify(value));
    const compressed = gzipSync(bytes);
    const target = existing ?? {};
    target.path ??= `${stem}/${run.runId}/objects/${retestHash(bytes).slice(7)}.gz`;
    Object.assign(target, {
      originalDigest: retestHash(bytes),
      storedDigest: retestHash(compressed),
      originalBytes: bytes.length,
    });
    blobs.set(`${NATIVE_EVIDENCE_ROOT}/${target.path}`, compressed);
    return target;
  };
  const mutate = (entry, update) => {
    const value = JSON.parse(readArchive(entry));
    update(value);
    store(value, entry);
  };
  run.remoteState = store({
    databaseId: Number(run.runId),
    headSha: run.sourceCommit,
    status: run.remoteStatus,
    conclusion: run.conclusion,
  });
  for (const stage of ["generation", "acceptance"]) {
    run[stage].artifactMetadata = store({
      id: run[stage].artifactId,
      name: run[stage].artifactName,
      workflow_run: { id: Number(run.runId), head_sha: run.sourceCommit },
    });
  }
  const samples = new Map(
    original.samples
      .filter((row) => run.selectedSampleIds.includes(row.sampleId))
      .map((row) => [
        row.sampleId,
        {
          ...structuredClone(row),
          generationObserved: row.latestPackageGenerationObserved,
          generationRunId: row.latestGenerationRunId,
          status: row.candidateAcceptancePassed
            ? "CANDIDATE_ACCEPTED"
            : "ATTEMPT_FAILED",
        },
      ]),
  );
  const context = {
    plan: {
      ...original,
      groups: [{ group, sampleIds: run.selectedSampleIds }],
    },
    frozenPlan,
    frozenPlanDigest,
    catalog,
    samples,
    readArchive,
    pinnedBytes: fs.readFileSync(
      path.join(repository, original.packageSetPath),
    ),
  };
  return {
    run,
    context,
    blobs,
    store,
    mutate,
    readArchive,
    verify: () => validateNativeRetestRun(run, context),
  };
}

test("new per-run verifier accepts real baseline, candidate, mutant and document receipts", () => {
  for (const group of ["linux-jetbrains", "darwin-cli"]) {
    const sample = fixture(group);
    const counts = sample.verify();
    assert.equal(
      counts.generationRecordsCollected,
      sample.run.selectedSampleIds.length,
    );
    assert.equal(
      counts.acceptanceRecordsCollected,
      sample.run.selectedSampleIds.length,
    );
    assert.ok(counts.candidateAcceptancePassed > 0);
  }
  const sample = fixture();
  assert.equal(
    sample.context.samples.get("verify-33").candidateAcceptancePassed,
    true,
  );
  assert.equal(sample.context.samples.get("verify-33").endToEndPassed, false);
});

test("archive bytes, raw digests, lengths and same-run path constraints are enforced", () => {
  const sample = fixture();
  const ref = sample.run.generation.rawSummary;
  sample.blobs.set(
    `${NATIVE_EVIDENCE_ROOT}/${ref.path}`,
    gzipSync(Buffer.from("{}")),
  );
  assert.throws(sample.verify);
  for (const change of [
    { originalDigest: "sha256:" + "0".repeat(64) },
    { originalBytes: 0 },
    { path: "../latest-package-round.json" },
    { path: "latest-package-round/other-run/summary.json.gz" },
  ]) {
    const fresh = fixture();
    Object.assign(fresh.run.generation.rawSummary, change);
    assert.throws(fresh.verify);
  }
});

test("remote run ID/SHA, artifact metadata and exact manifest binding reject substitution", () => {
  for (const [part, update] of [
    [
      "remote",
      (value) => {
        value.headSha = "a".repeat(40);
      },
    ],
    [
      "remote",
      (value) => {
        value.databaseId = 1;
      },
    ],
    [
      "artifact",
      (value) => {
        value.workflow_run.head_sha = "b".repeat(40);
      },
    ],
    [
      "generation",
      (value) => {
        value.packageSetDigest = "sha256:" + "0".repeat(64);
      },
    ],
    [
      "generation",
      (value) => {
        value.versions.cli = "0.0.1";
      },
    ],
    [
      "acceptance",
      (value) => {
        value.sourceSummaryDigest = "sha256:" + "0".repeat(64);
      },
    ],
    [
      "acceptance",
      (value) => {
        value.deliverySourceCommit = "c".repeat(40);
      },
    ],
  ]) {
    const sample = fixture();
    const ref =
      part === "remote"
        ? sample.run.remoteState
        : part === "artifact"
          ? sample.run.generation.artifactMetadata
          : sample.run[part].rawSummary;
    sample.mutate(ref, update);
    assert.throws(sample.verify, part);
  }
});

test("modified candidate bytes and mismatched acceptance projections cannot become passes", () => {
  const sample = fixture();
  const candidate = sample.run.evidence.find(
    (item) =>
      item.stage === "generation" &&
      item.originalArtifactPath.includes("/candidate/"),
  );
  assert.ok(candidate);
  sample.store(Buffer.from("// forged candidate"), candidate.archived);
  assert.throws(sample.verify);
  const changed = fixture();
  changed.context.samples.get("verify-33").endToEndPassed = true;
  assert.throws(changed.verify);
});

test("a rewritten passing receipt still must reject its behavioral mutants", () => {
  const sample = fixture();
  const acceptance = JSON.parse(
    sample.readArchive(sample.run.acceptance.rawSummary),
  );
  const accepted = acceptance.samples.find(
    (row) => row.candidateAcceptancePassed,
  );
  assert.ok(accepted);
  const evidence = sample.run.evidence.find(
    (item) =>
      item.stage === "acceptance" &&
      item.originalArtifactPath === accepted.check.receiptPath,
  );
  sample.mutate(evidence.archived, (receipt) => {
    for (const mutant of receipt.mutations) mutant.failed = 0;
  });
  const receipt = JSON.parse(sample.readArchive(evidence.archived));
  accepted.check.mutations = receipt.mutations;
  accepted.check.receiptDigest = evidence.archived.originalDigest;
  sample.store(acceptance, sample.run.acceptance.rawSummary);
  assert.throws(sample.verify, /must reject behavioral mutants/);
});

test("missing acceptance cannot be relabeled as a completed or accepted run", () => {
  const sample = fixture();
  delete sample.run.acceptance;
  for (const row of sample.context.samples.values()) {
    row.status = "AWAITING_ACCEPTANCE";
    delete row.candidateAcceptancePassed;
    delete row.endToEndPassed;
  }
  assert.throws(sample.verify);
  sample.run.status = "IN_PROGRESS";
  const result = sample.verify();
  assert.equal(result.acceptanceRecordsCollected, 0);
  assert.equal(result.candidateAcceptancePassed, 0);
});

function chainFixture() {
  const sample = fixture();
  const stem = "next-package-chain-test";
  const prefix = `${NATIVE_EVIDENCE_ROOT}/${stem}`;
  const memory = new Map();
  // Relocate the fixture envelope, retaining original receipt/candidate bytes.
  const relocate = (value) => {
    if (!value || typeof value !== "object") return;
    if (
      typeof value.path === "string" &&
      value.path.startsWith("latest-package-round/")
    ) {
      const oldPath = `${NATIVE_EVIDENCE_ROOT}/${value.path}`;
      const bytes =
        sample.blobs.get(oldPath) ??
        fs.readFileSync(path.join(repository, oldPath));
      value.path = value.path.replace("latest-package-round/", `${stem}/`);
      memory.set(`${NATIVE_EVIDENCE_ROOT}/${value.path}`, bytes);
    }
    for (const child of Object.values(value)) relocate(child);
  };
  const counts = sample.verify();
  relocate(sample.run);
  const acceptedIds = new Set(
    frozenPlan.samples
      .map((row) => row.id)
      .filter((id) => !sample.run.selectedSampleIds.includes(id)),
  );
  const baseline = {
    acceptedIds,
    baselineEvidence: [],
    priorRounds: [],
    latest: {
      packageSetDigest: "sha256:" + "1".repeat(64),
      versions: { ...original.versions, cli: "0.166.103" },
    },
  };
  const plan = {
    schema: "chainlesschain.native-package-retest-plan/v1",
    status: "PREPARED_NOT_DISPATCHED",
    billingAssessed: false,
    packageSetPath: original.packageSetPath,
    packageSetDigest: original.packageSetDigest,
    versions: original.versions,
    frozenProjectCommit: frozenPlan.commitSha,
    baselineEvidence: [],
    priorRounds: [],
    reusedAcceptedSampleIds: [...acceptedIds].sort(),
    groups: unfinishedNativeGroups(frozenPlan, acceptedIds),
    plannedNewSamples: sample.run.selectedSampleIds.length,
    ledgerPath: `${prefix}.json`,
    archivePrefix: prefix,
  };
  const planBytes = Buffer.from(JSON.stringify(plan));
  const ledger = {
    ...plan,
    schema: "chainlesschain.native-package-retest-round/v1",
    status: "COMPLETED",
    planPath: `${prefix}-plan.json`,
    planDigest: retestHash(planBytes),
    runs: [sample.run],
    samples: [...sample.context.samples.values()],
    counts: {
      ...counts,
      reusedAcceptedDeliverables: acceptedIds.size,
      cumulativeAcceptedDeliverables:
        acceptedIds.size + counts.candidateAcceptancePassed,
    },
  };
  const reference = {
    planPath: ledger.planPath,
    planDigest: ledger.planDigest,
    ledgerPath: plan.ledgerPath,
    ledgerDigest: "",
  };
  const refresh = () => {
    const bytes = Buffer.from(JSON.stringify(plan));
    reference.planDigest = ledger.planDigest = retestHash(bytes);
    memory.set(reference.planPath, bytes);
    const raw = Buffer.from(JSON.stringify(ledger));
    reference.ledgerDigest = retestHash(raw);
    memory.set(reference.ledgerPath, raw);
  };
  refresh();
  const read = (name) =>
    memory.get(name) ?? fs.readFileSync(path.join(repository, name));
  const verify = () =>
    extendNativeRetestBaseline(structuredClone(baseline), [reference], {
      repositoryRoot: repository,
      readRepository: read,
    });
  return { plan, ledger, reference, refresh, read, verify, baseline };
}

test("complete archive-backed prior round adds accepted deliveries and advances the version floor", () => {
  const sample = chainFixture();
  const baseline = sample.verify();
  assert.equal(
    baseline.acceptedIds.size,
    sample.baseline.acceptedIds.size +
      sample.ledger.counts.candidateAcceptancePassed,
  );
  assert.ok(
    baseline.acceptedIds.has("verify-33"),
    "native UI failure must not discard an accepted candidate",
  );
  assert.equal(
    sample.ledger.samples.find((row) => row.sampleId === "verify-33")
      .endToEndPassed,
    false,
  );
  assert.equal(baseline.latest.versions.cli, "0.166.104");
  assert.deepEqual(baseline.priorRounds, [sample.reference]);
  assert.throws(
    () =>
      validateNextNativePackageSet(
        {
          packageSetDigest: "sha256:" + "9".repeat(64),
          versions: baseline.latest.versions,
        },
        baseline.latest,
      ),
    /newer published/,
  );
  const next = {
    packageSetDigest: "sha256:" + "9".repeat(64),
    versions: { ...baseline.latest.versions, cli: "0.166.105" },
  };
  assert.doesNotThrow(() =>
    validateNextNativePackageSet(next, baseline.latest),
  );
  const remaining = unfinishedNativeGroups(
    frozenPlan,
    baseline.acceptedIds,
  ).flatMap((group) => group.sampleIds);
  for (const row of sample.ledger.samples.filter(
    (row) => row.candidateAcceptancePassed,
  ))
    assert.ok(!remaining.includes(row.sampleId));
  // A historical plan's fixed prefix stays valid even after registration;
  // the same prefix is no longer eligible for a new paid dispatch.
  assert.deepEqual(sample.plan.priorRounds, []);
  assert.throws(
    () =>
      assertCurrentNativeRetestChain([], () =>
        Buffer.from(JSON.stringify([sample.reference])),
      ),
    /omitted/,
  );
});

test("prior ledger chain rejects incomplete evidence, changed digests, cycles and forged acceptance", () => {
  for (const mutate of [
    (item) => {
      item.reference.ledgerDigest = "sha256:" + "0".repeat(64);
    },
    (item) => {
      item.reference.planDigest = "sha256:" + "0".repeat(64);
    },
    (item) => {
      item.ledger.status = "IN_PROGRESS";
      item.refresh();
    },
    (item) => {
      delete item.ledger.runs[0].acceptance;
      item.refresh();
    },
    (item) => {
      item.plan.priorRounds = [structuredClone(item.reference)];
      item.refresh();
    },
    (item) => {
      item.ledger.samples[0].candidateAcceptancePassed =
        !item.ledger.samples[0].candidateAcceptancePassed;
      item.refresh();
    },
  ]) {
    const item = chainFixture();
    mutate(item);
    assert.throws(item.verify);
  }
});

function planFixture() {
  const acceptedIds = new Set(
    original.samples
      .filter(
        (row) =>
          !row.newModelGenerationRequired || row.candidateAcceptancePassed,
      )
      .map((row) => row.sampleId),
  );
  const baseline = {
    acceptedIds,
    latest: original,
    baselineEvidence: [
      { path: "bound-original.json", digest: "sha256:" + "a".repeat(64) },
    ],
  };
  const pinned = {
    versions: { ...original.versions, cli: "0.166.105" },
    packageSetDigest: "sha256:" + "b".repeat(64),
  };
  const planFile = `${NATIVE_EVIDENCE_ROOT}/next-package-test-plan.json`;
  const groups = unfinishedNativeGroups(frozenPlan, acceptedIds);
  const plan = {
    schema: "chainlesschain.native-package-retest-plan/v1",
    status: "PREPARED_NOT_DISPATCHED",
    billingAssessed: false,
    versions: pinned.versions,
    packageSetDigest: pinned.packageSetDigest,
    frozenProjectCommit: frozenPlan.commitSha,
    baselineEvidence: baseline.baselineEvidence,
    reusedAcceptedSampleIds: [...acceptedIds].sort(),
    groups,
    plannedNewSamples: groups.reduce(
      (count, group) => count + group.sampleIds.length,
      0,
    ),
    ledgerPath: `${NATIVE_EVIDENCE_ROOT}/next-package-test.json`,
    archivePrefix: `${NATIVE_EVIDENCE_ROOT}/next-package-test`,
  };
  const context = { planFile, baseline, frozenPlan, pinned };
  return {
    plan,
    context,
    verify: () => validateRetestPlanBinding(plan, context),
  };
}

test("new plan binds the verified accepted set and cannot overlap old ledger/archive paths", () => {
  assert.equal(planFixture().verify(), "next-package-test");
  for (const update of [
    (plan) => {
      plan.groups[0].sampleIds.push("verify-33");
    },
    (plan) => {
      plan.reusedAcceptedSampleIds.pop();
    },
    (plan) => {
      plan.ledgerPath = `${NATIVE_EVIDENCE_ROOT}/latest-package-round.json`;
    },
    (plan) => {
      plan.archivePrefix = `${NATIVE_EVIDENCE_ROOT}/latest-package-round`;
    },
    (plan) => {
      plan.plannedNewSamples++;
    },
    (plan) => {
      plan.baselineEvidence = [];
    },
  ]) {
    const sample = planFixture();
    update(sample.plan);
    assert.throws(sample.verify);
  }
});

const collector = path.resolve(
  repository,
  "../../.work/collect-next-package-round.py",
);

test("single-sample shards permit multiple runs per group with exact disjoint coverage", () => {
  const plan = {
    groups: [
      { group: "win32-jetbrains", sampleIds: ["verify-01", "verify-02"] },
    ],
    executionShards: ["verify-01", "verify-02"].map((id) => ({
      shardId: `win32-jetbrains--${id}`,
      group: "win32-jetbrains",
      sampleIds: [id],
    })),
  };
  const runs = plan.executionShards.map((shard, i) => ({
    shardId: shard.shardId,
    group: shard.group,
    runId: String(i + 1),
    selectedSampleIds: shard.sampleIds,
  }));
  validateNativeRetestRunBindings(plan, runs);
  for (const change of [
    (rows) => rows.pop(),
    (rows) => {
      rows[1].runId = rows[0].runId;
    },
    (rows) => {
      rows[1].shardId = rows[0].shardId;
    },
    (rows) => {
      rows[1].selectedSampleIds = rows[0].selectedSampleIds;
    },
    (rows) => {
      delete rows[0].shardId;
    },
    (rows) => {
      rows[0].group = "linux-jetbrains";
    },
  ]) {
    const altered = structuredClone(runs);
    change(altered);
    assert.throws(() => validateNativeRetestRunBindings(plan, altered));
  }
  const overlap = structuredClone(plan);
  overlap.executionShards[1].sampleIds = ["verify-01"];
  assert.throws(() => nativeRetestExecutionShards(overlap));
  const missing = structuredClone(plan);
  missing.executionShards.pop();
  assert.throws(() => nativeRetestExecutionShards(missing));
  const legacy = { groups: plan.groups };
  validateNativeRetestRunBindings(legacy, [
    {
      group: "win32-jetbrains",
      runId: "1",
      selectedSampleIds: ["verify-01", "verify-02"],
    },
  ]);
  assert.throws(() => validateNativeRetestRunBindings(legacy, runs));
});

test(
  "local collector does not clobber existing ledger/archive bytes or checkpoint failed evidence",
  { skip: !fs.existsSync(collector) },
  () => {
    const script = String.raw`
import importlib.util, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location('next_collector', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
projection = {'brokerStatus': 'stale', 'host': None, 'generationPassed': True}
m.copy_generation_fields(projection, {'generationPassed': False})
assert projection == {'generationPassed': False}
m.copy_generation_fields(projection, {'generationPassed': False, 'brokerStatus': None, 'host': {'passed': False}})
assert projection == {'generationPassed': False, 'brokerStatus': None, 'host': {'passed': False}}
plan = {'groups': [{'group': 'win32-jetbrains', 'sampleIds': ['verify-01', 'verify-02']}],
        'executionShards': [{'shardId': 'shard-' + str(i), 'group': 'win32-jetbrains', 'sampleIds': [sample]}
                            for i, sample in enumerate(['verify-01', 'verify-02'])]}
bindings = [{'shardId': 'shard-' + str(i), 'group': 'win32-jetbrains', 'runId': str(i + 1), 'sourceCommit': 'a' * 40}
            for i in range(2)]
assert len(m.validate_bindings(bindings, plan)) == 2
for bad in [bindings[:1], [bindings[0], bindings[0]],
            [bindings[0], dict(bindings[1], runId='1')],
            [bindings[0], dict(bindings[1], group='linux-jetbrains')]]:
    try:
        m.validate_bindings(bad, plan)
        raise RuntimeError('invalid shard binding accepted')
    except AssertionError:
        pass
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    m.TREE = root
    m.immutable(root, 'old-ledger.json', b'original')
    try:
        m.immutable(root, 'old-ledger.json', b'replacement')
        raise AssertionError('archive overwrite was accepted')
    except AssertionError as error:
        assert str(error) == 'existing archive bytes differ'
    assert (root / 'old-ledger.json').read_bytes() == b'original'
    for name in ['../escape', '/absolute', 'folder/../../escape', 'C:/outside']:
        try:
            m.safe_file(root, name, create=True)
            raise RuntimeError('unsafe path accepted')
        except AssertionError:
            pass
    c = m.Collector.__new__(m.Collector)
    c.plan = {'ledgerPath': 'old-ledger.json'}
    c.plan_file = 'plan.json'
    c.previous = None
    c.data = {'runs': [], 'samples': [], 'reusedAcceptedSampleIds': []}
    m.verify = lambda *args, **kwargs: {}
    try:
        c.checkpoint()
        raise AssertionError('ledger overwrite was accepted')
    except FileExistsError:
        pass
    assert (root / 'old-ledger.json').read_bytes() == b'original'
    def reject(*args, **kwargs):
        raise RuntimeError('invalid evidence')
    m.verify = reject
    c.previous = b'original'
    try:
        c.checkpoint()
        raise AssertionError('failed evidence was committed')
    except RuntimeError as error:
        assert str(error) == 'invalid evidence'
    assert (root / 'old-ledger.json').read_bytes() == b'original'
    assert not list(root.glob('*.pending-*'))
print('collector safety controls passed')
`;
    const result = spawnSync(
      process.platform === "win32" ? "python" : "python3",
      ["-B", "-c", script, collector],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /collector safety controls passed/);
  },
);
