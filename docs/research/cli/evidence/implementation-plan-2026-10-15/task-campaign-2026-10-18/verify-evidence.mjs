import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL(".", import.meta.url));
const gitHead = process.argv.includes("--git-head");
const repository = gitHead
  ? execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
    }).trim()
  : null;
const gitPrefix = gitHead
  ? path.relative(repository, root).replaceAll("\\", "/") + "/"
  : null;
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const read = (relative) => {
  const target = path.resolve(root, relative);
  assert.ok(target.startsWith(root), "evidence path outside report root");
  assert.ok(fs.lstatSync(target).isFile(), "regular evidence file required");
  return gitHead
    ? execFileSync("git", ["show", `HEAD:${gitPrefix}${relative}`], {
        cwd: repository,
        maxBuffer: 32 * 1024 * 1024,
      })
    : fs.readFileSync(target);
};
const json = (relative) => JSON.parse(read(relative).toString("utf8"));
const results = json("results.json");
if (process.argv.includes("--require-complete")) {
  assert.equal(
    results.status,
    "COMPLETED",
    "Latest declared 36+9 round is incomplete",
  );
}
const audit = json("native45-independent-audit.json");
assert.equal(
  hash(read(results.native45.independentAudit.path)),
  results.native45.independentAudit.digest,
);
assert.equal(audit.bindingCheckCounts.errors, 0);
const raw = new Map();
const verifyArchive = (entry) => {
  const stored = read(entry.path);
  assert.equal(hash(stored), entry.storedDigest);
  const bytes = gunzipSync(stored);
  assert.equal(hash(bytes), entry.originalDigest);
  if (entry.originalBytes !== undefined)
    assert.equal(bytes.length, entry.originalBytes);
  return bytes;
};
for (const batch of results.native45.results) {
  const bytes = verifyArchive(batch.rawSummary);
  const summary = JSON.parse(bytes);
  assert.equal(summary.group, batch.group);
  assert.equal(summary.executionSourceCommit, batch.executionSourceCommit);
  assert.equal(summary.sourceSummaryDigest ?? null, batch.sourceSummaryDigest);
  assert.equal(
    summary.deliverySourceCommit ?? summary.executionSourceCommit,
    batch.deliverySourceCommit,
  );
  assert.equal(summary.finishedAt ?? null, batch.finishedAt);
  assert.deepEqual(
    summary.samples.map((row) => row.sampleId),
    batch.samples.map((row) => row.sampleId),
  );
  for (const [index, sample] of batch.samples.entries()) {
    const original = summary.samples[index];
    for (const key of [
      "sampleId",
      "taskId",
      "kind",
      "originalGenerationPassed",
      "frozenSourceAssessment",
      "generationFailure",
      "generationPassed",
      "generationAssessment",
      "candidateAcceptancePassed",
      "passed",
      "host",
      "sourceScopePassed",
      "unexpectedChanges",
      "brokerStatus",
      "setup",
      "check",
      "candidates",
    ])
      assert.deepEqual(
        sample[key],
        original[key] ?? null,
        `raw projection: ${key}`,
      );
    assert.equal(
      sample.modelFailureCategory,
      original.model?.failureCategory ?? null,
    );
    assert.equal(
      sample.providerResponsesObserved,
      (original.broker ?? original.brokerStatus)?.usageCompleteRequests ?? 0,
    );
    if (original.failure) {
      assert.equal(sample.failure, original.failure.split(/\r?\n/u)[0]);
      assert.equal(
        sample.rawFailureDigest,
        hash(Buffer.from(original.failure)),
      );
    } else assert.equal(sample.failure, original.failure ?? null);
  }
  raw.set(hash(bytes), { summary, batch });
}
for (const row of results.taskRuns) verifyArchive(row.rawSummary);
for (const entry of results.nativeEntries)
  for (const attempt of entry.attempts) verifyArchive(attempt.rawSummary);
for (const batch of results.native45.results.filter(
  (row) => row.stage === "acceptance",
)) {
  const source = raw.get(batch.sourceSummaryDigest);
  assert.equal(source?.batch.stage, "generation");
  assert.equal(source.batch.group, batch.group);
  assert.equal(source.batch.executionSourceCommit, batch.deliverySourceCommit);
}
let files = 0;
for (const row of json("verified-deliveries.json")) {
  assert.equal(hash(read(row.path)), row.digest);
  files++;
}
for (const row of json("native-verified-deliveries.json")) {
  const source = raw.get(row.sourceSummaryDigest);
  assert.equal(source?.batch.stage, "generation");
  assert.equal(source.batch.runId, row.generationRun);
  assert.equal(source.batch.executionSourceCommit, row.deliverySourceCommit);
  const sample = source.summary.samples.find(
    (item) => item.sampleId === row.sampleId,
  );
  assert.ok(sample, "native candidate sample identity required");
  const acceptance = results.native45.results.find(
    (batch) =>
      batch.stage === "acceptance" &&
      batch.runId === row.acceptanceRun &&
      batch.sourceSummaryDigest === row.sourceSummaryDigest,
  );
  assert.ok(acceptance, "bound acceptance summary required");
  const checked = acceptance.samples.find(
    (item) => item.sampleId === row.sampleId,
  );
  assert.equal(checked.candidateAcceptancePassed, true);
  assert.equal(checked.passed, row.endToEndPassed);
  for (const file of row.files) {
    const bytes = read(file.path);
    assert.equal(hash(bytes), file.digest);
    if (file.stage === "generation") {
      assert.ok(
        sample.candidates.some(
          (item) =>
            item.path === file.originalArtifactPath &&
            item.digest === file.digest,
        ),
      );
    } else {
      const stage = [checked.setup, checked.check].find(
        (item) => item.receiptPath === file.originalArtifactPath,
      );
      assert.equal(stage?.receiptDigest, file.digest);
      assert.equal(JSON.parse(bytes).pass, true);
    }
    files++;
  }
}
const current = audit.currentDeclaredRound;
if (fs.existsSync(path.join(root, "native-candidates.json"))) {
  for (const file of json("native-candidates.json").files) {
    const bytes = read(file.path);
    assert.equal(hash(bytes), file.digest);
    assert.equal(bytes.length, file.bytes);
    const source = raw.get(file.sourceSummaryDigest);
    assert.equal(source?.batch.stage, "generation");
    assert.equal(source.batch.runId, file.generationRunId);
    const sample = source.summary.samples.find(
      (row) => row.sampleId === file.sampleId,
    );
    assert.ok(
      sample?.candidates.some(
        (row) =>
          row.path === file.originalArtifactPath && row.digest === file.digest,
      ),
    );
    files++;
  }
}
if (fs.existsSync(path.join(root, "windows-jb-readiness-review.json"))) {
  for (const entry of json("windows-jb-readiness-review.json").nonceRun
    .evidence) {
    const bytes = read(entry.archivedPath);
    assert.equal(hash(bytes), entry.storedDigest);
    assert.equal(hash(gunzipSync(bytes)), entry.sha256);
  }
}
if (fs.existsSync(path.join(root, "windows-archive-proof.json"))) {
  const proof = json("windows-archive-proof.json");
  const bytes = verifyArchive(proof.capturedBefore);
  assert.equal(Object.keys(JSON.parse(bytes)).length, proof.capturedEntries);
  assert.equal(proof.capturedEntries, proof.expectedEntries);
  assert.equal(proof.generationPassed, false);
  const source = raw.get(proof.sourceSummaryDigest);
  assert.equal(source?.batch.stage, "generation");
  assert.equal(source.summary.frozenArchiveDigest, proof.archiveDigest);
}
if (fs.existsSync(path.join(root, "linux-vscode-task-quality-review.json"))) {
  const review = json("linux-vscode-task-quality-review.json");
  assert.ok(raw.has(review.generation.summaryDigest));
  assert.ok(raw.has(review.acceptance.summaryDigest));
  for (const sample of review.samples) {
    assert.equal(
      hash(read(sample.candidate.archivedPath)),
      sample.candidate.digest,
    );
    const receipt = verifyArchive(sample.receipt.archived);
    assert.equal(JSON.parse(receipt).taskId, sample.taskId);
    const accepted = raw
      .get(review.acceptance.summaryDigest)
      .summary.samples.find((row) => row.sampleId === sample.sampleId);
    assert.equal(accepted.check.receiptDigest, sample.receipt.digest);
  }
}
if (fs.existsSync(path.join(root, "windows-jb-task-readiness-review.json"))) {
  const review = json("windows-jb-task-readiness-review.json");
  assert.ok(raw.has(review.summaryDigest));
  for (const entry of review.evidence) verifyArchive(entry.archived);
}
if (fs.existsSync(path.join(root, "windows-jb-latest-readiness-review.json"))) {
  const review = json("windows-jb-latest-readiness-review.json");
  const source = raw.get(review.generationSummary.digest);
  assert.equal(source?.batch.runId, review.generationRunId);
  assert.equal(
    source.batch.executionSourceCommit,
    review.executionSourceCommit,
  );
  const sample = source.summary.samples.find(
    (row) => row.sampleId === review.sampleId,
  );
  assert.equal(sample.host.passed, false);
  assert.deepEqual(sample.broker ?? sample.brokerStatus, review.broker);
  assert.equal(review.broker.physicalRequestsStarted, 0);
  const evidence = new Map();
  for (const entry of review.evidence) {
    const bytes = verifyArchive(entry.archived);
    assert.equal(hash(bytes), entry.digest);
    assert.equal(bytes.length, entry.bytes);
    evidence.set(entry.member, bytes);
  }
  const protocol = evidence.get(review.protocol.member);
  assert.equal(hash(protocol), review.protocol.digest);
  const records = protocol
    .toString("utf8")
    .trim()
    .split(/\r?\n/u)
    .map(JSON.parse);
  assert.deepEqual(records, review.protocol.records);
  assert.equal(records.length, 1);
  assert.equal(records[0].direction, "exit");
  assert.equal(records[0].event.code, 1);
  assert.equal(records[0].event.stdoutDrained, true);
  assert.deepEqual(
    JSON.parse(evidence.get(review.sampleId + "/broker/summary.json")),
    review.broker,
  );
  for (const anchor of review.sourceAnchors) {
    const bytes = verifyArchive(anchor.archived);
    assert.equal(hash(bytes), anchor.digest);
    assert.equal(
      bytes
        .toString("utf8")
        .split(/\r?\n/u)
        .slice(anchor.startLine - 1, anchor.endLine)
        .join("\n"),
      anchor.text,
    );
  }
}
if (results.providerAvailability) {
  const provider = results.providerAvailability;
  assert.equal(hash(read(provider.path)), provider.digest);
  const refusals = json(provider.path);
  const affected = [];
  let accountRecoveryRequired = false;
  for (const row of refusals.records) {
    const source = raw.get(row.sourceSummaryDigest);
    assert.equal(source?.batch.stage, "generation");
    assert.equal(source.batch.runId, row.generationRunId);
    const sample = source.summary.samples.find(
      (item) => item.sampleId === row.sampleId,
    );
    assert.ok(sample, "provider refusal requires original sample identity");
    assert.equal(sample.kind, row.kind);
    assert.equal(sample.taskId, row.taskId);
    assert.equal(source.batch.group, row.group);
    assert.equal(
      source.batch.executionSourceCommit,
      row.generationSourceCommit,
    );
    assert.equal(
      row.currentDeclaredRound,
      current.selection[row.group] === row.generationRunId,
    );
    const receipt = JSON.parse(verifyArchive(row.receipt));
    const body = verifyArchive(row.response);
    assert.equal(receipt.response.status, row.httpStatus);
    assert.equal("sha256:" + receipt.response.storedSha256, hash(body));
    assert.equal(receipt.response.storedBytes, body.length);
    assert.equal(receipt.taskId, row.sampleId);
    assert.equal(receipt.errorCode, "DIAGNOSTIC_NON_200_NO_RETRY");
    const error = JSON.parse(body).error;
    assert.equal(error?.code, row.providerCode);
    assert.equal(error?.message, row.providerMessage);
    assert.equal(row.automaticHttpRetry, false);
    const broker = sample.broker ?? sample.brokerStatus;
    assert.equal(broker.physicalRequestsStarted, row.requestSequence);
    const beforeModel =
      row.requestSequence === 1 && broker.usageCompleteRequests === 0;
    const expectedLabels = {
      providerRefusal: {
        sourceSummaryDigest: row.sourceSummaryDigest,
        generationRunId: row.generationRunId,
        httpStatus: row.httpStatus,
        code: row.providerCode,
        requestSequence: row.requestSequence,
        beforeModelExecution: beforeModel,
      },
      providerExecutionObserved: beforeModel
        ? false
        : broker.usageCompleteRequests > 0
          ? true
          : null,
      executionFailureCategory: "environment-blocked",
    };
    const projected = source.batch.samples.find(
      (item) => item.sampleId === row.sampleId,
    );
    const history = audit.history[row.sampleId].find(
      (item) => item.sourceSummaryDigest === row.sourceSummaryDigest,
    );
    for (const [key, value] of Object.entries(expectedLabels)) {
      assert.deepEqual(projected[key], value);
      assert.deepEqual(history[key], value);
      if (row.currentDeclaredRound) {
        assert.deepEqual(current.samples[row.sampleId][key], value);
        const planned = audit.samples45.find(
          (item) => item.sampleId === row.sampleId,
        );
        assert.deepEqual(planned[key], value);
      }
    }
    assert.ok(history.failureCategories.includes("environment-blocked"));
    assert.ok(history.failureCategories.includes("provider-refused"));
    if (beforeModel)
      assert.ok(
        history.failureCategories.includes("provider-refused-before-model"),
      );
    if (row.currentDeclaredRound) {
      affected.push(row.sampleId);
      accountRecoveryRequired ||= row.providerCode === "AccountOverdueError";
    }
  }
  assert.equal(new Set(affected).size, affected.length);
  assert.deepEqual(refusals.currentAffectedSampleIds, affected);
  assert.deepEqual(provider.currentAffectedSampleIds, affected);
  assert.equal(refusals.accountRecoveryRequired, accountRecoveryRequired);
  assert.equal(provider.accountRecoveryRequired, accountRecoveryRequired);
}
const rows = Object.values(current.samples);
for (const row of rows) {
  const source = raw.get(row.sourceSummaryDigest);
  assert.equal(source?.batch.stage, "generation");
  assert.equal(source.batch.runId, current.selection[row.group]);
  assert.equal(source.batch.executionSourceCommit, row.generationSourceCommit);
  const original = source.summary.samples.find(
    (sample) => sample.sampleId === row.sampleId,
  );
  assert.equal(original?.generationPassed, row.originalGenerationPassed);
  const selected = row.acceptanceAttempts.find(
    (attempt) => attempt.checkerRunId === row.selectedCheckerRunId,
  );
  if (!selected) continue;
  const acceptance = raw.get(selected.summaryDigest);
  assert.equal(acceptance?.batch.stage, "acceptance");
  assert.equal(acceptance.batch.sourceSummaryDigest, row.sourceSummaryDigest);
  const checked = acceptance.summary.samples.find(
    (sample) => sample.sampleId === row.sampleId,
  );
  assert.equal(checked?.generationPassed, row.effectiveGenerationPassed);
  assert.equal(
    checked?.candidateAcceptancePassed,
    row.candidateAcceptancePassed,
  );
  assert.equal(checked?.passed, row.latestAcceptancePassed);
}
assert.equal(audit.samples45.length, 45);
assert.equal(new Set(audit.samples45.map((row) => row.sampleId)).size, 45);
assert.equal(audit.samples45.filter((row) => row.kind === "task").length, 36);
assert.equal(
  audit.samples45.filter((row) => row.kind === "first-run").length,
  9,
);
const counts = results.native45.counts;
assert.equal(counts.generationResultsCollected, rows.length);
assert.equal(
  counts.acceptanceResultsCollected,
  rows.filter((row) => row.acceptanceAttempts.length).length,
);
for (const [kind, prefix] of [
  ["task", "ordinary"],
  ["first-run", "firstRun"],
]) {
  const selected = rows.filter((row) => row.kind === kind);
  assert.equal(
    counts[prefix + "CandidateAcceptancePassed"],
    selected.filter((row) => row.candidateAcceptancePassed).length,
  );
  assert.equal(
    counts[prefix + "EndToEndPassed"],
    selected.filter((row) => row.latestAcceptancePassed).length,
  );
}
assert.equal(results.status === "COMPLETED", current.acceptanceComplete45);
if (results.status === "COMPLETED") {
  assert.equal(rows.length, 45);
  assert.equal(counts.acceptanceResultsCollected, 45);
  assert.equal(current.missingIds.length, 0);
}
assert.deepEqual(results.formalFrozenObservations, { tasks: 0, firstRuns: 0 });
assert.equal(results.billingAssessed, false);
const optimizations = json("optimization-validation.json");
for (const item of optimizations.optimizations) {
  if (item.receipt) verifyArchive(item.receipt);
  if (item.ciValidation?.receipt) verifyArchive(item.ciValidation.receipt);
  for (const test of item.tests || [])
    if (test.rawXml) verifyArchive(test.rawXml);
}
console.log(
  JSON.stringify({
    status: results.status,
    nativeGenerationSummaries: results.native45.results.filter(
      (row) => row.stage === "generation",
    ).length,
    nativeAcceptanceSummaries: results.native45.results.filter(
      (row) => row.stage === "acceptance",
    ).length,
    verifiedDeliveryAndReceiptFiles: files,
    currentCounts: counts,
  }),
);
