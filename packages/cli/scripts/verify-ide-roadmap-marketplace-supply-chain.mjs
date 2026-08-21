#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ENVIRONMENTS,
  FAULTS,
  REQUIRED_FILES,
} from "./ide-roadmap-marketplace-supply-chain.mjs";

const SHA_RE = /^[a-f0-9]{40}$/u;
const REQUIRED_OS = Object.freeze(["linux", "darwin", "win32"]);
const SUFFIX_BY_OS = Object.freeze({
  linux: "linux",
  darwin: "macos",
  win32: "windows",
});

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
    "chainlesschain.marketplace-supply-chain-manifest.v1",
  );
  assert.equal(manifest.releaseCommit, expected.releaseCommit);
  assert.equal(manifest.operatingSystem, expected.operatingSystem);
  assert.equal(manifest.environment, expected.environment);
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
  assert.equal(host.environment, expected.environment);
  for (const [key, value] of Object.entries(expected.provenance)) {
    assert.equal(host.provenance[key], value, `${expected.environment}/${key}`);
  }
  const network = documents["network-journeys.json"];
  assert.equal(network.environment, expected.environment);
  assert.equal(network.independentRuns, 100);
  assert.equal(network.registryTls, "private-ca");
  assert.equal(network.authentication, "bearer");
  assert.equal(network.offlineNetworkRequestCount, 0);
  assert.equal(network.archiveTransport, "same-origin-https");
  assert.equal(network.archivePreflightCandidateBytesFetched, false);
  assert.match(network.archivePreflightRevision, /^[a-f0-9]{64}$/u);
  assert.equal(network.sourcePrecedence, "whole-entry-priority");
  assert.equal(network.selectedSourcePriority, 0);
  assert.equal(network.dynamicSourceStatus, "default-disabled");
  assert.equal(network.dynamicSourceProcessStartCount, 0);
  assert.equal(
    network.archiveOnlineFetchCount,
    expected.environment === "air-gapped-cache" ? 0 : 100,
  );
  assert.ok(network.archiveRequestCount >= network.archiveOnlineFetchCount + 2);
  if (expected.environment === "air-gapped-cache") {
    assert.ok(network.authenticatedRequestCount >= 4);
  } else {
    assert.ok(network.authenticatedRequestCount >= 400);
  }
  if (expected.environment === "explicit-proxy") {
    assert.ok(network.proxyConnectCount >= 100);
    assert.ok(network.proxyAuthenticatedConnectCount >= 100);
  } else if (expected.environment === "pac") {
    assert.ok(network.proxyConnectCount >= 100);
  }
  const lifecycle = documents["lifecycle-journeys.json"];
  assert.equal(lifecycle.installCount, 100);
  assert.equal(lifecycle.upgradeCount, 100);
  assert.equal(lifecycle.rollbackCount, 100);
  assert.equal(lifecycle.signatureVerifiedInstallCount, 200);
  assert.equal(lifecycle.rollbackFailureCount, 0);
  assert.equal(lifecycle.unverifiedActivationCount, 0);
  assert.equal(lifecycle.archiveSourceInstallCount, 100);
  assert.equal(
    lifecycle.archiveMaterializationCount,
    expected.environment === "air-gapped-cache" ? 102 : 202,
  );
  const faults = documents["fault-injection.json"];
  assert.deepEqual([...faults.faultsExercised].sort(), [...FAULTS].sort());
  assert.equal(faults.rejectionCount, FAULTS.length);
  assert.equal(faults.unexpectedAcceptanceCount, 0);
  assert.equal(faults.processTerminationCount, 2);
  assert.equal(faults.recoveryFailureCount, 0);
  assert.equal(faults.failureArtifactsComplete, true);
  const cache = documents["cache-authority.json"];
  assert.deepEqual(cache.layers, [
    "registry",
    "signature",
    "public-key",
    "sbom",
    "archive-binary",
    "archive-source",
    "source-package",
  ]);
  assert.equal(cache.offlineReplayCount, 100);
  assert.equal(cache.immutableCacheReadCount, 600);
  assert.equal(cache.sourceCacheReadCount, 100);
  assert.equal(cache.archiveCacheReadCount, 100);
  assert.equal(cache.archiveSourceReadCount, 100);
  assert.equal(cache.archiveCrashRecoveryCount, 1);
  assert.equal(cache.corruptCacheActivationCount, 0);
  assert.equal(cache.unauthorizedCacheFallbackCount, 0);
  const redaction = documents["redaction.json"];
  assert.equal(redaction.scannedJourneyCount, 100);
  for (const field of [
    "credentialLeakCount",
    "privateKeyLeakCount",
    "querySecretLeakCount",
    "dynamicSourceSecretLeakCount",
  ]) {
    assert.equal(redaction[field], 0);
  }
  const outcome = documents["outcome-observations.json"];
  assert.equal(outcome.success, true);
  assert.equal(outcome.independentRuns, 100);
  assert.equal(outcome.failureArtifactsComplete, true);
  assert.equal(outcome.exactCommitBound, true);
  for (const field of [
    "credentialLeakCount",
    "unauthorizedCacheFallbackCount",
    "unverifiedActivationCount",
    "staleAuthorityActivationCount",
    "corruptCacheActivationCount",
    "dependencyConflictActivationCount",
    "sourceSwitchWithoutApprovalCount",
    "revokedKeyActivationCount",
    "offlineNetworkRequestCount",
    "rollbackFailureCount",
    "archiveDigestMismatchAcceptanceCount",
    "dynamicSourceExecutionCount",
    "archivePreflightBypassCount",
  ]) {
    assert.equal(outcome[field], 0);
  }
  return {
    operatingSystem: expected.operatingSystem,
    environment: expected.environment,
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
  const cells = [];
  for (const operatingSystem of REQUIRED_OS) {
    for (const environment of ENVIRONMENTS) {
      const suffix = `${SUFFIX_BY_OS[operatingSystem]}-${environment}`;
      cells.push(
        verifyCell(path.join(path.resolve(options.evidenceRoot), suffix), {
          operatingSystem,
          environment,
          releaseCommit: options.releaseCommit,
          provenance: {
            ...shared,
            job: "supply-chain",
            artifactName: `ide-marketplace-supply-chain-${suffix}-${options.runAttempt}`,
          },
        }),
      );
    }
  }
  const output = {
    schema: "chainlesschain.marketplace-supply-chain-aggregate.v1",
    releaseCommit: options.releaseCommit,
    exactCommitBound: true,
    requiredOperatingSystems: REQUIRED_OS,
    requiredEnvironments: ENVIRONMENTS,
    cellCount: cells.length,
    totalIndependentRuns: cells.length * 100,
    totalInstallUpgradeRollbackOperations: cells.length * 300,
    totalImmutableCacheReadbacks: cells.length * 600,
    totalFaultRejections: cells.length * FAULTS.length,
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
