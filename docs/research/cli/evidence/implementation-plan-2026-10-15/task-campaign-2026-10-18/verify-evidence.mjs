import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const read = (relative) => {
  const target = path.resolve(root, relative);
  assert.ok(target.startsWith(root), "evidence path outside report root");
  assert.ok(fs.lstatSync(target).isFile(), "regular evidence file required");
  return fs.readFileSync(target);
};
const json = (relative) => JSON.parse(read(relative).toString("utf8"));
const results = json("results.json");
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
  assert.equal(summary.executionSourceCommit, batch.executionSourceCommit);
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
