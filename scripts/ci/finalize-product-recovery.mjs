#!/usr/bin/env node
// Finalize one already uploaded draft without rebuilding or uploading any asset.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RECOVERY,
  auditOriginal,
  auditRecoveryAndroid,
  controllerIdentity,
  downloadArtifact,
  github,
  hashFile,
  originalSnapshot,
  pages,
  requireArtifact,
  verifyPublicPrerequisites,
  verifyReleaseIdentity,
} from "./verify-product-recovery.mjs";

export const FINALIZATION = Object.freeze({
  runId: 37734804421,
  attempt: 1,
  controllerSha: "1d513941391d666579bd173f9b88300f9827416f",
  publisherJobId: 113179530991,
  releaseId: 406493867,
  artifactId: 11532229476,
  artifactSize: 7839,
  artifactDigest:
    "sha256:ef2c6b8d0624d1eb84a1f63792d7c7a57d62427b294f058c7f6b007ec4c9112c",
  receiptSha256:
    "64e2f46b59ce8aee86b63a0e51636156ac0e2d7b97861e35e31c79640c247790",
  helperSha256:
    "7b2df03f38bd6cdc6423077dc9cab73de7acf35c008d48b82c045d4568ae314c",
  parserSha256:
    "7fb131577355155a327b29d6fd4a9e730efbcae37d715ffd73b933d86726c907",
});
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) =>
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const requireStep = (job, name, conclusion = "success") => {
  const steps = job.steps.filter((s) => s.name === name);
  assert.equal(steps.length, 1, `Missing or ambiguous producer step: ${name}`);
  assert.equal(
    steps[0].conclusion,
    conclusion,
    `Producer step failed: ${name}`,
  );
};

export function auditFinalizationProducer(run, jobs, artifacts) {
  assert.equal(run.id, FINALIZATION.runId);
  assert.equal(run.run_attempt, FINALIZATION.attempt);
  assert.equal(run.head_sha, FINALIZATION.controllerSha);
  assert.equal(run.repository?.full_name, RECOVERY.repository);
  assert.equal(run.head_branch, "main");
  assert.equal(run.path, ".github/workflows/product-release-recovery.yml");
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "failure");
  const publishers = jobs.filter((j) => j.id === FINALIZATION.publisherJobId);
  assert.equal(publishers.length, 1);
  const job = publishers[0];
  assert.equal(
    job.name,
    "Verify five-platform provenance and publish complete product",
  );
  assert.equal(job.run_id, FINALIZATION.runId);
  assert.equal(job.run_attempt, FINALIZATION.attempt);
  assert.equal(job.head_sha, FINALIZATION.controllerSha);
  assert.equal(job.status, "completed");
  assert.equal(job.conclusion, "failure");
  for (const name of [
    "Download original immutable archives and verify all 22 assets",
    "Require current public CLI and both IDE releases",
    "Preserve exact asset receipt and recovery provenance before publication",
  ])
    requireStep(job, name);
  requireStep(
    job,
    "Publish only complete source-bound product through Actions token",
    "failure",
  );
  const artifact = requireArtifact(
    artifacts,
    `product-recovery-provenance-${FINALIZATION.runId}-1`,
    run,
    job,
  );
  assert.equal(artifact.id, FINALIZATION.artifactId);
  assert.equal(artifact.sizeInBytes, FINALIZATION.artifactSize);
  assert.equal(artifact.digest, FINALIZATION.artifactDigest);
  return artifact;
}

export function verifyFinalizationEvidence(
  provenance,
  receipt,
  receiptHash,
  original,
  android,
) {
  for (const [key, value] of Object.entries(RECOVERY))
    assert.equal(provenance[key], value, key);
  assert.equal(provenance.schema, 1);
  assert.equal(provenance.controllerSha, FINALIZATION.controllerSha);
  assert.equal(provenance.recoveryRunId, FINALIZATION.runId);
  assert.equal(provenance.recoveryAttempt, FINALIZATION.attempt);
  assert.equal(
    receiptHash,
    FINALIZATION.receiptSha256,
    "Changed sealed receipt",
  );
  assert.equal(provenance.assetReceiptSha256, receiptHash);
  // A new audit has a new timestamp; all source and producer identities stay exact.
  const { auditedAt: previousTime, ...previousAudit } = provenance.original;
  const { auditedAt: currentTime, ...currentAudit } = original;
  assert.ok(previousTime && currentTime);
  assert.deepEqual(previousAudit, currentAudit);
  assert.deepEqual(provenance.android.artifact, android);
  const built = provenance.android.receipt;
  assert.equal(built.schema, 1);
  assert.equal(built.sourceSha, RECOVERY.sourceSha);
  assert.equal(built.version, RECOVERY.version);
  assert.equal(built.controllerSha, FINALIZATION.controllerSha);
  assert.equal(built.runId, FINALIZATION.runId);
  assert.equal(built.runAttempt, FINALIZATION.attempt);
  assert.equal(built.helperSha256, FINALIZATION.helperSha256);
  assert.equal(built.parserSha256, FINALIZATION.parserSha256);
  assert.equal(receipt.assets.length, 22);
  for (const asset of built.assets) {
    const actual = receipt.assets.filter((a) => a.name === asset.name);
    assert.equal(actual.length, 1);
    assert.deepEqual(
      { name: actual[0].name, size: actual[0].size, sha256: actual[0].sha256 },
      asset,
    );
  }
  assert.equal(built.assets.length, 4);
}

function tagSha(source) {
  const refs = execFileSync(
    "git",
    [
      "ls-remote",
      "origin",
      `refs/tags/${RECOVERY.version}`,
      `refs/tags/${RECOVERY.version}^{}`,
    ],
    { cwd: source, encoding: "utf8" },
  ).trim();
  const lines = refs ? refs.split("\n") : [];
  return lines.length
    ? (lines.find((line) => line.endsWith("^{}")) || lines[0]).split(/\s/)[0]
    : null;
}
function checkRelease(source, receipt, release, published) {
  assert.equal(release.id, FINALIZATION.releaseId, "Different release ID");
  assert.equal(release.target_commitish, RECOVERY.sourceSha);
  assert.equal(release.author?.login, "github-actions[bot]");
  assert.ok(
    release.assets.every((a) => a.uploader?.login === "github-actions[bot]"),
  );
  verifyReleaseIdentity(release, tagSha(source), published);
  createRequire(import.meta.url)(
    path.join(source, "scripts/verify-product-release-assets.cjs"),
  ).verifyRemoteAssets(receipt, release, RECOVERY.version, RECOVERY.sourceSha);
}
async function prepare(source, output) {
  controllerIdentity(source);
  assert.equal(process.env.GITHUB_WORKFLOW, "Finalize product v5.0.3.140");
  fs.mkdirSync(output, { recursive: true });
  const [snapshot, run, jobs, artifacts] = await Promise.all([
    originalSnapshot(),
    github(`actions/runs/${FINALIZATION.runId}`),
    pages(`actions/runs/${FINALIZATION.runId}/attempts/1/jobs`, "jobs"),
    pages(`actions/runs/${FINALIZATION.runId}/artifacts`, "artifacts"),
  ]);
  const original = auditOriginal(snapshot);
  const artifact = auditFinalizationProducer(run, jobs, artifacts);
  const android = auditRecoveryAndroid(
    run,
    jobs,
    artifacts,
    FINALIZATION.controllerSha,
    1,
  );
  // This downloads only the pinned 7.8 KB proof ZIP, never the product archives.
  const directory = await downloadArtifact(artifact, output);
  const files = fs.readdirSync(directory).sort();
  assert.deepEqual(files, [
    "jetbrains-public.json",
    "open-vsx-public.json",
    "product-recovery-provenance.json",
    "product-release-assets.json",
    "public-cli.json",
  ]);
  const provenance = read(
    path.join(directory, "product-recovery-provenance.json"),
  );
  const receipt = read(path.join(directory, "product-release-assets.json"));
  verifyFinalizationEvidence(
    provenance,
    receipt,
    hashFile(path.join(directory, "product-release-assets.json")),
    original,
    android,
  );
  assert.deepEqual(
    provenance.publicPrerequisites,
    verifyPublicPrerequisites(directory),
  );
  for (const file of files)
    fs.copyFileSync(
      path.join(directory, file),
      path.join(output, file),
      fs.constants.COPYFILE_EXCL,
    );
  const release = await github(`releases/${FINALIZATION.releaseId}`);
  checkRelease(source, receipt, release, !release.draft);
  write(path.join(output, "draft-readback.json"), release);
  write(path.join(output, "finalization-audit.json"), {
    schema: 1,
    sourceSha: RECOVERY.sourceSha,
    controllerSha: process.env.GITHUB_SHA,
    runId: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    originalControllerSha: FINALIZATION.controllerSha,
    artifact,
    original,
    android,
    receiptSha256: FINALIZATION.receiptSha256,
    releaseId: FINALIZATION.releaseId,
  });
}
async function publish(source, output) {
  controllerIdentity(source);
  assert.equal(process.env.GITHUB_WORKFLOW, "Finalize product v5.0.3.140");
  const audit = read(path.join(output, "finalization-audit.json"));
  assert.equal(audit.controllerSha, process.env.GITHUB_SHA);
  assert.equal(audit.runId, Number(process.env.GITHUB_RUN_ID));
  assert.equal(audit.attempt, Number(process.env.GITHUB_RUN_ATTEMPT));
  assert.equal(
    audit.receiptSha256,
    hashFile(path.join(output, "product-release-assets.json")),
  );
  assert.equal(audit.receiptSha256, FINALIZATION.receiptSha256);
  const receipt = read(path.join(output, "product-release-assets.json"));
  const freshPrerequisites = verifyPublicPrerequisites(output);
  write(
    path.join(output, "fresh-public-prerequisites.json"),
    freshPrerequisites,
  );
  let release = await github(`releases/${FINALIZATION.releaseId}`);
  checkRelease(source, receipt, release, !release.draft);
  write(path.join(output, "before-finalization.json"), release);
  if (release.draft) {
    assert.equal(
      process.env.RECOVERY_PUBLISH,
      "true",
      "Publication was not requested",
    );
    write(path.join(output, "publication-status.json"), {
      stage: "patch-started",
      releaseId: FINALIZATION.releaseId,
    });
    const response = await fetch(
      `https://api.github.com/repos/${RECOVERY.repository}/releases/${FINALIZATION.releaseId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ draft: false }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    const responseText = await response.text();
    let body;
    try {
      body = JSON.parse(responseText);
    } catch {
      body = {
        message: `Non-JSON API response (${response.headers.get("content-type") || "unknown content type"})`,
      };
    }
    write(path.join(output, "publication-status.json"), {
      stage: "patch-returned",
      status: response.status,
      releaseId: FINALIZATION.releaseId,
      ...(response.ok
        ? {}
        : {
            message: body.message,
            documentationUrl: body.documentation_url,
            errors: body.errors,
          }),
    });
    assert.ok(
      response.ok,
      `Release PATCH: HTTP ${response.status}: ${body.message || "request failed"}`,
    );
    write(path.join(output, "patch-readback.json"), body);
  }
  release = await github(`releases/${FINALIZATION.releaseId}`);
  write(path.join(output, "public-readback-by-id.json"), release);
  checkRelease(source, receipt, release, true);
  const publicRelease = await github(`releases/tags/${RECOVERY.version}`);
  write(path.join(output, "public-readback.json"), publicRelease);
  checkRelease(source, receipt, publicRelease, true);
  write(path.join(output, "publication-status.json"), {
    stage: "complete",
    releaseId: FINALIZATION.releaseId,
    tag: RECOVERY.version,
    sourceSha: RECOVERY.sourceSha,
    immutable: true,
    verifiedAssets: 22,
  });
}
async function main() {
  const [mode, sourceArg, outputArg] = process.argv.slice(2);
  const source = path.resolve(sourceArg),
    output = path.resolve(outputArg);
  if (mode === "prepare") await prepare(source, output);
  else if (mode === "publish") await publish(source, output);
  else throw new Error(`Unknown finalization command: ${mode}`);
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
