#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const REQUIRED_TRANSPORTS = Object.freeze(["wsl", "container", "ssh"]);
const REQUIRED_FILES = Object.freeze([
  "bootstrap.json",
  "reconnect-prepared.json",
  "network-fault.json",
  "reconnect-completed.json",
  "campaign.json",
  "outcome-observations.json",
  "exact-commit.json",
  "provenance.json",
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    assert.ok(
      argv[index]?.startsWith("--") && argv[index + 1],
      `invalid argument: ${argv[index]}`,
    );
    options[
      argv[index]
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = argv[index + 1];
  }
  return options;
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrajectory(trajectory, { reconnect }) {
  assert.equal(
    trajectory.schema,
    "chainlesschain.execution-location-trajectory.v1",
  );
  for (const field of [
    "sessionIdDigest",
    "sourceHeadDigest",
    "attestationDigest",
    "targetHandoffAttestationDigest",
    "targetFactsDigest",
    "handoffId",
    "resumeDigest",
    "collectionDigest",
    "settlementDigest",
    "reviewDigest",
    "importDigest",
  ]) {
    assert.match(trajectory[field] || "", DIGEST_RE, `invalid ${field}`);
  }
  assert.notEqual(
    trajectory.targetHandoffAttestationDigest,
    trajectory.attestationDigest,
    "target prepare attestation must be fresh",
  );
  if (reconnect)
    assert.match(trajectory.reconnectResumeDigest || "", DIGEST_RE);
  else assert.equal(trajectory.reconnectResumeDigest, null);
  assert.equal(trajectory.launchCount, 1);
  assert.equal(trajectory.resumeCount, reconnect ? 2 : 1);
  assert.equal(trajectory.reconnectCount, reconnect ? 1 : 0);
  for (const field of [
    "resultCollectCount",
    "resultReviewCount",
    "resultImportCount",
  ]) {
    assert.equal(trajectory[field], 1);
  }
  for (const field of [
    "secretTransferCount",
    "silentFallbackCount",
    "duplicateHandoffCount",
    "duplicateResultSettlementCount",
  ]) {
    assert.equal(trajectory[field], 0);
  }
}

function verifyCell(directory, expected) {
  assert.equal(
    fs.existsSync(path.join(directory, "failure.json")),
    false,
    `${expected.transport} contains failure evidence`,
  );
  const manifest = readJson(path.join(directory, "manifest.json"));
  assert.equal(
    manifest.schema,
    "chainlesschain.execution-location-manifest.v1",
  );
  assert.equal(manifest.releaseCommit, expected.releaseCommit);
  assert.equal(manifest.transport, expected.transport);
  assert.deepEqual(
    Object.keys(manifest.files).sort(),
    [...REQUIRED_FILES].sort(),
  );
  const documents = {};
  for (const file of REQUIRED_FILES) {
    const bytes = fs.readFileSync(path.join(directory, file));
    assert.equal(
      manifest.files[file].sha256,
      digest(bytes),
      `${file} digest drift`,
    );
    assert.equal(
      manifest.files[file].bytes,
      bytes.length,
      `${file} size drift`,
    );
    documents[file] = JSON.parse(bytes.toString("utf8"));
  }

  assert.deepEqual(documents["exact-commit.json"], {
    schema: "chainlesschain.execution-location-exact-commit.v1",
    releaseCommit: expected.releaseCommit,
    exactCommitBound: true,
  });
  const provenance = documents["provenance.json"];
  assert.equal(provenance.releaseCommit, expected.releaseCommit);
  assert.equal(provenance.transport, expected.transport);
  for (const [key, value] of Object.entries(expected.provenance)) {
    assert.equal(provenance[key], value, `${expected.transport}/${key} drift`);
  }

  const prepared = documents["reconnect-prepared.json"];
  assert.equal(prepared.prepared, true);
  assert.equal(prepared.transport, expected.transport);
  for (const field of [
    "sessionIdDigest",
    "targetFactsDigest",
    "handoffId",
    "resumeDigest",
  ]) {
    assert.match(prepared[field] || "", DIGEST_RE);
  }
  const fault = documents["network-fault.json"];
  assert.equal(fault.injectedOutageCount, 1);
  assert.equal(fault.unavailableProbeFailureCount, 1);
  assert.equal(fault.unavailableProbeSuccessCount, 0);
  assert.equal(fault.credentialLeakCount, 0);
  assert.match(fault.diagnostic?.messageDigest || "", DIGEST_RE);

  const reconnect = documents["reconnect-completed.json"].trajectory;
  assertTrajectory(reconnect, { reconnect: true });
  const campaign = documents["campaign.json"];
  assert.equal(campaign.iterations, 99);
  assert.equal(campaign.trajectories.length, 99);
  for (const trajectory of campaign.trajectories) {
    assertTrajectory(trajectory, { reconnect: false });
  }

  const outcome = documents["outcome-observations.json"];
  assert.equal(outcome.success, true);
  assert.equal(outcome.exactCommitBound, true);
  assert.equal(outcome.trajectoryCount, 100);
  assert.equal(outcome.launchCount, 100);
  assert.equal(outcome.resumeCount, 101);
  assert.equal(outcome.reconnectCount, 1);
  assert.equal(outcome.resultCollectCount, 100);
  assert.equal(outcome.resultReviewCount, 100);
  assert.equal(outcome.resultImportCount, 100);
  assert.equal(outcome.injectedOutageCount, 1);
  assert.equal(outcome.unavailableProbeFailureCount, 1);
  for (const field of [
    "secretTransferCount",
    "silentFallbackCount",
    "duplicateHandoffCount",
    "duplicateResultSettlementCount",
    "staleAuthorityAcceptanceCount",
    "orphanProcessCount",
  ]) {
    assert.equal(
      outcome[field],
      0,
      `${expected.transport}/${field} must be zero`,
    );
  }
  return {
    transport: expected.transport,
    manifestDigest: digest(
      fs.readFileSync(path.join(directory, "manifest.json")),
    ),
    outcomeDigest: digest(
      fs.readFileSync(path.join(directory, "outcome-observations.json")),
    ),
    trajectoryCount: outcome.trajectoryCount,
  };
}

function writeOutput(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assert.match(options.releaseCommit || "", SHA_RE);
  assert.ok(options.evidenceRoot && options.output);
  const shared = {
    repository: options.repository,
    workflowRef: options.workflowRef,
    workflowSha: options.workflowSha,
    runId: options.runId,
    runAttempt: options.runAttempt,
    eventName: options.eventName,
  };
  const cells = REQUIRED_TRANSPORTS.map((transport) => {
    const job = `${transport}-execution-location`;
    const artifactName = `ide-execution-location-${transport}-${options.runAttempt}`;
    return verifyCell(
      path.join(path.resolve(options.evidenceRoot), transport),
      {
        transport,
        releaseCommit: options.releaseCommit,
        provenance: { ...shared, job, artifactName },
      },
    );
  });
  writeOutput(path.resolve(options.output), {
    schema: "chainlesschain.execution-location-aggregate.v1",
    releaseCommit: options.releaseCommit,
    exactCommitBound: true,
    requiredCells: REQUIRED_TRANSPORTS,
    totalTrajectories: cells.reduce(
      (total, cell) => total + cell.trajectoryCount,
      0,
    ),
    cells,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { REQUIRED_FILES, REQUIRED_TRANSPORTS, assertTrajectory, verifyCell };
