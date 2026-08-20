#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ENTRYPOINTS,
  REQUIRED_FILES,
} from "./ide-roadmap-context-permission-matrix.mjs";

const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const REQUIRED_OS = Object.freeze(["linux", "darwin", "win32"]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    assert.ok(argv[index]?.startsWith("--") && argv[index + 1]);
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

function verifyCell(directory, expected) {
  assert.equal(fs.existsSync(path.join(directory, "failure.json")), false);
  const manifest = readJson(path.join(directory, "manifest.json"));
  assert.equal(
    manifest.schema,
    "chainlesschain.context-permission-manifest.v1",
  );
  assert.equal(manifest.releaseCommit, expected.releaseCommit);
  assert.equal(manifest.operatingSystem, expected.operatingSystem);
  assert.deepEqual(
    Object.keys(manifest.files).sort(),
    [...REQUIRED_FILES].sort(),
  );
  const documents = {};
  for (const file of REQUIRED_FILES) {
    const bytes = fs.readFileSync(path.join(directory, file));
    assert.equal(manifest.files[file].sha256, digest(bytes));
    assert.equal(manifest.files[file].bytes, bytes.length);
    documents[file] = JSON.parse(bytes.toString("utf8"));
  }
  const exact = documents["exact-commit.json"];
  assert.equal(exact.releaseCommit, expected.releaseCommit);
  assert.equal(exact.exactCommitBound, true);
  const host = documents["host-environment.json"];
  assert.equal(host.releaseCommit, expected.releaseCommit);
  assert.equal(host.operatingSystem, expected.operatingSystem);
  for (const [key, value] of Object.entries(expected.provenance)) {
    assert.equal(
      host.provenance[key],
      value,
      `${expected.operatingSystem}/${key}`,
    );
  }
  const concurrency = documents["concurrency-authority.json"];
  assert.equal(concurrency.addCount, 100);
  assert.equal(concurrency.revokeCount, 100);
  assert.equal(concurrency.finalGeneration, 201);
  for (const field of [
    "lostUpdateCount",
    "duplicateRuleIdCount",
    "staleRevisionAcceptanceCount",
    "managedDenyRelaxationCount",
  ]) {
    assert.equal(concurrency[field], 0);
  }
  assert.match(concurrency.stateDigest || "", DIGEST_RE);
  const faults = documents["fault-injection.json"];
  assert.equal(faults.corruptAuthorityRejectedCount, 1);
  assert.equal(faults.processTerminationCount, 1);
  assert.equal(faults.processTerminationStateDriftCount, 0);
  assert.equal(faults.networkUnknownRecoveryClaimCount, 0);
  assert.equal(faults.failureArtifactsComplete, true);
  const crossEntry = documents["cross-entry-projections.json"];
  assert.deepEqual(
    crossEntry.entrypoints.map((entry) => entry.entrypoint),
    ENTRYPOINTS,
  );
  assert.equal(crossEntry.totalProjectionRuns, ENTRYPOINTS.length * 100);
  for (const entry of crossEntry.entrypoints) {
    assert.equal(entry.independentRuns, 100);
    assert.match(entry.contextDigest || "", DIGEST_RE);
    assert.match(entry.projectionSetDigest || "", DIGEST_RE);
  }
  const redaction = documents["redaction-and-recovery.json"];
  assert.equal(redaction.scannedProjectionCount, ENTRYPOINTS.length * 100);
  for (const field of [
    "credentialValueLeakCount",
    "fullCommandLeakCount",
    "externalResourceRollbackOverclaimCount",
    "deterministicContextMismatchCount",
  ]) {
    assert.equal(redaction[field], 0);
  }
  const outcome = documents["outcome-observations.json"];
  assert.equal(outcome.success, true);
  assert.equal(outcome.concurrentMutationCount, 200);
  assert.equal(outcome.crossEntryProjectionCount, ENTRYPOINTS.length * 100);
  assert.equal(outcome.requiredMeasurementsComplete, true);
  assert.equal(outcome.exactCommitBound, true);
  for (const field of [
    "credentialLeakCount",
    "fullCommandLeakCount",
    "managedDenyRelaxationCount",
    "checkpointRecoveryOverclaimCount",
    "corruptAuthorityAcceptanceCount",
    "orphanProcessCount",
  ]) {
    assert.equal(outcome[field], 0);
  }
  return {
    operatingSystem: expected.operatingSystem,
    manifestDigest: digest(
      fs.readFileSync(path.join(directory, "manifest.json")),
    ),
    outcomeDigest: digest(
      fs.readFileSync(path.join(directory, "outcome-observations.json")),
    ),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assert.match(options.releaseCommit || "", SHA_RE);
  const shared = {
    repository: options.repository,
    workflowRef: options.workflowRef,
    workflowSha: options.workflowSha,
    runId: options.runId,
    runAttempt: options.runAttempt,
    eventName: options.eventName,
  };
  const cells = REQUIRED_OS.map((operatingSystem) => {
    const suffix =
      operatingSystem === "win32"
        ? "windows"
        : operatingSystem === "darwin"
          ? "macos"
          : "linux";
    return verifyCell(path.join(path.resolve(options.evidenceRoot), suffix), {
      operatingSystem,
      releaseCommit: options.releaseCommit,
      provenance: {
        ...shared,
        job: "context-permission",
        artifactName: `ide-context-permission-${suffix}-${options.runAttempt}`,
      },
    });
  });
  const output = {
    schema: "chainlesschain.context-permission-aggregate.v1",
    releaseCommit: options.releaseCommit,
    exactCommitBound: true,
    requiredOperatingSystems: REQUIRED_OS,
    requiredEntrypoints: ENTRYPOINTS,
    totalConcurrentMutations: 600,
    totalCrossEntryProjections: REQUIRED_OS.length * ENTRYPOINTS.length * 100,
    cells,
  };
  fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
  fs.writeFileSync(
    path.resolve(options.output),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { REQUIRED_OS, verifyCell };
