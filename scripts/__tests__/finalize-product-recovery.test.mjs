import assert from "node:assert/strict";
import { test } from "node:test";
import { RECOVERY } from "../ci/verify-product-recovery.mjs";
import {
  FINALIZATION,
  auditFinalizationProducer,
  verifyFinalizationEvidence,
} from "../ci/finalize-product-recovery.mjs";

function producer() {
  const run = {
    id: FINALIZATION.runId,
    run_attempt: 1,
    head_sha: FINALIZATION.controllerSha,
    repository: { id: 42, full_name: RECOVERY.repository },
    head_branch: "main",
    path: ".github/workflows/product-release-recovery.yml",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "failure",
  };
  const job = {
    id: FINALIZATION.publisherJobId,
    name: "Verify five-platform provenance and publish complete product",
    run_id: run.id,
    run_attempt: 1,
    head_sha: run.head_sha,
    status: "completed",
    conclusion: "failure",
    started_at: "2026-10-08T06:22:41Z",
    completed_at: "2026-10-08T06:34:17Z",
    steps: [
      "Download original immutable archives and verify all 22 assets",
      "Require current public CLI and both IDE releases",
      "Preserve exact asset receipt and recovery provenance before publication",
    ].map((name) => ({ name, conclusion: "success" })),
  };
  job.steps.push({
    name: "Publish only complete source-bound product through Actions token",
    conclusion: "failure",
  });
  const artifact = {
    id: FINALIZATION.artifactId,
    name: `product-recovery-provenance-${run.id}-1`,
    digest: FINALIZATION.artifactDigest,
    size_in_bytes: FINALIZATION.artifactSize,
    expired: false,
    expires_at: "2099-01-01T00:00:00Z",
    created_at: "2026-10-08T06:32:40Z",
    workflow_run: { id: run.id, head_sha: run.head_sha, repository_id: 42 },
  };
  return { run, jobs: [job], artifacts: [artifact] };
}
test("accepts successful sealed producer steps despite the later publication failure", () => {
  const x = producer();
  assert.equal(
    auditFinalizationProducer(x.run, x.jobs, x.artifacts).id,
    FINALIZATION.artifactId,
  );
});
for (const [name, edit] of [
  ["stale controller", (x) => (x.run.head_sha = RECOVERY.sourceSha)],
  ["another attempt", (x) => (x.run.run_attempt = 2)],
  ["failed aggregate", (x) => (x.jobs[0].steps[0].conclusion = "failure")],
  [
    "skipped prerequisite check",
    (x) => (x.jobs[0].steps[1].conclusion = "skipped"),
  ],
  [
    "replaced proof archive",
    (x) => (x.artifacts[0].digest = `sha256:${"0".repeat(64)}`),
  ],
  ["foreign archive run", (x) => x.artifacts[0].workflow_run.id++],
])
  test(`rejects ${name}`, () => {
    const x = producer();
    edit(x);
    assert.throws(() => auditFinalizationProducer(x.run, x.jobs, x.artifacts));
  });

function evidence() {
  const android = { id: 123, producerAttempt: 1 };
  const original = {
    sourceSha: RECOVERY.sourceSha,
    auditedAt: "2026-10-08T07:00:00Z",
  };
  const assets = Array.from({ length: 22 }, (_, i) => ({
    name: `asset-${i}`,
    size: 42,
    sha256: "a".repeat(64),
  }));
  const provenance = {
    schema: 1,
    ...RECOVERY,
    controllerSha: FINALIZATION.controllerSha,
    recoveryRunId: FINALIZATION.runId,
    recoveryAttempt: 1,
    assetReceiptSha256: FINALIZATION.receiptSha256,
    original: { ...original, auditedAt: "2026-10-08T06:00:00Z" },
    android: {
      artifact: android,
      receipt: {
        schema: 1,
        sourceSha: RECOVERY.sourceSha,
        version: RECOVERY.version,
        controllerSha: FINALIZATION.controllerSha,
        runId: FINALIZATION.runId,
        runAttempt: 1,
        helperSha256: FINALIZATION.helperSha256,
        parserSha256: FINALIZATION.parserSha256,
        assets: assets.slice(0, 4),
      },
    },
  };
  return { provenance, receipt: { assets }, original, android };
}
test("retains original controller provenance while permitting the audit timestamp to advance", () => {
  const x = evidence();
  verifyFinalizationEvidence(
    x.provenance,
    x.receipt,
    FINALIZATION.receiptSha256,
    x.original,
    x.android,
  );
  x.provenance.controllerSha = "f".repeat(40);
  assert.throws(() =>
    verifyFinalizationEvidence(
      x.provenance,
      x.receipt,
      FINALIZATION.receiptSha256,
      x.original,
      x.android,
    ),
  );
});
test("rejects a changed sealed receipt or Android bytes mismatched with the asset receipt", () => {
  const x = evidence();
  assert.throws(
    () =>
      verifyFinalizationEvidence(
        x.provenance,
        x.receipt,
        "0".repeat(64),
        x.original,
        x.android,
      ),
    /Changed sealed receipt/,
  );
  x.receipt.assets = structuredClone(x.receipt.assets);
  x.receipt.assets[0].sha256 = "b".repeat(64);
  assert.throws(() =>
    verifyFinalizationEvidence(
      x.provenance,
      x.receipt,
      FINALIZATION.receiptSha256,
      x.original,
      x.android,
    ),
  );
});
