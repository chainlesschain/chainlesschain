#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const REQUIRED_TRANSPORTS = Object.freeze(["local", "wsl", "container", "ssh"]);
const REQUIRED_REMOTE_TRANSPORTS = Object.freeze(["wsl", "container", "ssh"]);
const REQUIRED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
const PLATFORM_BY_OS = Object.freeze({
  linux: "linux",
  macos: "darwin",
  windows: "win32",
});
const AUDIT_FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
const PROFILE_VERSION = "location-drain-v1";
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
const PRODUCER_PATHS = Object.freeze([
  ".github/scripts/ide-roadmap-execution-location-target.sh",
  ".github/scripts/run-ide-roadmap-execution-location-linux.sh",
  ".github/scripts/run-ide-roadmap-execution-location-local.mjs",
  ".github/scripts/run-ide-roadmap-execution-location-wsl.ps1",
  ".github/workflows/ide-roadmap-execution-location.yml",
  "packages/cli/scripts/ide-roadmap-execution-location-matrix.mjs",
  "packages/cli/scripts/verify-ide-roadmap-execution-location.mjs",
  "packages/cli/src/commands/session-location.js",
  "packages/cli/src/harness/jsonl-session-store.js",
  "packages/cli/src/lib/execution-location-local-supervisor.mjs",
  "packages/cli/src/lib/execution-location-runner-lifecycle.js",
  "packages/cli/src/lib/execution-location-target-preflight.js",
  "packages/cli/src/lib/execution-location-target.js",
  "packages/cli/src/lib/process-execution-broker/credential-agent.js",
]);
const THRESHOLDS = Object.freeze({
  requiredOperatingSystems: REQUIRED_OPERATING_SYSTEMS,
  requiredTargets: REQUIRED_TRANSPORTS,
  minimumTrajectoriesPerCell: 100,
  requiredRemoteResourceKinds: Object.freeze(["cpu", "memory"]),
  requiredUnsupportedSigtermCells: Object.freeze(["local-windows"]),
  minimumGracefulSigtermCells: 5,
  minimumSourceFencedDrainCells: 6,
  maximumUnexpectedUnsupportedSigtermCells: 0,
  maximumStaleAuthorityAcceptances: 0,
  maximumSecretTransfers: 0,
  maximumOrphanProcesses: 0,
});
const TEST_IDS = Object.freeze([
  "LOCATION-DRAIN/local-production-trajectory-x100",
  "LOCATION-DRAIN/wsl-production-trajectory-x100",
  "LOCATION-DRAIN/container-production-trajectory-x100",
  "LOCATION-DRAIN/strict-ssh-production-trajectory-x100",
  "LOCATION-DRAIN/sigterm-lost-poll-token-rotation-checkout-result-return",
  "LOCATION-DRAIN/remote-target-cpu-memory-enforcement",
]);
const REQUIRED_FILES = Object.freeze([
  "bootstrap.json",
  "reconnect-prepared.json",
  "network-fault.json",
  "lifecycle-faults.json",
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
    "leaseReceiptDigest",
    "targetPreflightReceiptDigest",
    "lifecycleAttestationDigest",
    "postSessionHookReceiptDigest",
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
  assert.equal(trajectory.sigtermDrainCount, 1);
  assert.equal(trajectory.postSessionHookCount, 1);
  assert.equal(trajectory.reclaimCount, 1);
  assert.equal(trajectory.leaseGeneration, 1);
  assert.ok(trajectory.finalRunnerGeneration >= 5);
  assert.equal(trajectory.finalRunnerState, "accepting");
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

  const bootstrap = documents["bootstrap.json"];
  assert.equal(
    bootstrap.schema,
    "chainlesschain.execution-location-bootstrap.v1",
  );
  assert.equal(bootstrap.releaseCommit, expected.releaseCommit);
  assert.equal(bootstrap.transport, expected.transport);
  assert.match(bootstrap.nodeVersion || "", /^v[0-9]+\.[0-9]+\.[0-9]+/u);
  assert.match(bootstrap.architecture || "", /^[A-Za-z0-9_-]+$/u);
  if (expected.os) {
    assert.equal(bootstrap.platform, PLATFORM_BY_OS[expected.os]);
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

  const lifecycleFaults = documents["lifecycle-faults.json"];
  assert.equal(
    lifecycleFaults.schema,
    "chainlesschain.execution-location-lifecycle-faults.v1",
  );
  assert.equal(lifecycleFaults.releaseCommit, expected.releaseCommit);
  assert.equal(lifecycleFaults.transport, expected.transport);
  for (const field of ["preflightReceiptDigest", "hookReceiptDigest"]) {
    assert.match(lifecycleFaults.sigterm?.[field] || "", DIGEST_RE);
  }
  const windowsLocalSigtermUnsupported =
    expected.transport === "local" && expected.os === "windows";
  assert.equal(
    lifecycleFaults.sigterm.sigtermCapability,
    windowsLocalSigtermUnsupported
      ? "unsupported-terminate-process"
      : "graceful-sigterm",
  );
  if (windowsLocalSigtermUnsupported) {
    assert.equal(lifecycleFaults.sigterm.targetReceiptDigest, null);
    assert.equal(lifecycleFaults.sigterm.signalDeliveryCount, 0);
  } else {
    assert.match(lifecycleFaults.sigterm.targetReceiptDigest || "", DIGEST_RE);
    assert.equal(lifecycleFaults.sigterm.signalDeliveryCount, 1);
  }
  assert.equal(lifecycleFaults.sigterm.sourceSignalRequested, "SIGTERM");
  assert.equal(lifecycleFaults.sigterm.postDrainLeaseAcceptanceCount, 0);
  assert.equal(lifecycleFaults.sigterm.sourceDrainingState, "draining");
  assert.equal(lifecycleFaults.sigterm.sourceAcceptingAfterDrain, false);
  assert.equal(lifecycleFaults.sigterm.sourceParkedState, "parked");
  assert.equal(lifecycleFaults.sigterm.reclaimedState, "accepting");
  assert.equal(lifecycleFaults.sigterm.targetProcessExitObserved, true);
  assert.equal(lifecycleFaults.sigterm.orphanProcessCount, 0);
  assert.deepEqual(lifecycleFaults.lostPoll, {
    stalePollAcceptanceCount: 0,
    parkedState: "parked",
    parkedLeaseCount: 1,
  });
  assert.equal(lifecycleFaults.tokenRotation.staleTokenAcceptanceCount, 0);
  assert.equal(
    lifecycleFaults.tokenRotation.staleTargetLaunchAcceptanceCount,
    0,
  );
  assert.ok(lifecycleFaults.tokenRotation.refreshedPollRevision >= 2);
  assert.match(
    lifecycleFaults.tokenRotation.refreshedTargetPreflightReceiptDigest || "",
    DIGEST_RE,
  );
  assert.equal(lifecycleFaults.tokenRotation.reclaimedState, "accepting");
  assert.deepEqual(lifecycleFaults.checkoutFailure, {
    parkedState: "parked",
    parkReason: "checkout-failure",
    reclaimedState: "accepting",
  });
  assert.deepEqual(
    lifecycleFaults.resources.map((entry) => entry.kind).sort(),
    ["cpu", "memory"],
  );
  for (const resource of lifecycleFaults.resources) {
    assert.match(resource.targetReceiptDigest || "", DIGEST_RE);
    assert.match(resource.preflightReceiptDigest || "", DIGEST_RE);
    assert.equal(resource.enforcementScope, "target-workload");
    assert.ok(["signal", "exit-status"].includes(resource.termination?.kind));
    assert.ok(
      typeof resource.termination?.value === "string" ||
        Number.isSafeInteger(resource.termination?.value),
    );
    assert.equal(resource.parkedState, "parked");
    assert.equal(resource.parkReason, "resource-limit");
    assert.equal(resource.reclaimedState, "accepting");
  }
  assert.equal(lifecycleFaults.staleAuthorityAcceptanceCount, 0);
  assert.equal(lifecycleFaults.secretTransferCount, 0);

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
  assert.equal(outcome.sigtermDrainCount, 100);
  assert.equal(outcome.postSessionHookCount, 100);
  assert.equal(outcome.reclaimCount, 100);
  assert.equal(outcome.injectedOutageCount, 1);
  assert.equal(outcome.unavailableProbeFailureCount, 1);
  assert.equal(
    outcome.sigtermCapability,
    windowsLocalSigtermUnsupported
      ? "unsupported-terminate-process"
      : "graceful-sigterm",
  );
  assert.equal(
    outcome.sigtermSignalDeliveryCount,
    windowsLocalSigtermUnsupported ? 0 : 1,
  );
  assert.equal(outcome.sourceFencedDrainCount, 1);
  assert.equal(outcome.unexpectedUnsupportedSigtermCount, 0);
  assert.equal(outcome.lostPollParkCount, 1);
  assert.equal(outcome.tokenRotationCount, 1);
  assert.equal(outcome.checkoutFailureParkCount, 1);
  assert.equal(outcome.targetResourceTerminationCount, 2);
  assert.equal(outcome.targetResourceParkCount, 2);
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
    os:
      expected.os ||
      Object.entries(PLATFORM_BY_OS).find(
        ([, platform]) => platform === bootstrap.platform,
      )?.[0],
    runtime: {
      name: "node",
      version: bootstrap.nodeVersion,
      arch: bootstrap.architecture,
    },
    manifestDigest: digest(
      fs.readFileSync(path.join(directory, "manifest.json")),
    ),
    outcomeDigest: digest(
      fs.readFileSync(path.join(directory, "outcome-observations.json")),
    ),
    trajectoryCount: outcome.trajectoryCount,
    counters: outcome,
  };
}

function writeOutput(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function producerDigests(repositoryRoot, releaseCommit) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  })
    .trim()
    .toLowerCase();
  assert.equal(head, releaseCommit, "audit producers are not at exact head");
  return Object.fromEntries(
    PRODUCER_PATHS.map((relativePath) => {
      const objectName = `${releaseCommit}:${relativePath}`;
      assert.equal(
        execFileSync("git", ["cat-file", "-t", objectName], {
          cwd: repositoryRoot,
          encoding: "utf8",
          shell: false,
        }).trim(),
        "blob",
        `${relativePath} is not a file at exact head`,
      );
      const bytes = execFileSync("git", ["cat-file", "blob", objectName], {
        cwd: repositoryRoot,
        encoding: null,
        maxBuffer: 128 * 1024 * 1024,
        shell: false,
      });
      return [relativePath, digest(bytes)];
    }),
  );
}

function sumCellCounter(cells, field) {
  return cells.reduce(
    (total, cell) => total + Number(cell.counters[field] || 0),
    0,
  );
}

function assertExactKeys(value, expected, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(
    Object.keys(value).sort(),
    [...expected].sort(),
    `${label} keys drifted`,
  );
}

function assertCanonicalAuditFragment(fragment) {
  assertExactKeys(fragment, AUDIT_FRAGMENT_KEYS, "audit fragment");
  assert.equal(fragment.schema, AUDIT_FRAGMENT_SCHEMA);
  assert.equal(fragment.commitmentId, "LOCATION-DRAIN");
  assert.match(fragment.headSha || "", SHA_RE);
  assert.ok(REQUIRED_OPERATING_SYSTEMS.includes(fragment.os));
  assertExactKeys(fragment.runtime, ["name", "version", "arch"], "runtime");
  assert.equal(fragment.profileVersion, PROFILE_VERSION);
  assert.deepEqual(fragment.thresholds, THRESHOLDS);
  assert.ok(Object.keys(fragment.measurements || {}).length > 0);
  assert.deepEqual(fragment.testIds, TEST_IDS);
  assert.deepEqual(
    Object.keys(fragment.producerDigests || {}).sort(),
    [...PRODUCER_PATHS].sort(),
  );
  for (const [producerPath, producerDigest] of Object.entries(
    fragment.producerDigests,
  )) {
    assert.ok(
      producerPath.length > 0 &&
        !producerPath.includes("\\") &&
        !producerPath.startsWith("/") &&
        !producerPath.startsWith("../"),
    );
    assert.match(producerDigest, DIGEST_RE);
  }
  assert.equal(fragment.disposition, "required");
  assertExactKeys(
    fragment.source,
    ["workflowId", "runId", "jobId", "artifactName"],
    "source",
  );
  assert.equal(fragment.outcome, "passed");
  return fragment;
}

function buildCanonicalAuditFragments({
  cells,
  releaseCommit,
  repositoryRoot,
  provenance,
  artifactName,
  resolveProducerDigests = producerDigests,
}) {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "required LOCATION-DRAIN fragments may only be emitted by GitHub Actions",
  );
  assert.match(provenance.runId || "", /^[1-9][0-9]*$/u);
  assert.match(
    provenance.workflowRef || "",
    /^[^\s]+\/\.github\/workflows\/[^@\s]+\.ya?ml@(?:refs\/[^\s]+|[a-f0-9]{40})$/u,
  );
  assert.match(provenance.job || "", /^[A-Za-z0-9_.-]+$/u);
  assert.ok(artifactName && !/[\\/]/u.test(artifactName));

  const localCells = new Map(
    cells
      .filter((cell) => cell.transport === "local")
      .map((cell) => [cell.os, cell]),
  );
  assert.deepEqual([...localCells.keys()].sort(), [
    ...REQUIRED_OPERATING_SYSTEMS,
  ]);
  const remoteCells = new Map(
    cells
      .filter((cell) => cell.transport !== "local")
      .map((cell) => [cell.transport, cell]),
  );
  assert.deepEqual(
    [...remoteCells.keys()].sort(),
    [...REQUIRED_REMOTE_TRANSPORTS].sort(),
  );

  const cellId = (cell) =>
    cell.transport === "local" ? `local-${cell.os}` : cell.transport;
  const gracefulSigtermCells = cells
    .filter(
      (cell) =>
        cell.counters.sigtermCapability === "graceful-sigterm" &&
        cell.counters.sigtermSignalDeliveryCount === 1,
    )
    .map(cellId)
    .sort();
  const unsupportedSigtermCells = cells
    .filter(
      (cell) =>
        cell.counters.sigtermCapability === "unsupported-terminate-process" &&
        cell.counters.sigtermSignalDeliveryCount === 0,
    )
    .map(cellId)
    .sort();
  const sourceFencedDrainCells = cells
    .filter((cell) => cell.counters.sourceFencedDrainCount === 1)
    .map(cellId)
    .sort();

  const measurements = {
    requiredCellCount: cells.length,
    totalTrajectoryCount: cells.reduce(
      (total, cell) => total + cell.trajectoryCount,
      0,
    ),
    localTrajectoriesByOperatingSystem: Object.fromEntries(
      REQUIRED_OPERATING_SYSTEMS.map((operatingSystem) => [
        operatingSystem,
        localCells.get(operatingSystem).trajectoryCount,
      ]),
    ),
    remoteTrajectoriesByTarget: Object.fromEntries(
      REQUIRED_REMOTE_TRANSPORTS.map((transport) => [
        transport,
        remoteCells.get(transport).trajectoryCount,
      ]),
    ),
    sigtermDrainCount: sumCellCounter(cells, "sigtermDrainCount"),
    gracefulSigtermCells,
    gracefulSigtermCellCount: gracefulSigtermCells.length,
    unsupportedSigtermCells,
    sourceFencedDrainCells,
    sourceFencedDrainCellCount: sourceFencedDrainCells.length,
    unexpectedUnsupportedSigtermCount: sumCellCounter(
      cells,
      "unexpectedUnsupportedSigtermCount",
    ),
    lostPollParkCount: sumCellCounter(cells, "lostPollParkCount"),
    tokenRotationCount: sumCellCounter(cells, "tokenRotationCount"),
    checkoutFailureParkCount: sumCellCounter(cells, "checkoutFailureParkCount"),
    resultReturnCount: sumCellCounter(cells, "resultCollectCount"),
    remoteTargetResourceTerminationCount: sumCellCounter(
      [...remoteCells.values()],
      "targetResourceTerminationCount",
    ),
    remoteTargetResourceParkCount: sumCellCounter(
      [...remoteCells.values()],
      "targetResourceParkCount",
    ),
    staleAuthorityAcceptanceCount: sumCellCounter(
      cells,
      "staleAuthorityAcceptanceCount",
    ),
    secretTransferCount: sumCellCounter(cells, "secretTransferCount"),
    orphanProcessCount: sumCellCounter(cells, "orphanProcessCount"),
  };
  assert.equal(cells.length, 6);
  assert.equal(measurements.totalTrajectoryCount, 600);
  assert.deepEqual(measurements.gracefulSigtermCells, [
    "container",
    "local-linux",
    "local-macos",
    "ssh",
    "wsl",
  ]);
  assert.equal(
    measurements.gracefulSigtermCellCount,
    THRESHOLDS.minimumGracefulSigtermCells,
  );
  assert.deepEqual(
    measurements.unsupportedSigtermCells,
    THRESHOLDS.requiredUnsupportedSigtermCells,
  );
  assert.deepEqual(measurements.sourceFencedDrainCells, [
    "container",
    "local-linux",
    "local-macos",
    "local-windows",
    "ssh",
    "wsl",
  ]);
  assert.equal(
    measurements.sourceFencedDrainCellCount,
    THRESHOLDS.minimumSourceFencedDrainCells,
  );
  assert.equal(
    measurements.unexpectedUnsupportedSigtermCount,
    THRESHOLDS.maximumUnexpectedUnsupportedSigtermCells,
  );
  assert.equal(measurements.remoteTargetResourceTerminationCount, 6);
  assert.equal(measurements.remoteTargetResourceParkCount, 6);
  assert.equal(measurements.staleAuthorityAcceptanceCount, 0);
  assert.equal(measurements.secretTransferCount, 0);
  assert.equal(measurements.orphanProcessCount, 0);
  const producers = resolveProducerDigests(repositoryRoot, releaseCommit);
  const source = {
    workflowId: provenance.workflowRef,
    runId: provenance.runId,
    jobId: provenance.job,
    artifactName,
  };
  return REQUIRED_OPERATING_SYSTEMS.map((operatingSystem) =>
    assertCanonicalAuditFragment({
      schema: AUDIT_FRAGMENT_SCHEMA,
      commitmentId: "LOCATION-DRAIN",
      headSha: releaseCommit,
      os: operatingSystem,
      runtime: localCells.get(operatingSystem).runtime,
      profileVersion: PROFILE_VERSION,
      thresholds: THRESHOLDS,
      measurements,
      testIds: TEST_IDS,
      producerDigests: producers,
      disposition: "required",
      source,
      outcome: "passed",
    }),
  );
}

function writeCanonicalAuditFragments(directory, fragments) {
  fs.mkdirSync(directory, { recursive: true });
  for (const fragment of fragments) {
    writeOutput(
      path.join(directory, `location-drain-${fragment.os}.json`),
      fragment,
    );
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assert.match(options.releaseCommit || "", SHA_RE);
  assert.ok(
    options.evidenceRoot &&
      options.output &&
      options.fragmentOutputDir &&
      options.fragmentArtifactName,
  );
  const shared = {
    repository: options.repository,
    workflowRef: options.workflowRef,
    workflowSha: options.workflowSha,
    runId: options.runId,
    runAttempt: options.runAttempt,
    eventName: options.eventName,
  };
  const root = path.resolve(options.evidenceRoot);
  const localCells = REQUIRED_OPERATING_SYSTEMS.map((operatingSystem) => {
    const artifactName = `ide-execution-location-local-${operatingSystem}-${options.runAttempt}`;
    return verifyCell(path.join(root, "local", operatingSystem), {
      transport: "local",
      os: operatingSystem,
      releaseCommit: options.releaseCommit,
      provenance: {
        ...shared,
        job: "local-execution-location",
        artifactName,
      },
    });
  });
  const remoteCells = REQUIRED_REMOTE_TRANSPORTS.map((transport) => {
    const job = `${transport}-execution-location`;
    const artifactName = `ide-execution-location-${transport}-${options.runAttempt}`;
    return verifyCell(path.join(root, transport), {
      transport,
      os: transport === "wsl" ? "windows" : "linux",
      releaseCommit: options.releaseCommit,
      provenance: { ...shared, job, artifactName },
    });
  });
  const cells = [...localCells, ...remoteCells];
  writeOutput(path.resolve(options.output), {
    schema: "chainlesschain.execution-location-aggregate.v1",
    releaseCommit: options.releaseCommit,
    exactCommitBound: true,
    requiredCells: [
      ...REQUIRED_OPERATING_SYSTEMS.map(
        (operatingSystem) => `local-${operatingSystem}`,
      ),
      ...REQUIRED_REMOTE_TRANSPORTS,
    ],
    totalTrajectories: cells.reduce(
      (total, cell) => total + cell.trajectoryCount,
      0,
    ),
    cells,
  });
  const fragments = buildCanonicalAuditFragments({
    cells,
    releaseCommit: options.releaseCommit,
    repositoryRoot: path.resolve(options.repositoryRoot || process.cwd()),
    provenance: {
      ...shared,
      job: process.env.GITHUB_JOB || "trusted-execution-location-aggregate",
    },
    artifactName: options.fragmentArtifactName,
  });
  writeCanonicalAuditFragments(
    path.resolve(options.fragmentOutputDir),
    fragments,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

export {
  AUDIT_FRAGMENT_SCHEMA,
  PRODUCER_PATHS,
  PROFILE_VERSION,
  REQUIRED_FILES,
  REQUIRED_OPERATING_SYSTEMS,
  REQUIRED_REMOTE_TRANSPORTS,
  REQUIRED_TRANSPORTS,
  TEST_IDS,
  THRESHOLDS,
  assertTrajectory,
  assertCanonicalAuditFragment,
  buildCanonicalAuditFragments,
  verifyCell,
  writeCanonicalAuditFragments,
};
