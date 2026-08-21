#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  ENVIRONMENTS,
  FAULTS,
  REQUIRED_FILES,
} from "./ide-roadmap-marketplace-supply-chain.mjs";

const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const REQUIRED_OS = Object.freeze(["linux", "darwin", "win32"]);
const SUFFIX_BY_OS = Object.freeze({
  linux: "linux",
  darwin: "macos",
  win32: "windows",
});
const AUDIT_OS_BY_PLATFORM = Object.freeze({
  linux: "linux",
  darwin: "macos",
  win32: "windows",
});
const AUDIT_FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
const AUDIT_COMMITMENT_ID = "PLUGIN-SOURCE";
const AUDIT_PROFILE_VERSION = "plugin-source-marketplace-supply-chain/v1";
const AUDIT_PRODUCER_PATHS = Object.freeze([
  ".github/workflows/ide-roadmap-marketplace-supply-chain.yml",
  "packages/cli/scripts/ide-roadmap-marketplace-supply-chain.mjs",
  "packages/cli/scripts/verify-ide-roadmap-marketplace-supply-chain.mjs",
  "packages/cli/__tests__/unit/ide-roadmap-marketplace-supply-chain.test.js",
]);
const AUDIT_TEST_IDS = Object.freeze([
  "PLUGIN-SOURCE/marketplace-supply-chain-12-cell",
  "PLUGIN-SOURCE/https-archive-sha256",
  "PLUGIN-SOURCE/source-precedence",
  "PLUGIN-SOURCE/offline-cache-crash-recovery",
  "PLUGIN-SOURCE/auth-redirect-secret-scan",
  "PLUGIN-SOURCE/dynamic-source-default-deny",
  "PLUGIN-SOURCE/exact-head-producer-rehash",
]);
const AUDIT_THRESHOLDS = Object.freeze({
  requiredEnvironmentCount: ENVIRONMENTS.length,
  requiredIndependentRunsPerEnvironment: 100,
  minimumIndependentRuns: ENVIRONMENTS.length * 100,
  minimumInstallUpgradeRollbackOperations: ENVIRONMENTS.length * 300,
  minimumImmutableCacheReadbacks: ENVIRONMENTS.length * 600,
  minimumFaultRejections: ENVIRONMENTS.length * FAULTS.length,
  maximumFailureCount: 0,
  maximumCredentialLeakCount: 0,
  maximumDynamicSourceExecutionCount: 0,
  maximumOfflineNetworkRequestCount: 0,
});
const AUDIT_FRAGMENT_KEYS = Object.freeze([
  "commitmentId",
  "disposition",
  "headSha",
  "measurements",
  "os",
  "outcome",
  "producerDigests",
  "profileVersion",
  "runtime",
  "schema",
  "source",
  "testIds",
  "thresholds",
]);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");

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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertExactKeys(value, keys, scope) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), scope);
}

function gitBytes(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: null,
    shell: false,
    maxBuffer: 128 * 1024 * 1024,
  });
}

function producerDigests(repositoryRoot, releaseCommit) {
  assert.match(releaseCommit || "", SHA_RE);
  const checkedOut = String(gitBytes(repositoryRoot, ["rev-parse", "HEAD"]))
    .trim()
    .toLowerCase();
  assert.equal(checkedOut, releaseCommit, "aggregate checkout must be exact");
  return Object.fromEntries(
    AUDIT_PRODUCER_PATHS.map((sourcePath) => {
      const committedBytes = gitBytes(repositoryRoot, [
        "cat-file",
        "blob",
        `${releaseCommit}:${sourcePath}`,
      ]);
      const workingBytes = fs.readFileSync(
        path.join(repositoryRoot, ...sourcePath.split("/")),
      );
      const committedDigest = digest(committedBytes);
      assert.equal(
        digest(workingBytes),
        committedDigest,
        `producer source differs from exact head: ${sourcePath}`,
      );
      return [sourcePath, committedDigest];
    }),
  );
}

function auditSource(options) {
  const source = {
    workflowId: options.workflowRef,
    runId: String(options.runId || ""),
    jobId: options.jobId,
    artifactName: options.aggregateArtifactName,
  };
  assert.match(
    source.workflowId || "",
    /^[^\s]+\/\.github\/workflows\/[^@\s]+\.ya?ml@(?:refs\/[^\s]+|[a-f0-9]{40})$/u,
    "audit source must use a GitHub workflow ref",
  );
  assert.match(source.runId, /^[1-9][0-9]{0,31}$/u);
  assert.match(source.jobId || "", /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u);
  assert.ok(
    source.artifactName &&
      source.artifactName.length <= 255 &&
      !/[\\/]/u.test(source.artifactName),
  );
  return source;
}

function buildPluginSourceAuditFragments(cells, options) {
  assert.match(options.releaseCommit || "", SHA_RE);
  const exactProducerDigests = options.producerDigests;
  assert.deepEqual(
    Object.keys(exactProducerDigests || {}).sort(),
    [...AUDIT_PRODUCER_PATHS].sort(),
  );
  for (const value of Object.values(exactProducerDigests)) {
    assert.match(value, DIGEST_RE);
  }
  const source = auditSource(options);
  return REQUIRED_OS.map((operatingSystem) => {
    const operatingSystemCells = cells
      .filter((cell) => cell.operatingSystem === operatingSystem)
      .sort((left, right) => left.environment.localeCompare(right.environment));
    assert.deepEqual(
      operatingSystemCells.map((cell) => cell.environment).sort(),
      [...ENVIRONMENTS].sort(),
      `${operatingSystem} required environments`,
    );
    const runtimeVersions = new Set(
      operatingSystemCells.map((cell) => cell.runtime.version),
    );
    const runtimeArchitectures = new Set(
      operatingSystemCells.map((cell) => cell.runtime.arch),
    );
    assert.equal(runtimeVersions.size, 1, `${operatingSystem} Node version`);
    assert.equal(
      runtimeArchitectures.size,
      1,
      `${operatingSystem} runtime architecture`,
    );
    const sum = (field) =>
      operatingSystemCells.reduce(
        (total, cell) => total + cell.measurements[field],
        0,
      );
    const measurements = {
      environmentCount: operatingSystemCells.length,
      independentRuns: sum("independentRuns"),
      installUpgradeRollbackOperations: sum("installUpgradeRollbackOperations"),
      immutableCacheReadbacks: sum("immutableCacheReadbacks"),
      faultRejections: sum("faultRejections"),
      failureCount: sum("failureCount"),
      credentialLeakCount: sum("credentialLeakCount"),
      dynamicSourceExecutionCount: sum("dynamicSourceExecutionCount"),
      offlineNetworkRequestCount: sum("offlineNetworkRequestCount"),
      cells: operatingSystemCells.map((cell) => ({
        environment: cell.environment,
        manifestDigest: cell.manifestDigest,
        outcomeDigest: cell.outcomeDigest,
      })),
    };
    assert.ok(
      measurements.independentRuns >= AUDIT_THRESHOLDS.minimumIndependentRuns,
    );
    assert.ok(
      measurements.installUpgradeRollbackOperations >=
        AUDIT_THRESHOLDS.minimumInstallUpgradeRollbackOperations,
    );
    assert.ok(
      measurements.immutableCacheReadbacks >=
        AUDIT_THRESHOLDS.minimumImmutableCacheReadbacks,
    );
    assert.ok(
      measurements.faultRejections >= AUDIT_THRESHOLDS.minimumFaultRejections,
    );
    for (const [measurement, threshold] of [
      ["failureCount", "maximumFailureCount"],
      ["credentialLeakCount", "maximumCredentialLeakCount"],
      ["dynamicSourceExecutionCount", "maximumDynamicSourceExecutionCount"],
      ["offlineNetworkRequestCount", "maximumOfflineNetworkRequestCount"],
    ]) {
      assert.ok(measurements[measurement] <= AUDIT_THRESHOLDS[threshold]);
    }
    return {
      schema: AUDIT_FRAGMENT_SCHEMA,
      commitmentId: AUDIT_COMMITMENT_ID,
      headSha: options.releaseCommit,
      os: AUDIT_OS_BY_PLATFORM[operatingSystem],
      runtime: {
        name: "node",
        version: [...runtimeVersions][0].replace(/^v/u, ""),
        arch: [...runtimeArchitectures][0],
      },
      profileVersion: AUDIT_PROFILE_VERSION,
      thresholds: AUDIT_THRESHOLDS,
      measurements,
      testIds: AUDIT_TEST_IDS,
      producerDigests: exactProducerDigests,
      disposition: "required",
      source,
      outcome: "passed",
    };
  });
}

function verifyPluginSourceAuditFragments(fragments, expected) {
  const requiredByOs = new Map();
  for (const fragment of fragments) {
    assertExactKeys(fragment, AUDIT_FRAGMENT_KEYS, "audit fragment keys");
    assert.equal(fragment.schema, AUDIT_FRAGMENT_SCHEMA);
    assert.equal(fragment.commitmentId, AUDIT_COMMITMENT_ID);
    assert.equal(fragment.headSha, expected.releaseCommit);
    assert.ok(Object.values(AUDIT_OS_BY_PLATFORM).includes(fragment.os));
    assert.ok(["required", "advisory"].includes(fragment.disposition));
    assert.ok(["passed", "failed"].includes(fragment.outcome));
    assertExactKeys(fragment.runtime, ["arch", "name", "version"], "runtime");
    assert.equal(fragment.runtime.name, "node");
    assert.ok(fragment.runtime.version);
    assert.ok(fragment.runtime.arch);
    assert.equal(fragment.profileVersion, AUDIT_PROFILE_VERSION);
    assert.equal(
      canonicalJson(fragment.thresholds),
      canonicalJson(AUDIT_THRESHOLDS),
    );
    assert.deepEqual(fragment.testIds, AUDIT_TEST_IDS);
    assert.deepEqual(fragment.producerDigests, expected.producerDigests);
    assert.deepEqual(fragment.source, expected.source);
    assert.equal(fragment.measurements.environmentCount, ENVIRONMENTS.length);
    assert.equal(fragment.measurements.failureCount, 0);
    assert.equal(fragment.measurements.credentialLeakCount, 0);
    assert.equal(fragment.measurements.dynamicSourceExecutionCount, 0);
    assert.equal(fragment.measurements.offlineNetworkRequestCount, 0);
    assert.equal(fragment.measurements.cells.length, ENVIRONMENTS.length);
    for (const cell of fragment.measurements.cells) {
      assert.ok(ENVIRONMENTS.includes(cell.environment));
      assert.match(cell.manifestDigest, DIGEST_RE);
      assert.match(cell.outcomeDigest, DIGEST_RE);
    }
    if (fragment.disposition === "required") {
      assert.equal(fragment.outcome, "passed");
      assert.equal(
        requiredByOs.has(fragment.os),
        false,
        `duplicate required audit cell ${fragment.os}`,
      );
      requiredByOs.set(fragment.os, fragment);
    }
  }
  const missing = Object.values(AUDIT_OS_BY_PLATFORM).filter(
    (operatingSystem) => !requiredByOs.has(operatingSystem),
  );
  assert.deepEqual(missing, [], `missing required audit cells: ${missing}`);
  assert.equal(requiredByOs.size, REQUIRED_OS.length);
  return [...requiredByOs.values()];
}

function rehashPluginSourceAuditFragments(directory, expected) {
  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const records = files.map((file) => {
    const bytes = fs.readFileSync(path.join(directory, file));
    return {
      file,
      sha256: digest(bytes),
      fragment: JSON.parse(bytes.toString("utf8")),
    };
  });
  verifyPluginSourceAuditFragments(
    records.map((record) => record.fragment),
    expected,
  );
  return records.map(({ file, sha256, fragment }) => ({
    os: fragment.os,
    disposition: fragment.disposition,
    file,
    sha256,
  }));
}

function writePluginSourceAuditFragments(directory, fragments, expected) {
  fs.mkdirSync(directory, { recursive: true });
  for (const fragment of fragments) {
    const file = path.join(directory, `plugin-source-${fragment.os}.json`);
    fs.writeFileSync(file, `${JSON.stringify(fragment, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }
  return rehashPluginSourceAuditFragments(directory, expected);
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
  assert.match(host.nodeVersion || "", /^v[0-9]+\.[0-9]+\.[0-9]+/u);
  assert.match(host.architecture || "", /^[A-Za-z0-9._-]+$/u);
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
    runtime: {
      name: "node",
      version: host.nodeVersion,
      arch: host.architecture,
    },
    measurements: {
      independentRuns: outcome.independentRuns,
      installUpgradeRollbackOperations:
        lifecycle.installCount +
        lifecycle.upgradeCount +
        lifecycle.rollbackCount,
      immutableCacheReadbacks: cache.immutableCacheReadCount,
      faultRejections: faults.rejectionCount,
      failureCount:
        faults.unexpectedAcceptanceCount +
        faults.recoveryFailureCount +
        outcome.rollbackFailureCount +
        outcome.archiveDigestMismatchAcceptanceCount +
        outcome.archivePreflightBypassCount,
      credentialLeakCount: outcome.credentialLeakCount,
      dynamicSourceExecutionCount: outcome.dynamicSourceExecutionCount,
      offlineNetworkRequestCount: outcome.offlineNetworkRequestCount,
    },
    manifestDigest: digest(
      fs.readFileSync(path.join(directory, "manifest.json")),
    ),
    outcomeDigest: digest(
      fs.readFileSync(path.join(directory, "outcome-observations.json")),
    ),
  };
}

function aggregateSupplyChainEvidence(options, dependencies = {}) {
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
  const exactProducerDigests = (
    dependencies.producerDigests || producerDigests
  )(dependencies.repositoryRoot || REPOSITORY_ROOT, options.releaseCommit);
  const source = auditSource(options);
  const fragments = buildPluginSourceAuditFragments(cells, {
    ...options,
    producerDigests: exactProducerDigests,
  });
  verifyPluginSourceAuditFragments(fragments, {
    releaseCommit: options.releaseCommit,
    producerDigests: exactProducerDigests,
    source,
  });
  assert.ok(options.fragmentDir, "--fragment-dir is required");
  const fragmentRecords = writePluginSourceAuditFragments(
    path.resolve(options.fragmentDir),
    fragments,
    {
      releaseCommit: options.releaseCommit,
      producerDigests: exactProducerDigests,
      source,
    },
  );
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
    auditFragments: fragmentRecords,
  };
  fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
  fs.writeFileSync(
    path.resolve(options.output),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );
  return { fragments, fragmentRecords, output };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  aggregateSupplyChainEvidence(options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

export {
  AUDIT_COMMITMENT_ID,
  AUDIT_FRAGMENT_SCHEMA,
  AUDIT_PRODUCER_PATHS,
  AUDIT_PROFILE_VERSION,
  AUDIT_TEST_IDS,
  AUDIT_THRESHOLDS,
  REQUIRED_OS,
  aggregateSupplyChainEvidence,
  buildPluginSourceAuditFragments,
  producerDigests,
  rehashPluginSourceAuditFragments,
  verifyCell,
  verifyPluginSourceAuditFragments,
  writePluginSourceAuditFragments,
};
