#!/usr/bin/env node
/** Verify a separately archived retest round without executing any candidate. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  NATIVE_EVIDENCE_ROOT,
  loadVerifiedNativeAcceptedSamples,
  unfinishedNativeGroups,
  validateNativePackageSetFile,
  validateNextNativePackageSet,
  assertCurrentNativeRetestChain,
} from "./verify01-native-retest-plan.mjs";
import { validateDocumentReceipt } from "../../../docs/research/cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/verify-latest-package-round.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
export const retestHash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const parsed = (bytes) => JSON.parse(bytes.toString("utf8"));
const sorted = (values) => [...values].sort();
function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `duplicate ${label}`);
  return values;
}
function safeRelative(value) {
  assert.equal(typeof value, "string");
  assert.ok(value && !/[\\:\u0000-\u001f]/u.test(value));
  assert.ok(!path.posix.isAbsolute(value));
  assert.ok(
    value.split("/").every((part) => part && part !== "." && part !== ".."),
    "unsafe evidence path",
  );
  return value;
}
export function repositoryReader(root) {
  const cache = new Map();
  return (relative) => {
    safeRelative(relative);
    if (cache.has(relative)) return cache.get(relative);
    let current = root;
    const parts = relative.split("/");
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      assert.ok(!stat.isSymbolicLink(), "evidence links are not allowed");
      assert.ok(
        index === parts.length - 1 ? stat.isFile() : stat.isDirectory(),
      );
    }
    const bytes = fs.readFileSync(current);
    cache.set(relative, bytes);
    return bytes;
  };
}

// Legacy plans retain exactly one run per group. Sharded plans bind every run
// to a declared shard; neither missing samples nor duplicate execution is valid.
export function nativeRetestExecutionShards(plan) {
  const shards =
    plan.executionShards ??
    plan.groups.map((group) => ({
      shardId: group.group,
      group: group.group,
      sampleIds: group.sampleIds,
    }));
  assert.ok(Array.isArray(shards));
  unique(
    shards.map((shard) => shard.shardId),
    "execution shard IDs",
  );
  for (const shard of shards) {
    assert.match(shard.shardId, /^[a-z0-9][a-z0-9-]{0,159}$/u);
    const group = plan.groups.find((item) => item.group === shard.group);
    assert.ok(group, "shard group outside plan");
    assert.ok(Array.isArray(shard.sampleIds) && shard.sampleIds.length > 0);
    for (const id of shard.sampleIds) assert.ok(group.sampleIds.includes(id));
    if (plan.executionShards && shard.group.endsWith("-jetbrains")) {
      assert.equal(
        shard.sampleIds.length,
        1,
        "JetBrains shards require one sample",
      );
    }
  }
  assert.deepEqual(
    sorted(
      unique(
        shards.flatMap((shard) => shard.sampleIds),
        "shard samples",
      ),
    ),
    sorted(plan.groups.flatMap((group) => group.sampleIds)),
    "shards must cover every planned sample",
  );
  return shards;
}

export function validateNativeRetestRunBindings(plan, runs) {
  const shards = nativeRetestExecutionShards(plan);
  assert.deepEqual(
    sorted(
      unique(
        runs.map((run) => run.shardId ?? run.group),
        "run shard IDs",
      ),
    ),
    sorted(shards.map((shard) => shard.shardId)),
  );
  unique(
    runs.map((run) => run.runId),
    "run IDs",
  );
  for (const run of runs) {
    if (plan.executionShards) assert.equal(typeof run.shardId, "string");
    const shard = shards.find(
      (item) => item.shardId === (run.shardId ?? run.group),
    );
    assert.equal(run.group, shard.group);
    assert.deepEqual(
      sorted(unique(run.selectedSampleIds, "run samples")),
      sorted(shard.sampleIds),
    );
  }
}

/** Pure plan checks use a baseline that the entry point has already verified. */
export function validateRetestPlanBinding(plan, context) {
  const { planFile, baseline, frozenPlan, pinned } = context;
  assert.equal(plan.schema, "chainlesschain.native-package-retest-plan/v1");
  assert.equal(plan.status, "PREPARED_NOT_DISPATCHED");
  assert.equal(plan.billingAssessed, false);
  safeRelative(planFile);
  const filename = path.posix.basename(planFile);
  assert.match(filename, /^next-package-[a-z0-9][a-z0-9-]{0,70}-plan\.json$/u);
  assert.equal(path.posix.dirname(planFile), NATIVE_EVIDENCE_ROOT);
  const stem = filename.slice(0, -"-plan.json".length);
  assert.equal(
    plan.ledgerPath,
    `${NATIVE_EVIDENCE_ROOT}/${stem}.json`,
    "ledger must belong to the new round",
  );
  assert.equal(
    plan.archivePrefix,
    `${NATIVE_EVIDENCE_ROOT}/${stem}`,
    "archive must belong to the new round",
  );
  assert.equal(plan.packageSetDigest, pinned.packageSetDigest);
  assert.deepEqual(plan.versions, pinned.versions);
  validateNextNativePackageSet(pinned, baseline.latest);
  assert.equal(plan.frozenProjectCommit, frozenPlan.commitSha);
  assert.deepEqual(plan.baselineEvidence, baseline.baselineEvidence);
  assert.deepEqual(plan.priorRounds ?? [], baseline.priorRounds ?? []);
  assert.deepEqual(plan.reusedAcceptedSampleIds, sorted(baseline.acceptedIds));
  const groups = unfinishedNativeGroups(frozenPlan, baseline.acceptedIds);
  assert.deepEqual(
    plan.groups,
    groups,
    "retest selection differs from unfinished samples",
  );
  const ids = unique(
    groups.flatMap((group) => group.sampleIds),
    "planned samples",
  );
  assert.equal(plan.plannedNewSamples, ids.length);
  nativeRetestExecutionShards(plan);
  assert.equal(
    ids.length + baseline.acceptedIds.size,
    frozenPlan.samples.length,
  );
  return stem;
}

export function loadNativeRetestPlan(planFile, repositoryRoot = repository) {
  const read = repositoryReader(repositoryRoot);
  const plan = parsed(read(planFile));
  const baseline = loadVerifiedNativeAcceptedSamples({
    repositoryRoot,
    priorRounds: plan.priorRounds ?? [],
    readRepository: read,
  });
  return loadNativeRetestPlanWithBaseline(
    planFile,
    repositoryRoot,
    baseline,
    read,
  );
}

// The chain loader supplies only the already verified prefix. This avoids
// recursively loading the current registry while verifying historical plans.
export function loadNativeRetestPlanWithBaseline(
  planFile,
  repositoryRoot,
  baseline,
  read,
) {
  const bytes = read(planFile);
  const plan = parsed(bytes);
  const pinned = validateNativePackageSetFile(
    plan.packageSetPath,
    repositoryRoot,
  );
  const frozenRoot = "docs/research/cli/verify01-plan-2026-10-13-volcengine/";
  const frozenPlan = parsed(read(frozenRoot + "plan.json"));
  const catalog = parsed(read(frozenRoot + "tasks.json"));
  const frozenPlanDigest = read(frozenRoot + "plan.sha256")
    .toString("utf8")
    .trim();
  const stem = validateRetestPlanBinding(plan, {
    planFile,
    baseline,
    frozenPlan,
    pinned,
  });
  return {
    plan,
    planFile,
    planDigest: retestHash(bytes),
    baseline,
    pinned,
    frozenPlan,
    frozenPlanDigest,
    catalog,
    stem,
    read,
  };
}

function validateReceipts(row, native, getFile, context) {
  const { frozenPlan, frozenPlanDigest, catalog } = context;
  for (const stage of ["setup", "check"]) {
    const step = row[stage];
    if (!step) continue;
    const raw = getFile("acceptance", safeRelative(step.receiptPath));
    assert.equal(retestHash(raw), step.receiptDigest);
    const receipt = parsed(raw);
    assert.equal(receipt.taskId, row.taskId);
    assert.equal(receipt.stage, stage);
    assert.equal(receipt.pass, step.pass);
    for (const key of ["tests", "mutations"]) {
      if (key in step) assert.deepEqual(step[key], receipt[key]);
    }
    if (!receipt.pass) continue;
    assert.ok(
      receipt.tests?.some((item) => item.kind === "baseline" && item.total > 0),
    );
    for (const item of receipt.tests) {
      assert.ok(Number.isSafeInteger(item.total) && item.total > 0);
      assert.equal(item.failed, 0);
      assert.equal(item.passed, item.total);
    }
    if (stage !== "check") continue;
    const task = catalog.tasks.find((item) => item.id === row.taskId);
    assert.ok(task);
    if (row.taskId === "verify-34") {
      validateDocumentReceipt(
        task,
        receipt,
        getFile(
          "generation",
          `${row.sampleId}/candidate/${task.expectedFiles[0]}`,
        ).toString("utf8"),
        frozenPlan,
        frozenPlanDigest,
      );
    } else {
      assert.ok(
        receipt.tests.some(
          (item) => item.kind === "candidate" && item.total > 0,
        ),
      );
      assert.ok(receipt.mutations?.length);
      for (const mutant of receipt.mutations) {
        assert.ok(
          mutant.total > 0 && mutant.failed > 0,
          "passing candidate must reject behavioral mutants",
        );
      }
    }
  }
  const candidatePassed = row.setup?.pass === true && row.check?.pass === true;
  assert.equal(row.candidateAcceptancePassed, candidatePassed);
  assert.equal(row.passed, row.generationPassed === true && candidatePassed);
  assert.equal(row.originalGenerationPassed, native.generationPassed === true);
  if (candidatePassed) {
    const task = catalog.tasks.find((item) => item.id === row.taskId);
    assert.deepEqual(
      sorted(
        unique(
          (native.candidates ?? []).map((item) => item.file),
          "candidate files",
        ),
      ),
      sorted(task.expectedFiles),
      "accepted candidate files incomplete",
    );
  }
  if (row.passed) {
    assert.equal(native.host.passed, true);
    assert.equal(native.sourceScopePassed, true);
    assert.notEqual(row.frozenSourceAssessment?.exact, false);
  }
}

/** Validate one run's exact identities and receipts. readArchive must verify
 * compressed/raw digests and constrain paths to this new round's archive. */
export function validateNativeRetestRun(run, context) {
  const { plan, frozenPlan, frozenPlanDigest, catalog, samples, readArchive } =
    context;
  assert.match(run.sourceCommit, /^[a-f0-9]{40}$/u);
  assert.match(run.runId, /^[1-9][0-9]*$/u);
  const group = nativeRetestExecutionShards(plan).find(
    (item) => item.shardId === (run.shardId ?? run.group),
  );
  assert.ok(group, "run group outside retest plan");
  assert.equal(group.group, run.group);
  if (plan.executionShards) assert.equal(typeof run.shardId, "string");
  assert.deepEqual(
    sorted(unique(run.selectedSampleIds, "run samples")),
    sorted(group.sampleIds),
  );
  const remote = parsed(readArchive(run.remoteState));
  assert.equal(String(remote.databaseId), run.runId);
  assert.equal(remote.headSha, run.sourceCommit, "remote run SHA differs");
  assert.equal(remote.status, run.remoteStatus);
  assert.equal(remote.conclusion || null, run.conclusion);
  assert.ok(
    [
      "queued",
      "in_progress",
      "completed",
      "waiting",
      "pending",
      "requested",
    ].includes(remote.status),
  );
  const evidence = new Map();
  for (const item of run.evidence ?? []) {
    assert.ok(["generation", "acceptance"].includes(item.stage));
    safeRelative(item.originalArtifactPath);
    const key = `${item.stage}/${item.originalArtifactPath}`;
    assert.ok(!evidence.has(key), "duplicate evidence member");
    evidence.set(key, readArchive(item.archived));
  }
  const getFile = (stage, member) => {
    safeRelative(member);
    const bytes = evidence.get(`${stage}/${member}`);
    assert.ok(bytes, `missing ${stage}/${member}`);
    return bytes;
  };
  const rawStages = {};
  for (const stage of ["generation", "acceptance"]) {
    const ref = run[stage];
    if (!ref) continue;
    assert.ok(Number.isSafeInteger(ref.artifactId) && ref.artifactId > 0);
    assert.equal(
      ref.artifactName,
      `verify01-native-subset-${stage === "generation" ? "delivery" : "acceptance"}-${run.group}-${run.sourceCommit}`,
    );
    const artifact = parsed(readArchive(ref.artifactMetadata));
    assert.equal(artifact.id, ref.artifactId);
    assert.equal(artifact.name, ref.artifactName);
    assert.equal(String(artifact.workflow_run.id), run.runId);
    assert.equal(artifact.workflow_run.head_sha, run.sourceCommit);
    const raw = parsed(readArchive(ref.rawSummary));
    rawStages[stage] = raw;
    assert.equal(
      raw.schema,
      `chainlesschain.verify01-native-task-${stage === "generation" ? "campaign" : "acceptance"}/v1`,
    );
    assert.equal(raw.executionSourceCommit, run.sourceCommit);
    assert.equal(raw.group, run.group);
    assert.equal(raw.projectCommit, frozenPlan.commitSha);
    assert.equal(raw.planDigest, frozenPlanDigest);
    assert.deepEqual(raw.versions, plan.versions);
    assert.equal(raw.packageSetDigest, plan.packageSetDigest);
    assert.equal(raw.selectionScope, "operator-subset");
    assert.deepEqual(
      sorted(
        unique(
          raw.samples.map((row) => row.sampleId),
          "summary samples",
        ),
      ),
      sorted(run.selectedSampleIds),
    );
    assert.deepEqual(
      sorted(unique(raw.selectedSampleIds, "summary selection")),
      sorted(run.selectedSampleIds),
    );
    assert.deepEqual(
      ref.sampleIds,
      raw.samples.map((row) => row.sampleId),
    );
    for (const row of raw.samples) {
      assert.deepEqual(row.versions, plan.versions);
      assert.equal(row.packageSetDigest, plan.packageSetDigest);
      const sample = samples.get(row.sampleId);
      assert.ok(sample);
      assert.equal(row.taskId, sample.taskId);
      assert.equal(row.kind, sample.kind);
    }
  }
  const gen = rawStages.generation,
    acc = rawStages.acceptance;
  const [platform, entry] = run.group.split("-");
  if (gen) {
    assert.equal(gen.actualPlatform, platform);
    assert.equal(gen.actualEntry, entry);
    assert.deepEqual(
      getFile("generation", "package-set.json"),
      context.pinnedBytes,
    );
    assert.equal(
      gen.generationPassed,
      gen.samples.every((row) => row.generationPassed),
    );
    for (const row of gen.samples) {
      assert.equal(row.executionSourceCommit, run.sourceCommit);
      assert.equal(row.projectCommit, frozenPlan.commitSha);
      assert.equal(row.planDigest, frozenPlanDigest);
      const task = catalog.tasks.find((item) => item.id === row.taskId);
      assert.ok(task);
      unique(
        (row.candidates ?? []).map((candidate) => candidate.file),
        "candidate files",
      );
      for (const candidate of row.candidates ?? []) {
        assert.ok(task.expectedFiles.includes(candidate.file));
        assert.equal(
          candidate.path,
          `${row.sampleId}/candidate/${candidate.file}`,
        );
        const bytes = getFile("generation", candidate.path);
        assert.equal(retestHash(bytes), candidate.digest);
        assert.equal(bytes.length, candidate.bytes);
      }
      const sample = samples.get(row.sampleId);
      assert.equal(sample.generationObserved, true);
      assert.equal(sample.generationRunId, run.runId);
      assert.equal(
        sample.sourceSummaryDigest,
        run.generation.rawSummary.originalDigest,
      );
      for (const key of ["generationPassed", "host", "brokerStatus"])
        assert.deepEqual(sample[key], row[key]);
      assert.equal(
        sample.modelFailureCategory,
        row.model?.failureCategory ?? null,
      );
      if (!acc) {
        assert.equal(sample.status, "AWAITING_ACCEPTANCE");
        assert.equal(sample.candidateAcceptancePassed, undefined);
        assert.equal(sample.endToEndPassed, undefined);
      }
    }
  } else {
    for (const id of run.selectedSampleIds) {
      const sample = samples.get(id);
      assert.equal(sample.status, "PENDING_EXECUTION");
      assert.equal(sample.generationObserved, false);
      for (const key of [
        "generationRunId",
        "sourceSummaryDigest",
        "generationPassed",
        "candidateAcceptancePassed",
        "endToEndPassed",
      ]) {
        assert.equal(sample[key], undefined);
      }
    }
  }
  if (acc) {
    assert.ok(gen, "acceptance requires its generation summary");
    assert.equal(acc.acceptanceHost, "linux-docker");
    assert.equal(acc.actualGenerationHost.platform, platform);
    assert.equal(acc.actualGenerationHost.entry, entry);
    assert.equal(
      acc.sourceSummaryDigest,
      run.generation.rawSummary.originalDigest,
    );
    assert.equal(acc.deliverySourceCommit, run.sourceCommit);
    for (const row of acc.samples) {
      const native = gen.samples.find((item) => item.sampleId === row.sampleId);
      validateReceipts(row, native, getFile, context);
      const sample = samples.get(row.sampleId);
      assert.equal(
        sample.candidateAcceptancePassed,
        row.candidateAcceptancePassed,
      );
      assert.equal(sample.endToEndPassed, row.passed);
      assert.equal(
        sample.status,
        row.candidateAcceptancePassed ? "CANDIDATE_ACCEPTED" : "ATTEMPT_FAILED",
      );
    }
    assert.equal(
      acc.passed,
      acc.samples.every((row) => row.passed),
    );
  }
  const complete = remote.status === "completed" && Boolean(gen && acc);
  if (complete)
    for (const raw of [gen, acc]) {
      assert.ok(
        typeof raw.finishedAt === "string" &&
          Number.isFinite(Date.parse(raw.finishedAt)),
      );
    }
  assert.equal(run.status, complete ? "COMPLETED" : "IN_PROGRESS");
  return {
    generationRecordsCollected: gen?.samples.length ?? 0,
    acceptanceRecordsCollected: acc?.samples.length ?? 0,
    candidateAcceptancePassed:
      acc?.samples.filter((row) => row.candidateAcceptancePassed).length ?? 0,
    endToEndPassed: acc?.samples.filter((row) => row.passed).length ?? 0,
  };
}

export function readNativeRetestArchive(entry, { stem, runId, read }) {
  safeRelative(entry.path);
  assert.ok(
    entry.path.startsWith(`${stem}/${runId}/`),
    "archive outside this retest run",
  );
  const compressed = read(`${NATIVE_EVIDENCE_ROOT}/${entry.path}`);
  assert.equal(retestHash(compressed), entry.storedDigest);
  const bytes = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
  assert.equal(retestHash(bytes), entry.originalDigest);
  assert.equal(bytes.length, entry.originalBytes);
  return bytes;
}

export function verifyNativeRetestRound({
  planFile,
  ledger,
  repositoryRoot = repository,
  requireComplete = false,
}) {
  const context = loadNativeRetestPlan(planFile, repositoryRoot);
  return verifyNativeRetestRoundWithContext(context, {
    ledger,
    requireComplete,
  });
}

export function verifyNativeRetestRoundWithContext(
  context,
  { ledger, requireComplete = false } = {},
) {
  const { planFile } = context;
  const { plan, frozenPlan, catalog, read, stem } = context;
  const data = ledger ?? parsed(read(plan.ledgerPath));
  assert.equal(data.schema, "chainlesschain.native-package-retest-round/v1");
  assert.equal(data.billingAssessed, false);
  assert.equal(data.planPath, planFile);
  assert.equal(data.planDigest, context.planDigest);
  for (const key of [
    "packageSetPath",
    "packageSetDigest",
    "versions",
    "frozenProjectCommit",
    "ledgerPath",
    "archivePrefix",
    "plannedNewSamples",
    "reusedAcceptedSampleIds",
  ]) {
    assert.deepEqual(data[key], plan[key]);
  }
  const expectedIds = plan.groups.flatMap((group) => group.sampleIds);
  assert.deepEqual(
    sorted(
      unique(
        data.samples.map((sample) => sample.sampleId),
        "ledger samples",
      ),
    ),
    sorted(expectedIds),
  );
  const samples = new Map(
    data.samples.map((sample) => [sample.sampleId, sample]),
  );
  for (const sample of samples.values()) {
    const frozen = frozenPlan.samples.find(
      (item) => item.id === sample.sampleId,
    );
    assert.equal(sample.taskId, frozen.taskId);
    assert.equal(sample.kind, frozen.kind);
    assert.equal(sample.group, frozen.stratum.replace(/-volcengine$/u, ""));
  }
  validateNativeRetestRunBindings(plan, data.runs);
  unique(
    data.runs.map((run) => run.runId),
    "run IDs",
  );
  unique(
    data.runs.flatMap((run) => run.selectedSampleIds),
    "ledger run samples",
  );
  const counts = {
    generationRecordsCollected: 0,
    acceptanceRecordsCollected: 0,
    candidateAcceptancePassed: 0,
    endToEndPassed: 0,
  };
  const pinnedBytes = read(plan.packageSetPath);
  for (const run of data.runs) {
    const readArchive = (entry) =>
      readNativeRetestArchive(entry, { stem, runId: run.runId, read });
    const observed = validateNativeRetestRun(run, {
      ...context,
      plan,
      frozenPlan,
      catalog,
      pinnedBytes,
      samples,
      readArchive,
    });
    for (const key of Object.keys(counts)) counts[key] += observed[key];
  }
  counts.reusedAcceptedDeliverables = plan.reusedAcceptedSampleIds.length;
  counts.cumulativeAcceptedDeliverables =
    counts.reusedAcceptedDeliverables + counts.candidateAcceptancePassed;
  assert.deepEqual(data.counts, counts);
  const complete = data.runs.every((run) => run.status === "COMPLETED");
  assert.equal(data.status, complete ? "COMPLETED" : "IN_PROGRESS");
  if (complete || requireComplete) {
    assert.equal(complete, true, "new package round incomplete");
    assert.equal(counts.generationRecordsCollected, plan.plannedNewSamples);
    assert.equal(counts.acceptanceRecordsCollected, plan.plannedNewSamples);
  }
  return { status: data.status, planDigest: context.planDigest, counts };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      plan: { type: "string" },
      "plan-only": { type: "boolean", default: false },
      stdin: { type: "boolean", default: false },
      "require-complete": { type: "boolean", default: false },
    },
  });
  assert.ok(values.plan, "--plan is required");
  if (values["plan-only"]) {
    assert.ok(!values.stdin && !values["require-complete"]);
    const context = loadNativeRetestPlan(values.plan);
    assertCurrentNativeRetestChain(context.plan.priorRounds ?? []);
    console.log(
      JSON.stringify({ plan: context.plan, planDigest: context.planDigest }),
    );
  } else {
    const ledger = values.stdin ? parsed(fs.readFileSync(0)) : undefined;
    console.log(
      JSON.stringify(
        verifyNativeRetestRound({
          planFile: values.plan,
          ledger,
          requireComplete: values["require-complete"],
        }),
      ),
    );
  }
}
